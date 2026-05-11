import { buildNarrativeBundles, buildTopicClusters, sortDailyItems } from "./editorial";
import { fetchFeed } from "./rss";
import { TAIWAN_SOURCES } from "./sources";
import type { Env, FeedItem, FeedQueryParams, FeedSource } from "./types";
import { jsonResponse, normalizeKeyword, normalizeUrl, parseNumber } from "./utils";

interface TaiwanSourceStatus {
  id: string;
  name: string;
  sourceType: FeedSource["sourceType"];
  priority: number;
  enabledByDefault: boolean;
  url: string;
}

interface DailyTaiwanPayload {
  ok: true;
  reportType: "taiwan_daily_research";
  generatedAt: string;
  reportDate: string;
  timezone: "Asia/Taipei";
  query: {
    days: number;
    limitPerSource: number;
    keyword: string | null;
    selectedSources: string[];
  };
  sourceSummary: {
    totalSources: number;
    activeSources: number;
    totalItems: number;
    failedFeeds: Array<{ source: string; reason: string; status: number | null }>;
  };
  sources: TaiwanSourceStatus[];
  topStories: FeedItem[];
  stockNews: FeedItem[];
  industryNews: FeedItem[];
  topClusters: ReturnType<typeof buildTopicClusters>;
  topBundles: ReturnType<typeof buildNarrativeBundles>;
  allItems: FeedItem[];
}

const TRACKED_TAIWAN_ENTITIES: Array<[string, RegExp, string[]]> = [
  ["tsmc", /\b(2330|tsmc)\b|台積電|台積|台积电/i, ["semiconductor", "index_weight"]],
  ["foxconn", /\b(2317|hon hai|foxconn)\b|鴻海|鸿海/i, ["ai_server", "electronics"]],
  ["mediatek", /\b(2454|mediatek)\b|聯發科|联发科|發哥|发哥/i, ["semiconductor", "mobile_chip"]],
  ["quanta", /\b(2382|quanta)\b|廣達|广达/i, ["ai_server"]],
  ["wistron", /\b(3231|wistron)\b|緯創|纬创/i, ["ai_server"]],
  ["wiwynn", /\b(6669|wiwynn)\b|緯穎|纬颖/i, ["ai_server"]],
  ["asic", /\b(3661|3443)\b|世芯|創意|创意/i, ["asic", "semiconductor"]],
  ["ase", /\b(3711|ase)\b|日月光/i, ["packaging", "semiconductor"]],
  ["umc", /\b(2303|umc)\b|聯電|联电/i, ["foundry", "semiconductor"]],
  ["delta", /\b(2308|delta)\b|台達電|台达电/i, ["power", "ai_server"]],
  ["thermal", /\b(3017|3653)\b|奇鋐|健策|双鸿|雙鴻/i, ["thermal", "ai_server"]],
  ["pcb", /\b(2383|3037)\b|台光電|欣興|臻鼎|健鼎/i, ["pcb", "ai_server"]],
];

const TAIWAN_EVENT_PATTERNS: Array<[string, RegExp, number, string[]]> = [
  ["market_move", /台股|加權指數|集中市場|櫃買|大盤|上市|上櫃|成交量|創高|新高|重挫|大漲|漲停|跌停|收漲|收跌/i, 22, ["market_move"]],
  ["institution_flow", /外資|投信|自營商|三大法人|買超|賣超|融資|融券|借券/i, 22, ["fund_flow"]],
  ["earnings", /營收|財報|獲利|每股盈餘|EPS|毛利率|法說|展望|財測|股利|配息|除權息/i, 24, ["earnings"]],
  ["ai_supply_chain", /\b(ai|nvidia|gb200|gb300|blackwell|server|gpu|asic|cowos|hbm|pcb)\b|人工智慧|輝達|伺服器|資料中心|數據中心|先進封裝|晶片|半導體|散熱|液冷|電源|光通訊|供應鏈/i, 26, ["ai_supply_chain"]],
  ["macro_fx", /新台幣|台幣|匯率|央行|出口|景氣|PMI|通膨|利率|關稅|美債|美元/i, 18, ["macro_fx"]],
  ["official_disclosure", /重大訊息|公告|董事會|處分|取得|投資|併購|合併|公開收購|注意股|處置/i, 18, ["official_disclosure"]],
];

