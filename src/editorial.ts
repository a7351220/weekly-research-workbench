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
  "week",
  "market",
  "markets",
  "stock",
  "stocks",
  "shares",
  "news",
  "announces",
  "announcing",
  "introducing",
  "company",
  "crypto",
  "ai",
  "our",
  "your",
  "their",
  "more",
  "how",
  "why",
  "what",
  "when",
  "where",
  "using",
  "use",
  "guide",
  "tips",
]);

const ENTITY_PATTERNS: Array<[string, RegExp, string[]]> = [
  ["alphabet", /\b(alphabet|google|googl)\b/i, ["big_tech", "earnings_watch"]],
  ["microsoft", /\b(microsoft|msft)\b/i, ["big_tech", "earnings_watch"]],
  ["amazon", /\b(amazon|amzn)\b/i, ["big_tech", "earnings_watch"]],
  ["meta", /\b(meta|facebook)\b/i, ["big_tech", "earnings_watch"]],
  ["apple", /\b(apple|aapl)\b/i, ["big_tech", "earnings_watch"]],
  ["nvidia", /\b(nvidia|nvda)\b/i, ["chips", "ai_infra"]],
  ["intel", /\b(intel|intc)\b/i, ["chips", "ai_infra"]],
  ["amd", /\b(amd)\b/i, ["chips", "ai_infra"]],
  ["nokia", /\b(nokia)\b/i, ["telecom", "price_action"]],
  ["strategy", /\b(strategy|microstrategy|mstr|michael saylor|saylor)\b/i, ["crypto_treasury", "fund_flows"]],
  ["coinbase", /\b(coinbase|coin)\b/i, ["crypto_equities", "fund_flows"]],
  ["robinhood", /\b(robinhood|hood)\b/i, ["crypto_equities", "fund_flows"]],
  ["tesla", /\b(tesla|tsla)\b/i, ["crypto_equities"]],
  ["stablecoin", /\b(stablecoin|usdt|usdc|tether|circle)\b/i, ["fund_flows", "policy"]],
  ["fed", /\b(federal reserve|fed|powell)\b/i, ["macro_policy"]],
  ["cpi", /\b(cpi|inflation)\b/i, ["macro_data"]],
  ["jobs", /\b(payrolls|jobs report|nonfarm|labor market)\b/i, ["macro_data"]],
  ["gdp", /\b(gdp|economic growth)\b/i, ["macro_data"]],
  ["bitcoin", /\b(bitcoin|btc)\b/i, ["crypto_core"]],
  ["ethereum", /\b(ethereum|eth)\b/i, ["crypto_core"]],
  ["etf", /\b(etf|fund flows|inflows|outflows)\b/i, ["fund_flows"]],
  ["sp500", /\b(s&p 500|sp500|s and p 500)\b/i, ["index_move"]],
  ["nasdaq", /\b(nasdaq|nasdaq composite)\b/i, ["index_move"]],
  ["dow", /\b(dow jones|dow)\b/i, ["index_move"]],
];

const EVENT_PATTERNS: Array<[string, RegExp, number, string[]]> = [
  ["earnings", /\b(earnings|quarterly results|quarter results|revenue beat|profit beat|sales beat|beat estimates|missed estimates)\b/i, 28, ["earnings"]],
  ["record_high", /\b(record high|all-time high|fresh high|intraday high)\b/i, 24, ["index_move"]],
  ["index_move", /\b(s&p 500|nasdaq|dow jones|index)\b/i, 16, ["index_move"]],
  ["capex", /\b(capex|data center|compute infrastructure|gpu|tpu|server chips|ai infrastructure|cloud spending)\b/i, 18, ["ai_infra"]],
  ["regulation", /\b(rule|regulation|regulator|enforcement|settlement|approval)\b/i, 18, ["policy"]],
  ["fund_flows", /\b(etf flows?|inflows?|outflows?|redemptions?|subscriptions?|treasury strategy|buy the dip|accumulat(?:e|ion)|unrealized gain)\b/i, 20, ["fund_flows"]],
  ["price_move", /\b(surged|jumped|plunged|slid|tumbled|rallied|soared|rose|fell|dropped|gained|decliner|decliners|winner|winners)\b/i, 14, ["price_action"]],
  ["launch", /\b(launch|release|rollout|debut|unveil)\b/i, 10, ["product"]],
];

