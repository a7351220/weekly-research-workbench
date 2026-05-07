import { buildNarrativeBundles, buildTopicClusters, enrichWithEditorialSignals, sortItemsForWeekly } from "./editorial";
import { fetchFeed } from "./rss";
import { filterEditorialCachePayload, loadEditorialCache, refreshEditorialCache } from "./signals";
import { SOURCES } from "./sources";
import type { Category, EditorialCachePayload, Env, FeedItem, FeedSource, WeeklyQueryParams } from "./types";
import { jsonResponse, normalizeUrl } from "./utils";

type QuoteKind = "index" | "asset" | "stock";

interface QuoteConfig {
  key: string;
  label: string;
  symbol: string;
  kind: QuoteKind;
  sourceUrl: string;
}

interface QuoteSnapshot {
  key: string;
  label: string;
  symbol: string;
  kind: QuoteKind;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  asOf: string | null;
  sourceUrl: string;
}

interface DailyUsJsonPayload {
  ok: true;
  reportType: "us_daily_market_digest";
  generatedAt: string;
  reportDate: string;
  sourceUrl: string;
  marketSummary: {
    indices: QuoteSnapshot[];
    assets: QuoteSnapshot[];
    megaCaps: QuoteSnapshot[];
  };
  topStories: FeedItem[];
  topAiRadar: FeedItem[];
  earningsRadar: FeedItem[];
  topClusters: ReturnType<typeof buildTopicClusters>;
  topBundles: ReturnType<typeof buildNarrativeBundles>;
  macroCalendar: Array<{ dateLabel: string; timeLabel: string; title: string; sourceUrl: string }>;
  nextSessionWatchlist: Array<{ label: string; rationale: string; sourceUrl?: string | null }>;
  officialCalendars: Array<{ label: string; url: string; note: string }>;
  observables: string[];
  failedFeeds: Array<{ source: string; reason: string; status: number | null }>;
}

const INDEX_QUOTES: QuoteConfig[] = [
  { key: "spx", label: "S&P 500", symbol: ".SPX", kind: "index", sourceUrl: "https://www.cnbc.com/quotes/.SPX" },
  { key: "ndx", label: "Nasdaq Composite", symbol: ".IXIC", kind: "index", sourceUrl: "https://www.cnbc.com/quotes/.IXIC" },
  { key: "dji", label: "Dow Jones", symbol: ".DJI", kind: "index", sourceUrl: "https://www.cnbc.com/quotes/.DJI" },
  { key: "rut", label: "Russell 2000", symbol: ".RUT", kind: "index", sourceUrl: "https://www.cnbc.com/quotes/.RUT" },
  { key: "sox", label: "PHLX SOX", symbol: ".SOX", kind: "index", sourceUrl: "https://www.cnbc.com/quotes/.SOX" },
];

const ASSET_QUOTES: QuoteConfig[] = [
  { key: "vix", label: "VIX", symbol: ".VIX", kind: "asset", sourceUrl: "https://www.cnbc.com/quotes/.VIX" },
  { key: "dxy", label: "DXY", symbol: ".DXY", kind: "asset", sourceUrl: "https://www.cnbc.com/quotes/.DXY" },
  { key: "us10y", label: "US 10Y", symbol: ".TNX", kind: "asset", sourceUrl: "https://www.cnbc.com/quotes/.TNX" },
  { key: "wti", label: "WTI", symbol: "@CL.1", kind: "asset", sourceUrl: "https://www.cnbc.com/quotes/@CL.1" },
  { key: "gold", label: "Gold", symbol: "@GC.1", kind: "asset", sourceUrl: "https://www.cnbc.com/quotes/@GC.1" },
  { key: "btc", label: "BTC", symbol: "BTC.CM=", kind: "asset", sourceUrl: "https://www.cnbc.com/quotes/BTC.CM=" },
];

