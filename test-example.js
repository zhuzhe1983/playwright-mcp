#!/usr/bin/env node

/**
 * Test script for Playwright MCP
 * This demonstrates how the MCP tools would be used in practice
 */

// Example test sequence that would be executed through Claude:

const testSequence = [
  {
    step: 1,
    description: "Launch browser in headless mode",
    tool: "browser_launch",
    arguments: {
      sessionId: "test-session",
      headless: true,
      viewport: {
        width: 1920,
        height: 1080
      }
    }
  },
  {
    step: 2,
    description: "Navigate to Google",
    tool: "page_navigate",
    arguments: {
      sessionId: "test-session",
      url: "https://www.google.com",
      waitUntil: "networkidle"
    }
  },
  {
    step: 3,
    description: "Wait for search box",
    tool: "page_wait_for_selector",
    arguments: {
      sessionId: "test-session",
      selector: "textarea[name='q']",
      timeout: 5000
    }
  },
  {
    step: 4,
    description: "Type search query",
    tool: "page_fill",
    arguments: {
      sessionId: "test-session",
      selector: "textarea[name='q']",
      value: "Playwright automation"
    }
  },
  {
    step: 5,
    description: "Press Enter to search",
    tool: "page_press",
    arguments: {
      sessionId: "test-session",
      key: "Enter"
    }
  },
  {
    step: 6,
    description: "Wait for results",
    tool: "page_wait_for_selector",
    arguments: {
      sessionId: "test-session",
      selector: "#search",
      timeout: 10000
    }
  },
  {
    step: 7,
    description: "Take screenshot of results",
    tool: "page_screenshot",
    arguments: {
      sessionId: "test-session",
      fullPage: false,
      filename: "google-search-results.png"
    }
  },
  {
    step: 8,
    description: "Get page title",
    tool: "page_evaluate",
    arguments: {
      sessionId: "test-session",
      script: "document.title"
    }
  },
  {
    step: 9,
    description: "Close browser",
    tool: "browser_close",
    arguments: {
      sessionId: "test-session"
    }
  }
];

console.log("Playwright MCP Test Sequence");
console.log("=============================\n");

console.log("This test sequence demonstrates how to:");
console.log("1. Launch a headless browser");
console.log("2. Navigate to Google");
console.log("3. Perform a search");
console.log("4. Take a screenshot");
console.log("5. Extract page information");
console.log("6. Clean up resources\n");

console.log("Test Steps:");
console.log("-----------");

testSequence.forEach(test => {
  console.log(`\nStep ${test.step}: ${test.description}`);
  console.log(`Tool: ${test.tool}`);
  console.log("Arguments:", JSON.stringify(test.arguments, null, 2));
});

console.log("\n\nTo run this test through Claude:");
console.log("1. Make sure Claude Desktop is restarted to load the new MCP server");
console.log("2. Ask Claude to execute each tool in sequence");
console.log("3. Screenshots will be saved to the screenshots/ directory");

console.log("\n\nExample Claude prompt:");
console.log("\"Use the Playwright MCP to search Google for 'Playwright automation' and take a screenshot of the results\"");