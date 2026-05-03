import { test, expect } from '@playwright/test';

test('workbench smoke', async ({ page }) => {
  await page.route('**/sources', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        categories: {
          crypto: [{ name: 'CoinDesk', url: 'https://example.com/coindesk.xml', enabled: true, priority: 70, sourceType: 'media' }],
          us_stocks_macro: [{ name: 'Nasdaq', url: 'https://example.com/nasdaq.xml', enabled: true, priority: 80, sourceType: 'media' }],
          ai: [{ name: 'OpenAI News', url: 'https://example.com/openai.xml', enabled: true, priority: 100, sourceType: 'official' }],
          taiwan_stocks: [{ name: 'CNA Finance', url: 'https://example.com/cna.xml', enabled: false, priority: 74, sourceType: 'media' }],
        },
      }),
    });
  });

  await page.route('**/weekly?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        generatedAt: '2026-05-03T00:00:00.000Z',
        params: {
          days: 7,
          limitPerSource: 6,
          includeTaiwan: false,
          categories: ['crypto', 'us_stocks_macro', 'ai'],
          keyword: null,
          maxItemsPerCategory: 10,
        },
        summary: { totalItems: 3, successfulFeeds: 3, failedFeeds: 0 },
        categories: {
          crypto: [
            {
              id: 'riot-1',
              source: 'CoinDesk',
              sourceType: 'media',
              sourcePriority: 80,
              sourceQualityScore: 95,
              corroborationScore: 60,
              marketReactionScore: 35,
              editorialScore: 133,
              category: 'crypto',
              title: 'Riot shares jump after AMD expands data center deal',
              url: 'https://example.com/riot-amd',
              publishedAt: '2026-05-02T10:00:00.000Z',
              description: 'Riot shares jumped after AMD expanded a data center agreement.',
              rawDescription: null,
              matchedKeywords: [],
              ageHours: 12,
              dateQuality: 'ok',
              eventType: 'price_action',
              majorEntity: 'riot',
              marketTheme: 'ai_capex',
              clusterKey: 'riot-ai-pivot',
            },
          ],
          us_stocks_macro: [
            {
              id: 'goog-1',
              source: 'Nasdaq',
              sourceType: 'media',
              sourcePriority: 80,
              sourceQualityScore: 88,
              corroborationScore: 75,
              marketReactionScore: 55,
              editorialScore: 141,
              category: 'us_stocks_macro',
              title: 'Alphabet rises after strong cloud growth',
              url: 'https://example.com/google-cloud',
              publishedAt: '2026-05-02T08:00:00.000Z',
              description: 'Alphabet shares rose after cloud revenue accelerated.',
              rawDescription: null,
              matchedKeywords: [],
              ageHours: 14,
              dateQuality: 'ok',
              eventType: 'earnings',
              majorEntity: 'alphabet',
              marketTheme: 'big_tech_earnings',
              clusterKey: 'big-tech-earnings',
            },
          ],
          ai: [
            {
              id: 'openai-1',
              source: 'OpenAI News',
              sourceType: 'official',
              sourcePriority: 100,
              sourceQualityScore: 98,
              corroborationScore: 50,
              marketReactionScore: 20,
              editorialScore: 128,
              category: 'ai',
              title: 'Building the compute infrastructure for the Intelligence Age',
              url: 'https://example.com/openai-compute',
              publishedAt: '2026-05-01T12:00:00.000Z',
              description: 'OpenAI discusses building more compute faster.',
              rawDescription: null,
              matchedKeywords: [],
              ageHours: 34,
              dateQuality: 'ok',
              eventType: 'capex',
              majorEntity: 'openai',
              marketTheme: 'ai_capex',
              clusterKey: 'ai-capex',
            },
          ],
          taiwan_stocks: [],
        },
        topicClusters: [
          {
            clusterKey: 'big-tech-earnings',
            title: 'Big Tech earnings',
            category: 'us_stocks_macro',
            marketTheme: 'big_tech_earnings',
            eventType: 'earnings',
            majorEntity: 'alphabet',
            sourceCount: 1,
            itemCount: 1,
            totalEditorialScore: 141,
            averageEditorialScore: 141,
            items: [],
            topItemTitles: ['Alphabet rises after strong cloud growth'],
          },
          {
            clusterKey: 'ai-capex',
            title: 'AI capex and infrastructure',
            category: 'ai',
            marketTheme: 'ai_capex',
            eventType: 'capex',
            majorEntity: 'openai',
            sourceCount: 1,
            itemCount: 1,
            totalEditorialScore: 128,
            averageEditorialScore: 128,
            items: [],
            topItemTitles: ['Building the compute infrastructure for the Intelligence Age'],
          },
        ],
        narrativeBundles: [
          {
            bundleKey: 'bundle-big-tech',
            title: 'Big Tech 財報與股價重定價包',
            summary: '把大型科技股財報、指數反應、贏家輸家分化放在一起。',
            angle: '市場正在重新定價大型科技股。',
            whyGrouped: 'earnings + reaction',
            categories: ['us_stocks_macro', 'crypto'],
            marketThemes: ['big_tech_earnings'],
            eventTypes: ['earnings', 'price_action'],
            entities: ['alphabet', 'riot'],
            clusterKeys: ['big-tech-earnings', 'ai-capex'],
            coreTopTitles: ['Alphabet rises after strong cloud growth'],
            relatedTopTitles: ['Building the compute infrastructure for the Intelligence Age'],
            sourceCount: 2,
            articleCount: 2,
            totalEditorialScore: 269,
            averageEditorialScore: 134.5,
          },
        ],
        failedFeeds: [],
      }),
    });
  });

  await page.route('**/source-context?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        generatedAt: '2026-05-03T00:00:00.000Z',
        articles: [
          {
            title: 'Riot shares jump after AMD expands data center deal',
            source: 'CoinDesk',
            url: 'https://example.com/riot-amd',
            publishedAt: '2026-05-02T10:00:00.000Z',
            description: 'Riot shares jumped after AMD expanded a data center agreement.',
            leadText: 'Riot rose after AMD expanded its agreement.',
            articleExcerpt: 'The expanded agreement doubled capacity and improved lender confidence.',
            keyParagraphs: [
              'AMD exercised an option to double contracted capacity to 50MW.',
              'The agreement could generate roughly $636 million over 10 years.',
            ],
            quotedLines: [
              'Market pricing in lower cost of capital as the expanded AMD deal drives lender confidence.',
            ],
            numbersMentioned: ['50MW', '150MW', '$636M', '10 years'],
          },
        ],
        failedArticles: [],
      }),
    });
  });

  await page.goto('http://127.0.0.1:4173');
  await page.click('#load-weekly');
  await expect(page.locator('#topics-meta')).toContainText('/');

  await page.click('#tab-clusters');
  await page.selectOption('#topic-sort', 'co');
  await page.click('#tab-raw');
  await expect(page.locator('#topics-list .topic-item').first()).toBeVisible();

  await page.click('#tab-bundles');
  await expect(page.locator('#topics-list .topic-item.active').first()).toBeVisible();
  await page.locator('.topic-pinned').first().evaluate((node) => {
    node.checked = true;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.topic-note').first().fill('priority topic', { force: true });

  await page.locator('#articles-list .article-open').first().click();
  await expect(page.locator('#context-meta')).not.toHaveText('none');
  await page.locator('#articles-list .article-selected').first().evaluate((node) => {
    node.checked = true;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#articles-list .article-role').first().selectOption('related');
  await page.locator('#articles-list .article-note').first().fill('keep this', { force: true });
  await page.locator('#selected-only').evaluate((node) => {
    node.checked = true;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#selection-count')).toContainText('1');
  await expect(page.locator('#pinned-count')).toContainText('1');
});
