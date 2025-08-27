# Playwright MCP Server

An MCP (Model Context Protocol) server that provides browser automation capabilities using Playwright. Control browsers, automate web interactions, test web applications, and generate test scripts - all through Claude Desktop or any MCP-compatible client.

## Features

### 🌐 Browser Automation
- Launch and control headless or visible Chrome browsers
- Navigate, click, fill forms, take screenshots
- Execute JavaScript in page context
- Handle multiple browser sessions simultaneously
- Automatic resource cleanup and memory management

### 🖥️ Electron App Testing
- Launch and control Electron applications
- Execute code in main and renderer processes
- Take screenshots of desktop apps
- Get app information and window states

### 🧪 Test Generation
- Record user interactions for test generation
- Generate Playwright, Jest, or Mocha test scripts
- Create regression tests from current page state
- Build comprehensive test suites

### 🔧 Resource Management (v1.1.0)
- Automatic session timeout (30 minutes by default)
- Memory usage monitoring and cleanup
- Zombie process detection and removal
- Graceful shutdown handling

## Installation

### Prerequisites

- Node.js 18 or higher
- Claude Desktop or any MCP-compatible client

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/playwright-mcp.git
cd playwright-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the TypeScript code:
```bash
npm run build
```

## Configuration

### For Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "node",
      "args": ["/path/to/playwright-mcp/dist/index.js"]
    }
  }
}
```

### For Claude Code

Add to your settings file:

```json
{
  "mcp": {
    "servers": {
      "playwright": {
        "command": "node",
        "args": ["/path/to/playwright-mcp/dist/index.js"]
      }
    }
  }
}
```

## Usage

### Browser Automation

```javascript
// Launch a browser
browser_launch({
  sessionId: "my-session",
  headless: true,
  viewport: { width: 1920, height: 1080 }
})

// Navigate to a URL
page_navigate({
  sessionId: "my-session",
  url: "https://example.com"
})

// Take a screenshot
page_screenshot({
  sessionId: "my-session",
  fullPage: true,
  filename: "screenshot.png"
})

// Fill a form
page_fill({
  sessionId: "my-session",
  selector: "#username",
  value: "user@example.com"
})

// Click a button
page_click({
  sessionId: "my-session",
  selector: "#submit-button"
})

// Close the browser
browser_close({
  sessionId: "my-session"
})
```

### Test Generation

```javascript
// Start recording
test_start_recording({
  sessionId: "my-session",
  testName: "login-test"
})

// Perform actions...

// Stop and generate test
test_stop_recording({
  sessionId: "my-session",
  format: "playwright"
})
```

### Resource Management

```javascript
// Get session statistics
session_stats()

// Close all browsers and cleanup
browser_close_all()
```

## Available Tools

### Browser Management
- `browser_launch` - Launch a new browser instance
- `browser_close` - Close a browser session
- `browser_close_all` - Close all sessions and cleanup
- `list_sessions` - List active sessions
- `session_stats` - Get resource usage statistics

### Page Interactions
- `page_navigate` - Navigate to URL
- `page_click` - Click an element
- `page_fill` - Fill form fields
- `page_press` - Press keyboard keys
- `page_select` - Select dropdown options
- `page_evaluate` - Execute JavaScript
- `page_wait_for_selector` - Wait for elements
- `page_get_content` - Get HTML content
- `page_get_text` - Get element text
- `page_screenshot` - Take screenshots

### Electron Support
- `electron_launch` - Launch Electron app
- `electron_close` - Close Electron app
- `electron_evaluate_main` - Execute in main process
- `electron_evaluate_renderer` - Execute in renderer
- `electron_get_info` - Get app information
- `electron_window_state` - Get window state
- `electron_screenshot` - Take app screenshot

### Test Generation
- `test_start_recording` - Start recording actions
- `test_stop_recording` - Stop and generate test
- `test_generate_regression` - Generate regression test
- `test_generate_suite` - Create test suite
- `test_list_recordings` - List recordings

## Configuration Options

Environment variables:
- `SESSION_TIMEOUT` - Session timeout in milliseconds (default: 1800000)
- `CLEANUP_INTERVAL` - Cleanup check interval (default: 300000)
- `MAX_MEMORY_MB` - Maximum memory usage (default: 2048)

## Examples

### Web Scraping
```javascript
// Launch browser and scrape data
browser_launch({ sessionId: "scraper" })
page_navigate({ sessionId: "scraper", url: "https://news.site.com" })
page_evaluate({ 
  sessionId: "scraper", 
  script: "Array.from(document.querySelectorAll('.headline')).map(h => h.textContent)"
})
browser_close({ sessionId: "scraper" })
```

### Form Testing
```javascript
// Test a login form
browser_launch({ sessionId: "form-test" })
page_navigate({ sessionId: "form-test", url: "https://app.com/login" })
page_fill({ sessionId: "form-test", selector: "#email", value: "test@example.com" })
page_fill({ sessionId: "form-test", selector: "#password", value: "password123" })
page_click({ sessionId: "form-test", selector: "#login-button" })
page_wait_for_selector({ sessionId: "form-test", selector: ".dashboard" })
page_screenshot({ sessionId: "form-test", filename: "login-success.png" })
browser_close({ sessionId: "form-test" })
```

## Development

### Building from source
```bash
npm run build
```

### Running in development mode
```bash
npm run dev
```

### Running tests
```bash
npm test
```

## Troubleshooting

### Browser won't launch
- Ensure Chrome/Chromium is installed
- Check if running in Docker/WSL (may need additional flags)

### High memory usage
- Reduce `MAX_MEMORY_MB` setting
- Ensure sessions are properly closed
- Use `browser_close_all()` to cleanup

### Zombie processes
- The server automatically cleans up zombie processes
- Manual cleanup: `pkill -f "headless_shell"`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built on [Playwright](https://playwright.dev/) for browser automation
- Implements the [Model Context Protocol](https://modelcontextprotocol.io/)
- Designed for [Claude Desktop](https://claude.ai/) integration

## Author

zhuzhe

## Links

- [GitHub Repository](https://github.com/yourusername/playwright-mcp)
- [Issues](https://github.com/yourusername/playwright-mcp/issues)
- [MCP Documentation](https://modelcontextprotocol.io/)