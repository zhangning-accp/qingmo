import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.locator('#startup')).toContainText('编辑就绪'); });
async function openFiles(page: Page) {
  const chooser = page.waitForEvent('filechooser'); await page.locator('#open').click();
  await (await chooser).setFiles([
    { name: '甲.md', mimeType: 'text/markdown', buffer: Buffer.from('# 甲文档\n\n甲原文') },
    { name: '乙.md', mimeType: 'text/markdown', buffer: Buffer.from('# 乙文档\n\n乙原文') },
  ]);
  await expect(page.getByRole('tab', { name: '乙.md', exact: true })).toBeVisible();
}
test('multi-select opens tabs and saves the active file only', async ({ page }) => {
  await openFiles(page);
  await page.getByRole('tab', { name: '甲.md', exact: true }).click();
  await page.locator('#mode').click(); await page.locator('#source').fill('# 甲修改');
  await page.getByRole('tab', { name: '乙.md', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toContainText('乙原文');
  const pending = page.waitForEvent('download'); await page.locator('#save').click();
  const download = await pending; expect(download.suggestedFilename()).toBe('乙.md');
  const chunks: Buffer[] = []; for await (const chunk of (await download.createReadStream())!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toContain('乙原文');
  await page.getByRole('tab', { name: '● 甲.md', exact: true }).click();
  await expect(page.locator('#source')).toHaveValue('# 甲修改');
});
test('tabs retain separate undo histories and new does not discard edits', async ({ page }) => {
  await page.locator('#new').click(); await page.locator('.ProseMirror').click(); await page.keyboard.insertText('甲的修改');
  const first = await page.locator('.tab.active').getAttribute('data-id');
  await page.locator('#new').click(); await expect(page.locator('#unsaved')).not.toBeVisible();
  await page.locator('.ProseMirror').click(); await page.keyboard.insertText('乙的修改');
  const second = await page.locator('.tab.active').getAttribute('data-id');
  await page.locator(`[data-id="${first}"] .tab-select`).click();
  await expect(page.locator('.ProseMirror')).toContainText('甲的修改');
  await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+z');
  await expect(page.locator('.ProseMirror')).not.toContainText('甲的修改');
  await page.locator(`[data-id="${second}"] .tab-select`).click();
  await expect(page.locator('.ProseMirror')).toContainText('乙的修改');
});
async function drop(page: Page) {
  const data = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['# 拖入甲'], '拖入甲.md', { type: 'text/markdown', lastModified: 1 }));
    data.items.add(new File(['# 拖入乙'], '拖入乙.md', { type: 'text/markdown', lastModified: 1 }));
    data.items.add(new File(['bad'], '错误.png', { type: 'image/png', lastModified: 1 }));
    return data;
  });
  await page.locator('.ProseMirror').dispatchEvent('drop', { dataTransfer: data });
  await data.dispose();
}
test('drop opens multiple files, reports unsupported files, and deduplicates without losing edits', async ({ page }) => {
  await drop(page);
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.locator('#notice')).toContainText('错误.png');
  await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('尚未保存');
  await drop(page);
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.locator('.ProseMirror')).toContainText('尚未保存');
  await page.screenshot({ path: 'qa/tabs.png' });
});
test('recover multiple unsaved tabs and close only the selected tab', async ({ page }) => {
  await openFiles(page);
  for (const name of ['甲.md', '乙.md']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.locator('#mode').click(); await page.locator('#source').fill(`${name}的未保存内容`);
  }
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('qingmo.drafts.v2') || '[]').length)).toBe(2);
  page.on('dialog', dialog => dialog.accept()); await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.locator('.tab.active .tab-close').click(); await page.locator('#unsaved button[value=cancel]').click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.locator('.tab.active .tab-close').click(); await page.locator('button[value=discard]').click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.locator('.ProseMirror')).toContainText('乙.md的未保存内容');
});

test('an emptied document remains an unsaved recovery draft', async ({ page }) => {
  await page.locator('#mode').click(); await page.locator('#source').fill('');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('qingmo.drafts.v2') || '[]').length)).toBe(1);
  page.on('dialog', dialog => dialog.accept()); await page.reload();
  await expect(page.getByRole('tab')).toContainText('●');
  await page.locator('.tab.active .tab-close').click(); await expect(page.locator('#unsaved')).toBeVisible();
});
