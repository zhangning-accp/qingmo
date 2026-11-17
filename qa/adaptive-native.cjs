const { chromium, expect } = require('@playwright/test');

(async () => {
  let browser;
  for (let attempt = 0; attempt < 60 && !browser; attempt++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9339'); }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!browser) throw new Error('Native WebView2 unavailable');
  try {
    const page = browser.contexts()[0].pages()[0];
    await expect(page.locator('#startup')).toContainText('编辑就绪');
    const normal = (await page.locator('.ProseMirror').boundingBox()).width;
    await page.locator('#focus').click();
    const focused = (await page.locator('.ProseMirror').boundingBox()).width;
    expect(focused - normal).toBeGreaterThan(150);
    await page.locator('#mode').click();
    expect((await page.locator('#source').boundingBox()).width).toBeCloseTo(focused, 0);
    await page.locator('#mode').click();
    await page.locator('#focus').click();
    await page.screenshot({ path: 'qa/adaptive-native.png' });
    console.log(JSON.stringify({ passed: true, normal, focused, sourceUsesAvailableWidth: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
