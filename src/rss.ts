import { XMLParser } from "fast-xml-parser";
import type { FeedFetchResult, FeedItem, FeedSource, WeeklyQueryParams } from "./types";
import {
  cleanDescription,
  computeMatchedKeywords,
  createStableId,
  computeReportSignals,
  normalizeUrl,
  parseDate,
  resolveUrl,
  shouldKeepByDate,
  sortFeedItems,
} from "./utils";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  processEntities: false,
  removeNSPrefix: false,
});

type XmlNode = Record<string, unknown>;

export async function fetchFeed(
  source: FeedSource,
  params: WeeklyQueryParams,
): Promise<FeedFetchResult> {
  if (source.fetchMode === "html") {
    return fetchHtmlFeed(source, params);
  }
  if (source.fetchMode === "api-json") {
    return fetchApiJsonFeed(source, params);
  }

  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": "weekly-rss-middleware/1.0",
        "accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
      cf: {
        cacheTtl: 300,
        cacheEverything: false,
      },
    });

    if (!response.ok) {
      return {
        items: [],
        source,
        failedFeed: {
          source: source.name,
          category: source.category,
          url: source.url,
          reason: "Fetch failed or non-200 response",
          status: response.status,
        },
      };
    }

    const xml =
      source.fetchMode === "rss-big5"
        ? await decodeResponseText(response, "big5")
        : await response.text();
    const parsed = parser.parse(xml) as XmlNode;
    const rawItems = extractEntries(parsed).slice(0, params.limitPerSource);

    const items: FeedItem[] = [];
    for (const rawItem of rawItems) {
      const item = await transformEntry(rawItem, source, params.keyword);
      if (!item) {
        continue;
      }
      if (!shouldKeepByDate(item, params.days)) {
        continue;
      }
      if (params.keyword && item.matchedKeywords.length === 0) {
        continue;
      }
      items.push(item);
    }

    return {
      items: sortFeedItems(items),
      source,
    };
  } catch (error) {
    return {
      items: [],
      source,
      failedFeed: {
        source: source.name,
        category: source.category,
        url: source.url,
        reason: error instanceof Error ? error.message : "Unknown parsing error",
        status: null,
      },
    };
  }
}

async function decodeResponseText(
  response: Response,
  encoding: string,
): Promise<string> {
  const buffer = await response.arrayBuffer();
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder().decode(buffer);
  }
}

async function fetchHtmlFeed(
  source: FeedSource,
  params: WeeklyQueryParams,
): Promise<FeedFetchResult> {
  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": "weekly-rss-middleware/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cf: {
        cacheTtl: 300,
        cacheEverything: false,
      },
    });

    if (!response.ok) {
      return {
        items: [],
        source,
        failedFeed: {
          source: source.name,
          category: source.category,
          url: source.url,
          reason: "Fetch failed or non-200 response",
          status: response.status,
        },
      };
    }

    const html = await response.text();
    const rawItems =
      source.parser === "cnyes_tw_stock_html"
        ? extractCnyesTwStockEntries(html).slice(0, params.limitPerSource)
        : source.parser === "udn_tw_stock_html"
          ? extractUdnTwStockEntries(html).slice(0, params.limitPerSource)
        : source.parser === "udn_jsonld_list"
          ? extractUdnJsonLdEntries(html).slice(0, params.limitPerSource)
        : source.parser === "focus_taiwan_business_html"
          ? extractFocusTaiwanBusinessEntries(html).slice(0, params.limitPerSource)
        : source.parser === "taipei_times_biz_html"
          ? extractTaipeiTimesBizEntries(html).slice(0, params.limitPerSource)
        : source.parser === "trendforce_semiconductors_html"
          ? extractTrendForceSemiconductorsEntries(html).slice(0, params.limitPerSource)
        : source.parser === "rti_business_html"
          ? extractRtiBusinessEntries(html).slice(0, params.limitPerSource)
        : [];

    const items: FeedItem[] = [];
    for (const rawItem of rawItems) {
      const item = await transformHtmlEntry(rawItem, source, params.keyword);
      if (!item) continue;
      if (!shouldKeepByDate(item, params.days)) continue;
      if (params.keyword && item.matchedKeywords.length === 0) continue;
      items.push(item);
    }

    return {
      items: sortFeedItems(items),
      source,
    };
  } catch (error) {
    return {
      items: [],
      source,
      failedFeed: {
        source: source.name,
        category: source.category,
        url: source.url,
        reason: error instanceof Error ? error.message : "Unknown parsing error",
        status: null,
      },
    };
  }
}

