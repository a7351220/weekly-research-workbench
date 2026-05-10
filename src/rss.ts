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
