# Daily Market Report

Minimal service for the US daily market report plus an isolated Taiwan stock research feed.

The US poster workflow remains separate from Taiwan sources. Taiwan data is exposed through its own endpoints and does not affect `/daily/us` or `/daily`.

## Production URLs

- Daily HTML: `https://weekly-rss-daily.zeabur.app/daily/us`
- Daily JSON: `https://weekly-rss-daily.zeabur.app/daily/us.json`
- Poster HTML: `https://weekly-rss-daily.zeabur.app/daily`
- Poster JSON: `https://weekly-rss-daily.zeabur.app/daily/us-poster.json`
- Poster SVG: `https://weekly-rss-daily.zeabur.app/daily/us-poster.svg`
- Full calendar HTML: `https://weekly-rss-daily.zeabur.app/daily/calendar`
- Taiwan research HTML: `https://weekly-rss-daily.zeabur.app/daily/taiwan`
- Taiwan research JSON: `https://weekly-rss-daily.zeabur.app/daily/taiwan.json`
- Taiwan stock test UI: `https://weekly-rss-daily.zeabur.app/taiwan`
- Taiwan source registry: `https://weekly-rss-daily.zeabur.app/taiwan/sources.json`
- Taiwan industry map: `https://weekly-rss-daily.zeabur.app/taiwan/industry-map.json`
- Taiwan stock profile: `https://weekly-rss-daily.zeabur.app/taiwan/stock.json?symbol=2330`
- OpenAPI: `https://weekly-rss-daily.zeabur.app/openapi.yaml`

## Local Development

```bash
npm install
npm run dev:zeabur
```

Open:

```text
http://localhost:3000/daily/us?date=YYYY-MM-DD
http://localhost:3000/daily/us.json?date=YYYY-MM-DD
http://localhost:3000/daily?date=YYYY-MM-DD
http://localhost:3000/daily/us-poster.json?date=YYYY-MM-DD
http://localhost:3000/taiwan
http://localhost:3000/daily/taiwan.json?days=3
http://localhost:3000/taiwan/sources.json
http://localhost:3000/taiwan/industry-map.json
http://localhost:3000/taiwan/stock.json?symbol=2330
http://localhost:3000/taiwan/stock/2330.json
```

## Scripts

```bash
npm run check
npm run build
npm run start
```

## Environment

- `FMP_API_KEY`: historical close data for indices, assets, and mega-cap stocks.
- `OPENROUTER_API_KEY`: optional Chinese translation for poster story text.
- `OPENROUTER_TRANSLATION_MODEL`: optional model override.
- `BLOCKBEATS_API_KEY`, `OPENNEWS_TOKEN`, `TWITTER_TOKEN`: optional private signal enrichment used by the daily news ranking layer.
- `ENABLE_EDITORIAL_SCHEDULER=false`: disable scheduled editorial-cache refresh in the Node runtime.

## Data Contract

The daily JSON payload exposes:

- `marketDataStatus`: whether the requested US session is final and render-safe.
- `marketSummary.indices`: S&P 500, Nasdaq Composite, Dow Jones, Russell 2000, SOX.
- `marketSummary.assets`: VIX, US 10Y, DXY, WTI, Gold, BTC.
- `marketSummary.megaCaps`: Apple, Microsoft, NVIDIA, Amazon, Alphabet, Meta, Tesla.
- `topStories`: US market and macro news candidates.
- `stockNews`: individual stock news candidates selected from company-specific market, AI, and earnings items.
- `topAiRadar`: AI / Big Tech radar.
- `earningsRadar`: earnings-related items.
- `macroCalendar`: upcoming macro events.
- `nextSessionWatchlist`: next-session watch items.
- `observables`: deterministic market observations.

Poster endpoints are derived from the daily JSON payload and preserve the original source title/summary for verification.

## Taiwan Research Feed

Taiwan endpoints are independent from the US daily report:

- `GET /daily/taiwan.json?days=3`
- `GET /daily/taiwan?days=3`
- `GET /taiwan`
- `GET /taiwan/sources.json`
- `GET /taiwan/industry-map.json`
- `GET /taiwan/stock.json?symbol=2330`
- `GET /taiwan/stock/2330.json`

Useful query params:

- `days`: lookback window, default `3`, max `45`.
- `limitPerSource`: items fetched per source, default `20`, max `50`.
- `keyword`: optional keyword filter.
- `sources`: comma-separated source IDs from `/taiwan/sources.json`.
- `maxItems`: max returned items, default `120`, max `300`.
- `newsLimit`: max returned stock-profile news items, default `20`, max `50`.

Stock profile endpoints default to a wider news fetch (`days=30`, `limitPerSource=50`, `maxItems=300`) so company-specific matches are not lost when a third-party source places relevant mentions beyond its first page.

Current Taiwan sources:

- TWSE News — `https://www.twse.com.tw/rwd/zh/news/feed?type=rss`
- CNA Finance — `https://feeds.feedburner.com/rsscna/finance`
- CNA Technology — `https://feeds.feedburner.com/rsscna/technology`
- MoneyDJ Finance News — `https://www.moneydj.com/kmdj/RssCenter.aspx?svc=NW&fno=1&arg=X0000000`
- StatementDog News — `https://statementdog.com/news/latest` (HTML parser fetches the latest 5 pages)
- Cnyes Taiwan Stocks — `https://news.cnyes.com/rss/v1/news/category/tw_stock`
- UDN Money Industry — `https://money.udn.com/rssfeed/news/1001/5591`
- StockFeel — `https://www.stockfeel.com.tw/feed/`
- DIGITIMES Daily — `https://www.digitimes.com/rss/daily.xml`
- TechNews Finance — `https://finance.technews.tw/feed/`
- Business Weekly Investment — `https://www.businessweekly.com.tw/Event/feedsec.aspx?feedid=10&channelid=15`
- TrendForce News — `https://www.trendforce.com/news/feed/`
- Yahoo Taiwan Stock News — `https://tw.stock.yahoo.com/rss?category=news`
- Yahoo Taiwan Stock Research — `https://tw.stock.yahoo.com/rss?category=research`
- Yahoo Taiwan Funds News — `https://tw.stock.yahoo.com/rss?category=funds-news`

Taiwan stock profile combines:

- FinMind `TaiwanStockInfo` for stock ID, company name, market type, and official industry categories.
- StatementDog `/taiex` industry pages for industry groups, upstream/midstream/downstream structure, sub-industries, and company lists.
- `/daily/taiwan.json` RSS layer for related news.

Taiwan stock profile returns two separate news layers:

- `relatedNews`: company-level news that directly matches the stock symbol, company name, or common aliases.
- `supplyChainNews`: industry or supply-chain news matched from the company's StatementDog industry positions.

StatementDog industry map is cached for 12 hours. The service fetches `/taiex`, then fetches industry detail pages only when the cache expires or `refresh=true` is passed.

## Rule

Do not generate a final poster when `marketDataStatus.isFinal` is not `true`.
