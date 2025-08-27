#!/usr/bin/env node

/**
 * Test Electron with Playwright directly
 */

const { _electron: electron } = require('playwright');
const path = require('path');
const os = require('os');

async function testElectronApp() {
  console.log('🚀 Testing Electron with Playwright');
  console.log(`Platform: ${os.platform()}`);
  
  try {
    // Setup Xvfb for Linux headless
    if (os.platform() === 'linux' && !process.env.DISPLAY) {
      console.log('📺 Setting up headless display for Linux...');
      process.env.DISPLAY = ':99';
      // Note: Xvfb should be running: Xvfb :99 -screen 0 1920x1080x24 &
    }

    console.log('🔧 Launching Electron app...');
    
    const electronApp = await electron.launch({
      executablePath: path.join(__dirname, 'node_modules/electron/dist/electron'),
      args: [path.join(__dirname, 'simple-electron-app.js')],
      env: {
        ...process.env,
        // Linux headless settings
        ...(os.platform() === 'linux' ? {
          ELECTRON_NO_SANDBOX: '1',
          ELECTRON_DISABLE_GPU: '1'
        } : {})
      }
    });
    
    console.log('✅ Electron app launched');

    // Get app info
    const appInfo = await electronApp.evaluate(async ({ app }) => {
      return {
        name: app.getName(),
        version: app.getVersion(),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        platform: process.platform
      };
    });
    
    console.log('📊 App Information:', appInfo);

    // Wait for window
    const window = await electronApp.firstWindow();
    console.log('📱 Window opened');
    
    // Get window title
    const title = await window.title();
    console.log(`Window title: ${title}`);

    // Take screenshot
    const screenshotPath = `electron-screenshot-${Date.now()}.png`;
    await window.screenshot({ path: screenshotPath });
    console.log(`📸 Screenshot saved: ${screenshotPath}`);

    // Get window content
    const content = await window.evaluate(() => document.body.innerText);
    console.log('📄 Window content:', content);

    // Test window state
    const windowState = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return null;
      
      return {
        bounds: win.getBounds(),
        isVisible: win.isVisible(),
        isFocused: win.isFocused()
      };
    });
    console.log('🪟 Window state:', windowState);

    // Close app
    await electronApp.close();
    console.log('✅ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (os.platform() === 'linux' && !process.env.DISPLAY) {
      console.log('\n💡 For Linux headless testing:');
      console.log('1. Start Xvfb: Xvfb :99 -screen 0 1920x1080x24 &');
      console.log('2. Export DISPLAY: export DISPLAY=:99');
    }
    process.exit(1);
  }
}

// Check platform support
function checkPlatform() {
  const platform = os.platform();
  console.log(`✅ Running on ${platform}`);
  
  if (platform === 'linux' && !process.env.DISPLAY) {
    console.warn('⚠️  No DISPLAY set, will attempt headless mode');
  }
}

// Main
console.log('========================================');
console.log('   Electron Playwright Test');
console.log('========================================\n');

checkPlatform();
testElectronApp().catch(console.error);