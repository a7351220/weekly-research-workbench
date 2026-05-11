import { buildDailyTaiwanPayload } from "./daily-taiwan";
import type { Env, FeedItem } from "./types";
import { cleanDescription, decodeHtmlEntities, jsonResponse, normalizeUrl } from "./utils";

interface StatementDogIndustryListItem {
  name: string;
  url: string;
  annualReturn: string | null;
}

interface IndustryCompany {
  stockId: string;
  name: string;
  url: string;
}

interface IndustrySubIndustry {
  name: string;
  companies: IndustryCompany[];
}

interface IndustryStream {
  position: string;
  name: string;
  subIndustries: IndustrySubIndustry[];
}

interface StatementDogIndustry {
  name: string;
  url: string;
  annualReturn: string | null;
  description: string | null;
  streams: IndustryStream[];
}

interface StatementDogIndustryMap {
  ok: true;
  source: "statementdog";
  sourceUrl: string;
  fetchedAt: string;
  sourceLastUpdatedText: string | null;
  totalIndustries: number;
  industries: StatementDogIndustry[];
}

interface FinMindStockRow {
  date?: string;
  stock_id?: string;
  stock_name?: string;
  industry_category?: string;
  type?: string;
}

interface TaiwanStockInfo {
  stockId: string;
  stockName: string;
  officialIndustries: string[];
  marketTypes: string[];
  date: string | null;
}

interface TaiwanStockIndustryProfile {
  ok: true;
  reportType: "taiwan_stock_industry_profile";
  generatedAt: string;
  symbol: string;
  company: TaiwanStockInfo | null;
  industryMatches: Array<{
    industry: string;
    industryUrl: string;
    annualReturn: string | null;
    positions: Array<{
      position: string;
      streamName: string;
      subIndustry: string;
    }>;
  }>;
  relatedNews: {
    totalCandidates: number;
    totalItems: number;
    matchedAliases: string[];
    items: RelatedTaiwanNewsItem[];
  };
  supplyChainNews: {
    totalItems: number;
    matchedIndustries: string[];
    items: RelatedTaiwanNewsItem[];
  };
  sources: {
    companyInfo: string;
    industryMap: string;
    news: string;
  };
}

interface RelatedTaiwanNewsItem extends FeedItem {
  relatedNewsScore: number;
  relatedNewsReasons: string[];
  relatedNewsMatchedAliases: string[];
}

const STATEMENTDOG_TAIEX_URL = "https://statementdog.com/taiex";
const FINMIND_STOCK_INFO_URL = "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo";

const COMMON_COMPANY_ALIASES: Record<string, string[]> = {
  "2330": ["台積電", "台積", "TSMC"],
  "2317": ["鴻海", "鸿海", "Foxconn", "Hon Hai"],
  "2454": ["聯發科", "联发科", "發哥", "发哥", "MediaTek"],
  "2382": ["廣達", "广达", "Quanta"],
  "3231": ["緯創", "纬创", "Wistron"],
  "6669": ["緯穎", "纬颖", "Wiwynn"],
  "3661": ["世芯", "Alchip"],
  "3443": ["創意", "创意", "GUC"],
  "3711": ["日月光", "ASE"],
  "2303": ["聯電", "联电", "UMC"],
  "2308": ["台達電", "台达电", "Delta"],
  "3017": ["奇鋐"],
  "3653": ["健策"],
  "2383": ["台光電"],
  "3037": ["欣興"],
  "3715": ["定穎投控"],
  "4958": ["臻鼎"],
  "3044": ["健鼎"],
  "3481": ["群創"],
  "8299": ["群聯"],
};

export async function handleTaiwanIndustryMap(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const refresh = requestUrl.searchParams.get("refresh") === "true";
  const map = await getStatementDogIndustryMap(env, refresh);
  return jsonResponse(map);
}

