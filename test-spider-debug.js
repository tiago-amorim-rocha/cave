import { chromium } from 'playwright';

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security', // Allow WASM
      '--disable-features=IsolateOrigins,site-per-process',
      '--ignore-gpu-blocklist',
      '--use-gl=swiftshader' // Software rendering for headless
    ]
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Capture all console messages
  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    console.log(text);
  });

  // Capture errors
  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
    console.error(err.stack);
  });

  page.on('crash', () => {
    console.error('PAGE CRASHED!');
  });

  // Add error listener for console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('CONSOLE ERROR:', msg.text());
    }
  });

  try {
    console.log('Navigating to http://localhost:5173/cave/');
    await page.goto('http://localhost:5173/cave/', {
      waitUntil: 'networkidle',
      timeout: 15000
    });

    // Wait for Rapier to initialize
    console.log('Waiting for Rapier initialization...');
    await page.waitForFunction(() => {
      return typeof window.RAPIER !== 'undefined';
    }, { timeout: 10000 }).catch(() => {
      console.log('RAPIER might not be loaded, continuing anyway...');
    });

    // Wait for test to complete (automated test runs for ~100 frames)
    console.log('Waiting for test to complete (10 seconds)...');
    await page.waitForTimeout(10000);

    console.log('\n========================================');
    console.log('TEST COMPLETE - Captured', logs.length, 'log messages');
    console.log('========================================\n');
  } catch (err) {
    console.error('Error during test:', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
})();