async function fetchApiJsonFeed(
  source: FeedSource,
  params: WeeklyQueryParams,
): Promise<FeedFetchResult> {
  try {
    const body = new URLSearchParams(buildApiJsonParams(source, params));
    const response = await fetch(source.url, {
      method: "POST",
      headers: {
        "user-agent": "weekly-rss-middleware/1.0",
        accept: "application/json,text/plain,*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body,
      cf: {
        cacheTtl: 300,
        cacheEverything: false,
      },
    });

    if (!response.ok) {
      return {
        items: [],
        source,
        failedFeed: {
          source: source.name,
          category: source.category,
          url: source.url,
          reason: "Fetch failed or non-200 response",
          status: response.status,
        },
      };
    }

    const payload = await response.json() as {
      stat?: string;
      tables?: Array<{ data?: unknown[] }>;
    };
    const rawItems =
      source.parser === "tpex_press_json"
        ? extractTpexPressEntries(payload).slice(0, Math.max(params.limitPerSource * 3, 30))
        : [];

    const items: FeedItem[] = [];
    for (const rawItem of rawItems) {
      const item = await transformHtmlEntry(rawItem, source, params.keyword);
      if (!item) continue;
      if (!shouldKeepByDate(item, params.days)) continue;
      if (params.keyword && item.matchedKeywords.length === 0) continue;
      items.push(item);
    }

    return {
      items: sortFeedItems(items).slice(0, params.limitPerSource),
      source,
    };
  } catch (error) {
    return {
      items: [],
      source,
      failedFeed: {
        source: source.name,
        category: source.category,
        url: source.url,
        reason: error instanceof Error ? error.message : "Unknown parsing error",
        status: null,
      },
    };
  }
}

function buildApiJsonParams(
  source: FeedSource,
  params: WeeklyQueryParams,
): Record<string, string> {
  if (source.parser === "tpex_press_json") {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - Math.max(params.days, 35));
    return {
      response: "json",
      startDate: formatYmdSlash(start),
      endDate: formatYmdSlash(end),
      keyword: "",
      id: "",
      "paging-offset": "0",
      "paging-size": String(Math.max(params.limitPerSource * 3, 30)),
    };
  }

  return { response: "json" };
}

function extractEntries(parsed: XmlNode): XmlNode[] {
  const rss = parsed.rss as XmlNode | undefined;
  const rssChannel = rss?.channel as XmlNode | undefined;
  const rssItems = asArray(rssChannel?.item);
  if (rssItems.length > 0) {
    return rssItems;
  }

  const rdfItems = asArray((parsed["rdf:RDF"] as XmlNode | undefined)?.item);
  if (rdfItems.length > 0) {
    return rdfItems;
  }

  const atomEntries = asArray((parsed.feed as XmlNode | undefined)?.entry);
  if (atomEntries.length > 0) {
    return atomEntries;
  }

  return [];
}