export async function handleTaiwanStockIndustryProfile(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const symbol = resolveStockSymbol(requestUrl);
  if (!symbol) {
    return jsonResponse(
      {
        ok: false,
        error: "Missing stock symbol",
        message: "Use /taiwan/stock.json?symbol=2330 or /taiwan/stock/2330.json.",
      },
      { status: 400 },
    );
  }

  const [companyIndex, industryMap, taiwanNews] = await Promise.all([
    getFinMindStockIndex(env, false),
    getStatementDogIndustryMap(env, requestUrl.searchParams.get("refreshIndustryMap") === "true"),
    buildDailyTaiwanPayload(buildTaiwanNewsUrl(requestUrl), env),
  ]);
  const company = companyIndex.get(symbol) ?? null;
  const aliases = buildCompanyAliases(symbol, company, industryMap);
  const industryMatches = findIndustryMatches(symbol, industryMap);
  const news = filterRelatedNews(taiwanNews.allItems, aliases)
    .slice(0, parseNewsLimit(requestUrl));
  const supplyChainNews = filterSupplyChainNews(taiwanNews.allItems, industryMatches, aliases)
    .slice(0, parseNewsLimit(requestUrl));

  const payload: TaiwanStockIndustryProfile = {
    ok: true,
    reportType: "taiwan_stock_industry_profile",
    generatedAt: new Date().toISOString(),
    symbol,
    company,
    industryMatches,
    relatedNews: {
      totalCandidates: taiwanNews.allItems.length,
      totalItems: news.length,
      matchedAliases: aliases,
      items: news,
    },
    supplyChainNews: {
      totalItems: supplyChainNews.length,
      matchedIndustries: buildIndustryKeywords(industryMatches),
      items: supplyChainNews,
    },
    sources: {
      companyInfo: FINMIND_STOCK_INFO_URL,
      industryMap: STATEMENTDOG_TAIEX_URL,
      news: "/daily/taiwan.json",
    },
  };

  return jsonResponse(payload);
}

async function getStatementDogIndustryMap(env: Env, refresh: boolean): Promise<StatementDogIndustryMap> {
  const cacheKey = "statementdog-industry-map:v1";
  if (!refresh) {
    const cached = await env.EDITORIAL_CACHE?.get(cacheKey, "json");
    if (isStatementDogIndustryMap(cached)) return cached;
  }

  const indexHtml = await fetchText(STATEMENTDOG_TAIEX_URL);
  const industries = parseIndustryList(indexHtml);
  const details = await mapWithConcurrency(industries, 4, async (industry) => {
    try {
      return await fetchStatementDogIndustry(industry);
    } catch {
      return {
        ...industry,
        description: null,
        streams: [],
      };
    }
  });

  const payload: StatementDogIndustryMap = {
    ok: true,
    source: "statementdog",
    sourceUrl: STATEMENTDOG_TAIEX_URL,
    fetchedAt: new Date().toISOString(),
    sourceLastUpdatedText: extractLastUpdated(indexHtml),
    totalIndustries: details.length,
    industries: details,
  };

  await env.EDITORIAL_CACHE?.put(cacheKey, JSON.stringify(payload), { expirationTtl: 12 * 60 * 60 });
  return payload;
}

async function fetchStatementDogIndustry(industry: StatementDogIndustryListItem): Promise<StatementDogIndustry> {
  const html = await fetchText(industry.url);
  return {
    ...industry,
    description: parseMetaDescription(html),
    streams: parseIndustryStreams(html),
  };
}

async function getFinMindStockIndex(env: Env, refresh: boolean): Promise<Map<string, TaiwanStockInfo>> {
  const cacheKey = "finmind-taiwan-stock-info:v1";
  if (!refresh) {
    const cached = await env.EDITORIAL_CACHE?.get(cacheKey, "json");
    if (Array.isArray(cached)) return buildStockInfoIndex(cached as FinMindStockRow[]);
  }

  const response = await fetch(FINMIND_STOCK_INFO_URL, {
    headers: {
      "user-agent": "weekly-rss-daily/1.0",
      accept: "application/json,text/plain,*/*",
    },
  });
  if (!response.ok) return new Map();
  const payload = await response.json() as { data?: FinMindStockRow[] };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  await env.EDITORIAL_CACHE?.put(cacheKey, JSON.stringify(rows), { expirationTtl: 24 * 60 * 60 });
  return buildStockInfoIndex(rows);
}