const LOW_SIGNAL_TAIWAN_PATTERNS = /活動|講座|論壇|徵才|抽獎|開箱|懶人包|生活|旅遊|房市|保險|信用卡|ETF排行榜|基金排行榜/i;

export async function handleDailyTaiwan(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const payload = await buildDailyTaiwanPayload(requestUrl, env);
  if (requestUrl.pathname.endsWith(".json")) {
    return jsonResponse(payload);
  }

  return new Response(renderDailyTaiwanHtml(payload), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export function handleTaiwanSources(): Response {
  return jsonResponse({
    ok: true,
    category: "taiwan_stocks",
    totalSources: TAIWAN_SOURCES.length,
    sources: TAIWAN_SOURCES.map(toSourceStatus),
  });
}

export async function buildDailyTaiwanPayload(requestUrl: URL, env: Env): Promise<DailyTaiwanPayload> {
  const params = parseTaiwanParams(requestUrl);
  const cacheKey = `daily-taiwan:v3:${params.reportDate}:days-${params.feedParams.days}:limit-${params.feedParams.limitPerSource}:max-${params.maxItems}:kw-${params.feedParams.keyword || "none"}:sources-${params.selectedSourceIds.join(".") || "default"}`;
  const cached = await env.EDITORIAL_CACHE?.get(cacheKey, "json");
  if (isDailyTaiwanPayload(cached)) {
    return cached;
  }

  const selectedSources = selectTaiwanSources(params.selectedSourceIds);
  const results = await Promise.all(selectedSources.map((source) => fetchFeed(source, params.feedParams)));
  const failedFeeds = results
    .map((result) => result.failedFeed)
    .filter((feed): feed is NonNullable<typeof feed> => Boolean(feed))
    .map((feed) => ({
      source: feed.source,
      reason: feed.reason,
      status: feed.status,
    }));
  const rawItems = results.flatMap((result) => result.items);
  const allItems = sortDailyItems(dedupeItems(rawItems.map(enrichTaiwanItem)))
    .filter(isUsefulTaiwanItem)
    .slice(0, params.maxItems);
  const topStories = sortTaiwanTopStories(allItems.filter(isTaiwanTopStory)).slice(0, 12);
  const stockNews = sortTaiwanTopStories(allItems.filter(isTaiwanStockNews)).slice(0, 16);
  const industryNews = sortTaiwanTopStories(allItems.filter(isTaiwanIndustryNews)).slice(0, 16);
  const topClusters = buildTopicClusters(allItems.slice(0, 80)).slice(0, 12);
  const topBundles = buildNarrativeBundles(topClusters).slice(0, 8);

  const payload: DailyTaiwanPayload = {
    ok: true,
    reportType: "taiwan_daily_research",
    generatedAt: new Date().toISOString(),
    reportDate: params.reportDate,
    timezone: "Asia/Taipei",
    query: {
      days: params.feedParams.days,
      limitPerSource: params.feedParams.limitPerSource,
      keyword: params.feedParams.keyword,
      selectedSources: selectedSources.map((source) => source.name),
    },
    sourceSummary: {
      totalSources: TAIWAN_SOURCES.length,
      activeSources: selectedSources.length,
      totalItems: allItems.length,
      failedFeeds,
    },
    sources: selectedSources.map(toSourceStatus),
    topStories,
    stockNews,
    industryNews,
    topClusters,
    topBundles,
    allItems,
  };

  await env.EDITORIAL_CACHE?.put(cacheKey, JSON.stringify(payload), { expirationTtl: 20 * 60 });
  return payload;
}

function parseTaiwanParams(requestUrl: URL): {
  reportDate: string;
  feedParams: FeedQueryParams;
  selectedSourceIds: string[];
  maxItems: number;
} {
  const reportDate = parseReportDate(requestUrl.searchParams.get("date")) || getTaipeiDate();
  const days = parseNumber(requestUrl.searchParams.get("days"), 3, { min: 1, max: 45 });
  const limitPerSource = parseNumber(requestUrl.searchParams.get("limitPerSource"), 20, { min: 1, max: 50 });
  const maxItems = parseNumber(requestUrl.searchParams.get("maxItems"), 120, { min: 10, max: 300 });
  const keyword = normalizeKeyword(requestUrl.searchParams.get("keyword"));
  const selectedSourceIds = parseSourceIds(requestUrl.searchParams.get("sources") || requestUrl.searchParams.get("source"));
  return {
    reportDate,
    feedParams: {
      days,
      limitPerSource,
      keyword,
      maxItemsPerCategory: maxItems,
    },
    selectedSourceIds,
    maxItems,
  };
}

function parseReportDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

function getTaipeiDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseSourceIds(value: string | null): string[] {
  if (!value || value === "default" || value === "all") return [];
  return value
    .split(",")
    .map((item) => sourceId(item))
    .filter(Boolean);
}

function selectTaiwanSources(selectedSourceIds: string[]): FeedSource[] {
  const allowed = new Set(selectedSourceIds);
  if (allowed.size === 0) {
    return TAIWAN_SOURCES.filter((source) => source.enabledByDefault);
  }
  return TAIWAN_SOURCES.filter((source) => allowed.has(sourceId(source.name)));
}

function toSourceStatus(source: FeedSource): TaiwanSourceStatus {
  return {
    id: sourceId(source.name),
    name: source.name,
    sourceType: source.sourceType,
    priority: source.priority,
    enabledByDefault: source.enabledByDefault,
    url: source.url,
  };
}

function sourceId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function dedupeItems(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeUrl(item.url) || `${item.source}:${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enrichTaiwanItem(item: FeedItem): FeedItem {
  const text = `${item.title} ${item.description}`;
  const tags = new Set<string>();
  const entities = new Set<string>();
  const signals: string[] = [];
  let score = item.reportScore + Math.round(item.sourcePriority / 3);
  let eventType: string | null = null;
  let majorEntity: string | null = null;

  if (item.sourceType === "official") {
    score += 20;
    signals.push("official_source");
  }

  for (const [entity, pattern, entityTags] of TRACKED_TAIWAN_ENTITIES) {
    if (!pattern.test(text)) continue;
    entities.add(entity);
    if (!majorEntity) majorEntity = entity;
    for (const tag of entityTags) tags.add(tag);
  }

  for (const [event, pattern, weight, eventTags] of TAIWAN_EVENT_PATTERNS) {
    if (!pattern.test(text)) continue;
    score += weight;
    eventType ??= event;
    signals.push(event);
    for (const tag of eventTags) tags.add(tag);
  }

  const numbers = text.match(/\d[\d,.]*(?:\.\d+)?\s?(?:%|億|兆|萬|元|美元|點|張|股|bps|GW|MW)?/gi) ?? [];
  if (numbers.length >= 2) {
    score += 14;
    signals.push("number_dense");
  } else if (numbers.length === 1) {
    score += 6;
  }

  if (item.publishedAt) score += 8;
  if (item.ageHours !== null && item.ageHours <= 36) {
    score += 10;
    signals.push("fresh");
  }
  if (LOW_SIGNAL_TAIWAN_PATTERNS.test(text)) {
    score -= 28;
    signals.push("low_signal");
  }

  const marketTheme = deriveTaiwanTheme(tags, eventType);
  const sourceQualityScore = item.sourceType === "official" ? 92 : item.sourceType === "research" ? 78 : Math.min(84, 45 + item.sourcePriority / 2);
  const evidenceScore = Math.min(100, numbers.length * 12 + (item.sourceType === "official" ? 28 : 10));
  const storyValueScore = Math.min(100, Math.max(0, score));
  const clusterKey = ["taiwan_stocks", marketTheme || eventType || "general", majorEntity || firstTag(tags) || "market"].join("|");

  return {
    ...item,
    sourceQualityScore,
    evidenceScore,
    substantiationScore: Math.min(100, Math.round((sourceQualityScore + evidenceScore) / 2)),
    storyValueScore,
    penaltyScore: Math.max(0, -Math.min(0, score)),
    marketReactionScore: tags.has("market_move") || tags.has("fund_flow") ? 72 : 35,
    editorialScore: Math.min(100, Math.max(0, score)),
    editorialSignals: unique([...item.editorialSignals, ...signals]),
    topicTags: unique([...item.topicTags, ...tags]),
    topicEntities: unique([...item.topicEntities, ...entities]),
    eventType,
    majorEntity,
    marketTheme,
    clusterKey,
  };
}

function deriveTaiwanTheme(tags: Set<string>, eventType: string | null): string | null {
  if (tags.has("ai_supply_chain") || tags.has("ai_server") || tags.has("semiconductor")) return "taiwan_ai_supply_chain";
  if (tags.has("earnings") || eventType === "earnings") return "taiwan_earnings";
  if (tags.has("fund_flow")) return "taiwan_fund_flow";
  if (tags.has("market_move")) return "taiwan_market_move";
  if (tags.has("macro_fx")) return "taiwan_macro_fx";
  if (tags.has("official_disclosure")) return "taiwan_disclosure";
  return null;
}

function isUsefulTaiwanItem(item: FeedItem): boolean {
  if (!item.url || !item.title) return false;
  if (item.editorialScore < 38) return false;
  return !LOW_SIGNAL_TAIWAN_PATTERNS.test(`${item.title} ${item.description}`) || item.editorialScore >= 70;
}

function isTaiwanTopStory(item: FeedItem): boolean {
  const text = `${item.title} ${item.description}`;
  if (isTaiwanFundOrEtfStory(text)) {
    return false;
  }
  if (isAdministrativeTaiwanNotice(text) && !hasTaiwanMarketStorySignal(item)) {
    return false;
  }
  return item.editorialScore >= 58 && hasTaiwanMarketStorySignal(item);
}

function isTaiwanStockNews(item: FeedItem): boolean {
  const text = `${item.title} ${item.description}`;
  if (isTaiwanFundOrEtfStory(text)) return false;
  return hasExplicitTaiwanCompany(text)
    && (item.editorialScore >= 52 || /營收|財報|法說|股價|漲停|跌停|買超|賣超|目標價|訂單|出貨|供應鏈/i.test(text));
}

function isTaiwanIndustryNews(item: FeedItem): boolean {
  const text = `${item.title} ${item.description}`;
  if (isTaiwanFundOrEtfStory(text)) return false;
  if (/Yahoo Taiwan Funds News/i.test(item.source)) return false;
  return hasExplicitTaiwanIndustrySignal(text);
}

function firstTag(tags: Set<string>): string | null {
  return tags.values().next().value ?? null;
}

function hasTaiwanMarketStorySignal(item: FeedItem): boolean {
  const tags = new Set(item.topicTags);
  const text = `${item.title} ${item.description}`;
  return item.topicEntities.length > 0
    || tags.has("fund_flow")
    || tags.has("ai_supply_chain")
    || tags.has("semiconductor")
    || tags.has("ai_server")
    || tags.has("market_move")
    || tags.has("macro_fx")
    || /台股|加權指數|櫃買|外資|三大法人|買超|賣超|融資|融券|台積電|鴻海|聯發科|廣達|緯創|緯穎|營收|財報|法說|AI|輝達|伺服器|半導體|供應鏈|匯率|台幣/i.test(text);
}

function hasExplicitTaiwanCompany(text: string): boolean {
  return /\b(2330|2317|2454|2382|3231|6669|3661|3443|3711|2303|2308|3017|3653|2383|3037)\b|台積電|鴻海|聯發科|廣達|緯創|緯穎|世芯|創意|日月光|聯電|台達電|奇鋐|雙鴻|健策|台光電|欣興|臻鼎|健鼎|群創|群光|京元電|元太/i.test(text);
}

function hasExplicitTaiwanIndustrySignal(text: string): boolean {
  return /\b(ai|nvidia|gb200|gb300|blackwell|gpu|asic|cowos|hbm|pcb)\b|輝達|伺服器|資料中心|數據中心|半導體|晶片|晶圓|先進封裝|封測|散熱|液冷|電源|光通訊|矽光子|面板級封裝|AI供應鏈|AI 供應鏈|供應鏈|記憶體|DRAM|NAND/i.test(text);
}

function isTaiwanFundOrEtfStory(text: string): boolean {
  return /ETF|基金|投信募集|掛牌上市|主動式|受益憑證|除息|配息|成分股|淨值|高息|市值型|不敗教主|\b00(?:50|6208|[89]\d{3}[A-Z]?)\b/i.test(text);
}

function isAdministrativeTaiwanNotice(text: string): boolean {
  return /權證|預收足額款券|恢復交易|停止買賣|產業類別|違約金|創新板上市|掛牌上市|受益憑證|ETF|公告|處分|注意股|處置/i.test(text)
    && !/台股|加權指數|櫃買|外資|三大法人|營收|財報|獲利|法說|AI|輝達|伺服器|半導體|供應鏈|台積電|鴻海|聯發科|廣達|緯創|緯穎/i.test(text);
}

function sortTaiwanTopStories(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => taiwanStoryRank(b) - taiwanStoryRank(a));
}

function taiwanStoryRank(item: FeedItem): number {
  const tags = new Set(item.topicTags);
  const text = `${item.title} ${item.description}`;
  let score = item.editorialScore;
  if (item.topicEntities.length > 0) score += 24;
  if (tags.has("ai_supply_chain") || tags.has("semiconductor") || tags.has("ai_server")) score += 18;
  if (tags.has("fund_flow")) score += 18;
  if (tags.has("market_move")) score += 14;
  if (tags.has("earnings")) score += 14;
  if (/台積電|鴻海|聯發科|廣達|緯創|緯穎|世芯|創意|日月光|聯電/i.test(text)) score += 16;
  if (isAdministrativeTaiwanNotice(text)) score -= 42;
  return score;
}

function unique<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

function isDailyTaiwanPayload(value: unknown): value is DailyTaiwanPayload {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { ok?: unknown }).ok === true
    && (value as { reportType?: unknown }).reportType === "taiwan_daily_research"
    && Array.isArray((value as { allItems?: unknown }).allItems),
  );
}

function renderDailyTaiwanHtml(payload: DailyTaiwanPayload): string {
  const jsonBlob = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>台股新聞研究 · ${escapeHtml(payload.reportDate)}</title>
  <style>
    body{margin:0;background:#f7f4ed;color:#171717;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Noto Sans TC",sans-serif}
    main{max-width:1100px;margin:0 auto;padding:28px}
    header{border-bottom:2px solid #171717;padding-bottom:18px;margin-bottom:22px}
    h1{font-size:42px;margin:0 0 8px;letter-spacing:-.04em}
    h2{font-size:20px;margin:28px 0 12px}
    .meta{color:#666}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
    article{background:#fff;border:1px solid #d8d0c2;border-radius:14px;padding:14px}
    a{color:#111;text-decoration:none}
    a:hover{text-decoration:underline}
    .source{font-size:12px;color:#777;margin-top:10px}
    pre{white-space:pre-wrap;overflow:auto;background:#111;color:#eee;border-radius:14px;padding:16px}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>台股新聞研究</h1>
      <p class="meta">${escapeHtml(payload.reportDate)} · ${payload.sourceSummary.activeSources}/${payload.sourceSummary.totalSources} sources · ${payload.sourceSummary.totalItems} items</p>
    </header>
    <section>
      <h2>今日主線</h2>
      <div class="grid">${payload.topStories.slice(0, 6).map(renderItem).join("") || "<p>暫無符合條件的主線。</p>"}</div>
    </section>
    <section>
      <h2>個股新聞</h2>
      <div class="grid">${payload.stockNews.slice(0, 8).map(renderItem).join("") || "<p>暫無符合條件的個股新聞。</p>"}</div>
    </section>
    <section>
      <h2>產業新聞</h2>
      <div class="grid">${payload.industryNews.slice(0, 8).map(renderItem).join("") || "<p>暫無符合條件的產業新聞。</p>"}</div>
    </section>
    <section>
      <h2>JSON</h2>
      <pre id="taiwan-daily-json">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
    </section>
  </main>
  <script id="taiwan-daily-report-json" type="application/json">${jsonBlob}</script>
</body>
</html>`;
}

function renderItem(item: FeedItem): string {
  return `<article>
    <h3><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></h3>
    <p>${escapeHtml(item.description || "N/A")}</p>
    <div class="source">${escapeHtml(item.source)} · score ${Math.round(item.editorialScore)} · ${escapeHtml(item.publishedAt || "date N/A")}</div>
  </article>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
