import { test, expect } from '@playwright/test';

test('measure multi-document open and tab switching', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.locator('#startup')).toContainText('编辑就绪');
  const paragraph = '## 训练目标\n\n这个话题需要完成词汇、句式和组合训练。请根据反馈修改答案。\n\n';
  const content = paragraph.repeat(Math.ceil(450_000 / Buffer.byteLength(paragraph, 'utf8')));
  const files = Array.from({ length: 10 }, (_, i) => ({ name: `性能样本${i + 1}.md`, mimeType: 'text/markdown', buffer: Buffer.from(content) }));
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#open').click();
  const fileChooser = await chooser;
  const started = Date.now();
  await fileChooser.setFiles(files);
  await expect(page.getByRole('tab')).toHaveCount(11, { timeout: 120_000 });
  await expect(page.locator('#source')).toBeVisible();
  await expect(page.locator('#source')).toHaveValue(content);
  await expect(page.locator('#notice')).toContainText('先以源码打开');
  const openedMs = Date.now() - started;
  const switches: number[] = [];
  for (const index of [1, 2, 3, 4, 5, 1, 5]) {
    const elapsed = await page.evaluate(index => {
      const tab = document.querySelectorAll<HTMLElement>('[role="tab"]')[index];
      const started = performance.now(); tab.click();
      return performance.now() - started;
    }, index);
    switches.push(Math.round(elapsed));
  }
  await expect(page.locator('#source')).toHaveValue(content);
  for (const index of [10, 1]) {
    await page.evaluate(index => document.querySelectorAll<HTMLElement>('[role="tab"]')[index].click(), index);
    const position = await page.evaluate(() => {
      const bar = document.querySelector('#tabs')!.getBoundingClientRect();
      const active = document.querySelector('#tabs .active')!.getBoundingClientRect();
      return { barLeft: bar.left, barRight: bar.right, activeLeft: active.left, activeRight: active.right, scrollLeft: document.querySelector('#tabs')!.scrollLeft };
    });
    expect(position.activeLeft, JSON.stringify({ index, position })).toBeGreaterThanOrEqual(position.barLeft - 1);
    expect(position.activeRight, JSON.stringify({ index, position })).toBeLessThanOrEqual(position.barRight + 1);
  }
  await page.evaluate(() => document.querySelectorAll<HTMLElement>('[role="tab"]')[5].click());
  const conversionStarted = Date.now();
  await page.locator('#mode').click();
  await expect(page.locator('.ProseMirror h2').first()).toHaveText('训练目标');
  const conversionMs = Date.now() - conversionStarted;
  await page.getByRole('tab', { name: '性能样本1.md', exact: true }).click();
  const richSwitchMs = Math.round(await page.evaluate(() => {
    const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(item => item.textContent === '性能样本5.md')!;
    const started = performance.now(); tab.click();
    return performance.now() - started;
  }));
  await expect(page.locator('.ProseMirror h2').first()).toHaveText('训练目标');
  await page.locator('.ProseMirror p').last().click();
  const editStarted = Date.now();
  await page.keyboard.insertText('追加内容');
  const editMs = Date.now() - editStarted;
  console.log(JSON.stringify({ bytesPerDocument: files[0].buffer.length, openedMs, switches, conversionMs, richSwitchMs, editMs }));
});

test('a large recovered draft starts in source mode', async ({ page }) => {
  await page.goto('/');
  const content = '# 草稿\n\n' + '待修改内容。\n'.repeat(1_600);
  await page.evaluate(value => localStorage.setItem('qingmo.drafts.v2', JSON.stringify([{ title: '长草稿.md', content: value }])), content);
  const restored = await page.context().newPage();
  await restored.goto('/');
  await expect(restored.locator('#startup')).toContainText('编辑就绪');
  await expect(restored.locator('#source')).toBeVisible();
  await expect(restored.locator('#source')).toHaveValue(content);
  await expect(restored.getByRole('tab', { name: /长草稿.md/ })).toBeVisible();
  await restored.locator('#source').evaluate((element, value) => {
    const source = element as HTMLTextAreaElement;
    source.value = value;
    source.dispatchEvent(new Event('input', { bubbles: true }));
  }, `${content}\n新增内容`);
  await restored.locator('#new').click();
  await restored.getByRole('tab', { name: /长草稿.md/ }).click();
  await restored.locator('#mode').click();
  await expect(restored.locator('.ProseMirror')).toContainText('新增内容');
});
