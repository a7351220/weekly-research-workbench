import { buildDailyUsPayload, type DailyUsPayload } from "./daily-us";
import type { Env, FeedItem } from "./types";
import { jsonResponse, normalizeUrl } from "./utils";

type Trend = "up" | "down" | "flat" | "na";
type TranslationMode = "openrouter" | "none";
type SessionRelevance = "same_session" | "after_close_grace" | "outside_session" | "unknown_date";

interface PosterTranslator {
  mode: TranslationMode;
  story(title: string, summary: string, fact: string): Promise<StoryRewrite>;
  headline(value: string): Promise<string>;
  summary(value: string): Promise<string>;
  fact(value: string): Promise<string>;
  calendarTitle(value: string): Promise<string>;
  calendarDate(value: string): Promise<string>;
}

interface StoryRewrite {
  title: string;
  summary: string;
}

interface PosterMetric {
  label: string;
  value: string;
  change: string;
  trend: Trend;
  history: number[];
}

interface PosterMegaCap {
  label: string;
  ticker: string;
  price: string;
  change: string;
  trend: Trend;
  history: number[];
}

interface PosterStory {
  title: string;
  summary: string;
  fact: string;
  source: string | null;
  url: string | null;
  publishedAt: string | null;
  publishedDateNy: string | null;
  sessionRelevance: SessionRelevance;
  originalTitle: string;
  originalSummary: string;
}

interface PosterCalendarEvent {
  date: string;
  label: string;
  title: string;
  kind: "macro" | "earnings";
}

interface StoryCandidate {
  title: string;
  summary: string;
  fact: string;
  source: string | null;
  url: string | null;
  publishedAt: string | null;
  publishedDateNy: string | null;
  sessionRelevance: SessionRelevance;
  themeKey: string;
  score: number;
}

interface PosterPayload {
  ok: true;
  type: "us_daily_poster_payload";
  formatVersion: "1.0";
  generatedAt: string;
  reportDate: string;
  sourcePayloadUrl: string;
  marketDataStatus: DailyUsPayload["marketDataStatus"];
  canRender: boolean;
  poster: {
    size: { width: 1080; height: 1350 };
    title: string;
    eyebrow: string;
    date: string;
    oneLine: string;
    indices: PosterMetric[];
    assets: PosterMetric[];
    megaCaps: PosterMegaCap[];
    stories: PosterStory[];
    stockNews: PosterStory[];
    watchlist: string[];
    calendar: PosterCalendarEvent[];
    calendarFull: PosterCalendarEvent[];
    footer: string[];
  };
  sourcePayload: DailyUsPayload;
  translation: {
    mode: TranslationMode;
    note: string;
  };
}

export async function handleDailyUsPoster(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const reportDate = resolvePosterReportDate(requestUrl);
  const translator = createPosterTranslator(resolveTranslationMode(requestUrl), env);
  if (!reportDate) {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid date",
        message: "date must use YYYY-MM-DD format.",
      },
      { status: 400 },
    );
  }

  const sourcePayload = await buildDailyUsPayload(requestUrl, env, reportDate, request);
  const posterPayload = await buildPosterPayload(sourcePayload, requestUrl, translator);
  const format = resolvePosterFormat(requestUrl);

  switch (format) {
    case "json":
      return jsonResponse(posterPayload);
    case "html":
      return textResponse(renderPosterHtml(posterPayload), "text/html; charset=utf-8");
    case "print":
      return textResponse(renderPrintHtml(posterPayload, requestUrl), "text/html; charset=utf-8");
    case "calendar":
      return textResponse(renderCalendarHtml(posterPayload), "text/html; charset=utf-8");
    case "svg":
      return textResponse(renderPosterSvg(posterPayload), "image/svg+xml; charset=utf-8");
    case "md":
      return textResponse(renderPosterMarkdown(posterPayload), "text/markdown; charset=utf-8");
    case "txt":
      return textResponse(renderPosterText(posterPayload), "text/plain; charset=utf-8");
  }
}

async function buildPosterPayload(sourcePayload: DailyUsPayload, requestUrl: URL, translator: PosterTranslator): Promise<PosterPayload> {
  const indices = ["spx", "ndx", "dji", "rut", "sox"].map((key) => metricFromQuote(findQuote(sourcePayload.marketSummary.indices, key)));
  const assets = ["vix", "us10y", "dxy", "wti", "gold", "btc"].map((key) => metricFromQuote(findQuote(sourcePayload.marketSummary.assets, key)));
  const megaCaps = ["aapl", "msft", "nvda", "amzn", "googl", "meta", "tsla"].map((key) => megaCapFromQuote(findQuote(sourcePayload.marketSummary.megaCaps, key)));
  const stories = await buildPosterStories(sourcePayload, translator);
  const stockNews = await buildPosterStockNews(sourcePayload, translator, stories);
  const watchlist = await Promise.all(sourcePayload.nextSessionWatchlist.slice(0, 3).map((item) => translator.headline(item.label || "N/A")));
  const calendarFull = await buildPosterCalendar(sourcePayload, translator, 12);
  const calendar = calendarFull.slice(0, 4);
  while (watchlist.length < 3) watchlist.push("N/A");

  const hasNa = [...indices, ...assets].some((item) => item.trend === "na") || megaCaps.some((item) => item.trend === "na");
  const sourcePayloadUrl = `${requestUrl.origin}/daily/us.json?date=${encodeURIComponent(sourcePayload.reportDate)}`;

  return {
    ok: true,
    type: "us_daily_poster_payload",
    formatVersion: "1.0",
    generatedAt: new Date().toISOString(),
    reportDate: sourcePayload.reportDate,
    sourcePayloadUrl,
    marketDataStatus: sourcePayload.marketDataStatus,
    canRender: sourcePayload.marketDataStatus.isFinal && sourcePayload.marketDataStatus.status === "final",
    poster: {
      size: { width: 1080, height: 1350 },
      title: "美股日報",
      eyebrow: "US MARKET CLOSE",
      date: sourcePayload.reportDate,
      oneLine: buildOneLine(sourcePayload),
      indices,
      assets,
      megaCaps,
      stories,
      stockNews,
      watchlist,
      calendar,
      calendarFull,
      footer: [
        "資料來源：市場收盤資料與公開新聞整理。",
        ...(hasNa ? ["部分項目因資料源限制顯示 N/A。"] : []),
        "請再次核對關鍵數字、日期與來源。",
      ],
    },
    sourcePayload,
    translation: {
      mode: translator.mode,
      note: translator.mode === "openrouter"
        ? "OpenRouter translation is used when OPENROUTER_API_KEY is available; originalTitle/originalSummary are preserved for verification."
        : "No translation is applied; source text is displayed as-is.",
    },
  };
}

async function buildPosterCalendar(payload: DailyUsPayload, translator: PosterTranslator, limit: number): Promise<PosterCalendarEvent[]> {
  const macroEvents: PosterCalendarEvent[] = await Promise.all(payload.macroCalendar.slice(0, 3).map(async (item) => ({
    date: `${item.dateLabel} ${item.timeLabel}`.trim(),
    label: "宏觀數據",
    title: formatMacroCalendarTitle(item.title) || await translator.calendarTitle(item.title),
    kind: "macro",
  })));
  const earningsEvents: PosterCalendarEvent[] = await Promise.all(payload.earningsRadar
    .filter((item) => /\b(pre-market earnings|after-hours earnings|earnings report for)\b/i.test(item.title))
    .slice(0, 3)
    .map(async (item) => ({
      date: await translator.calendarDate(item.title),
      label: /after-hours/i.test(item.title) ? "盤後財報" : "盤前財報",
      title: formatEarningsCalendarTitle(item.title) || await translator.headline(item.title),
      kind: "earnings",
    })));

  return [...macroEvents, ...earningsEvents].slice(0, limit);
}

function buildOneLine(payload: DailyUsPayload): string {
  const spx = findQuote(payload.marketSummary.indices, "spx");
  const ndx = findQuote(payload.marketSummary.indices, "ndx");
  if (spx?.changePct !== null && spx?.changePct !== undefined && ndx?.changePct !== null && ndx?.changePct !== undefined) {
    if (spx.changePct > 0 && ndx.changePct > spx.changePct) {
      return "科技股領漲，帶動主要指數收高。";
    }
    if (spx.changePct > 0) {
      return "主要指數收高，市場風險偏好回升。";
    }
    if (spx.changePct < 0) {
      return "主要指數收低，市場情緒轉向保守。";
    }
  }
  return payload.topBundles[0]?.summary || payload.topStories[0]?.title || "今日美股主線待確認。";
}

async function buildPosterStories(payload: DailyUsPayload, translator: PosterTranslator): Promise<PosterStory[]> {
  const candidateItems = filterItemsForPosterSession([
    ...payload.topStories,
    ...payload.topAiRadar,
    ...payload.earningsRadar,
  ], payload.reportDate);
  const candidates = buildItemStoryCandidates(candidateItems, payload.reportDate)
    .filter(isStrongNewsCandidate)
    .sort((a, b) => b.score - a.score);
  const stories: PosterStory[] = [];
  const usedThemes = new Set<string>();
  const usedTitles = new Set<string>();
  const usedStoryKinds = new Set<string>();
  for (const candidate of candidates) {
    await addStoryCandidate(candidate, stories, usedThemes, usedTitles, usedStoryKinds, translator, true, true);
    if (stories.length >= 3) break;
  }
  for (const candidate of candidates) {
    await addStoryCandidate(candidate, stories, usedThemes, usedTitles, usedStoryKinds, translator, false, false);
    if (stories.length >= 3) break;
  }

  while (stories.length < 3) {
    stories.push({
      title: "N/A",
      summary: "N/A",
      fact: "N/A",
      source: null,
      url: null,
      publishedAt: null,
      publishedDateNy: null,
      sessionRelevance: "unknown_date",
      originalTitle: "N/A",
      originalSummary: "N/A",
    });
  }
  return stories;
}

async function buildPosterStockNews(
  payload: DailyUsPayload,
  translator: PosterTranslator,
  excludedStories: PosterStory[] = [],
): Promise<PosterStory[]> {
  const sourceItems = filterItemsForPosterSession(
    [
      ...(payload.stockNews || []),
      ...payload.topStories,
      ...payload.topAiRadar,
      ...payload.earningsRadar,
    ],
    payload.reportDate,
  );
  const rankedCandidates = buildItemStoryCandidates(
    sourceItems,
    payload.reportDate,
  ).sort((a, b) => b.score - a.score);
  const strongCandidates = rankedCandidates.filter(isStrongStockNewsCandidate);
  const backupCandidates = rankedCandidates.filter((candidate) => !isLowValueStockNewsCandidate(candidate));
  const stories: PosterStory[] = [];
  const usedTitles = new Set<string>();
  const excludedUrls = new Set(excludedStories.map((story) => normalizeUrl(story.url || "")).filter(Boolean));
  const excludedTitles = new Set(excludedStories.map((story) => normalizeText(story.originalTitle || story.title)).filter(Boolean));

  for (const candidate of [...strongCandidates, ...backupCandidates]) {
    const normalizedTitle = normalizeText(candidate.title);
    const normalizedUrl = normalizeUrl(candidate.url || "");
    if (normalizedUrl && excludedUrls.has(normalizedUrl)) continue;
    if (normalizedTitle && excludedTitles.has(normalizedTitle)) continue;
    if (usedTitles.has(normalizedTitle)) continue;
    stories.push(await posterStoryFromCandidate(candidate, translator));
    usedTitles.add(normalizedTitle);
    if (stories.length >= 8) break;
  }

  return stories;
}

async function addStoryCandidate(
  candidate: StoryCandidate,
  stories: PosterStory[],
  usedThemes: Set<string>,
  usedTitles: Set<string>,
  usedStoryKinds: Set<string>,
  translator: PosterTranslator,
  enforceThemeUniqueness: boolean,
  enforceKindLimits: boolean,
): Promise<void> {
  if (stories.length >= 3) return;
  const normalizedTitle = normalizeText(candidate.title);
  if (usedTitles.has(normalizedTitle)) return;
  const storyGroup = storyGroupKey(candidate);
  if (enforceThemeUniqueness && usedThemes.has(storyGroup)) return;
  const storyKind = storyKindKey(candidate);
  if ((storyKind === "broad_market_recap" || storyKind === "macro_jobs") && usedStoryKinds.has(storyKind)) return;
  const titleSource = cleanText(candidate.title);
  const summarySource = buildPosterSummarySource(candidate);
  stories.push(await posterStoryFromCandidate(candidate, translator, titleSource, summarySource));
  usedThemes.add(storyGroup);
  usedTitles.add(normalizedTitle);
  usedStoryKinds.add(storyKind);
}

async function posterStoryFromCandidate(
  candidate: StoryCandidate,
  translator: PosterTranslator,
  titleSource = cleanText(candidate.title),
  summarySource = buildPosterSummarySource(candidate),
): Promise<PosterStory> {
  const fact = await translator.fact(candidate.fact);
  const story = await translator.story(titleSource, summarySource, fact);
  return {
    title: story.title,
    summary: story.summary,
    fact,
    source: normalizeDisplaySource(candidate.source),
    url: candidate.url,
    publishedAt: candidate.publishedAt,
    publishedDateNy: candidate.publishedDateNy,
    sessionRelevance: candidate.sessionRelevance,
    originalTitle: cleanText(candidate.title),
    originalSummary: cleanText(candidate.summary),
  };
}

function buildPosterSummarySource(candidate: StoryCandidate): string {
  const summary = cleanText(candidate.summary);
  const title = cleanText(candidate.title);
  if (!summary || summary === "N/A" || normalizeText(summary) === normalizeText(title)) {
    return buildFallbackSummarySource(candidate);
  }
  if (isLikelyTruncatedText(summary)) {
    return trimToCompleteBoundary(summary, 170) || buildFallbackSummarySource(candidate);
  }
  return trimToCompleteBoundary(summary, 210) || trimAtWordBoundary(summary, 210);
}

function buildFallbackSummarySource(candidate: StoryCandidate): string {
  const title = cleanText(candidate.title);
  const fact = cleanText(candidate.fact).replace(/^關鍵數字：/, "");
  if (title.length >= 72 && /(?:\$|%|billion|million|trillion|deal|report|sources|financing|chips?|data center|ai)/i.test(title)) {
    return trimAtWordBoundary(title.replace(/^Sources?:\s*/i, ""), 210);
  }
  if (fact && !/^來源：/.test(fact)) {
    return trimAtWordBoundary(fact, 180);
  }
  return "";
}

function trimAtWordBoundary(value: string, maxLength: number): string {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const boundary = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("，"), slice.lastIndexOf("、"));
  if (boundary >= 72) {
    return slice.slice(0, boundary).trim();
  }
  return slice.trim();
}

function trimToCompleteBoundary(value: string, maxLength: number): string {
  const text = cleanText(value);
  if (text.length <= maxLength && !isLikelyTruncatedText(text)) {
    return text;
  }

  const slice = text.slice(0, maxLength);
  const boundary = findLastSentenceBoundary(slice);
  if (boundary >= 72) {
    return slice.slice(0, boundary + 1).trim();
  }
  const commaBoundary = Math.max(slice.lastIndexOf(";"), slice.lastIndexOf(","), slice.lastIndexOf("，"));
  if (commaBoundary >= 72) {
    return slice.slice(0, commaBoundary).trim();
  }
  return "";
}

function findLastSentenceBoundary(value: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const char = value[index];
    if (!".!?。！？".includes(char)) continue;
    const before = value[index - 1] ?? "";
    const after = value[index + 1] ?? "";
    if (char === "." && /\d/.test(before) && /\d/.test(after)) continue;
    return index;
  }
  return -1;
}

function isLikelyTruncatedText(value: string): boolean {
  const text = cleanText(value);
  if (!text) return false;
  if (/[.…]\s*$/.test(text) || /\.\.\.$/.test(text)) return true;
  if (text.length >= 180 && !/[。.!?！？）」》]$/.test(text)) return true;
  return /\b(?:alre|becau|includ|accord|report|invest|marke|compan|earni|revenu)$/i.test(text);
}

