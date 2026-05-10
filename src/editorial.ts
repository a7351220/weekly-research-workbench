import type {
  Category,
  EditorialSignalItem,
  EditorialTopic,
  FeedItem,
  NarrativeBundle,
  TopicCluster,
} from "./types";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "amid",
  "after",
  "over",
  "this",
  "that",
  "will",
  "says",
  "said",
  "new",
  "its",
  "their",
  "about",
  "market",
  "markets",
  "stock",
  "stocks",
  "shares",
  "news",
  "company",
  "update",
  "daily",
]);

const ENTITY_PATTERNS: Array<[string, RegExp, string[]]> = [
  ["apple", /\b(apple|aapl)\b/i, ["big_tech"]],
  ["microsoft", /\b(microsoft|msft)\b/i, ["big_tech", "ai_infra"]],
  ["nvidia", /\b(nvidia|nvda)\b/i, ["chips", "ai_infra"]],
  ["amazon", /\b(amazon|amzn)\b/i, ["big_tech", "cloud"]],
  ["alphabet", /\b(alphabet|google|googl|goog)\b/i, ["big_tech", "cloud", "ai_infra"]],
  ["meta", /\b(meta|facebook)\b/i, ["big_tech", "ai_infra"]],
  ["tesla", /\b(tesla|tsla)\b/i, ["mega_cap"]],
  ["amd", /\b(amd|advanced micro devices)\b/i, ["chips", "ai_infra"]],
  ["intel", /\b(intel|intc)\b/i, ["chips"]],
  ["dell", /\b(dell)\b/i, ["ai_server", "hardware"]],
  ["supermicro", /\b(super micro|supermicro|smci)\b/i, ["ai_server", "hardware"]],
  ["fed", /\b(federal reserve|fed|fomc|powell)\b/i, ["macro_policy"]],
  ["jobs", /\b(payrolls|nonfarm|jobs report|labor market|unemployment)\b/i, ["macro_data"]],
  ["inflation", /\b(cpi|ppi|pce|inflation)\b/i, ["macro_data"]],
  ["rates", /\b(treasury yields?|10-year|10y|rate cuts?|interest rates?)\b/i, ["rates"]],
  ["sp500", /\b(s&p 500|spx|sp500)\b/i, ["index_move"]],
  ["nasdaq", /\b(nasdaq|nasdaq 100|qqq)\b/i, ["index_move", "growth"]],
  ["dow", /\b(dow jones|dow)\b/i, ["index_move"]],
  ["earnings", /\b(earnings|quarterly results|eps|revenue|guidance)\b/i, ["earnings"]],
  ["ai", /\b(ai|artificial intelligence|gpu|data center|server|cloud|capex|compute)\b/i, ["ai_infra"]],
];

const EVENT_PATTERNS: Array<[string, RegExp, number, string[]]> = [
  ["earnings", /\b(earnings|quarterly results|eps|revenue|profit|guidance|forecast|beat|miss)\b/i, 28, ["earnings"]],
  ["price_move", /\b(surged|soared|jumped|rallied|rose|gained|fell|dropped|slid|plunged|record high|all-time high)\b/i, 22, ["price_action"]],
  ["macro_data", /\b(cpi|ppi|pce|payrolls|jobs report|unemployment|gdp|retail sales|consumer confidence)\b/i, 24, ["macro_data"]],
  ["fed_policy", /\b(fed|fomc|powell|rate cut|interest rate|treasury yield)\b/i, 24, ["macro_policy"]],
  ["ai_infra", /\b(ai server|data center|gpu|chip|semiconductor|cloud|capex|compute|inference)\b/i, 22, ["ai_infra"]],
  ["deal_or_policy", /\b(deal|partnership|approval|investigation|tariff|white house|administration|policy)\b/i, 18, ["policy_or_deal"]],
];

const LOW_SIGNAL_PATTERNS: Array<[string, RegExp, number]> = [
  ["generic_roundup", /\b(roundup|top stories|what happened today|daily recap|most active)\b/i, -28],
  ["advice_article", /\b(should you buy|buy now|worth buying|best stocks?|how to invest)\b/i, -24],
  ["soft_marketing", /\b(celebrating|webinar|conference|registration|available now)\b/i, -18],
];

