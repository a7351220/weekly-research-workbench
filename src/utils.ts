import { CATEGORY_ORDER } from "./sources";
import type { Category, DateQuality, FeedItem, WeeklyQueryParams } from "./types";

const TRACKING_QUERY_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "guccounter",
  "guce_referrer",
  "guce_referrer_sig",
];

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&nbsp;": " ",
};

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...(init.headers ?? {}),
    },
  });
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function parseNumber(
  value: string | null,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  let result = Math.trunc(parsed);
  if (options.min !== undefined) {
    result = Math.max(options.min, result);
  }
  if (options.max !== undefined) {
    result = Math.min(options.max, result);
  }
  return result;
}

export function parseCategories(
  value: string | null,
  includeTaiwan: boolean,
): Category[] {
  const allowed = new Set<Category>(
    includeTaiwan ? CATEGORY_ORDER : CATEGORY_ORDER.filter((c) => c !== "taiwan_stocks"),
  );

  if (!value) {
    return [...allowed];
  }

  const parsed = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part): part is Category => allowed.has(part as Category));

  return parsed.length > 0 ? Array.from(new Set(parsed)) : [...allowed];
}

export function buildWeeklyParams(url: URL): WeeklyQueryParams {
  const includeTaiwan = parseBoolean(url.searchParams.get("includeTaiwan"), false);
  const categories = parseCategories(url.searchParams.get("categories"), includeTaiwan);

  return {
    days: parseNumber(url.searchParams.get("days"), 7, { min: 1, max: 30 }),
    limitPerSource: parseNumber(url.searchParams.get("limitPerSource"), 10, {
      min: 1,
      max: 50,
    }),
    includeTaiwan,
    categories,
    keyword: normalizeKeyword(url.searchParams.get("keyword")),
    maxItemsPerCategory: parseNumber(
      url.searchParams.get("maxItemsPerCategory"),
      30,
      { min: 1, max: 100 },
    ),
  };
}

export function normalizeKeyword(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    for (const key of TRACKING_QUERY_KEYS) {
      url.searchParams.delete(key);
    }

    const entries = Array.from(url.searchParams.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    url.search = "";
    for (const [key, value] of entries) {
      url.searchParams.append(key, value);
    }

    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return input.trim();
  }
}

export function decodeHtmlEntities(input: string): string {
  let output = input;
  for (const [encoded, decoded] of Object.entries(ENTITY_MAP)) {
    output = output.split(encoded).join(decoded);
  }

  output = output.replace(/&#(\d+);/g, (_, code) =>
    String.fromCodePoint(Number.parseInt(code, 10)),
  );
  output = output.replace(/&#x([0-9a-f]+);/gi, (_, code) =>
    String.fromCodePoint(Number.parseInt(code, 16)),
  );
  return output;
}

export function stripHtml(input: string): string {
  return input
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function cleanDescription(input: string | null, maxLength = 400): string {
  if (!input) {
    return "";
  }

  const cleaned = normalizeWhitespace(stripHtml(decodeHtmlEntities(input)));
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

export function resolveUrl(input: string, baseUrl: string): string {
  try {
    return new URL(input, baseUrl).toString();
  } catch {
    return input.trim();
  }
}

export function parseDate(input: string | null): {
  publishedAt: string | null;
  publishedMs: number | null;
  dateQuality: DateQuality;
  ageHours: number | null;
} {
  if (!input) {
    return {
      publishedAt: null,
      publishedMs: null,
      dateQuality: "missing",
      ageHours: null,
    };
  }

  const parsedMs = Date.parse(input);
  if (Number.isNaN(parsedMs)) {
    return {
      publishedAt: null,
      publishedMs: null,
      dateQuality: "invalid",
      ageHours: null,
    };
  }

  const nowMs = Date.now();
  return {
    publishedAt: new Date(parsedMs).toISOString(),
    publishedMs: parsedMs,
    dateQuality: "ok",
    ageHours: Math.max(0, Math.round(((nowMs - parsedMs) / 36e5) * 10) / 10),
  };
}

export function shouldKeepByDate(
  item: Pick<FeedItem, "publishedAt" | "dateQuality">,
  days: number,
): boolean {
  if (!item.publishedAt) {
    return true;
  }
  const ageMs = Date.now() - Date.parse(item.publishedAt);
  return ageMs <= days * 24 * 60 * 60 * 1000;
}

export function computeMatchedKeywords(
  keyword: string | null,
  title: string,
  description: string,
): string[] {
  if (!keyword) {
    return [];
  }

  const haystack = `${title} ${description}`.toLowerCase();
  const words = Array.from(
    new Set(
      keyword
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.trim())
        .filter(Boolean),
    ),
  );

  return words.filter((word) => haystack.includes(word));
}

export function sortFeedItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => {
    if (a.publishedAt && b.publishedAt) {
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    }
    if (a.publishedAt) {
      return -1;
    }
    if (b.publishedAt) {
      return 1;
    }
    return a.title.localeCompare(b.title);
  });
}

export async function createStableId(source: string, url: string): Promise<string> {
  const payload = new TextEncoder().encode(`${source}:${normalizeUrl(url)}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

export function computeReportSignals(
  title: string,
  description: string,
  sourceType: "official" | "media" | "research",
): { score: number; signals: string[] } {
  const text = `${title} ${description}`.toLowerCase();
  const signals: string[] = [];
  let score = 0;

  if (sourceType === "official") {
    score += 30;
    signals.push("official_source");
  } else if (sourceType === "research") {
    score += 16;
    signals.push("research_source");
  } else {
    score += 8;
    signals.push("media_source");
  }

  const positiveSignals: Array<[string, RegExp, number]> = [
    ["policy_or_regulation", /\b(approve|approval|rule|regulation|regulator|enforcement|settlement|policy|framework|sanction|lawsuit)\b/, 18],
    ["market_data", /\b(cpi|inflation|jobs|payroll|gdp|rates?|yield|etf|flows?|volume|revenue|earnings|guidance|forecast)\b/, 16],
    ["product_or_model_launch", /\b(launch|released|release|introducing|announce|announcing|rollout|debut|unveil)\b/, 14],
    ["funding_or_infra", /\b(funding|investment|capex|compute|data center|gpu|chip|tpu|infrastructure)\b/, 12],
    ["security_or_risk", /\b(hack|security|breach|fraud|risk|warning|volatility|liquidation)\b/, 10],
  ];

  const negativeSignals: Array<[string, RegExp, number]> = [
    ["low_signal_howto", /\b(tips|how to|how-to|guide|course|tutorial)\b/, -12],
    ["evergreen_or_brand", /\b(celebrating|fun facts|event recap|community|workshop)\b/, -10],
    ["generic_roundup", /\b(here(?:'|’)s what happened|what happened .* today|daily recap|roundup|top stories|week in review)\b/, -18],
  ];

  for (const [name, pattern, weight] of positiveSignals) {
    if (pattern.test(text)) {
      score += weight;
      signals.push(name);
    }
  }

  for (const [name, pattern, weight] of negativeSignals) {
    if (pattern.test(text)) {
      score += weight;
      signals.push(name);
    }
  }

  return { score, signals };
}