function storyGroupKey(candidate: StoryCandidate): string {
  const text = `${candidate.themeKey} ${candidate.title} ${candidate.summary}`.toLowerCase();
  if (isDirectMacroJobsStory(text)) return "macro:jobs";
  if (isBroadMarketRecap(text)) return "market-broad";
  if (/\b(payrolls?|jobs report|labor market|unemployment|wage growth)\b/i.test(text)) return "macro:jobs";
  if (/\b(us-iran|iran|oil prices?|s&p 500|nasdaq 100|stocks fall|stock surge|record highs?|market move|index)\b/i.test(text)) return "market-broad";
  if (/\b(intel|nvidia|apple|microsoft|google|alphabet|amazon|meta|tesla|semiconductor|chip|data center|ai)\b/i.test(text)) return "big-tech-ai";
  if (/\b(earnings|revenue|eps|profit|loss|guidance)\b/i.test(text)) return "earnings";
  if (/\b(fed|rate|yield|inflation|cpi|ppi|payrolls)\b/i.test(text)) return "macro";
  return candidate.themeKey;
}

function storyKindKey(candidate: StoryCandidate): string {
  const text = `${candidate.title} ${candidate.summary}`.toLowerCase();
  if (isDirectMacroJobsStory(text)) return "macro_jobs";
  if (isBroadMarketRecap(text)) return "broad_market_recap";
  if (/\b(payrolls?|jobs report|labor market|unemployment|wage growth)\b/i.test(text)) return "macro_jobs";
  if (/\b(sec|fed|federal reserve|rates?|inflation|cpi|ppi|tariff)\b/i.test(text)) return "macro_policy";
  if (/\b(earnings|revenue|eps|guidance|profit|loss)\b/i.test(text)) return "earnings_company";
  if (/\b(ai|data center|semiconductor|chip|nvidia|nvda)\b/i.test(text)) return "ai_semis";
  return candidate.themeKey;
}

function buildClusterStoryCandidates(payload: DailyUsPayload): StoryCandidate[] {
  return payload.topClusters.map((cluster) => {
    const representative = findRepresentativeItem(payload, cluster.topItemTitles[0]);
    const themeKey = themeKeyFromCluster(cluster);
    const session = representative
      ? getPosterSessionRelevance(representative, payload.reportDate)
      : { relevance: "unknown_date" as const, dateNy: null };
    return {
      title: representative?.title || cluster.topItemTitles[0] || cluster.title || "N/A",
      summary: buildClusterSummary(cluster, representative),
      fact: clusterFactLine(cluster, representative, payload, themeKey),
      source: cluster.sources[0] || representative?.source || null,
      url: representative?.url || null,
      publishedAt: representative?.publishedAt ?? null,
      publishedDateNy: session.dateNy,
      sessionRelevance: session.relevance,
      themeKey,
      score: cluster.totalEditorialScore + cluster.sourceCount * 8 + cluster.itemCount * 4,
    };
  });
}

function buildClusterSummary(cluster: DailyUsPayload["topClusters"][number], representative: FeedItem | undefined): string {
  const base = representative?.description || cluster.topItemTitles[0] || cluster.title || "N/A";
  const related = cluster.topItemTitles
    .filter((title) => title !== representative?.title)
    .filter((title) => !isGenericMarketList(title))
    .slice(0, 2);
  if (related.length === 0) return base;
  return `${base} 相關新聞：${related.join(" / ")}`;
}

function buildItemStoryCandidates(items: FeedItem[], reportDate: string): StoryCandidate[] {
  return items
    .filter((item) => !isGenericMarketList(item.title))
    .map((item) => {
      const session = getPosterSessionRelevance(item, reportDate);
      return {
        title: item.title,
        summary: item.description || item.title,
        fact: buildFactLine(item),
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
        publishedDateNy: session.dateNy,
        sessionRelevance: session.relevance,
        themeKey: themeKeyFromItem(item),
        score: item.editorialScore + item.storyValueScore * 0.25 + item.marketReactionScore * 0.2 + newsSpecificityScore(item),
      };
    });
}

function filterItemsForPosterSession(items: FeedItem[], reportDate: string): FeedItem[] {
  return items.filter((item) => {
    const session = getPosterSessionRelevance(item, reportDate);
    return session.relevance === "same_session" || session.relevance === "after_close_grace";
  });
}

function getPosterSessionRelevance(item: FeedItem, reportDate: string): { relevance: SessionRelevance; dateNy: string | null } {
  if (!item.publishedAt) {
    return { relevance: "unknown_date", dateNy: null };
  }
  const publishedMs = Date.parse(item.publishedAt);
  if (!Number.isFinite(publishedMs)) {
    return { relevance: "unknown_date", dateNy: null };
  }
  const parts = getZonedDateParts(new Date(publishedMs), "America/New_York");
  if (parts.date === reportDate) {
    return { relevance: "same_session", dateNy: parts.date };
  }
  if (parts.date === addUtcDays(reportDate, 1) && parts.minutesSinceMidnight <= 3 * 60) {
    return { relevance: "after_close_grace", dateNy: parts.date };
  }
  return { relevance: "outside_session", dateNy: parts.date };
}

function findRepresentativeItem(payload: DailyUsPayload, title: string | undefined): FeedItem | undefined {
  if (!title) return undefined;
  return [...payload.topStories, ...payload.topAiRadar, ...payload.earningsRadar].find((item) => item.title === title);
}

function clusterFactLine(
  cluster: DailyUsPayload["topClusters"][number],
  representative: FeedItem | undefined,
  payload: DailyUsPayload,
  themeKey: string,
): string {
  if (themeKey === "market:index") {
    const spx = metricFromQuote(findQuote(payload.marketSummary.indices, "spx"));
    const ndx = metricFromQuote(findQuote(payload.marketSummary.indices, "ndx"));
    return `S&P 500 ${spx.change} / Nasdaq ${ndx.change}`;
  }
  if (themeKey === "calendar:earnings") {
    return `${cluster.itemCount} articles / ${cluster.sourceCount} sources`;
  }
  if (representative) {
    return buildFactLine(representative);
  }
  if (cluster.sourceCount > 1 || cluster.itemCount > 1) {
    return `${cluster.itemCount} articles / ${cluster.sourceCount} sources`;
  }
  return `score ${Math.round(cluster.totalEditorialScore)}`;
}

function themeKeyFromCluster(cluster: DailyUsPayload["topClusters"][number]): string {
  const text = `${cluster.clusterKey} ${cluster.title} ${cluster.topItemTitles.join(" ")}`.toLowerCase();
  return normalizedThemeKey(text);
}

function themeKeyFromItem(item: FeedItem): string {
  const text = `${item.clusterKey} ${item.marketTheme ?? ""} ${item.eventType ?? ""} ${item.majorEntity ?? ""} ${item.title}`.toLowerCase();
  return normalizedThemeKey(text);
}

function normalizedThemeKey(text: string): string {
  if (/\b(amd|advanced micro devices)\b/.test(text)) return "company:amd";
  if (/\b(pre-market earnings|after-hours earnings|earnings report for|財報日曆)\b/.test(text)) return "calendar:earnings";
  if (/\b(payrolls?|jobs report|labor market|unemployment|wage growth)\b/.test(text)) return "macro:jobs";
  if (/\b(big_tech_earnings|tech earnings|robust tech earnings|mega cap|apple|microsoft|google|alphabet|amazon|meta|tesla)\b/.test(text)) return "theme:big_tech";
  if (/\b(ai|nvidia|nvda|data center|semiconductor|chip)\b/.test(text)) return "theme:ai";
  if (/\b(spx|s&p|s&p 500|nasdaq 100|record high|index|indices)\b/.test(text)) return "market:index";
  if (/\b(fed|rate|yield|inflation|cpi|ppi|payrolls)\b/.test(text)) return "macro:rates";
  return normalizeText(text).slice(0, 48);
}

function buildFactLine(item: FeedItem): string {
  const text = `${item.title} ${item.description}`;
  const number = text
    .match(/[$]?\d[\d,.]*(?:\.\d+)?\s?(?:%|億|萬|million|billion|trillion|美元|points|bps|EPS|revenue|guidance)?/gi)
    ?.find((candidate) => isUsefulNumber(candidate));
  return number ? `關鍵數字：${number.trim().replace(/,$/, "")}` : `來源：${normalizeDisplaySource(item.source)}`;
}

function normalizeDisplaySource(source: string | null): string | null {
  if (!source) return source;
  const clean = cleanText(source);
  if (/^Nasdaq(?:\s+[A-Z]{1,6})?$/.test(clean)) return "Nasdaq";
  if (/^Yahoo Finance(?:\s+[A-Z]{1,6})?$/.test(clean)) return "Yahoo Finance";
  return clean;
}

function resolveTranslationMode(requestUrl: URL): TranslationMode {
  const mode = requestUrl.searchParams.get("translation") || requestUrl.searchParams.get("translator");
  return mode === "none" ? "none" : "openrouter";
}

function createPosterTranslator(mode: TranslationMode, env: Env): PosterTranslator {
  if (mode === "none") {
    return {
      mode,
      story: identityStory,
      headline: identityText,
      summary: identityText,
      fact: identityText,
      calendarTitle: identityText,
      calendarDate: extractCalendarDate,
    };
  }
  const translate = (value: string) => translateWithOpenRouter(value, env);
  return {
    mode,
    story: (title: string, summary: string, fact: string) => rewriteStoryWithOpenRouter(title, summary, fact, env),
    headline: translate,
    summary: translate,
    fact: identityText,
    calendarTitle: translate,
    calendarDate: extractCalendarDate,
  };
}

async function identityText(value: string): Promise<string> {
  return value;
}

async function identityStory(title: string, summary: string): Promise<StoryRewrite> {
  return { title, summary };
}

function isGenericMarketList(title: string): boolean {
  return /\b(pre-market most active|after hours most active|after-hours most active|most active for)\b/i.test(title);
}

function isStrongNewsCandidate(candidate: StoryCandidate): boolean {
  const text = `${candidate.title} ${candidate.summary}`.toLowerCase();
  if (isWeakPosterSource(candidate)) return false;
  if (isAdministrativeOfficialNotice(candidate)) return false;
  if (isGenericMarketList(candidate.title)) return false;
  if (isEvergreenInvestmentAdviceTitle(candidate.title)) return false;
  if (isLowContentPosterCandidate(candidate)) return false;
  if (/\b(pre-market earnings report|after-hours earnings report|earnings report for may|earnings call transcript|earnings call presentation|earnings call highlights|week in review|weekly review|roundup|earnings scoreboard)\b/i.test(candidate.title)) return false;
  if (/\b(parloa|gardening tips|future vision film competition|maternity leave|best companies to work|workplace|dating app|movie|streaming guide)\b/i.test(text)) return false;
  if (/\bmost active\b/i.test(text)) return false;
  if (!candidate.url) return false;
  return newsSpecificityFromText(text) >= 18 || /\b(earnings|guidance|revenue|eps|partnership|acquisition|deal|sec|fed|tariff|jobs|payrolls|labor market|data center|chip)\b/i.test(text);
}

function isLowContentPosterCandidate(candidate: StoryCandidate): boolean {
  const source = candidate.source || "";
  const title = cleanText(candidate.title);
  const summary = cleanText(candidate.summary);
  const summaryIsTitle = !summary || normalizeText(summary) === normalizeText(title);
  const hasHardNumber = /\$?\d[\d,.]*(?:\.\d+)?\s?(?:%|million|billion|trillion|mn|bn|bps|mw|gw)\b/i.test(title);
  const hasConcreteEvent = /\b(sources?|report|reported|deal|agreement|contract|partnership|financing|funding|investment|raises?|surged|jumped|fell|results|guidance|revenue|eps|margin|data center|custom chip|ai chip|semiconductor|tariff|fed|cpi|ppi|payrolls|jobs report)\b/i.test(title);
  const isOpinionOrPreview = /\b(preview|outlook|analysis|thesis|valuation|could|should|why|how|what|is .+ a buy|buy)\b/i.test(title);
  if (summaryIsTitle && isOpinionOrPreview && !(hasHardNumber && hasConcreteEvent)) {
    return true;
  }
  if (summaryIsTitle && !hasHardNumber && !hasConcreteEvent) {
    return true;
  }
  if (/^Seeking Alpha\b/i.test(source) && summaryIsTitle && !hasHardNumber) {
    return true;
  }
  return false;
}

