import { _electron as electron, ElectronApplication, Page } from 'playwright';
import { existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';

interface ElectronSession {
  app: ElectronApplication;
  mainWindow: Page;
  executablePath: string;
}

export class ElectronManager {
  private sessions: Map<string, ElectronSession> = new Map();

  /**
   * Launch Electron application
   */
  async launchElectron(args: {
    sessionId: string;
    executablePath?: string;
    appPath?: string;
    args?: string[];
    env?: Record<string, string>;
    headless?: boolean;
  }) {
    const { 
      sessionId, 
      executablePath, 
      appPath,
      args: electronArgs = [],
      env = {},
      headless = true 
    } = args;

    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    // Determine executable path based on platform
    let electronPath = executablePath;
    
    if (!electronPath && appPath) {
      // Auto-detect based on common patterns
      electronPath = this.findElectronExecutable(appPath);
    }

    if (!electronPath || !existsSync(electronPath)) {
      throw new Error(`Electron executable not found: ${electronPath}`);
    }

    // Launch Electron with Playwright
    const app = await electron.launch({
      executablePath: electronPath,
      args: electronArgs,
      env: {
        ...process.env,
        ...env,
        // Force headless mode for Linux servers
        ...(headless && platform() === 'linux' ? {
          DISPLAY: '',
          ELECTRON_RUN_AS_NODE: '1'
        } : {})
      }
    });

    // Wait for the first window
    const mainWindow = await app.firstWindow();
    
    // Store session
    this.sessions.set(sessionId, {
      app,
      mainWindow,
      executablePath: electronPath
    });

    return {
      sessionId,
      platform: platform(),
      executablePath: electronPath,
      windowTitle: await mainWindow.title()
    };
  }

  /**
   * Find Electron executable based on common patterns
   */
  private findElectronExecutable(appPath: string): string {
    const patterns = {
      linux: [
        'dist/linux-unpacked/electron',
        'dist/linux-unpacked/app',
        'out/*/electron',
        'electron'
      ],
      darwin: [
        'dist/mac/Contents/MacOS/Electron',
        'dist/mac-universal/Contents/MacOS/Electron',
        'out/*/Electron.app/Contents/MacOS/Electron',
        'Electron.app/Contents/MacOS/Electron'
      ],
      win32: [
        'dist\\win-unpacked\\electron.exe',
        'dist\\electron.exe',
        'out\\*\\electron.exe',
        'electron.exe'
      ]
    };

    const currentPlatform = platform() as 'linux' | 'darwin' | 'win32';
    const platformPatterns = patterns[currentPlatform] || patterns.linux;

    for (const pattern of platformPatterns) {
      const fullPath = join(appPath, pattern);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }

    throw new Error(`Could not find Electron executable in ${appPath}`);
  }

  /**
   * Execute JavaScript in Electron main process
   */
  async evaluateInMain(sessionId: string, expression: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return await session.app.evaluate(expression);
  }

  /**
   * Execute JavaScript in renderer process
   */
  async evaluateInRenderer(sessionId: string, expression: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return await session.mainWindow.evaluate(expression);
  }

  /**
   * Get Electron app info
   */
  async getAppInfo(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const appInfo = await session.app.evaluate(async ({ app }) => {
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

    return appInfo;
  }

  /**
   * Close Electron application
   */
  async closeElectron(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    await session.app.close();
    this.sessions.delete(sessionId);
  }

  /**
   * Get window state
   */
  async getWindowState(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
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

    return state;
  }

  /**
   * Control window
   */
  async controlWindow(sessionId: string, action: 'maximize' | 'minimize' | 'restore' | 'close') {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    await session.app.evaluate(async ({ BrowserWindow }, action) => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return;
      
      switch (action) {
        case 'maximize':
          win.maximize();
          break;
        case 'minimize':
          win.minimize();
          break;
        case 'restore':
          win.restore();
          break;
        case 'close':
          win.close();
          break;
      }
    }, action);
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): ElectronSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all sessions
   */
  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }
}