export function scoreBaseEditorial(item: FeedItem): FeedItem {
  const text = `${item.title} ${item.description}`.toLowerCase();
  const topicTags = new Set<string>();
  const topicEntities = new Set<string>();
  const editorialSignals: string[] = [];
  let eventType: string | null = null;
  let majorEntity: string | null = null;
  let score = item.reportScore + Math.round(item.sourcePriority / 4);

  if (item.sourceType === "official") {
    score += 18;
    editorialSignals.push("official_source");
  } else if (item.sourceType === "research") {
    score += 10;
    editorialSignals.push("research_source");
  }

  for (const [entity, pattern, tags] of ENTITY_PATTERNS) {
    if (pattern.test(text)) {
      topicEntities.add(entity);
      for (const tag of tags) topicTags.add(tag);
      if (!majorEntity) majorEntity = entity;
    }
  }

  for (const [event, pattern, weight, tags] of EVENT_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
      eventType ??= event;
      editorialSignals.push(event);
      for (const tag of tags) topicTags.add(tag);
    }
  }

  for (const [signal, pattern, weight] of LOW_SIGNAL_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
      editorialSignals.push(signal);
    }
  }

  const numbers = text.match(/\b\d+(?:\.\d+)?\s?(?:%|bps|million|billion|trillion|m|b|t|x)?\b/g) ?? [];
  if (numbers.length >= 2) {
    score += 12;
    editorialSignals.push("number_dense");
  }
  if (item.publishedAt) {
    score += 8;
  }
  if (item.ageHours !== null && item.ageHours <= 36) {
    score += 10;
    editorialSignals.push("fresh");
  }

  const sourceQualityScore =
    item.sourceType === "official" ? 90 : item.sourceType === "research" ? 78 : Math.min(85, 45 + item.sourcePriority / 2);
  const evidenceScore = Math.min(100, numbers.length * 10 + (item.sourceType === "official" ? 30 : 10));
  const storyValueScore = Math.min(100, Math.max(0, score));
  const marketReactionScore = /\b(surged|soared|jumped|rallied|fell|dropped|record high|all-time high|%\b)\b/i.test(text)
    ? 75
    : 35;
  const marketTheme = deriveMarketTheme(item.category, topicTags, majorEntity, eventType);
  const clusterKey = buildClusterKey(item.category, eventType, majorEntity, marketTheme, topicTags);

  return {
    ...item,
    evidenceScore,
    substantiationScore: Math.min(100, Math.round((sourceQualityScore + evidenceScore) / 2)),
    storyValueScore,
    penaltyScore: Math.max(0, -Math.min(0, score)),
    sourceQualityScore,
    corroborationScore: 0,
    marketReactionScore,
    editorialScore: Math.min(100, Math.max(0, score)),
    editorialSignals: unique([...item.editorialSignals, ...editorialSignals]),
    topicTags: unique([...item.topicTags, ...topicTags]),
    topicEntities: unique([...item.topicEntities, ...topicEntities]),
    eventType,
    majorEntity,
    marketTheme,
    clusterKey,
  };
}

export function enrichWithEditorialSignals(item: FeedItem, topics: EditorialTopic[] = []): FeedItem {
  const scored = scoreBaseEditorial(item);
  let socialProof = 0;
  const matchedSignals: string[] = [];
  const entities = new Set(scored.topicEntities);
  const tags = new Set(scored.topicTags);

  for (const topic of topics.slice(0, 40)) {
    const entityOverlap = topic.topicEntities.filter((entity) => entities.has(entity)).length;
    const tagOverlap = topic.topicTags.filter((tag) => tags.has(tag)).length;
    if (entityOverlap === 0 && tagOverlap < 2) {
      continue;
    }
    socialProof += topic.signalScore;
    matchedSignals.push(`signal:${topic.topicKey}`);
  }

  const corroborationScore = Math.min(100, Math.round(socialProof / 2));
  return {
    ...scored,
    socialProof,
    corroborationScore,
    editorialScore: Math.min(100, scored.editorialScore + Math.min(18, Math.round(socialProof / 12))),
    editorialSignals: unique([...scored.editorialSignals, ...matchedSignals]),
  };
}

export function sortDailyItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => {
    if (b.editorialScore !== a.editorialScore) return b.editorialScore - a.editorialScore;
    if (b.socialProof !== a.socialProof) return b.socialProof - a.socialProof;
    if (b.sourcePriority !== a.sourcePriority) return b.sourcePriority - a.sourcePriority;
    if (a.publishedAt && b.publishedAt) return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return a.title.localeCompare(b.title);
  });
}

export function clusterEditorialSignals(signals: EditorialSignalItem[]): EditorialTopic[] {
  const topics = new Map<string, EditorialTopic>();
  for (const signal of signals) {
    const existing = topics.get(signal.topicKey);
    if (!existing) {
      topics.set(signal.topicKey, {
        topicKey: signal.topicKey,
        title: signal.title,
        sourceCount: 1,
        sources: [signal.source],
        totalEngagement: signal.engagement,
        signalScore: computeSignalScore(signal.priority, signal.engagement, 1),
        topicTags: [...signal.topicTags],
        topicEntities: [...signal.topicEntities],
        updatedAt: new Date().toISOString(),
      });
      continue;
    }
    existing.sourceCount += 1;
    if (!existing.sources.includes(signal.source)) existing.sources.push(signal.source);
    existing.totalEngagement += signal.engagement;
    existing.signalScore = computeSignalScore(80, existing.totalEngagement, existing.sourceCount);
    existing.topicTags = unique([...existing.topicTags, ...signal.topicTags]);
    existing.topicEntities = unique([...existing.topicEntities, ...signal.topicEntities]);
    existing.updatedAt = new Date().toISOString();
  }
  return Array.from(topics.values()).sort((a, b) => b.signalScore - a.signalScore);
}