async function transformEntry(
  rawItem: XmlNode,
  source: FeedSource,
  keyword: string | null,
): Promise<FeedItem | null> {
  const title = readText(rawItem.title) || readText(rawItem["media:title"]);
  const url = extractLink(rawItem);

  if (!title || !url) {
    return null;
  }

  const rawDescription =
    readText(rawItem.description) ||
    readText(rawItem.summary) ||
    readText(rawItem["content:encoded"]) ||
    readText(rawItem.encoded) ||
    readText(rawItem.content);

  const resolvedUrl = resolveUrl(url, source.url);
  const normalizedUrl = normalizeUrl(resolvedUrl);
  const dateInfo = parseDate(
    readText(rawItem.pubDate) ||
      readText(rawItem.published) ||
      readText(rawItem.updated) ||
      readText(rawItem.date),
  );
  const description = cleanDescription(rawDescription);
  const matchedKeywords = computeMatchedKeywords(keyword, title, description);
  const report = computeReportSignals(title, description, source.sourceType);

  return {
    id: await createStableId(source.name, normalizedUrl),
    source: source.name,
    category: source.category,
    sourceType: source.sourceType,
    sourcePriority: source.priority,
    title: cleanDescription(title, 300),
    url: normalizedUrl,
    publishedAt: dateInfo.publishedAt,
    description,
    rawDescription: rawDescription ?? null,
    matchedKeywords,
    ageHours: dateInfo.ageHours,
    dateQuality: dateInfo.dateQuality,
    reportScore: report.score,
    reportSignals: report.signals,
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

async function transformHtmlEntry(
  rawItem: {
    title: string;
    url: string;
    publishedAt: string | null;
    description?: string | null;
  },
  source: FeedSource,
  keyword: string | null,
): Promise<FeedItem | null> {
  const title = rawItem.title?.trim();
  const url = rawItem.url?.trim();
  if (!title || !url) return null;

  const rawDescription = rawItem.description ?? null;
  const normalizedUrl = normalizeUrl(resolveUrl(url, source.url));
  const dateInfo = parseDate(rawItem.publishedAt);
  const description = cleanDescription(rawDescription || "");
  const matchedKeywords = computeMatchedKeywords(keyword, title, description);
  const report = computeReportSignals(title, description, source.sourceType);

  return {
    id: await createStableId(source.name, normalizedUrl),
    source: source.name,
    category: source.category,
    sourceType: source.sourceType,
    sourcePriority: source.priority,
    title: cleanDescription(title, 300),
    url: normalizedUrl,
    publishedAt: dateInfo.publishedAt,
    description,
    rawDescription,
    matchedKeywords,
    ageHours: dateInfo.ageHours,
    dateQuality: dateInfo.dateQuality,
    reportScore: report.score,
    reportSignals: report.signals,
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

function extractLink(rawItem: XmlNode): string | null {
  const link = rawItem.link;
  if (typeof link === "string") {
    return link.trim();
  }

  if (Array.isArray(link)) {
    for (const entry of link) {
      const resolved = extractLink({ link: entry });
      if (resolved) {
        return resolved;
      }
    }
  }

  if (link && typeof link === "object") {
    const href = (link as Record<string, unknown>)["@_href"];
    if (typeof href === "string" && href.trim().length > 0) {
      return href.trim();
    }
    const text = readText(link);
    if (text) {
      return text;
    }
  }

  const guid = rawItem.guid;
  if (typeof guid === "string" && guid.startsWith("http")) {
    return guid;
  }

  return null;
}

function readText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = readText(entry);
      if (text) {
        return text;
      }
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferredKeys = ["#text", "__cdata", "value"];
    for (const key of preferredKeys) {
      const text = readText(record[key]);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function asArray(value: unknown): XmlNode[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is XmlNode => !!entry && typeof entry === "object");
  }
  if (typeof value === "object") {
    return [value as XmlNode];
  }
  return [];
}

function extractCnyesTwStockEntries(html: string): Array<{
  title: string;
  url: string;
  publishedAt: string | null;
  description: string | null;
}> {
  const start = html.indexOf('\\"tw_stock\\":[');
  const end = html.indexOf('],\\"wd_stock\\"', start);
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  const section = html.slice(start, end);
  const pattern =
    /\\"newsId\\":(\d+),\\"title\\":\\"((?:\\.|[^"\\])*)\\",\\"payment\\":\d+,\\"publishAt\\":(\d+)/g;

  const items: Array<{
    title: string;
    url: string;
    publishedAt: string | null;
    description: string | null;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section)) !== null) {
    const [, newsId, rawTitle, rawPublishAt] = match;
    const title = decodeEscapedJsonString(rawTitle)
      .replace(/","payment".*$/s, "")
      .trim();
    const publishedAt = Number(rawPublishAt) > 0
      ? new Date(Number(rawPublishAt) * 1000).toISOString()
      : null;
    items.push({
      title,
      url: `https://news.cnyes.com/news/id/${newsId}`,
      publishedAt,
      description: null,
    });
  }

  return items;
}

