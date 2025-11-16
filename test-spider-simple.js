import { chromium } from 'playwright';

(async () => {
  console.log('=== SPIDER HEADLESS TEST ===\n');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-dev-tools',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // Critical for Docker
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });

  const page = await browser.newPage();

  // Capture ALL console output
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    console.log(`[${type.toUpperCase()}] ${text}`);
  });

  // Capture page errors
  page.on('pageerror', err => {
    console.error('\n=== PAGE ERROR ===');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
  });

  // Capture crashes
  page.on('crash', () => {
    console.error('\n=== PAGE CRASHED ===');
  });

  // Capture request failures
  page.on('requestfailed', request => {
    console.error('\n=== REQUEST FAILED ===');
    console.error('URL:', request.url());
    console.error('Error:', request.failure()?.errorText);
  });

  try {
    console.log('Loading http://localhost:5173/cave/ ...\n');

    await page.goto('http://localhost:5173/cave/', {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    console.log('\n=== PAGE LOADED ===\n');

    // Wait a bit for initialization
    await page.waitForTimeout(8000);

    console.log('\n=== TEST COMPLETE ===');

  } catch (err) {
    console.error('\n=== ERROR ===');
    console.error(err.message);

    // Try to get page content to see what loaded
    try {
      const content = await page.content();
      console.log('\n=== PAGE HTML (first 500 chars) ===');
      console.log(content.substring(0, 500));
    } catch (e) {
      console.log('Could not get page content');
    }
  } finally {
    await browser.close();
  }
})();
