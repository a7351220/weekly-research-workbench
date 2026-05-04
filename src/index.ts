import { CATEGORY_ORDER, SOURCES, getSourcesByCategory } from "./sources";
import { OPENAPI_YAML } from "./openapi";
import {
  buildNarrativeBundles,
  buildTopicClusters,
  enrichWithEditorialSignals,
  sortItemsForWeekly,
} from "./editorial";
import { fetchFeed } from "./rss";
import { filterEditorialCachePayload, loadEditorialCache, refreshEditorialCache } from "./signals";
import { buildSourceContextResponse, parseSourceContextParams } from "./source-context";
import type {
  Category,
  Env,
  FeedItem,
  FeedSource,
  SourceContextResponse,
  WeeklyResponse,
} from "./types";
import {
  buildWeeklyParams,
  handleOptions,
  jsonResponse,
  normalizeUrl,
  sortFeedItems,
} from "./utils";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    if (request.method !== "GET") {
      return jsonResponse(
        { ok: false, error: "Method not allowed" },
        { status: 405 },
      );
    }

    const url = new URL(request.url);

    switch (url.pathname) {
      case "/health":
        return jsonResponse({
          ok: true,
          service: "weekly-rss-middleware",
          generatedAt: new Date().toISOString(),
        });
      case "/openapi.yaml":
        return new Response(OPENAPI_YAML, {
          headers: {
            "content-type": "application/yaml; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      case "/sources":
        if (!isAuthorized(request, env)) {
          return unauthorizedResponse();
        }
        return handleSources();
      case "/weekly":
        if (!isAuthorized(request, env)) {
          return unauthorizedResponse();
        }
        return handleWeekly(url, env);
      case "/source-context":
        if (!isAuthorized(request, env)) {
          return unauthorizedResponse();
        }
        return handleSourceContext(url);
      default:
        return jsonResponse(
          {
            ok: false,
            error: "Not found",
            availableEndpoints: ["/health", "/sources", "/weekly", "/source-context"],
          },
          { status: 404 },
        );
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshEditorialCache(env));
  },
} satisfies ExportedHandler<Env>;

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.API_KEY) {
    return true;
  }

  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${env.API_KEY}`;
}

function unauthorizedResponse(): Response {
  return jsonResponse(
    {
      ok: false,
      error: "Unauthorized",
      message: "Missing or invalid bearer token",
    },
    { status: 401 },
  );
}

function handleSources(): Response {
  const sourceMap = getSourcesByCategory(true);

  return jsonResponse({
    categories: {
      crypto: sourceMap.crypto.map(mapSourceForResponse),
      us_stocks_macro: sourceMap.us_stocks_macro.map(mapSourceForResponse),
      ai: sourceMap.ai.map(mapSourceForResponse),
      taiwan_stocks: sourceMap.taiwan_stocks.map(mapSourceForResponse),
    },
  });
}

async function handleWeekly(url: URL, env: Env): Promise<Response> {
  const params = buildWeeklyParams(url);
  const selectedSources = selectSources(params.categories, params.includeTaiwan, params.sources);
  const results = await Promise.all(selectedSources.map((source) => fetchFeed(source, params)));
  let editorialCache = await loadEditorialCache(env);
  if (!editorialCache && hasEditorialSecrets(env)) {
    editorialCache = await refreshEditorialCache(env);
  }
  editorialCache = filterEditorialCachePayload(editorialCache, {
    usePrivateSignals: params.usePrivateSignals,
    useBlockBeats: params.useBlockBeats,
    useOpenNews: params.useOpenNews,
    useTwitterKols: params.useTwitterKols,
  });

  const failedFeeds = results
    .filter((result) => result.failedFeed)
    .map((result) => result.failedFeed!);

  const dedupe = new Set<string>();
  const categories: Record<Category, FeedItem[]> = {
    crypto: [],
    us_stocks_macro: [],
    ai: [],
    taiwan_stocks: [],
  };

  for (const result of results) {
    for (const item of result.items) {
      const dedupeKey = normalizeUrl(item.url);
      if (dedupe.has(dedupeKey)) {
        continue;
      }
      dedupe.add(dedupeKey);
      categories[item.category].push(
        enrichWithEditorialSignals(item, editorialCache?.topics ?? []),
      );
    }
  }

  for (const category of CATEGORY_ORDER) {
    const sorted = sortItemsForWeekly(categories[category]);
    categories[category] =
      category === "taiwan_stocks"
        ? diversifyTaiwanItems(sorted, params.maxItemsPerCategory)
        : sorted.slice(0, params.maxItemsPerCategory);
  }
  const topicClusters = buildTopicClusters(Object.values(categories).flat());
  const narrativeBundles = buildNarrativeBundles(topicClusters);

  const response: WeeklyResponse = {
    ok: true,
    generatedAt: new Date().toISOString(),
    params: {
      days: params.days,
      limitPerSource: params.limitPerSource,
      includeTaiwan: params.includeTaiwan,
      categories: params.categories,
      sources: params.sources,
      usePrivateSignals: params.usePrivateSignals,
      useBlockBeats: params.useBlockBeats,
      useOpenNews: params.useOpenNews,
      useTwitterKols: params.useTwitterKols,
      keyword: params.keyword,
      maxItemsPerCategory: params.maxItemsPerCategory,
    },
    summary: {
      totalItems: Object.values(categories).reduce(
        (sum, items) => sum + items.length,
        0,
      ),
      successfulFeeds: results.length - failedFeeds.length,
      failedFeeds: failedFeeds.length,
    },
    categories,
    topicClusters,
    narrativeBundles,
    failedFeeds,
  };

  return jsonResponse(response);
}

async function handleSourceContext(url: URL): Promise<Response> {
  const params = parseSourceContextParams(url);
  if (params.urls.length === 0) {
    return jsonResponse(
      {
        ok: false,
        error: "Missing article URLs",
        message: "Provide one or more article URLs with ?url=... or ?urls=url1,url2",
      },
      { status: 400 },
    );
  }

  const response: SourceContextResponse = await buildSourceContextResponse(
    params.urls,
    params.maxParagraphs,
  );
  return jsonResponse(response);
}

function selectSources(
  categories: Category[],
  includeTaiwan: boolean,
  selectedSourceNames: string[] | null,
): FeedSource[] {
  const allowed = new Set(categories);
  const selected = selectedSourceNames ? new Set(selectedSourceNames) : null;
  return SOURCES.filter((source) => {
    if (source.category === "taiwan_stocks" && !includeTaiwan) {
      return false;
    }
    if (!allowed.has(source.category)) {
      return false;
    }
    if (selected && !selected.has(source.name)) {
      return false;
    }
    return true;
  });
}

function mapSourceForResponse(source: FeedSource) {
  return {
    name: source.name,
    url: source.url,
    enabled: source.enabledByDefault,
    priority: source.priority,
    sourceType: source.sourceType,
  };
}

function hasEditorialSecrets(env: Env): boolean {
  return Boolean(env.BLOCKBEATS_API_KEY || env.OPENNEWS_TOKEN || env.TWITTER_TOKEN);
}

function diversifyTaiwanItems(items: FeedItem[], limit: number): FeedItem[] {
  const picked: FeedItem[] = [];
  const sourceCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const seen = new Set<string>();

  const familyOf = (item: FeedItem): string => {
    const tags = item.topicTags ?? [];
    if (tags.includes("taiwan_ai_supply_chain") || tags.includes("taiwan_data_center")) {
      return "ai";
    }
    if (tags.includes("taiwan_etf_flows")) {
      return "etf";
    }
    if (tags.includes("taiwan_market_story")) {
      return "market";
    }
    if (tags.includes("taiwan_policy") || tags.includes("taiwan_admin_notice")) {
      return "policy";
    }
    if (tags.includes("taiwan_semis")) {
      return "semis";
    }
    return "other";
  };

  const pushIfAllowed = (
    item: FeedItem,
    sourceCap: number,
    familyCap: number,
  ): boolean => {
    if (picked.length >= limit) return false;
    if (seen.has(item.id)) return false;
    const sourceCount = sourceCounts.get(item.source) ?? 0;
    const family = familyOf(item);
    const familyCount = familyCounts.get(family) ?? 0;
    if (sourceCount >= sourceCap || familyCount >= familyCap) {
      return false;
    }
    picked.push(item);
    seen.add(item.id);
    sourceCounts.set(item.source, sourceCount + 1);
    familyCounts.set(family, familyCount + 1);
    return true;
  };

  for (const item of items) {
    pushIfAllowed(item, 3, 5);
  }
  for (const item of items) {
    pushIfAllowed(item, 5, 8);
  }
  for (const item of items) {
    pushIfAllowed(item, 8, limit);
  }

  return picked.slice(0, limit);
}
