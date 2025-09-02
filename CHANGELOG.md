# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-01-02

### Added
- 🎯 **Console Logging**: Real-time capture of browser console output to `playwright/log/` directory
  - Captures all console methods (log, info, warn, error, debug)
  - Includes timestamps and source code locations
  - Logs page errors with stack traces
  - Records failed network requests
  - Supports streaming with `tail -f` for live monitoring
- 📁 **Improved Directory Structure**: Organized file management under `playwright/` base directory
  - `playwright/screenshot/` - Screenshot storage
  - `playwright/test/` - Generated test files
  - `playwright/log/` - Console logs (NEW)

### Changed
- Directory structure moved from flat layout to organized hierarchy
- Screenshots now saved to `playwright/screenshot/` instead of `screenshots/`
- Generated tests now saved to `playwright/test/` instead of `generated-tests/`

### Technical Improvements
- Added `WriteStream` support for efficient log streaming
- Automatic log stream setup for each browser session
- Proper cleanup of log streams on session close
- Enhanced session management with log stream tracking

## [1.0.0] - 2025-01-02

### Initial Release
- Browser automation with Playwright
- Screenshot capture capabilities
- Test recording and generation
- Electron application support
- Session management with timeout and cleanup
- Support for multiple concurrent sessions
- Test suite generation from recordings