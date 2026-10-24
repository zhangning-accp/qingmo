import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.locator('#startup')).toContainText('编辑就绪'); });

test('table editing adds and removes rows and columns, supports undo', async ({ page }) => {
  const table = page.locator('.ProseMirror table:visible');
  await expect(table.locator('tr')).toHaveCount(3);
  await table.locator('td').first().click();
  await page.locator('[data-table=row]').click();
  await expect(table.locator('tr')).toHaveCount(4);
  await page.locator('[data-table=column]').click();
  await expect(table.locator('tr').first().locator('th,td')).toHaveCount(4);
  await page.locator('[data-table=deleteColumn]').click();
  await expect(table.locator('tr').first().locator('th,td')).toHaveCount(3);
  await page.locator('[data-table=deleteRow]').click();
  await expect(table.locator('tr')).toHaveCount(3);
  await page.locator('[data-table=deleteTable]').click();
  await expect(table).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(table).toHaveCount(1);
  await expect(table.locator('tr')).toHaveCount(3);
});

test('immediate save includes last keystrokes and source switching preserves text', async ({ page }) => {
  await page.locator('#new').click();
  await page.locator('.ProseMirror').click();
  await page.keyboard.insertText('中文最后几个字');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await download; const stream = await file.createReadStream();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toContain('中文最后几个字');
  await page.locator('#mode').click();
  await expect(page.locator('#source')).toHaveValue(/中文最后几个字/);
  await page.locator('#source').fill('# 改过的标题\n\n正文');
  await page.locator('#mode').click();
  await expect(page.locator('.ProseMirror h1')).toHaveText('改过的标题');
});

test('unsaved changes can cancel or discard; undo cannot restore previous document', async ({ page }) => {
  await page.locator('#new').click();
  await page.locator('.ProseMirror').click(); await page.keyboard.insertText('旧文档');
  await page.locator('.tab.active .tab-close').click(); await expect(page.locator('#unsaved')).toBeVisible();
  await page.locator('button[value=cancel]').click(); await expect(page.locator('.ProseMirror')).toContainText('旧文档');
  await page.locator('.tab.active .tab-close').click(); await page.locator('button[value=discard]').click();
  await page.locator('.ProseMirror').click(); await page.keyboard.press('Control+z');
  await expect(page.locator('.ProseMirror')).not.toContainText('旧文档');
  await page.keyboard.insertText('需要保留');
  await page.locator('.tab.active .tab-close').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ProseMirror')).toContainText('需要保留');
});

test('draft survives reload and unchanged source roundtrip does not rewrite formatting', async ({ page }) => {
  await page.locator('#mode').click();
  const raw = '# 标题\r\n\r\n* 项目\r\n\r\n<!-- 保留注释 -->\r\n';
  await page.locator('#source').fill(raw);
  const expected = await page.locator('#source').inputValue();
  await page.locator('#mode').click(); await page.locator('#mode').click();
  await expect(page.locator('#source')).toHaveValue(expected);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('qingmo.drafts.v2'))).toContain('保留注释');
  page.on('dialog', dialog => dialog.accept()); await page.reload();
  await expect(page.locator('#notice')).toContainText('已恢复');
  await page.locator('#mode').click(); await expect(page.locator('#source')).toHaveValue(expected);
});

test('initial rendering has no runtime errors and fits the window', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.reload(); await expect(page.locator('#startup')).toContainText('编辑就绪');
  await expect(page.locator('.ProseMirror h1')).toContainText('写下');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'qa/editor.png' });
});

test('insert table, edit Chinese cells, and move between cells with Tab', async ({ page }) => {
  await page.locator('#new').click();
  await page.locator('.ProseMirror').click();
  await page.locator('#insert-table').click();
  const table = page.locator('.ProseMirror table:visible');
  await expect(table).toHaveCount(1);
  await table.locator('td').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.insertText('第一格');
  await page.keyboard.press('Tab');
  await page.keyboard.insertText('第二格');
  await expect(table.locator('td').nth(0)).toContainText('第一格');
  await expect(table.locator('td').nth(1)).toContainText('第二格');
  await page.locator('#mode').click();
  await expect(page.locator('#source')).toHaveValue(/第一格/);
  await expect(page.locator('#source')).toHaveValue(/第二格/);
});
