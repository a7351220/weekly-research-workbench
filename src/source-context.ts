import { SOURCES } from "./sources";
import type {
  SourceContextArticle,
  SourceContextFailure,
  SourceContextResponse,
} from "./types";
import {
  cleanDescription,
  decodeHtmlEntities,
  normalizeUrl,
  normalizeWhitespace,
  parseDate,
  parseNumber,
  stripHtml,
} from "./utils";

const MAX_URLS = 5;

export function parseSourceContextParams(url: URL): {
  urls: string[];
  maxParagraphs: number;
} {
  const urlParams = url.searchParams.getAll("url");
  const urlsParam = url.searchParams.get("urls");
  const combined = [
    ...urlParams,
    ...(urlsParam ? urlsParam.split(",") : []),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_URLS);

  return {
    urls: Array.from(new Set(combined.map((value) => normalizeUrl(value)))),
    maxParagraphs: parseNumber(url.searchParams.get("maxParagraphs"), 6, {
      min: 3,
      max: 12,
    }),
  };
}

export async function buildSourceContextResponse(
  inputUrls: string[],
  maxParagraphs: number,
): Promise<SourceContextResponse> {
  const results = await Promise.all(
    inputUrls.map((articleUrl) => fetchArticleContext(articleUrl, maxParagraphs)),
  );

  const articles: SourceContextArticle[] = [];
  const failedArticles: SourceContextFailure[] = [];

  for (const result of results) {
    if ("reason" in result) {
      failedArticles.push(result);
    } else {
      articles.push(result);
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    params: {
      urls: inputUrls,
      maxParagraphs,
    },
    articles,
    failedArticles,
  };
}

async function fetchArticleContext(
  articleUrl: string,
  maxParagraphs: number,
): Promise<SourceContextArticle | SourceContextFailure> {
  const normalizedUrl = normalizeUrl(articleUrl);
  const source = matchSource(normalizedUrl);
  const sourceName = source?.name ?? null;

  if (!sourceName) {
    return {
      url: articleUrl,
      normalizedUrl,
      reason: "URL host is not in the allowed fixed-source registry",
      status: null,
    };
  }

  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        "user-agent": "weekly-rss-middleware/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cf: {
        cacheTtl: 600,
        cacheEverything: false,
      },
    });

    if (!response.ok) {
      const fallback = await tryFeedFallback(source, normalizedUrl);
      if (fallback) {
        return fallback;
      }
      return {
        url: articleUrl,
        normalizedUrl,
        reason: "Fetch failed or non-200 response",
        status: response.status,
      };
    }

    const html = await response.text();
    const article = extractArticleFromHtml(html, normalizedUrl, sourceName, maxParagraphs);
    return article;
  } catch (error) {
    return {
      url: articleUrl,
      normalizedUrl,
      reason: error instanceof Error ? error.message : "Unknown article fetch error",
      status: null,
    };
  }
}

async function tryFeedFallback(
  source: { name: string; url: string } | null,
  normalizedUrl: string,
): Promise<SourceContextArticle | null> {
  if (!source) {
    return null;
  }

  if (!source.name.startsWith("Yahoo Taiwan")) {
    return null;
  }

  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": "weekly-rss-middleware/1.0",
        accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      },
      cf: {
        cacheTtl: 300,
        cacheEverything: false,
      },
    });

    if (!response.ok) {
      return null;
    }

    const xml = await response.text();
    const item = findRssItemByLink(xml, normalizedUrl);
    if (!item) {
      return null;
    }

    const title = normalizeWhitespace(stripHtml(decodeHtmlEntities(item.title)));
    const description = cleanDescription(
      stripHtml(decodeHtmlEntities(item.description)),
      1200,
    );
    const publishedAt = parseDate(item.pubDate).publishedAt;
    const numbersMentioned = extractNumbers(description).slice(0, 12);

    return {
      url: normalizedUrl,
      normalizedUrl,
      source: source.name,
      title: cleanDescription(title, 300),
      publishedAt,
      description: cleanDescription(description, 500),
      leadText: cleanDescription(description || title, 1000),
      articleExcerpt: cleanDescription(description, 4000),
      keyParagraphs: description ? [description] : [],
      quotedLines: [],
      numbersMentioned,
    };
  } catch {
    return null;
  }
}