function buildStockInfoIndex(rows: FinMindStockRow[]): Map<string, TaiwanStockInfo> {
  const index = new Map<string, TaiwanStockInfo>();
  for (const row of rows) {
    const stockId = String(row.stock_id ?? "").trim();
    const stockName = String(row.stock_name ?? "").trim();
    if (!/^\d{4,6}$/.test(stockId) || !stockName) continue;
    const existing = index.get(stockId) ?? {
      stockId,
      stockName,
      officialIndustries: [],
      marketTypes: [],
      date: row.date ?? null,
    };
    if (row.industry_category && !existing.officialIndustries.includes(row.industry_category)) {
      existing.officialIndustries.push(row.industry_category);
    }
    if (row.type && !existing.marketTypes.includes(row.type)) {
      existing.marketTypes.push(row.type);
    }
    if (row.date && (!existing.date || row.date > existing.date)) {
      existing.date = row.date;
    }
    index.set(stockId, existing);
  }
  return index;
}

function parseIndustryList(html: string): StatementDogIndustryListItem[] {
  const matches = [...html.matchAll(/<a class="industry-item[^"]*" href="([^"]+)"[\s\S]*?<h2 class="industry-item-title">([^<]+)<\/h2>[\s\S]*?<div class="industry-item-annual-return-number">([^<]+)<\/div>/g)];
  return matches.map((match) => ({
    name: cleanText(match[2]),
    url: normalizeUrl(new URL(match[1], STATEMENTDOG_TAIEX_URL).toString()),
    annualReturn: cleanText(match[3]) || null,
  }));
}

function parseIndustryStreams(html: string): IndustryStream[] {
  const markers = [...html.matchAll(/<div class="industry-box industry-stream industry-[^"]*">/g)];
  const streams = markers.map((marker, index) => {
    const start = marker.index ?? 0;
    const end = markers[index + 1]?.index ?? html.indexOf('<div id="industry-ranking"', start);
    const section = html.slice(start, end > start ? end : undefined);
    return {
      position: extractFirst(section, /<div class="industry-box-subtitle">([\s\S]*?)<\/div>/) || "N/A",
      name: extractFirst(section, /<div class="industry-box-title">([\s\S]*?)<\/div>/) || "N/A",
      subIndustries: parseSubIndustries(section),
    };
  }).filter((stream) => stream.subIndustries.length > 0);
  if (streams.length > 0) return streams;
  const rankingSubIndustries = parseRankingSubIndustries(html);
  if (rankingSubIndustries.length === 0) return [];
  return [
    {
      position: "成分股",
      name: "未分流產業公司",
      subIndustries: rankingSubIndustries,
    },
  ];
}

function parseSubIndustries(section: string): IndustrySubIndustry[] {
  const blocks = [...section.matchAll(/<ul id="industry-stream-item-\d+" class="industry-stream-item">([\s\S]*?)<\/ul>/g)];
  return blocks.map((block) => {
    const body = block[1] ?? "";
    const name = extractFirst(body, /<div class="industry-stream-sub-industry-name">([\s\S]*?)<\/div>/) || "N/A";
    const companies = [...body.matchAll(/<a class="industry-stream-company"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
      .map((match) => parseCompany(match[1], match[2]))
      .filter((company): company is IndustryCompany => Boolean(company));
    return { name, companies };
  }).filter((subIndustry) => subIndustry.companies.length > 0);
}

function parseCompany(href: string, rawText: string): IndustryCompany | null {
  const text = cleanText(rawText);
  const match = text.match(/^(\d{4,6})\s+(.+)$/);
  if (!match) return null;
  return {
    stockId: match[1],
    name: match[2].replace(/\*$/, "").trim(),
    url: normalizeUrl(new URL(href, STATEMENTDOG_TAIEX_URL).toString()),
  };
}

function parseRankingSubIndustries(html: string): IndustrySubIndustry[] {
  const groups = new Map<string, IndustryCompany[]>();
  const rows = [...html.matchAll(/<ul class="industry-ranking-item">([\s\S]*?)<\/ul>/g)];
  for (const row of rows) {
    const body = row[1] ?? "";
    const companyMatch = body.match(/<a[^>]*href="([^"]*\/analysis\/\d{4,6})"[^>]*>([\s\S]*?)<\/a>/);
    if (!companyMatch) continue;
    const company = parseCompany(companyMatch[1], companyMatch[2]);
    if (!company) continue;
    const subIndustry = extractFirst(body, /<li class="industry-ranking-item-info industry-ranking-sub-industry">([\s\S]*?)<\/li>/) || "未分類";
    const list = groups.get(subIndustry) ?? [];
    list.push(company);
    groups.set(subIndustry, list);
  }
  return Array.from(groups.entries()).map(([name, companies]) => ({ name, companies }));
}

function findIndustryMatches(symbol: string, industryMap: StatementDogIndustryMap): TaiwanStockIndustryProfile["industryMatches"] {
  const matches: TaiwanStockIndustryProfile["industryMatches"] = [];
  for (const industry of industryMap.industries) {
    const positions: TaiwanStockIndustryProfile["industryMatches"][number]["positions"] = [];
    for (const stream of industry.streams) {
      for (const subIndustry of stream.subIndustries) {
        if (!subIndustry.companies.some((company) => company.stockId === symbol)) continue;
        positions.push({
          position: stream.position,
          streamName: stream.name,
          subIndustry: subIndustry.name,
        });
      }
    }
    if (positions.length === 0) continue;
    matches.push({
      industry: industry.name,
      industryUrl: industry.url,
      annualReturn: industry.annualReturn,
      positions,
    });
  }
  return matches;
}

function buildCompanyAliases(symbol: string, company: TaiwanStockInfo | null, industryMap: StatementDogIndustryMap): string[] {
  const aliases = new Set<string>([symbol]);
  for (const alias of COMMON_COMPANY_ALIASES[symbol] ?? []) aliases.add(alias);
  if (company?.stockName) aliases.add(company.stockName);
  for (const industry of industryMap.industries) {
    for (const stream of industry.streams) {
      for (const subIndustry of stream.subIndustries) {
        const match = subIndustry.companies.find((candidate) => candidate.stockId === symbol);
        if (match?.name) aliases.add(match.name);
      }
    }
  }
  return Array.from(aliases).filter((alias) => alias.length >= 2);
}

function filterRelatedNews(items: FeedItem[], aliases: string[]): RelatedTaiwanNewsItem[] {
  const seen = new Set<string>();
  return items.map((item) => scoreRelatedNews(item, aliases))
    .filter((item): item is RelatedTaiwanNewsItem => Boolean(item))
    .sort((a, b) => b.relatedNewsScore - a.relatedNewsScore)
    .filter((item) => {
      const key = normalizeUrl(item.url) || item.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function filterSupplyChainNews(
  items: FeedItem[],
  industryMatches: TaiwanStockIndustryProfile["industryMatches"],
  companyAliases: string[],
): RelatedTaiwanNewsItem[] {
  const keywords = buildIndustryKeywords(industryMatches);
  if (keywords.length === 0) return [];

  const companyUrls = new Set<string>();
  for (const item of filterRelatedNews(items, companyAliases)) {
    companyUrls.add(normalizeUrl(item.url) || item.title);
  }

  const seen = new Set<string>();
  return items.map((item) => scoreSupplyChainNews(item, keywords))
    .filter((item): item is RelatedTaiwanNewsItem => Boolean(item))
    .sort((a, b) => b.relatedNewsScore - a.relatedNewsScore)
    .filter((item) => {
      const key = normalizeUrl(item.url) || item.title;
      if (companyUrls.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function scoreSupplyChainNews(item: FeedItem, keywords: string[]): RelatedTaiwanNewsItem | null {
  const title = item.title || "";
  const description = item.description || "";
  const text = `${title} ${description}`;
  if (isNonMarketNoise(text) || isFundOrEtfNews(text)) return null;
  if (!hasTaiwanSupplyChainContext(text, item.source)) return null;

  const titleMatches = keywords.filter((keyword) => includesAlias(title, keyword));
  const descriptionMatches = keywords.filter((keyword) => includesAlias(description, keyword));
  const matchedAliases = unique([...titleMatches, ...descriptionMatches]);
  if (matchedAliases.length === 0) return null;

  const reasons: string[] = [];
  let score = 0;
  if (titleMatches.length > 0) {
    score += 58;
    reasons.push("title_industry_match");
  }
  if (descriptionMatches.length > 0) {
    score += 18;
    reasons.push("description_industry_match");
  }
  if (hasCompanyCatalyst(text)) {
    score += 16;
    reasons.push("company_catalyst");
  }
  if (hasIndustryCatalyst(text)) {
    score += 18;
    reasons.push("industry_context");
  }
  if (item.ageHours !== null && item.ageHours <= 72) {
    score += 10;
    reasons.push("fresh");
  }
  score += Math.round(item.sourcePriority / 8);
  if (isGenericTaiwanMarketStory(title, description)) {
    score -= 28;
    reasons.push("generic_market_penalty");
  }
  if (score < 40) return null;

  return {
    ...item,
    relatedNewsScore: Math.max(0, score),
    relatedNewsReasons: reasons,
    relatedNewsMatchedAliases: matchedAliases,
  };
}

function buildIndustryKeywords(industryMatches: TaiwanStockIndustryProfile["industryMatches"]): string[] {
  const keywords = new Set<string>();
  for (const match of industryMatches) {
    addIndustryKeyword(keywords, match.industry);
    for (const position of match.positions) {
      addIndustryKeyword(keywords, position.streamName);
      addIndustryKeyword(keywords, position.subIndustry);
    }
  }
  return Array.from(keywords);
}

function addIndustryKeyword(keywords: Set<string>, value: string): void {
  const normalized = value.trim();
  if (!normalized || normalized === "N/A" || normalized === "未分流產業公司" || normalized === "成分股") return;
  if (!isBroadAiIndustryKeyword(normalized)) {
    keywords.add(normalized);
  }
  if (/PCB/i.test(normalized)) {
    keywords.add("PCB");
    keywords.add("印刷電路板");
    keywords.add("銅箔基板");
    keywords.add("CCL");
  }
  if (/半導體|晶圓|IC/i.test(normalized)) {
    keywords.add("半導體");
    keywords.add("晶片");
    keywords.add("晶圓");
    keywords.add("foundry");
  }
  if (/人工智慧|雲端|伺服器|運算/i.test(normalized)) {
    keywords.add("伺服器");
    keywords.add("AI伺服器");
    keywords.add("AI 伺服器");
    keywords.add("資料中心");
    keywords.add("運算設備");
    keywords.add("GPU");
    keywords.add("GB200");
    keywords.add("GB300");
    keywords.add("Blackwell");
    keywords.add("輝達");
  }
}

function isBroadAiIndustryKeyword(value: string): boolean {
  return /^(AI|人工智慧|雲端|雲端運算|大數據)$/i.test(value);
}

function scoreRelatedNews(item: FeedItem, aliases: string[]): RelatedTaiwanNewsItem | null {
  const title = item.title || "";
  const description = item.description || "";
  const text = `${title} ${description}`;
  if (isNonMarketNoise(text)) return null;
  const titleAliases = aliases.filter((alias) => includesAlias(title, alias));
  const descriptionAliases = aliases.filter((alias) => includesAlias(description, alias));
  const matchedAliases = unique([...titleAliases, ...descriptionAliases]);
  if (matchedAliases.length === 0) return null;

  const reasons: string[] = [];
  let score = 0;

  if (titleAliases.length > 0) {
    score += 72;
    reasons.push("title_company_match");
  }
  if (descriptionAliases.length > 0) {
    score += 24;
    reasons.push("description_company_match");
  }
  if (hasCompanyCatalyst(text)) {
    score += 24;
    reasons.push("company_catalyst");
  }
  if (hasIndustryCatalyst(text)) {
    score += 14;
    reasons.push("industry_context");
  }
  if (item.ageHours !== null && item.ageHours <= 72) {
    score += 10;
    reasons.push("fresh");
  }
  score += Math.round(item.sourcePriority / 8);

  const genericMarket = isGenericTaiwanMarketStory(title, description);
  if (genericMarket && titleAliases.length === 0) {
    score -= descriptionAliases.length > 0 && hasCompanyCatalyst(text) ? 20 : 52;
    reasons.push("generic_market_penalty");
  }
  if (isFundOrEtfNews(text) && titleAliases.length === 0) {
    score -= 44;
    reasons.push("fund_etf_penalty");
  }

  const hasDirectOrSpecific = titleAliases.length > 0 || hasCompanyCatalyst(text);
  if (!hasDirectOrSpecific || score < 42) return null;

  return {
    ...item,
    relatedNewsScore: Math.max(0, score),
    relatedNewsReasons: reasons,
    relatedNewsMatchedAliases: matchedAliases,
  };
}

function includesAlias(text: string, alias: string): boolean {
  if (!alias) return false;
  if (/^[a-z0-9]+$/i.test(alias)) {
    return new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(text);
  }
  return text.includes(alias);
}

function hasCompanyCatalyst(text: string): boolean {
  return /營收|財報|獲利|EPS|每股盈餘|毛利率|法說|展望|財測|股利|配息|股價|漲停|跌停|創高|新高|買超|賣超|目標價|評等|訂單|出貨|產能|擴產|接單|併購|投資|處分|取得|重大訊息|公告/i.test(text);
}

function hasIndustryCatalyst(text: string): boolean {
  return /\b(ai|nvidia|gb200|gb300|blackwell|gpu|asic|cowos|hbm|pcb|server)\b|輝達|伺服器|資料中心|數據中心|半導體|晶片|晶圓|封測|先進封裝|散熱|液冷|電源|光通訊|矽光子|供應鏈|記憶體|DRAM|NAND/i.test(text);
}

function isGenericTaiwanMarketStory(title: string, description: string): boolean {
  const text = `${title} ${description}`;
  return /台股|加權指數|櫃買|大盤|盤中|收盤|開盤|三大法人|外資|投信|自營商|買超|賣超|融資|融券|早盤|午盤|尾盤|今日股市|台北股市/i.test(text);
}

function isFundOrEtfNews(text: string): boolean {
  return /ETF|基金|主動式|受益憑證|配息|除息|淨值|成分股|投信募集|高息|市值型/i.test(text);
}

function hasTaiwanSupplyChainContext(text: string, source: string): boolean {
  if (/TWSE|櫃買|Taiwan|Taiwanese|臺灣|台灣|台廠|台股|台北股市|證交所|櫃買中心/i.test(`${source} ${text}`)) return true;
  return /台積電|鴻海|聯發科|廣達|緯創|緯穎|世芯|創意|日月光|聯電|台達電|奇鋐|雙鴻|健策|台光電|欣興|臻鼎|健鼎|京元電|群創|群聯|華通|南電|景碩|華碩|仁寶|英業達|和碩|技嘉|微星|華擎|研華|光寶科|緯軟|智邦|神達|勤誠|川湖|台燿|金像電|貿聯|信驊|譜瑞|瑞昱|力積電|世界先進|旺宏|南亞科|穩懋|聯詠|矽力|AES-KY|ASE|Wus/i.test(text);
}

function isNonMarketNoise(text: string): boolean {
  return /威力彩|彩券|頭獎|充公|發票|抽獎|旅遊|美食|房市|房價|信用卡|保險|徵才|活動|講座/i.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

function buildTaiwanNewsUrl(requestUrl: URL): URL {
  const url = new URL(`${requestUrl.origin}/daily/taiwan.json`);
  url.searchParams.set("days", requestUrl.searchParams.get("days") || "30");
  url.searchParams.set("limitPerSource", requestUrl.searchParams.get("limitPerSource") || "50");
  url.searchParams.set("maxItems", requestUrl.searchParams.get("maxItems") || "300");
  const keyword = requestUrl.searchParams.get("keyword");
  if (keyword) url.searchParams.set("keyword", keyword);
  return url;
}

function resolveStockSymbol(requestUrl: URL): string | null {
  const querySymbol = requestUrl.searchParams.get("symbol") || requestUrl.searchParams.get("stockId") || requestUrl.searchParams.get("ticker");
  const pathSymbol = requestUrl.pathname.match(/\/taiwan\/stock\/(\d{4,6})(?:\.json)?$/)?.[1] ?? null;
  const symbol = (querySymbol || pathSymbol || "").trim();
  return /^\d{4,6}$/.test(symbol) ? symbol : null;
}

function parseNewsLimit(requestUrl: URL): number {
  const value = Number(requestUrl.searchParams.get("newsLimit") || "20");
  if (!Number.isFinite(value)) return 20;
  return Math.max(0, Math.min(50, Math.trunc(value)));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "weekly-rss-daily/1.0",
      accept: "text/html,application/xhtml+xml,text/plain,*/*",
    },
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status}: ${url}`);
  return response.text();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function extractLastUpdated(html: string): string | null {
  return extractFirst(html, /最後更新：\s*([0-9/]+)/) || null;
}

function parseMetaDescription(html: string): string | null {
  const description = extractFirst(html, /<meta name="description" content="([^"]*)"/);
  return description ? cleanDescription(description, 500) : null;
}

function extractFirst(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return match ? cleanText(match[1]) : null;
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStatementDogIndustryMap(value: unknown): value is StatementDogIndustryMap {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { ok?: unknown }).ok === true
    && (value as { source?: unknown }).source === "statementdog"
    && Array.isArray((value as { industries?: unknown }).industries),
  );
}