const MEGACAP_QUOTES: QuoteConfig[] = [
  { key: "aapl", label: "Apple", symbol: "AAPL", kind: "stock", sourceUrl: "https://www.cnbc.com/quotes/AAPL" },
  { key: "msft", label: "Microsoft", symbol: "MSFT", kind: "stock", sourceUrl: "https://www.cnbc.com/quotes/MSFT" },
  { key: "nvda", label: "NVIDIA", symbol: "NVDA", kind: "stock", sourceUrl: "https://www.cnbc.com/quotes/NVDA" },
  { key: "amzn", label: "Amazon", symbol: "AMZN", kind: "stock", sourceUrl: "https://www.cnbc.com/quotes/AMZN" },
  { key: "googl", label: "Alphabet", symbol: "GOOGL", kind: "stock", sourceUrl: "https://www.cnbc.com/quotes/GOOGL" },
  { key: "meta", label: "Meta", symbol: "META", kind: "stock", sourceUrl: "https://www.cnbc.com/quotes/META" },
  { key: "tsla", label: "Tesla", symbol: "TSLA", kind: "stock", sourceUrl: "https://www.cnbc.com/quotes/TSLA" },
];

const OFFICIAL_CALENDARS = [
  {
    label: "Federal Reserve Calendar",
    url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    note: "FOMC dates, minutes, and monetary-policy schedule.",
  },
  {
    label: "BLS Economic Releases",
    url: "https://www.bls.gov/schedule/news_release/",
    note: "CPI, PPI, payrolls, and major labor-market releases.",
  },
  {
    label: "BEA Release Schedule",
    url: "https://www.bea.gov/news/schedule",
    note: "GDP, PCE, trade, and other macro releases.",
  },
  {
    label: "Nasdaq Earnings",
    url: "https://www.nasdaq.com/market-activity/earnings",
    note: "Reference page for upcoming earnings reports.",
  },
];

const NASDAQ_EARNINGS_SOURCE: FeedSource = {
  name: "Nasdaq Earnings Feed",
  url: "https://www.nasdaq.com/feed/rssoutbound?category=earnings",
  category: "us_stocks_macro",
  enabledByDefault: true,
  priority: 72,
  sourceType: "media",
  articleHosts: ["www.nasdaq.com", "nasdaq.com"],
};