function extractArticleFromHtml(
  html: string,
  normalizedUrl: string,
  sourceName: string,
  maxParagraphs: number,
): SourceContextArticle {
  const headHtml = html.slice(0, 140_000);
  const contentHtml = prepareHtmlForExtraction(html);
  const title =
    extractMetaContent(headHtml, "property", "og:title") ||
    extractMetaContent(headHtml, "name", "twitter:title") ||
    extractTagText(headHtml, "title") ||
    "";

  const description =
    extractMetaContent(headHtml, "property", "og:description") ||
    extractMetaContent(headHtml, "name", "description") ||
    "";

  const publishedRaw =
    extractMetaContent(headHtml, "property", "article:published_time") ||
    extractMetaContent(headHtml, "name", "article:published_time") ||
    extractMetaContent(headHtml, "name", "parsely-pub-date") ||
    extractTimeDatetime(headHtml);
  const publishedAt = parseDate(publishedRaw).publishedAt;

  const paragraphPool = extractParagraphs(contentHtml)
    .map((paragraph) => cleanDescription(paragraph, 1200))
    .filter((paragraph) => paragraph.length >= 40)
    .filter((paragraph) => !isBylineParagraph(paragraph))
    .filter((paragraph, index, array) => array.indexOf(paragraph) === index)
    .slice(0, maxParagraphs);

  const leadText =
    paragraphPool.slice(0, 2).join(" ") ||
    cleanDescription(description, 600) ||
    cleanDescription(title, 300);

  const articleExcerpt = paragraphPool.join("\n\n");
  const quotedLines = extractQuotedLines(paragraphPool);
  const numbersMentioned = extractNumbers(articleExcerpt).slice(0, 12);

  return {
    url: normalizedUrl,
    normalizedUrl,
    source: sourceName,
    title: cleanDescription(title, 300),
    publishedAt,
    description: cleanDescription(description, 500),
    leadText: cleanDescription(leadText, 1000),
    articleExcerpt: cleanDescription(articleExcerpt, 4000),
    keyParagraphs: paragraphPool,
    quotedLines,
    numbersMentioned,
  };
}

function matchSource(articleUrl: string): { name: string; url: string } | null {
  let hostname: string;
  try {
    hostname = new URL(articleUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }

  for (const source of SOURCES) {
    try {
      const hosts = [
        new URL(source.url).hostname.replace(/^www\./, ""),
        ...(source.articleHosts ?? []).map((host) => host.replace(/^www\./, "")),
      ];
      if (hosts.some((sourceHost) =>
        hostname === sourceHost ||
        hostname.endsWith(`.${sourceHost}`) ||
        sourceHost.endsWith(`.${hostname}`)
      )) {
        return { name: source.name, url: source.url };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function findRssItemByLink(
  xml: string,
  normalizedUrl: string,
): { title: string; description: string; pubDate: string } | null {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const link = extractXmlTag(item, "link");
    if (normalizeUrl(link || "") !== normalizedUrl) {
      continue;
    }
    return {
      title: extractCdataOrTag(item, "title") || "",
      description: extractCdataOrTag(item, "description") || "",
      pubDate: extractXmlTag(item, "pubDate") || "",
    };
  }
  return null;
}

function extractXmlTag(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? normalizeWhitespace(decodeHtmlEntities(match[1])) : null;
}

function extractCdataOrTag(xml: string, tagName: string): string | null {
  const cdata = xml.match(
    new RegExp(`<${tagName}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, "i"),
  );
  if (cdata) {
    return normalizeWhitespace(decodeHtmlEntities(cdata[1]));
  }
  return extractXmlTag(xml, tagName);
}

function extractMetaContent(
  html: string,
  attrName: "property" | "name",
  attrValue: string,
): string | null {
  const pattern = new RegExp(
    `<meta[^>]+${attrName}=(["'])${escapeRegex(attrValue)}\\1[^>]+content=(["'])([\\s\\S]*?)\\2[^>]*>`,
    "i",
  );
  const reversePattern = new RegExp(
    `<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]+${attrName}=(["'])${escapeRegex(attrValue)}\\3[^>]*>`,
    "i",
  );
  const match = html.match(pattern) ?? html.match(reversePattern);
  if (!match) {
    return null;
  }
  const content = match.length >= 4 ? (match[3] ?? match[2]) : match[1];
  return content ? normalizeWhitespace(decodeHtmlEntities(content)) : null;
}

function extractTagText(html: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = html.match(pattern);
  return match ? normalizeWhitespace(stripHtml(decodeHtmlEntities(match[1]))) : null;
}

function extractTimeDatetime(html: string): string | null {
  const match = html.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i);
  return match ? match[1] : null;
}

function prepareHtmlForExtraction(html: string): string {
  const bodyMatch = html.match(/<body[\s\S]*<\/body>/i);
  const base = bodyMatch ? bodyMatch[0] : html;

  return base
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .slice(0, 220_000);
}

function extractParagraphs(html: string): string[] {
  const articleMatch =
    html.match(/<article[\s\S]*?<\/article>/i) ||
    html.match(/<main[\s\S]*?<\/main>/i) ||
    html.match(/<body[\s\S]*?<\/body>/i);
  const scope = articleMatch ? articleMatch[0] : html;
  const matches = Array.from(scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi));

  return matches
    .map((match) => normalizeWhitespace(stripHtml(decodeHtmlEntities(match[1]))))
    .filter(Boolean);
}

function extractQuotedLines(paragraphs: string[]): string[] {
  return paragraphs
    .filter((paragraph) => /["“”']/u.test(paragraph))
    .slice(0, 6)
    .map((paragraph) => cleanDescription(paragraph, 300));
}

function extractNumbers(input: string): string[] {
  return Array.from(
    new Set(
      (input.match(/(?:\$?\d[\d,.]*%?|\d+(?:\.\d+)?\s?(?:billion|million|trillion|basis points|bps|percent))/gi) ?? [])
        .map((value) => value.trim()),
    ),
  );
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBylineParagraph(paragraph: string): boolean {
  return /^(written by|by\s+[A-Z][a-z]+|disclaimer|image source|read more|some subscribers prefer to save their log-in information|to activate this function|this will save the password)/i.test(
    paragraph,
  );
}
