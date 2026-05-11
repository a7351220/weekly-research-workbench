import { buildNarrativeBundles, buildTopicClusters, categoryForSignal, enrichWithEditorialSignals, sortDailyItems } from "./editorial";
import { fetchFeed } from "./rss";
import { filterEditorialCachePayload, loadEditorialCache, refreshEditorialCache } from "./signals";
import { SOURCES } from "./sources";
import type { Category, EditorialCachePayload, Env, FeedItem, FeedQueryParams, FeedSource } from "./types";
import { cleanDescription, computeReportSignals, createStableId, jsonResponse, normalizeUrl, parseDate } from "./utils";

type QuoteKind = "index" | "asset" | "stock";

interface QuoteConfig {
  key: string;
  label: string;
  symbol: string;
  yahooSymbol: string;
  fmpSymbol: string | null;
  kind: QuoteKind;
  sourceUrl: string;
}

interface PricePoint {
  date: string;
  close: number;
}

interface FmpStockNewsRow {
  symbol?: string;
  publishedDate?: string;
  date?: string;
  title?: string;
  text?: string;
  site?: string;
  publisher?: string;
  url?: string;
}

interface PrivateNewsRow {
  source: "opennews" | "blockbeats";
  title: string;
  content: string;
  url: string;
  ts: string;
  engagement: number;
  priority: number;
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
  dataProvider: string | null;
  history: PricePoint[];
}

