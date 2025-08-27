#!/usr/bin/env node

/**
 * Simple Electron test using Playwright
 * This tests the Electron integration in the MCP server
 */

const { _electron: electron } = require('playwright');
const path = require('path');
const os = require('os');

async function testElectronBasic() {
  console.log('🚀 Starting Simple Electron Test');
  console.log(`Platform: ${os.platform()}`);
  console.log(`Architecture: ${os.arch()}`);
  
  // Use Electron Calculator app as a simple test
  // This is a built-in app on many systems or we can use any Electron app
  try {
    console.log('🔧 Launching Electron with default executable...');
    
    // Launch with electron command (assumes electron is installed globally)
    // You can replace this with path to any Electron app
    const electronApp = await electron.launch({
      executablePath: 'electron', // Will use system electron
      args: [], // Empty args will show Electron default window
      env: {
        ...process.env,
        // Linux headless settings
        ...(os.platform() === 'linux' ? {
          ELECTRON_NO_SANDBOX: '1',
          ELECTRON_DISABLE_GPU: '1'
        } : {})
      }
    });
    
    console.log('✅ Electron app launched successfully');

    // Get app information
    const appInfo = await electronApp.evaluate(async ({ app }) => {
      return {
        name: app.getName(),
        version: app.getVersion(),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        platform: process.platform
      };
    });
    
    console.log('📊 Electron App Information:');
    console.log(JSON.stringify(appInfo, null, 2));

    // Wait a bit to see if window opens
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Try to get the first window
    try {
      const window = await electronApp.firstWindow({ timeout: 5000 });
      if (window) {
        console.log('📱 Window opened successfully');
        
        // Take a screenshot
        await window.screenshot({ 
          path: `electron-test-${os.platform()}.png` 
        });
        console.log('📸 Screenshot saved');
      }
    } catch (e) {
      console.log('ℹ️  No window opened (running in headless mode or no UI)');
    }

    // Test main process evaluation
    const memoryInfo = await electronApp.evaluate(() => {
      return process.memoryUsage();
    });
    console.log('💾 Memory usage:', {
      heapUsed: `${Math.round(memoryInfo.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(memoryInfo.external / 1024 / 1024)}MB`
    });

    // Close the app
    await electronApp.close();
    console.log('✅ Test completed successfully');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n💡 Tips:');
    console.log('1. Install Electron globally: npm install -g electron');
    console.log('2. Or provide path to an Electron app');
    console.log('3. For Linux headless, ensure Xvfb is running');
    process.exit(1);
  }
}

// Run the test
console.log('========================================');
console.log('   Simple Electron Test');
console.log('========================================\n');

testElectronBasic().catch(console.error);