import {
  buildTopicKey,
  categoryForSignal,
  clusterEditorialSignals,
  scoreBaseEditorial,
} from "./editorial";
import type { EditorialCachePayload, EditorialSignalItem, Env, FeedItem } from "./types";

const KOL_SOURCES: Array<{ username: string; priority: number }> = [
  { username: "KobeissiLetter", priority: 82 },
  { username: "tradfi", priority: 84 },
  { username: "EricBalchunas", priority: 84 },
  { username: "JSeyff", priority: 82 },
  { username: "EleanorTerrett", priority: 82 },
  { username: "DegenerateNews", priority: 74 },
  { username: "DefiantNews", priority: 74 },
  { username: "followin_io_zh", priority: 70 },
  { username: "lanhubiji", priority: 70 },
  { username: "aixbt_agent", priority: 68 },
  { username: "BinanceResearch", priority: 76 },
  { username: "WSJmarkets", priority: 80 },
  { username: "BitcoinMagazine", priority: 74 },
  { username: "alphanonceStaff", priority: 72 },
  { username: "lookonchain", priority: 72 },
];

const SIGNAL_CACHE_KEY = "editorial-signals:v1";

export async function refreshEditorialCache(env: Env): Promise<EditorialCachePayload | null> {
  const signals = await fetchEditorialSignals(env);
  if (signals.length === 0) {
    return null;
  }

  const { clusterEditorialSignals } = await import("./editorial");
  const topics = clusterEditorialSignals(signals);
  const payload: EditorialCachePayload = {
    updatedAt: new Date().toISOString(),
    signals,
    topics,
    stats: {
      blockbeats: signals.filter((signal) => signal.source === "blockbeats").length,
      opennews: signals.filter((signal) => signal.source === "opennews").length,
      twitter: signals.filter((signal) => signal.source.startsWith("twitter/")).length,
      topics: topics.length,
    },
  };

  if (env.EDITORIAL_CACHE) {
    await env.EDITORIAL_CACHE.put(SIGNAL_CACHE_KEY, JSON.stringify(payload), {
      expirationTtl: 60 * 60 * 6,
    });
  }

  return payload;
}

export async function loadEditorialCache(
  env: Env,
): Promise<EditorialCachePayload | null> {
  if (!env.EDITORIAL_CACHE) {
    return null;
  }
  const cached = await env.EDITORIAL_CACHE.get(SIGNAL_CACHE_KEY, "json");
  return cached as EditorialCachePayload | null;
}

export function filterEditorialCachePayload(
  payload: EditorialCachePayload | null,
  options: {
    usePrivateSignals: boolean;
    useBlockBeats: boolean;
    useOpenNews: boolean;
    useTwitterKols: boolean;
  },
): EditorialCachePayload | null {
  if (!payload || !options.usePrivateSignals) {
    return null;
  }

  const signals = payload.signals.filter((signal) => {
    if (signal.source === "blockbeats") {
      return options.useBlockBeats;
    }
    if (signal.source === "opennews") {
      return options.useOpenNews;
    }
    if (signal.source.startsWith("twitter/")) {
      return options.useTwitterKols;
    }
    return true;
  });

  if (signals.length === 0) {
    return null;
  }

  const topics = clusterEditorialSignals(signals);
  return {
    ...payload,
    signals,
    topics,
    stats: {
      blockbeats: signals.filter((signal) => signal.source === "blockbeats").length,
      opennews: signals.filter((signal) => signal.source === "opennews").length,
      twitter: signals.filter((signal) => signal.source.startsWith("twitter/")).length,
      topics: topics.length,
    },
  };
}

async function fetchEditorialSignals(env: Env): Promise<EditorialSignalItem[]> {
  const results = await Promise.all([
    fetchBlockBeats(env),
    fetchOpenNews(env),
    ...KOL_SOURCES.map((kol) => fetchKolTweets(env, kol.username, kol.priority)),
  ]);

  return results.flat();
}

async function fetchBlockBeats(env: Env): Promise<EditorialSignalItem[]> {
  if (!env.BLOCKBEATS_API_KEY) {
    return [];
  }

  try {
    const response = await fetch(
      "https://api.theblockbeats.news/v1/open-api/open-flash?size=50&page=1&lang=cht",
      {
        headers: {
          Authorization: `Bearer ${env.BLOCKBEATS_API_KEY}`,
        },
      },
    );
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as Record<string, unknown>;
    const raw = ((data.data as Record<string, unknown> | undefined)?.data ?? []) as Array<
      Record<string, unknown>
    >;

    return raw
      .map((item) =>
        createSignal({
          source: "blockbeats",
          sourceType: "aggregator",
          title: stringOrEmpty(item.title),
          content: stringOrEmpty(item.content),
          url: stringOrEmpty(item.link) || stringOrEmpty(item.url),
          ts: stringOrEmpty(item.create_time),
          engagement: 0,
          priority: 74,
        }),
      )
      .filter((item): item is EditorialSignalItem => item !== null);
  } catch {
    return [];
  }
}

