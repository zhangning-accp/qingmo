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
  await page.locator('#unsaved button[value=cancel]').click(); await expect(page.locator('.ProseMirror')).toContainText('旧文档');
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

test('YAML frontmatter keeps its lines in layout and source; footer counts source lines', async ({ page }) => {
  const raw = '---\nschema_version: 1\nasset_id: example\ncontributors:\n  content_authors: [张安仁, Codex]\n---\n\n# 正文\n\n原段落\n';
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#open').click();
  await (await chooser).setFiles({ name: '带元数据.md', mimeType: 'text/markdown', buffer: Buffer.from(raw) });
  const frontmatter = page.locator('.ProseMirror pre').first();
  await expect(frontmatter).toContainText('schema_version: 1');
  expect(await frontmatter.textContent()).toContain('schema_version: 1\nasset_id: example');
  await expect(page.locator('#lines')).toHaveText(`${raw.split('\n').length} 行`);
  await page.screenshot({ path: 'qa/frontmatter-layout.png' });
  await page.locator('#mode').click();
  await expect(page.locator('#source')).toHaveValue(raw);
  await page.locator('#mode').click();
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('补充');
  await page.locator('#mode').click();
  const edited = await page.locator('#source').inputValue();
  expect(edited).toMatch(/^---\nschema_version: 1\nasset_id: example\ncontributors:\n  content_authors: \[张安仁, Codex\]\n---/);
  expect(edited).not.toContain('```yaml');
  expect(edited).toContain('补充');
  await expect(page.locator('#lines')).toHaveText(`${edited.split('\n').length} 行`);
  await page.locator('#source').fill(`${edited}\n新行`);
  await expect(page.locator('#lines')).toHaveText(`${edited.split('\n').length + 1} 行`);
  await page.locator('#new').click();
  await expect(page.locator('#lines')).toHaveText('1 行');
  await page.getByRole('tab', { name: /带元数据.md/ }).click();
  await expect(page.locator('#lines')).toHaveText(`${edited.split('\n').length + 1} 行`);
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

test('source mode shows line numbers and tracks scrolling', async ({ page }) => {
  await page.locator('#mode').click();
  await page.locator('#source').fill(Array.from({ length: 100 }, (_, i) => `第${i + 1}行`).join('\n'));
  await expect(page.locator('#line-gutter')).toContainText('1');
  await page.locator('#source').evaluate(element => { element.scrollTop = 1000; element.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => page.locator('#line-gutter').textContent()).not.toMatch(/^1\n/);
  await page.locator('#source').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => page.locator('#line-gutter').textContent()).toMatch(/^1\n2\n3/);
});

test('pasting Markdown into a new empty tab renders it immediately', async ({ page }) => {
  await page.locator('#new').click();
  const markdown = '# 粘贴标题\n\n| 名称 | 内容 |\n| --- | --- |\n| A | B |';
  await page.locator('.ProseMirror').evaluate((node, text) => {
    const data = new DataTransfer(); data.setData('text/plain', text);
    node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, markdown);
  await expect(page.locator('.ProseMirror h1')).toHaveText('粘贴标题');
  await expect(page.locator('.ProseMirror table:visible')).toHaveCount(1);
  await page.locator('#mode').click();
  await expect(page.locator('#source')).toHaveValue(markdown);
});

test('inline Markdown paste renders bold text in a blank tab', async ({ page }) => {
  await page.locator('#new').click();
  await page.locator('.ProseMirror').evaluate(node => {
    const data = new DataTransfer(); data.setData('text/plain', '正文有 **重点** 和 `代码`');
    node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(page.locator('.ProseMirror strong')).toHaveText('重点');
  await expect(page.locator('.ProseMirror code')).toHaveText('代码');
});

test('Chinese label followed by text renders bold and keeps original Markdown', async ({ page }) => {
  await page.locator('#new').click();
  await page.locator('#mode').click();
  const raw = '**【双通道】**本话题';
  await page.locator('#source').fill(raw);
  await page.locator('#mode').click();
  await expect(page.locator('.ProseMirror strong')).toHaveText('【双通道】');
  await expect(page.locator('.ProseMirror')).not.toContainText('**');
  await page.locator('#mode').click();
  await expect(page.locator('#source')).toHaveValue(raw);
  await page.locator('#mode').click();
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('补充');
  await page.locator('#mode').click();
  await expect(page.locator('#source')).toHaveValue(/^\*\*【双通道】\*\*本话题补充\n?$/);
  await page.locator('#mode').click();
  await expect(page.locator('.ProseMirror strong')).toHaveText('【双通道】');
});

test('pasted Chinese labels render bold without changing fenced code', async ({ page }) => {
  await page.locator('#new').click();
  const raw = ['**【选型依据】**PEP 四下 Unit4', '**【交互双通道】**本话题所有训练步骤', '', '```', '**【代码示例】**保持原样', '```'].join('\n');
  await page.locator('.ProseMirror').evaluate((node, text) => {
    const data = new DataTransfer(); data.setData('text/plain', text);
    node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, raw);
  await expect(page.locator('.ProseMirror strong')).toHaveCount(2);
  await expect(page.locator('.ProseMirror code')).toContainText('**【代码示例】**保持原样');
  await page.locator('#mode').click();
  await expect(page.locator('#source')).toHaveValue(raw);
});

test('Word export feedback stays visible after scrolling and can be dismissed', async ({ page }) => {
  await page.locator('#new').click();
  await page.locator('#mode').click();
  await page.locator('#source').fill('# 标题\n\n' + Array.from({ length: 80 }, (_, i) => `段落 ${i + 1}\n\n`).join(''));
  await page.locator('#mode').click();
  await page.locator('main').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.locator('#export-word').click();
  await expect(page.locator('#notice')).toContainText('Windows 桌面版');
  expect(await page.locator('#notice').evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= innerHeight;
  })).toBe(true);
  await page.locator('#notice-close').click();
  await expect(page.locator('#notice')).toBeHidden();
});
