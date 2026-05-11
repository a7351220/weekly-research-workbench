import { XMLParser } from "fast-xml-parser";
import type { FeedFetchResult, FeedItem, FeedQueryParams, FeedSource } from "./types";
import {
  cleanDescription,
  computeMatchedKeywords,
  computeReportSignals,
  createStableId,
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
  params: FeedQueryParams,
): Promise<FeedFetchResult> {
  if (source.parser === "statementdog_news_html") {
    return fetchStatementDogNewsFeed(source, params);
  }

  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": "us-daily-market-report/1.0",
        "accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
      cf: {
        cacheTtl: 300,
        cacheEverything: false,
      },
    });

    if (!response.ok) {
      return failedResult(source, "Fetch failed or non-200 response", response.status);
    }

    const parsed = parser.parse(await response.text()) as XmlNode;
    const rawItems = extractEntries(parsed).slice(0, params.limitPerSource);
    const items: FeedItem[] = [];

    for (const rawItem of rawItems) {
      const item = await transformEntry(rawItem, source, params.keyword);
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
    return failedResult(
      source,
      error instanceof Error ? error.message : "Unknown parsing error",
      null,
    );
  }
}

async function fetchStatementDogNewsFeed(
  source: FeedSource,
  params: FeedQueryParams,
): Promise<FeedFetchResult> {
  try {
    const pages = Math.max(1, Math.min(source.htmlPages ?? 1, 8));
    const responses = await Promise.all(
      buildStatementDogNewsUrls(source.url, pages).map(async (url) => {
        const response = await fetch(url, {
          headers: {
            "user-agent": "us-daily-market-report/1.0",
            "accept": "text/html,application/xhtml+xml,*/*;q=0.8",
          },
          cf: {
            cacheTtl: 300,
            cacheEverything: false,
          },
        });
        if (!response.ok) {
          throw new StatementDogFetchError(response.status);
        }
        return response.text();
      }),
    );

    const rawItems = dedupeStatementDogNewsItems(responses.flatMap(parseStatementDogNewsItems))
      .slice(0, params.limitPerSource);
    const items: FeedItem[] = [];
    for (const rawItem of rawItems) {
      const item = await transformStatementDogNewsItem(rawItem, source, params.keyword);
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
    if (error instanceof StatementDogFetchError) {
      return failedResult(source, "Fetch failed or non-200 response", error.status);
    }
    return failedResult(
      source,
      error instanceof Error ? error.message : "Unknown parsing error",
      null,
    );
  }
}

class StatementDogFetchError extends Error {
  constructor(public readonly status: number) {
    super(`StatementDog fetch failed: ${status}`);
  }
}

function buildStatementDogNewsUrls(url: string, pages: number): string[] {
  return Array.from({ length: pages }, (_, index) => {
    if (index === 0) return url;
    const pageUrl = new URL(url);
    pageUrl.searchParams.set("page", String(index + 1));
    return pageUrl.toString();
  });
}

interface StatementDogRawNewsItem {
  title: string;
  url: string;
  date: string | null;
  description: string;
}

function parseStatementDogNewsItems(html: string): StatementDogRawNewsItem[] {
  const seen = new Set<string>();
  const items: StatementDogRawNewsItem[] = [];
  const matches = html.matchAll(/<a class="statementdog-news-list-item-link" data-title="([^"]+)" href="([^"]+)">([\s\S]*?)<\/a>/g);
  for (const match of matches) {
    const url = normalizeUrl(resolveUrl(match[2], "https://statementdog.com/news"));
    if (seen.has(url)) continue;
    seen.add(url);
    const body = match[3] ?? "";
    const date = extractFirst(body, /statementdog-news-list-item-date">\s*([^<]+)\s*</);
    const description = extractFirst(body, /statementdog-news-list-item-description">\s*([\s\S]*?)\s*<\/p>/, 2000) || "";
    items.push({
      title: cleanDescription(match[1], 300),
      url,
      date,
      description: cleanDescription(description, 1400),
    });
  }
  return items;
}

function dedupeStatementDogNewsItems(items: StatementDogRawNewsItem[]): StatementDogRawNewsItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeUrl(item.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function transformStatementDogNewsItem(
  rawItem: StatementDogRawNewsItem,
  source: FeedSource,
  keyword: string | null,
): Promise<FeedItem | null> {
  if (!rawItem.title || !rawItem.url) return null;

  const dateInfo = parseDate(normalizeStatementDogDate(rawItem.date));
  const matchedKeywords = computeMatchedKeywords(keyword, rawItem.title, rawItem.description);
  const report = computeReportSignals(rawItem.title, rawItem.description, source.sourceType);

  return {
    id: await createStableId(source.name, rawItem.url),
    source: source.name,
    category: source.category,
    sourceType: source.sourceType,
    sourcePriority: source.priority,
    title: rawItem.title,
    url: rawItem.url,
    publishedAt: dateInfo.publishedAt,
    description: rawItem.description,
    rawDescription: rawItem.description,
    matchedKeywords,
    ageHours: dateInfo.ageHours,
    dateQuality: dateInfo.dateQuality,
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

function normalizeStatementDogDate(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return `${normalized}T00:00:00+08:00`;
  }
  return value;
}

function extractFirst(value: string, pattern: RegExp, maxLength = 400): string | null {
  const match = value.match(pattern);
  return match ? cleanDescription(match[1], maxLength) : null;
}

function failedResult(source: FeedSource, reason: string, status: number | null): FeedFetchResult {
  return {
    items: [],
    source,
    failedFeed: {
      source: source.name,
      category: source.category,
      url: source.url,
      reason,
      status,
    },
  };
}

function extractEntries(parsed: XmlNode): XmlNode[] {
  const rss = parsed.rss as XmlNode | undefined;
  const rssChannel = rss?.channel as XmlNode | undefined;
  const rssItems = asArray(rssChannel?.item);
  if (rssItems.length > 0) return rssItems;

  const rdfItems = asArray((parsed["rdf:RDF"] as XmlNode | undefined)?.item);
  if (rdfItems.length > 0) return rdfItems;

  const atomEntries = asArray((parsed.feed as XmlNode | undefined)?.entry);
  if (atomEntries.length > 0) return atomEntries;

  return [];
}

async function transformEntry(
  rawItem: XmlNode,
  source: FeedSource,
  keyword: string | null,
): Promise<FeedItem | null> {
  const title = readText(rawItem.title) || readText(rawItem["media:title"]);
  const url = extractLink(rawItem);
  if (!title || !url) return null;

  const rawDescription =
    readText(rawItem.description) ||
    readText(rawItem.summary) ||
    readText(rawItem["content:encoded"]) ||
    readText(rawItem.encoded) ||
    readText(rawItem.content);

  const normalizedUrl = normalizeUrl(resolveUrl(url, source.url));
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

function extractLink(rawItem: XmlNode): string | null {
  const link = rawItem.link;
  if (typeof link === "string") return link.trim();

  if (Array.isArray(link)) {
    for (const entry of link) {
      const resolved = extractLink({ link: entry });
      if (resolved) return resolved;
    }
  }

  if (link && typeof link === "object") {
    const href = (link as Record<string, unknown>)["@_href"];
    if (typeof href === "string" && href.trim().length > 0) return href.trim();
    const text = readText(link);
    if (text) return text;
  }

  const guid = rawItem.guid;
  if (typeof guid === "string" && guid.startsWith("http")) return guid;

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
      if (text) return text;
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["#text", "__cdata", "value"]) {
      const text = readText(record[key]);
      if (text) return text;
    }
  }

  return null;
}

function asArray(value: unknown): XmlNode[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is XmlNode => !!entry && typeof entry === "object");
  }
  if (typeof value === "object") return [value as XmlNode];
  return [];
}