export async function handleDailyUs(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const payload = await buildDailyUsPayload(requestUrl, env, request);
  if (requestUrl.pathname.endsWith(".json")) {
    return jsonResponse(payload);
  }

  return new Response(renderDailyUsHtml(payload), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

async function buildDailyUsPayload(requestUrl: URL, env: Env, request?: Request): Promise<DailyUsJsonPayload> {
  const editorialCache = await loadDailyEditorialCache(env);
  const [usNews, aiNews, earningsNews, macroCalendar, indices, assets, megaCaps] = await Promise.all([
    fetchNewsCategory("us_stocks_macro", env, editorialCache, { days: 2, limitPerSource: 8, maxItems: 24 }),
    fetchNewsCategory("ai", env, editorialCache, { days: 3, limitPerSource: 6, maxItems: 12 }),
    fetchSpecificSources([NASDAQ_EARNINGS_SOURCE], editorialCache, { days: 5, limitPerSource: 6, maxItems: 8 }),
    fetchBeaMacroCalendar(),
    fetchQuoteSet(INDEX_QUOTES),
    fetchQuoteSet(ASSET_QUOTES),
    fetchQuoteSet(MEGACAP_QUOTES),
  ]);

  const filteredAi = aiNews.items
    .filter((item) => isUsAiRadar(item))
    .slice(0, 4);
  const earningsRadar = earningsNews.items
    .filter((item) => /\b(earnings|results|guidance|quarter|revenue|eps|after hours|before market)\b/i.test(`${item.title} ${item.description}`))
    .slice(0, 5);

  const combinedForGrouping = sortItemsForWeekly([...usNews.items, ...filteredAi, ...earningsRadar]).slice(0, 24);
  const topClusters = buildTopicClusters(combinedForGrouping).slice(0, 6);
  const topBundles = buildNarrativeBundles(topClusters).slice(0, 4);
  const nextSessionWatchlist = buildNextSessionWatchlist(usNews.items, filteredAi, earningsRadar, macroCalendar, indices, assets, megaCaps);
  const observables = buildObservables(indices, assets, megaCaps, usNews.items);

  return {
    ok: true,
    reportType: "us_daily_market_digest",
    generatedAt: new Date().toISOString(),
    reportDate: getNewYorkDateString(),
    sourceUrl: `${resolvePublicOrigin(requestUrl, request)}/daily/us`,
    marketSummary: {
      indices,
      assets,
      megaCaps,
    },
    topStories: usNews.items.slice(0, 6),
    topAiRadar: filteredAi,
    earningsRadar,
    topClusters,
    topBundles,
    macroCalendar,
    nextSessionWatchlist,
    officialCalendars: OFFICIAL_CALENDARS,
    observables,
    failedFeeds: [...usNews.failedFeeds, ...aiNews.failedFeeds, ...earningsNews.failedFeeds],
  };
}

function resolvePublicOrigin(requestUrl: URL, request?: Request): string {
  if (!request) {
    return requestUrl.origin;
  }
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return requestUrl.origin;
}

async function loadDailyEditorialCache(env: Env): Promise<EditorialCachePayload | null> {
  let editorialCache = await loadEditorialCache(env);
  if (!editorialCache && (env.BLOCKBEATS_API_KEY || env.OPENNEWS_TOKEN || env.TWITTER_TOKEN)) {
    editorialCache = await refreshEditorialCache(env);
  }
  return filterEditorialCachePayload(editorialCache, {
    usePrivateSignals: true,
    useBlockBeats: true,
    useOpenNews: true,
    useTwitterKols: true,
  });
}

async function fetchNewsCategory(
  category: Category,
  env: Env,
  editorialCache: EditorialCachePayload | null,
  options: { days: number; limitPerSource: number; maxItems: number },
): Promise<{ items: FeedItem[]; failedFeeds: Array<{ source: string; reason: string; status: number | null }> }> {
  const params: WeeklyQueryParams = {
    days: options.days,
    limitPerSource: options.limitPerSource,
    includeTaiwan: false,
    categories: [category],
    sources: null,
    usePrivateSignals: true,
    useBlockBeats: true,
    useOpenNews: true,
    useTwitterKols: true,
    keyword: null,
    maxItemsPerCategory: options.maxItems,
  };

  const selectedSources = SOURCES.filter((source) => source.category === category);
  const results = await Promise.all(selectedSources.map((source) => fetchFeed(source, params)));
  const dedupe = new Set<string>();
  const items: FeedItem[] = [];
  const failedFeeds: Array<{ source: string; reason: string; status: number | null }> = [];

  for (const result of results) {
    if (result.failedFeed) {
      failedFeeds.push({
        source: result.failedFeed.source,
        reason: result.failedFeed.reason,
        status: result.failedFeed.status,
      });
    }
    for (const item of result.items) {
      const key = normalizeUrl(item.url);
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      items.push(enrichWithEditorialSignals(item, editorialCache?.topics ?? []));
    }
  }

  return {
    items: sortItemsForWeekly(items).slice(0, options.maxItems),
    failedFeeds,
  };
}

async function fetchSpecificSources(
  sources: FeedSource[],
  editorialCache: EditorialCachePayload | null,
  options: { days: number; limitPerSource: number; maxItems: number },
): Promise<{ items: FeedItem[]; failedFeeds: Array<{ source: string; reason: string; status: number | null }> }> {
  const params: WeeklyQueryParams = {
    days: options.days,
    limitPerSource: options.limitPerSource,
    includeTaiwan: false,
    categories: ["us_stocks_macro"],
    sources: null,
    usePrivateSignals: true,
    useBlockBeats: true,
    useOpenNews: true,
    useTwitterKols: true,
    keyword: null,
    maxItemsPerCategory: options.maxItems,
  };
  const results = await Promise.all(sources.map((source) => fetchFeed(source, params)));
  const dedupe = new Set<string>();
  const items: FeedItem[] = [];
  const failedFeeds: Array<{ source: string; reason: string; status: number | null }> = [];
  for (const result of results) {
    if (result.failedFeed) {
      failedFeeds.push({
        source: result.failedFeed.source,
        reason: result.failedFeed.reason,
        status: result.failedFeed.status,
      });
    }
    for (const item of result.items) {
      const key = normalizeUrl(item.url);
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      items.push(enrichWithEditorialSignals(item, editorialCache?.topics ?? []));
    }
  }
  return { items: sortItemsForWeekly(items).slice(0, options.maxItems), failedFeeds };
}

async function fetchBeaMacroCalendar(): Promise<Array<{ dateLabel: string; timeLabel: string; title: string; sourceUrl: string }>> {
  const url = "https://www.bea.gov/news/schedule";
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "weekly-rss-middleware/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      return [];
    }
    const html = await response.text();
    const entries: Array<{ dateLabel: string; timeLabel: string; title: string; sourceUrl: string; sortKey: number }> = [];
    const rowRegex = /<tr class="scheduled-releases-type-[^"]+">[\s\S]*?<div class="release-date">([^<]+)<\/div>\s*<small class="text-muted">([^<]+)<\/small>[\s\S]*?<td class="release-title[^"]*"[^>]*>([^<]+)<\/td>/g;
    const currentYear = new Date().getFullYear();
    for (const match of html.matchAll(rowRegex)) {
      const [, dateLabelRaw, timeLabelRaw, titleRaw] = match;
      const dateLabel = dateLabelRaw.trim();
      const timeLabel = timeLabelRaw.trim();
      const title = titleRaw.trim();
      const parsed = Date.parse(`${dateLabel}, ${currentYear} ${timeLabel} America/New_York`);
      const fallback = Date.parse(`${dateLabel}, ${currentYear}`);
      const sortKey = Number.isFinite(parsed) ? parsed : (Number.isFinite(fallback) ? fallback : Number.MAX_SAFE_INTEGER);
      entries.push({ dateLabel, timeLabel, title, sourceUrl: url, sortKey });
    }
    const now = Date.now();
    return entries
      .filter((entry) => entry.sortKey >= now - 12 * 60 * 60 * 1000)
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(0, 5)
      .map(({ dateLabel, timeLabel, title, sourceUrl }) => ({ dateLabel, timeLabel, title, sourceUrl }));
  } catch {
    return [];
  }
}

