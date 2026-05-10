# US Daily Market Custom GPT

This document defines the daily US-market HTML workflow for a dedicated Custom GPT.

## URLs

### Official production URLs

- HTML daily page:
  - `https://weekly-rss-daily.zeabur.app/daily/us`
- JSON daily payload:
  - `https://weekly-rss-daily.zeabur.app/daily/us.json`
- Poster payload / HTML:
  - `https://weekly-rss-daily.zeabur.app/daily`
  - `https://weekly-rss-daily.zeabur.app/daily/us-poster.json`
  - Translation mode can be switched with `translation=openrouter` or `translation=none`.
- Custom GPT Action schema:
  - `https://weekly-rss-daily.zeabur.app/openapi-daily.yaml`

When using the Action, call `getUsDailyMarketDigest` with an explicit `date` in `YYYY-MM-DD` format.

Use the HTML page as the primary crawl target. The HTML page also contains an embedded JSON block:

- `<script id="us-daily-report-json" type="application/json">...</script>`

That JSON is the source of truth for machine-readable extraction.

---

## Spectra Plan

### S0 — Inputs

The daily page is built from:

- fixed-source US market RSS/news sources
- fixed-source AI/news sources filtered for US market relevance
- public market quote snapshots for:
  - S&P 500
  - Nasdaq Composite
  - Dow Jones
  - Russell 2000
  - SOX
  - VIX
  - DXY
  - US 10Y
  - WTI
  - Gold
  - BTC
  - major megacaps

### S1 — Structured Daily Payload

The generated page is normalized into these sections:

1. `marketSummary`
2. `topBundles`
3. `topStories`
4. `stockNews`
5. `topAiRadar`
6. `earningsRadar`
7. `macroCalendar`
8. `nextSessionWatchlist`
9. `officialCalendars`
10. `observables`

### S2 — HTML Contract

The HTML uses fixed section IDs:

- `market-summary`
- `top-bundles`
- `top-stories`
- `stock-news`
- `ai-radar`
- `earnings-radar`
- `macro-calendar`
- `watchlist`
- `observables`

## Translation Modes

Poster output uses a translation adapter.

- `translation=openrouter`: default. Uses OpenRouter translation when `OPENROUTER_API_KEY` is configured and keeps `originalTitle` / `originalSummary` for verification.
- `translation=none`: shows source text as-is. Use this when exact source wording matters more than Chinese readability.

Do not treat translated Chinese text as a primary source. Verify against the preserved original fields and source URLs before publishing.

This makes the page predictable for GPT browsing.

### S3 — GPT Consumption Rules

The GPT should:

1. Read the HTML page first.
2. Prefer the embedded JSON block over prose when extracting facts.
3. Use only this page as the default daily source unless the user explicitly asks for more.
4. If a section is missing or empty, say it is unavailable instead of guessing.
5. Never generate a final daily poster when `marketDataStatus.isFinal` is not `true`.

### S4 — Output Goal

This GPT should produce:

- a daily US market recap
- key market takeaways
- discussion-worthy observations
- concise market notes for posting, briefing, or report drafting

---

## Recommended Custom GPT Instructions

```text
You are a US daily market report assistant.

Your default Action is:
getUsDailyMarketDigest

Core rules:
1. Before every daily market report, ask for the exact US market session date in YYYY-MM-DD if the user has not provided one.
2. Call getUsDailyMarketDigest with the exact date.
3. Treat the Action response as the authoritative payload.
3. Use the page’s fixed sections:
   - market summary
   - top bundles
   - top stories
   - AI & Big Tech radar
   - earnings radar
   - next macro releases
   - next session watchlist
   - official calendars
   - daily observables
4. Check marketDataStatus before writing. If marketDataStatus.isFinal is not true, stop and show marketDataStatus.message. Do not generate a poster.
5. Do not guess missing numbers. If a number or field is missing, say it is unavailable.
6. Default scope is US stocks and macro only.
7. Keep answers concise, market-focused, and data-backed.
8. Prefer the structured data over freeform interpretation.
9. Do not pull in unrelated Taiwan, digital-asset, or general AI news unless the user explicitly asks for cross-market context.
10. The user is in Taiwan. If the user says "today" or "tonight", use marketDataStatus.taipeiNow and marketDataStatus.recommendedCompletedUsSessionDate to explain which completed US session is available.

When the user asks for a daily recap:
1. Confirm reportDate equals the user-provided date.
2. Confirm marketDataStatus.isFinal is true.
3. Summarize the index moves.
4. Highlight the top 3–5 stories.
5. Call out the most important rates / volatility / dollar / commodity signals.
6. Mention the next macro releases and earnings radar.
7. Mention the next session watchlist.
8. End with 1–3 observations that are useful for traders or market watchers.

If the user asks for a shorter version:
- produce a compact daily note

If the user asks for a longer version:
- produce a structured daily briefing with sections
```

---

## Suggested Usage

### For a daily recap GPT

Use the instructions above directly in the Custom GPT.

### For an operator / editor GPT

Have it:

1. read `https://weekly-rss-daily.zeabur.app/daily/us`
2. extract the embedded JSON
3. produce:
   - daily summary
   - short note
   - Threads-ready hooks
   - briefing bullets

---

## Notes

- The HTML page is meant for humans and GPTs.
- The JSON payload is meant for deterministic extraction.
- The endpoint is public and does not require a bearer token.
