#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { chromium, Browser, Page, BrowserContext, _electron as electron, ElectronApplication } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, createWriteStream, WriteStream } from 'fs';
import { platform } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Session timeout configuration (30 minutes by default)
const SESSION_TIMEOUT = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000; // Clean up check every 5 minutes
const MAX_MEMORY_MB = 2048; // Maximum memory usage in MB

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  pages: Map<string, Page>;
  lastActivity: number; // Track last activity time
  createdAt: number; // Track creation time
  logStreams: Map<string, WriteStream>; // Log streams for each page
}

interface ElectronSession {
  app: ElectronApplication;
  mainWindow?: Page;
  executablePath: string;
  lastActivity: number;
  createdAt: number;
}

interface TestRecording {
  sessionId: string;
  actions: TestAction[];
  startTime: number;
  metadata: {
    url: string;
    viewport: { width: number; height: number };
    userAgent: string;
  };
}

interface TestAction {
  type: 'navigate' | 'click' | 'fill' | 'select' | 'press' | 'wait' | 'assert';
  timestamp: number;
  selector?: string;
  value?: string;
  url?: string;
  assertion?: {
    type: 'text' | 'visible' | 'enabled' | 'url' | 'title';
    expected: string;
  };
}

class PlaywrightMCPServer {
  private server: Server;
  private sessions: Map<string, BrowserSession> = new Map();
  private electronSessions: Map<string, ElectronSession> = new Map();
  private recordings: Map<string, TestRecording> = new Map();
  private screenshotDir: string;
  private testDir: string;
  private logDir: string;
  private cleanupTimer?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor() {
    this.server = new Server(
      {
        name: 'playwright-mcp',
        version: '1.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Setup playwright base directory
    const playwrightBaseDir = join(process.cwd(), 'playwright');
    
    // Setup screenshot directory
    this.screenshotDir = join(playwrightBaseDir, 'screenshot');
    if (!existsSync(this.screenshotDir)) {
      mkdirSync(this.screenshotDir, { recursive: true });
    }

    // Setup test directory
    this.testDir = join(playwrightBaseDir, 'test');
    if (!existsSync(this.testDir)) {
      mkdirSync(this.testDir, { recursive: true });
    }

    // Setup log directory for console logs
    this.logDir = join(playwrightBaseDir, 'log');
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    this.setupHandlers();
    this.startCleanupRoutine();
    this.setupProcessHandlers();
  }

  // Start periodic cleanup routine
  private startCleanupRoutine() {
    this.cleanupTimer = setInterval(async () => {
      await this.cleanupInactiveSessions();
      await this.checkMemoryUsage();
      await this.cleanupZombieProcesses();
    }, CLEANUP_INTERVAL);
  }

  // Clean up inactive sessions
  private async cleanupInactiveSessions() {
    const now = Date.now();
    
    // Clean browser sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > SESSION_TIMEOUT) {
        console.error(`Cleaning up inactive browser session: ${sessionId}`);
        try {
          await session.browser.close();
        } catch (error) {
          console.error(`Error closing browser session ${sessionId}:`, error);
        }
        this.sessions.delete(sessionId);
      }
    }

    // Clean electron sessions
    for (const [sessionId, session] of this.electronSessions.entries()) {
      if (now - session.lastActivity > SESSION_TIMEOUT) {
        console.error(`Cleaning up inactive electron session: ${sessionId}`);
        try {
          await session.app.close();
        } catch (error) {
          console.error(`Error closing electron session ${sessionId}:`, error);
        }
        this.electronSessions.delete(sessionId);
      }
    }
  }

  // Check memory usage and clean if necessary
  private async checkMemoryUsage() {
    try {
      const { stdout } = await execAsync(`ps -p ${process.pid} -o rss=`);
      const memoryMB = parseInt(stdout.trim()) / 1024;
      
      if (memoryMB > MAX_MEMORY_MB) {
        console.error(`High memory usage detected: ${memoryMB.toFixed(2)}MB. Cleaning up old sessions...`);
        await this.cleanupOldestSessions();
      }
    } catch (error) {
      console.error('Error checking memory usage:', error);
    }
  }

  // Clean up zombie playwright processes
  private async cleanupZombieProcesses() {
    try {
      // Kill any headless_shell processes that are not associated with active sessions
      const { stdout } = await execAsync(`pgrep -f "headless_shell|chromium" || true`);
      const pids = stdout.trim().split('\n').filter(pid => pid);
      
      if (pids.length > this.sessions.size * 2) { // Allow some buffer
        console.error(`Found ${pids.length} browser processes but only ${this.sessions.size} active sessions. Cleaning zombies...`);
        // Kill oldest processes
        await execAsync(`pkill -o -f "headless_shell" || true`);
      }
    } catch (error) {
      // Ignore errors from process checking
    }
  }