function isStrongStockNewsCandidate(candidate: StoryCandidate): boolean {
  const text = `${candidate.title} ${candidate.summary}`.toLowerCase();
  if (!candidate.url) return false;
  if (/^Nasdaq(?:\s|$)/i.test(candidate.source || "")) return false;
  if (isBroadMarketRecap(text)) return false;
  if (/\b(pre-market earnings report|after-hours earnings report|earnings report for may|most active|earnings call transcript|earnings call presentation|earnings call highlights|week in review|weekly review|roundup|earnings scoreboard)\b/i.test(text)) return false;
  const hasCompany = /\b(apple|aapl|microsoft|msft|nvidia|nvda|amazon|amzn|alphabet|google|googl|meta|tesla|tsla|amd|dell|super micro|supermicro|smci|intel|intc|visa|broadcom|avgo|oracle|orcl|palantir|pltr|coreweave|crwv)\b/i.test(text);
  const hasCatalyst = /\b(earnings|results|guidance|revenue|eps|profit|margin|surged|soared|jumped|rallied|fell|dropped|slid|record high|all-time high|price target|upgrade|downgrade|deals?|partnership|contract|acquisition|investment|equity bets?|investigation|lawsuit|white house|trump|tariff|ai server|ai infrastructure|data center|gpu|chip|semiconductor|cloud|capex|inference)\b/i.test(text);
  const isAdviceFormat = /\b(should you buy|better buy|best buy|worth buying|top stock to buy|buy now|sell now|reasons to buy|prediction:|outperform the s&p 500|flagship tech etf|next nvidia|challenger|loading up|you'd invested|start buying|maternity leave|best companies to work|workplace|dating app|movie|streaming guide)\b/i.test(text);
  if (isAdviceFormat) return false;
  return hasCompany && hasCatalyst && newsSpecificityFromText(text) >= 18;
}

function isLowValueStockNewsCandidate(candidate: StoryCandidate): boolean {
  const text = `${candidate.title} ${candidate.summary}`.toLowerCase();
  if (!candidate.url) return true;
  if (isBroadMarketRecap(text)) return true;
  if (/\b(most active|earnings call transcript|earnings call presentation|week in review|weekly review|roundup|earnings scoreboard)\b/i.test(text)) return true;
  if (/\b(should you buy|better buy|best buy|worth buying|top stock to buy|buy now|sell now|prediction:|streaming guide)\b/i.test(text)) return true;
  return newsSpecificityFromText(text) < 10;
}

function isWeakPosterSource(candidate: StoryCandidate): boolean {
  const source = candidate.source || "";
  if (!/^Nasdaq(?:\s+[A-Z]{1,6})?$/.test(source)) return false;
  return true;
}

function isAdministrativeOfficialNotice(candidate: StoryCandidate): boolean {
  const text = `${candidate.title} ${candidate.summary}`.toLowerCase();
  return /\bfederal reserve board announces approval\b/.test(text)
    || /\bapproval of related applications\b/.test(text)
    || /\bminutes of the meeting of the court of directors\b/.test(text);
}

function isEvergreenInvestmentAdviceTitle(title: string): boolean {
  return /\b(?:is|are|should)\b.{0,80}\b(?:a buy|buy now|worth buying|time to buy|top stock to buy|turnaround finally working)\b/i.test(title)
    || /\b(?:buy|sell|hold)\b.{0,50}\b(?:amid|after|before|ahead of)\b/i.test(title)
    || /\b(?:which|what)\b.{0,60}\b(?:better buy|better stock|looks better)\b/i.test(title);
}

function newsSpecificityScore(item: FeedItem): number {
  const text = `${item.title} ${item.description}`;
  let score = newsSpecificityFromText(text) + (item.sourceType === "official" ? 12 : 0);
  if (isBroadMarketRecap(text)) score -= 28;
  if (isDirectMacroJobsStory(text)) score += 36;
  else if (/\b(payrolls?|jobs report|labor market|unemployment|wage growth)\b/i.test(text)) score += 12;
  return score;
}

function newsSpecificityFromText(text: string): number {
  let score = 0;
  if (/\b(intel|nvidia|nvda|apple|microsoft|msft|google|alphabet|amazon|meta|tesla|dell|super micro|smci)\b/i.test(text)) score += 18;
  if (/\b(s&p 500|nasdaq 100|record high|stock surge|stocks fall)\b/i.test(text)) score += 14;
  if (/\b(earnings|results|guidance|revenue|eps|profit|loss)\b/i.test(text)) score += 18;
  if (/\b(partnership|deal|acquisition|merger|launch|contract|approval|investigation|lawsuit|sec|fed|tariff|jobs|payrolls|labor market)\b/i.test(text)) score += 18;
  if (/\b(ai|data center|semiconductor|chip|cloud|server|gpu|inference)\b/i.test(text)) score += 10;
  if (isEvergreenInvestmentAdviceTitle(text)) score -= 45;
  if (/\bcustomer service|gardening|film competition|tips you can try\b/i.test(text)) score -= 35;
  if (/\b[A-Z]{2,5}\b/.test(text)) score += 6;
  if (/\$?\d[\d,.]*(?:\.\d+)?\s?(?:%|million|billion|trillion|mn|bn|美元|bps)?/i.test(text)) score += 8;
  return score;
}

function isBroadMarketRecap(text: string): boolean {
  return /\b(stocks?|s&p 500|nasdaq 100|dow)\b.{0,90}\b(climb|finish higher|lifts?|surge|record highs?|fall|reverses|bounce)\b/i.test(text)
    || /\b(climb|finish higher|lifts?|surge|record highs?|fall|reverses|bounce)\b.{0,90}\b(stocks?|s&p 500|nasdaq 100|dow)\b/i.test(text);
}

function isDirectMacroJobsStory(text: string): boolean {
  return /\b(payrolls?|jobs report|unemployment|wage growth|nonfarm payrolls?)\b/i.test(text);
}

async function translateWithOpenRouter(value: string, env: Env): Promise<string> {
  const text = value.trim();
  if (!text || text === "N/A" || containsCjk(text) || !env.OPENROUTER_API_KEY) {
    return value;
  }

  const model = env.OPENROUTER_TRANSLATION_MODEL || "qwen/qwen-turbo";
  const cacheKey = `translation:openrouter:v7:${model}:${hashString(text)}`;
  const cached = await env.EDITORIAL_CACHE?.get(cacheKey, "text");
  if (cached) return cached;
  const protectedText = protectTranslationTerms(text);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://weekly-rss-daily.zeabur.app",
        "X-Title": "us-daily-market-report",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: Math.min(500, Math.max(80, Math.ceil(text.length * 1.8))),
        messages: [
          {
            role: "system",
            content:
              "你是台灣財經新聞翻譯器。請把英文財經新聞翻成自然繁體中文。所有 __KEEP_數字__ 佔位符必須原樣保留，不得刪除、改寫或重新排序。不要新增資訊、不要摘要、不要解釋。只輸出譯文。",
          },
          { role: "user", content: protectedText.text },
        ],
      }),
    });
    if (!response.ok) return value;
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const translated = normalizeTranslatedFinancialText(
      restoreTranslationTerms(data.choices?.[0]?.message?.content?.trim() ?? "", protectedText.terms),
    );
    if (!translated) return value;
    await env.EDITORIAL_CACHE?.put(cacheKey, translated, { expirationTtl: 60 * 60 * 24 * 14 });
    return translated;
  } catch {
    return value;
  }
}

async function rewriteStoryWithOpenRouter(title: string, summary: string, fact: string, env: Env): Promise<StoryRewrite> {
  const fallback = async () => ({
    title: await translateWithOpenRouter(title, env),
    summary: summary ? await translateWithOpenRouter(summary, env) : "",
  });
  if (!env.OPENROUTER_API_KEY) {
    return fallback();
  }

  const model = env.OPENROUTER_TRANSLATION_MODEL || "qwen/qwen-turbo";
  const rawInput = [
    `title: ${title}`,
    summary ? `summary: ${summary}` : "summary: N/A",
    `fact: ${fact}`,
  ].join("\n");
  const cacheKey = `story-rewrite:openrouter:v2:${model}:${hashString(rawInput)}`;
  const cached = await env.EDITORIAL_CACHE?.get(cacheKey, "json");
  if (isStoryRewrite(cached)) return cached;

  const protectedInput = protectTranslationTerms(rawInput);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://weekly-rss-daily.zeabur.app",
        "X-Title": "us-daily-market-report",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 320,
        messages: [
          {
            role: "system",
            content:
              "你是台灣財經日報編輯。根據英文來源改寫成自然繁體中文，不是逐句翻譯。只能使用輸入中的事實，不得新增因果、數字或投資建議。所有 __KEEP_數字__ 佔位符必須原樣保留。輸出嚴格 JSON：{\"title\":\"短標題\",\"summary\":\"一到兩句摘要\"}。",
          },
          {
            role: "user",
            content:
              `${protectedInput.text}\n\n要求：title 不要像投顧喊單，不要用「是否買進」語氣；summary 要完整句，不要省略號；保留股票代號、公司名、百分比、金額。fact 只供核對，除非是關鍵數字，否則不要把「來源：...」或資料來源文字寫進摘要。`,
          },
        ],
      }),
    });
    if (!response.ok) return fallback();
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseStoryRewrite(content);
    if (!parsed) return fallback();

    const rewritten = {
      title: normalizeTranslatedFinancialText(restoreTranslationTerms(parsed.title, protectedInput.terms)),
      summary: normalizeTranslatedFinancialText(restoreTranslationTerms(parsed.summary, protectedInput.terms)),
    };
    if (!rewritten.title) return fallback();
    await env.EDITORIAL_CACHE?.put(cacheKey, JSON.stringify(rewritten), { expirationTtl: 60 * 60 * 24 * 14 });
    return rewritten;
  } catch {
    return fallback();
  }
}

function parseStoryRewrite(value: string): StoryRewrite | null {
  const cleaned = value
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<StoryRewrite>;
    if (typeof parsed.title !== "string" || typeof parsed.summary !== "string") return null;
    return {
      title: parsed.title.trim(),
      summary: parsed.summary.trim(),
    };
  } catch {
    return null;
  }
}

function isStoryRewrite(value: unknown): value is StoryRewrite {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as StoryRewrite).title === "string"
    && typeof (value as StoryRewrite).summary === "string",
  );
}

function protectTranslationTerms(value: string): { text: string; terms: string[] } {
  const terms: string[] = [];
  const pattern =
    /\bS&P\s?500\b|\bNasdaq\s?(?:Composite|100)?\b|\bDow Jones(?: Industrial Average)?\b|\bRussell\s?2000\b|\bUS\s?10Y\b|\$?\d[\d,.]*(?:\.\d+)?\s?(?:million|billion|trillion|mn|bn)\b|\$[A-Z]{1,8}\b|\b(?!US\b)[A-Z]{2,8}\b|\bQ[1-4]\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d[\d,.]*(?:\.\d+)?\s?(?:%|bps|AM|PM)?\b/g;
  const text = value.replace(pattern, (match) => {
    const token = `__KEEP_${terms.length}__`;
    terms.push(match);
    return token;
  });
  return { text, terms };
}

function restoreTranslationTerms(value: string, terms: string[]): string {
  let text = value;
  terms.forEach((term, index) => {
    text = text.replaceAll(`__KEEP_${index}__`, term);
  });
  return text;
}