async function fetchOpenNews(env: Env): Promise<EditorialSignalItem[]> {
  if (!env.OPENNEWS_TOKEN) {
    return [];
  }

  try {
    const response = await fetch("https://ai.6551.io/open/news_search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENNEWS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ limit: 50, page: 1 }),
    });
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rawData = data.data;
    const items = Array.isArray(rawData)
      ? rawData
      : (((rawData as Record<string, unknown> | undefined)?.data ??
          (rawData as Record<string, unknown> | undefined)?.list ??
          []) as Array<Record<string, unknown>>);

    return items
      .map((item) =>
        createSignal({
          source: "opennews",
          sourceType: "aggregator",
          title: stringOrEmpty(item.text) || stringOrEmpty(item.title),
          content: stringOrEmpty(item.description),
          url: stringOrEmpty(item.link),
          ts: stringOrEmpty(item.ts),
          engagement: numberOrZero(item.likes) + numberOrZero(item.score),
          priority: 78,
        }),
      )
      .filter((item): item is EditorialSignalItem => item !== null);
  } catch {
    return [];
  }
}

async function fetchKolTweets(
  env: Env,
  username: string,
  priority: number,
): Promise<EditorialSignalItem[]> {
  if (!env.TWITTER_TOKEN) {
    return [];
  }

  try {
    const response = await fetch("https://ai.6551.io/open/twitter_user_tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TWITTER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username,
        maxResults: 10,
        product: "Latest",
        includeReplies: false,
        includeRetweets: false,
      }),
    });
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as Record<string, unknown>;
    const tweets = (data.success ? data.data : []) as Array<Record<string, unknown>>;

    return tweets
      .map((tweet) =>
        createSignal({
          source: `twitter/${username}`,
          sourceType: "kol",
          title: stringOrEmpty(tweet.text).slice(0, 140),
          content: stringOrEmpty(tweet.text),
          url: tweet.id ? `https://x.com/i/status/${tweet.id}` : "",
          ts: stringOrEmpty(tweet.createdAt),
          engagement:
            numberOrZero(tweet.favoriteCount) +
            numberOrZero(tweet.retweetCount) * 2 +
            numberOrZero(tweet.replyCount) * 2 +
            numberOrZero(tweet.viewCount) / 500,
          priority,
        }),
      )
      .filter((item): item is EditorialSignalItem => item !== null);
  } catch {
    return [];
  }
}

function createSignal(input: {
  source: string;
  sourceType: "aggregator" | "kol";
  title: string;
  content: string;
  url: string;
  ts: string;
  engagement: number;
  priority: number;
}): EditorialSignalItem | null {
  if (!input.title || !input.url) {
    return null;
  }

  const pseudoItem: FeedItem = {
    id: "tmp",
    source: input.source,
    category: categoryForSignal(input.title, input.content),
    sourceType: input.sourceType === "kol" ? "media" : "media",
    sourcePriority: input.priority,
    title: input.title,
    url: input.url,
    publishedAt: parseMaybeDate(input.ts),
    description: input.content,
    rawDescription: input.content,
    matchedKeywords: [],
    ageHours: null,
    dateQuality: "ok",
    reportScore: 0,
    reportSignals: [],
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

  const scored = scoreBaseEditorial(pseudoItem);
  return {
    source: input.source,
    sourceType: input.sourceType,
    title: input.title,
    content: input.content,
    url: input.url,
    publishedAt: parseMaybeDate(input.ts),
    engagement: Math.round(input.engagement),
    priority: input.priority,
    topicKey: buildTopicKey(input.title, scored.topicEntities),
    topicTags: scored.topicTags,
    topicEntities: scored.topicEntities,
  };
}

function parseMaybeDate(input: string): string | null {
  if (!input) {
    return null;
  }
  if (/^\d{10,13}$/.test(input.trim())) {
    const numeric = Number(input.trim());
    const ms = input.trim().length === 10 ? numeric * 1000 : numeric;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const parsed = Date.parse(input);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
