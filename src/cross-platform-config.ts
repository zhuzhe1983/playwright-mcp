/**
 * Cross-platform Electron testing configuration
 */

export interface PlatformConfig {
  platform: 'linux' | 'darwin' | 'win32';
  headless: boolean;
  displayServer?: 'xvfb' | 'xorg' | 'wayland';
  env: Record<string, string>;
}

export class CrossPlatformTester {
  /**
   * Get platform-specific configuration
   */
  static getPlatformConfig(targetPlatform?: string): PlatformConfig {
    const platform = (targetPlatform || process.platform) as 'linux' | 'darwin' | 'win32';
    
    switch (platform) {
      case 'linux':
        return this.getLinuxConfig();
      case 'darwin':
        return this.getMacConfig();
      case 'win32':
        return this.getWindowsConfig();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Linux configuration (for headless servers)
   */
  private static getLinuxConfig(): PlatformConfig {
    // Check if running in CI/headless environment
    const isHeadless = !process.env.DISPLAY || process.env.CI === 'true';
    
    return {
      platform: 'linux',
      headless: true,
      displayServer: 'xvfb',
      env: {
        // Use Xvfb for headless display
        DISPLAY: isHeadless ? ':99' : process.env.DISPLAY || ':0',
        // Electron specific
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_NO_SANDBOX: '1',
        // Disable GPU for better compatibility
        ELECTRON_DISABLE_GPU: '1',
        // Required for headless
        ELECTRON_RUN_AS_NODE: isHeadless ? '1' : '0'
      }
    };
  }

  /**
   * macOS configuration
   */
  private static getMacConfig(): PlatformConfig {
    return {
      platform: 'darwin',
      headless: false, // macOS doesn't support true headless
      env: {
        // macOS specific settings
        ELECTRON_ENABLE_LOGGING: '1',
        // Allow automation
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
      }
    };
  }

  /**
   * Windows configuration
   */
  private static getWindowsConfig(): PlatformConfig {
    return {
      platform: 'win32',
      headless: false, // Windows headless is limited
      env: {
        // Windows specific
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_NO_SANDBOX: '1'
      }
    };
  }

  /**
   * Setup Xvfb for Linux headless testing
   */
  static async setupXvfb(): Promise<void> {
    if (process.platform !== 'linux') {
      return;
    }

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // Check if Xvfb is installed
      await execAsync('which Xvfb');
      
      // Start Xvfb on display :99
      await execAsync('Xvfb :99 -screen 0 1920x1080x24 > /dev/null 2>&1 &');
      
      // Wait for Xvfb to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Set DISPLAY environment variable
      process.env.DISPLAY = ':99';
      
      console.log('Xvfb started on display :99');
    } catch (error) {
      console.warn('Xvfb not available, running in native mode');
    }
  }

  /**
   * Install platform-specific dependencies
   */
  static getInstallInstructions(platform: string): string {
    switch (platform) {
      case 'linux':
        return `
# Linux (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y xvfb libgtk-3-0 libgbm-dev libnotify-dev \
  libgconf-2-4 libnss3 libxss1 libasound2 libxtst6 xauth xvfb

# For headless testing
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 &
`;

      case 'darwin':
        return `
# macOS
# No additional dependencies needed
# Electron apps can be tested directly
`;

      case 'win32':
        return `
# Windows
# No additional dependencies needed
# Note: Windows doesn't support true headless mode
`;

      default:
        return 'Unsupported platform';
    }
  }

  /**
   * Docker configuration for cross-platform testing
   */
  static getDockerConfig(): string {
    return `
# Dockerfile for Electron testing
FROM mcr.microsoft.com/playwright:v1.40.0-focal

# Install Electron dependencies
RUN apt-get update && apt-get install -y \\
    xvfb \\
    libgtk-3-0 \\
    libgbm-dev \\
    libnotify-dev \\
    libgconf-2-4 \\
    libnss3 \\
    libxss1 \\
    libasound2 \\
    libxtst6 \\
    xauth

# Setup Xvfb
ENV DISPLAY=:99
RUN Xvfb :99 -screen 0 1920x1080x24 > /dev/null 2>&1 &

WORKDIR /app

# Copy your Electron app
COPY . .

# Install dependencies
RUN npm install

# Run tests
CMD ["npm", "test"]
`;
  }

  /**
   * GitHub Actions configuration for CI/CD
   */
  static getGitHubActionsConfig(): string {
    return `
name: Electron Cross-Platform Tests

on: [push, pull_request]

jobs:
  test-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: |
          export DISPLAY=:99
          Xvfb :99 -screen 0 1920x1080x24 > /dev/null 2>&1 &
          npm test

  test-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test

  test-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
`;
  }
}