export function categoryForSignal(title: string, content: string): Category {
  const text = `${title} ${content}`.toLowerCase();
  if (/\b(openai|gemini|deepmind|llm|model|ai|gpu|data center|cloud|semiconductor|chip)\b/.test(text)) {
    return "ai";
  }
  return "us_stocks_macro";
}

export function buildTopicKey(title: string, entities: string[]): string {
  if (entities.length > 0) {
    return entities.slice(0, 2).join("-");
  }
  return tokenize(title).slice(0, 3).join("-") || "general";
}

export function buildTopicClusters(items: FeedItem[]): TopicCluster[] {
  const clusters = new Map<string, TopicCluster>();
  for (const item of items) {
    if (!item.clusterKey) continue;
    const existing = clusters.get(item.clusterKey);
    if (!existing) {
      clusters.set(item.clusterKey, {
        clusterKey: item.clusterKey,
        category: item.category,
        title: clusterTitle(item),
        eventType: item.eventType,
        majorEntity: item.majorEntity,
        marketTheme: item.marketTheme,
        itemCount: 1,
        sourceCount: 1,
        sources: [item.source],
        totalEditorialScore: item.editorialScore,
        averageEditorialScore: item.editorialScore,
        topItemIds: [item.id],
        topItemTitles: [item.title],
        topicTags: [...item.topicTags],
        topicEntities: [...item.topicEntities],
      });
      continue;
    }
    existing.itemCount += 1;
    if (!existing.sources.includes(item.source)) {
      existing.sources.push(item.source);
      existing.sourceCount += 1;
    }
    existing.totalEditorialScore += item.editorialScore;
    existing.averageEditorialScore = Math.round((existing.totalEditorialScore / existing.itemCount) * 10) / 10;
    if (existing.topItemIds.length < 3) {
      existing.topItemIds.push(item.id);
      existing.topItemTitles.push(item.title);
    }
    existing.topicTags = unique([...existing.topicTags, ...item.topicTags]);
    existing.topicEntities = unique([...existing.topicEntities, ...item.topicEntities]);
  }

  return Array.from(clusters.values())
    .filter((cluster) => cluster.itemCount >= 2 || cluster.totalEditorialScore >= 78)
    .sort((a, b) => {
      if (b.totalEditorialScore !== a.totalEditorialScore) return b.totalEditorialScore - a.totalEditorialScore;
      if (b.sourceCount !== a.sourceCount) return b.sourceCount - a.sourceCount;
      return b.itemCount - a.itemCount;
    });
}

export function buildNarrativeBundles(clusters: TopicCluster[]): NarrativeBundle[] {
  const ranked = [...clusters].sort((a, b) => b.totalEditorialScore - a.totalEditorialScore);
  const visited = new Set<string>();
  const bundles: NarrativeBundle[] = [];

  for (const anchor of ranked) {
    if (visited.has(anchor.clusterKey)) continue;
    const related = ranked
      .filter((candidate) => candidate.clusterKey !== anchor.clusterKey && !visited.has(candidate.clusterKey))
      .filter((candidate) => scoreClusterRelation(anchor, candidate) >= 2)
      .slice(0, 2);
    const component = [anchor, ...related];
    for (const cluster of component) visited.add(cluster.clusterKey);
    bundles.push(createBundle(component));
  }

  return bundles;
}