async function fetchQuoteSet(configs: QuoteConfig[]): Promise<QuoteSnapshot[]> {
  return Promise.all(configs.map(fetchQuoteSnapshot));
}

async function fetchQuoteSnapshot(config: QuoteConfig): Promise<QuoteSnapshot> {
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(config.symbol)}&requestMethod=quick`;
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "weekly-rss-middleware/1.0",
        accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) {
      throw new Error(`quote ${config.symbol} failed: ${response.status}`);
    }
    const payload = await response.json() as CnbcQuoteResponse;
    const quote = payload.FormattedQuoteResult?.FormattedQuote?.[0];
    if (!quote || quote.code !== 0) {
      throw new Error(`quote ${config.symbol} unavailable`);
    }
    const price = parseLooseNumber(quote.last);
    const change = parseLooseNumber(quote.change);
    const changePct = parsePercentString(quote.change_pct);
    const previousClose = price !== null && change !== null ? price - change : null;
    const asOf = normalizeCnbcTime(quote.last_time);
    if (config.symbol === ".TNX") {
      return finalizeQuote(config, previousClose !== null ? previousClose / 10 : null, price !== null ? price / 10 : null, null, change !== null ? change / 10 : null, changePct, asOf);
    }
    return finalizeQuote(config, previousClose, price, null, change, changePct, asOf);
  } catch {
    return {
      key: config.key,
      label: config.label,
      symbol: config.symbol,
      kind: config.kind,
      price: null,
      previousClose: null,
      change: null,
      changePct: null,
      asOf: null,
      sourceUrl: config.sourceUrl,
    };
  }
}

function finalizeQuote(
  config: QuoteConfig,
  previousClose: number | null,
  price: number | null,
  regularMarketTime: number | null,
  explicitChange?: number | null,
  explicitChangePct?: number | null,
  explicitAsOf?: string | null,
): QuoteSnapshot {
  const change = explicitChange ?? (price !== null && previousClose !== null ? price - previousClose : null);
  const changePct = explicitChangePct ?? (change !== null && previousClose ? (change / previousClose) * 100 : null);
  return {
    key: config.key,
    label: config.label,
    symbol: config.symbol,
    kind: config.kind,
    price,
    previousClose,
    change,
    changePct,
    asOf: explicitAsOf ?? (regularMarketTime ? new Date(regularMarketTime * 1000).toISOString() : null),
    sourceUrl: config.sourceUrl,
  };
}

function isUsAiRadar(item: FeedItem): boolean {
  const text = `${item.title} ${item.description} ${item.topicEntities.join(" ")} ${item.topicTags.join(" ")}`.toLowerCase();
  return /\b(openai|microsoft|msft|google|alphabet|googl|amazon|amzn|meta|nvidia|nvda|apple|aapl|tesla|tsla|gpu|data center|cloud|capex|ai_infra|model release)\b/.test(text);
}

function buildObservables(
  indices: QuoteSnapshot[],
  assets: QuoteSnapshot[],
  megaCaps: QuoteSnapshot[],
  topStories: FeedItem[],
): string[] {
  const notes: string[] = [];
  const spx = quoteByKey(indices, "spx");
  const ndx = quoteByKey(indices, "ndx");
  const vix = quoteByKey(assets, "vix");
  const us10y = quoteByKey(assets, "us10y");
  const dxy = quoteByKey(assets, "dxy");
  const btc = quoteByKey(assets, "btc");
  const nvda = quoteByKey(megaCaps, "nvda");

  if (spx?.changePct !== null && ndx?.changePct !== null) {
    const spxChange = spx?.changePct;
    const ndxChange = ndx?.changePct;
    if (spxChange !== null && spxChange !== undefined && ndxChange !== null && ndxChange !== undefined) {
      const spread = ndxChange - spxChange;
      if (spread >= 0.8) {
        notes.push(`Nasdaq outperformed the S&P 500 by ${formatSigned(spread, 1)} pts, pointing to growth leadership rather than a broad-value tape.`);
      } else if (spread <= -0.8) {
        notes.push(`S&P 500 held up ${formatSigned(-spread, 1)} pts better than Nasdaq, a sign the tape leaned defensive against growth.`);
      }
    }
  }
  const vixPrice = vix?.price;
  if (vixPrice !== null && vixPrice !== undefined) {
    if (vixPrice >= 25) {
      notes.push(`VIX is still elevated at ${formatNumber(vixPrice, 2)}, so risk appetite remains fragile even if indices bounced.`);
    } else if (vixPrice <= 18) {
      notes.push(`VIX near ${formatNumber(vixPrice, 2)} suggests volatility is calm enough for risk-on narratives to keep working.`);
    }
  }
  const us10yChange = us10y?.change;
  const us10yPrice = us10y?.price;
  if (us10yChange !== null && us10yChange !== undefined && us10yPrice !== null && us10yPrice !== undefined && Math.abs(us10yChange) >= 0.08) {
    notes.push(`US 10Y moved ${formatSigned(us10yChange, 2)} pts to ${formatNumber(us10yPrice, 2)}%, so rates are likely one of the main drivers for the next session.`);
  }
  const dxyChange = dxy?.changePct;
  const spxChange = spx?.changePct;
  if (dxyChange !== null && dxyChange !== undefined && spxChange !== null && spxChange !== undefined && dxyChange >= 0.4 && spxChange <= 0) {
    notes.push(`A stronger dollar (${formatSigned(dxyChange, 2)}%) coincided with softer equities, which usually tightens the market's risk budget.`);
  }
  const btcChange = btc?.changePct;
  const ndxChange2 = ndx?.changePct;
  if (btcChange !== null && btcChange !== undefined && ndxChange2 !== null && ndxChange2 !== undefined && btcChange > 1.5 && ndxChange2 > 1) {
    notes.push(`BTC and Nasdaq both pushed higher, which usually points to a risk-on session rather than a narrow defensive bounce.`);
  }
  const nvdaChange = nvda?.changePct;
  if (nvdaChange !== null && nvdaChange !== undefined && Math.abs(nvdaChange) >= 3) {
    notes.push(`NVIDIA moved ${formatSigned(nvdaChange, 2)}%, which is large enough to keep semis and AI beneficiaries on tomorrow's watchlist.`);
  }
  if (topStories.length > 0) {
    const first = topStories[0];
    notes.push(`Top narrative right now: ${first.title}`);
  }

  return notes.slice(0, 5);
}

