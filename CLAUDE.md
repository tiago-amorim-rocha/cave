# iOS Game Template

## Overview
This is a template repository optimized for building web games for iOS devices. Designed to run as a PWA (Progressive Web App) via "Add to Home Screen" in Safari. Includes GitHub Pages deployment, cache busting, and iOS-specific optimizations for safe areas, keyboard handling, and touch interactions.

## Features

### 1. Auto-promotion Workflow
- **File**: `.github/workflows/autopromote.yml`
- Automatically merges `claude/**` branches into `main` when pushed
- Enables seamless CI/CD workflow with Claude Code
- ✅ **Copied with template** - Works immediately in new repos (requires Actions enabled)

### 2. Branch Cleanup Workflow
- **File**: `.github/workflows/cleanup-old-branches.yml`
- Runs daily at 3am UTC to delete old `claude/**` branches
- Only deletes branches older than 24 hours
- Keeps your repository clean from stale Claude Code branches
- Can be triggered manually via GitHub Actions UI
- ✅ **Copied with template** - Works immediately in new repos (requires Actions enabled)

### 3. Auto-version Update Workflow
- **File**: `.github/workflows/version-on-main.yml`
- Automatically updates `version.txt` when commits are pushed to `main`
- Runs server-side via GitHub Actions (no local setup required)
- Prevents sync issues with autopromote workflow
- Eliminates need for local git hooks
- ✅ **Copied with template** - Works immediately in new repos (requires Actions enabled)

### 4. Cache Busting System
- **File**: `version.txt` - Contains timestamp for cache invalidation
- **Implementation**: `index.html` - Auto-versioned module loader
- Ensures browsers always load the latest version of modules
- Uses `?v=<timestamp>` query parameter on module imports

### 5. In-Page Debug Console
- **File**: `console.js` - Debug console module
- Floating 🐛 button in bottom-right corner
- Captures console.log, console.info, console.debug, console.warn, console.error
- Displays messages with timestamps and color coding
- Keeps last 100 messages in history
- Useful for debugging on mobile devices or when DevTools isn't available

### 6. Auto-Reload on Version Change
- **Implementation**: `main.js` - Periodic version checking
- Automatically detects when a new version is deployed
- Checks `version.txt` every 2 seconds for updates
- Shows a 🔄 reload button (left of debug console) when new version detected
- Button pulses to draw attention to available update
- Click to force reload and get the latest version
- Perfect for PWA users who may not refresh the page regularly

### 7. iOS Game Optimizations
- **PWA Support**: manifest.json for "Add to Home Screen" functionality
- **Safe Area Handling**: Automatic padding for notch, home indicator, and device edges
- **Keyboard Protection**: Fixed viewport prevents keyboard from resizing game area
- **Touch Optimizations**:
  - Disabled double-tap zoom (`touch-action: manipulation`)
  - Disabled text selection and callouts
  - Disabled tap highlights
  - Prevented pull-to-refresh
- **Fullscreen Mode**: Runs standalone without Safari UI when launched from home screen

## How It Works

### iOS Safe Areas
The template uses CSS `env(safe-area-inset-*)` to respect device safe areas:
- **Notch area** (top)
- **Home indicator** (bottom)
- **Screen edges** (left/right on landscape)

All UI elements (including debug console) are positioned with safe area awareness.

### Keyboard Handling
Using `position: fixed` on html/body prevents the virtual keyboard from resizing the viewport. The game canvas remains at full size even when the keyboard appears.

### Cache Busting
The `index.html` includes a script that:
1. Fetches `version.txt` (bypassing cache)
2. Uses the version to append `?v=<version>` to module imports
3. Falls back to `Date.now()` if version.txt is unavailable

Example:
```javascript
// Loads: ./main.js?v=1761844854000
const s = document.createElement('script');
s.type = 'module';
s.src = `./main.js?v=${encodeURIComponent(version)}`;
document.head.appendChild(s);
```

