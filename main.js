// Main application entry point
// This file is loaded with cache busting via index.html

import * as debugConsole from './console.js';

// Version checking configuration
const VERSION_CHECK_INTERVAL = 2000; // Check every 2 seconds
let currentVersion = window.__BUILD || 'unknown';
let checkCounter = 0;

// Check for version updates
async function checkForUpdates() {
  try {
    checkCounter++;
    const res = await fetch('./version.txt', { cache: 'no-store' });
    if (!res.ok) return;

    const latestVersion = (await res.text()).trim();

    // Log every 10 checks
    if (checkCounter % 10 === 0) {
      console.log(`✅ Version check #${checkCounter}: current=${currentVersion}, latest=${latestVersion}`);
    }

    if (latestVersion !== currentVersion) {
      console.log('🔄 New version detected!', { current: currentVersion, latest: latestVersion });
      showReloadButton();
    }
  } catch (err) {
    console.debug('Version check failed:', err.message);
  }
}

// Show the reload button
function showReloadButton() {
  const reloadBtn = document.getElementById('reload-button');
  if (reloadBtn) {
    reloadBtn.classList.add('show');
  }
}

// Force reload the page
function forceReload() {
  console.log('🔄 Reloading application...');
  // Clear cache and reload
  window.location.reload(true);
}

// Initialize version checking
function initVersionCheck() {
  const reloadBtn = document.getElementById('reload-button');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', forceReload);
  }

  // Start periodic version checks
  setInterval(checkForUpdates, VERSION_CHECK_INTERVAL);

  console.log(`👁️ Version monitoring started (checking every ${VERSION_CHECK_INTERVAL/1000}s)`);
}

// Example: Initialize your app
function init() {
  // Initialize debug console FIRST
  debugConsole.init();

  console.log('🚀 Application loaded!');
  console.log('📦 Build version:', currentVersion);
  console.log('✨ Initializing application...');

  // Initialize version checking
  initVersionCheck();

  // Your application code here
  // Example: Update UI, set up event listeners, etc.
}

// Run initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for other modules if needed
export { init };