function buildNextSessionWatchlist(
  topStories: FeedItem[],
  aiRadar: FeedItem[],
  earningsRadar: FeedItem[],
  macroCalendar: Array<{ dateLabel: string; timeLabel: string; title: string; sourceUrl: string }>,
  indices: QuoteSnapshot[],
  assets: QuoteSnapshot[],
  megaCaps: QuoteSnapshot[],
): Array<{ label: string; rationale: string; sourceUrl?: string | null }> {
  const watchlist: Array<{ label: string; rationale: string; sourceUrl?: string | null }> = [];

  for (const item of [...topStories, ...aiRadar, ...earningsRadar]) {
    if (watchlist.length >= 5) break;
    if (/(earnings|guidance|forecast|cpi|ppi|jobs|payrolls|fomc|fed|treasury|tariff|rate cut|inflation)/i.test(`${item.title} ${item.description}`)) {
      watchlist.push({
        label: item.title,
        rationale: item.description || "Story is likely to shape the next US session.",
        sourceUrl: item.url,
      });
    }
  }
  for (const event of macroCalendar) {
    if (watchlist.length >= 5) break;
    watchlist.push({
      label: `${event.dateLabel} ${event.timeLabel} · ${event.title}`,
      rationale: `Official BEA release on the schedule. This is a hard macro checkpoint for the next US session.`,
      sourceUrl: event.sourceUrl,
    });
  }

  const spx = quoteByKey(indices, "spx");
  const vix = quoteByKey(assets, "vix");
  const us10y = quoteByKey(assets, "us10y");
  const movers = megaCaps
    .filter((quote) => quote.changePct !== null && Math.abs(quote.changePct) >= 2.5)
    .slice(0, 2);

  const spxChange = spx?.changePct;
  if (watchlist.length < 5 && spxChange !== null && spxChange !== undefined) {
    watchlist.push({
      label: "Index follow-through",
      rationale: `S&P 500 closed ${formatSigned(spxChange, 2)}%; the next session should test whether that move broadens or fades.`,
    });
  }
  const vixPrice = vix?.price;
  if (watchlist.length < 5 && vixPrice !== null && vixPrice !== undefined) {
    watchlist.push({
      label: "Volatility check",
      rationale: `VIX at ${formatNumber(vixPrice, 2)} is a quick gauge for whether risk appetite is stabilizing or re-tightening.`,
    });
  }
  const us10yPrice = us10y?.price;
  if (watchlist.length < 5 && us10yPrice !== null && us10yPrice !== undefined) {
    watchlist.push({
      label: "Rates check",
      rationale: `US 10Y ended near ${formatNumber(us10yPrice, 2)}%; another sharp move would likely pressure duration-sensitive tech again.`,
    });
  }
  for (const quote of movers) {
    if (watchlist.length >= 5) break;
    if (quote.changePct === null || quote.changePct === undefined) continue;
    watchlist.push({
      label: `${quote.label} follow-through`,
      rationale: `${quote.label} moved ${formatSigned(quote.changePct, 2)}%; if the move extends, it can drag the broader AI/megacap complex with it.`,
      sourceUrl: quote.sourceUrl,
    });
  }

  return watchlist.slice(0, 5);
}

