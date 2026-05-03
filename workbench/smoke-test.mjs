import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});

await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.click('#load-weekly');
await page.waitForFunction(() => {
  const meta = document.querySelector('#topics-meta')?.textContent || '';
  return /^\d+\s*\//.test(meta) || /^\d+$/.test(meta);
}, { timeout: 30000 });

const topicsMeta = await page.locator('#topics-meta').textContent();
await page.click('#tab-clusters');
await page.selectOption('#topic-sort', 'co');
await page.click('#tab-raw');
const rawCount = await page.locator('#topics-list .topic-card, #topics-list .topic-item').count();
if (rawCount > 0) {
  await page.locator('#topics-list .topic-item').first().click();
}
await page.click('#tab-bundles');
await page.locator('#topics-list .topic-item').first().click();
await page.locator('.topic-pinned').first().check();
await page.locator('.topic-note').first().fill('priority topic');

await page.locator('#articles-list .article-open').first().click();
await page.waitForFunction(() => {
  return (document.querySelector('#context-meta')?.textContent || '') !== 'none' &&
         (document.querySelector('#context-view')?.textContent || '').length > 50;
}, { timeout: 30000 });

await page.locator('#articles-list .article-selected').first().check();
await page.locator('#articles-list .article-role').first().selectOption('related');
await page.locator('#articles-list .article-note').first().fill('keep this');
await page.locator('#selected-only').check();
const articleCountSelectedOnly = await page.locator('#articles-list .article-item').count();

const downloadPromise = page.waitForEvent('download');
await page.click('#export-json');
const download = await downloadPromise;
const path = await download.path();
const downloadContent = path ? await fs.readFile(path, 'utf8') : '';

const status = await page.locator('#status').textContent();
const pinnedCount = await page.locator('#pinned-count').textContent();
const selectionCount = await page.locator('#selection-count').textContent();
const contextMeta = await page.locator('#context-meta').textContent();

console.log(JSON.stringify({
  ok: true,
  topicsMeta,
  rawCount,
  articleCountSelectedOnly,
  status,
  pinnedCount,
  selectionCount,
  contextMeta,
  hasPinnedTopic: downloadContent.includes('pinnedTopics'),
  hasSourceContext: downloadContent.includes('sourceContext'),
  hasArticleNote: downloadContent.includes('keep this'),
  errors,
}, null, 2));

await browser.close();