function extractUdnTwStockEntries(html: string): Array<{
  title: string;
  url: string;
  publishedAt: string | null;
  description?: string | null;
}> {
  const entries: Array<{
    title: string;
    url: string;
    publishedAt: string | null;
    description?: string | null;
  }> = [];

  const regex = /<a href="(\/money\/story\/[^"]+)"[^>]*class="story-list__item--text[^>]*>([^<]+)<\/a>/g;
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const url = resolveUrl(match[1], "https://money.udn.com");
    if (seen.has(url)) continue;
    seen.add(url);
    entries.push({
      title: match[2].trim(),
      url,
      publishedAt: null,
      description: null,
    });
  }

  return entries;
}

function extractUdnJsonLdEntries(html: string): Array<{
  title: string;
  url: string;
  publishedAt: string | null;
  description?: string | null;
}> {
  const scripts = [...html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )];

  const entries: Array<{
    title: string;
    url: string;
    publishedAt: string | null;
    description?: string | null;
  }> = [];
  const seen = new Set<string>();

  for (const match of scripts) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const nodes = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" &&
          Array.isArray((parsed as Record<string, unknown>)["@graph"])
        ? (parsed as Record<string, unknown>)["@graph"] as unknown[]
        : [parsed];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const record = node as Record<string, unknown>;
      const items = Array.isArray(record.itemListElement)
        ? record.itemListElement
        : [];

      for (const item of items) {
        const article = item && typeof item === "object"
          ? (item as Record<string, unknown>).item
          : null;
        if (!article || typeof article !== "object") continue;
        const articleRecord = article as Record<string, unknown>;
        const urlValue = typeof articleRecord.url === "string"
          ? articleRecord.url.trim().replace(/\s+/g, "")
          : "";
        const titleValue = typeof articleRecord.headline === "string"
          ? articleRecord.headline.trim()
          : typeof articleRecord.name === "string"
            ? articleRecord.name.trim()
            : "";
        if (!urlValue || !titleValue || seen.has(urlValue)) continue;
        seen.add(urlValue);
        entries.push({
          title: titleValue,
          url: resolveUrl(urlValue, "https://money.udn.com"),
          publishedAt: typeof articleRecord.datePublished === "string"
            ? articleRecord.datePublished
            : null,
          description: typeof articleRecord.description === "string"
            ? articleRecord.description.trim()
            : null,
        });
      }
    }
  }

  return entries;
}

function extractFocusTaiwanBusinessEntries(html: string): Array<{
  title: string;
  url: string;
  publishedAt: string | null;
  description?: string | null;
}> {
  const entries: Array<{
    title: string;
    url: string;
    publishedAt: string | null;
    description?: string | null;
  }> = [];
  const seen = new Set<string>();
  const regex =
    /<a href="(\/business\/\d+)"[^>]*>[\s\S]*?<h2>([\s\S]*?)<\/h2>[\s\S]*?<div class="date">(.*?)<\/div>/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const url = resolveUrl(match[1], "https://focustaiwan.tw");
    if (seen.has(url)) continue;
    seen.add(url);
    entries.push({
      title: stripHtml(match[2]),
      url,
      publishedAt: parseUsDateTime(match[3]),
      description: null,
    });
  }

  return entries;
}

function extractTaipeiTimesBizEntries(html: string): Array<{
  title: string;
  url: string;
  publishedAt: string | null;
  description?: string | null;
}> {
  const entries: Array<{
    title: string;
    url: string;
    publishedAt: string | null;
    description?: string | null;
  }> = [];
  const seen = new Set<string>();
  const regex =
    /<a href="(https:\/\/www\.taipeitimes\.com\/News\/biz\/archives\/[^"]+)"[^>]*data-desc="[^"]*">[\s\S]*?<h1 class="bf2?">(.*?)<\/h1>[\s\S]*?<div class="date_list hidden">(.*?)<\/div>[\s\S]*?<p(?: class="fsp")?>(.*?)<\/p>/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const url = match[1].trim();
    if (seen.has(url)) continue;
    seen.add(url);
    entries.push({
      title: stripHtml(match[2]),
      url,
      publishedAt: parseIsoDateText(match[3]),
      description: stripHtml(match[4]),
    });
  }

  return entries;
}