function normalizeTranslatedFinancialText(value: string): string {
  return value
    .replace(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/g,
      (_, month: string, day: string, year: string) => `${year}年${monthNumber(month)}月${Number(day)}日`,
    )
    .replace(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/g,
      (_, month: string, year: string) => `${year}年${monthNumber(month)}月`,
    )
    .replace(/\s+([，。：；！？」）])/g, "$1")
    .replace(/([（(])\s+/g, "$1")
    .replace(/\s+([）)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function monthNumber(value: string): number {
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const index = months.indexOf(value.toLowerCase());
  return index >= 0 ? index + 1 : 0;
}

function formatEarningsCalendarTitle(title: string): string | null {
  const match = title.match(/^(?:Pre-Market|After-Hours)\s+Earnings\s+Report\s+for\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s*:\s*(.+)$/i);
  if (!match) return null;
  const tickers = match[1].split(",").map((item) => item.trim()).filter(Boolean);
  if (tickers.length === 0) return null;
  return `財報名單：${tickers.join("、")}`;
}

function formatMacroCalendarTitle(title: string): string | null {
  const monthYear = title.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  const suffix = monthYear ? `，${monthYear[2]}年${monthNumber(monthYear[1])}月` : "";
  const quarterSuffix = formatQuarterSuffix(title);
  if (/Personal Income and Outlays/i.test(title)) return `個人所得與消費支出${suffix}`;
  if (/International Trade in Goods and Services/i.test(title)) return `美國商品與服務國際貿易${suffix}`;
  if (/GDP|Gross Domestic Product/i.test(title) && /Corporate Profits/i.test(title)) return `GDP 第二次估算與企業獲利${quarterSuffix || suffix}`;
  if (/GDP|Gross Domestic Product/i.test(title)) return `GDP 國內生產毛額${quarterSuffix || suffix}`;
  if (/Corporate Profits/i.test(title)) return `企業獲利${quarterSuffix || suffix}`;
  if (/Consumer Price Index|CPI/i.test(title)) return `CPI 消費者物價指數${suffix}`;
  if (/Producer Price Index|PPI/i.test(title)) return `PPI 生產者物價指數${suffix}`;
  if (/Retail Sales/i.test(title)) return `零售銷售${suffix}`;
  if (/Employment Situation|Payrolls/i.test(title)) return `非農就業 / 就業報告${suffix}`;
  return null;
}

function formatQuarterSuffix(title: string): string {
  const year = title.match(/\b(20\d{2})\b/)?.[1];
  const quarterMatch = title.match(/\b(?:Q([1-4])|([1-4])(?:st|nd|rd|th)\s+Quarter|First Quarter|Second Quarter|Third Quarter|Fourth Quarter)\b/i);
  if (!year || !quarterMatch) return "";
  const quarterDigit = quarterMatch[1] || quarterMatch[2];
  const quarter = quarterDigit
    ? Number(quarterDigit)
    : ["first quarter", "second quarter", "third quarter", "fourth quarter"].findIndex((label) => title.toLowerCase().includes(label)) + 1;
  if (quarter < 1 || quarter > 4) return "";
  return `，${year}年第${quarter}季`;
}

async function extractCalendarDate(title: string): Promise<string> {
  const match = title.match(/\b([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\b/);
  if (!match) return "待公布";
  return `${match[3]}年${monthNumber(match[1])}月${Number(match[2])}日`;
}

function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function isUsefulNumber(value: string): boolean {
  const normalized = value.trim().replace(/,$/, "");
  if (normalized === "500" || normalized === "100") {
    return false;
  }
  if (/[,$%]|億|萬|million|billion|trillion|美元|points|bps|eps|revenue|guidance/i.test(normalized)) {
    const numeric = Number(normalized.replace(/[$,%]/g, ""));
    return !Number.isFinite(numeric) || numeric >= 100;
  }
  const numeric = Number(normalized.replace(/,/g, ""));
  if (Number.isFinite(numeric) && numeric >= 1900 && numeric <= 2100) {
    return false;
  }
  return Number.isFinite(numeric) && numeric >= 100;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
}

function findQuote(items: DailyUsPayload["marketSummary"]["indices"], key: string) {
  return items.find((item) => item.key === key);
}

function metricFromQuote(quote: ReturnType<typeof findQuote> | undefined): PosterMetric {
  if (!quote || quote.price === null || quote.changePct === null || quote.asOf === null || quote.dataProvider === null) {
    return { label: quote?.label || "N/A", value: "N/A", change: "N/A", trend: "na", history: [] };
  }
  return {
    label: quote.label,
    value: formatNumber(quote.price, quote.price >= 100 ? 2 : 2),
    change: `${formatSigned(quote.changePct, 2)}%`,
    trend: trendFromChange(quote.changePct),
    history: (quote.history ?? []).map((point) => point.close).filter((value) => Number.isFinite(value)),
  };
}

function megaCapFromQuote(quote: ReturnType<typeof findQuote> | undefined): PosterMegaCap {
  const metric = metricFromQuote(quote);
  return {
    label: quote?.label || "N/A",
    ticker: quote?.symbol || "N/A",
    price: metric.value,
    change: metric.change,
    trend: metric.trend,
    history: metric.history,
  };
}

function trendFromChange(value: number): Trend {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function renderPosterHtml(payload: PosterPayload): string {
  const p = payload.poster;
  const body = payload.canRender ? renderPosterBody(payload) : renderBlockedBody(payload);
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(p.title)} · ${escapeHtml(p.date)}</title>
  <style>${posterCssV3()}</style>
</head>
<body>
  ${renderPosterExportControls(payload)}
  <main class="poster" aria-label="${escapeHtml(p.title)}">
    ${body}
  </main>
  <script id="poster-payload-json" type="application/json">${escapeHtml(JSON.stringify(payload, null, 2))}</script>
  <script>${posterExportScript()}</script>
</body>
</html>`;
}

function renderPrintHtml(payload: PosterPayload, requestUrl: URL): string {
  const p = payload.poster;
  const autoPrint = requestUrl.searchParams.get("autoprint") === "1";
  const body = payload.canRender ? renderPosterBody(payload) : renderBlockedBody(payload);
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(p.title)} PDF · ${escapeHtml(p.date)}</title>
      <style>${posterCssV3()}${printPosterCssV2()}</style>
</head>
<body${autoPrint ? ' data-autoprint="1"' : ""}>
  <main class="poster print-poster" aria-label="${escapeHtml(p.title)} print view">
    ${body}
  </main>
  <script>
  (() => {
    if (document.body.dataset.autoprint !== "1") return;
    const run = async () => {
      try { await document.fonts?.ready; } catch {}
      window.setTimeout(() => window.print(), 180);
    };
    run();
  })();
  </script>
</body>
</html>`;
}

function printPosterCssV2(): string {
  return `
    :root { color-scheme: only light; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top, rgba(255, 196, 128, 0.18), transparent 32%),
        linear-gradient(180deg, #f6efe3 0%, #efe4d2 100%);
      color: #111111;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .print-shell {
      width: 100%;
      padding: 32px 20px 40px;
      box-sizing: border-box;
    }

    .print-poster {
      margin: 0 auto;
    }

    @media print {
      @page {
        size: A4 portrait;
        margin: 10mm;
      }

      html,
      body {
        background: #f6efe3;
      }

      .print-shell {
        padding: 0;
      }

      .print-poster {
        width: auto;
        min-height: auto;
        margin: 0;
        border-radius: 0;
        box-shadow: none;
        overflow: visible;
      }

      .print-poster .cover,
      .print-poster .markets-panel,
      .print-poster .mega-panel,
      .print-poster .lead-panel,
      .print-poster .next-watch {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .print-poster .ticker-strip,
      .print-poster .tape-board,
      .print-poster .stock-news-panel {
        break-inside: auto;
        page-break-inside: auto;
      }

      .print-poster .ticker-strip {
        overflow: visible;
      }

      .print-poster .tape-lines,
      .print-poster .tape-line,
      .print-poster .mega-tape {
        break-inside: auto;
        page-break-inside: auto;
      }

      .print-poster .tape-title {
        display: block;
        min-height: 0;
        height: auto;
        padding: 8px 10px;
        overflow: visible;
      }

      .print-poster .tape-title span {
        display: block;
        font-size: 9px;
        letter-spacing: 0.08em;
        white-space: normal;
        line-height: 1.35;
        overflow: visible;
      }

      .print-poster .tape-title strong {
        display: block;
        margin-top: 4px;
        font-size: 13px;
        letter-spacing: 0.02em;
        line-height: 1.35;
        white-space: normal;
        overflow: visible;
      }

      .print-poster .stock-news-grid {
        display: grid !important;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-auto-rows: auto;
        align-items: stretch;
        gap: 8px;
        border: 0;
        background: transparent;
      }

      .print-poster .stock-news-card,
      .print-poster .stock-card,
      .print-poster .lead-card,
      .print-poster .calendar-card,
      .print-poster .mega-card,
      .print-poster .score-card,
      .print-poster .asset-card {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .print-poster .lead-grid {
        grid-template-columns: 1fr;
      }

      .print-poster .stock-card,
      .print-poster .stock-news-empty {
        min-height: 0;
        height: auto;
        padding: 12px 12px 11px;
        border: 1px solid var(--hair);
        overflow: visible;
      }

      .print-poster .stock-card:nth-child(2n) {
        border-right: 1px solid var(--hair);
      }

      .print-poster .stock-card:nth-last-child(-n + 2) {
        border-bottom: 1px solid var(--hair);
      }

      .print-poster .stock-card-top,
      .print-poster .stock-card em {
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
      }

      .print-poster .stock-card-top {
        align-items: flex-start;
      }

      .print-poster .stock-card h3 {
        font-size: 19px;
        line-height: 1.14;
      }

      .print-poster .stock-card p:not(.stock-card-top) {
        font-size: 13px;
        line-height: 1.45;
      }

      .print-poster .fact-pill {
        position: static;
        margin-top: 14px;
      }

      .print-poster .next-watch .calendar-list {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .print-poster .stock-news-headline,
      .print-poster .stock-news-summary,
      .print-poster .lead-title,
      .print-poster .lead-summary,
      .print-poster .calendar-text {
        -webkit-line-clamp: unset;
        overflow: visible;
        display: block;
      }
    }
  `;
}

function printPosterCss(): string {
  return `
body[data-autoprint="1"]{
  background:
    radial-gradient(circle at 15% -10%, rgba(184,133,45,.24), transparent 34%),
    radial-gradient(circle at 95% 20%, rgba(168,32,34,.18), transparent 32%),
    linear-gradient(135deg,#211b14,#756858);
}
.print-poster{
  margin:0 auto;
}
@media print{
  @page{size:A4 portrait;margin:12mm}
  html,body{
    background:#fff!important;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .print-poster{
    width:auto!important;
    min-height:auto!important;
    margin:0!important;
    padding:18px 20px 16px!important;
    box-shadow:none!important;
    overflow:visible!important;
  }
  .print-poster:before{
    opacity:.24!important;
  }
  .sheet-top,
  .cover,
  .stock-news-strip,
  .lead-stories,
  .next-watch,
  .sheet-footer{
    break-inside:avoid-page;
    page-break-inside:avoid;
  }
  .tape-board,
  .tape-lines,
  .tape-line,
  .mega-tape{
    break-inside:auto;
    page-break-inside:auto;
  }
  .cover{
    display:block;
    padding:18px 0 16px;
  }
  .cover h1{
    max-width:none;
    font-size:64px;
    line-height:.9;
  }
  .one-line{
    max-width:none;
    margin-top:16px;
    font-size:18px;
    line-height:1.45;
  }
  .scoreboard{
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    grid-template-rows:none;
    margin-top:16px;
  }
  .score{
    border-right:1px solid rgba(248,237,218,.2);
    border-bottom:0;
  }
  .score:last-child{border-right:0}
  .score strong{
    font-size:28px;
  }
  .score em{
    font-size:12px;
  }
  .score-chart{
    height:30px;
    margin-top:10px;
  }
  .tape-board{
    display:block;
    margin-top:12px;
  }
  .tape-title{
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:9px 10px;
    border-right:0;
    border-bottom:2px solid var(--rule);
    writing-mode:horizontal-tb;
    text-orientation:mixed;
  }
  .tape-title strong{
    margin-top:0;
    font-size:14px;
  }
  .tape-lines{
    display:grid;
    gap:8px;
    margin-top:8px;
  }
  .tape-line,
  .tape-line:first-child,
  .mega-tape{
    grid-template-columns:repeat(3,minmax(0,1fr));
    border:1px solid var(--hair);
  }
  .tape-item{
    padding:10px 8px;
  }
  .tape-item span{
    min-height:0;
  }
  .mini-chart{
    height:24px;
    margin-top:6px;
  }
  .stock-news-grid{
    grid-template-columns:repeat(2,minmax(0,1fr));
    grid-auto-rows:auto;
    gap:8px;
    border:0;
    background:transparent;
  }
  .stock-card,
  .stock-news-empty{
    min-height:0;
    height:auto;
    border:1px solid var(--hair);
    break-inside:avoid-page;
    page-break-inside:avoid;
  }
  .stock-card:nth-child(4n){border-right:1px solid var(--hair)}
  .stock-card:nth-last-child(-n + 4){border-bottom:1px solid var(--hair)}
  .stock-card h3,
  .stock-card p:not(.stock-card-top),
  .stock-card em,
  .lead-story h2,
  .story-text,
  .fact-pill{
    display:block;
    overflow:visible!important;
    white-space:normal!important;
    text-overflow:clip!important;
    -webkit-line-clamp:unset!important;
  }
  .lead-grid{
    grid-template-columns:1fr;
    gap:10px;
    border-top:0;
    border-bottom:0;
  }
  .lead-story{
    height:auto;
    min-height:0;
    padding:18px 16px;
    border:1px solid var(--rule);
    break-inside:avoid-page;
    page-break-inside:avoid;
  }
  .story-num{
    font-size:64px;
  }
  .source-line{
    max-width:none;
    margin-bottom:10px;
  }
  .lead-story h2,
  .story-1 h2{
    height:auto;
    margin-bottom:10px;
    padding-right:42px;
    font-size:24px;
    line-height:1.12;
  }
  .story-text{
    font-size:14px;
    line-height:1.52;
  }
  .fact-pill{
    position:static;
    margin-top:12px;
    padding:8px 10px;
    border-top:1px solid var(--red);
    font-size:11px;
  }
  .next-watch .calendar-list{
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:8px;
    border:0;
    background:transparent;
  }
  .calendar-event{
    min-height:0;
    border:1px solid var(--hair);
    break-inside:avoid-page;
    page-break-inside:avoid;
  }
  .calendar-page{
    min-height:98px;
  }
  .calendar-page strong{
    font-size:30px;
  }
}
`;
}

function renderPrintBody(payload: PosterPayload): string {
  const p = payload.poster;
  return `<header class="print-header">
    <div>
      <p class="eyebrow">${escapeHtml(p.eyebrow)}</p>
      <h1>${escapeHtml(p.title)}</h1>
      <p class="print-date">${escapeHtml(formatChineseDate(p.date))}</p>
    </div>
    <p class="print-one-line">${escapeHtml(p.oneLine)}</p>
  </header>
  <section class="print-section">
    <h2>市場總覽</h2>
    <div class="metric-grid">
      ${p.indices.map((item) => renderPrintMetricCard(item)).join("")}
      ${p.assets.map((item) => renderPrintMetricCard(item)).join("")}
    </div>
  </section>
  <section class="print-section">
    <h2>Mega Cap</h2>
    <div class="mega-grid-print">
      ${p.megaCaps.map((item) => renderPrintMegaCard(item)).join("")}
    </div>
  </section>
  <section class="print-section">
    <h2>個股新聞</h2>
    <div class="print-stock-grid">
      ${p.stockNews.length ? p.stockNews.map(renderPrintStockCard).join("") : `<article class="print-empty">暫無符合條件的個股新聞。</article>`}
    </div>
  </section>
  <section class="print-section">
    <h2>今日三條主線</h2>
    <div class="print-story-list">
      ${p.stories.map((item, index) => renderPrintLeadCard(item, index)).join("")}
    </div>
  </section>
  <section class="print-section">
    <h2>重要行事曆</h2>
    <div class="print-calendar-grid">
      ${p.calendarFull.length ? p.calendarFull.map(renderPrintCalendarCard).join("") : `<article class="print-empty">暫無可解析的重要事件。</article>`}
    </div>
  </section>
  <footer class="print-footer">${p.footer.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</footer>`;
}

function renderCalendarHtml(payload: PosterPayload): string {
  const p = payload.poster;
  const body = payload.canRender ? renderCalendarBody(payload) : renderBlockedBody(payload);
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>重要行事曆 · ${escapeHtml(p.date)}</title>
  <style>${calendarCss()}</style>
</head>
<body>
  ${body}
  <script id="poster-payload-json" type="application/json">${escapeHtml(JSON.stringify(payload, null, 2))}</script>
</body>
</html>`;
}

function renderCalendarBody(payload: PosterPayload): string {
  const p = payload.poster;
  return `<main class="calendar-sheet">
    <header class="calendar-hero">
      <p>US DAILY EVENT BOARD</p>
      <h1>重要行事曆</h1>
      <strong>${escapeHtml(formatChineseDate(p.date))}</strong>
    </header>
    <section class="calendar-board">
      ${p.calendarFull.map(renderLargeCalendarEvent).join("") || "<p>暫無可解析的重要事件。</p>"}
    </section>
    <footer>${p.footer.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</footer>
  </main>`;
}

function renderLargeCalendarEvent(item: PosterCalendarEvent): string {
  const date = parseCalendarDateParts(item.date);
  return `<article class="large-event ${item.kind}">
    <div class="date-block">
      <span>${escapeHtml(date.month)}</span>
      <strong>${escapeHtml(date.day)}</strong>
      <em>${escapeHtml(date.time)}</em>
    </div>
    <div class="event-copy">
      <p>${escapeHtml(item.label)}</p>
      <h2>${escapeHtml(item.title)}</h2>
    </div>
  </article>`;
}

function renderBlockedBody(payload: PosterPayload): string {
  return `<section class="blocked">
    <p class="eyebrow">${escapeHtml(payload.poster.eyebrow)}</p>
    <h1>${escapeHtml(payload.poster.title)}</h1>
    <p class="date">${escapeHtml(payload.poster.date)}</p>
    <div class="notice">${escapeHtml(payload.marketDataStatus.message)}</div>
    <dl>
      <dt>Taipei</dt><dd>${escapeHtml(payload.marketDataStatus.taipeiNow)}</dd>
      <dt>New York</dt><dd>${escapeHtml(payload.marketDataStatus.newYorkNow)}</dd>
      <dt>Latest completed US session</dt><dd>${escapeHtml(payload.marketDataStatus.recommendedCompletedUsSessionDate)}</dd>
    </dl>
  </section>`;
}

function renderPosterExportControls(payload: PosterPayload): string {
  const date = payload.poster.date;
  const disabled = payload.canRender ? "" : " disabled";
  return `<div class="export-dock" data-export-date="${escapeHtml(date)}">
    <button type="button" data-export-action="copy-image"${disabled}>複製圖片</button>
    <button type="button" data-export-action="download-image"${disabled}>下載 PNG</button>
    <button type="button" data-export-action="print-pdf"${disabled}>存成 PDF</button>
    <span data-export-status>READY</span>
  </div>`;
}

function renderPosterBody(payload: PosterPayload): string {
  const p = payload.poster;
  return `<header class="sheet-top">
    <div class="edition">
      <span>US MARKET CLOSE</span>
      <strong>${escapeHtml(formatChineseDate(p.date))}</strong>
    </div>
    <div class="brand">美股日報</div>
    <div class="clock">
      <span>REPORT DATE</span>
      <strong>${escapeHtml(formatChineseDate(p.date))}</strong>
    </div>
  </header>
  <section class="cover">
    <div class="cover-copy">
      <p class="rubric">DAILY BROADSHEET / NEW YORK SESSION</p>
      <h1>${escapeHtml(p.title)}</h1>
      <p class="one-line">${escapeHtml(p.oneLine)}</p>
    </div>
    <aside class="scoreboard" aria-label="Headline market tape">
      ${p.indices.slice(0, 3).map(renderScoreMetric).join("")}
    </aside>
  </section>
  <section class="tape-board" aria-label="Market tape">
    <div class="tape-title"><span>MARKET TAPE</span><strong>指數 / 資產 / 巨頭</strong></div>
    <div class="tape-lines">
      <div class="tape-line">${p.indices.map(renderTapeMetric).join("")}</div>
      <div class="tape-line">${p.assets.map(renderTapeMetric).join("")}</div>
      <div class="tape-line mega-tape">${p.megaCaps.map(renderMegaTape).join("")}</div>
    </div>
  </section>
  <section class="stock-news-strip">
    <div class="section-label">
      <span>STOCK NEWS</span>
      <strong>個股新聞</strong>
    </div>
    <div class="stock-news-grid">${p.stockNews.length ? p.stockNews.map(renderStockNewsCard).join("") : `<article class="stock-news-empty">暫無符合條件的個股新聞。</article>`}</div>
  </section>
  <section class="lead-stories">
    <div class="section-label">
      <span>THREE LEADS</span>
      <strong>今日三條主線</strong>
    </div>
    <div class="lead-grid">${p.stories.map(renderLeadStory).join("")}</div>
  </section>
  <section class="next-watch">
    <div class="section-label">
      <span>EVENT CALENDAR</span>
      <strong>重要行事曆</strong>
    </div>
    <div class="calendar-list">${p.calendar.map(renderCalendarEvent).join("") || "<p>暫無可解析的重要事件。</p>"}</div>
  </section>
  <footer class="sheet-footer">${p.footer.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</footer>`;
}

function posterExportScript(): string {
  return `
(() => {
  const dock = document.querySelector(".export-dock");
  const poster = document.querySelector(".poster");
  if (!dock || !poster) return;
  const status = dock.querySelector("[data-export-status]");
  const date = dock.getAttribute("data-export-date") || "daily";
  const setStatus = (text) => {
    if (!status) return;
    status.textContent = text;
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
      if (status) status.textContent = "READY";
    }, 2600);
  };
  const loadHtml2Canvas = () => new Promise((resolve, reject) => {
    if (window.html2canvas) {
      resolve(window.html2canvas);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    script.async = true;
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(new Error("html2canvas load failed"));
    document.head.appendChild(script);
  });
  const renderCanvas = async () => {
    setStatus("RENDERING");
    dock.classList.add("is-exporting");
    document.body.classList.add("poster-exporting");
    const html2canvas = await loadHtml2Canvas();
    await document.fonts?.ready;
    window.scrollTo({ top: 0, behavior: "instant" });
    const canvas = await html2canvas(poster, {
      backgroundColor: null,
      scale: Math.min(3, Math.max(2, window.devicePixelRatio || 2)),
      useCORS: true,
      logging: false,
      windowWidth: Math.max(document.documentElement.clientWidth, poster.scrollWidth),
      windowHeight: Math.max(document.documentElement.clientHeight, poster.scrollHeight)
    });
    document.body.classList.remove("poster-exporting");
    dock.classList.remove("is-exporting");
    return canvas;
  };
  const canvasToBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1));
  const downloadBlob = (blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "us-market-daily-" + date + ".png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  dock.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-export-action]");
    if (!button || button.disabled) return;
    const action = button.getAttribute("data-export-action");
    try {
      if (action === "print-pdf") {
        setStatus("PRINT");
        const printUrl = new URL(window.location.origin + "/daily/print");
        printUrl.searchParams.set("date", date);
        printUrl.searchParams.set("autoprint", "1");
        window.open(printUrl.toString(), "_blank", "noopener,noreferrer");
        return;
      }
      const canvas = await renderCanvas();
      const blob = await canvasToBlob(canvas);
      if (!blob) throw new Error("PNG blob failed");
      if (action === "copy-image") {
        if (!navigator.clipboard || !window.ClipboardItem) {
          downloadBlob(blob);
          setStatus("DOWNLOADED");
          return;
        }
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setStatus("COPIED");
        return;
      }
      downloadBlob(blob);
      setStatus("DOWNLOADED");
    } catch (error) {
      document.body.classList.remove("poster-exporting");
      dock.classList.remove("is-exporting");
      console.error(error);
      setStatus("FAILED");
    }
  });
})();
`;
}

function renderCalendarEvent(item: PosterCalendarEvent): string {
  const date = parseCalendarDateParts(item.date);
  return `<article class="calendar-event ${item.kind}">
    <div class="calendar-page">
      <span>${escapeHtml(date.month)}</span>
      <strong>${escapeHtml(date.day)}</strong>
      <em>${escapeHtml(date.time)}</em>
    </div>
    <div class="calendar-copy">
      <span>${escapeHtml(item.label)}</span>
      <p>${escapeHtml(item.title)}</p>
    </div>
  </article>`;
}

function parseCalendarDateParts(value: string): { month: string; day: string; time: string } {
  const chinese = value.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:\s*(.*))?/);
  if (chinese) {
    return {
      month: `${Number(chinese[2])}月`,
      day: String(Number(chinese[3])).padStart(2, "0"),
      time: chinese[4]?.trim() || "ALL DAY",
    };
  }

  const english = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:\s+(.*))?$/);
  if (english) {
    return {
      month: english[1].slice(0, 3).toUpperCase(),
      day: String(Number(english[2])).padStart(2, "0"),
      time: english[3]?.trim() || "ALL DAY",
    };
  }

  return { month: "DATE", day: "--", time: value || "待公布" };
}

function renderScoreMetric(item: PosterMetric): string {
  return `<article class="score ${item.trend}">
    <span>${escapeHtml(item.label)}</span>
    <strong>${escapeHtml(item.change)}</strong>
    <em>${escapeHtml(item.value)}</em>
    ${renderSparkline(item.history, item.trend, "score-chart")}
  </article>`;
}

function renderTapeMetric(item: PosterMetric): string {
  return `<article class="tape-item ${item.trend}">
    <span>${escapeHtml(item.label)}</span>
    <strong>${escapeHtml(item.value)}</strong>
    <em>${escapeHtml(item.change)}</em>
    ${renderSparkline(item.history, item.trend, "mini-chart")}
  </article>`;
}

function renderMegaTape(item: PosterMegaCap): string {
  return `<article class="tape-item mega-tape-item ${item.trend}">
    <span>${escapeHtml(item.ticker)}</span>
    <strong>${escapeHtml(item.price)}</strong>
    <em>${escapeHtml(item.change)}</em>
    ${renderSparkline(item.history, item.trend, "mini-chart")}
  </article>`;
}

function renderSparkline(points: number[], trend: Trend, className: string): string {
  const path = buildSparklinePath(points, 148, 44);
  if (!path) {
    return `<svg class="${className} empty" viewBox="0 0 148 44" role="img" aria-label="No price history"><path d="M4 36 L144 36"/></svg>`;
  }
  const areaPath = `${path.line} L144 42 L4 42 Z`;
  return `<svg class="${className} ${trend}" viewBox="0 0 148 44" role="img" aria-label="Recent price trend">
    <path class="spark-area" d="${areaPath}"></path>
    <path class="spark-line" d="${path.line}"></path>
    <circle class="spark-dot" cx="${path.lastX}" cy="${path.lastY}" r="2.8"></circle>
  </svg>`;
}

function buildSparklinePath(points: number[], width: number, height: number): { line: string; lastX: number; lastY: number } | null {
  const values = points.filter((point) => Number.isFinite(point));
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const paddingX = 4;
  const paddingY = 5;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;
  const coords = values.map((value, index) => {
    const x = paddingX + (innerWidth * index) / (values.length - 1);
    const y = paddingY + innerHeight - ((value - min) / range) * innerHeight;
    return { x: roundCoord(x), y: roundCoord(y) };
  });
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
  const last = coords[coords.length - 1];
  return { line, lastX: last.x, lastY: last.y };
}

function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

function renderLeadStory(item: PosterStory, index: number): string {
  const summary = item.summary.trim();
  const sourceLine = formatStorySourceLine(item);
  const sourceMarkup = renderSourceLink(item, sourceLine, "source-line");
  return `<article class="lead-story story-${index + 1}">
    <div class="story-num">${String(index + 1).padStart(2, "0")}</div>
    ${sourceMarkup}
    <h2>${renderInlineStoryLink(item, item.title)}</h2>
    ${summary ? `<p class="story-text">${escapeHtml(summary)}</p>` : ""}
    <p class="fact-pill">${escapeHtml(item.fact)}</p>
  </article>`;
}

function renderStockNewsCard(item: PosterStory, index: number): string {
  const summary = item.summary.trim();
  const sourceLine = formatStorySourceLine(item);
  return `<article class="stock-card">
    <p class="stock-card-top"><span>${String(index + 1).padStart(2, "0")}</span>${renderInlineStoryLink(item, sourceLine)}</p>
    <h3>${renderInlineStoryLink(item, item.title)}</h3>
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
    <em>${escapeHtml(item.fact)}</em>
  </article>`;
}

function renderPrintMetricCard(item: PosterMetric): string {
  return `<article class="print-metric ${item.trend}">
    <span>${escapeHtml(item.label)}</span>
    <strong>${escapeHtml(item.value)}</strong>
    <em>${escapeHtml(item.change)}</em>
    ${renderSparkline(item.history, item.trend, "score-chart")}
  </article>`;
}

function renderPrintMegaCard(item: PosterMegaCap): string {
  return `<article class="print-mega ${item.trend}">
    <span>${escapeHtml(item.label)}</span>
    <small>${escapeHtml(item.ticker)}</small>
    <strong>${escapeHtml(item.price)}</strong>
    <em>${escapeHtml(item.change)}</em>
    ${renderSparkline(item.history, item.trend, "mini-chart")}
  </article>`;
}

function renderPrintStockCard(item: PosterStory, index: number): string {
  const summary = item.summary.trim();
  const source = formatStorySourceLine(item);
  return `<article class="print-stock-card">
    <p class="print-card-kicker">${String(index + 1).padStart(2, "0")} · ${escapeHtml(source)}</p>
    <h3>${renderInlineStoryLink(item, item.title)}</h3>
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
    <em>${escapeHtml(item.fact)}</em>
  </article>`;
}

function renderPrintLeadCard(item: PosterStory, index: number): string {
  const summary = item.summary.trim();
  const source = formatStorySourceLine(item);
  return `<article class="print-lead-card">
    <p class="print-card-kicker">${String(index + 1).padStart(2, "0")} · ${escapeHtml(source)}</p>
    <h3>${renderInlineStoryLink(item, item.title)}</h3>
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
    <em>${escapeHtml(item.fact)}</em>
  </article>`;
}

function renderPrintCalendarCard(item: PosterCalendarEvent): string {
  return `<article class="print-calendar-card ${item.kind}">
    <span>${escapeHtml(item.label)}</span>
    <strong>${escapeHtml(item.date)}</strong>
    <p>${escapeHtml(item.title)}</p>
  </article>`;
}

function renderSourceLink(item: PosterStory, label: string, className: string): string {
  if (!item.url) {
    return `<p class="${className}">${escapeHtml(label)}</p>`;
  }
  return `<p class="${className}"><a href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`;
}

function renderInlineStoryLink(item: PosterStory, label: string): string {
  if (!item.url) {
    return escapeHtml(label);
  }
  return `<a href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function formatChineseDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function formatStorySourceLine(item: PosterStory): string {
  const source = item.source || "source pending";
  return item.publishedDateNy ? `${source} · 美東 ${item.publishedDateNy}` : source;
}

function printPageCss(): string {
  return `:root{--paper:#fffdf9;--ink:#171410;--muted:#6f675c;--rule:#d8d1c5;--hair:#ebe4d8;--red:#a82022;--blue:#184f86;--up:#148a4a;--down:#c43b3b;--gold:#b9852d;--mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono TC",monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;--serif:"Times New Roman","Noto Serif TC",serif}*{box-sizing:border-box}html,body{margin:0;background:#f3efe7;color:var(--ink);font-family:var(--sans)}.print-sheet{max-width:980px;margin:0 auto;padding:28px 24px 40px;background:linear-gradient(180deg,#fffdf9,#fbf7ee)}.print-header{padding-bottom:16px;border-bottom:2px solid var(--rule)}.eyebrow{margin:0 0 8px;color:var(--red);font-family:var(--mono);font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.print-header h1{margin:0;font-family:var(--serif);font-size:48px;line-height:.95;letter-spacing:-.08em}.print-date{margin:10px 0 0;color:var(--muted);font-family:var(--mono);font-size:13px}.print-one-line{margin:14px 0 0;max-width:760px;padding-left:12px;border-left:4px solid var(--red);font-size:18px;line-height:1.5;font-weight:700}.print-section{margin-top:22px}.print-section h2{margin:0 0 10px;font-size:22px;letter-spacing:-.04em}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.print-metric,.print-mega,.print-stock-card,.print-lead-card,.print-calendar-card,.print-empty{border:1px solid var(--rule);background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,248,235,.78));padding:12px;box-shadow:inset 0 -6px 0 rgba(23,20,16,.025)}.print-metric span,.print-mega span,.print-card-kicker,.print-calendar-card span{display:block;color:var(--muted);font-family:var(--mono);font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.print-metric strong,.print-mega strong{display:block;margin-top:6px;font-family:var(--mono);font-size:24px;line-height:1}.print-metric em,.print-mega em{display:block;margin-top:6px;font-style:normal;font-family:var(--mono);font-size:13px;font-weight:900}.print-metric.up em,.print-mega.up em{color:var(--up)}.print-metric.down em,.print-mega.down em{color:var(--down)}.print-metric.up .score-chart,.print-mega.up .mini-chart{color:var(--up)}.print-metric.down .score-chart,.print-mega.down .mini-chart{color:var(--down)}.print-metric.flat .score-chart,.print-mega.flat .mini-chart{color:var(--gold)}.print-metric.na .score-chart,.print-mega.na .mini-chart{color:#8a8378}.score-chart,.mini-chart{display:block;width:100%;overflow:visible}.score-chart{height:34px;margin-top:10px}.mini-chart{height:28px;margin-top:8px}.spark-line,.spark-area,.spark-dot{vector-effect:non-scaling-stroke}.spark-line{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.score-chart .spark-line{stroke-width:2.8}.spark-area{fill:currentColor;opacity:.14}.spark-dot{fill:currentColor}.score-chart.empty path,.mini-chart.empty path{fill:none;stroke:currentColor;stroke-width:1.4;stroke-dasharray:4 5;opacity:.45}.mega-grid-print{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.print-mega small{display:block;margin-top:4px;color:var(--muted);font-family:var(--mono);font-size:11px}.print-stock-grid,.print-calendar-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.print-stock-card h3,.print-lead-card h3{margin:8px 0 8px;font-size:24px;line-height:1.14;letter-spacing:-.05em}.print-stock-card p:not(.print-card-kicker),.print-lead-card p:not(.print-card-kicker),.print-calendar-card p{margin:0;color:#413c35;font-size:14px;line-height:1.55}.print-stock-card em,.print-lead-card em{display:block;margin-top:10px;padding-top:8px;border-top:1px solid var(--hair);color:var(--blue);font-style:normal;font-family:var(--mono);font-size:11px;font-weight:800}.print-story-list{display:grid;gap:12px}.print-lead-card h3{font-size:28px}.print-calendar-card strong{display:block;margin:8px 0 6px;font-family:var(--mono);font-size:16px}.print-calendar-card.earnings span{color:#7b5214}.print-footer{display:flex;gap:8px 18px;flex-wrap:wrap;margin-top:22px;padding-top:12px;border-top:1px solid var(--rule);color:var(--muted);font-family:var(--mono);font-size:10px;line-height:1.45}a{color:inherit;text-decoration:none}@media print{@page{size:A4 portrait;margin:12mm}html,body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-sheet{max-width:none;margin:0;padding:0}.print-section,.print-stock-card,.print-lead-card,.print-calendar-card,.print-metric,.print-mega{break-inside:avoid-page;page-break-inside:avoid}}`;
}

function posterCss(): string {
  return `:root{--paper:#fafaf7;--panel:#fff;--warm:#f5f3ee;--ink:#1a1a1a;--ink-mid:#4a4a4a;--ink-soft:#888;--rule:#dddad2;--rule-strong:#c9c4b9;--up:#3d7a50;--down:#b04040;--accent:#b8860b;--accent-soft:#f5edd8;--mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono TC",monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--rule);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.5}.poster{width:1080px;min-height:1350px;margin:0 auto;background:var(--paper);overflow:hidden}.mast{background:var(--ink);padding:10px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px}.mast-l{display:flex;align-items:baseline;gap:12px;min-width:0}.mast-title{font-family:var(--mono);font-size:13px;font-weight:700;letter-spacing:.06em;color:#fff}.mast-code{font-family:var(--mono);font-size:13px;font-weight:700;letter-spacing:.06em;color:var(--accent)}.mast-sub{font-family:var(--mono);font-size:9px;color:rgba(255,255,255,.42);letter-spacing:.1em;text-transform:uppercase}.mast-r{font-family:var(--mono);font-size:10px;color:rgba(255,255,255,.42);letter-spacing:.06em;text-align:right}.mast-r strong{color:var(--accent);font-weight:600}.hero{padding:34px 38px 24px;background:var(--paper);border-bottom:1px solid var(--rule)}.kicker{margin:0 0 12px;font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--ink-soft);text-transform:uppercase}.hero h1,.blocked h1{margin:0 0 12px;font-size:54px;line-height:1.02;font-weight:850;letter-spacing:-.03em;color:var(--ink)}.lede{max-width:830px;margin:0;color:var(--ink-mid);font-size:20px;font-weight:600}.section-row{display:grid;grid-template-columns:1fr 1fr;gap:2px;background:var(--rule);border-bottom:2px solid var(--rule)}.panel{background:var(--panel);border-top:1px solid var(--rule);overflow:hidden}.metric-panel{min-width:0}.section-heading{display:flex;justify-content:space-between;align-items:baseline;padding:13px 18px 10px;border-bottom:1px solid var(--rule)}h2{margin:0;font-size:17px;font-weight:800;color:var(--ink);letter-spacing:.01em}.section-heading span{font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--ink-soft)}.metrics{display:grid}.indices{grid-template-columns:repeat(5,1fr)}.assets{grid-template-columns:repeat(3,1fr)}.metric,.mega{min-width:0;padding:16px 14px;border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);background:var(--panel)}.metric:nth-child(5),.assets .metric:nth-child(3n),.mega:last-child{border-right:0}.assets .metric:nth-last-child(-n+3),.indices .metric{border-bottom:0}.label{margin:0 0 9px;color:var(--ink-mid);font-family:var(--mono);font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.value{margin:0 0 8px;color:var(--ink);font-family:var(--mono);font-size:27px;line-height:1;font-weight:800;letter-spacing:-.03em}.change{margin:0;font-family:var(--mono);font-size:20px;line-height:1;font-weight:800}.up .change{color:var(--up)}.down .change{color:var(--down)}.na .change,.na .value{color:var(--ink-soft)}.mega-grid{display:grid;grid-template-columns:repeat(7,1fr)}.mega{padding:15px 11px}.mega .label{font-family:var(--sans);font-size:13px;color:var(--ink);font-weight:700}.ticker{margin:0 0 14px;font-family:var(--mono);font-size:12px;color:var(--ink-soft)}.mega .value{font-size:20px}.mega .change{font-size:17px}.content-grid{display:grid;grid-template-columns:1.55fr .75fr;gap:2px;background:var(--rule);border-top:2px solid var(--rule);border-bottom:2px solid var(--rule)}.story-grid{display:grid;grid-template-columns:1fr}.story{display:grid;grid-template-columns:34px 1fr;column-gap:12px;min-height:132px;padding:17px 18px;border-bottom:1px solid var(--rule);background:var(--panel)}.story:last-child{border-bottom:0}.badge{grid-row:1/4;width:24px;height:24px;margin:1px 0 0;border:1px solid var(--rule-strong);border-radius:50%;color:var(--accent);text-align:center;font-family:var(--mono);font-size:12px;font-weight:800;line-height:22px}.story h3{margin:0 0 7px;color:var(--ink);font-size:17px;line-height:1.28;font-weight:800}.story p{margin:0 0 8px;color:var(--ink-mid);font-size:14px;line-height:1.42}.story .fact{margin:0;padding-top:8px;border-top:1px solid var(--rule);color:#7a5a10;font-family:var(--mono);font-size:13px;font-weight:800}.watchlist{margin:0;padding:0;list-style:none;counter-reset:item}.watchlist li{counter-increment:item;position:relative;min-height:104px;padding:17px 16px 17px 46px;border-bottom:1px solid var(--rule);color:var(--ink-mid);font-size:14px;line-height:1.45}.watchlist li:last-child{border-bottom:0}.watchlist li:before{content:counter(item);position:absolute;left:16px;top:18px;width:22px;height:22px;border-radius:50%;background:var(--accent-soft);color:#7a5a10;text-align:center;font-family:var(--mono);font-size:12px;font-weight:800;line-height:22px}footer{padding:14px 20px;background:var(--paper);color:var(--ink-soft);font-family:var(--mono);font-size:11px;line-height:1.55}.blocked{min-height:100vh;padding:80px 48px;background:var(--panel)}.notice{margin:24px 0;padding:18px 20px;border:1px solid #e6b8b1;border-left:4px solid var(--down);background:#fff5f4;color:#7a2218;font-size:20px;font-weight:700}.blocked dl{display:grid;grid-template-columns:260px 1fr;gap:10px;font-family:var(--mono);font-size:14px}.blocked dt{font-weight:800}.blocked dd{margin:0;color:var(--ink-mid)}}`;
}

function posterCssV2(): string {
  return `
:root{
  --paper:#f4efe5;
  --panel:#fffaf0;
  --ink:#11100d;
  --ink-mid:#504b42;
  --ink-soft:#8a8172;
  --rule:#d8cdb8;
  --rule-strong:#a99878;
  --accent:#9b1c1f;
  --accent-soft:#ead8b8;
  --up:#197447;
  --down:#b33434;
  --mono:"IBM Plex Mono","SF Mono",Menlo,Consolas,"Noto Sans Mono TC",monospace;
  --sans:"Noto Serif TC","Songti TC","PingFang TC","Microsoft JhengHei",serif;
}
body{
  background:
    linear-gradient(90deg, rgba(17,16,13,.06) 1px, transparent 1px) 0 0/28px 28px,
    radial-gradient(circle at 20% 0%, rgba(155,28,31,.12), transparent 38%),
    #d9d0bf;
}
.poster{
  width:min(1080px,100vw);
  min-height:1350px;
  box-shadow:0 34px 90px rgba(35,25,10,.22);
  background:linear-gradient(180deg,#fbf6eb 0%,#f2ebdc 100%);
}
.mast{
  padding:14px 30px;
  border-bottom:4px solid var(--accent);
}
.mast-title,.mast-code{font-size:15px}
.mast-sub{font-size:10px;color:rgba(255,255,255,.58)}
.mast-r{max-width:360px;font-size:11px;line-height:1.35}
.hero{
  position:relative;
  padding:32px 42px 22px;
  display:grid;
  grid-template-columns:1fr 300px;
  gap:24px;
}
.hero:after{
  content:"";
  position:absolute;
  right:42px;
  bottom:22px;
  width:260px;
  height:72px;
  border-top:1px solid var(--rule-strong);
  border-bottom:1px solid var(--rule-strong);
  background:repeating-linear-gradient(90deg,rgba(17,16,13,.18) 0 1px,transparent 1px 16px);
  opacity:.35;
}
.kicker{grid-column:1/-1;margin-bottom:0;color:var(--accent);font-size:12px;font-weight:800}
.hero h1{
  margin:0;
  font-size:66px;
  letter-spacing:-.06em;
  line-height:.96;
  text-wrap:balance;
}
.lede{
  grid-column:1/-1;
  max-width:760px;
  margin-top:6px;
  font-size:22px;
  line-height:1.45;
  color:var(--ink-mid);
}
.section-row{
  grid-template-columns:1.05fr .95fr;
  gap:0;
  border-top:2px solid var(--ink);
  border-bottom:2px solid var(--ink);
}
.panel{
  border-top:0;
  background:rgba(255,250,240,.78);
}
.section-heading{
  min-height:52px;
  padding:14px 20px 11px;
  background:rgba(17,16,13,.035);
}
h2{font-size:20px;letter-spacing:-.02em}
.section-heading span{font-size:10px;color:var(--accent);font-weight:800}
.metrics{gap:0}
.indices{grid-template-columns:repeat(5,minmax(0,1fr))}
.assets{grid-template-columns:repeat(3,minmax(0,1fr))}
.metric,.mega{
  min-width:0;
  overflow:hidden;
  padding:15px 13px;
}
.label{
  font-size:11px;
  letter-spacing:-.03em;
  white-space:normal;
  min-height:30px;
}
.value{
  font-size:clamp(19px,2.3vw,28px);
  white-space:nowrap;
  letter-spacing:-.06em;
}
.change{font-size:clamp(16px,1.9vw,22px)}
.mega-grid{grid-template-columns:repeat(7,minmax(0,1fr))}
.mega .label{
  min-height:34px;
  font-size:12px;
  line-height:1.2;
}
.ticker{margin-bottom:10px;font-size:11px}
.mega .value{font-size:clamp(16px,1.9vw,21px)}
.mega .change{font-size:clamp(15px,1.7vw,18px)}
.content-grid{
  grid-template-columns:1fr;
  gap:0;
  border-top:2px solid var(--ink);
}
.story-grid{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
}
.story{
  display:block;
  position:relative;
  min-height:286px;
  padding:18px 18px 16px;
  border-right:1px solid var(--rule);
  border-bottom:0;
}
.story:last-child{border-right:0}
.badge{
  position:absolute;
  top:16px;
  right:16px;
  width:28px;
  height:28px;
  line-height:26px;
  color:#fff;
  background:var(--accent);
  border:0;
}
.story h3{
  max-width:88%;
  min-height:72px;
  margin:0 0 12px;
  font-size:21px;
  line-height:1.25;
  letter-spacing:-.04em;
  text-wrap:balance;
}
.story p{
  display:-webkit-box;
  -webkit-line-clamp:4;
  -webkit-box-orient:vertical;
  overflow:hidden;
  font-size:15px;
  line-height:1.55;
}
.story .fact{
  display:block;
  margin-top:12px;
  -webkit-line-clamp:unset;
  color:var(--accent);
  font-size:13px;
}
.story-source{
  display:block!important;
  margin-top:8px!important;
  color:var(--ink-soft)!important;
  font-family:var(--mono);
  font-size:11px!important;
  text-transform:uppercase;
  -webkit-line-clamp:1!important;
}
.watch-panel .section-heading{border-top:1px solid var(--rule)}
.watchlist{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
}
.watchlist li{
  min-height:92px;
  border-right:1px solid var(--rule);
  border-bottom:0;
  font-size:14px;
}
.watchlist li:last-child{border-right:0}
footer{
  display:flex;
  flex-wrap:wrap;
  gap:8px 18px;
  padding:16px 24px 20px;
  border-top:1px solid var(--rule);
}
footer p{margin:0}
@media (max-width:760px){
  .poster{width:100vw;min-height:100vh}
  .mast{align-items:flex-start;flex-direction:column;padding:12px 16px}
  .hero{display:block;padding:24px 18px}
  .hero:after{display:none}
  .hero h1{font-size:44px}
  .lede{font-size:18px}
  .section-row,.story-grid,.watchlist{grid-template-columns:1fr}
  .indices,.assets,.mega-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .story,.story:last-child,.watchlist li,.watchlist li:last-child{border-right:0;border-bottom:1px solid var(--rule)}
}
`;
}

function posterCssV3(): string {
  return `
:root{
  --ink:#11110f;
  --muted:#6f675c;
  --paper:#f5ead6;
  --paper-2:#fbf3e5;
  --rule:#1b1712;
  --hair:#d9c6a6;
  --red:#a82022;
  --green:#167247;
  --blue:#153c62;
  --gold:#b9852d;
  --down:#b33a32;
  --up:#167247;
  --mono:"IBM Plex Mono","SF Mono",Menlo,Consolas,"Noto Sans Mono TC",monospace;
  --serif:"Noto Serif TC","Songti TC","YuMincho","PingFang TC","Microsoft JhengHei",serif;
  --sans:"Avenir Next","Gill Sans","PingFang TC","Microsoft JhengHei",sans-serif;
}
*{box-sizing:border-box}
html{background:#221d17}
body{
  margin:0;
  min-height:100vh;
  color:var(--ink);
  font-family:var(--serif);
  background:
    radial-gradient(circle at 15% -10%, rgba(184,133,45,.24), transparent 34%),
    radial-gradient(circle at 95% 20%, rgba(168,32,34,.18), transparent 32%),
    linear-gradient(135deg,#211b14,#756858);
}
.poster{
  width:min(1080px,100vw);
  min-height:1350px;
  margin:0 auto;
  padding:28px 34px 24px;
  overflow:hidden;
  position:relative;
  background:
    linear-gradient(90deg, rgba(17,17,15,.035) 1px, transparent 1px) 0 0/18px 18px,
    linear-gradient(180deg,var(--paper-2),var(--paper));
  box-shadow:0 40px 110px rgba(0,0,0,.36);
}
.poster:before{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  opacity:.42;
  mix-blend-mode:multiply;
  background:
    radial-gradient(circle at 30% 0%, rgba(255,255,255,.55), transparent 35%),
    repeating-linear-gradient(0deg, rgba(44,33,20,.035) 0 1px, transparent 1px 5px);
}
.poster>*{position:relative}
.sheet-top{
  display:grid;
  grid-template-columns:1fr auto 1fr;
  align-items:stretch;
  gap:18px;
  border-top:8px solid var(--rule);
  border-bottom:2px solid var(--rule);
  padding:12px 0 14px;
}
.edition,.clock{
  display:flex;
  flex-direction:column;
  justify-content:space-between;
  min-height:74px;
  font-family:var(--mono);
  font-size:11px;
  letter-spacing:.08em;
  color:var(--muted);
  text-transform:uppercase;
}
.edition strong,.clock strong{
  color:var(--ink);
  font-size:24px;
  line-height:1.05;
  letter-spacing:-.08em;
  text-transform:none;
}
.clock{text-align:right}
.brand{
  align-self:center;
  min-width:340px;
  padding:6px 22px 8px;
  border-left:2px solid var(--rule);
  border-right:2px solid var(--rule);
  text-align:center;
  font-family:var(--serif);
  font-size:52px;
  line-height:.95;
  letter-spacing:-.14em;
  font-weight:950;
}
.cover{
  display:grid;
  grid-template-columns:1fr 302px;
  gap:28px;
  padding:28px 0 24px;
  border-bottom:4px double var(--rule);
}
.rubric{
  margin:0 0 12px;
  color:var(--red);
  font-family:var(--mono);
  font-size:12px;
  font-weight:900;
  letter-spacing:.16em;
}
.cover h1{
  margin:0;
  max-width:650px;
  font-size:94px;
  line-height:.88;
  letter-spacing:-.105em;
  font-weight:950;
}
.one-line{
  max-width:720px;
  margin:22px 0 0;
  padding-left:16px;
  border-left:8px solid var(--red);
  color:var(--ink);
  font-family:var(--sans);
  font-size:25px;
  line-height:1.36;
  font-weight:800;
}
.scoreboard{
  display:grid;
  grid-template-rows:repeat(3,1fr);
  border:2px solid var(--rule);
  background:#15130f;
  color:#f8edda;
}
.score{
  padding:18px 18px 16px;
  border-bottom:1px solid rgba(248,237,218,.2);
}
.score:last-child{border-bottom:0}
.score span{
  display:block;
  margin-bottom:8px;
  color:#bfb3a0;
  font-family:var(--mono);
  font-size:12px;
  letter-spacing:.08em;
  text-transform:uppercase;
}
.score strong{
  display:block;
  font-family:var(--mono);
  font-size:40px;
  line-height:.96;
  letter-spacing:-.08em;
}
.score em{
  display:block;
  margin-top:8px;
  color:#d6c7ac;
  font-family:var(--mono);
  font-size:15px;
  font-style:normal;
}
.score-chart{
  display:block;
  width:100%;
  height:46px;
  margin-top:14px;
  overflow:visible;
}
.mini-chart{
  display:block;
  width:100%;
  height:38px;
  margin-top:9px;
  overflow:visible;
}
.spark-line,.spark-area,.spark-dot{vector-effect:non-scaling-stroke}
.spark-line{
  fill:none;
  stroke:currentColor;
  stroke-width:2.2;
  stroke-linecap:round;
  stroke-linejoin:round;
}
.score-chart .spark-line{stroke-width:2.8}
.spark-area{
  fill:currentColor;
  opacity:.14;
}
.spark-dot{fill:currentColor}
.score-chart.empty path,.mini-chart.empty path{
  fill:none;
  stroke:currentColor;
  stroke-width:1.4;
  stroke-dasharray:4 5;
  opacity:.45;
}
.score.up strong,.tape-item.up em{color:var(--up)}
.score.down strong,.tape-item.down em{color:var(--down)}
.score.na strong,.score.na em,.tape-item.na strong,.tape-item.na em{color:#8a8378}
.score.up .score-chart,.tape-item.up .mini-chart{color:var(--up)}
.score.down .score-chart,.tape-item.down .mini-chart{color:var(--down)}
.score.flat .score-chart,.tape-item.flat .mini-chart{color:var(--gold)}
.score.na .score-chart,.tape-item.na .mini-chart{color:#8a8378}
.tape-board{
  display:grid;
  grid-template-columns:168px 1fr;
  gap:0;
  border-bottom:2px solid var(--rule);
}
.tape-title{
  padding:16px 12px;
  border-right:2px solid var(--rule);
  background:var(--red);
  color:#fff3df;
  writing-mode:vertical-rl;
  text-orientation:mixed;
  font-family:var(--mono);
}
.tape-title span{
  font-size:12px;
  letter-spacing:.16em;
  opacity:.7;
}
.tape-title strong{
  margin-top:18px;
  font-size:19px;
  letter-spacing:.05em;
}
.tape-lines{
  display:grid;
  grid-template-rows:repeat(3,auto);
}
.tape-line{
  display:grid;
  grid-template-columns:repeat(6,minmax(0,1fr));
  border-bottom:1px solid var(--hair);
}
.tape-line:first-child{grid-template-columns:repeat(5,minmax(0,1fr))}
.tape-line:last-child{border-bottom:0}
.mega-tape{grid-template-columns:repeat(7,minmax(0,1fr))}
.tape-item{
  min-width:0;
  padding:13px 10px 12px;
  border-right:1px solid var(--hair);
  background:rgba(255,255,255,.22);
  font-family:var(--mono);
}
.tape-item:last-child{border-right:0}
.tape-item span{
  display:block;
  min-height:28px;
  color:var(--muted);
  font-size:10px;
  line-height:1.2;
  font-weight:800;
  text-transform:uppercase;
  overflow:hidden;
}
.tape-item strong{
  display:block;
  margin-top:6px;
  color:var(--ink);
  font-size:18px;
  line-height:1;
  letter-spacing:-.07em;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.tape-item em{
  display:block;
  margin-top:7px;
  font-size:15px;
  font-style:normal;
  font-weight:900;
}
.stock-news-strip{
  padding:18px 0 0;
}
.stock-news-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  grid-auto-rows:minmax(196px,auto);
  border:2px solid var(--rule);
  background:#fff8eb;
}
.stock-card,.stock-news-empty{
  min-width:0;
  min-height:196px;
  padding:16px 15px 14px;
  border-right:1px solid var(--hair);
  border-bottom:1px solid var(--hair);
  background:
    linear-gradient(180deg,rgba(255,255,255,.45),rgba(255,255,255,0)),
    rgba(255,248,235,.62);
  overflow:hidden;
}
.stock-card:nth-child(4n){border-right:0}
.stock-card:nth-last-child(-n + 4){border-bottom:0}
.stock-card a,
.lead-story a{
  color:inherit;
  text-decoration:none;
}
.stock-card a:hover,
.lead-story a:hover{
  color:var(--red);
}
.stock-card-top{
  display:flex;
  align-items:center;
  gap:7px;
  margin:0 0 10px;
  color:var(--muted);
  font-family:var(--mono);
  font-size:9px;
  line-height:1.25;
  font-weight:850;
  letter-spacing:.06em;
  text-transform:uppercase;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.stock-card-top span{
  flex:0 0 auto;
  display:inline-grid;
  place-items:center;
  width:23px;
  height:23px;
  border:1px solid var(--rule);
  border-radius:50%;
  color:#fff8eb;
  background:var(--blue);
  font-size:10px;
}
.stock-card h3{
  margin:0 0 8px;
  color:var(--ink);
  font-size:22px;
  line-height:1.12;
  letter-spacing:-.06em;
  font-weight:950;
  display:-webkit-box;
  -webkit-box-orient:vertical;
  -webkit-line-clamp:2;
  overflow:hidden;
}
.stock-card h3 a:hover{
  color:var(--blue);
}
.stock-card p:not(.stock-card-top){
  margin:0;
  color:var(--ink-mid);
  font-family:var(--sans);
  font-size:14px;
  line-height:1.46;
  font-weight:650;
  display:-webkit-box;
  -webkit-box-orient:vertical;
  -webkit-line-clamp:3;
  overflow:hidden;
}
.stock-card em{
  display:block;
  margin-top:9px;
  padding-top:8px;
  border-top:1px solid var(--hair);
  color:var(--blue);
  font-family:var(--mono);
  font-size:10px;
  line-height:1.3;
  font-style:normal;
  font-weight:900;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.stock-news-empty{
  grid-column:1/-1;
  min-height:72px;
  color:var(--muted);
  font-family:var(--mono);
  font-weight:800;
}
.lead-stories{
  padding:24px 0 0;
}
.section-label{
  display:flex;
  align-items:center;
  gap:14px;
  margin-bottom:14px;
  font-family:var(--mono);
}
.section-label span{
  padding:5px 8px;
  background:var(--rule);
  color:#f8edda;
  font-size:11px;
  letter-spacing:.14em;
}
.section-label strong{
  color:var(--red);
  font-size:18px;
  letter-spacing:.03em;
}
.lead-grid{
  display:grid;
  grid-template-columns:1.12fr .94fr .94fr;
  border-top:3px solid var(--rule);
  border-bottom:3px solid var(--rule);
}
.lead-story{
  position:relative;
  height:430px;
  padding:24px 20px 76px;
  border-right:1px solid var(--rule);
  background:rgba(255,255,255,.18);
  overflow:hidden;
}
.lead-story:last-child{border-right:0}
.story-num{
  position:absolute;
  right:16px;
  top:12px;
  color:rgba(168,32,34,.16);
  font-family:var(--mono);
  font-size:92px;
  line-height:1;
  font-weight:950;
  letter-spacing:-.13em;
}
.source-line{
  position:relative;
  z-index:1;
  margin:0 0 18px;
  color:var(--muted);
  font-family:var(--mono);
  font-size:11px;
  font-weight:800;
  letter-spacing:.1em;
  text-transform:uppercase;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.source-line a{
  border-bottom:1px solid rgba(168,32,34,.35);
}
.lead-story h2{
  position:relative;
  z-index:1;
  margin:0 0 16px;
  height:108px;
  color:var(--ink);
  font-size:30px;
  line-height:1.08;
  letter-spacing:-.075em;
  font-weight:950;
  text-wrap:balance;
  display:-webkit-box;
  -webkit-box-orient:vertical;
  -webkit-line-clamp:3;
  overflow:hidden;
}
.story-1 h2{
  font-size:34px;
  height:118px;
}
.story-text{
  position:relative;
  z-index:1;
  margin:0;
  color:var(--ink-mid, #504b42);
  font-family:var(--sans);
  font-size:17px;
  line-height:1.62;
  font-weight:650;
  display:-webkit-box;
  -webkit-box-orient:vertical;
  -webkit-line-clamp:5;
  overflow:hidden;
}
.story-1 .story-text{
  font-size:17px;
  -webkit-line-clamp:5;
}
.fact-pill{
  position:absolute;
  left:20px;
  right:20px;
  bottom:18px;
  margin:0;
  padding:10px 12px;
  border-top:2px solid var(--red);
  background:rgba(168,32,34,.08);
  color:var(--red);
  font-family:var(--mono);
  font-size:13px;
  line-height:1.35;
  font-weight:900;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.next-watch{
  display:block;
  margin-top:18px;
  border-bottom:2px solid var(--rule);
}
.next-watch .section-label{
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin:0;
  padding:13px 16px;
  border:2px solid var(--rule);
  border-bottom:0;
  background:#171410;
  color:#f8edda;
}
.next-watch .section-label span{
  display:inline-block;
  width:auto;
  margin:0;
  background:transparent;
  padding:0;
  color:#bfb3a0;
}
.next-watch .section-label strong{
  color:#f8edda;
  writing-mode:horizontal-tb;
  font-size:19px;
}
.next-watch .calendar-list{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  margin:0;
  padding:0;
  border:2px solid var(--rule);
  background:#fff8eb;
}
.calendar-event{
  min-height:154px;
  padding:12px;
  position:relative;
  border-right:1px solid var(--hair);
  color:var(--ink);
  font-family:var(--sans);
  overflow:hidden;
  display:grid;
  grid-template-columns:76px 1fr;
  gap:12px;
  background:
    linear-gradient(180deg,rgba(255,255,255,.42),rgba(255,255,255,0)),
    #fff8eb;
}
.calendar-event:last-child{border-right:0}
.calendar-page{
  min-height:128px;
  border:2px solid var(--rule);
  background:#f8edda;
  box-shadow:inset 0 -10px 0 rgba(23,20,16,.04);
  text-align:center;
  overflow:hidden;
}
.calendar-page span{
  display:block;
  margin:0;
  padding:7px 2px 6px;
  background:var(--red);
  color:#fff8eb;
  font-family:var(--mono);
  font-size:11px;
  line-height:1;
  font-weight:950;
  letter-spacing:.14em;
}
.calendar-page strong{
  display:block;
  margin:12px 0 6px;
  color:var(--ink);
  font-family:var(--mono);
  font-size:42px;
  line-height:.9;
  font-weight:950;
  letter-spacing:-.08em;
}
.calendar-page em{
  display:block;
  padding:0 5px;
  color:var(--muted);
  font-family:var(--mono);
  font-size:10px;
  line-height:1.25;
  font-style:normal;
  font-weight:850;
  text-transform:uppercase;
}
.calendar-copy{
  min-width:0;
}
.calendar-copy span{
  display:inline-block;
  margin-bottom:9px;
  padding:4px 7px;
  background:rgba(168,32,34,.1);
  color:var(--red);
  font-family:var(--mono);
  font-size:10px;
  line-height:1;
  font-weight:900;
  letter-spacing:.08em;
}
.calendar-event.earnings .calendar-copy span{
  background:rgba(185,133,45,.16);
  color:#7b5214;
}
.calendar-event.earnings .calendar-page span{
  background:#b9852d;
}
.calendar-copy p{
  margin:0;
  color:var(--ink);
  font-size:12.5px;
  line-height:1.28;
  font-weight:850;
  overflow:visible;
}
.sheet-footer{
  display:flex;
  gap:10px 18px;
  flex-wrap:wrap;
  padding-top:14px;
  color:var(--muted);
  font-family:var(--mono);
  font-size:11px;
  line-height:1.4;
}
.blocked{
  padding:60px;
  background:var(--paper);
  min-height:100vh;
  font-family:var(--sans);
}
.blocked h1{
  margin:0;
  font-family:var(--serif);
  font-size:64px;
  letter-spacing:-.08em;
}
.blocked .notice{
  margin:24px 0;
  padding:18px;
  border-left:8px solid var(--red);
  background:#fff4e5;
  font-size:20px;
  font-weight:800;
}
.export-dock{
  position:fixed;
  right:18px;
  bottom:18px;
  z-index:50;
  display:flex;
  align-items:center;
  gap:8px;
  padding:8px;
  border:1px solid rgba(248,237,218,.22);
  border-radius:999px;
  background:rgba(17,17,15,.86);
  color:#f8edda;
  box-shadow:0 18px 50px rgba(0,0,0,.32);
  backdrop-filter:blur(16px);
  font-family:var(--mono);
}
.export-dock button{
  appearance:none;
  border:1px solid rgba(248,237,218,.2);
  border-radius:999px;
  background:#f8edda;
  color:#171410;
  padding:9px 12px;
  font-family:var(--mono);
  font-size:11px;
  font-weight:900;
  letter-spacing:.03em;
  cursor:pointer;
}
.export-dock button:hover{
  background:#fff7e8;
  transform:translateY(-1px);
}
.export-dock button:disabled{
  opacity:.45;
  cursor:not-allowed;
}
.export-dock span{
  min-width:74px;
  padding:0 8px;
  color:#cbbda7;
  font-size:10px;
  font-weight:900;
  letter-spacing:.08em;
  text-align:center;
}
.export-dock.is-exporting button{
  pointer-events:none;
  opacity:.72;
}
@media (max-width:760px){
  html,body{
    width:100%;
    overflow-x:hidden;
    background:#17120d;
  }
  body{
    background:
      radial-gradient(circle at 10% 0%, rgba(184,133,45,.22), transparent 30%),
      linear-gradient(180deg,#17120d,#3d3327 58%,#17120d);
  }
  .poster{
    width:100%;
    min-height:100svh;
    margin:0;
    padding:10px;
    box-shadow:none;
    border:0;
    background:
      linear-gradient(90deg, rgba(17,17,15,.04) 1px, transparent 1px) 0 0/14px 14px,
      linear-gradient(180deg,#fff1d8 0%,#f3dfbd 100%);
  }
  .poster:before{
    opacity:.28;
    background:
      radial-gradient(circle at 50% -8%, rgba(255,255,255,.72), transparent 32%),
      repeating-linear-gradient(0deg, rgba(44,33,20,.035) 0 1px, transparent 1px 4px);
  }
  .sheet-top{
    grid-template-columns:1fr auto;
    gap:8px;
    padding:8px 0 10px;
    border-top:5px solid var(--rule);
    border-bottom:2px solid var(--rule);
  }
  .edition,.clock{
    min-height:auto;
    font-size:9px;
    line-height:1.25;
  }
  .edition strong,.clock strong{
    margin-top:4px;
    font-size:18px;
    letter-spacing:-.06em;
  }
  .brand{
    grid-column:1/-1;
    grid-row:1;
    min-width:0;
    width:100%;
    padding:7px 8px 8px;
    border:2px solid var(--rule);
    background:rgba(255,248,235,.72);
    font-size:34px;
    letter-spacing:-.12em;
  }
  .edition{grid-column:1}
  .clock{grid-column:2;text-align:right}
  .cover{
    display:block;
    padding:16px 0 14px;
    border-bottom:3px double var(--rule);
  }
  .rubric{
    margin-bottom:8px;
    font-size:10px;
    letter-spacing:.14em;
  }
  .cover h1{
    max-width:none;
    font-size:clamp(45px,15vw,64px);
    line-height:.9;
    letter-spacing:-.105em;
  }
  .one-line{
    margin-top:14px;
    padding:10px 12px 10px 14px;
    border-left:6px solid var(--red);
    background:rgba(255,255,255,.32);
    font-size:17px;
    line-height:1.45;
  }
  .scoreboard{
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    grid-template-rows:none;
    margin-top:14px;
    border:2px solid var(--rule);
  }
  .score{
    padding:11px 8px 10px;
    border-right:1px solid rgba(248,237,218,.22);
    border-bottom:0;
  }
  .score:last-child{border-right:0}
  .score span{
    min-height:25px;
    margin-bottom:6px;
    font-size:9px;
    line-height:1.2;
  }
  .score strong{
    font-size:clamp(20px,7vw,29px);
  }
  .score em{
    margin-top:5px;
    font-size:11px;
  }
  .score-chart{
    height:26px;
    margin-top:7px;
  }
  .tape-board{
    display:block;
    margin-top:12px;
    border:2px solid var(--rule);
    border-bottom:0;
    background:rgba(255,248,235,.42);
  }
  .tape-title{
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:9px 10px;
    border-right:0;
    border-bottom:2px solid var(--rule);
    writing-mode:horizontal-tb;
  }
  .tape-title strong{
    margin:0;
    font-size:14px;
    letter-spacing:.04em;
  }
  .tape-lines{
    display:block;
  }
  .tape-line,.tape-line:first-child,.mega-tape{
    display:flex;
    grid-template-columns:none;
    overflow-x:auto;
    overscroll-behavior-x:contain;
    scroll-snap-type:x mandatory;
    border-bottom:1px solid var(--hair);
    -webkit-overflow-scrolling:touch;
  }
  .tape-line:last-child{border-bottom:0}
  .tape-line::-webkit-scrollbar,.mega-tape::-webkit-scrollbar{display:none}
  .tape-item{
    flex:0 0 38%;
    min-width:132px;
    scroll-snap-align:start;
    padding:11px 10px;
    background:rgba(255,255,255,.24);
  }
  .mega-tape .tape-item{
    flex-basis:34%;
    min-width:118px;
  }
  .tape-item span{
    min-height:24px;
    font-size:9px;
  }
  .tape-item strong{
    font-size:17px;
  }
  .tape-item em{
    font-size:14px;
  }
  .mini-chart{
    height:29px;
    margin-top:7px;
  }
  .stock-news-strip{
    padding-top:14px;
  }
  .stock-news-grid{
    display:flex;
    overflow-x:auto;
    gap:8px;
    padding:8px;
    border:2px solid var(--rule);
    background:rgba(255,248,235,.45);
    scroll-snap-type:x mandatory;
    -webkit-overflow-scrolling:touch;
  }
  .stock-news-grid::-webkit-scrollbar{display:none}
  .stock-card{
    flex:0 0 82%;
    min-height:164px;
    border:2px solid var(--rule);
    scroll-snap-align:start;
  }
  .stock-card:last-child{border-right:2px solid var(--rule)}
  .stock-news-empty{
    min-height:70px;
    border:0;
  }
  .lead-stories{
    padding-top:16px;
  }
  .section-label{
    margin-bottom:9px;
    gap:8px;
  }
  .section-label span{
    font-size:9px;
  }
  .section-label strong{
    font-size:15px;
  }
  .lead-grid{
    display:grid;
    grid-template-columns:1fr;
    gap:8px;
    border:0;
  }
  .lead-story{
    min-height:0;
    height:auto;
    padding:17px 14px 62px;
    border:2px solid var(--rule);
    background:
      linear-gradient(135deg,rgba(255,255,255,.4),rgba(255,255,255,.08)),
      rgba(255,248,235,.48);
    box-shadow:inset 0 -8px 0 rgba(17,17,15,.025);
  }
  .lead-story + .lead-story{
    margin-top:0;
  }
  .story-num{
    right:10px;
    top:6px;
    font-size:58px;
    opacity:.85;
  }
  .source-line{
    max-width:78%;
    margin-bottom:10px;
    font-size:9px;
    letter-spacing:.08em;
  }
  .lead-story h2,.story-1 h2{
    height:auto;
    min-height:0;
    margin-bottom:10px;
    padding-right:44px;
    font-size:clamp(24px,7.5vw,31px);
    line-height:1.08;
    -webkit-line-clamp:4;
  }
  .story-text,.story-1 .story-text{
    font-size:14.5px;
    line-height:1.52;
    -webkit-line-clamp:4;
  }
  .fact-pill{
    left:14px;
    right:14px;
    bottom:12px;
    padding:8px 9px;
    font-size:11px;
  }
  .next-watch{
    margin-top:14px;
    border-bottom:0;
  }
  .next-watch .section-label{
    padding:10px 11px;
    border:2px solid var(--rule);
    border-bottom:0;
  }
  .next-watch .section-label strong{
    font-size:15px;
    writing-mode:horizontal-tb;
  }
  .next-watch .calendar-list{
    display:grid;
    grid-template-columns:1fr;
    gap:8px;
    padding:8px;
    border:2px solid var(--rule);
    background:rgba(255,248,235,.45);
  }
  .calendar-event{
    min-height:0;
    grid-template-columns:64px 1fr;
    gap:10px;
    padding:10px;
    border:1px solid var(--hair);
  }
  .calendar-page{
    min-height:98px;
  }
  .calendar-page span{
    padding:6px 2px 5px;
    font-size:9px;
  }
  .calendar-page strong{
    margin:10px 0 4px;
    font-size:32px;
  }
  .calendar-page em{
    font-size:8px;
  }
  .calendar-copy span{
    margin-bottom:7px;
    font-size:9px;
  }
  .calendar-copy p{
    font-size:12px;
    line-height:1.35;
  }
  .sheet-footer{
    padding:12px 2px 4px;
    font-size:9.5px;
  }
  .export-dock{
    left:10px;
    right:10px;
    bottom:10px;
    justify-content:space-between;
    gap:5px;
    border-radius:18px;
    padding:7px;
  }
  .export-dock button{
    flex:1;
    padding:10px 7px;
    font-size:10px;
  }
  .export-dock span{
    display:none;
  }
  .blocked{
    padding:28px 18px;
  }
  .blocked h1{
    font-size:42px;
  }
}
@media print{
  @page{size:A4 portrait;margin:12mm}
  html,body{
    width:auto!important;
    min-height:auto!important;
    margin:0!important;
    background:#fff!important;
    overflow:visible!important;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  .export-dock{display:none!important}
  .poster{
    width:auto!important;
    min-height:auto!important;
    margin:0!important;
    padding:0!important;
    background:#fff!important;
    box-shadow:none!important;
    overflow:visible!important;
  }
  .poster:before{display:none!important}
  .sheet-top{
    display:block;
    padding:0 0 10px;
    border-top:0;
    border-bottom:1px solid var(--rule);
  }
  .edition,
  .clock{
    display:block;
    min-height:0;
    font-size:10px;
    line-height:1.35;
  }
  .clock{
    margin-top:6px;
    text-align:left;
  }
  .edition strong,
  .clock strong{
    font-size:18px;
    letter-spacing:-.04em;
  }
  .brand{
    min-width:0;
    margin:8px 0;
    padding:0;
    border:0;
    text-align:left;
    font-size:34px;
    letter-spacing:-.08em;
  }
  .cover{
    display:block;
    padding:12px 0;
    border-bottom:1px solid var(--rule);
  }
  .rubric{
    margin-bottom:6px;
    font-size:10px;
  }
  .cover h1{
    max-width:none;
    font-size:52px;
    line-height:.94;
    letter-spacing:-.08em;
  }
  .one-line{
    max-width:none;
    margin-top:12px;
    padding-left:10px;
    border-left:4px solid var(--red);
    font-size:16px;
    line-height:1.45;
  }
  .scoreboard{
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    grid-template-rows:none;
    margin-top:12px;
    border:1px solid var(--rule);
  }
  .score{
    padding:10px;
    border-right:1px solid var(--hair);
    border-bottom:0;
  }
  .score:last-child{border-right:0}
  .score span{
    min-height:0;
    margin-bottom:5px;
    font-size:9px;
  }
  .score strong{
    font-size:24px;
  }
  .score em{
    margin-top:5px;
    font-size:11px;
  }
  .score-chart{
    height:24px;
    margin-top:8px;
  }
  .tape-board{
    display:block;
    margin-top:12px;
    border-bottom:0;
  }
  .tape-title{
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:8px 10px;
    border-right:0;
    border-bottom:1px solid var(--rule);
    writing-mode:horizontal-tb;
    text-orientation:mixed;
  }
  .tape-title strong{
    margin-top:0;
    font-size:14px;
  }
  .tape-lines{
    display:grid;
    gap:8px;
    margin-top:8px;
  }
  .tape-line,
  .tape-line:first-child,
  .mega-tape{
    grid-template-columns:repeat(3,minmax(0,1fr));
    border:1px solid var(--hair);
  }
  .tape-item{
    padding:9px 8px;
  }
  .tape-item span{
    min-height:0;
    font-size:9px;
  }
  .tape-item strong{
    font-size:15px;
  }
  .tape-item em{
    font-size:12px;
  }
  .mini-chart{
    height:24px;
    margin-top:6px;
  }
  .sheet-top,
  .cover,
  .tape-board,
  .stock-news-strip,
  .lead-stories,
  .next-watch,
  .sheet-footer{
    break-inside:avoid-page;
    page-break-inside:avoid;
  }
  .stock-news-grid{
    grid-template-columns:repeat(2,minmax(0,1fr));
    grid-auto-rows:auto;
    gap:8px;
    border:0;
    background:transparent;
  }
  .stock-card,
  .stock-news-empty{
    min-height:0;
    border:1px solid var(--hair);
    break-inside:avoid-page;
    page-break-inside:avoid;
  }
  .stock-card h3,
  .stock-card p:not(.stock-card-top),
  .stock-card em,
  .lead-story h2,
  .story-text,
  .fact-pill{
    display:block;
    overflow:visible!important;
    white-space:normal!important;
    text-overflow:clip!important;
    -webkit-line-clamp:unset!important;
  }
  .stock-card:nth-child(4n){border-right:1px solid var(--hair)}
  .stock-card:nth-last-child(-n + 4){border-bottom:1px solid var(--hair)}
  .lead-grid{
    grid-template-columns:1fr;
    gap:10px;
    border-top:0;
    border-bottom:0;
  }
  .lead-story{
    height:auto;
    min-height:0;
    padding:16px;
    border:1px solid var(--rule);
    break-inside:avoid-page;
    page-break-inside:avoid;
  }
  .story-num{
    position:static;
    display:block;
    margin-bottom:4px;
    font-size:28px;
    opacity:.35;
  }
  .source-line{
    max-width:none;
    margin-bottom:8px;
    font-size:9px;
  }
  .lead-story h2{
    height:auto;
    margin-bottom:8px;
    padding-right:0;
    font-size:22px;
    line-height:1.14;
    text-wrap:wrap;
  }
  .story-1 h2{
    font-size:24px;
    height:auto;
  }
  .story-text{
    font-size:13px;
    line-height:1.5;
  }
  .fact-pill{
    position:static;
    margin-top:12px;
    padding:8px 10px;
    border-top:1px solid var(--red);
    font-size:11px;
  }
  .next-watch .calendar-list{
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:8px;
    border:0;
    background:transparent;
  }
  .calendar-event{
    min-height:0;
    border:1px solid var(--hair);
    break-inside:avoid-page;
    page-break-inside:avoid;
  }
  .calendar-page{
    min-height:92px;
  }
  .calendar-page strong{
    font-size:28px;
  }
  .sheet-footer{
    padding-top:10px;
    font-size:9px;
  }
}
`;
}

function renderPosterSvg(payload: PosterPayload): string {
  const p = payload.poster;
  const lines = renderPosterText(payload).split("\n").slice(0, 38);
  const text = lines.map((line, index) => `<text x="48" y="${70 + index * 31}" font-size="${index === 0 ? 42 : 22}" font-weight="${index === 0 ? 900 : 600}" fill="#111">${escapeXml(line)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="${escapeXml(p.title)}">
  <rect width="1080" height="1350" fill="#F7F5EF"/>
  ${text}
</svg>`;
}

function renderPosterMarkdown(payload: PosterPayload): string {
  const p = payload.poster;
  return `# ${p.title}｜${p.date}

${payload.canRender ? p.oneLine : payload.marketDataStatus.message}

## 三大指數
${p.indices.map((item) => `- ${item.label}｜${item.value}｜${item.change}`).join("\n")}

## 關鍵資產
${p.assets.map((item) => `- ${item.label}｜${item.value}｜${item.change}`).join("\n")}

## Mega Cap
${p.megaCaps.map((item) => `- ${item.label} (${item.ticker})｜${item.price}｜${item.change}`).join("\n")}

## 個股新聞
${p.stockNews.map((item, index) => {
  const summary = item.summary.trim();
  return summary
    ? `${index + 1}. ${item.title}｜${summary}｜${item.fact}`
    : `${index + 1}. ${item.title}｜${item.fact}`;
}).join("\n") || "N/A"}

## 今日三條主線
${p.stories.map((item, index) => {
  const summary = item.summary.trim();
  return summary
    ? `${index + 1}. ${item.title}｜${summary}｜${item.fact}`
    : `${index + 1}. ${item.title}｜${item.fact}`;
}).join("\n")}

## 明日觀察
${p.watchlist.map((item, index) => `${index + 1}. ${item}`).join("\n")}

${p.footer.join("\n")}`;
}

function renderPosterText(payload: PosterPayload): string {
  return renderPosterMarkdown(payload)
    .replace(/^#+\s?/gm, "")
    .replace(/^- /gm, "");
}

function calendarCss(): string {
  return `
:root{
  --paper:#f4efe5;
  --ink:#171410;
  --muted:#766d5f;
  --rule:#211d17;
  --hair:#d8cbb5;
  --red:#a82022;
  --gold:#b9852d;
  --mono:"IBM Plex Mono","SF Mono",Menlo,Consolas,monospace;
  --sans:"Avenir Next","PingFang TC","Noto Sans TC",sans-serif;
  --serif:Georgia,"Noto Serif TC",serif;
}
*{box-sizing:border-box}
body{
  margin:0;
  background:#171410;
  color:var(--ink);
  font-family:var(--sans);
}
.calendar-sheet{
  width:min(1180px,100%);
  margin:0 auto;
  min-height:100vh;
  padding:34px;
  background:
    radial-gradient(circle at 88% 0%,rgba(185,133,45,.18),transparent 30%),
    linear-gradient(135deg,rgba(255,255,255,.58),transparent 42%),
    var(--paper);
}
.calendar-hero{
  display:grid;
  grid-template-columns:1fr auto;
  gap:10px 22px;
  align-items:end;
  padding:18px 0 24px;
  border-bottom:5px solid var(--rule);
}
.calendar-hero p{
  grid-column:1 / -1;
  margin:0;
  color:var(--red);
  font-family:var(--mono);
  font-size:12px;
  font-weight:950;
  letter-spacing:.2em;
}
.calendar-hero h1{
  margin:0;
  font-family:var(--serif);
  font-size:78px;
  line-height:.92;
  letter-spacing:-.09em;
}
.calendar-hero strong{
  font-family:var(--mono);
  font-size:22px;
  letter-spacing:-.03em;
}
.calendar-board{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:18px;
  padding:24px 0;
}
.large-event{
  display:grid;
  grid-template-columns:116px 1fr;
  min-height:180px;
  border:3px solid var(--rule);
  background:#fff8eb;
  box-shadow:8px 8px 0 rgba(23,20,16,.14);
}
.date-block{
  border-right:3px solid var(--rule);
  background:#f8edda;
  text-align:center;
}
.date-block span{
  display:block;
  padding:10px 4px;
  background:var(--red);
  color:#fff8eb;
  font-family:var(--mono);
  font-size:13px;
  font-weight:950;
  letter-spacing:.16em;
}
.large-event.earnings .date-block span{background:var(--gold)}
.date-block strong{
  display:block;
  margin:20px 0 10px;
  font-family:var(--mono);
  font-size:58px;
  line-height:.86;
  letter-spacing:-.09em;
}
.date-block em{
  display:block;
  padding:0 8px;
  color:var(--muted);
  font-family:var(--mono);
  font-size:12px;
  line-height:1.25;
  font-style:normal;
  font-weight:900;
  text-transform:uppercase;
}
.event-copy{
  min-width:0;
  padding:20px 22px 18px;
}
.event-copy p{
  display:inline-block;
  margin:0 0 14px;
  padding:5px 8px;
  background:rgba(168,32,34,.1);
  color:var(--red);
  font-family:var(--mono);
  font-size:11px;
  font-weight:950;
  letter-spacing:.12em;
}
.large-event.earnings .event-copy p{
  background:rgba(185,133,45,.16);
  color:#7b5214;
}
.event-copy h2{
  margin:0;
  font-size:30px;
  line-height:1.18;
  letter-spacing:-.055em;
  font-weight:950;
}
footer{
  display:flex;
  flex-wrap:wrap;
  gap:8px 18px;
  border-top:2px solid var(--rule);
  padding-top:16px;
  color:var(--muted);
  font-family:var(--mono);
  font-size:12px;
}
@media (max-width:760px){
  .calendar-sheet{padding:20px}
  .calendar-hero{grid-template-columns:1fr}
  .calendar-hero h1{font-size:56px}
  .calendar-board{grid-template-columns:1fr}
  .large-event{grid-template-columns:92px 1fr}
  .event-copy h2{font-size:22px}
}
`;
}

function resolvePosterReportDate(requestUrl: URL): string | null {
  const date = requestUrl.searchParams.get("date");
  if (!date) return getDefaultPosterDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === date ? date : null;
}

function resolvePosterFormat(requestUrl: URL): "json" | "html" | "print" | "calendar" | "svg" | "md" | "txt" {
  if (requestUrl.pathname === "/daily/print" || requestUrl.pathname === "/daily/print.html" || requestUrl.pathname === "/daily/us-print" || requestUrl.pathname === "/daily/us-print.html") return "print";
  if (requestUrl.pathname === "/daily/calendar" || requestUrl.pathname === "/daily/us-calendar" || requestUrl.pathname === "/daily/us-calendar.html") return "calendar";
  if (requestUrl.pathname === "/daily" || requestUrl.pathname.endsWith(".html")) return "html";
  if (requestUrl.pathname.endsWith(".html")) return "html";
  if (requestUrl.pathname.endsWith(".svg")) return "svg";
  if (requestUrl.pathname.endsWith(".md")) return "md";
  if (requestUrl.pathname.endsWith(".txt")) return "txt";
  return "json";
}

function getDefaultPosterDate(): string {
  const newYork = getZonedDateParts(new Date(), "America/New_York");
  const taipei = getZonedDateParts(new Date(), "Asia/Taipei");
  const completed = previousWeekday(
    newYork.minutesSinceMidnight >= 17 * 60 + 30
      ? newYork.date
      : addUtcDays(newYork.date, -1),
  );
  const publishDateTaipei = addUtcDays(completed, 1);
  return (
    taipei.date > publishDateTaipei
    || (taipei.date === publishDateTaipei && taipei.minutesSinceMidnight >= 8 * 60)
  )
    ? completed
    : previousWeekday(completed);
}

function getZonedDateParts(date: Date, timeZone: string): { date: string; minutesSinceMidnight: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesSinceMidnight: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function previousWeekday(date: string): string {
  let cursor = date;
  while (true) {
    const day = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) return cursor;
    cursor = addUtcDays(cursor, -1);
  }
}

function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function textResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function formatNumber(value: number, digits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatSigned(value: number, digits: number): string {
  const formatted = formatNumber(Math.abs(value), digits);
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function trimText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function escapeXml(value: string): string {
  return escapeHtml(value).replaceAll("'", "&apos;");
}