### Auto-Reload on Version Change
The `main.js` module implements automatic version detection:
1. Stores the initial version from `window.__BUILD` on page load
2. Periodically checks `version.txt` every 2 seconds (configurable via `VERSION_CHECK_INTERVAL`)
3. Compares the fetched version with the current version
4. When a mismatch is detected, shows a reload button to the left of the debug console
5. User clicks the 🔄 button to force reload and get the latest version

This is especially useful for PWA installations where users may keep the app open for extended periods without refreshing. The button appears automatically when a new deployment is detected.

**Overhead:** The overhead is minimal - version.txt is a tiny file (~20 bytes) and the fetch happens in the background. The network usage is negligible compared to typical game assets, rendering, and animations.

### Automatic Version Updates
The `version-on-main.yml` workflow automatically updates `version.txt` whenever commits are pushed to the `main` branch:

**How it works:**
- Triggers automatically on any push to `main` (including autopromote merges)
- Generates a fresh timestamp in milliseconds
- Updates `version.txt` with the new timestamp
- Commits and pushes the update back to `main`
- Only commits if `version.txt` actually changed

**Benefits:**
- ✅ No local setup required - works out of the box
- ✅ Prevents sync issues with autopromote workflow (no need to pull after merges)
- ✅ Works for all contributors without manual hook installation
- ✅ Consistent and reliable server-side execution
- ✅ Cleaner workflow with fewer failed pushes and pulls

## Usage

### As a Template

**What Gets Copied:**
- ✅ All code files and folder structure
- ✅ GitHub Actions workflows (`.github/workflows/`)
- ✅ All configuration files

**What Doesn't Get Copied:**
- ❌ Repository settings (branch protection, secrets, etc.)
- ❌ Issues, PRs, releases, discussions

**Setup Steps:**
1. Click "Use this template" to create a new repository
2. Clone your new repository
3. Enable GitHub Actions if they're disabled (should be enabled by default)
4. Update this CLAUDE.md with project-specific details
5. Edit `main.js` to build your application (or add more modules)
6. The cache busting, autopromote, and auto-version workflows are ready to use

### Deployment
1. Enable GitHub Pages in repository settings
2. Set source to "Deploy from a branch" (select main branch)
3. Push to `main` to deploy
4. On iOS: Open in Safari → Share → Add to Home Screen
5. Launch from home screen for fullscreen PWA experience

## Customization

### Update Metadata
- Change page title and app name in `index.html` and `manifest.json`
- Replace `icon-512.svg` with your game's icon
- Update this CLAUDE.md with your project architecture

### Add Modules
The template includes `main.js` as a starter file. To add more modules:

1. Create your module file (e.g., `utils.js`)
2. Import it in `main.js`:
   ```javascript
   import { myFunction } from './utils.js';
   ```

Note: Only `main.js` needs explicit cache busting in `index.html`. Other modules imported via ES6 `import` inherit the cache-busted URL automatically.

### Debug Console
Click the 🐛 button in the bottom-right corner to open the debug console. All console output (log, info, debug, warn, error) will be captured and displayed here. This is especially useful for:
- Debugging on mobile devices
- When browser DevTools aren't available
- Quick in-page console access during development

To disable the console in production, simply remove the `console.js` import and initialization from `main.js`.

## Structure
```
.
├── .github/workflows/
│   ├── autopromote.yml           # Auto-merge claude/** branches
│   ├── cleanup-old-branches.yml  # Daily cleanup of old claude branches
│   └── version-on-main.yml       # Auto-update version.txt on main commits
├── .gitignore                    # Git ignore patterns
├── CLAUDE.md                     # This file - project context for Claude
├── index.html                    # Entry point with iOS optimizations
├── main.js                       # Main application module (starter file)
├── console.js                    # In-page debug console
├── manifest.json                 # PWA manifest for iOS home screen
├── icon-512.svg                  # App icon (replace with your own)
└── version.txt                   # Build version timestamp
```
