export type Category = "us_stocks_macro" | "ai" | "taiwan_stocks";

export interface Env {
  API_KEY?: string;
  BLOCKBEATS_API_KEY?: string;
  OPENNEWS_TOKEN?: string;
  TWITTER_TOKEN?: string;
  ENABLE_PRIVATE_NEWS?: string;
  FMP_API_KEY?: string;
  ENABLE_FMP_STOCK_NEWS?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_TRANSLATION_MODEL?: string;
  EDITORIAL_CACHE?: CacheStore;
}

export interface CacheStore {
  get(key: string, type: "json"): Promise<unknown | null>;
  get(key: string, type?: "text"): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface FeedSource {
  name: string;
  url: string;
  category: Category;
  enabledByDefault: boolean;
  priority: number;
  sourceType: "official" | "media" | "research";
  parser?: "rss" | "statementdog_news_html";
  htmlPages?: number;
  articleHosts?: string[];
}

export interface FeedQueryParams {
  days: number;
  limitPerSource: number;
  keyword: string | null;
  maxItemsPerCategory: number;
}

export type DateQuality = "ok" | "missing" | "invalid";

export interface FeedItem {
  id: string;
  source: string;
  category: Category;
  sourceType: "official" | "media" | "research";
  sourcePriority: number;
  title: string;
  url: string;
  publishedAt: string | null;
  description: string;
  rawDescription: string | null;
  matchedKeywords: string[];
  ageHours: number | null;
  dateQuality: DateQuality;
  reportScore: number;
  reportSignals: string[];
  evidenceScore: number;
  substantiationScore: number;
  storyValueScore: number;
  penaltyScore: number;
  sourceQualityScore: number;
  corroborationScore: number;
  marketReactionScore: number;
  editorialScore: number;
  editorialSignals: string[];
  topicTags: string[];
  topicEntities: string[];
  crossSourceCount: number;
  socialProof: number;
  eventType: string | null;
  majorEntity: string | null;
  marketTheme: string | null;
  clusterKey: string;
}

export interface FailedFeed {
  source: string;
  category: Category;
  url: string;
  reason: string;
  status: number | null;
}

export interface FeedFetchResult {
  items: FeedItem[];
  failedFeed?: FailedFeed;
  source: FeedSource;
}

export interface TopicCluster {
  clusterKey: string;
  category: Category;
  title: string;
  eventType: string | null;
  majorEntity: string | null;
  marketTheme: string | null;
  itemCount: number;
  sourceCount: number;
  sources: string[];
  totalEditorialScore: number;
  averageEditorialScore: number;
  topItemIds: string[];
  topItemTitles: string[];
  topicTags: string[];
  topicEntities: string[];
}

export interface NarrativeBundle {
  bundleKey: string;
  title: string;
  summary: string;
  angle: string;
  whyGrouped: string;
  categories: Category[];
  coreClusterKeys: string[];
  relatedClusterKeys: string[];
  clusterKeys: string[];
  marketThemes: string[];
  eventTypes: string[];
  entities: string[];
  itemCount: number;
  sourceCount: number;
  totalEditorialScore: number;
  crossCategory: boolean;
  coreTopTitles: string[];
  relatedTopTitles: string[];
  topTitles: string[];
}

export interface EditorialSignalItem {
  source: string;
  sourceType: "aggregator" | "kol";
  title: string;
  content: string;
  url: string;
  publishedAt: string | null;
  engagement: number;
  priority: number;
  topicKey: string;
  topicTags: string[];
  topicEntities: string[];
}

export interface EditorialTopic {
  topicKey: string;
  title: string;
  sourceCount: number;
  sources: string[];
  totalEngagement: number;
  signalScore: number;
  topicTags: string[];
  topicEntities: string[];
  updatedAt: string;
}

export interface EditorialCachePayload {
  updatedAt: string;
  signals: EditorialSignalItem[];
  topics: EditorialTopic[];
  stats: {
    blockbeats: number;
    opennews: number;
    twitter: number;
    topics: number;
  };
}