interface DailyUsJsonPayload {
  ok: true;
  reportType: "us_daily_market_digest";
  generatedAt: string;
  reportDate: string;
  marketDataStatus: {
    requestedDate: string;
    newYorkNow: string;
    taipeiNow: string;
    recommendedCompletedUsSessionDate: string;
    isFinal: boolean;
    status: "final" | "not_final" | "future_date" | "quote_unavailable";
    message: string;
  };
  sourceUrl: string;
  marketSummary: {
    indices: QuoteSnapshot[];
    assets: QuoteSnapshot[];
    megaCaps: QuoteSnapshot[];
  };
  topStories: FeedItem[];
  stockNews: FeedItem[];
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

export type DailyUsPayload = DailyUsJsonPayload;

const INDEX_QUOTES: QuoteConfig[] = [
  { key: "spx", label: "S&P 500", symbol: ".SPX", yahooSymbol: "^GSPC", fmpSymbol: "^GSPC", kind: "index", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-index-price-api" },
  { key: "ndx", label: "Nasdaq Composite", symbol: ".IXIC", yahooSymbol: "^IXIC", fmpSymbol: "^IXIC", kind: "index", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-index-price-api" },
  { key: "dji", label: "Dow Jones", symbol: ".DJI", yahooSymbol: "^DJI", fmpSymbol: "^DJI", kind: "index", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-index-price-api" },
  { key: "rut", label: "Russell 2000", symbol: ".RUT", yahooSymbol: "^RUT", fmpSymbol: "^RUT", kind: "index", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-index-price-api" },
  { key: "sox", label: "PHLX SOX", symbol: ".SOX", yahooSymbol: "^SOX", fmpSymbol: null, kind: "index", sourceUrl: "https://finance.yahoo.com/quote/%5ESOX/history" },
];

const ASSET_QUOTES: QuoteConfig[] = [
  { key: "vix", label: "VIX", symbol: ".VIX", yahooSymbol: "^VIX", fmpSymbol: "^VIX", kind: "asset", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-index-price-api" },
  { key: "dxy", label: "DXY", symbol: ".DXY", yahooSymbol: "DX-Y.NYB", fmpSymbol: null, kind: "asset", sourceUrl: "https://finance.yahoo.com/quote/DX-Y.NYB/history" },
  { key: "us10y", label: "US 10Y", symbol: ".TNX", yahooSymbol: "^TNX", fmpSymbol: null, kind: "asset", sourceUrl: "https://finance.yahoo.com/quote/%5ETNX/history" },
  { key: "wti", label: "WTI", symbol: "@CL.1", yahooSymbol: "CL=F", fmpSymbol: null, kind: "asset", sourceUrl: "https://finance.yahoo.com/quote/CL%3DF/history" },
  { key: "gold", label: "Gold", symbol: "@GC.1", yahooSymbol: "GC=F", fmpSymbol: "GCUSD", kind: "asset", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-commodity-prices-api" },
  { key: "btc", label: "BTC", symbol: "BTC.CM=", yahooSymbol: "BTC-USD", fmpSymbol: "BTCUSD", kind: "asset", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-cryptocurrency-prices-api" },
];

const MEGACAP_QUOTES: QuoteConfig[] = [
  { key: "aapl", label: "Apple", symbol: "AAPL", yahooSymbol: "AAPL", fmpSymbol: "AAPL", kind: "stock", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-stock-data-free-api" },
  { key: "msft", label: "Microsoft", symbol: "MSFT", yahooSymbol: "MSFT", fmpSymbol: "MSFT", kind: "stock", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-stock-data-free-api" },
  { key: "nvda", label: "NVIDIA", symbol: "NVDA", yahooSymbol: "NVDA", fmpSymbol: "NVDA", kind: "stock", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-stock-data-free-api" },
  { key: "amzn", label: "Amazon", symbol: "AMZN", yahooSymbol: "AMZN", fmpSymbol: "AMZN", kind: "stock", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-stock-data-free-api" },
  { key: "googl", label: "Alphabet", symbol: "GOOGL", yahooSymbol: "GOOGL", fmpSymbol: "GOOGL", kind: "stock", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-stock-data-free-api" },
  { key: "meta", label: "Meta", symbol: "META", yahooSymbol: "META", fmpSymbol: "META", kind: "stock", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-stock-data-free-api" },
  { key: "tsla", label: "Tesla", symbol: "TSLA", yahooSymbol: "TSLA", fmpSymbol: "TSLA", kind: "stock", sourceUrl: "https://site.financialmodelingprep.com/developer/docs/historical-stock-data-free-api" },
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

const SEEKING_ALPHA_EARNINGS_SOURCE: FeedSource = {
  name: "Seeking Alpha Earnings",
  url: "https://seekingalpha.com/news/earnings/feed",
  category: "us_stocks_macro",
  enabledByDefault: true,
  priority: 78,
  sourceType: "media",
  articleHosts: ["seekingalpha.com", "www.seekingalpha.com"],
};

const SEEKING_ALPHA_STOCK_SYMBOLS = ["NVDA", "AMD", "MSFT", "GOOGL", "DELL", "SMCI", "AAPL", "AMZN", "META", "TSLA"];
const TICKERTICK_SYMBOLS = ["aapl", "msft", "nvda", "amzn", "goog", "googl", "meta", "tsla", "amd", "dell", "smci", "intc", "avgo", "orcl", "pltr", "crwv"];
const TICKERTICK_AI_SYMBOLS = ["nvda", "amd", "dell", "smci", "msft", "goog", "googl", "avgo", "orcl", "pltr", "crwv"];

interface TickerTickStory {
  id?: string | number;
  title?: string;
  description?: string;
  url?: string;
  site?: string;
  time?: number;
  tags?: string[];
  tickers?: string[];
}

export async function handleDailyUs(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const reportDate = resolveReportDate(requestUrl);
  if (!reportDate) {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid date",
        message: "date must use YYYY-MM-DD format.",
      },
      { status: 400 },
    );
  }
  const payload = await buildDailyUsPayload(requestUrl, env, reportDate, request);
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

export async function buildDailyUsPayload(requestUrl: URL, env: Env, reportDate: string, request?: Request): Promise<DailyUsJsonPayload> {
  const includePrivateNews = shouldFetchPrivateNews(requestUrl, env);
  const cacheKey = `daily-us:v12:${reportDate}:private-${includePrivateNews ? "1" : "0"}`;
  const cached = await env.EDITORIAL_CACHE?.get(cacheKey, "json");
  if (isDailyUsPayload(cached)) {
    return {
      ...cached,
      sourceUrl: buildDailySourceUrl(requestUrl, request, reportDate),
    };
  }

  const editorialCache = includePrivateNews ? await loadDailyEditorialCache(env) : null;
  const marketDataStatus = getMarketDataStatus(reportDate);
  const [usNews, aiNews, earningsNews, seekingAlphaStockNews, tickerTickNews, macroCalendar, datedStockNews] = await Promise.all([
    fetchNewsCategory("us_stocks_macro", env, editorialCache, { days: 2, limitPerSource: 20, maxItems: 60 }),
    fetchNewsCategory("ai", env, editorialCache, { days: 3, limitPerSource: 6, maxItems: 12 }),
    fetchSpecificSources([NASDAQ_EARNINGS_SOURCE, SEEKING_ALPHA_EARNINGS_SOURCE], editorialCache, { days: 5, limitPerSource: 6, maxItems: 10 }),
    fetchSpecificSources(buildSeekingAlphaStockSources(), editorialCache, { days: 5, limitPerSource: 4, maxItems: 36 }),
    fetchTickerTickNews(reportDate, editorialCache),
    fetchBeaMacroCalendar(),
    fetchDatedStockNews(reportDate, env, editorialCache),
  ]);
  const [indices, assets, megaCaps] = marketDataStatus.isFinal
    ? await fetchDailyQuoteGroups(reportDate, env)
    : [INDEX_QUOTES.map(emptyQuote), ASSET_QUOTES.map(emptyQuote), MEGACAP_QUOTES.map(emptyQuote)];
  const seekingAlphaStockItems = seekingAlphaStockNews.items.filter(isExternalMarketNews);
  const tickerTickItems = tickerTickNews.items.filter(isExternalMarketNews);

  const filteredAi = aiNews.items
    .filter((item) => isUsAiRadar(item))
    .slice(0, 4);
  const earningsRadar = earningsNews.items
    .filter((item) => /\b(earnings|results|guidance|quarter|revenue|eps|after hours|before market)\b/i.test(`${item.title} ${item.description}`))
    .slice(0, 5);
  const privateNews = includePrivateNews ? await fetchPrivateNewsItems(env, editorialCache, reportDate) : emptyPrivateNewsItems();
  const topStories = sortDailyItems([...usNews.items, ...seekingAlphaStockItems, ...tickerTickItems, ...privateNews.us])
    .filter(isDailyTopStoryCandidate)
    .slice(0, 60);
  const topAiRadar = sortDailyItems([...filteredAi, ...tickerTickItems, ...privateNews.ai])
    .filter((item) => isUsAiRadar(item))
    .slice(0, 6);
  const stockNews = buildStockNews([...datedStockNews.items, ...seekingAlphaStockItems, ...tickerTickItems], topStories, topAiRadar, earningsRadar, reportDate);

  const combinedForGrouping = sortDailyItems([...topStories, ...topAiRadar, ...earningsRadar]).slice(0, 24);
  const topClusters = buildTopicClusters(combinedForGrouping).slice(0, 6);
  const topBundles = buildNarrativeBundles(topClusters).slice(0, 4);
  const nextSessionWatchlist = buildNextSessionWatchlist(topStories, topAiRadar, earningsRadar, macroCalendar, indices, assets, megaCaps);
  const observables = buildObservables(indices, assets, megaCaps, topStories);
  const finalMarketDataStatus = validateQuoteCompleteness(marketDataStatus, indices);

  const payload: DailyUsJsonPayload = {
    ok: true,
    reportType: "us_daily_market_digest",
    generatedAt: new Date().toISOString(),
    reportDate,
    marketDataStatus: finalMarketDataStatus,
    sourceUrl: buildDailySourceUrl(requestUrl, request, reportDate),
    marketSummary: {
      indices,
      assets,
      megaCaps,
    },
    topStories,
    stockNews,
    topAiRadar,
    earningsRadar,
    topClusters,
    topBundles,
    macroCalendar,
    nextSessionWatchlist,
    officialCalendars: OFFICIAL_CALENDARS,
    observables,
    failedFeeds: [...usNews.failedFeeds, ...aiNews.failedFeeds, ...earningsNews.failedFeeds, ...seekingAlphaStockNews.failedFeeds, ...tickerTickNews.failedFeeds, ...datedStockNews.failedFeeds, ...privateNews.failedFeeds],
  };

  const cacheTtl = finalMarketDataStatus.status === "quote_unavailable" ? 60 : 6 * 60 * 60;
  await env.EDITORIAL_CACHE?.put(cacheKey, JSON.stringify(payload), { expirationTtl: cacheTtl });
  return payload;
}

function isDailyUsPayload(value: unknown): value is DailyUsJsonPayload {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { ok?: unknown }).ok === true
    && (value as { reportType?: unknown }).reportType === "us_daily_market_digest"
    && Array.isArray((value as { stockNews?: unknown }).stockNews),
  );
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

function resolveReportDate(requestUrl: URL): string | null {
  const date = requestUrl.searchParams.get("date");
  if (!date) {
    return getRecommendedCompletedUsSessionDate(getNewYorkClockParts());
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10) === date ? date : null;
}

function buildDailySourceUrl(requestUrl: URL, request: Request | undefined, reportDate: string): string {
  const url = new URL(`${resolvePublicOrigin(requestUrl, request)}/daily/us`);
  if (requestUrl.searchParams.has("date")) {
    url.searchParams.set("date", reportDate);
  }
  return url.toString();
}

function getMarketDataStatus(reportDate: string): DailyUsJsonPayload["marketDataStatus"] {
  const newYork = getNewYorkClockParts();
  const taipei = getTimeZoneClockParts("Asia/Taipei");
  const newYorkNow = `${newYork.date} ${newYork.time} America/New_York`;
  const taipeiNow = `${taipei.date} ${taipei.time} Asia/Taipei`;
  const recommendedCompletedUsSessionDate = getRecommendedCompletedUsSessionDate(newYork);

  if (reportDate > newYork.date) {
    return {
      requestedDate: reportDate,
      newYorkNow,
      taipeiNow,
      recommendedCompletedUsSessionDate,
      isFinal: false,
      status: "future_date",
      message: `Requested date is later than the current New York date. Market data is not available yet. For Taiwan users, the latest completed US session is ${recommendedCompletedUsSessionDate}.`,
    };
  }

  if (reportDate === newYork.date && newYork.minutesSinceMidnight < 17 * 60 + 30) {
    return {
      requestedDate: reportDate,
      newYorkNow,
      taipeiNow,
      recommendedCompletedUsSessionDate,
      isFinal: false,
      status: "not_final",
      message: `US market close data is not final yet. Taiwan time is ${taipeiNow}; the latest completed US session is ${recommendedCompletedUsSessionDate}. Quotes are intentionally returned as N/A to avoid using intraday numbers.`,
    };
  }

  return {
    requestedDate: reportDate,
    newYorkNow,
    taipeiNow,
    recommendedCompletedUsSessionDate,
    isFinal: true,
    status: "final",
    message: "Historical close data is final enough for the daily digest.",
  };
}

function validateQuoteCompleteness(
  status: DailyUsJsonPayload["marketDataStatus"],
  indices: QuoteSnapshot[],
): DailyUsJsonPayload["marketDataStatus"] {
  if (!status.isFinal) {
    return status;
  }
  const requiredKeys = new Set(["spx", "ndx", "dji"]);
  const missing = indices
    .filter((quote) => requiredKeys.has(quote.key))
    .filter((quote) => quote.price === null || quote.previousClose === null || quote.changePct === null || quote.asOf !== status.requestedDate)
    .map((quote) => quote.label);
  if (missing.length === 0) {
    return status;
  }
  return {
    ...status,
    isFinal: false,
    status: "quote_unavailable",
    message: `Required historical close data is unavailable for: ${missing.join(", ")}. Do not generate a poster with market numbers. For Taiwan users, the latest completed US session is ${status.recommendedCompletedUsSessionDate}.`,
  };
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

function shouldFetchPrivateNews(requestUrl: URL, env: Env): boolean {
  return requestUrl.searchParams.get("privateNews") === "true" || env.ENABLE_PRIVATE_NEWS === "true";
}

function emptyPrivateNewsItems(): { us: FeedItem[]; ai: FeedItem[]; failedFeeds: Array<{ source: string; reason: string; status: number | null }> } {
  return { us: [], ai: [], failedFeeds: [] };
}

function buildSeekingAlphaStockSources(): FeedSource[] {
  return SEEKING_ALPHA_STOCK_SYMBOLS.map((symbol) => ({
    name: `Seeking Alpha ${symbol}`,
    url: `https://seekingalpha.com/api/sa/combined/${symbol.toLowerCase()}.xml`,
    category: "us_stocks_macro",
    enabledByDefault: true,
    priority: 76,
    sourceType: "media",
    articleHosts: ["seekingalpha.com", "www.seekingalpha.com"],
  }));
}

async function fetchTickerTickNews(
  reportDate: string,
  editorialCache: EditorialCachePayload | null,
): Promise<{ items: FeedItem[]; failedFeeds: Array<{ source: string; reason: string; status: number | null }> }> {
  const symbolQuery = TICKERTICK_SYMBOLS.map((symbol) => `tt:${symbol}`).join(" ");
  const aiSymbolQuery = TICKERTICK_AI_SYMBOLS.map((symbol) => `tt:${symbol}`).join(" ");
  const queries = [
    { label: "TickerTick Curated", q: `(and T:curated (or ${symbolQuery}))`, priority: 84 },
    { label: "TickerTick Earnings", q: `(and T:earning (or ${symbolQuery}))`, priority: 82 },
    { label: "TickerTick AI Infrastructure", q: `(and T:industry (or ${aiSymbolQuery}))`, priority: 80 },
  ];

  const failedFeeds: Array<{ source: string; reason: string; status: number | null }> = [];
  const allItems: FeedItem[] = [];

  for (const query of queries) {
    const url = new URL("https://api.tickertick.com/feed");
    url.searchParams.set("q", query.q);
    url.searchParams.set("n", "30");
    try {
      const response = await fetch(url.toString(), {
        headers: {
          "user-agent": "us-daily-market-report/1.0",
          accept: "application/json,text/plain,*/*",
        },
      });
      if (!response.ok) {
        failedFeeds.push({ source: query.label, reason: "Fetch failed or non-200 response", status: response.status });
        continue;
      }
      const payload = await response.json() as { stories?: TickerTickStory[] } | TickerTickStory[];
      const stories = Array.isArray(payload) ? payload : (Array.isArray(payload.stories) ? payload.stories : []);
      const items = await Promise.all(
        stories
          .filter((story) => isTickerTickStoryInWindow(story, reportDate))
          .map((story) => tickerTickStoryToFeedItem(story, query.label, query.priority, editorialCache?.topics ?? [])),
      );
      allItems.push(...items.filter((item): item is FeedItem => item !== null));
    } catch (error) {
      failedFeeds.push({
        source: query.label,
        reason: error instanceof Error ? error.message : "Unknown TickerTick error",
        status: null,
      });
    }
    await delay(150);
  }

  const dedupe = new Set<string>();
  const items = sortDailyItems(allItems)
    .filter((item) => {
      const key = normalizeUrl(item.url);
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return isExternalMarketNews(item);
    })
    .slice(0, 40);

  return { items, failedFeeds };
}

async function tickerTickStoryToFeedItem(
  story: TickerTickStory,
  sourceLabel: string,
  sourcePriority: number,
  topics: EditorialCachePayload["topics"],
): Promise<FeedItem | null> {
  const title = cleanDescription(story.title ?? "", 300);
  const url = normalizeUrl(story.url ?? "");
  if (!title || !url) return null;

  const description = cleanDescription(story.description || story.title || "", 500);
  const publishedAt = parseDate(normalizeTickerTickTime(story.time));
  const source = story.site ? `TickerTick ${story.site}` : sourceLabel;
  const category = categoryForSignal(title, description);
  const report = computeReportSignals(title, description, "media");

  return enrichWithEditorialSignals(
    {
      id: await createStableId(source, url),
      source,
      category,
      sourceType: "media",
      sourcePriority,
      title,
      url,
      publishedAt: publishedAt.publishedAt,
      description,
      rawDescription: story.description ?? null,
      matchedKeywords: [],
      ageHours: publishedAt.ageHours,
      dateQuality: publishedAt.dateQuality,
      reportScore: report.score,
      reportSignals: report.signals,
      evidenceScore: 0,
      substantiationScore: 0,
      storyValueScore: 0,
      penaltyScore: 0,
      sourceQualityScore: 0,
      corroborationScore: 0,
      marketReactionScore: 0,
      editorialScore: 0,
      editorialSignals: ["source:ticker_tick", ...(story.tags ?? []).slice(0, 4).map((tag) => `tickertick:${tag}`)],
      topicTags: [],
      topicEntities: story.tickers?.slice(0, 6) ?? [],
      crossSourceCount: 0,
      socialProof: 0,
      eventType: null,
      majorEntity: null,
      marketTheme: null,
      clusterKey: "",
    },
    topics,
  );
}

function isTickerTickStoryInWindow(story: TickerTickStory, reportDate: string): boolean {
  const publishedAt = normalizeTickerTickTime(story.time);
  if (!publishedAt) return false;
  const publishedMs = Date.parse(publishedAt);
  if (!Number.isFinite(publishedMs)) return false;
  const parts = getZonedDateParts(new Date(publishedMs), "America/New_York");
  return parts.date >= reportDate && parts.date <= addUtcDays(reportDate, 3);
}

function normalizeTickerTickTime(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const ms = value < 1_000_000_000_000 ? value * 1000 : value;
  return new Date(ms).toISOString();
}

async function fetchNewsCategory(
  category: Category,
  env: Env,
  editorialCache: EditorialCachePayload | null,
  options: { days: number; limitPerSource: number; maxItems: number },
): Promise<{ items: FeedItem[]; failedFeeds: Array<{ source: string; reason: string; status: number | null }> }> {
  const params: FeedQueryParams = {
    days: options.days,
    limitPerSource: options.limitPerSource,
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
    items: sortDailyItems(items).slice(0, options.maxItems),
    failedFeeds,
  };
}

async function fetchSpecificSources(
  sources: FeedSource[],
  editorialCache: EditorialCachePayload | null,
  options: { days: number; limitPerSource: number; maxItems: number },
): Promise<{ items: FeedItem[]; failedFeeds: Array<{ source: string; reason: string; status: number | null }> }> {
  const params: FeedQueryParams = {
    days: options.days,
    limitPerSource: options.limitPerSource,
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
  return { items: sortDailyItems(items).slice(0, options.maxItems), failedFeeds };
}

async function fetchPrivateNewsItems(
  env: Env,
  editorialCache: EditorialCachePayload | null,
  reportDate: string,
): Promise<{ us: FeedItem[]; ai: FeedItem[]; failedFeeds: Array<{ source: string; reason: string; status: number | null }> }> {
  const signals = editorialCache?.signals.filter((signal) => signal.source === "opennews" || signal.source === "blockbeats") ?? [];
  const cachedItems = await Promise.all(
    signals
      .filter((signal) => isPrivateSignalInWindow(signal.publishedAt, reportDate))
      .filter(isDailyPrivateSignal)
      .map((signal) => privateSignalToFeedItem(signal, editorialCache?.topics ?? [])),
  );
  const directOpenNews = await fetchOpenNewsFeedItems(env, editorialCache?.topics ?? [], reportDate);
  const items = [...cachedItems, ...directOpenNews.items];
  const dedupe = new Set<string>();
  const us: FeedItem[] = [];
  const ai: FeedItem[] = [];
  for (const item of items.filter((item): item is FeedItem => item !== null)) {
    const key = normalizeUrl(item.url);
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    if (item.category === "ai") {
      ai.push(item);
    } else {
      us.push(item);
    }
  }
  return {
    us: sortDailyItems(us).slice(0, 40),
    ai: sortDailyItems(ai).slice(0, 20),
    failedFeeds: directOpenNews.failedFeeds,
  };
}

async function privateSignalToFeedItem(signal: EditorialCachePayload["signals"][number], topics: EditorialCachePayload["topics"]): Promise<FeedItem | null> {
  return privateRawNewsToFeedItem(
    {
      source: signal.source === "blockbeats" ? "blockbeats" : "opennews",
      title: signal.title,
      content: signal.content,
      url: signal.url,
      ts: signal.publishedAt ?? "",
      engagement: signal.engagement,
      priority: signal.priority,
    },
    topics,
  );
}

async function fetchOpenNewsFeedItems(
  env: Env,
  topics: EditorialCachePayload["topics"],
  reportDate: string,
): Promise<{ items: FeedItem[]; failedFeeds: Array<{ source: string; reason: string; status: number | null }> }> {
  if (!env.OPENNEWS_TOKEN) {
    return { items: [], failedFeeds: [] };
  }

  try {
    const response = await fetch("https://ai.6551.io/open/news_search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENNEWS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ limit: 80, page: 1 }),
    });
    if (!response.ok) {
      return {
        items: [],
        failedFeeds: [{ source: "OpenNews", reason: "Fetch failed or non-200 response", status: response.status }],
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rawData = data.data;
    const rawItems = Array.isArray(rawData)
      ? rawData
      : (((rawData as Record<string, unknown> | undefined)?.data ??
          (rawData as Record<string, unknown> | undefined)?.list ??
          []) as Array<Record<string, unknown>>);
    const items = await Promise.all(
      rawItems
        .map((item) => ({
          source: "opennews" as const,
          title: stringOrEmpty(item.text) || stringOrEmpty(item.title),
          content: stringOrEmpty(item.description),
          url: stringOrEmpty(item.link),
          ts: stringOrEmpty(item.ts),
          engagement: numberOrZero(item.likes) + numberOrZero(item.score),
          priority: 84,
        }))
        .filter((row) => row.title && row.url)
        .filter((row) => isPrivateSignalInWindow(normalizePrivateDate(row.ts), reportDate))
        .filter((row) => isDailyPrivateText(row.title, row.content))
        .map((row) => privateRawNewsToFeedItem(row, topics)),
    );

    return {
      items: sortDailyItems(items.filter((item): item is FeedItem => item !== null)),
      failedFeeds: [],
    };
  } catch (error) {
    return {
      items: [],
      failedFeeds: [{ source: "OpenNews", reason: error instanceof Error ? error.message : "Unknown OpenNews error", status: null }],
    };
  }
}

async function privateRawNewsToFeedItem(row: PrivateNewsRow, topics: EditorialCachePayload["topics"]): Promise<FeedItem | null> {
  const title = cleanDescription(row.title, 300);
  const url = normalizeUrl(row.url);
  if (!title || !url) return null;
  const description = cleanDescription(row.content || row.title, 500);
  const date = parseDate(normalizePrivateDate(row.ts));
  const source = row.source === "opennews" ? "OpenNews" : "BlockBeats";
  const sourcePriority = row.priority || (row.source === "opennews" ? 84 : 76);
  const category = categoryForSignal(title, description);
  const report = computeReportSignals(title, description, "media");
  return enrichWithEditorialSignals(
    {
      id: await createStableId(source, url),
      source,
      category,
      sourceType: "media",
      sourcePriority,
      title,
      url,
      publishedAt: date.publishedAt,
      description,
      rawDescription: row.content || null,
      matchedKeywords: [],
      ageHours: date.ageHours,
      dateQuality: date.dateQuality,
      reportScore: report.score,
      reportSignals: report.signals,
      evidenceScore: 0,
      substantiationScore: 0,
      storyValueScore: 0,
      penaltyScore: 0,
      sourceQualityScore: 0,
      corroborationScore: 0,
      marketReactionScore: 0,
      editorialScore: 0,
      editorialSignals: [`private:${row.source}`],
      topicTags: [],
      topicEntities: [],
      crossSourceCount: 0,
      socialProof: row.engagement,
      eventType: null,
      majorEntity: null,
      marketTheme: null,
      clusterKey: "",
    },
    topics,
  );
}

function isPrivateSignalInWindow(publishedAt: string | null, reportDate: string): boolean {
  if (!publishedAt) return true;
  const publishedMs = Date.parse(publishedAt);
  if (!Number.isFinite(publishedMs)) return false;
  const parts = getZonedDateParts(new Date(publishedMs), "America/New_York");
  return parts.date >= addUtcDays(reportDate, -1) && parts.date <= addUtcDays(reportDate, 3);
}

function isDailyPrivateSignal(signal: EditorialCachePayload["signals"][number]): boolean {
  return isDailyPrivateText(signal.title, signal.content);
}

function isDailyPrivateText(title: string, content: string): boolean {
  const text = `${title} ${content}`.toLowerCase();
  return /\b(s&p|spx|nasdaq|dow jones|russell|fed|fomc|powell|treasury|yield|10-year|rate cut|inflation|cpi|ppi|pce|payroll|jobs|labor market|earnings|revenue|eps|guidance|shares|stock|apple|aapl|microsoft|msft|nvidia|nvda|amazon|amzn|alphabet|google|googl|meta|tesla|tsla|amd|dell|super micro|smci|intel|intc|visa|broadcom|oracle|palantir|coreweave|openai|ai|artificial intelligence|data center|gpu|chip|semiconductor|cloud|capex|inference|tariff|white house|trump|sec)\b/i.test(text);
}

function isExternalMarketNews(item: FeedItem): boolean {
  const text = `${item.title} ${item.description}`;
  if (isWeakLifestyleOrAdviceText(text)) return false;
  const hasCompany = hasTrackedCompany(text);
  const hasCatalyst = hasMarketCatalystText(text);
  const hasMarketData = /\b(\$?\d+(?:\.\d+)?\s?(?:%|billion|million|trillion|bps|mw|gw)|q[1-4]|fy\d{4}|revenue|eps|earnings|guidance|shares|stock|price target|market cap)\b/i.test(text);
  const hasInfrastructureTheme = /\b(ai chip|ai server|ai infrastructure|data center|gpu|semiconductor|custom chip|private credit|financing deal|ipo|capex|cloud)\b/i.test(text);
  return (hasCompany && (hasCatalyst || hasMarketData)) || hasInfrastructureTheme;
}

function isDailyTopStoryCandidate(item: FeedItem): boolean {
  const text = `${item.title} ${item.description}`;
  if (isWeakLifestyleOrAdviceText(text)) return false;
  if (/\b(earnings call transcript|earnings call presentation|earnings call highlights|week in review|weekly review|roundup|earnings scoreboard)\b/i.test(text)) return false;
  const hasMajorMarketContext = /\b(s&p 500|spx|nasdaq|dow jones|russell|fed|fomc|powell|treasury|yield|10-year|rate cut|inflation|cpi|ppi|pce|payroll|jobs|labor market|tariff|white house|trump|oil|dollar|bitcoin|btc|crypto)\b/i.test(text);
  return hasMajorMarketContext || isExternalMarketNews(item);
}

function hasTrackedCompany(text: string): boolean {
  return STOCK_NEWS_PATTERNS.some(([, pattern]) => pattern.test(text));
}

function hasMarketCatalystText(text: string): boolean {
  return /\b(earnings|results|guidance|revenue|eps|profit|margin|surged|soared|jumped|rallied|fell|dropped|slid|record high|all-time high|price target|upgrade|downgrade|deal|deals|partnership|contract|acquisition|investment|equity bet|investigation|lawsuit|white house|trump|tariff|ai server|ai infrastructure|data center|gpu|chip|semiconductor|cloud|capex|inference|financing|ipo|forecast|demand|orders|shipment|production)\b/i.test(text);
}

function isWeakLifestyleOrAdviceText(text: string): boolean {
  return /\b(should you buy|better buy|best buy|worth buying|top stock to buy|buy now|sell now|reasons to buy|prediction:|outperform the s&p 500|flagship tech etf|next nvidia|challenger|loading up|you'd invested|start buying|maternity leave|best companies to work|workplace|dating app|movie|streaming guide)\b/i.test(text);
}

function normalizePrivateDate(input: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^\d{10,13}$/.test(trimmed)) {
    const numeric = Number(trimmed);
    const ms = trimmed.length === 10 ? numeric * 1000 : numeric;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? trimmed : new Date(parsed).toISOString();
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function fetchDatedStockNews(
  reportDate: string,
  env: Env,
  editorialCache: EditorialCachePayload | null,
): Promise<{ items: FeedItem[]; failedFeeds: Array<{ source: string; reason: string; status: number | null }> }> {
  if (!env.FMP_API_KEY) {
    return { items: [], failedFeeds: [] };
  }

  const symbols = STOCK_NEWS_PATTERNS.map(([symbol]) => symbol).join(",");
  const toDate = addUtcDays(reportDate, 1);
  const urls = [
    `https://financialmodelingprep.com/stable/news/stock?symbols=${encodeURIComponent(symbols)}&from=${reportDate}&to=${toDate}&limit=100&apikey=${encodeURIComponent(env.FMP_API_KEY)}`,
    `https://financialmodelingprep.com/api/v3/stock_news?tickers=${encodeURIComponent(symbols)}&from=${reportDate}&to=${toDate}&limit=100&apikey=${encodeURIComponent(env.FMP_API_KEY)}`,
  ];

  const failedFeeds: Array<{ source: string; reason: string; status: number | null }> = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "us-daily-market-report/1.0",
          accept: "application/json,text/plain,*/*",
        },
      });
      if (!response.ok) {
        failedFeeds.push({ source: "Financial Modeling Prep Stock News", reason: "Fetch failed or non-200 response", status: response.status });
        continue;
      }
      const payload = await response.json() as FmpStockNewsRow[] | { Error?: string };
      if (!Array.isArray(payload)) {
        failedFeeds.push({ source: "Financial Modeling Prep Stock News", reason: "Unexpected stock news payload", status: null });
        continue;
      }
      const items = await Promise.all(payload.map((row) => transformFmpStockNews(row)));
      return {
        items: sortDailyItems(
          items
            .filter((item): item is FeedItem => item !== null)
            .map((item) => enrichWithEditorialSignals(item, editorialCache?.topics ?? [])),
        ),
        failedFeeds: [],
      };
    } catch (error) {
      failedFeeds.push({
        source: "Financial Modeling Prep Stock News",
        reason: error instanceof Error ? error.message : "Unknown stock news error",
        status: null,
      });
    }
  }

  return { items: [], failedFeeds };
}

async function transformFmpStockNews(row: FmpStockNewsRow): Promise<FeedItem | null> {
  const title = cleanDescription(row.title ?? "", 300);
  const url = normalizeUrl(row.url ?? "");
  if (!title || !url) return null;

  const description = cleanDescription(row.text ?? row.title ?? "", 500);
  const publishedAt = parseFmpPublishedAt(row.publishedDate ?? row.date ?? null);
  const source = row.site || row.publisher || `FMP ${row.symbol ?? "Stock News"}`;
  const report = computeReportSignals(title, description, "media");

  return {
    id: await createStableId(source, url),
    source,
    category: "us_stocks_macro",
    sourceType: "media",
    sourcePriority: 78,
    title,
    url,
    publishedAt: publishedAt.publishedAt,
    description,
    rawDescription: row.text ?? null,
    matchedKeywords: [],
    ageHours: publishedAt.ageHours,
    dateQuality: publishedAt.dateQuality,
    reportScore: report.score,
    reportSignals: report.signals,
    evidenceScore: 0,
    substantiationScore: 0,
    storyValueScore: 0,
    penaltyScore: 0,
    sourceQualityScore: 0,
    corroborationScore: 0,
    marketReactionScore: 0,
    editorialScore: 0,
    editorialSignals: [],
    topicTags: [],
    topicEntities: [],
    crossSourceCount: 0,
    socialProof: 0,
    eventType: null,
    majorEntity: null,
    marketTheme: null,
    clusterKey: "",
  };
}

function parseFmpPublishedAt(value: string | null): ReturnType<typeof parseDate> {
  if (!value) return parseDate(null);
  const trimmed = value.trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return parseDate(trimmed);
  }
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (!match) return parseDate(trimmed);
  const [, date, time] = match;
  const offset = isNewYorkDstDate(date) ? "-04:00" : "-05:00";
  return parseDate(`${date}T${time}${offset}`);
}

const STOCK_NEWS_PATTERNS: Array<[string, RegExp]> = [
  ["AAPL", /\b(apple|aapl)\b/i],
  ["MSFT", /\b(microsoft|msft)\b/i],
  ["NVDA", /\b(nvidia|nvda)\b/i],
  ["AMZN", /\b(amazon|amzn)\b/i],
  ["GOOGL", /\b(alphabet|google|googl|goog)\b/i],
  ["META", /\b(meta|facebook)\b/i],
  ["TSLA", /\b(tesla|tsla)\b/i],
  ["AMD", /\b(amd|advanced micro devices)\b/i],
  ["DELL", /\b(dell)\b/i],
  ["SMCI", /\b(super micro|supermicro|smci)\b/i],
  ["INTC", /\b(intel|intc)\b/i],
  ["V", /\b(visa)\b/i],
  ["AVGO", /\b(broadcom|avgo)\b/i],
  ["ORCL", /\b(oracle|orcl)\b/i],
  ["PLTR", /\b(palantir|pltr)\b/i],
  ["CRWV", /\b(coreweave|crwv)\b/i],
];

function buildStockNews(
  datedStockNews: FeedItem[],
  topStories: FeedItem[],
  aiRadar: FeedItem[],
  earningsRadar: FeedItem[],
  reportDate: string,
): FeedItem[] {
  const strictCandidates = buildStockNewsCandidates(
    [...datedStockNews, ...topStories, ...aiRadar, ...earningsRadar],
    reportDate,
    "strict",
  );
  if (strictCandidates.length > 0) {
    return strictCandidates.slice(0, 8);
  }

  return buildStockNewsCandidates(
    [...topStories, ...aiRadar, ...earningsRadar],
    reportDate,
    "fallback",
  ).slice(0, 8);
}

function buildStockNewsCandidates(
  items: FeedItem[],
  reportDate: string,
  mode: "strict" | "fallback",
): FeedItem[] {
  const dedupe = new Set<string>();
  return items
    .filter((item) => isIndividualStockNews(item, reportDate, mode))
    .filter((item) => {
      const key = normalizeUrl(item.url);
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    })
    .sort((a, b) => stockNewsScore(b) - stockNewsScore(a));
}

function isIndividualStockNews(item: FeedItem, reportDate: string, mode: "strict" | "fallback"): boolean {
  const text = `${item.title} ${item.description}`;
  if (/^Nasdaq(?:\s|$)/i.test(item.source)) {
    return false;
  }
  if (mode === "strict" && !isReportSessionItem(item, reportDate)) {
    return false;
  }
  if (mode === "fallback" && !isRecentStockFallbackItem(item, reportDate)) {
    return false;
  }
  if (mode === "fallback" && !isAllowedStockFallbackSource(item.source)) {
    return false;
  }
  if (/\b(pre-market earnings report|after-hours earnings report|earnings report for may|most active|daily dividend report|week in review|weekly review|roundup|earnings scoreboard|earnings call transcript|earnings call presentation)\b/i.test(text)) {
    return false;
  }
  if (/\b(s&p 500|nasdaq 100|dow jones|major indexes|stock market today)\b/i.test(text) && !STOCK_NEWS_PATTERNS.some(([, pattern]) => pattern.test(text))) {
    return false;
  }
  const hasCompany = hasTrackedCompany(text);
  const hasConcreteCatalyst = hasMarketCatalystText(text);
  if (isWeakLifestyleOrAdviceText(text)) {
    return false;
  }
  return hasCompany && hasConcreteCatalyst;
}

function isAllowedStockFallbackSource(source: string): boolean {
  return /^(OpenNews|BlockBeats|Yahoo Finance|CNBC Markets|WSJ Markets|WSJ Markets Legacy|Financial Modeling Prep|FMP|TickerTick|Seeking Alpha)\b/i.test(source);
}

function stockNewsScore(item: FeedItem): number {
  const text = `${item.title} ${item.description}`;
  let score = item.editorialScore + item.marketReactionScore * 0.35 + item.storyValueScore * 0.25 + item.sourcePriority * 0.15;
  if (/\b(earnings|results|guidance|revenue|eps|profit|margin)\b/i.test(text)) score += 24;
  if (/\b(surged|soared|jumped|rallied|fell|dropped|slid|record high|all-time high|%\b)\b/i.test(text)) score += 18;
  if (/\b(ai|data center|server|gpu|chip|semiconductor|cloud|inference)\b/i.test(text)) score += 12;
  if (item.publishedAt) score += 8;
  return score;
}

function isReportSessionItem(item: FeedItem, reportDate: string): boolean {
  if (!item.publishedAt) return false;
  const publishedMs = Date.parse(item.publishedAt);
  if (!Number.isFinite(publishedMs)) return false;
  const parts = getZonedDateParts(new Date(publishedMs), "America/New_York");
  if (parts.date === reportDate) return true;
  return parts.date === addUtcDays(reportDate, 1) && parts.minutesSinceMidnight <= 3 * 60;
}

function isRecentStockFallbackItem(item: FeedItem, reportDate: string): boolean {
  if (!item.publishedAt) return false;
  const publishedMs = Date.parse(item.publishedAt);
  if (!Number.isFinite(publishedMs)) return false;
  const parts = getZonedDateParts(new Date(publishedMs), "America/New_York");
  return parts.date >= reportDate && parts.date <= addUtcDays(reportDate, 3);
}

function isNewYorkDstDate(date: string): boolean {
  const year = Number(date.slice(0, 4));
  if (!Number.isFinite(year)) return true;
  const start = nthWeekdayOfMonthUtc(year, 2, 0, 2);
  const end = nthWeekdayOfMonthUtc(year, 10, 0, 1);
  const current = Date.parse(`${date}T12:00:00Z`);
  return current >= start && current < end;
}

function nthWeekdayOfMonthUtc(year: number, monthIndex: number, weekday: number, nth: number): number {
  const first = new Date(Date.UTC(year, monthIndex, 1, 12));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return Date.UTC(year, monthIndex, day, 12);
}

async function fetchBeaMacroCalendar(): Promise<Array<{ dateLabel: string; timeLabel: string; title: string; sourceUrl: string }>> {
  const url = "https://www.bea.gov/news/schedule";
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "us-daily-market-report/1.0",
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

async function fetchQuoteSet(configs: QuoteConfig[], reportDate: string, env: Env): Promise<QuoteSnapshot[]> {
  const quotes: QuoteSnapshot[] = [];
  for (const config of configs) {
    quotes.push(await fetchHistoricalQuoteSnapshot(config, reportDate, env));
    await delay(250);
  }
  return quotes;
}

async function fetchDailyQuoteGroups(reportDate: string, env: Env): Promise<[QuoteSnapshot[], QuoteSnapshot[], QuoteSnapshot[]]> {
  const indices = await fetchQuoteSet(INDEX_QUOTES, reportDate, env);
  await delay(500);
  const assets = await fetchQuoteSet(ASSET_QUOTES, reportDate, env);
  await delay(500);
  const megaCaps = await fetchQuoteSet(MEGACAP_QUOTES, reportDate, env);
  return [indices, assets, megaCaps];
}

async function fetchHistoricalQuoteSnapshot(config: QuoteConfig, reportDate: string, env: Env): Promise<QuoteSnapshot> {
  if (env.FMP_API_KEY && config.fmpSymbol) {
    const fmpQuote = await fetchFmpQuoteSnapshot(config, reportDate, env.FMP_API_KEY);
    if (fmpQuote.price !== null) {
      return fmpQuote;
    }
  }

  const startDate = addUtcDays(reportDate, -10);
  const endDate = addUtcDays(reportDate, 1);
  const period1 = Math.floor(Date.parse(`${startDate}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.parse(`${endDate}T00:00:00Z`) / 1000);

  const encodedSymbol = encodeURIComponent(config.yahooSymbol);
  const yahooUrls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?period1=${period1}&period2=${period2}&interval=1d&events=history`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?period1=${period1}&period2=${period2}&interval=1d&events=history`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?range=10d&interval=1d&events=history`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?range=10d&interval=1d&events=history`,
  ];

  for (const url of yahooUrls) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; us-daily-market-report/1.0)",
          accept: "application/json,text/plain,*/*",
        },
      });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json() as YahooChartResponse;
      const quote = parseYahooHistoricalQuote(config, reportDate, payload, url.includes("query2") ? "query2" : "query1");
      if (quote.price !== null) {
        return quote;
      }
    } catch {
      continue;
    }
  }

  return emptyQuote(config);
}

function parseYahooHistoricalQuote(
  config: QuoteConfig,
  reportDate: string,
  payload: YahooChartResponse,
  hostLabel: string,
): QuoteSnapshot {
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const rows = timestamps
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close: typeof closes[index] === "number" && Number.isFinite(closes[index]) ? closes[index] : null,
    }))
    .filter((row) => row.close !== null && row.date <= reportDate);
  const currentIndex = rows.findIndex((row) => row.date === reportDate);
  if (currentIndex <= 0) {
    return emptyQuote(config);
  }
  const current = rows[currentIndex];
  const previous = rows[currentIndex - 1];
  return finalizeQuote(
    config,
    previous.close,
    current.close,
    null,
    null,
    null,
    current.date,
    `Yahoo Finance historical chart (${hostLabel})`,
    rows.map((row) => ({ date: row.date, close: row.close! })).slice(-10),
  );
}

async function fetchFmpQuoteSnapshot(config: QuoteConfig, reportDate: string, apiKey: string): Promise<QuoteSnapshot> {
  if (!config.fmpSymbol) {
    return emptyQuote(config);
  }
  const from = addUtcDays(reportDate, -10);
  const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(config.fmpSymbol)}&from=${from}&to=${reportDate}&apikey=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "us-daily-market-report/1.0",
        accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) {
      throw new Error(`fmp quote ${config.fmpSymbol} failed: ${response.status}`);
    }
    const rows = await response.json() as FmpHistoricalRow[] | { Error?: string };
    if (!Array.isArray(rows)) {
      throw new Error(`fmp quote ${config.fmpSymbol} unavailable`);
    }
    const sortedRows = rows
      .filter((row) => typeof row.close === "number" && row.date <= reportDate)
      .sort((a, b) => a.date.localeCompare(b.date));
    const currentIndex = sortedRows.findIndex((row) => row.date === reportDate);
    if (currentIndex <= 0) {
      throw new Error(`fmp quote ${config.fmpSymbol} missing report date ${reportDate}`);
    }
    const current = sortedRows[currentIndex];
    const previous = sortedRows[currentIndex - 1];
    return finalizeQuote(config, previous.close, current.close, null, null, null, current.date, "Financial Modeling Prep EOD", sortedRows.map((row) => ({ date: row.date, close: row.close })).slice(-10));
  } catch {
    return emptyQuote(config);
  }
}

async function fetchQuoteSnapshot(config: QuoteConfig): Promise<QuoteSnapshot> {
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(config.symbol)}&requestMethod=quick`;
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "us-daily-market-report/1.0",
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
      return finalizeQuote(config, previousClose !== null ? previousClose / 10 : null, price !== null ? price / 10 : null, null, change !== null ? change / 10 : null, changePct, asOf, "CNBC realtime quote");
    }
    return finalizeQuote(config, previousClose, price, null, change, changePct, asOf, "CNBC realtime quote");
  } catch {
    return emptyQuote(config);
  }
}

function emptyQuote(config: QuoteConfig): QuoteSnapshot {
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
    dataProvider: null,
    history: [],
  };
}

function finalizeQuote(
  config: QuoteConfig,
  previousClose: number | null,
  price: number | null,
  regularMarketTime: number | null,
  explicitChange?: number | null,
  explicitChangePct?: number | null,
  explicitAsOf?: string | null,
  dataProvider?: string | null,
  history: PricePoint[] = [],
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
    dataProvider: dataProvider ?? null,
    history,
  };
}

function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    <section id="stock-news">
      <h2>Individual Stock News</h2>
      <article class="card">
        ${payload.stockNews.map((item) => renderStory(item)).join("") || `<p>No individual stock news cleared the threshold.</p>`}
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
  return getTimeZoneClockParts("America/New_York").date;
}

function getNewYorkClockParts(): { date: string; time: string; minutesSinceMidnight: number } {
  return getTimeZoneClockParts("America/New_York");
}

function getTimeZoneClockParts(timeZone: string): { date: string; time: string; minutesSinceMidnight: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date,
    time: `${parts.hour}:${parts.minute}`,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

function getZonedDateParts(date: Date, timeZone: string): { date: string; minutesSinceMidnight: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

function getRecommendedCompletedUsSessionDate(newYork: { date: string; minutesSinceMidnight: number }): string {
  const targetDate = newYork.minutesSinceMidnight >= 17 * 60 + 30
    ? newYork.date
    : addUtcDays(newYork.date, -1);
  return previousWeekday(targetDate);
}

function previousWeekday(date: string): string {
  let cursor = date;
  while (true) {
    const day = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) {
      return cursor;
    }
    cursor = addUtcDays(cursor, -1);
  }
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
}

interface FmpHistoricalRow {
  symbol?: string;
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
  change?: number;
  changePercent?: number;
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