function renderDailyUsHtml(payload: DailyUsJsonPayload): string {
  const title = `US Daily Market Digest · ${payload.reportDate}`;
  const jsonBlob = escapeHtml(JSON.stringify(payload, null, 2));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --bg:#f7f7f5; --fg:#111; --muted:#666; --line:#d9d9d4; --card:#fff; --accent:#0a66c2; --up:#0c7a43; --down:#b42318; }
    * { box-sizing:border-box; }
    body { margin:0; font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--fg); background:var(--bg); }
    main { max-width:1200px; margin:0 auto; padding:24px; }
    h1,h2,h3 { margin:0 0 10px; line-height:1.2; }
    h1 { font-size:28px; }
    h2 { font-size:18px; margin-top:28px; }
    h3 { font-size:14px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
    p, li { margin:0; }
    .meta { color:var(--muted); margin-top:6px; }
    .grid { display:grid; gap:16px; }
    .grid.cols-3 { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .grid.cols-2 { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .card { background:var(--card); border:1px solid var(--line); padding:16px; }
    .quote-table { width:100%; border-collapse:collapse; }
    .quote-table th, .quote-table td { padding:8px 0; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    .quote-table th { color:var(--muted); font-weight:600; }
    .chg.up { color:var(--up); }
    .chg.down { color:var(--down); }
    .story { border-top:1px solid var(--line); padding-top:12px; margin-top:12px; }
    .story:first-child { border-top:0; padding-top:0; margin-top:0; }
    .story a { color:var(--accent); text-decoration:none; }
    .tags { color:var(--muted); margin-top:6px; font-size:12px; }
    ul.stack { list-style:none; padding:0; margin:0; display:grid; gap:10px; }
    .json-note { color:var(--muted); font-size:12px; margin-top:16px; }
    @media (max-width: 900px) { .grid.cols-3, .grid.cols-2 { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">Generated ${escapeHtml(payload.generatedAt)} · Source of truth for the Custom GPT daily US market workflow.</p>
    </header>

    <section id="market-summary">
      <h2>US Market Summary</h2>
      <div class="grid cols-3">
        ${renderQuoteCard("Major Indices", payload.marketSummary.indices)}
        ${renderQuoteCard("Key Assets", payload.marketSummary.assets)}
        ${renderQuoteCard("Mega Caps", payload.marketSummary.megaCaps)}
      </div>
    </section>

    <section id="top-bundles">
      <h2>Top Story Bundles</h2>
      <div class="grid cols-2">
        ${payload.topBundles.map((bundle) => `
          <article class="card">
            <h3>${escapeHtml(bundle.title)}</h3>
            <p>${escapeHtml(bundle.summary)}</p>
            <p class="tags">stories ${bundle.itemCount} · sources ${bundle.sourceCount} · score ${bundle.totalEditorialScore}</p>
          </article>
        `).join("") || `<article class="card"><p>No bundles formed for this session.</p></article>`}
      </div>
    </section>

    <section id="top-stories">
      <h2>Top Stories</h2>
      <article class="card">
        ${payload.topStories.map((item) => renderStory(item)).join("")}
      </article>
    </section>

    <section id="ai-radar">
      <h2>AI & Big Tech Radar</h2>
      <article class="card">
        ${payload.topAiRadar.map((item) => renderStory(item)).join("") || `<p>No AI / Big Tech radar items cleared the relevance threshold.</p>`}
      </article>
    </section>

    <section id="earnings-radar">
      <h2>Earnings Radar</h2>
      <article class="card">
        ${payload.earningsRadar.map((item) => renderStory(item)).join("") || `<p>No earnings radar items cleared the threshold.</p>`}
      </article>
    </section>

    <section id="macro-calendar">
      <h2>Next Macro Releases</h2>
      <article class="card">
        <ul class="stack">
          ${payload.macroCalendar.map((item) => `
            <li>
              <strong>${escapeHtml(item.dateLabel)} ${escapeHtml(item.timeLabel)}</strong>
              <p>${escapeHtml(item.title)}</p>
              <p class="tags"><a href="${escapeAttribute(item.sourceUrl)}">official schedule</a></p>
            </li>
          `).join("") || `<li>No upcoming macro release entries were parsed from the official schedule.</li>`}
        </ul>
      </article>
    </section>

    <section id="watchlist">
      <h2>Next Session Watchlist</h2>
      <div class="grid cols-2">
        <article class="card">
          <ul class="stack">
            ${payload.nextSessionWatchlist.map((item) => `
              <li>
                <strong>${escapeHtml(item.label)}</strong>
                <p>${escapeHtml(item.rationale)}</p>
                ${item.sourceUrl ? `<p class="tags"><a href="${escapeAttribute(item.sourceUrl)}">source</a></p>` : ``}
              </li>
            `).join("")}
          </ul>
        </article>
        <article class="card">
          <h3>Official Calendars</h3>
          <ul class="stack">
            ${payload.officialCalendars.map((item) => `
              <li>
                <strong><a href="${escapeAttribute(item.url)}">${escapeHtml(item.label)}</a></strong>
                <p>${escapeHtml(item.note)}</p>
              </li>
            `).join("")}
          </ul>
        </article>
      </div>
    </section>

    <section id="observables">
      <h2>Daily Observables</h2>
      <article class="card">
        <ul class="stack">
          ${payload.observables.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </article>
    </section>

    <section id="daily-report-json">
      <h2>Embedded JSON</h2>
      <article class="card">
        <pre>${jsonBlob}</pre>
        <p class="json-note">The Custom GPT should treat this embedded JSON as the authoritative machine-readable payload for the daily report.</p>
      </article>
    </section>
  </main>
  <script id="us-daily-report-json" type="application/json">${jsonBlob}</script>
</body>
</html>`;
}

function renderQuoteCard(title: string, quotes: QuoteSnapshot[]): string {
  return `<article class="card">
    <h3>${escapeHtml(title)}</h3>
    <table class="quote-table">
      <thead><tr><th>Name</th><th>Last</th><th>Chg</th></tr></thead>
      <tbody>
        ${quotes.map((quote) => `
          <tr>
            <td>${escapeHtml(quote.label)}</td>
            <td>${quote.price !== null ? formatNumber(quote.price, quote.kind === "asset" && quote.key === "btc" ? 0 : 2) : "n/a"}</td>
            <td class="chg ${quote.changePct !== null && quote.changePct >= 0 ? "up" : "down"}">
              ${quote.changePct !== null ? `${formatSigned(quote.changePct, 2)}%` : "n/a"}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  </article>`;
}

function renderStory(item: FeedItem): string {
  return `<div class="story">
    <p><a href="${escapeAttribute(item.url)}">${escapeHtml(item.title)}</a></p>
    <p>${escapeHtml(item.description)}</p>
    <p class="tags">${escapeHtml(item.source)} · score ${item.editorialScore} · src ${item.sourceQualityScore} · ev ${item.evidenceScore} · mr ${item.marketReactionScore}</p>
  </div>`;
}

function quoteByKey(items: QuoteSnapshot[], key: string): QuoteSnapshot | undefined {
  return items.find((item) => item.key === key);
}

function formatSigned(value: number, digits: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatNumber(value: number, digits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function getNewYorkDateString(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

interface YahooChartResponse {
  chart?: never;
}

interface CnbcQuoteResponse {
  FormattedQuoteResult?: {
    FormattedQuote?: Array<{
      code?: number;
      last?: string;
      change?: string;
      change_pct?: string;
      last_time?: string;
    }>;
  };
}

function parseLooseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replaceAll(",", "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercentString(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace("%", "").replaceAll(",", "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCnbcTime(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}