  // Clean up oldest sessions when memory is high
  private async cleanupOldestSessions() {
    // Sort sessions by creation time
    const browserSessions = Array.from(this.sessions.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    
    // Close oldest 25% of sessions
    const toClose = Math.max(1, Math.floor(browserSessions.length * 0.25));
    
    for (let i = 0; i < toClose && i < browserSessions.length; i++) {
      const [sessionId, session] = browserSessions[i];
      console.error(`Closing old session due to memory pressure: ${sessionId}`);
      try {
        await session.browser.close();
      } catch (error) {
        console.error(`Error closing session ${sessionId}:`, error);
      }
      this.sessions.delete(sessionId);
    }
  }

  // Setup process exit handlers
  private setupProcessHandlers() {
    const cleanup = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      
      console.error('Shutting down Playwright MCP server...');
      
      // Clear cleanup timer
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
      }

      // Close all browser sessions
      const browserClosePromises = Array.from(this.sessions.values()).map(async (session) => {
        try {
          await session.browser.close();
        } catch (error) {
          console.error('Error closing browser:', error);
        }
      });

      // Close all electron sessions
      const electronClosePromises = Array.from(this.electronSessions.values()).map(async (session) => {
        try {
          await session.app.close();
        } catch (error) {
          console.error('Error closing electron app:', error);
        }
      });

      await Promise.all([...browserClosePromises, ...electronClosePromises]);

      // Kill any remaining headless_shell processes
      try {
        await execAsync('pkill -f "headless_shell" || true');
      } catch (error) {
        // Ignore errors
      }

      console.error('Cleanup complete');
      process.exit(0);
    };

