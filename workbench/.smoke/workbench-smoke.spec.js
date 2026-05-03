const { test, expect } = require('@playwright/test');

test('workbench smoke', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173');
  await page.click('#load-weekly');
  await expect(page.locator('#topics-meta')).toContainText('/');

  await page.click('#tab-clusters');
  await page.selectOption('#topic-sort', 'co');
  await page.click('#tab-raw');
  const rawCount = await page.locator('#topics-list .topic-item').count();
  if (rawCount > 0) await page.locator('#topics-list .topic-item').first().click();

  await page.click('#tab-bundles');
  await page.locator('#topics-list .topic-item').first().click();
  await page.locator('.topic-pinned').first().check();
  await page.locator('.topic-note').first().fill('priority topic');

  await page.locator('#articles-list .article-open').first().click();
  await expect(page.locator('#context-meta')).not.toHaveText('none');
  await page.locator('#articles-list .article-selected').first().check();
  await page.locator('#articles-list .article-role').first().selectOption('related');
  await page.locator('#articles-list .article-note').first().fill('keep this');
  await page.locator('#selected-only').check();
  await expect(page.locator('#selection-count')).toContainText('1');
  await expect(page.locator('#pinned-count')).toContainText('1');
});