const LOW_SIGNAL_PATTERNS: Array<[string, RegExp, number]> = [
  ["howto", /\b(tips|how to|how-to|guide|course|tutorial)\b/i, -22],
  ["brand_marketing", /\b(celebrating|fun facts|anniversary|community|workshop|partnership with)\b/i, -18],
  ["soft_update", /\b(signs up|registration is open|available now|try now)\b/i, -12],
  ["generic_roundup", /\b(here(?:'|’)s what happened|what happened .* today|daily recap|roundup|top stories|week in review)\b/i, -28],
  ["admin_notice", /\b(statistical notice|request for contact details|summary and minutes|minutes|consultation paper)\b/i, -24],
  ["clickbait_analysis", /\b(can't ignore|incredible news|you should buy|buy now|just delivered|one of the .* biggest decliners today)\b/i, -20],
  ["generic_trading_list", /\b(pre-market most active|after hours most active|dow movers|daily dividend report|bull and bear of the day|how long have you owned a stock)\b/i, -28],
  ["generic_investing_advice", /\b(should you buy|here's why|strong momentum stock|smartest growth stock|buy the dip|worth .* valuation)\b/i, -18],
  ["taiwan_etf_admin_notice", /(掛牌上市|融資融券|募集發行|專區上線|了解ETF配息來源|收益平準金制度)/i, -26],
];

const HIGH_SIGNAL_ENTITY_SET = new Set([
  "alphabet",
  "microsoft",
  "amazon",
  "meta",
  "apple",
  "nvidia",
  "intel",
  "amd",
  "nokia",
  "strategy",
  "coinbase",
  "robinhood",
  "tesla",
  "stablecoin",
  "fed",
  "cpi",
  "jobs",
  "gdp",
  "sp500",
  "nasdaq",
  "dow",
  "bitcoin",
  "ethereum",
  "etf",
]);

const TAIWAN_LOCAL_HARD_SOURCE_SET = new Set([
  "FSC Press Releases",
  "TWSE News",
  "TPEx Press Releases",
  "MOPS Material Information 201001",
  "MOPS Material Information 201002",
  "MOPS Material Information 201003",
  "CNA Finance",
  "MoneyDJ Finance News",
]);

const TAIWAN_LOCAL_STORY_SOURCE_SET = new Set([
  "CNA Technology",
  "Yahoo Taiwan Stock News",
  "Yahoo Taiwan Stock News Feed",
  "Yahoo Taiwan Stock Research",
  "Yahoo Taiwan Funds News",
  "Cnyes Taiwan Stock News",
  "UDN Taiwan Stock News",
  "UDN Taiwan Industry News",
  "Business Weekly Investment",
]);

const TAIWAN_INDUSTRY_CONTEXT_SOURCE_SET = new Set([
  "DIGITIMES Daily",
  "TechNews Finance",
]);

const TAIWAN_EN_MARKET_CORE_SOURCE_SET = new Set([
  "Focus Taiwan Business",
]);

const TAIWAN_EN_MARKET_CONTEXT_SOURCE_SET = new Set([
  "Taipei Times Business",
]);

const TAIWAN_EN_SUPPLY_CHAIN_SOURCE_SET = new Set([
  "TrendForce Semiconductors",
  "TrendForce News",
]);

const TAIWAN_SUPPLY_CHAIN_PATTERN =
  /(台積電|鴻海|廣達|緯創|緯穎|技嘉|英業達|台達電|光寶科|欣興|南電|聯發科|創意|世芯|日月光|京元電|金像電|智邦|奇鋐|雙鴻|台燿|信驊|神達|仁寶|和碩|華碩|宏碁|微星|台廠|供應鏈|AI伺服器|資料中心|載板|散熱|PCB|CPO|矽光子|2奈米|先進封裝)/i;

const TAIWAN_AI_CONTEXT_PATTERN =
  /(\bai\b|人工智慧|資料中心|data center|csp|gpu|asic|伺服器|server|算力|nvidia|amd|intel|rubin|blackwell|h100|h200|b200|cloud|雲端|電源|散熱|載板|cpo|矽光子|先進封裝|2奈米)/i;

function isTaiwanSupplyChainStory(
  text: string,
  topicEntities: string[],
  topicTags: string[],
): boolean {
  if (TAIWAN_SUPPLY_CHAIN_PATTERN.test(text) && TAIWAN_AI_CONTEXT_PATTERN.test(text)) {
    return true;
  }

  if (
    topicEntities.some((entity) =>
      ["nvidia", "amd", "intel"].includes(entity),
    ) &&
    topicTags.some((tag) => ["ai_infra", "chips", "earnings"].includes(tag))
  ) {
    return true;
  }

  if (/(AI伺服器|資料中心|cpo|矽光子|先進封裝|2奈米)/i.test(text)) {
    return true;
  }

  return false;
}

function isTaiwanAdministrativeFundNotice(text: string): boolean {
  return /(掛牌上市|融資融券|募集發行|專區上線|了解ETF配息來源|收益平準金制度)/i.test(text);
}

export function scoreBaseEditorial(item: FeedItem): {
  score: number;
  signals: string[];
  topicTags: string[];
  topicEntities: string[];
} {
  const text = `${item.title} ${item.description}`;
  const titleText = item.title;
  const signals = new Set<string>(item.reportSignals);
  const topicTags = new Set<string>();
  const topicEntities = new Set<string>();
  let score = item.reportScore + Math.round(item.sourcePriority / 4);

  if (item.sourceType === "official") {
    score += 10;
    signals.add("official_weight");
  } else if (item.sourceType === "research") {
    score += 6;
    signals.add("research_weight");
  }

  for (const [entity, pattern, tags] of ENTITY_PATTERNS) {
    if (pattern.test(text)) {
      topicEntities.add(entity);
      for (const tag of tags) {
        topicTags.add(tag);
      }
      score += HIGH_SIGNAL_ENTITY_SET.has(entity) ? 12 : 8;
      signals.add(`entity:${entity}`);
    }
  }

  for (const [name, pattern, weight, tags] of EVENT_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
      signals.add(`event:${name}`);
      for (const tag of tags) {
        topicTags.add(tag);
      }
    }
  }

  for (const [name, pattern, weight] of LOW_SIGNAL_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
      signals.add(`penalty:${name}`);
    }
  }

  if (/\b(shares?|stock)\b/i.test(text) && /\b([1-9]\d?%|percent)\b/i.test(text)) {
    score += 18;
    topicTags.add("price_action");
    signals.add("explicit_market_reaction");
  }

  if (/\b(surged|jumped|fell|dropped|slid|tumbled|rallied|soared|gains|decliner|decliners)\b/i.test(titleText)) {
    score += 12;
    topicTags.add("price_action");
    signals.add("headline_market_reaction");
  }

  if (
    /\b(alphabet|google|microsoft|amazon|meta|apple|nvidia|intel|amd)\b/i.test(text) &&
    /\b(earnings|results|guidance|outlook|forecast)\b/i.test(text)
  ) {
    score += 24;
    topicTags.add("earnings");
    topicTags.add("big_tech");
    signals.add("mega_cap_earnings");
  }

  if (
    /\b(s&p 500|nasdaq|dow jones)\b/i.test(text) &&
    /\b(record high|all-time high|fresh high|intraday high)\b/i.test(text)
  ) {
    score += 30;
    topicTags.add("index_move");
    signals.add("record_high_major_index");
  }

  if (
    /\b(capex|data center|gpu|tpu|compute infrastructure|cloud spending|server chips)\b/i.test(text) &&
    /\b(alphabet|google|microsoft|amazon|meta|nvidia|intel|amd|openai)\b/i.test(text)
  ) {
    score += 20;
    topicTags.add("ai_infra");
    signals.add("ai_capex_mainline");
  }

  if (/\b(strategy|microstrategy|mstr|michael saylor|saylor)\b/i.test(text)) {
    score += 26;
    topicTags.add("fund_flows");
    topicTags.add("crypto_treasury");
    signals.add("strategy_priority");
  }

  if (
    /\b(etf|fund flows|inflows|outflows|redemptions|subscriptions|stablecoin|usdt|usdc)\b/i.test(text)
  ) {
    score += 18;
    topicTags.add("fund_flows");
    signals.add("crypto_flow_signal");
  }

  if (
    /\b(sec|cftc|stablecoin|regulation|approval|enforcement|settlement|lawmakers?)\b/i.test(text) &&
    /\b(bitcoin|btc|ethereum|eth|crypto|exchange|coinbase|binance|etf|stablecoin)\b/i.test(text)
  ) {
    score += 20;
    topicTags.add("policy");
    signals.add("crypto_policy_mainline");
  }

  if (
    /\b(s&p 500|nasdaq|dow jones|record high|all-time high|risk assets?)\b/i.test(text) &&
    /\b(bitcoin|btc|ethereum|eth|crypto|etf|strategy)\b/i.test(text)
  ) {
    score += 18;
    topicTags.add("index_move");
    signals.add("crypto_x_macro_linkage");
  }

  if (
    /\b(alphabet|google|microsoft|amazon|meta|apple|nvidia|intel|amd|nokia)\b/i.test(text) &&
    /\b(surged|jumped|plunged|slid|tumbled|rallied|soared|rose|fell|dropped|gained|record high|all-time high|decliner|decliners)\b/i.test(text)
  ) {
    score += 18;
    topicTags.add("price_action");
    signals.add("mega_cap_price_reaction");
  }

  if (
    /\b(mag 7|magnificent 7|alphabet|google|microsoft|amazon|meta|apple|nvidia|intel|amd|nokia)\b/i.test(text) &&
    /\b(earnings|guidance|forecast|gains|decliner|decliners|record high|all-time high)\b/i.test(text)
  ) {
    score += 20;
    topicTags.add("price_action");
    topicTags.add("big_tech");
    signals.add("equity_mainline_reaction");
  }

  if (item.ageHours !== null) {
    if (item.ageHours <= 24) {
      score += 10;
      signals.add("fresh_lt_24h");
    } else if (item.ageHours <= 72) {
      score += 6;
      signals.add("fresh_lt_72h");
    } else if (item.ageHours <= 168) {
      score += 2;
      signals.add("fresh_lt_7d");
    }
  }

  if (item.category === "us_stocks_macro") {
    if (topicTags.has("earnings") || topicTags.has("index_move") || topicTags.has("macro_data")) {
      score += 16;
      signals.add("market_weekly_fit");
    }
  }

  if (item.category === "ai" && (topicTags.has("ai_infra") || topicTags.has("earnings"))) {
    score += 12;
    signals.add("ai_weekly_fit");
  }

  if (item.category === "crypto" && (topicTags.has("policy") || topicTags.has("fund_flows"))) {
    score += 16;
    signals.add("crypto_weekly_fit");
  }

  if (item.category === "taiwan_stocks") {
    const isSupplyChainStory = isTaiwanSupplyChainStory(
      text,
      Array.from(topicEntities),
      Array.from(topicTags),
    );
    const isAdministrativeFundNotice = isTaiwanAdministrativeFundNotice(text);

    if (/(台積電|聯發科|世芯|創意|日月光|京元電|2奈米|先進封裝|半導體)/i.test(text)) {
      topicTags.add("taiwan_semis");
    }
    if (/(欣興|南電|金像電|PCB|載板)/i.test(text)) {
      topicTags.add("taiwan_pcb");
    }
    if (/(ETF|高股息|主動式ETF|0050|006208|00940|00919|00878|基金|殖利率|配息)/i.test(text)) {
      topicTags.add("taiwan_etf_flows");
    }
    if (/(證交所|櫃買中心|金管會|MOPS|重大訊息|掛牌上市|融資融券|公開資訊觀測站)/i.test(text)) {
      topicTags.add("taiwan_policy");
    }
    if (/(資料中心|data center|機房|雲端|CSP)/i.test(text)) {
      topicTags.add("taiwan_data_center");
    }
    if (isSupplyChainStory) {
      topicTags.add("taiwan_ai_supply_chain");
    }
    if (isAdministrativeFundNotice) {
      topicTags.add("taiwan_admin_notice");
      score -= 18;
      signals.add("penalty:taiwan_admin_notice");
    }

    if (TAIWAN_LOCAL_HARD_SOURCE_SET.has(item.source)) {
      score += 12;
      signals.add("taiwan_hard_source_fit");
    } else if (TAIWAN_LOCAL_STORY_SOURCE_SET.has(item.source)) {
      score += 6;
      signals.add("taiwan_story_source_fit");
    } else if (TAIWAN_EN_MARKET_CORE_SOURCE_SET.has(item.source)) {
      score += isSupplyChainStory ? 10 : 8;
      signals.add(
        isSupplyChainStory
          ? "taiwan_en_market_supply_chain_fit"
          : "taiwan_en_market_core_fit",
      );
    } else if (TAIWAN_EN_MARKET_CONTEXT_SOURCE_SET.has(item.source)) {
      score += isSupplyChainStory ? 8 : 4;
      signals.add(
        isSupplyChainStory
          ? "taiwan_en_context_supply_chain_fit"
          : "taiwan_en_market_context_fit",
      );
    } else if (TAIWAN_EN_SUPPLY_CHAIN_SOURCE_SET.has(item.source)) {
      score += isSupplyChainStory ? 14 : 1;
      signals.add(
        isSupplyChainStory
          ? "taiwan_en_supply_chain_fit"
          : "taiwan_en_supply_chain_background",
      );
    } else if (TAIWAN_INDUSTRY_CONTEXT_SOURCE_SET.has(item.source)) {
      score += isSupplyChainStory ? 12 : 3;
      signals.add(
        isSupplyChainStory
          ? "taiwan_industry_supply_chain_fit"
          : "taiwan_industry_context_fit",
      );
    }

    if (
      (TAIWAN_INDUSTRY_CONTEXT_SOURCE_SET.has(item.source) ||
        TAIWAN_EN_SUPPLY_CHAIN_SOURCE_SET.has(item.source)) &&
      !isSupplyChainStory
    ) {
      score -= 6;
      signals.add("penalty:taiwan_context_not_localized");
    }
  }

  if (
    item.sourceType === "official" &&
    !topicTags.has("macro_data") &&
    !topicTags.has("earnings") &&
    !topicTags.has("fund_flows") &&
    !topicTags.has("price_action") &&
    !Array.from(topicEntities).some((entity) =>
      ["fed", "cpi", "jobs", "gdp", "sp500", "nasdaq", "strategy", "bitcoin", "ethereum", "etf"].includes(entity),
    )
  ) {
    score -= 22;
    signals.add("penalty:official_low_signal");
  }

  if (
    item.category === "us_stocks_macro" &&
    item.source === "Bank of England News" &&
    !topicTags.has("index_move") &&
    !topicTags.has("earnings") &&
    !/federal reserve|fed|s&p 500|nasdaq|dow jones/i.test(text)
  ) {
    score -= 28;
    signals.add("penalty:non_us_macro_backdrop");
  }

  if (
    item.category === "us_stocks_macro" &&
    item.source === "Yahoo Finance" &&
    /\b(can't ignore|you should buy|buy now|just delivered|good stock to buy now)\b/i.test(text)
  ) {
    score -= 18;
    signals.add("penalty:clickbait_yahoo");
  }

  return {
    score: Math.max(0, score),
    signals: Array.from(signals),
    topicTags: Array.from(topicTags),
    topicEntities: Array.from(topicEntities),
  };
}

export function buildTopicKey(title: string, entities: string[]): string {
  if (entities.length > 0) {
    return entities.sort().join("|");
  }

  const tokens = tokenize(title).slice(0, 5);
  return tokens.join("|");
}

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 || /[\u4e00-\u9fff]/.test(token))
    .filter((token) => !STOPWORDS.has(token));
}

export function enrichWithEditorialSignals(
  item: FeedItem,
  topics: EditorialTopic[],
): FeedItem {
  const base = scoreBaseEditorial(item);
  const itemTopicKey = buildTopicKey(item.title, base.topicEntities);
  const itemTokens = new Set(tokenize(`${item.title} ${item.description}`));

  let matchedTopic: EditorialTopic | null = null;
  let bestScore = 0;
  for (const topic of topics) {
    let score = 0;
    const hasEntityOverlap =
      topic.topicEntities.filter((entity) => base.topicEntities.includes(entity)).length > 0;
    const hasTagOverlap =
      topic.topicTags.filter((tag) => base.topicTags.includes(tag)).length > 0;

    if (topic.topicKey === itemTopicKey) {
      score += 8;
    }

    const entityOverlap = topic.topicEntities.filter((entity) =>
      base.topicEntities.includes(entity),
    ).length;
    score += entityOverlap * 4;

    const tagOverlap = topic.topicTags.filter((tag) =>
      base.topicTags.includes(tag),
    ).length;
    score += tagOverlap * 2;

    const topicTokens = new Set(tokenize(topic.title));
    let tokenOverlap = 0;
    for (const token of topicTokens) {
      if (itemTokens.has(token)) {
        tokenOverlap += 1;
      }
    }
    score += tokenOverlap;

    if (!hasEntityOverlap && !hasTagOverlap && tokenOverlap < 3) {
      score = 0;
    }

    if (Array.from(base.signals).some((signal) => signal.startsWith("penalty:")) && !hasEntityOverlap) {
      score -= 6;
    }

    if (score > bestScore) {
      bestScore = score;
      matchedTopic = topic;
    }
  }

  let editorialScore = base.score;
  const editorialSignals = [...base.signals];
  let crossSourceCount = 0;
  let socialProof = 0;
  const topicTags = [...base.topicTags];
  const topicEntities = [...base.topicEntities];

  if (matchedTopic && bestScore >= 7) {
    const signalBoost = Math.min(
      28,
      matchedTopic.sourceCount * 8 + Math.min(12, Math.round(Math.log10(Math.max(matchedTopic.totalEngagement, 1)) * 4)),
    );
    editorialScore += signalBoost;
    editorialSignals.push("signal_topic_match");
    editorialSignals.push(`cross_source:${matchedTopic.sourceCount}`);
    crossSourceCount = matchedTopic.sourceCount;
    socialProof = matchedTopic.totalEngagement;

    for (const tag of matchedTopic.topicTags) {
      if (!topicTags.includes(tag)) {
        topicTags.push(tag);
      }
    }
    for (const entity of matchedTopic.topicEntities) {
      if (!topicEntities.includes(entity)) {
        topicEntities.push(entity);
      }
    }
  }

  const eventType = deriveEventType(topicTags, editorialSignals);
  const majorEntity = deriveMajorEntity(topicEntities);
  const marketTheme = deriveMarketTheme(item.category, topicTags, majorEntity, eventType);
  const clusterKey = buildClusterKey(item.category, eventType, majorEntity, marketTheme, topicTags);
  const sourceQualityScore = scoreSourceQuality(item, base.topicTags, base.topicEntities);
  const corroborationScore = scoreCorroboration(
    matchedTopic,
    bestScore,
    sourceQualityScore,
    topicTags,
    topicEntities,
  );
  const marketReactionScore = scoreMarketReaction(item, topicTags, editorialSignals, majorEntity);

  return {
    ...item,
    sourceQualityScore,
    corroborationScore,
    marketReactionScore,
    editorialScore: Math.max(0, editorialScore),
    editorialSignals,
    topicTags,
    topicEntities,
    crossSourceCount,
    socialProof,
    eventType,
    majorEntity,
    marketTheme,
    clusterKey,
  };
}

function scoreSourceQuality(
  item: FeedItem,
  topicTags: string[],
  topicEntities: string[],
): number {
  let score = 0;

  if (item.sourceType === "official") {
    score += 100;
  } else if (item.sourceType === "research") {
    score += 75;
  } else {
    score += item.sourcePriority >= 80 ? 80 : item.sourcePriority >= 60 ? 70 : 60;
  }

  if (
    item.sourceType === "official" ||
    topicTags.includes("earnings") ||
    topicTags.includes("macro_data") ||
    topicTags.includes("policy") ||
    topicTags.includes("fund_flows")
  ) {
    score += 10;
  }

  const numberMatches =
    item.title.match(/\$?\d[\d,.]*%?/g)?.length ?? 0;
  if (numberMatches >= 2) {
    score += 10;
  } else if (numberMatches === 1) {
    score += 5;
  }

  const rawText = `${item.title} ${item.rawDescription || item.description}`;
  if (/[“”"'`]/u.test(rawText) || /\b(said|says|according to|told)\b/i.test(rawText)) {
    score += 10;
  }

  if (
    topicEntities.some((entity) =>
      ["fed", "cpi", "jobs", "gdp", "strategy", "stablecoin", "bitcoin", "ethereum", "etf"].includes(entity),
    )
  ) {
    score += 5;
  }

  if (item.category === "taiwan_stocks") {
    const isSupplyChainStory = isTaiwanSupplyChainStory(
      `${item.title} ${item.description}`,
      topicEntities,
      topicTags,
    );

    if (TAIWAN_LOCAL_HARD_SOURCE_SET.has(item.source)) {
      score += 10;
    } else if (TAIWAN_LOCAL_STORY_SOURCE_SET.has(item.source)) {
      score += 4;
    } else if (TAIWAN_EN_MARKET_CORE_SOURCE_SET.has(item.source)) {
      score += isSupplyChainStory ? 8 : 6;
    } else if (TAIWAN_EN_MARKET_CONTEXT_SOURCE_SET.has(item.source)) {
      score += isSupplyChainStory ? 6 : 2;
    } else if (TAIWAN_EN_SUPPLY_CHAIN_SOURCE_SET.has(item.source)) {
      score += isSupplyChainStory ? 8 : -4;
    } else if (TAIWAN_INDUSTRY_CONTEXT_SOURCE_SET.has(item.source)) {
      score += isSupplyChainStory ? 6 : -6;
    }
  }

  return Math.min(100, Math.max(0, score));
}

function scoreCorroboration(
  matchedTopic: EditorialTopic | null,
  bestScore: number,
  sourceQualityScore: number,
  topicTags: string[],
  topicEntities: string[],
): number {
  let score = 0;

  if (matchedTopic && bestScore >= 7) {
    score += Math.min(45, matchedTopic.sourceCount * 12);

    const typeCount = new Set([
      matchedTopic.topicTags.includes("policy") ? "official" : null,
      matchedTopic.topicTags.includes("fund_flows") ? "flows" : null,
      matchedTopic.topicTags.includes("price_action") ? "market" : null,
    ].filter(Boolean)).size;
    score += typeCount * 8;

    if (
      matchedTopic.topicEntities.some((entity) =>
        ["stablecoin", "strategy", "bitcoin", "ethereum", "sp500", "nasdaq", "fed"].includes(entity),
      )
    ) {
      score += 10;
    }
  }

  if (topicTags.includes("policy") && topicTags.includes("fund_flows")) {
    score += 12;
  }

  if (
    topicEntities.some((entity) => ["sp500", "nasdaq", "fed", "stablecoin", "strategy"].includes(entity)) &&
    topicTags.some((tag) => ["index_move", "fund_flows", "policy"].includes(tag))
  ) {
    score += 8;
  }

  if (sourceQualityScore >= 90) {
    score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

function scoreMarketReaction(
  item: FeedItem,
  topicTags: string[],
  editorialSignals: string[],
  majorEntity: string | null,
): number {
  let score = 0;
  const text = `${item.title} ${item.description}`;
  const isAdministrativeFundNotice =
    item.category === "taiwan_stocks" && isTaiwanAdministrativeFundNotice(text);

  if (topicTags.includes("price_action")) {
    score += 25;
  }
  if (topicTags.includes("index_move")) {
    score += 20;
  }
  if (topicTags.includes("fund_flows")) {
    score += 18;
  }
  if (editorialSignals.includes("explicit_market_reaction")) {
    score += 20;
  }
  if (editorialSignals.includes("headline_market_reaction")) {
    score += 15;
  }
  if (editorialSignals.includes("mega_cap_price_reaction")) {
    score += 15;
  }
  if (editorialSignals.includes("record_high_major_index")) {
    score += 15;
  }
  if (/\b([1-9]\d?%|percent)\b/i.test(text)) {
    score += 10;
  }
  if (
    majorEntity &&
    ["apple", "alphabet", "microsoft", "amazon", "meta", "nvidia", "intel", "amd", "strategy", "bitcoin", "ethereum", "sp500", "nasdaq"].includes(majorEntity)
  ) {
    score += 10;
  }

  if (isAdministrativeFundNotice) {
    score -= 22;
  }

  return Math.min(100, Math.max(0, score));
}

export function sortItemsForWeekly(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => {
    if (b.editorialScore !== a.editorialScore) {
      return b.editorialScore - a.editorialScore;
    }
    if (b.crossSourceCount !== a.crossSourceCount) {
      return b.crossSourceCount - a.crossSourceCount;
    }
    if (b.socialProof !== a.socialProof) {
      return b.socialProof - a.socialProof;
    }
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

export function clusterEditorialSignals(
  signals: EditorialSignalItem[],
): EditorialTopic[] {
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
    if (!existing.sources.includes(signal.source)) {
      existing.sources.push(signal.source);
    }
    existing.totalEngagement += signal.engagement;
    for (const tag of signal.topicTags) {
      if (!existing.topicTags.includes(tag)) {
        existing.topicTags.push(tag);
      }
    }
    for (const entity of signal.topicEntities) {
      if (!existing.topicEntities.includes(entity)) {
        existing.topicEntities.push(entity);
      }
    }
    existing.signalScore = computeSignalScore(
      Math.max(signal.priority, existing.signalScore),
      existing.totalEngagement,
      existing.sourceCount,
    );
    existing.updatedAt = new Date().toISOString();
  }

  return Array.from(topics.values()).sort((a, b) => b.signalScore - a.signalScore);
}

function computeSignalScore(priority: number, engagement: number, sourceCount: number): number {
  const engagementScore = Math.min(14, Math.round(Math.log10(Math.max(engagement, 1)) * 4));
  return Math.round(priority / 5) + sourceCount * 10 + engagementScore;
}

export function categoryForSignal(title: string, content: string): Category {
  const text = `${title} ${content}`.toLowerCase();
  if (/\b(bitcoin|btc|ethereum|eth|crypto|etf|sec|cftc|stablecoin)\b/.test(text)) {
    return "crypto";
  }
  if (/\b(openai|gemini|deepmind|llm|model|ai|gpu|tpu)\b/.test(text)) {
    return "ai";
  }
  return "us_stocks_macro";
}

export function buildTopicClusters(items: FeedItem[]): TopicCluster[] {
  const clusters = new Map<string, TopicCluster>();

  for (const item of items) {
    if (!item.clusterKey) {
      continue;
    }

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
    existing.averageEditorialScore = Math.round(
      (existing.totalEditorialScore / existing.itemCount) * 10,
    ) / 10;
    if (existing.topItemIds.length < 3) {
      existing.topItemIds.push(item.id);
      existing.topItemTitles.push(item.title);
    }
    for (const tag of item.topicTags) {
      if (!existing.topicTags.includes(tag)) {
        existing.topicTags.push(tag);
      }
    }
    for (const entity of item.topicEntities) {
      if (!existing.topicEntities.includes(entity)) {
        existing.topicEntities.push(entity);
      }
    }
  }

  return Array.from(clusters.values())
    .filter((cluster) => {
      if (cluster.clusterKey.endsWith("|general")) {
        return cluster.averageEditorialScore >= 85 && cluster.itemCount >= 2;
      }
      return cluster.totalEditorialScore >= 90 || cluster.itemCount >= 2;
    })
    .sort((a, b) => {
      const aThemed = a.marketTheme ? 1 : 0;
      const bThemed = b.marketTheme ? 1 : 0;
      if (bThemed !== aThemed) {
        return bThemed - aThemed;
      }
      if (b.totalEditorialScore !== a.totalEditorialScore) {
        return b.totalEditorialScore - a.totalEditorialScore;
      }
      if (b.sourceCount !== a.sourceCount) {
        return b.sourceCount - a.sourceCount;
      }
      return b.itemCount - a.itemCount;
    })
    .slice(0, 12);
}

export function buildNarrativeBundles(clusters: TopicCluster[]): NarrativeBundle[] {
  const filtered = clusters
    .filter((cluster) =>
      cluster.category === "taiwan_stocks"
        ? cluster.totalEditorialScore >= 70
        : cluster.totalEditorialScore >= 100,
    )
    .sort((a, b) => b.totalEditorialScore - a.totalEditorialScore);
  const visited = new Set<string>();
  const bundles: NarrativeBundle[] = [];

  for (const cluster of filtered) {
    if (visited.has(cluster.clusterKey)) {
      continue;
    }

    const related = filtered
      .filter((candidate) =>
        candidate.clusterKey !== cluster.clusterKey &&
        !visited.has(candidate.clusterKey) &&
        canJoinBundle(cluster, candidate),
      )
      .map((candidate) => ({
        cluster: candidate,
        score: scoreClusterRelation(cluster, candidate),
      }))
      .filter((entry) => entry.score >= 5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((entry) => entry.cluster);

    const component = [cluster, ...related];

    if (component.length < 2 && !canFormStandaloneBundle(cluster)) {
      continue;
    }

    visited.add(cluster.clusterKey);
    for (const relatedCluster of related) {
      visited.add(relatedCluster.clusterKey);
    }

    bundles.push(buildNarrativeBundle(component));
  }

  return bundles
    .sort((a, b) => {
      if (b.crossCategory !== a.crossCategory) {
        return Number(b.crossCategory) - Number(a.crossCategory);
      }
      if (b.totalEditorialScore !== a.totalEditorialScore) {
        return b.totalEditorialScore - a.totalEditorialScore;
      }
      return b.sourceCount - a.sourceCount;
    })
    .slice(0, 8);
}

function deriveEventType(topicTags: string[], signals: string[]): string | null {
  if (signals.includes("mega_cap_earnings") || topicTags.includes("earnings")) {
    return "earnings";
  }
  if (signals.includes("strategy_priority") || topicTags.includes("fund_flows")) {
    return "fund_flows";
  }
  if (signals.includes("record_high_major_index") || topicTags.includes("index_move")) {
    return "index_move";
  }
  if (signals.includes("ai_capex_mainline") || topicTags.includes("ai_infra")) {
    return "capex";
  }
  if (topicTags.includes("policy")) {
    return "policy";
  }
  if (topicTags.includes("macro_data")) {
    return "macro_data";
  }
  if (topicTags.includes("price_action")) {
    return "price_action";
  }
  return null;
}

function scoreClusterRelation(a: TopicCluster, b: TopicCluster): number {
  let score = 0;

  const sharedEntities = intersectCount(a.topicEntities, b.topicEntities);
  const sharedTags = intersectCount(a.topicTags, b.topicTags);
  score += sharedEntities * 3;
  score += sharedTags * 2;

  if (a.marketTheme && b.marketTheme && a.marketTheme === b.marketTheme) {
    score += 3;
  }
  if (a.eventType && b.eventType && a.eventType === b.eventType) {
    score += 2;
  }
  if (a.category === b.category) {
    score += 1;
  }

  const tokenOverlap = intersectCount(tokenize(a.title), tokenize(b.title));
  if (tokenOverlap >= 2) {
    score += 2;
  }

  if (isBigTechAiBridge(a, b)) {
    score += 4;
  }

  if (isCryptoMacroBridge(a, b)) {
    score += 4;
  }

  if (isCryptoAiBridge(a, b)) {
    score += 3;
  }

  if (isTaiwanStoryBridge(a, b)) {
    score += 4;
  }

  return score;
}

function buildNarrativeBundle(component: TopicCluster[]): NarrativeBundle {
  const ranked = component
    .slice()
    .sort((a, b) => b.totalEditorialScore - a.totalEditorialScore);
  const anchor = ranked[0];
  const partitioned = partitionBundleClusters(anchor, ranked);
  const coreClusters = partitioned.core;
  const relatedClusters = partitioned.related;
  const categories = unique(component.map((cluster) => cluster.category));
  const marketThemes = unique(
    component.map((cluster) => cluster.marketTheme).filter(Boolean) as string[],
  );
  const eventTypes = unique(
    component.map((cluster) => cluster.eventType).filter(Boolean) as string[],
  );
  const entities = unique(component.flatMap((cluster) => cluster.topicEntities));
  const topicTags = unique(component.flatMap((cluster) => cluster.topicTags));
  const clusterKeys = ranked.map((cluster) => cluster.clusterKey);
  const coreClusterKeys = coreClusters.map((cluster) => cluster.clusterKey);
  const relatedClusterKeys = relatedClusters.map((cluster) => cluster.clusterKey);
  const coreTopTitles = coreClusters.flatMap((cluster) => cluster.topItemTitles).slice(0, 4);
  const relatedTopTitles = relatedClusters.flatMap((cluster) => cluster.topItemTitles).slice(0, 4);
  const topTitles = [...coreTopTitles, ...relatedTopTitles].slice(0, 6);
  const totalEditorialScore = component.reduce(
    (sum, cluster) => sum + cluster.totalEditorialScore,
    0,
  );
  const itemCount = component.reduce((sum, cluster) => sum + cluster.itemCount, 0);
  const sourceCount = unique(component.flatMap((cluster) => cluster.sources)).length;
  const bundleKind = deriveBundleKind(component, categories, marketThemes, entities, topicTags);

  return {
    bundleKey: bundleKind.key,
    title: bundleKind.title,
    summary: bundleKind.summary,
    angle: bundleKind.angle,
    whyGrouped: buildWhyGrouped(anchor, coreClusters, relatedClusters),
    categories,
    coreClusterKeys,
    relatedClusterKeys,
    clusterKeys,
    marketThemes,
    eventTypes,
    entities,
    itemCount,
    sourceCount,
    totalEditorialScore,
    crossCategory: categories.length > 1,
    coreTopTitles,
    relatedTopTitles,
    topTitles,
  };
}

function deriveBundleKind(
  component: TopicCluster[],
  categories: Category[],
  marketThemes: string[],
  entities: string[],
  topicTags: string[],
): { key: string; title: string; summary: string; angle: string } {
  const has = (value: string) => marketThemes.includes(value) || entities.includes(value);

  if (
    marketThemes.includes("big_tech_earnings") &&
    (marketThemes.includes("major_index_move") || entities.some((entity) =>
      ["apple", "microsoft", "alphabet", "amazon", "meta", "nvidia", "intel", "amd", "nokia"].includes(entity),
    ))
  ) {
    return {
      key: "big-tech-earnings-repricing",
      title: "Big Tech 財報與股價重定價包",
      summary: "把大型科技股財報、指數反應、贏家輸家分化放在一起，才能看出市場本週真正獎勵的是誰。",
      angle: "先講財報結果，再講股價與指數怎麼重排順序，最後講哪些公司成了本週的相對贏家與輸家。",
    };
  }

  if (categories.length === 1 && categories[0] === "taiwan_stocks") {
    const aiClusters = component.filter((cluster) =>
      cluster.topicTags.includes("taiwan_ai_supply_chain") ||
      cluster.topicTags.includes("taiwan_data_center") ||
      (cluster.topicTags.includes("taiwan_semis") && cluster.topicTags.includes("ai_infra")),
    );
    const etfClusters = component.filter((cluster) => cluster.topicTags.includes("taiwan_etf_flows"));
    const policyClusters = component.filter((cluster) => cluster.topicTags.includes("taiwan_policy"));
    const aiScore = aiClusters.reduce((sum, cluster) => sum + cluster.totalEditorialScore, 0);
    const etfScore = etfClusters.reduce((sum, cluster) => sum + cluster.totalEditorialScore, 0);

    if (
      aiClusters.length >= 2 ||
      (aiClusters.length >= 1 && aiScore >= etfScore + 40)
    ) {
      return {
        key: "taiwan-ai-supply-chain",
        title: "台股 AI 供應鏈與資料中心受惠包",
        summary: "把台廠 AI 供應鏈、半導體、資料中心與受惠鏈條放在一起，才能看出台股本週真正被市場重估的是哪些公司。",
        angle: "先講受惠鏈條，再講哪些公司被點名，最後補上背後的算力、資料中心與資本支出主線。",
      };
    }

    if (etfClusters.length >= 1) {
      return {
        key: "taiwan-etf-flows",
        title: "台股 ETF 與資金輪動包",
        summary: "把 ETF、配息、高股息與資金輪動題放在一起，才能看出台股資金本週實際往哪裡集中。",
        angle: "先講資金往哪流，再講哪些產品和族群最受惠。",
      };
    }

    if (policyClusters.length >= 1) {
      return {
        key: "taiwan-policy-disclosure",
        title: "台股政策與公告主線包",
        summary: "把證交所、櫃買中心、重大訊息與制度更新放在一起，才能看出台股本週的正式揭露主線。",
        angle: "先講制度或公告，再補上可能影響的公司與產業。",
      };
    }
  }

  if (
    marketThemes.includes("big_tech_earnings") &&
    (marketThemes.includes("ai_capex") || marketThemes.includes("ai_chip_reaction"))
  ) {
    return {
      key: "big-tech-earnings-ai-spend",
      title: "Big Tech 財報與 AI 投資驗證包",
      summary: "把大型科技股財報、AI capex、晶片反應放在一起看，會更容易看出市場到底在獎勵成長、還是在懲罰支出。",
      angle: "先講誰交出財報，再講市場怎麼用 AI 基建與晶片股反應來重新定價。",
    };
  }

  if (
    marketThemes.includes("major_index_move") &&
    (marketThemes.includes("big_tech_earnings") || marketThemes.includes("macro_policy"))
  ) {
    return {
      key: "index-move-macro-earnings",
      title: "指數創高與財報/總經共振包",
      summary: "這組適合回答為什麼指數在這週創高或轉向，是財報帶動、總經鬆動，還是兩者一起發生。",
      angle: "把指數表現當結果，再往回拆是財報、利率還是通膨訊號在推動。",
    };
  }

  if (
    marketThemes.includes("strategy_treasury") ||
    marketThemes.includes("crypto_etf_flows") ||
    marketThemes.includes("crypto_regulation")
  ) {
    return {
      key: "crypto-flows-structure",
      title: "Crypto 資金流與制度結構包",
      summary: "把 ETF 流向、Strategy、穩定幣、監管放在一起，比單看幣價更容易理解本週 crypto 的真正驅動力。",
      angle: "先講錢往哪裡流，再講制度怎麼改變資金路徑，最後補市場情緒與價格。",
    };
  }

  if (
    categories.includes("crypto") &&
    (has("sp500") || has("nasdaq") || has("fed") || has("cpi"))
  ) {
    return {
      key: "crypto-macro-linkage",
      title: "Crypto 與美股總經連動包",
      summary: "這組能把 BTC/ETH、ETF、風險資產、Fed 或通膨訊號串起來，說清楚 crypto 為什麼不是只受幣圈自己影響。",
      angle: "用美股和總經做背景，再解釋 crypto 這週的資金和價格為什麼會跟著動。",
    };
  }

  if (marketThemes.includes("ai_capex") || marketThemes.includes("ai_chip_reaction")) {
    return {
      key: "ai-infra-demand",
      title: "AI 基建與晶片需求包",
      summary: "把算力、資料中心、晶片和企業支出訊號包在一起，更容易看出 AI 故事是在擴張還是分化。",
      angle: "先看支出與基建，再看誰是受益者，最後補市場怎麼重新排序贏家輸家。",
    };
  }

  const anchor = component
    .slice()
    .sort((a, b) => b.totalEditorialScore - a.totalEditorialScore)[0];
  return {
    key: `related-${anchor.clusterKey}`,
    title: `相關主題包：${anchor.title}`,
    summary: "這些新聞彼此共用同一批公司、資金或政策訊號，合起來看會比單篇閱讀更接近市場真實主線。",
    angle: "先用最高分主題當主軸，再把相近訊號一併帶進來解釋因果關係。",
  };
}

function partitionBundleClusters(
  anchor: TopicCluster,
  ranked: TopicCluster[],
): { core: TopicCluster[]; related: TopicCluster[] } {
  const core: TopicCluster[] = [anchor];
  const related: TopicCluster[] = [];

  for (const cluster of ranked.slice(1)) {
    const relationToAnchor = scoreClusterRelation(anchor, cluster);
    const sharedEntities = intersectCount(anchor.topicEntities, cluster.topicEntities);
    const sharedThemes =
      anchor.marketTheme && cluster.marketTheme && anchor.marketTheme === cluster.marketTheme;
    const sharedEvents =
      anchor.eventType && cluster.eventType && anchor.eventType === cluster.eventType;

    if (sharedEntities >= 1 || sharedThemes || sharedEvents || relationToAnchor >= 8) {
      if (core.length < 3) {
        core.push(cluster);
        continue;
      }
    }

    related.push(cluster);
  }

  return { core, related };
}

function canJoinBundle(anchor: TopicCluster, candidate: TopicCluster): boolean {
  if (anchor.category === "taiwan_stocks" && candidate.category === "taiwan_stocks") {
    const anchorIsAi =
      anchor.topicTags.includes("taiwan_ai_supply_chain") ||
      anchor.topicTags.includes("taiwan_data_center") ||
      (anchor.topicTags.includes("taiwan_semis") && anchor.topicTags.includes("ai_infra"));
    const candidateIsAi =
      candidate.topicTags.includes("taiwan_ai_supply_chain") ||
      candidate.topicTags.includes("taiwan_data_center") ||
      (candidate.topicTags.includes("taiwan_semis") && candidate.topicTags.includes("ai_infra"));
    const anchorIsEtf = anchor.topicTags.includes("taiwan_etf_flows");
    const candidateIsEtf = candidate.topicTags.includes("taiwan_etf_flows");
    const anchorIsPolicy =
      anchor.topicTags.includes("taiwan_policy") || anchor.topicTags.includes("taiwan_admin_notice");
    const candidateIsPolicy =
      candidate.topicTags.includes("taiwan_policy") || candidate.topicTags.includes("taiwan_admin_notice");

    if ((anchorIsAi && candidateIsEtf) || (anchorIsEtf && candidateIsAi)) {
      return false;
    }

    if (
      (anchorIsAi && candidateIsPolicy && !candidateIsAi) ||
      (candidateIsAi && anchorIsPolicy && !anchorIsAi)
    ) {
      return false;
    }
  }

  if (anchor.category === "crypto" && candidate.marketTheme === "big_tech_earnings") {
    return false;
  }

  if (
    anchor.category === "crypto" &&
    candidate.category === "us_stocks_macro" &&
    candidate.marketTheme === "major_index_move" &&
    !anchor.topicEntities.some((entity) => ["sp500", "nasdaq", "fed", "cpi"].includes(entity))
  ) {
    return false;
  }

  if (
    anchor.category === "us_stocks_macro" &&
    anchor.marketTheme === "big_tech_earnings" &&
    candidate.category === "crypto" &&
    !candidate.topicEntities.some((entity) => ["sp500", "nasdaq"].includes(entity))
  ) {
    return false;
  }

  return true;
}

function buildWhyGrouped(
  anchor: TopicCluster,
  coreClusters: TopicCluster[],
  relatedClusters: TopicCluster[],
): string {
  const entityHint = anchor.topicEntities.slice(0, 3).map(labelForEntity).join(" / ");
  const themeHint = unique(
    coreClusters
      .map((cluster) => cluster.marketTheme)
      .filter(Boolean) as string[],
  ).join(", ");

  if (relatedClusters.length === 0) {
    return `主包內的 cluster 共享相同的事件類型或核心實體，主線集中在 ${entityHint || anchor.title}。`;
  }

  return `主包聚焦 ${entityHint || anchor.title}${themeHint ? `，共同主題是 ${themeHint}` : ""}；關聯包則補充能解釋價格、資金或制度影響的旁支訊號。`;
}

function isBigTechAiBridge(a: TopicCluster, b: TopicCluster): boolean {
  const pair = new Set([a.category, b.category]);
  if (!(pair.has("us_stocks_macro") && pair.has("ai"))) {
    return false;
  }

  const themes = [a.marketTheme, b.marketTheme];
  return themes.includes("big_tech_earnings") &&
    (themes.includes("ai_capex") || themes.includes("ai_chip_reaction"));
}

function isCryptoMacroBridge(a: TopicCluster, b: TopicCluster): boolean {
  const pair = new Set([a.category, b.category]);
  if (!(pair.has("crypto") && pair.has("us_stocks_macro"))) {
    return false;
  }

  const cryptoCluster = a.category === "crypto" ? a : b;
  const macroCluster = a.category === "us_stocks_macro" ? a : b;
  const entities = new Set([...a.topicEntities, ...b.topicEntities]);

  const cryptoIsActuallyMacroLinked =
    cryptoCluster.marketTheme === "price_reaction" ||
    cryptoCluster.eventType === "index_move" ||
    ["sp500", "nasdaq", "fed", "cpi"].some((entity) => cryptoCluster.topicEntities.includes(entity));

  const macroIsMarketDriver =
    ["major_index_move", "macro_policy", "big_tech_earnings"].includes(macroCluster.marketTheme ?? "") ||
    ["index_move", "earnings", "macro_data"].includes(macroCluster.eventType ?? "");

  return cryptoIsActuallyMacroLinked &&
    macroIsMarketDriver &&
    ["sp500", "nasdaq", "fed", "cpi", "bitcoin", "etf"].some((entity) => entities.has(entity));
}

function isCryptoAiBridge(a: TopicCluster, b: TopicCluster): boolean {
  const pair = new Set([a.category, b.category]);
  if (!(pair.has("crypto") && pair.has("ai"))) {
    return false;
  }

  const entities = new Set([...a.topicEntities, ...b.topicEntities]);
  const themes = [a.marketTheme, b.marketTheme];
  return (
    themes.includes("ai_capex") ||
    themes.includes("ai_chip_reaction")
  ) && ["nvidia", "amd", "intel", "bitcoin"].some((entity) => entities.has(entity));
}

function isTaiwanStoryBridge(a: TopicCluster, b: TopicCluster): boolean {
  if (!(a.category === "taiwan_stocks" && b.category === "taiwan_stocks")) {
    return false;
  }

  const aIsAi =
    a.topicTags.includes("taiwan_ai_supply_chain") ||
    a.topicTags.includes("taiwan_data_center") ||
    (a.topicTags.includes("taiwan_semis") && a.topicTags.includes("ai_infra"));
  const bIsAi =
    b.topicTags.includes("taiwan_ai_supply_chain") ||
    b.topicTags.includes("taiwan_data_center") ||
    (b.topicTags.includes("taiwan_semis") && b.topicTags.includes("ai_infra"));
  const aIsEtf = a.topicTags.includes("taiwan_etf_flows");
  const bIsEtf = b.topicTags.includes("taiwan_etf_flows");
  const aIsPolicy =
    a.topicTags.includes("taiwan_policy") || a.topicTags.includes("taiwan_admin_notice");
  const bIsPolicy =
    b.topicTags.includes("taiwan_policy") || b.topicTags.includes("taiwan_admin_notice");

  if ((aIsAi && bIsEtf) || (aIsEtf && bIsAi)) {
    return false;
  }

  if ((aIsAi && bIsPolicy && !bIsAi) || (bIsAi && aIsPolicy && !aIsAi)) {
    return false;
  }

  const sharedTaiwanTags = intersectCount(
    a.topicTags.filter((tag) => tag.startsWith("taiwan_")),
    b.topicTags.filter((tag) => tag.startsWith("taiwan_")),
  );

  return sharedTaiwanTags >= 1 || intersectCount(a.topicEntities, b.topicEntities) >= 1;
}

function canFormStandaloneBundle(cluster: TopicCluster): boolean {
  if (cluster.category !== "taiwan_stocks") {
    return false;
  }

  if (cluster.topicTags.includes("taiwan_admin_notice")) {
    return false;
  }

  return (
    cluster.totalEditorialScore >= 90 &&
    cluster.topicTags.some((tag) =>
      ["taiwan_ai_supply_chain", "taiwan_semis", "taiwan_etf_flows", "taiwan_policy", "taiwan_data_center"].includes(tag),
    )
  );
}

function intersectCount(a: string[], b: string[]): number {
  const right = new Set(b);
  return new Set(a).size === 0 ? 0 : Array.from(new Set(a)).filter((value) => right.has(value)).length;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function deriveMajorEntity(topicEntities: string[]): string | null {
  const priority = [
    "alphabet",
    "microsoft",
    "amazon",
    "meta",
    "apple",
    "nvidia",
    "intel",
    "amd",
    "strategy",
    "coinbase",
    "robinhood",
    "tesla",
    "stablecoin",
    "sp500",
    "nasdaq",
    "dow",
    "fed",
    "cpi",
    "jobs",
    "gdp",
    "bitcoin",
    "ethereum",
    "etf",
  ];
  for (const entity of priority) {
    if (topicEntities.includes(entity)) {
      return entity;
    }
  }
  return topicEntities[0] ?? null;
}

function deriveMarketTheme(
  category: Category,
  topicTags: string[],
  majorEntity: string | null,
  eventType: string | null,
): string | null {
  if (category === "us_stocks_macro") {
    if (eventType === "earnings" && majorEntity) {
      return "big_tech_earnings";
    }
    if (eventType === "index_move" || ["sp500", "nasdaq", "dow"].includes(majorEntity ?? "")) {
      return "major_index_move";
    }
    if (eventType === "macro_data" || majorEntity === "fed" || majorEntity === "cpi") {
      return "macro_policy";
    }
  }

  if (category === "ai") {
    if (eventType === "capex") {
      return "ai_capex";
    }
    if (eventType === "earnings" && majorEntity) {
      return "ai_big_tech_earnings";
    }
    if (majorEntity && ["nvidia", "intel", "amd"].includes(majorEntity)) {
      return "ai_chip_reaction";
    }
  }

  if (category === "crypto") {
    if (majorEntity === "strategy") {
      return "strategy_treasury";
    }
    if (eventType === "fund_flows" || majorEntity === "etf") {
      return "crypto_etf_flows";
    }
    if (eventType === "policy") {
      return "crypto_regulation";
    }
  }

  if (topicTags.includes("price_action")) {
    return "price_reaction";
  }
  return null;
}

function buildClusterKey(
  category: Category,
  eventType: string | null,
  majorEntity: string | null,
  marketTheme: string | null,
  topicTags: string[],
): string {
  if (!marketTheme && !eventType && !majorEntity) {
    return "";
  }

  const fallbackTag = topicTags[0] ?? "general";
  return [
    category,
    marketTheme ?? "theme",
    eventType ?? "event",
    majorEntity ?? fallbackTag,
  ].join("|");
}

function clusterTitle(item: FeedItem): string {
  if (item.marketTheme === "big_tech_earnings" && item.majorEntity) {
    return `${labelForEntity(item.majorEntity)} earnings`;
  }
  if (item.marketTheme === "major_index_move" && item.majorEntity) {
    return `${labelForEntity(item.majorEntity)} market move`;
  }
  if (item.marketTheme === "ai_capex") {
    return "AI capex and infrastructure";
  }
  if (item.marketTheme === "strategy_treasury") {
    return "Strategy and institutional bitcoin treasury flows";
  }
  if (item.marketTheme === "crypto_etf_flows") {
    return "Crypto ETF and fund-flow update";
  }
  if (item.marketTheme === "crypto_regulation") {
    return "Crypto regulation and market structure";
  }
  if (item.marketTheme === "ai_chip_reaction" && item.majorEntity) {
    return `${labelForEntity(item.majorEntity)} AI chip reaction`;
  }
  if (item.marketTheme === "macro_policy" && item.majorEntity) {
    return `${labelForEntity(item.majorEntity)} macro update`;
  }
  return item.title;
}

function labelForEntity(entity: string): string {
  const map: Record<string, string> = {
    alphabet: "Alphabet",
    microsoft: "Microsoft",
    amazon: "Amazon",
    meta: "Meta",
    apple: "Apple",
    nvidia: "Nvidia",
    intel: "Intel",
    amd: "AMD",
    strategy: "Strategy",
    coinbase: "Coinbase",
    robinhood: "Robinhood",
    tesla: "Tesla",
    stablecoin: "Stablecoin",
    sp500: "S&P 500",
    nasdaq: "Nasdaq",
    dow: "Dow",
    fed: "Fed",
    cpi: "CPI",
    jobs: "Jobs",
    gdp: "GDP",
    bitcoin: "Bitcoin",
    ethereum: "Ethereum",
    etf: "ETF",
  };
  return map[entity] ?? entity;
}
