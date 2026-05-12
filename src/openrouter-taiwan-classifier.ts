import type { AiNewsClassification, Env, FeedItem } from "./types";

interface ClassifiedItem {
  id: string;
  classification: AiNewsClassification;
}

interface BatchClassificationResult {
  items: ClassifiedItem[];
  model: string;
}

interface TaiwanClassificationResult {
  items: FeedItem[];
  summary: {
    enabled: boolean;
    mode: "rules_only" | "openrouter";
    model: string | null;
    classifiedItems: number;
    usedCache: boolean;
    failed: boolean;
    reason: string | null;
  };
}

const DEFAULT_MODEL = "mistralai/mistral-nemo";
const FALLBACK_MODEL = "mistralai/mistral-small-24b-instruct-2501";
const BATCH_SIZE = 12;

export async function classifyTaiwanItemsWithOpenRouter(
  items: FeedItem[],
  env: Env,
  enabled: boolean,
): Promise<TaiwanClassificationResult> {
  const model = env.OPENROUTER_CLASSIFICATION_MODEL || env.OPENROUTER_TRANSLATION_MODEL || DEFAULT_MODEL;
  if (!enabled) {
    return {
      items,
      summary: {
        enabled: false,
        mode: "rules_only",
        model: null,
        classifiedItems: 0,
        usedCache: false,
        failed: false,
        reason: "disabled_by_query",
      },
    };
  }

  if (!env.OPENROUTER_API_KEY) {
    return {
      items,
      summary: {
        enabled: false,
        mode: "rules_only",
        model: null,
        classifiedItems: 0,
        usedCache: false,
        failed: false,
        reason: "missing_openrouter_key",
      },
    };
  }

  const cacheKey = buildBatchCacheKey(items, model);
  const cached = await env.EDITORIAL_CACHE?.get(cacheKey, "json");
  if (isClassifiedItems(cached)) {
    return {
      items: mergeClassifications(items, cached),
      summary: {
        enabled: true,
        mode: "openrouter",
        model,
        classifiedItems: cached.length,
        usedCache: true,
        failed: false,
        reason: null,
      },
    };
  }

  try {
    const classified: ClassifiedItem[] = [];
    const usedModels = new Set<string>();
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const batch = items.slice(start, start + BATCH_SIZE);
      const batchResult = await classifyBatch(batch, env, model);
      classified.push(...batchResult.items);
      usedModels.add(batchResult.model);
    }
    await env.EDITORIAL_CACHE?.put(cacheKey, JSON.stringify(classified), {
      expirationTtl: 60 * 60 * 24 * 7,
    });
    return {
      items: mergeClassifications(items, classified),
      summary: {
        enabled: true,
        mode: "openrouter",
        model: Array.from(usedModels).join(", ") || model,
        classifiedItems: classified.length,
        usedCache: false,
        failed: false,
        reason: null,
      },
    };
  } catch (error) {
    return {
      items,
      summary: {
        enabled: true,
        mode: "rules_only",
        model,
        classifiedItems: 0,
        usedCache: false,
        failed: true,
        reason: error instanceof Error ? error.message : "classification_failed",
      },
    };
  }
}

