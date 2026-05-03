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
    const title = decodeEscapedJsonString(rawTitle);
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
