const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const folder = fs.mkdtempSync(path.join(__dirname, 'native-files-'));
  const a = path.join(folder, '甲.md'), b = path.join(folder, '乙.md');
  fs.writeFileSync(a, '# 甲原文'); fs.writeFileSync(b, '# 乙原文');
  let browser;
  const deadline = Date.now() + 25000;
  while (!browser && Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9337'); }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert(browser, 'WebView2 debugging connection unavailable');
  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page');
    await expect(page.locator('#startup')).toContainText('编辑就绪', { timeout: 15000 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    async function drop(paths) {
      await page.evaluate(paths => window.__TAURI_INTERNALS__.invoke('plugin:event|emit_to', {
        target: { kind: 'Webview', label: 'main' }, event: 'tauri://drag-drop', payload: { paths, position: { x: 200, y: 200 } },
      }), paths);
    }
    await drop([a, b]);
    await expect(page.getByRole('tab')).toHaveCount(3);
    await page.getByRole('tab', { name: '甲.md', exact: true }).click();
    await page.locator('#mode').click(); await page.locator('#source').fill('# 甲已修改');
    await page.locator('#save').click();
    await expect.poll(() => fs.readFileSync(a, 'utf8')).toBe('# 甲已修改');
    assert.equal(fs.readFileSync(b, 'utf8'), '# 乙原文');
    await page.getByRole('tab', { name: '乙.md', exact: true }).click();
    await page.locator('#mode').click(); await page.locator('#source').fill('# 乙未保存');
    await drop([a, b]);
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.locator('#source')).toHaveValue('# 乙未保存');
    await page.locator('#save').click();
    await expect.poll(() => fs.readFileSync(b, 'utf8')).toBe('# 乙未保存');
    fs.writeFileSync(b, '乙外部修改');
    await page.locator('#source').fill('不应该覆盖'); await page.locator('#save').click();
    await expect(page.locator('#notice')).toContainText('其他程序修改');
    assert.equal(fs.readFileSync(b, 'utf8'), '乙外部修改');
    await page.locator('.tab.active .tab-close').click();
    await page.locator('button[value=discard]').click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.locator('#source')).toHaveValue('# 甲已修改');
    await page.locator('#source').fill('甲关闭时保留');
    await page.locator('#new').click(); await page.locator('#mode').click();
    await page.locator('#source').fill('新文档关闭时保留');
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:event|emit_to', {
      target: { kind: 'Window', label: 'main' }, event: 'tauri://close-requested', payload: null,
    }));
    await expect(page.locator('#unsaved')).toBeVisible();
    await page.locator('button[value=discard]').click();
    await expect(page.locator('#unsaved p')).not.toContainText('甲.md');
    await page.locator('button[value=cancel]').click();
    await page.getByRole('tab', { name: '● 甲.md', exact: true }).click();
    await expect(page.locator('#source')).toHaveValue('甲关闭时保留');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(__dirname, 'native-tabs.png') });
    fs.writeFileSync(path.join(__dirname, 'native-tabs-results.json'), JSON.stringify({
      passed: true, checks: ['native drop event -> Rust file read -> tabs', 'independent native file saves', 'duplicate drop preserves unsaved content', 'external conflict protection', 'close tab confirmation', 'cancel window close preserves all tabs'],
      limitation: 'Drop events injected through Tauri; physical Explorer mouse drag and native picker multi-selection not automated',
    }, null, 2));
    console.log('Native WebView2 integration: all checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