function extractTrendForceSemiconductorsEntries(html: string): Array<{
  title: string;
  url: string;
  publishedAt: string | null;
  description?: string | null;
}> {
  const entries: Array<{
    title: string;
    url: string;
    publishedAt: string | null;
    description?: string | null;
  }> = [];
  const seen = new Set<string>();
  const regex =
    /<div class="insight-tag"><i class="fa fa fa-calendar"><\/i>\s*([\d-]+)\s*<h2 class="text-ellipsis-2"><a class="title-link" href="([^"]+)"><strong>(.*?)<\/strong><\/a>[\s\S]*?<div class="insight-list-item-summary">[\s\S]*?<p>(.*?)<\/p>/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const url = match[2].trim();
    if (seen.has(url)) continue;
    seen.add(url);
    entries.push({
      title: stripHtml(match[3]),
      url,
      publishedAt: parseIsoDateText(match[1]),
      description: stripHtml(match[4]),
    });
  }

  return entries;
}

function extractRtiBusinessEntries(html: string): Array<{
  title: string;
  url: string;
  publishedAt: string | null;
  description?: string | null;
}> {
  const entries: Array<{
    title: string;
    url: string;
    publishedAt: string | null;
    description?: string | null;
  }> = [];
  const seen = new Set<string>();
  const regex =
    /<div class="item">\s*<a href="(news\?uid=3&amp;pid=\d+|news\?uid=3&pid=\d+)"[\s\S]*?<div class="title">([\s\S]*?)<\/div>[\s\S]*?<div class="text ellipsis-3">([\s\S]*?)<\/div>[\s\S]*?<span class="time">(.*?)<\/span>/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const url = resolveUrl(
      match[1].replace(/&amp;/g, "&"),
      "https://en.rti.org.tw/",
    );
    if (seen.has(url)) continue;
    seen.add(url);
    entries.push({
      title: stripHtml(match[2]),
      url,
      publishedAt: null,
      description: stripHtml(match[3]),
    });
  }

  return entries;
}

function extractTpexPressEntries(payload: {
  stat?: string;
  tables?: Array<{ data?: unknown[] }>;
}): Array<{
  title: string;
  url: string;
  publishedAt: string | null;
  description?: string | null;
}> {
  if (payload.stat !== "ok") {
    return [];
  }

  const rows = Array.isArray(payload.tables?.[0]?.data)
    ? payload.tables?.[0]?.data
    : [];

  const entries = rows
    .map((row): {
      title: string;
      url: string;
      publishedAt: string | null;
      description?: string | null;
    } | null => {
      if (!Array.isArray(row) || row.length < 3) return null;
      const [rawDate, rawTitle, rawId] = row;
      const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
      const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
      if (!title || !id) return null;
      return {
        title,
        url: `https://www.tpex.org.tw/zh-tw/about/company/press/detail.html?${id}`,
        publishedAt: parseRocDateText(typeof rawDate === "string" ? rawDate : null),
        description: null,
      };
    })
    .filter((item): item is {
      title: string;
      url: string;
      publishedAt: string | null;
      description?: string | null;
    } => Boolean(item));

  return entries;
}

function decodeEscapedJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\u([\dA-Fa-f]{4})/g, (_match, code) =>
        String.fromCharCode(Number.parseInt(code, 16)),
      );
  }
}

function formatYmdSlash(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function parseRocDateText(input: string | null): string | null {
  if (!input) return null;
  const match = input.match(/民國\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/u);
  if (!match) return null;
  const year = Number(match[1]) + 1911;
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

function parseUsDateTime(input: string | null): string | null {
  if (!input) return null;
  const text = input.replace(/\s+/g, " ").trim();
  const match = text.match(
    /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)/i,
  );
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const meridiem = match[6].toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString();
}

function parseIsoDateText(input: string | null): string | null {
  if (!input) return null;
  const text = input.replace(/\s+/g, " ").trim();
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

function stripHtml(input: string): string {
  return cleanDescription(
    input
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}