    // Handle various exit signals
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('SIGHUP', cleanup);
    process.on('SIGQUIT', cleanup);
    process.on('exit', cleanup);
    process.on('uncaughtException', async (error) => {
      console.error('Uncaught exception:', error);
      await cleanup();
    });
  }

  // Update last activity time for a session
  private updateSessionActivity(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
    const electronSession = this.electronSessions.get(sessionId);
    if (electronSession) {
      electronSession.lastActivity = Date.now();
    }
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'browser_launch',
          description: 'Launch a new browser instance in headless mode',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', description: 'Unique session identifier' },
              headless: { type: 'boolean', description: 'Run in headless mode (default: true)' },
              viewport: {
                type: 'object',
                properties: {
                  width: { type: 'number', default: 1920 },
                  height: { type: 'number', default: 1080 }
                }
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'browser_close',
          description: 'Close a browser session',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', description: 'Session to close' }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'browser_close_all',
          description: 'Close all browser sessions and clean up zombie processes',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'page_navigate',
          description: 'Navigate to a URL',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' },
              url: { type: 'string', description: 'URL to navigate to' },
              waitUntil: { 
                type: 'string', 
                enum: ['load', 'domcontentloaded', 'networkidle'],
                default: 'load'
              }
            },
            required: ['sessionId', 'url']
          }
        },
        {
          name: 'page_screenshot',
          description: 'Take a screenshot of the current page',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' },
              fullPage: { type: 'boolean', default: false },
              filename: { type: 'string', description: 'Screenshot filename' }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'page_click',
          description: 'Click an element on the page',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' },
              selector: { type: 'string', description: 'CSS selector or text to click' }
            },
            required: ['sessionId', 'selector']
          }
        },
        {
          name: 'page_fill',
          description: 'Fill a form field',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' },
              selector: { type: 'string', description: 'CSS selector for the input' },
              value: { type: 'string', description: 'Value to fill' }
            },
            required: ['sessionId', 'selector', 'value']
          }
        },
        {
          name: 'page_evaluate',
          description: 'Execute JavaScript in the page context',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' },
              script: { type: 'string', description: 'JavaScript code to execute' }
            },
            required: ['sessionId', 'script']
          }
        },
        {
          name: 'page_wait_for_selector',
          description: 'Wait for a selector to appear on the page',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' },
              selector: { type: 'string', description: 'CSS selector to wait for' },
              timeout: { type: 'number', default: 30000, description: 'Timeout in milliseconds' }
            },
            required: ['sessionId', 'selector']
          }
        },
        {
          name: 'page_get_content',
          description: 'Get the HTML content of the page',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'page_get_text',
          description: 'Get text content from elements',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' },
              selector: { type: 'string', description: 'CSS selector to get text from' }
            },
            required: ['sessionId', 'selector']
          }
        },
        {
          name: 'page_press',
          description: 'Press a key on the keyboard',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' },
              key: { type: 'string', description: 'Key to press (e.g., Enter, Escape, ArrowDown)' }
            },
            required: ['sessionId', 'key']
          }
        },
        {
          name: 'page_select',
          description: 'Select an option from a dropdown',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' },
              selector: { type: 'string', description: 'CSS selector for the select element' },
              value: { type: 'string', description: 'Value to select' }
            },
            required: ['sessionId', 'selector', 'value']
          }
        },
        {
          name: 'list_sessions',
          description: 'List all active browser sessions',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'session_stats',
          description: 'Get statistics about sessions and resource usage',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'electron_launch',
          description: 'Launch an Electron application',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', description: 'Unique session identifier' },
              executablePath: { type: 'string', description: 'Path to Electron executable' },
              args: { type: 'array', items: { type: 'string' }, description: 'Arguments for Electron app' },
              env: { type: 'object', description: 'Environment variables' },
              headless: { type: 'boolean', description: 'Run in headless mode (Linux only)', default: true }
            },
            required: ['sessionId', 'executablePath']
          }
        },
        {
          name: 'electron_close',
          description: 'Close an Electron application',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', description: 'Session to close' }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'electron_evaluate_main',
          description: 'Execute JavaScript in Electron main process',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              expression: { type: 'string', description: 'JavaScript expression to evaluate' }
            },
            required: ['sessionId', 'expression']
          }
        },
        {
          name: 'electron_evaluate_renderer',
          description: 'Execute JavaScript in Electron renderer process',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              expression: { type: 'string', description: 'JavaScript expression to evaluate' }
            },
            required: ['sessionId', 'expression']
          }
        },
        {
          name: 'electron_get_info',
          description: 'Get Electron app information',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'electron_window_state',
          description: 'Get Electron window state',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'electron_screenshot',
          description: 'Take a screenshot of Electron app',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              filename: { type: 'string', description: 'Screenshot filename' }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'test_start_recording',
          description: 'Start recording user actions for test generation',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', description: 'Browser session to record' },
              testName: { type: 'string', description: 'Name for the test case' }
            },
            required: ['sessionId', 'testName']
          }
        },
        {
          name: 'test_stop_recording',
          description: 'Stop recording and generate test script',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string', description: 'Browser session being recorded' },
              format: { 
                type: 'string', 
                enum: ['playwright', 'jest', 'mocha'],
                default: 'playwright',
                description: 'Test framework format'
              }
            },
            required: ['sessionId']
          }
        },
        {
          name: 'test_generate_regression',
          description: 'Generate regression test based on current page state',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: { type: 'string' },
              pageId: { type: 'string', default: 'main' },
              testName: { type: 'string', description: 'Name for the regression test' },
              assertions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['text', 'visible', 'url', 'title'] },
                    selector: { type: 'string' },
                    expected: { type: 'string' }
                  },
                  required: ['type', 'expected']
                },
                description: 'Custom assertions to include'
              }
            },
            required: ['sessionId', 'testName']
          }
        },
        {
          name: 'test_generate_suite',
          description: 'Generate test suite from multiple recorded sessions',
          inputSchema: {
            type: 'object',
            properties: {
              suiteName: { type: 'string', description: 'Name for the test suite' },
              testCases: { 
                type: 'array', 
                items: { type: 'string' }, 
                description: 'List of recorded test names to include' 
              },
              format: { 
                type: 'string', 
                enum: ['playwright', 'jest', 'mocha'],
                default: 'playwright'
              }
            },
            required: ['suiteName', 'testCases']
          }
        },
        {
          name: 'test_list_recordings',
          description: 'List all available test recordings',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Update session activity for most operations
        if ((args as any)?.sessionId) {
          this.updateSessionActivity((args as any).sessionId);
        }

        switch (name) {
          case 'browser_launch':
            return await this.launchBrowser(args);
          
          case 'browser_close':
            return await this.closeBrowser((args as any)?.sessionId || '');
          
          case 'browser_close_all':
            return await this.closeAllBrowsers();
          
          case 'page_navigate':
            return await this.navigatePage(args);
          
          case 'page_screenshot':
            return await this.takeScreenshot(args);
          
          case 'page_click':
            return await this.clickElement(args);
          
          case 'page_fill':
            return await this.fillField(args);
          
          case 'page_evaluate':
            return await this.evaluateScript(args);
          
          case 'page_wait_for_selector':
            return await this.waitForSelector(args);
          
          case 'page_get_content':
            return await this.getPageContent(args);
          
          case 'page_get_text':
            return await this.getElementText(args);
          
          case 'page_press':
            return await this.pressKey(args);
          
          case 'page_select':
            return await this.selectOption(args);
          
          case 'list_sessions':
            return await this.listSessions();
          
          case 'session_stats':
            return await this.getSessionStats();
          
          case 'electron_launch':
            return await this.launchElectron(args);
          
          case 'electron_close':
            return await this.closeElectron((args as any)?.sessionId || '');
          
          case 'electron_evaluate_main':
            return await this.evaluateInMain(args);
          
          case 'electron_evaluate_renderer':
            return await this.evaluateInRenderer(args);
          
          case 'electron_get_info':
            return await this.getElectronInfo(args);
          
          case 'electron_window_state':
            return await this.getElectronWindowState(args);
          
          case 'electron_screenshot':
            return await this.takeElectronScreenshot(args);
          
          case 'test_start_recording':
            return await this.startTestRecording(args);
          
          case 'test_stop_recording':
            return await this.stopTestRecording(args);
          
          case 'test_generate_regression':
            return await this.generateRegressionTest(args);
          
          case 'test_generate_suite':
            return await this.generateTestSuite(args);
          
          case 'test_list_recordings':
            return await this.listTestRecordings();
          
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error: any) {
        console.error(`Tool ${name} error:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    });
  }

  private async launchBrowser(args: any) {
    const { sessionId, headless = true, viewport = { width: 1920, height: 1080 } } = args;

    if (this.sessions.has(sessionId)) {
      return {
        content: [{
          type: 'text',
          text: `Session ${sessionId} already exists`
        }]
      };
    }

    const browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    const page = await context.newPage();
    
    const now = Date.now();
    const session: BrowserSession = {
      browser,
      context,
      pages: new Map([['main', page]]),
      lastActivity: now,
      createdAt: now,
      logStreams: new Map()
    };

    this.sessions.set(sessionId, session);
    
    // Setup console logging for the main page
    this.setupPageLogging(sessionId, 'main', page);

    return {
      content: [{
        type: 'text',
        text: `Browser launched with session ID: ${sessionId} (headless: ${headless})`
      }]
    };
  }

  private async closeBrowser(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        content: [{
          type: 'text',
          text: `Session ${sessionId} not found`
        }]
      };
    }

    try {
      // Close log streams first
      this.closeLogStreams(sessionId);
      await session.browser.close();
    } catch (error) {
      console.error(`Error closing browser ${sessionId}:`, error);
    }
    
    this.sessions.delete(sessionId);

    return {
      content: [{
        type: 'text',
        text: `Browser session ${sessionId} closed`
      }]
    };
  }

  private async closeAllBrowsers() {
    const sessionIds = Array.from(this.sessions.keys());
    const electronSessionIds = Array.from(this.electronSessions.keys());
    
    // Close all browser sessions
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session) {
        try {
          await session.browser.close();
        } catch (error) {
          console.error(`Error closing browser ${sessionId}:`, error);
        }
      }
    }
    this.sessions.clear();

    // Close all electron sessions
    for (const sessionId of electronSessionIds) {
      const session = this.electronSessions.get(sessionId);
      if (session) {
        try {
          await session.app.close();
        } catch (error) {
          console.error(`Error closing electron ${sessionId}:`, error);
        }
      }
    }
    this.electronSessions.clear();

    // Kill any zombie processes
    try {
      await execAsync('pkill -f "headless_shell|chromium" || true');
    } catch (error) {
      // Ignore errors
    }

    return {
      content: [{
        type: 'text',
        text: `Closed ${sessionIds.length} browser sessions and ${electronSessionIds.length} electron sessions. Cleaned up zombie processes.`
      }]
    };
  }

  private async getSessionStats() {
    const browserCount = this.sessions.size;
    const electronCount = this.electronSessions.size;
    
    let memoryUsage = 0;
    try {
      const { stdout } = await execAsync(`ps -p ${process.pid} -o rss=`);
      memoryUsage = parseInt(stdout.trim()) / 1024;
    } catch (error) {
      // Ignore
    }

    let zombieProcesses = 0;
    try {
      const { stdout } = await execAsync(`pgrep -f "headless_shell|chromium" | wc -l`);
      zombieProcesses = parseInt(stdout.trim()) - browserCount;
    } catch (error) {
      // Ignore
    }

    const stats = {
      browserSessions: browserCount,
      electronSessions: electronCount,
      memoryUsageMB: memoryUsage.toFixed(2),
      maxMemoryMB: MAX_MEMORY_MB,
      sessionTimeout: `${SESSION_TIMEOUT / 1000 / 60} minutes`,
      zombieProcesses: Math.max(0, zombieProcesses),
      sessions: Array.from(this.sessions.entries()).map(([id, session]) => ({
        id,
        createdAt: new Date(session.createdAt).toISOString(),
        lastActivity: new Date(session.lastActivity).toISOString(),
        inactiveMinutes: Math.round((Date.now() - session.lastActivity) / 1000 / 60)
      }))
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(stats, null, 2)
      }]
    };
  }

  private async navigatePage(args: any) {
    const { sessionId, pageId = 'main', url, waitUntil = 'load' } = args;
    
    const page = this.getPage(sessionId, pageId);
    await page.goto(url, { waitUntil: waitUntil as any });

    return {
      content: [{
        type: 'text',
        text: `Navigated to ${url}`
      }]
    };
  }

  private async takeScreenshot(args: any) {
    const { sessionId, pageId = 'main', fullPage = false, filename } = args;
    
    const page = this.getPage(sessionId, pageId);
    const screenshotName = filename || `screenshot-${Date.now()}.png`;
    const path = join(this.screenshotDir, screenshotName);
    
    await page.screenshot({ 
      path,
      fullPage 
    });

    return {
      content: [{
        type: 'text',
        text: `Screenshot saved to ${path}`
      }]
    };
  }

  private async clickElement(args: any) {
    const { sessionId, pageId = 'main', selector } = args;
    
    const page = this.getPage(sessionId, pageId);
    
    // Try as CSS selector first, then as text
    try {
      await page.click(selector);
    } catch {
      await page.click(`text=${selector}`);
    }

    return {
      content: [{
        type: 'text',
        text: `Clicked element: ${selector}`
      }]
    };
  }

  private async fillField(args: any) {
    const { sessionId, pageId = 'main', selector, value } = args;
    
    const page = this.getPage(sessionId, pageId);
    await page.fill(selector, value);

    return {
      content: [{
        type: 'text',
        text: `Filled ${selector} with value: ${value}`
      }]
    };
  }

  private async evaluateScript(args: any) {
    const { sessionId, pageId = 'main', script } = args;
    
    const page = this.getPage(sessionId, pageId);
    const result = await page.evaluate(script);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  private async waitForSelector(args: any) {
    const { sessionId, pageId = 'main', selector, timeout = 30000 } = args;
    
    const page = this.getPage(sessionId, pageId);
    await page.waitForSelector(selector, { timeout });

    return {
      content: [{
        type: 'text',
        text: `Element ${selector} is now visible`
      }]
    };
  }

  private async getPageContent(args: any) {
    const { sessionId, pageId = 'main' } = args;
    
    const page = this.getPage(sessionId, pageId);
    const content = await page.content();

    return {
      content: [{
        type: 'text',
        text: content
      }]
    };
  }

  private async getElementText(args: any) {
    const { sessionId, pageId = 'main', selector } = args;
    
    const page = this.getPage(sessionId, pageId);
    const text = await page.textContent(selector);

    return {
      content: [{
        type: 'text',
        text: text || 'No text found'
      }]
    };
  }

  private async pressKey(args: any) {
    const { sessionId, pageId = 'main', key } = args;
    
    const page = this.getPage(sessionId, pageId);
    await page.keyboard.press(key);

    return {
      content: [{
        type: 'text',
        text: `Pressed key: ${key}`
      }]
    };
  }

  private async selectOption(args: any) {
    const { sessionId, pageId = 'main', selector, value } = args;
    
    const page = this.getPage(sessionId, pageId);
    await page.selectOption(selector, value);

    return {
      content: [{
        type: 'text',
        text: `Selected option ${value} in ${selector}`
      }]
    };
  }

  private async listSessions() {
    const browserSessions = Array.from(this.sessions.keys());
    const electronSessions = Array.from(this.electronSessions.keys());
    
    return {
      content: [{
        type: 'text',
        text: `Browser sessions: ${browserSessions.length > 0 ? browserSessions.join(', ') : 'None'}\nElectron sessions: ${electronSessions.length > 0 ? electronSessions.join(', ') : 'None'}`
      }]
    };
  }

  // Electron methods
  private async launchElectron(args: any) {
    const { sessionId, executablePath, args: electronArgs = [], env = {}, headless = true } = args;

    if (this.electronSessions.has(sessionId)) {
      return {
        content: [{
          type: 'text',
          text: `Electron session ${sessionId} already exists`
        }]
      };
    }

    // Setup headless environment for Linux
    const electronEnv = { ...process.env, ...env };
    if (headless && platform() === 'linux') {
      electronEnv.DISPLAY = '';
      electronEnv.ELECTRON_RUN_AS_NODE = '1';
      electronEnv.ELECTRON_NO_SANDBOX = '1';
      electronEnv.ELECTRON_DISABLE_GPU = '1';
    }

    const app = await electron.launch({
      executablePath,
      args: electronArgs,
      env: electronEnv
    });

    const mainWindow = await app.firstWindow().catch(() => undefined);
    
    const now = Date.now();
    this.electronSessions.set(sessionId, {
      app,
      mainWindow,
      executablePath,
      lastActivity: now,
      createdAt: now
    });

    return {
      content: [{
        type: 'text',
        text: `Electron app launched with session ${sessionId}`
      }]
    };
  }

  private async closeElectron(sessionId: string) {
    const session = this.electronSessions.get(sessionId);
    if (!session) {
      return {
        content: [{
          type: 'text',
          text: `Electron session ${sessionId} not found`
        }]
      };
    }

    try {
      await session.app.close();
    } catch (error) {
      console.error(`Error closing electron ${sessionId}:`, error);
    }
    
    this.electronSessions.delete(sessionId);

    return {
      content: [{
        type: 'text',
        text: `Electron session ${sessionId} closed`
      }]
    };
  }

  private async evaluateInMain(args: any) {
    const { sessionId, expression } = args;
    
    const session = this.electronSessions.get(sessionId);
    if (!session) {
      throw new Error(`Electron session ${sessionId} not found`);
    }

    const result = await session.app.evaluate(expression);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  private async evaluateInRenderer(args: any) {
    const { sessionId, expression } = args;
    
    const session = this.electronSessions.get(sessionId);
    if (!session) {
      throw new Error(`Electron session ${sessionId} not found`);
    }

    if (!session.mainWindow) {
      throw new Error(`No window available in session ${sessionId}`);
    }

    const result = await session.mainWindow.evaluate(expression);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  private async getElectronInfo(args: any) {
    const { sessionId } = args;
    
    const session = this.electronSessions.get(sessionId);
    if (!session) {
      throw new Error(`Electron session ${sessionId} not found`);
    }

    const info = await session.app.evaluate(async ({ app }) => {
      return {
        name: app.getName(),
        version: app.getVersion(),
        locale: app.getLocale(),
        path: app.getAppPath(),
        isPackaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        nodeVersion: process.versions.node
      };
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(info, null, 2)
      }]
    };
  }

  private async getElectronWindowState(args: any) {
    const { sessionId } = args;
    
    const session = this.electronSessions.get(sessionId);
    if (!session) {
      throw new Error(`Electron session ${sessionId} not found`);
    }

    const state = await session.app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return null;
      
      return {
        bounds: win.getBounds(),
        isMaximized: win.isMaximized(),
        isMinimized: win.isMinimized(),
        isFullScreen: win.isFullScreen(),
        isVisible: win.isVisible(),
        isFocused: win.isFocused()
      };
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(state, null, 2)
      }]
    };
  }

  private async takeElectronScreenshot(args: any) {
    const { sessionId, filename } = args;
    
    const session = this.electronSessions.get(sessionId);
    if (!session) {
      throw new Error(`Electron session ${sessionId} not found`);
    }

    if (!session.mainWindow) {
      throw new Error(`No window available in session ${sessionId}`);
    }

    const screenshotName = filename || `electron-${Date.now()}.png`;
    const path = join(this.screenshotDir, screenshotName);
    
    await session.mainWindow.screenshot({ path });

    return {
      content: [{
        type: 'text',
        text: `Electron screenshot saved to ${path}`
      }]
    };
  }

  // Test Recording and Generation Methods
  private async startTestRecording(args: any) {
    const { sessionId, testName } = args;
    
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const page = session.pages.get('main');
    if (!page) {
      throw new Error(`Main page not found in session ${sessionId}`);
    }

    const recording: TestRecording = {
      sessionId,
      actions: [],
      startTime: Date.now(),
      metadata: {
        url: page.url(),
        viewport: await page.viewportSize() || { width: 1920, height: 1080 },
        userAgent: await page.evaluate('navigator.userAgent')
      }
    };

    this.recordings.set(testName, recording);

    return {
      content: [{
        type: 'text',
        text: `Started recording test "${testName}" for session ${sessionId}`
      }]
    };
  }

  private async stopTestRecording(args: any) {
    const { sessionId, format = 'playwright' } = args;
    
    const recording = Array.from(this.recordings.values())
      .find(r => r.sessionId === sessionId);
    
    if (!recording) {
      throw new Error(`No active recording found for session ${sessionId}`);
    }

    const testName = Array.from(this.recordings.entries())
      .find(([_, r]) => r === recording)?.[0];

    if (!testName) {
      throw new Error(`Recording name not found`);
    }

    const testScript = this.generateTestScript(recording, testName, format);
    const filename = `${testName}-${format}.spec.js`;
    const filepath = join(this.testDir, filename);
    
    writeFileSync(filepath, testScript);
    this.recordings.delete(testName);

    return {
      content: [{
        type: 'text',
        text: `Test recording stopped. Generated test script: ${filepath}`
      }]
    };
  }

  private async generateRegressionTest(args: any) {
    const { sessionId, pageId = 'main', testName, assertions = [] } = args;
    
    const page = this.getPage(sessionId, pageId);
    const url = page.url();
    const title = await page.title();

    // Generate automatic assertions
    const autoAssertions: TestAction[] = [
      {
        type: 'assert',
        timestamp: Date.now(),
        assertion: { type: 'url', expected: url }
      },
      {
        type: 'assert',
        timestamp: Date.now(),
        assertion: { type: 'title', expected: title }
      }
    ];

    // Add custom assertions
    const customAssertions: TestAction[] = assertions.map((assertion: any) => ({
      type: 'assert',
      timestamp: Date.now(),
      selector: assertion.selector,
      assertion: {
        type: assertion.type,
        expected: assertion.expected
      }
    }));

    // Detect common elements and create visibility assertions
    const commonSelectors = [
      'h1', 'h2', 'h3', 'button', 'input', 'form', '.main', '.content', '#app'
    ];

    const elementAssertions: TestAction[] = [];
    for (const selector of commonSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            elementAssertions.push({
              type: 'assert',
              timestamp: Date.now(),
              selector,
              assertion: { type: 'visible', expected: 'true' }
            });
          }
        }
      } catch (e) {
        // Skip if selector not found
      }
    }

    const recording: TestRecording = {
      sessionId,
      actions: [
        {
          type: 'navigate',
          timestamp: Date.now(),
          url: url
        },
        ...autoAssertions,
        ...customAssertions,
        ...elementAssertions
      ],
      startTime: Date.now(),
      metadata: {
        url,
        viewport: await page.viewportSize() || { width: 1920, height: 1080 },
        userAgent: await page.evaluate('navigator.userAgent')
      }
    };

    const testScript = this.generateTestScript(recording, testName, 'playwright');
    const filename = `${testName}-regression.spec.js`;
    const filepath = join(this.testDir, filename);
    
    writeFileSync(filepath, testScript);

    return {
      content: [{
        type: 'text',
        text: `Regression test generated: ${filepath}\nIncluded ${recording.actions.length} assertions`
      }]
    };
  }

  private async generateTestSuite(args: any) {
    const { suiteName, testCases, format = 'playwright' } = args;
    
    // Read existing test files
    const suiteTests: string[] = [];
    
    for (const testCase of testCases) {
      const testFile = join(this.testDir, `${testCase}-${format}.spec.js`);
      if (existsSync(testFile)) {
        const content = require('fs').readFileSync(testFile, 'utf8');
        suiteTests.push(content);
      }
    }

    if (suiteTests.length === 0) {
      throw new Error('No valid test cases found');
    }

    const suiteContent = this.generateTestSuiteScript(suiteName, suiteTests, format);
    const filename = `${suiteName}-suite.spec.js`;
    const filepath = join(this.testDir, filename);
    
    writeFileSync(filepath, suiteContent);

    return {
      content: [{
        type: 'text',
        text: `Test suite generated: ${filepath}\nIncluded ${testCases.length} test cases`
      }]
    };
  }

  private async listTestRecordings() {
    const recordings = Array.from(this.recordings.entries()).map(([name, recording]) => ({
      name,
      sessionId: recording.sessionId,
      actionsCount: recording.actions.length,
      startTime: new Date(recording.startTime).toISOString(),
      url: recording.metadata.url
    }));

    const generatedTests = existsSync(this.testDir) 
      ? require('fs').readdirSync(this.testDir).filter((file: string) => file.endsWith('.spec.js'))
      : [];

    return {
      content: [{
        type: 'text',
        text: `Active Recordings:\n${JSON.stringify(recordings, null, 2)}\n\nGenerated Tests:\n${generatedTests.join('\n')}`
      }]
    };
  }

  private generateTestScript(recording: TestRecording, testName: string, format: string): string {
    const { actions, metadata } = recording;
    
    let script = '';
    
    switch (format) {
      case 'playwright':
        script = this.generatePlaywrightScript(testName, actions, metadata);
        break;
      case 'jest':
        script = this.generateJestScript(testName, actions, metadata);
        break;
      case 'mocha':
        script = this.generateMochaScript(testName, actions, metadata);
        break;
      default:
        script = this.generatePlaywrightScript(testName, actions, metadata);
    }

    return script;
  }

  private generatePlaywrightScript(testName: string, actions: TestAction[], metadata: any): string {
    const imports = `const { test, expect } = require('@playwright/test');\n\n`;
    
    const testHeader = `test('${testName}', async ({ page }) => {\n`;
    const testFooter = `});\n`;
    
    let testBody = `  // Set viewport\n  await page.setViewportSize({ width: ${metadata.viewport.width}, height: ${metadata.viewport.height} });\n\n`;
    
    for (const action of actions) {
      switch (action.type) {
        case 'navigate':
          testBody += `  // Navigate to page\n  await page.goto('${action.url}');\n\n`;
          break;
        case 'click':
          testBody += `  // Click element\n  await page.click('${action.selector}');\n\n`;
          break;
        case 'fill':
          testBody += `  // Fill input\n  await page.fill('${action.selector}', '${action.value}');\n\n`;
          break;
        case 'select':
          testBody += `  // Select option\n  await page.selectOption('${action.selector}', '${action.value}');\n\n`;
          break;
        case 'press':
          testBody += `  // Press key\n  await page.press('${action.selector}', '${action.value}');\n\n`;
          break;
        case 'wait':
          testBody += `  // Wait for element\n  await page.waitForSelector('${action.selector}');\n\n`;
          break;
        case 'assert':
          if (action.assertion) {
            switch (action.assertion.type) {
              case 'text':
                testBody += `  // Assert text content\n  await expect(page.locator('${action.selector}')).toHaveText('${action.assertion.expected}');\n\n`;
                break;
              case 'visible':
                testBody += `  // Assert element is visible\n  await expect(page.locator('${action.selector}')).toBeVisible();\n\n`;
                break;
              case 'url':
                testBody += `  // Assert URL\n  await expect(page).toHaveURL('${action.assertion.expected}');\n\n`;
                break;
              case 'title':
                testBody += `  // Assert page title\n  await expect(page).toHaveTitle('${action.assertion.expected}');\n\n`;
                break;
            }
          }
          break;
      }
    }
    
    return imports + testHeader + testBody + testFooter;
  }

  private generateJestScript(testName: string, actions: TestAction[], metadata: any): string {
    // Jest + Puppeteer style
    return `const puppeteer = require('puppeteer');

describe('${testName}', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch();
    page = await browser.newPage();
    await page.setViewport({ width: ${metadata.viewport.width}, height: ${metadata.viewport.height} });
  });

  afterAll(async () => {
    await browser.close();
  });

  test('${testName} test case', async () => {
${this.generateActionSteps(actions, '    ', 'jest')}
  });
});
`;
  }

  private generateMochaScript(testName: string, actions: TestAction[], metadata: any): string {
    return `const { Builder, By, until } = require('selenium-webdriver');
const assert = require('assert');

describe('${testName}', function() {
  let driver;

  before(async function() {
    driver = await new Builder().forBrowser('chrome').build();
    await driver.manage().window().setRect({ width: ${metadata.viewport.width}, height: ${metadata.viewport.height} });
  });

  after(async function() {
    await driver.quit();
  });

  it('${testName} test case', async function() {
${this.generateActionSteps(actions, '    ', 'mocha')}
  });
});
`;
  }

  private generateActionSteps(actions: TestAction[], indent: string, format: string): string {
    let steps = '';
    
    for (const action of actions) {
      switch (action.type) {
        case 'navigate':
          steps += format === 'jest' 
            ? `${indent}await page.goto('${action.url}');\n`
            : `${indent}await driver.get('${action.url}');\n`;
          break;
        case 'click':
          steps += format === 'jest'
            ? `${indent}await page.click('${action.selector}');\n`
            : `${indent}await driver.findElement(By.css('${action.selector}')).click();\n`;
          break;
        case 'fill':
          steps += format === 'jest'
            ? `${indent}await page.type('${action.selector}', '${action.value}');\n`
            : `${indent}await driver.findElement(By.css('${action.selector}')).sendKeys('${action.value}');\n`;
          break;
        case 'assert':
          if (action.assertion?.type === 'visible') {
            steps += format === 'jest'
              ? `${indent}await expect(page.$('${action.selector}')).resolves.toBeTruthy();\n`
              : `${indent}const element = await driver.findElement(By.css('${action.selector}'));\n${indent}assert(await element.isDisplayed());\n`;
          }
          break;
      }
    }
    
    return steps;
  }

  private generateTestSuiteScript(suiteName: string, testScripts: string[], format: string): string {
    return `// Test Suite: ${suiteName}
// Generated: ${new Date().toISOString()}
// Format: ${format}

${testScripts.join('\n\n')}
`;
  }

  // Setup console logging for a page
  private setupPageLogging(sessionId: string, pageId: string, page: Page) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Create log file stream
    const logFileName = `console-${sessionId}-${pageId}-${Date.now()}.log`;
    const logFilePath = join(this.logDir, logFileName);
    const logStream = createWriteStream(logFilePath, { flags: 'a' });
    
    // Store log stream reference
    session.logStreams.set(pageId, logStream);

    // Write header
    logStream.write(`=== Console Log Started: ${new Date().toISOString()} ===\n`);
    logStream.write(`Session: ${sessionId}, Page: ${pageId}\n`);
    logStream.write(`URL: ${page.url()}\n`);
    logStream.write(`${'='.repeat(50)}\n\n`);

    // Listen to console events
    page.on('console', msg => {
      const timestamp = new Date().toISOString();
      const type = msg.type().toUpperCase();
      const text = msg.text();
      const location = msg.location();
      
      // Format log entry
      let logEntry = `[${timestamp}] [${type}]`;
      if (location.url) {
        logEntry += ` [${location.url}:${location.lineNumber}:${location.columnNumber}]`;
      }
      logEntry += ` ${text}\n`;
      
      // Write to file stream
      logStream.write(logEntry);
    });

    // Listen to page errors
    page.on('pageerror', error => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] [ERROR] ${error.message}\n${error.stack || ''}\n`;
      logStream.write(logEntry);
    });

    // Listen to request failures
    page.on('requestfailed', request => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] [REQUEST_FAILED] ${request.failure()?.errorText} - ${request.url()}\n`;
      logStream.write(logEntry);
    });

    console.error(`Console logging enabled for session ${sessionId}, page ${pageId}: ${logFilePath}`);
  }

  // Close log streams for a session
  private closeLogStreams(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session && session.logStreams) {
      session.logStreams.forEach((stream, pageId) => {
        stream.write(`\n=== Console Log Ended: ${new Date().toISOString()} ===\n`);
        stream.end();
      });
      session.logStreams.clear();
    }
  }

  private getPage(sessionId: string, pageId: string): Page {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const page = session.pages.get(pageId);
    if (!page) {
      throw new Error(`Page ${pageId} not found in session ${sessionId}`);
    }

    return page;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Playwright MCP server v1.1.0 running with resource management');
  }
}

const server = new PlaywrightMCPServer();
server.run().catch(console.error);