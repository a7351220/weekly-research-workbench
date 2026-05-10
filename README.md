# US Daily Market Report

Minimal service for the US daily market report.

This repo keeps only the daily US market digest and poster workflow.

## Production URLs

- Daily HTML: `https://weekly-rss-daily.zeabur.app/daily/us`
- Daily JSON: `https://weekly-rss-daily.zeabur.app/daily/us.json`
- Poster HTML: `https://weekly-rss-daily.zeabur.app/daily`
- Poster JSON: `https://weekly-rss-daily.zeabur.app/daily/us-poster.json`
- Poster SVG: `https://weekly-rss-daily.zeabur.app/daily/us-poster.svg`
- Full calendar HTML: `https://weekly-rss-daily.zeabur.app/daily/calendar`
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

## Rule

Do not generate a final poster when `marketDataStatus.isFinal` is not `true`.