async function classifyBatch(items: FeedItem[], env: Env, primaryModel: string): Promise<BatchClassificationResult> {
  const candidateModels = Array.from(new Set([primaryModel, FALLBACK_MODEL].filter(Boolean)));
  let lastError = "openrouter_empty_classification";

  for (const model of candidateModels) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://weekly-rss-daily.zeabur.app",
        "X-Title": "weekly-rss-daily taiwan classifier",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是台股新聞分類器。只能根據輸入新聞的標題、摘要、來源、日期做判斷，不可補充外部知識。輸出嚴格 JSON：{\"items\":[{\"id\":\"...\",\"focus\":\"stock|industry|market|macro|official|fund_etf|noise|other\",\"importance\":0-100,\"confidence\":0-1,\"entities\":[\"...\"],\"themes\":[\"...\"],\"isTopStory\":true,\"isStockNews\":false,\"isIndustryNews\":false,\"rationale\":\"8字內\"}]}。rationale 只寫極短標籤，例如：公司營收、ETF配息、外資買超、供應鏈擴產。不要解釋規則，不要寫完整句。判斷規則：1) ETF、基金、配息、排行屬於 fund_etf。2) 活動、講座、抽獎、生活、旅遊、房市屬於 noise。3) 明確公司財報、營收、法說、訂單、股價異動屬於 stock。4) 供應鏈、半導體、封裝、PCB、AI 伺服器、記憶體屬於 industry。5) 加權指數、外資、三大法人、成交量屬於 market。6) 匯率、央行、出口、PMI、通膨、利率屬於 macro。7) 證交所、櫃買重大公告且不是ETF時可標 official。8) 盡量讓 isTopStory 只給真正重要的少數項目。",
          },
          {
            role: "user",
            content: JSON.stringify({
              items: items.map((item) => ({
                id: item.id,
                title: item.title,
                summary: item.description,
                source: item.source,
                publishedAt: item.publishedAt,
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      lastError = `openrouter_http_${response.status}`;
      continue;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseClassifiedItems(content, model);
    if (parsed.length > 0) {
      return { items: parsed, model };
    }

    lastError = "openrouter_empty_classification";
  }

  throw new Error(lastError);
}

function parseClassifiedItems(value: string, model: string): ClassifiedItem[] {
  const cleaned = value
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (start < 0) return [];

  try {
    const jsonCandidate = end > start
      ? cleaned.slice(start, end + 1)
      : arrayEnd > start
        ? `${cleaned.slice(start, arrayEnd + 1)}}`
        : "";
    if (!jsonCandidate) return [];

    const parsed = JSON.parse(jsonCandidate) as {
      items?: Array<{
        id?: string;
        focus?: string;
        importance?: number;
        confidence?: number;
        entities?: unknown;
        themes?: unknown;
        isTopStory?: boolean;
        isStockNews?: boolean;
        isIndustryNews?: boolean;
        rationale?: string;
      }>;
    };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items
      .map((item) => {
        const id = String(item.id || "").trim();
        const focus = normalizeFocus(String(item.focus || ""));
        if (!id || !focus) return null;
        return {
          id,
          classification: {
            mode: "openrouter" as const,
            model,
            focus,
            importance: clampNumber(item.importance, 0, 100, 50),
            confidence: clampFloat(item.confidence, 0, 1, 0.5),
            entities: normalizeStringArray(item.entities),
            themes: normalizeStringArray(item.themes),
            isTopStory: Boolean(item.isTopStory),
            isStockNews: Boolean(item.isStockNews),
            isIndustryNews: Boolean(item.isIndustryNews),
            rationale: String(item.rationale || "").trim().slice(0, 40),
          },
        };
      })
      .filter((item): item is ClassifiedItem => Boolean(item));
  } catch {
    return [];
  }
}

function mergeClassifications(items: FeedItem[], classified: ClassifiedItem[]): FeedItem[] {
  const byId = new Map(classified.map((item) => [item.id, item.classification]));
  return items.map((item) => {
    const ai = byId.get(item.id);
    if (!ai) return item;

    const tags = new Set(item.topicTags);
    tags.add(`ai_focus:${ai.focus}`);
    for (const theme of ai.themes) tags.add(theme);

    const entities = unique([...item.topicEntities, ...ai.entities]);
    const editorialSignals = unique([...item.editorialSignals, "ai_classified", `ai_focus:${ai.focus}`]);
    let editorialScore = item.editorialScore;
    let marketTheme = item.marketTheme;

    if (ai.focus === "stock") editorialScore += 10;
    else if (ai.focus === "industry") editorialScore += 8;
    else if (ai.focus === "market" || ai.focus === "macro" || ai.focus === "official") editorialScore += 5;
    else if (ai.focus === "fund_etf" || ai.focus === "noise") editorialScore -= 24;

    if (ai.importance >= 80) editorialScore += 6;
    else if (ai.importance >= 65) editorialScore += 3;

    if (!marketTheme && ai.focus === "industry") marketTheme = "taiwan_ai_supply_chain";
    if (!marketTheme && ai.focus === "stock") marketTheme = "taiwan_earnings";
    if (!marketTheme && ai.focus === "macro") marketTheme = "taiwan_macro_fx";
    if (!marketTheme && ai.focus === "market") marketTheme = "taiwan_market_move";

    return {
      ...item,
      aiClassification: ai,
      topicTags: Array.from(tags),
      topicEntities: entities,
      editorialSignals,
      editorialScore: Math.max(0, Math.min(100, editorialScore)),
      storyValueScore: Math.max(0, Math.min(100, Math.round((item.storyValueScore + editorialScore) / 2))),
      marketTheme,
    };
  });
}

function normalizeFocus(value: string): AiNewsClassification["focus"] | null {
  if (value === "stock" || value === "industry" || value === "market" || value === "macro" || value === "official" || value === "fund_etf" || value === "noise" || value === "other") {
    return value;
  }
  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0)
    .slice(0, 8);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed * 100) / 100));
}

function buildBatchCacheKey(items: FeedItem[], model: string): string {
  const raw = items.map((item) => [item.id, item.title, item.description, item.source, item.publishedAt].join("|")).join("\n");
  return `openrouter:taiwan-classify:v1:${model}:${hashString(raw)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function unique<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

function isClassifiedItems(value: unknown): value is ClassifiedItem[] {
  return Array.isArray(value)
    && value.every((item) => Boolean(
      item
      && typeof item === "object"
      && typeof (item as { id?: unknown }).id === "string"
      && typeof (item as { classification?: { focus?: unknown } }).classification?.focus === "string",
    ));
}
