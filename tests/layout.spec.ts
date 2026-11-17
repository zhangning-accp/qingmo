import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#startup')).toContainText('编辑就绪');
});

test('document expands with the window instead of remaining a fixed narrow column', async ({ page }) => {
  const normal = (await page.locator('.ProseMirror').boundingBox())!.width;
  await page.setViewportSize({ width: 1920, height: 1080 });
  const wide = (await page.locator('.ProseMirror').boundingBox())!.width;
  expect(wide - normal).toBeGreaterThan(500);

  for (const width of [2560, 1440, 760]) {
    await page.setViewportSize({ width, height: 800 });
    const main = (await page.locator('main').boundingBox())!;
    const editor = (await page.locator('.ProseMirror').boundingBox())!;
    expect(editor.width / main.width).toBeGreaterThan(0.85);
    expect(editor.x).toBeGreaterThan(main.x);
    expect(editor.x + editor.width).toBeLessThan(main.x + main.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('focus mode gives the reclaimed sidebar space to both editing views', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const normal = (await page.locator('.ProseMirror').boundingBox())!.width;
  await page.locator('#focus').click();
  await expect(page.locator('aside')).toBeHidden();
  const focused = (await page.locator('.ProseMirror').boundingBox())!.width;
  expect(focused - normal).toBeGreaterThan(150);
  await page.locator('#mode').click();
  expect((await page.locator('#source').boundingBox())!.width).toBeCloseTo(focused, 0);
  await expect(page.locator('#source')).toHaveValue(/写下，思绪就清晰了/);
  await page.locator('#focus').click();
  expect((await page.locator('#source').boundingBox())!.width).toBeCloseTo(normal, 0);
  await page.setViewportSize({ width: 760, height: 520 });
  const source = (await page.locator('#source').boundingBox())!;
  expect(source.x + source.width).toBeLessThan(760);
  expect((await page.locator('footer').boundingBox())!.y).toBeLessThan(520);
});