function createBundle(clusters: TopicCluster[]): NarrativeBundle {
  const ranked = [...clusters].sort((a, b) => b.totalEditorialScore - a.totalEditorialScore);
  const anchor = ranked[0];
  const categories = unique(ranked.map((cluster) => cluster.category));
  const entities = unique(ranked.flatMap((cluster) => cluster.topicEntities));
  const eventTypes = unique(ranked.map((cluster) => cluster.eventType).filter(Boolean) as string[]);
  const marketThemes = unique(ranked.map((cluster) => cluster.marketTheme).filter(Boolean) as string[]);
  const titles = ranked.flatMap((cluster) => cluster.topItemTitles).slice(0, 5);
  const kind = deriveBundleKind(anchor, marketThemes, entities);

  return {
    bundleKey: kind.key,
    title: kind.title,
    summary: kind.summary,
    angle: kind.angle,
    whyGrouped: "Shared company, macro driver, or AI infrastructure theme.",
    categories,
    coreClusterKeys: [anchor.clusterKey],
    relatedClusterKeys: ranked.slice(1).map((cluster) => cluster.clusterKey),
    clusterKeys: ranked.map((cluster) => cluster.clusterKey),
    marketThemes,
    eventTypes,
    entities,
    itemCount: ranked.reduce((sum, cluster) => sum + cluster.itemCount, 0),
    sourceCount: unique(ranked.flatMap((cluster) => cluster.sources)).length,
    totalEditorialScore: ranked.reduce((sum, cluster) => sum + cluster.totalEditorialScore, 0),
    crossCategory: categories.length > 1,
    coreTopTitles: anchor.topItemTitles,
    relatedTopTitles: ranked.slice(1).flatMap((cluster) => cluster.topItemTitles),
    topTitles: titles,
  };
}

function deriveBundleKind(
  anchor: TopicCluster,
  marketThemes: string[],
  entities: string[],
): { key: string; title: string; summary: string; angle: string } {
  if (marketThemes.includes("ai_infra") || entities.some((entity) => ["nvidia", "amd", "dell", "supermicro"].includes(entity))) {
    return {
      key: `ai-infra-${anchor.clusterKey}`,
      title: "AI infrastructure and hardware demand",
      summary: "AI server, chip, data-center, and cloud-capex stories are grouped because they affect the same infrastructure trade.",
      angle: "Explain the concrete company event first, then connect it to AI server or data-center demand.",
    };
  }
  if (marketThemes.includes("big_tech_earnings") || entities.some((entity) => ["apple", "microsoft", "alphabet", "amazon", "meta"].includes(entity))) {
    return {
      key: `big-tech-${anchor.clusterKey}`,
      title: "Big Tech earnings and mega-cap repricing",
      summary: "Mega-cap earnings, guidance, and price reaction are grouped to show which companies the market is rewarding.",
      angle: "Start with the stock reaction and numbers, then explain what changed in expectations.",
    };
  }
  if (marketThemes.includes("macro_policy") || marketThemes.includes("macro_data")) {
    return {
      key: `macro-${anchor.clusterKey}`,
      title: "Macro data and rate expectations",
      summary: "Fed, labor, inflation, and Treasury stories are grouped because they set the risk backdrop for equities.",
      angle: "State the data or policy event, then explain how it changes rate-cut or risk-appetite expectations.",
    };
  }
  return {
    key: `daily-${anchor.clusterKey}`,
    title: anchor.title,
    summary: "Related daily market stories grouped by shared entity or market driver.",
    angle: "Keep the event concrete and avoid turning it into an over-broad thesis.",
  };
}

function deriveMarketTheme(
  category: Category,
  tags: Set<string>,
  majorEntity: string | null,
  eventType: string | null,
): string | null {
  if (category === "ai" || tags.has("ai_infra")) return "ai_infra";
  if (eventType === "earnings" && majorEntity) return "big_tech_earnings";
  if (tags.has("macro_policy")) return "macro_policy";
  if (tags.has("macro_data") || eventType === "macro_data") return "macro_data";
  if (tags.has("index_move")) return "major_index_move";
  if (tags.has("price_action")) return "price_reaction";
  return null;
}

function buildClusterKey(
  category: Category,
  eventType: string | null,
  majorEntity: string | null,
  marketTheme: string | null,
  topicTags: Set<string>,
): string {
  const theme = marketTheme ?? eventType ?? [...topicTags][0] ?? "general";
  return [category, theme, majorEntity ?? "market"].join("|");
}

function clusterTitle(item: FeedItem): string {
  if (item.majorEntity && item.marketTheme) {
    return `${item.majorEntity} / ${item.marketTheme}`;
  }
  if (item.marketTheme) return item.marketTheme;
  return item.title;
}

function scoreClusterRelation(a: TopicCluster, b: TopicCluster): number {
  let score = 0;
  if (a.category === b.category) score += 1;
  if (a.marketTheme && a.marketTheme === b.marketTheme) score += 2;
  if (a.eventType && a.eventType === b.eventType) score += 1;
  score += intersectCount(a.topicEntities, b.topicEntities) * 2;
  score += intersectCount(a.topicTags, b.topicTags);
  return score;
}

function computeSignalScore(priority: number, engagement: number, sourceCount: number): number {
  const engagementScore = Math.min(18, Math.round(Math.log10(Math.max(engagement, 1)) * 5));
  return Math.round(priority / 4) + sourceCount * 10 + engagementScore;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function intersectCount(a: string[], b: string[]): number {
  const bSet = new Set(b);
  return a.filter((value) => bSet.has(value)).length;
}

function unique<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}
