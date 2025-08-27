#!/usr/bin/env node

/**
 * Electron Cross-Platform Testing Example
 * 
 * This demonstrates how to test Electron apps on different platforms
 */

const { _electron: electron } = require('playwright');
const path = require('path');
const os = require('os');

async function testElectronApp() {
  console.log('🚀 Starting Electron Test');
  console.log(`Platform: ${os.platform()}`);
  console.log(`Architecture: ${os.arch()}`);
  
  // Platform-specific configuration
  const isLinux = os.platform() === 'linux';
  const isMac = os.platform() === 'darwin';
  const isWindows = os.platform() === 'win32';
  
  // Setup headless display for Linux
  if (isLinux && !process.env.DISPLAY) {
    console.log('📺 Setting up headless display for Linux...');
    process.env.DISPLAY = ':99';
    // In production, you'd start Xvfb here
    // exec('Xvfb :99 -screen 0 1920x1080x24 &');
  }

  // Example paths for different platforms
  const electronPaths = {
    linux: path.join(__dirname, 'node_modules/electron/dist/electron'),
    darwin: '/path/to/your/electron/app/dist/mac/Electron.app/Contents/MacOS/Electron',
    win32: 'C:\\path\\to\\your\\electron\\app\\dist\\win-unpacked\\electron.exe'
  };

  // Launch configuration
  const launchOptions = {
    // Use your actual Electron app path
    executablePath: electronPaths[os.platform()] || 'electron',
    args: [path.join(__dirname, 'simple-electron-app.js')],
    env: {
      ...process.env,
      // Platform-specific environment variables
      ...(isLinux ? {
        ELECTRON_NO_SANDBOX: '1',
        ELECTRON_DISABLE_GPU: '1'
      } : {}),
      ...(isMac ? {
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
      } : {})
    }
  };

  try {
    console.log('🔧 Launching Electron app...');
    const electronApp = await electron.launch(launchOptions);
    
    console.log('✅ Electron app launched successfully');

    // Wait for the first window
    const window = await electronApp.firstWindow();
    console.log(`📱 Window title: ${await window.title()}`);

    // Get app information
    const appInfo = await electronApp.evaluate(async ({ app }) => {
      return {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node
      };
    });
    
    console.log('📊 App Information:', appInfo);

    // Example tests
    console.log('🧪 Running tests...');
    
    // Test 1: Check if window is visible
    const isVisible = await window.isVisible();
    console.log(`  ✓ Window visibility: ${isVisible}`);

    // Test 2: Take a screenshot
    await window.screenshot({ 
      path: `electron-test-${os.platform()}.png` 
    });
    console.log(`  ✓ Screenshot saved`);

    // Test 3: Interact with the app
    // Example: Click a button if it exists
    try {
      await window.click('button#start', { timeout: 5000 });
      console.log('  ✓ Clicked start button');
    } catch (e) {
      console.log('  ℹ Start button not found (expected in demo)');
    }

    // Test 4: Check main process
    const mainProcessInfo = await electronApp.evaluate(() => {
      return {
        platform: process.platform,
        arch: process.arch,
        memory: process.memoryUsage()
      };
    });
    console.log('  ✓ Main process check:', mainProcessInfo.platform);

    // Close the app
    await electronApp.close();
    console.log('✅ Tests completed successfully');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Platform compatibility check
function checkPlatformSupport() {
  const platform = os.platform();
  const supported = ['linux', 'darwin', 'win32'];
  
  if (!supported.includes(platform)) {
    console.error(`❌ Platform ${platform} is not supported`);
    process.exit(1);
  }

  console.log(`✅ Platform ${platform} is supported`);
  
  // Linux-specific checks
  if (platform === 'linux') {
    if (!process.env.DISPLAY && !process.env.CI) {
      console.warn('⚠️  No DISPLAY variable set. Will attempt headless mode.');
      console.log('💡 Tip: Install Xvfb for headless testing:');
      console.log('   sudo apt-get install xvfb');
      console.log('   Xvfb :99 -screen 0 1920x1080x24 &');
      console.log('   export DISPLAY=:99');
    }
  }
}

// Docker support
function getDockerCommand() {
  return `
# Run Electron tests in Docker (Linux only)
docker run --rm -it \\
  -v $(pwd):/app \\
  -e DISPLAY=:99 \\
  mcr.microsoft.com/playwright:v1.40.0-focal \\
  bash -c "Xvfb :99 -screen 0 1920x1080x24 & npm test"
`;
}

// Main execution
console.log('========================================');
console.log('   Electron Cross-Platform Tester');
console.log('========================================\n');

checkPlatformSupport();

// Show Docker option for non-Linux platforms
if (os.platform() !== 'linux') {
  console.log('\n💡 Tip: You can test Linux behavior using Docker:');
  console.log(getDockerCommand());
}

// Run the test
testElectronApp().catch(console.error);