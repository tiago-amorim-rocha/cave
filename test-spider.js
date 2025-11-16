import { chromium } from 'playwright';

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();

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

  try {
    console.log('Navigating to http://localhost:5173/cave/');
    await page.goto('http://localhost:5173/cave/', {
      waitUntil: 'load',
      timeout: 10000
    });

    // Wait for test to complete
    console.log('Waiting for test to complete (5 seconds)...');
    await page.waitForTimeout(5000);

    console.log('\n========================================');
    console.log('TEST COMPLETE - Captured', logs.length, 'log messages');
    console.log('========================================\n');
  } catch (err) {
    console.error('Error during test:', err.message);
  } finally {
    await browser.close();
  }
})();
