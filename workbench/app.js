const STORAGE_KEY = "weekly-research-workbench:v3";
const DEFAULT_LAYOUT = {
  topicsWidth: 320,
  contextWidth: 420,
};

const AVAILABLE_CATEGORIES = [
  { value: "crypto", label: "幣圈 / crypto" },
  { value: "us_stocks_macro", label: "美股 / us_stocks_macro" },
  { value: "ai", label: "AI" },
  { value: "taiwan_stocks", label: "台股 / taiwan_stocks" },
];

const state = {
  weekly: null,
  topics: [],
  mergedTopics: [],
  topicGroups: {
    bundle: [],
    cluster: [],
    fallback: [],
  },
  activeTopicTab: "bundle",
  selectedTopicKey: null,
  selectedArticleUrl: null,
  contexts: {},
  selections: {},
  availableSources: [],
  filters: loadState(),
  sort: {
    topics: "story",
    articles: "editorial",
    hideWeakTopics: false,
    selectedOnly: false,
    officialOnly: false,
    evidenceStrongOnly: false,
  },
};

const elements = {
  apiBase: document.querySelector("#api-base"),
  days: document.querySelector("#days"),
  limitPerSource: document.querySelector("#limit-per-source"),
  maxItems: document.querySelector("#max-items"),
  categoriesPicker: document.querySelector("#categories-picker"),
  categoriesSelectAll: document.querySelector("#categories-select-all"),
  categoriesSelectDefault: document.querySelector("#categories-select-default"),
  keyword: document.querySelector("#keyword"),
  sourcesPicker: document.querySelector("#sources-picker"),
  sourcesSelectAll: document.querySelector("#sources-select-all"),
  sourcesClearAll: document.querySelector("#sources-clear-all"),
  sourcesSelectDefault: document.querySelector("#sources-select-default"),
  usePrivateSignals: document.querySelector("#use-private-signals"),
  useBlockBeats: document.querySelector("#use-blockbeats"),
  useOpenNews: document.querySelector("#use-opennews"),
  useTwitterKols: document.querySelector("#use-twitter-kols"),
  controlsOverlay: document.querySelector("#controls-overlay"),
  controlsBackdrop: document.querySelector("#controls-backdrop"),
  settingsOpen: document.querySelector("#settings-open"),
  settingsClose: document.querySelector("#settings-close"),
  status: document.querySelector("#status"),
  pinnedCount: document.querySelector("#pinned-count"),
  selectionCount: document.querySelector("#selection-count"),
  topicsMeta: document.querySelector("#topics-meta"),
  articlesMeta: document.querySelector("#articles-meta"),
  contextMeta: document.querySelector("#context-meta"),
  topicsList: document.querySelector("#topics-list"),
  articlesList: document.querySelector("#articles-list"),
  contextView: document.querySelector("#context-view"),
  loadWeekly: document.querySelector("#load-weekly"),
  clearSelection: document.querySelector("#clear-selection"),
  exportJson: document.querySelector("#export-json"),
  exportMarkdown: document.querySelector("#export-markdown"),
  toggleApiBase: document.querySelector("#toggle-api-base"),
  resizeTopics: document.querySelector("#resize-topics"),
  resizeContext: document.querySelector("#resize-context"),
  topicTemplate: document.querySelector("#topic-item-template"),
  articleTemplate: document.querySelector("#article-item-template"),
  tabBundles: document.querySelector("#tab-bundles"),
  tabClusters: document.querySelector("#tab-clusters"),
  tabRaw: document.querySelector("#tab-raw"),
  topicSort: document.querySelector("#topic-sort"),
  articleSort: document.querySelector("#article-sort"),
  hideWeakTopics: document.querySelector("#hide-weak-topics"),
  selectedOnly: document.querySelector("#selected-only"),
  officialOnly: document.querySelector("#official-only"),
  evidenceStrongOnly: document.querySelector("#evidence-strong-only"),
  mergeTopics: document.querySelector("#merge-topics"),
  clearMergeSelection: document.querySelector("#clear-merge-selection"),
};

init();

function init() {
  hydrateControls();
  applyLayoutFromState();
  bindEvents();
  updateSelectionCount();
  loadSources();
}

function bindEvents() {
  elements.settingsOpen.addEventListener("click", openSettings);
  elements.settingsClose.addEventListener("click", closeSettings);
  elements.controlsBackdrop.addEventListener("click", closeSettings);
  elements.loadWeekly.addEventListener("click", handleLoadWeekly);
  elements.clearSelection.addEventListener("click", handleClearSelection);
  elements.exportJson.addEventListener("click", exportSelectionJson);
  elements.exportMarkdown.addEventListener("click", exportSelectionMarkdown);
  elements.tabBundles.addEventListener("click", () => switchTopicTab("bundle"));
  elements.tabClusters.addEventListener("click", () => switchTopicTab("cluster"));
  elements.tabRaw.addEventListener("click", () => switchTopicTab("fallback"));
  elements.topicSort.addEventListener("change", () => {
    state.sort.topics = elements.topicSort.value;
    persistControls();
    renderTopics();
  });
  elements.articleSort.addEventListener("change", () => {
    state.sort.articles = elements.articleSort.value;
    persistControls();
    renderArticles();
  });
  elements.hideWeakTopics.addEventListener("change", () => {
    state.sort.hideWeakTopics = elements.hideWeakTopics.checked;
    persistControls();
    renderTopics();
    renderArticles();
  });
  elements.selectedOnly.addEventListener("change", () => {
    state.sort.selectedOnly = elements.selectedOnly.checked;
    persistControls();
    renderArticles();
  });
  elements.officialOnly.addEventListener("change", () => {
    state.sort.officialOnly = elements.officialOnly.checked;
    persistControls();
    renderArticles();
  });
  elements.evidenceStrongOnly.addEventListener("change", () => {
    state.sort.evidenceStrongOnly = elements.evidenceStrongOnly.checked;
    persistControls();
    renderArticles();
  });
  elements.mergeTopics.addEventListener("click", handleMergeTopics);
  elements.clearMergeSelection.addEventListener("click", handleClearMergeSelection);
  elements.toggleApiBase.addEventListener("click", toggleApiBaseVisibility);
  elements.sourcesSelectAll.addEventListener("click", () => setAllSources(true));
  elements.sourcesClearAll.addEventListener("click", () => setAllSources(false));
  elements.sourcesSelectDefault.addEventListener("click", () => setDefaultSources());
  elements.categoriesSelectAll.addEventListener("click", () => setAllCategories(true));
  elements.categoriesSelectDefault.addEventListener("click", () => setDefaultCategories());
  [
    elements.usePrivateSignals,
    elements.useBlockBeats,
    elements.useOpenNews,
    elements.useTwitterKols,
  ].forEach((element) => {
    element.addEventListener("change", handleSignalToggleChange);
  });
  elements.apiBase.addEventListener("change", loadSources);
  bindResizer(elements.resizeTopics, "topics");
  bindResizer(elements.resizeContext, "context");

  [
    elements.apiBase,
    elements.days,
    elements.limitPerSource,
    elements.maxItems,
    elements.keyword,
  ].forEach((element) => {
    element.addEventListener("change", persistControls);
  });

  elements.categoriesPicker.addEventListener("change", handleCategoryPickerChange);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSettings();
    }
  });
}

function openSettings() {
  elements.controlsOverlay.hidden = false;
}

function closeSettings() {
  elements.controlsOverlay.hidden = true;
}

function hydrateControls() {
  const filters = state.filters;
  renderCategoriesPicker();
  if (!filters) {
    setDefaultCategories();
    return;
  }
  elements.apiBase.value = filters.apiBase || elements.apiBase.value;
  elements.days.value = filters.days || elements.days.value;
  elements.limitPerSource.value = filters.limitPerSource || elements.limitPerSource.value;
  elements.maxItems.value = filters.maxItems || elements.maxItems.value;
  elements.keyword.value = filters.keyword || "";
  elements.usePrivateSignals.checked = filters.usePrivateSignals ?? true;
  elements.useBlockBeats.checked = filters.useBlockBeats ?? true;
  elements.useOpenNews.checked = filters.useOpenNews ?? true;
  elements.useTwitterKols.checked = filters.useTwitterKols ?? true;
  state.selections = filters.selections || {};
  state.mergedTopics = filters.mergedTopics || [];
  state.sort = {
    topics: filters.topicSort || "story",
    articles: filters.articleSort || "editorial",
    hideWeakTopics: Boolean(filters.hideWeakTopics),
    selectedOnly: Boolean(filters.selectedOnly),
    officialOnly: Boolean(filters.officialOnly),
    evidenceStrongOnly: Boolean(filters.evidenceStrongOnly),
  };
  elements.topicSort.value = state.sort.topics;
  elements.articleSort.value = state.sort.articles;
  elements.hideWeakTopics.checked = state.sort.hideWeakTopics;
  elements.selectedOnly.checked = state.sort.selectedOnly;
  elements.officialOnly.checked = state.sort.officialOnly;
  elements.evidenceStrongOnly.checked = state.sort.evidenceStrongOnly;

  if (Array.isArray(filters.selectedCategories) && filters.selectedCategories.length > 0) {
    setCheckedCategories(filters.selectedCategories);
  } else if (typeof filters.categories === "string" && filters.categories.trim()) {
    setCheckedCategories(filters.categories.split(",").map((part) => part.trim()).filter(Boolean));
  } else {
    setDefaultCategories();
  }
  syncSignalToggleState();
}

async function loadSources() {
  const apiBase = trimSlash(elements.apiBase.value);
  if (!apiBase) {
    elements.sourcesPicker.textContent = "set api_base first";
    return;
  }

  try {
    const response = await fetch(`${apiBase}/sources`);
    if (!response.ok) {
      throw new Error(`sources failed: ${response.status}`);
    }
    const payload = await response.json();
    state.availableSources = normalizeSourcesPayload(payload);
    if (!state.filters?.selectedSources?.length) {
      state.filters = { ...(state.filters || {}), selectedSources: state.availableSources.map((s) => s.name) };
    }
    maybeBackfillTaiwanSources();
    renderSourcesPicker();
  } catch (error) {
    elements.sourcesPicker.textContent = error instanceof Error ? error.message : "failed to load sources";
  }
}

function maybeBackfillTaiwanSources() {
  const selectedCategories = getSelectedCategories();
  if (!selectedCategories.includes("taiwan_stocks")) {
    return;
  }

  const current = new Set(state.filters?.selectedSources || []);
  const taiwanSources = state.availableSources.filter((source) => source.category === "taiwan_stocks");
  const hasAnyTaiwanSelected = taiwanSources.some((source) => current.has(source.name));
  if (hasAnyTaiwanSelected) {
    return;
  }

  const defaults = taiwanSources.filter((source) => source.enabled).map((source) => source.name);
  state.filters = {
    ...(state.filters || {}),
    selectedSources: [...current, ...defaults],
  };
}

function normalizeSourcesPayload(payload) {
  const rows = [];
  const categories = payload?.categories || {};
  for (const [category, sources] of Object.entries(categories)) {
    for (const source of sources || []) {
      rows.push({
        category,
        name: source.name,
        url: source.url,
        enabled: Boolean(source.enabled),
        priority: source.priority || 0,
        sourceType: source.sourceType || "media",
      });
    }
  }
  return rows;
}

function renderSourcesPicker() {
  const selected = new Set(state.filters?.selectedSources || state.availableSources.map((s) => s.name));
  if (!state.availableSources.length) {
    elements.sourcesPicker.textContent = "no sources";
    return;
  }

  const groups = groupBy(state.availableSources, (item) => item.category);
  const html = Object.entries(groups)
    .map(([category, items]) => {
      const rows = items
        .map((source) => `
          <label class="source-pill">
            <input type="checkbox" class="source-checkbox" value="${escapeHtml(source.name)}" ${selected.has(source.name) ? "checked" : ""} />
            <span>${escapeHtml(source.name)}</span>
          </label>`)
        .join("");
      return `
        <div class="source-group">
          <div class="source-group-title">${category}</div>
          <div class="source-group-grid">${rows}</div>
        </div>`;
    })
    .join("");

  elements.sourcesPicker.innerHTML = html;
  elements.sourcesPicker.querySelectorAll('.source-checkbox').forEach((input) => {
    input.addEventListener('change', () => {
      state.filters = { ...(state.filters || {}), selectedSources: getSelectedSourceNames() };
      persistControls();
    });
  });
}

function getSelectedSourceNames() {
  const checked = Array.from(elements.sourcesPicker.querySelectorAll('.source-checkbox:checked'));
  return checked.map((input) => input.value);
}

function setAllSources(checked) {
  elements.sourcesPicker.querySelectorAll('.source-checkbox').forEach((input) => {
    input.checked = checked;
  });
  state.filters = { ...(state.filters || {}), selectedSources: getSelectedSourceNames() };
  persistControls();
}

function setDefaultSources() {
  const defaults = new Set(state.availableSources.filter((s) => s.enabled).map((s) => s.name));
  elements.sourcesPicker.querySelectorAll('.source-checkbox').forEach((input) => {
    input.checked = defaults.has(input.value);
  });
  state.filters = { ...(state.filters || {}), selectedSources: getSelectedSourceNames() };
  persistControls();
}

function renderCategoriesPicker() {
  elements.categoriesPicker.innerHTML = AVAILABLE_CATEGORIES.map(
    (category) => `
      <label class="category-pill">
        <input type="checkbox" class="category-checkbox" value="${escapeHtml(category.value)}" />
        <span>${escapeHtml(category.label)}</span>
      </label>`,
  ).join("");
}

function getSelectedCategories() {
  return Array.from(elements.categoriesPicker.querySelectorAll(".category-checkbox:checked")).map(
    (input) => input.value,
  );
}

function setCheckedCategories(values) {
  const selected = new Set(values);
  elements.categoriesPicker.querySelectorAll(".category-checkbox").forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function setAllCategories(checked) {
  elements.categoriesPicker.querySelectorAll(".category-checkbox").forEach((input) => {
    input.checked = checked;
  });
  persistControls();
}

function setDefaultCategories() {
  setCheckedCategories(["crypto", "us_stocks_macro", "ai"]);
  persistControls();
}

function handleCategoryPickerChange() {
  persistControls();
}

function handleSignalToggleChange() {
  syncSignalToggleState();
  persistControls();
}

function syncSignalToggleState() {
  const enabled = elements.usePrivateSignals.checked;
  [elements.useBlockBeats, elements.useOpenNews, elements.useTwitterKols].forEach((element) => {
    element.disabled = !enabled;
  });
}

function groupBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function persistControls() {
  const snapshot = {
    apiBase: elements.apiBase.value.trim(),
    days: elements.days.value,
    limitPerSource: elements.limitPerSource.value,
    maxItems: elements.maxItems.value,
    categories: getSelectedCategories().join(","),
    selectedCategories: getSelectedCategories(),
    keyword: elements.keyword.value,
    selectedSources: getSelectedSourceNames(),
    usePrivateSignals: elements.usePrivateSignals.checked,
    useBlockBeats: elements.useBlockBeats.checked,
    useOpenNews: elements.useOpenNews.checked,
    useTwitterKols: elements.useTwitterKols.checked,
    selections: state.selections,
    topicSort: state.sort.topics,
    articleSort: state.sort.articles,
    hideWeakTopics: state.sort.hideWeakTopics,
    selectedOnly: state.sort.selectedOnly,
    officialOnly: state.sort.officialOnly,
    evidenceStrongOnly: state.sort.evidenceStrongOnly,
    mergedTopics: state.mergedTopics,
    topicsWidth: getLayoutWidth("topics"),
    contextWidth: getLayoutWidth("context"),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function toggleApiBaseVisibility() {
  const visible = elements.apiBase.type === "text";
  elements.apiBase.type = visible ? "password" : "text";
  elements.toggleApiBase.textContent = visible ? "show" : "hide";
}

function applyLayoutFromState() {
  const savedTopics = Number(state.filters?.topicsWidth) || DEFAULT_LAYOUT.topicsWidth;
  const savedContext = Number(state.filters?.contextWidth) || DEFAULT_LAYOUT.contextWidth;
  setLayoutWidth("topics", savedTopics);
  setLayoutWidth("context", savedContext);
}

function setLayoutWidth(side, width) {
  const clamped =
    side === "topics"
      ? clamp(width, 240, 520)
      : clamp(width, 280, 640);
  document.documentElement.style.setProperty(`--${side}-width`, `${clamped}px`);
}

function getLayoutWidth(side) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${side}-width`)
    .trim()
    .replace("px", "");
  return Number(value) || (side === "topics" ? DEFAULT_LAYOUT.topicsWidth : DEFAULT_LAYOUT.contextWidth);
}

function bindResizer(element, side) {
  if (!element) return;

  element.addEventListener("dblclick", () => {
    setLayoutWidth(side, side === "topics" ? DEFAULT_LAYOUT.topicsWidth : DEFAULT_LAYOUT.contextWidth);
    persistControls();
  });

  element.addEventListener("pointerdown", (event) => {
    if (window.innerWidth <= 1200) return;
    event.preventDefault();
    element.classList.add("is-dragging");
    element.setPointerCapture(event.pointerId);

    const onMove = (moveEvent) => {
      const viewportWidth = window.innerWidth - 16;
      if (side === "topics") {
        setLayoutWidth("topics", moveEvent.clientX - 8);
      } else {
        setLayoutWidth("context", viewportWidth - moveEvent.clientX - 8);
      }
    };

    const onUp = () => {
      element.classList.remove("is-dragging");
      element.releasePointerCapture?.(event.pointerId);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
      persistControls();
    };

    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function handleLoadWeekly() {
  setStatus("loading /weekly ...");
  persistControls();

  try {
    const selectedCategories = getSelectedCategories();
    const includeTaiwan = selectedCategories.includes("taiwan_stocks");
    const params = new URLSearchParams({
      days: elements.days.value,
      limitPerSource: elements.limitPerSource.value,
      maxItemsPerCategory: elements.maxItems.value,
      includeTaiwan: String(includeTaiwan),
    });

    const categories = selectedCategories.join(",");
    const keyword = elements.keyword.value.trim();
    const selectedSources = getSelectedSourceNames();
    if (categories) params.set("categories", categories);
    if (keyword) params.set("keyword", keyword);
    if (selectedSources.length > 0) {
      params.set("sources", selectedSources.join(","));
    }
    params.set("usePrivateSignals", String(elements.usePrivateSignals.checked));
    params.set("useBlockBeats", String(elements.useBlockBeats.checked));
    params.set("useOpenNews", String(elements.useOpenNews.checked));
    params.set("useTwitterKols", String(elements.useTwitterKols.checked));

    const response = await fetch(`${trimSlash(elements.apiBase.value)}/weekly?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`weekly failed: ${response.status}`);
    }

    state.weekly = await response.json();
    state.topics = buildTopics(state.weekly);
    state.topicGroups = {
      bundle: state.topics.filter((topic) => topic.type === "bundle"),
      cluster: state.topics.filter((topic) => topic.type === "cluster"),
      fallback: state.topics.filter((topic) => topic.type === "fallback"),
    };
    state.selectedTopicKey = getVisibleTopics()[0]?.key || null;
    state.selectedArticleUrl = null;
    renderTopics();
    renderArticles();
    renderContext();
    setStatus(`loaded ${state.topics.length} topics`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "weekly failed");
  }
}

function buildTopics(weekly) {
  const itemsByCategory = Object.values(weekly.categories || {}).flat();
  const topicMap = new Map();
  const knownClusterKeys = new Set();

  if (Array.isArray(weekly.narrativeBundles) && weekly.narrativeBundles.length > 0) {
    for (const bundle of weekly.narrativeBundles) {
      const bundleItems = itemsByCategory.filter((item) => bundle.clusterKeys.includes(item.clusterKey));
      bundle.clusterKeys.forEach((key) => knownClusterKeys.add(key));
      topicMap.set(bundle.bundleKey, {
        key: bundle.bundleKey,
        type: "bundle",
        title: `[bundle] ${bundle.title}`,
        summary: bundle.summary || bundle.angle || bundle.whyGrouped || "",
        categories: bundle.categories || [],
        itemCount: bundleItems.length,
        sourceCount: bundle.sourceCount || unique(bundleItems.map((item) => item.source)).length,
        itemIds: bundleItems.map((item) => item.id),
        urls: bundleItems.map((item) => item.url),
        clusterKeys: bundle.clusterKeys,
        scores: summarizeScores(bundleItems),
        sourceLinks: bundleItems.map((item) => ({
          title: item.title,
          url: item.url,
          source: item.source,
          publishedAt: item.publishedAt,
        })),
      });
    }
  }

  if (Array.isArray(weekly.topicClusters)) {
    for (const cluster of weekly.topicClusters) {
      knownClusterKeys.add(cluster.clusterKey);
      const clusterItems = itemsByCategory.filter((item) => item.clusterKey === cluster.clusterKey);
      topicMap.set(cluster.clusterKey, {
        key: cluster.clusterKey,
        type: "cluster",
        title: `[cluster] ${formatClusterTitle(cluster.title, cluster.majorEntity)}`,
        summary: [cluster.marketTheme, cluster.eventType, cluster.majorEntity].filter(Boolean).join(" / "),
        categories: [cluster.category],
        itemCount: cluster.itemCount,
        sourceCount: cluster.sourceCount,
        itemIds: clusterItems.map((item) => item.id),
        urls: clusterItems.map((item) => item.url),
        clusterKeys: [cluster.clusterKey],
        scores: summarizeScores(clusterItems),
        sourceLinks: clusterItems.map((item) => ({
          title: item.title,
          url: item.url,
          source: item.source,
          publishedAt: item.publishedAt,
        })),
      });
    }
  }

  const fallbackGroups = new Map();
  for (const item of itemsByCategory) {
    const rawKey = item.clusterKey?.trim() || `article:${item.id}`;
    if (knownClusterKeys.has(rawKey)) {
      continue;
    }
    if (!fallbackGroups.has(rawKey)) {
      fallbackGroups.set(rawKey, []);
    }
    fallbackGroups.get(rawKey).push(item);
  }

  for (const [fallbackKey, group] of fallbackGroups.entries()) {
    const first = group[0];
    const title =
      group.length > 1
        ? formatClusterTitle(buildFallbackTitle(group), first.majorEntity)
        : first.title;
    topicMap.set(`fallback:${fallbackKey}`, {
      key: `fallback:${fallbackKey}`,
      type: "fallback",
      title: `[raw] ${title}`,
      summary: [first.category, first.marketTheme, first.eventType, first.majorEntity]
        .filter(Boolean)
        .join(" / "),
      categories: unique(group.map((item) => item.category)),
      itemCount: group.length,
      sourceCount: unique(group.map((item) => item.source)).length,
      itemIds: group.map((item) => item.id),
      urls: group.map((item) => item.url),
      clusterKeys: group.map((item) => item.clusterKey).filter(Boolean),
      scores: summarizeScores(group),
      sourceLinks: group.map((item) => ({
        title: item.title,
        url: item.url,
        source: item.source,
        publishedAt: item.publishedAt,
      })),
    });
  }

  for (const merged of state.mergedTopics || []) {
    const memberTopics = merged.topicKeys
      .map((key) => topicMap.get(key))
      .filter(Boolean);
    const mergedItems = unique(memberTopics.flatMap((topic) => topic.urls))
      .map((url) => itemsByCategory.find((item) => item.url === url))
      .filter(Boolean);
    if (!mergedItems.length) continue;
    topicMap.set(merged.id, {
      key: merged.id,
      type: "merged",
      title: `[merged] ${merged.title}`,
      summary: merged.note || memberTopics.map((topic) => topic.title).slice(0, 3).join(" / "),
      categories: unique(mergedItems.map((item) => item.category)),
      itemCount: mergedItems.length,
      sourceCount: unique(mergedItems.map((item) => item.source)).length,
      itemIds: mergedItems.map((item) => item.id),
      urls: mergedItems.map((item) => item.url),
      clusterKeys: memberTopics.flatMap((topic) => topic.clusterKeys || []),
      scores: summarizeScores(mergedItems),
      sourceLinks: mergedItems.map((item) => ({
        title: item.title,
        url: item.url,
        source: item.source,
        publishedAt: item.publishedAt,
      })),
      mergeMemberKeys: merged.topicKeys,
    });
  }

  return Array.from(topicMap.values()).sort((a, b) => {
    if (a.type !== b.type) {
      const rank = { merged: 0, bundle: 1, cluster: 2, fallback: 3 };
      return rank[a.type] - rank[b.type];
    }
    return b.itemCount - a.itemCount;
  });
}

function formatClusterTitle(title, majorEntity) {
  if (!majorEntity) return title;
  const normalizedEntity = String(majorEntity).trim();
  if (!normalizedEntity) return title;
  const lowerTitle = String(title).toLowerCase();
  const lowerEntity = normalizedEntity.toLowerCase();
  if (lowerTitle.includes(lowerEntity)) {
    return title;
  }
  return `${title} / ${normalizedEntity}`;
}

function buildFallbackTitle(group) {
  const first = group[0];
  if (first.majorEntity === "amd") {
    return "Riot / AMD / data center pivot";
  }
  if (first.marketTheme === "ai_capex") {
    return "AI capex and infrastructure";
  }
  return first.title;
}

function renderTopics() {
  elements.topicsList.innerHTML = "";
  ensureVisibleTopicTab();
  const visibleTopics = getVisibleTopics();
  elements.topicsMeta.textContent = formatTopicMeta(visibleTopics.length, state.topics.length);
  renderTabs();

  if (!visibleTopics.length) {
    const availableTabs = getTopicTabCounts();
    const hint = [
      availableTabs.bundle ? `bundles ${availableTabs.bundle}` : null,
      availableTabs.cluster ? `clusters ${availableTabs.cluster}` : null,
      availableTabs.fallback ? `raw ${availableTabs.fallback}` : null,
    ]
      .filter(Boolean)
      .join(" / ");
    elements.topicsList.innerHTML = `<div class="empty-state">${
      hint ? `current tab empty (${hint})` : "load /weekly first"
    }</div>`;
    return;
  }

  if (!visibleTopics.some((topic) => topic.key === state.selectedTopicKey)) {
    state.selectedTopicKey = visibleTopics[0]?.key || null;
  }

  for (const topic of visibleTopics) {
    const fragment = elements.topicTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".topic-card");
    const button = fragment.querySelector(".topic-item");
    const title = fragment.querySelector(".topic-item-title");
    const summary = fragment.querySelector(".topic-item-summary");
    const meta = fragment.querySelector(".topic-item-meta");
    const pinned = fragment.querySelector(".topic-pinned");
    const merge = fragment.querySelector(".topic-merge");
    const split = fragment.querySelector(".topic-split");
    const note = fragment.querySelector(".topic-note");

    title.textContent = topic.title;
    summary.textContent = topic.summary || "no summary";
    meta.textContent = `${topic.itemCount} articles / ${topic.sourceCount} sources / ${topic.categories.join(", ")} / sq ${topic.scores.sourceQualityScore} / co ${topic.scores.corroborationScore} / mr ${topic.scores.marketReactionScore}`;
    const officialBackedCount = countOfficialBackedArticles(topic);
    const strongEvidenceCount = countStrongEvidenceArticles(topic);
    meta.textContent += ` / off ${officialBackedCount} / strong ${strongEvidenceCount}`;
    const topicState = state.selections[`topic:${topic.key}`] || {};
    pinned.checked = Boolean(topicState.pinned);
    note.value = topicState.note || "";
    merge.checked = Boolean(state.selections[`merge:${topic.key}`]?.selected);
    split.hidden = topic.type !== "merged";

    if (topic.key === state.selectedTopicKey) {
      button.classList.add("active");
    }

    button.addEventListener("click", () => {
      state.selectedTopicKey = topic.key;
      state.selectedArticleUrl = null;
      renderTopics();
      renderArticles();
      renderContext();
    });

    merge.addEventListener("change", () => {
      state.selections[`merge:${topic.key}`] = {
        ...(state.selections[`merge:${topic.key}`] || {}),
        selected: merge.checked,
        topicKey: topic.key,
        topicTitle: topic.title,
      };
      persistControls();
    });

    pinned.addEventListener("change", () => {
      state.selections[`topic:${topic.key}`] = {
        ...(state.selections[`topic:${topic.key}`] || {}),
        pinned: pinned.checked,
        note: note.value.trim(),
        topicKey: topic.key,
        topicTitle: topic.title,
      };
      persistControls();
      updateSelectionCount();
    });

    note.addEventListener("change", () => {
      state.selections[`topic:${topic.key}`] = {
        ...(state.selections[`topic:${topic.key}`] || {}),
        pinned: pinned.checked,
        note: note.value.trim(),
        topicKey: topic.key,
        topicTitle: topic.title,
      };
      persistControls();
    });

    split.addEventListener("click", () => {
      splitMergedTopic(topic.key);
    });

    elements.topicsList.appendChild(fragment);
  }
}

function renderTabs() {
  elements.tabBundles.classList.toggle("is-active", state.activeTopicTab === "bundle");
  elements.tabClusters.classList.toggle("is-active", state.activeTopicTab === "cluster");
  elements.tabRaw.classList.toggle("is-active", state.activeTopicTab === "fallback");
}

function switchTopicTab(tab) {
  state.activeTopicTab = tab;
  state.selectedTopicKey = getVisibleTopics()[0]?.key || null;
  renderTopics();
  renderArticles();
  renderContext();
}

function ensureVisibleTopicTab() {
  const current = state.topicGroups[state.activeTopicTab] || [];
  if (current.length) return;
  const next = getFirstNonEmptyTopicTab();
  if (next) {
    state.activeTopicTab = next;
  }
}

function getFirstNonEmptyTopicTab() {
  for (const tab of ["bundle", "cluster", "fallback"]) {
    if ((state.topicGroups[tab] || []).length) return tab;
  }
  return null;
}

function getTopicTabCounts() {
  return {
    bundle: (state.topicGroups.bundle || []).length + state.topics.filter((topic) => topic.type === "merged").length,
    cluster: (state.topicGroups.cluster || []).length,
    fallback: (state.topicGroups.fallback || []).length,
  };
}

function formatTopicMeta(visibleCount, totalCount) {
  const counts = getTopicTabCounts();
  return `${visibleCount} / ${totalCount} (b ${counts.bundle} / c ${counts.cluster} / r ${counts.fallback})`;
}

function getVisibleTopics() {
  let topics = [...(state.topicGroups[state.activeTopicTab] || [])];
  if (state.activeTopicTab === "bundle") {
    topics = [
      ...state.topics.filter((topic) => topic.type === "merged"),
      ...topics,
    ];
  }

  if (state.sort.hideWeakTopics) {
    const selectedCategories = getSelectedCategories();
    const taiwanOnly =
      selectedCategories.length === 1 && selectedCategories[0] === "taiwan_stocks";
    topics = topics.filter((topic) =>
      taiwanOnly
        ? (
            topic.scores.editorialScore >= 70 ||
            topic.scores.corroborationScore >= 18 ||
            topic.scores.marketReactionScore >= 12
          )
        : (
            topic.scores.editorialScore >= 110 ||
            topic.scores.corroborationScore >= 45 ||
            topic.scores.marketReactionScore >= 40
          ),
    );
  }

  const rankers = {
    story: (topic) => topic.itemCount * 10 + topic.sourceCount * 6 + topic.scores.editorialScore,
    sq: (topic) => topic.scores.sourceQualityScore,
    co: (topic) => topic.scores.corroborationScore,
    mr: (topic) => topic.scores.marketReactionScore,
    ed: (topic) => topic.scores.editorialScore,
  };
  const rank = rankers[state.sort.topics] || rankers.story;
  topics.sort((a, b) => rank(b) - rank(a));
  return topics;
}

function handleMergeTopics() {
  const selected = Object.entries(state.selections)
    .filter(([key, entry]) => key.startsWith("merge:") && entry?.selected)
    .map(([, entry]) => entry.topicKey)
    .filter(Boolean);
  const uniqueKeys = unique(selected);
  if (uniqueKeys.length < 2) {
    setStatus("select at least 2 topics to merge");
    return;
  }
  const sourceTopics = uniqueKeys
    .map((key) => state.topics.find((topic) => topic.key === key))
    .filter(Boolean);
  const title = sourceTopics.map((topic) => topic.title.replace(/^\[[^\]]+\]\s*/, "")).slice(0, 2).join(" + ");
  const id = `merged:${Date.now()}`;
  state.mergedTopics.push({
    id,
    title,
    topicKeys: uniqueKeys,
    note: "",
  });
  for (const key of Object.keys(state.selections)) {
    if (key.startsWith("merge:")) {
      delete state.selections[key];
    }
  }
  state.topics = buildTopics(state.weekly);
  state.selectedTopicKey = id;
  persistControls();
  renderTopics();
  renderArticles();
  renderContext();
  setStatus(`merged ${uniqueKeys.length} topics`);
}

function handleClearMergeSelection() {
  for (const key of Object.keys(state.selections)) {
    if (key.startsWith("merge:")) {
      delete state.selections[key];
    }
  }
  persistControls();
  renderTopics();
  setStatus("merge selection cleared");
}

function splitMergedTopic(topicKey) {
  state.mergedTopics = state.mergedTopics.filter((topic) => topic.id !== topicKey);
  delete state.selections[`topic:${topicKey}`];
  state.topics = buildTopics(state.weekly);
  state.selectedTopicKey = getVisibleTopics()[0]?.key || null;
  persistControls();
  renderTopics();
  renderArticles();
  renderContext();
  setStatus("merged topic split");
}

function renderArticles() {
  elements.articlesList.innerHTML = "";

  const topic = state.topics.find((entry) => entry.key === state.selectedTopicKey);
  const articles = getTopicArticles(topic);
  elements.articlesMeta.textContent = String(articles.length);

  if (!articles.length) {
    elements.articlesList.innerHTML = `<div class="empty-state">no articles</div>`;
    return;
  }

  for (const article of articles) {
    const fragment = elements.articleTemplate.content.cloneNode(true);
    const wrapper = fragment.querySelector(".article-item");
    const openButton = fragment.querySelector(".article-open");
    const meta = fragment.querySelector(".article-meta");
    const links = fragment.querySelector(".article-links");
    const selected = fragment.querySelector(".article-selected");
    const role = fragment.querySelector(".article-role");
    const note = fragment.querySelector(".article-note");

    const selectedState = state.selections[article.url];
    const articleContext = state.contexts[article.url];
    const evidence = summarizeContextEvidence(articleContext);
    openButton.textContent = article.title;
    meta.textContent = `${article.source} / ${article.publishedAt || "no date"} / ed ${article.editorialScore ?? article.reportScore ?? 0} / sq ${article.sourceQualityScore ?? 0} / co ${article.corroborationScore ?? 0} / mr ${article.marketReactionScore ?? 0}`;
    links.innerHTML = `
      ${topic ? topic.title : "topic"} /
      <a href="${article.url}" target="_blank" rel="noreferrer">open source</a>
      ${renderArticleSourceBadges(article)}
      ${renderArticleEvidenceBadges(evidence)}
    `;
    selected.checked = Boolean(selectedState);
    role.value = selectedState?.role || "core";
    note.value = selectedState?.note || "";

    if (selectedState) {
      wrapper.classList.add("is-selected");
    }

    openButton.addEventListener("click", () => {
      state.selectedArticleUrl = article.url;
      loadContext(article);
    });

    selected.addEventListener("change", () => {
      if (selected.checked) {
        state.selections[article.url] = buildSelectionRecord(article, topic, role.value, note.value);
      } else {
        delete state.selections[article.url];
      }
      persistControls();
      updateSelectionCount();
      renderArticles();
    });

    role.addEventListener("change", () => {
      if (!state.selections[article.url]) {
        state.selections[article.url] = buildSelectionRecord(article, topic, role.value, note.value);
      } else {
        state.selections[article.url].role = role.value;
      }
      persistControls();
      updateSelectionCount();
    });

    note.addEventListener("change", () => {
      if (!state.selections[article.url]) {
        state.selections[article.url] = buildSelectionRecord(article, topic, role.value, note.value);
      } else {
        state.selections[article.url].note = note.value.trim();
      }
      persistControls();
    });

    elements.articlesList.appendChild(fragment);
  }
}

function buildSelectionRecord(article, topic, role, note = "") {
  const evidence = summarizeContextEvidence(state.contexts[article.url]);
  return {
    id: article.id,
    url: article.url,
    title: article.title,
    source: article.source,
    category: article.category,
    publishedAt: article.publishedAt,
    role,
    topicKey: topic?.key || null,
    topicTitle: topic?.title || null,
    sourceQualityScore: article.sourceQualityScore ?? 0,
    corroborationScore: article.corroborationScore ?? 0,
    marketReactionScore: article.marketReactionScore ?? 0,
    sourceType: article.sourceType || "media",
    officialBacked: isOfficialBacked(article),
    evidenceStrength: evidence.label,
    note: note.trim(),
  };
}

function summarizeScores(items) {
  if (!items.length) {
    return {
      sourceQualityScore: 0,
      corroborationScore: 0,
      marketReactionScore: 0,
    };
  }

  const avg = (key) =>
    Math.round(items.reduce((sum, item) => sum + (item[key] || 0), 0) / items.length);

  return {
    sourceQualityScore: avg("sourceQualityScore"),
    corroborationScore: avg("corroborationScore"),
    marketReactionScore: avg("marketReactionScore"),
    editorialScore: avg("editorialScore"),
  };
}

function getTopicArticles(topic) {
  if (!state.weekly || !topic) return [];
  let articles = Object.values(state.weekly.categories || {})
    .flat()
    .filter((article) => topic.urls.includes(article.url));

  if (state.sort.selectedOnly) {
    articles = articles.filter((article) => Boolean(state.selections[article.url]));
  }
  if (state.sort.officialOnly) {
    articles = articles.filter((article) => isOfficialBacked(article));
  }
  if (state.sort.evidenceStrongOnly) {
    articles = articles.filter((article) => summarizeContextEvidence(state.contexts[article.url]).label === "high");
  }

  const rankers = {
    editorial: (article) => article.editorialScore ?? article.reportScore ?? 0,
    sq: (article) => article.sourceQualityScore ?? 0,
    co: (article) => article.corroborationScore ?? 0,
    mr: (article) => article.marketReactionScore ?? 0,
    latest: (article) => (article.publishedAt ? Date.parse(article.publishedAt) : 0),
  };
  const rank = rankers[state.sort.articles] || rankers.editorial;

  return articles.sort((a, b) => {
    const aSelected = Boolean(state.selections[a.url]);
    const bSelected = Boolean(state.selections[b.url]);
    if (aSelected !== bSelected) {
      return Number(bSelected) - Number(aSelected);
    }
    return rank(b) - rank(a);
  });
}

async function loadContext(article) {
  setStatus(`loading source_context for ${article.source} ...`);
  const cacheKey = article.url;

  if (state.contexts[cacheKey]) {
    renderContext();
    setStatus("context loaded from cache");
    return;
  }

  try {
    const params = new URLSearchParams({
      url: article.url,
      maxParagraphs: "6",
    });
    const response = await fetch(`${trimSlash(elements.apiBase.value)}/source-context?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`source-context failed: ${response.status}`);
    }

    const payload = await response.json();
    const articleContext = payload.articles?.[0];
    if (!articleContext) {
      throw new Error(payload.failedArticles?.[0]?.reason || "no context");
    }

    state.contexts[cacheKey] = articleContext;
    renderContext();
    setStatus("source_context loaded");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "source-context failed");
  }
}

function renderContext() {
  const articleUrl = state.selectedArticleUrl;
  if (!articleUrl) {
    elements.contextMeta.textContent = "none";
    elements.contextView.innerHTML = `<div class="context-empty">select an article to load source_context</div>`;
    return;
  }

  const context = state.contexts[articleUrl];
  if (!context) {
    elements.contextMeta.textContent = "loading";
    elements.contextView.innerHTML = `<div class="context-empty">loading ...</div>`;
    return;
  }

  elements.contextMeta.textContent = context.source || "article";
  const evidence = summarizeContextEvidence(context);
  const numbers = context.numbersMentioned.length
    ? `<div class="context-block"><div class="context-title">numbers_mentioned</div><div class="chip-row">${context.numbersMentioned.map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join("")}</div></div>`
    : "";

  const paragraphs = context.keyParagraphs.length
    ? `<div class="context-block"><div class="context-title">key_paragraphs</div><div class="context-copy">${context.keyParagraphs.map((paragraph) => `- ${escapeHtml(paragraph)}`).join("\n\n")}</div></div>`
    : "";

  const quotes = context.quotedLines.length
    ? `<div class="context-block"><div class="context-title">quoted_lines</div><div class="context-copy">${context.quotedLines.map((line) => `- ${escapeHtml(line)}`).join("\n")}</div></div>`
    : "";

  elements.contextView.innerHTML = `
    <div class="context-block">
      <div class="context-title">${escapeHtml(context.title || "untitled")}</div>
      <div class="meta-list">${escapeHtml(context.publishedAt || "no date")} / <a href="${context.url}" target="_blank" rel="noreferrer">open article</a></div>
    </div>
    <div class="evidence-grid">
      <div class="evidence-card">
        <div class="evidence-card-title">number_count</div>
        <div class="evidence-card-value">${evidence.numberCount}</div>
      </div>
      <div class="evidence-card">
        <div class="evidence-card-title">quote_count</div>
        <div class="evidence-card-value">${evidence.quoteCount}</div>
      </div>
      <div class="evidence-card">
        <div class="evidence-card-title">paragraph_count</div>
        <div class="evidence-card-value">${evidence.paragraphCount}</div>
      </div>
      <div class="evidence-card">
        <div class="evidence-card-title">fact_strength</div>
        <div class="evidence-card-value">${evidence.label}</div>
      </div>
    </div>
    <div class="evidence-summary">
      <div class="context-title">fact_check_summary</div>
      <div class="evidence-badges">
        ${renderEvidenceStatusBadges(evidence)}
      </div>
      <div class="evidence-note">${escapeHtml(evidence.note)}</div>
    </div>
    <div class="context-block">
      <div class="context-title">lead_text</div>
      <div class="context-copy">${escapeHtml(context.leadText || "none")}</div>
    </div>
    <div class="context-block">
      <div class="context-title">article_excerpt</div>
      <div class="context-copy">${escapeHtml(context.articleExcerpt || "none")}</div>
    </div>
    ${paragraphs}
    ${quotes}
    ${numbers}
  `;
}

function summarizeContextEvidence(context) {
  const numberCount = context?.numbersMentioned?.length || 0;
  const quoteCount = context?.quotedLines?.length || 0;
  const paragraphCount = context?.keyParagraphs?.length || 0;
  let label = "low";
  let note = "這篇目前可直接驗證的數字或引文偏少，寫稿時不要講太滿。";

  if (numberCount >= 2 && quoteCount >= 1) {
    label = "high";
    note = "這篇同時有可驗證數字和直接引文，適合當核心來源。";
  } else if (numberCount >= 1 || quoteCount >= 1 || paragraphCount >= 2) {
    label = "medium";
    note = "這篇有部分可驗證材料，適合搭配其他來源交叉使用。";
  }

  return {
    numberCount,
    quoteCount,
    paragraphCount,
    label,
    note,
  };
}

function renderArticleEvidenceBadges(evidence) {
  if (!evidence) return "";
  const strengthClass =
    evidence.label === "high" ? "strong" : evidence.label === "medium" ? "warn" : "danger";
  return `
    <span class="article-badges">
      <span class="badge ${strengthClass}">fact ${escapeHtml(evidence.label)}</span>
      <span class="badge">num ${evidence.numberCount}</span>
      <span class="badge">quote ${evidence.quoteCount}</span>
    </span>
  `;
}

function renderArticleSourceBadges(article) {
  const badges = [];
  if (article.sourceType) {
    badges.push(`<span class="badge">${escapeHtml(article.sourceType)}</span>`);
  }
  if (isOfficialBacked(article)) {
    badges.push(`<span class="badge strong">official-backed</span>`);
  }
  return badges.join("");
}

function renderEvidenceStatusBadges(evidence) {
  const badges = [];
  badges.push(`<span class="badge ${evidence.numberCount > 0 ? "strong" : "danger"}">numbers ${evidence.numberCount}</span>`);
  badges.push(`<span class="badge ${evidence.quoteCount > 0 ? "strong" : "warn"}">quotes ${evidence.quoteCount}</span>`);
  badges.push(`<span class="badge ${evidence.paragraphCount > 0 ? "warn" : "danger"}">paragraphs ${evidence.paragraphCount}</span>`);
  badges.push(`<span class="badge ${evidence.label === "high" ? "strong" : evidence.label === "medium" ? "warn" : "danger"}">strength ${escapeHtml(evidence.label)}</span>`);
  return badges.join("");
}

function handleClearSelection() {
  state.selections = {};
  persistControls();
  updateSelectionCount();
  renderTopics();
  renderArticles();
  setStatus("selection cleared");
}

function updateSelectionCount() {
  const selectedArticles = Object.keys(state.selections).filter((key) =>
    !key.startsWith("topic:") && !key.startsWith("merge:")
  ).length;
  const pinnedTopics = Object.values(state.selections).filter((entry) => entry?.pinned).length;
  elements.selectionCount.textContent = `selected: ${selectedArticles}`;
  elements.pinnedCount.textContent = `pinned: ${pinnedTopics}`;
}

function exportSelectionJson() {
  const payload = buildExportPayload();
  downloadFile(
    "weekly-research-selection.json",
    JSON.stringify(payload, null, 2),
    "application/json",
  );
  setStatus("exported json");
}

function exportSelectionMarkdown() {
  const payload = buildExportPayload();
  const markdown = toMarkdown(payload);
  downloadFile("weekly-research-selection.md", markdown, "text/markdown");
  setStatus("exported markdown");
}

function buildExportPayload() {
  const selectedEntries = Object.values(state.selections);
  const pinnedTopics = Object.entries(state.selections)
    .filter(([key, entry]) => key.startsWith("topic:") && entry?.pinned)
    .map(([key, entry]) => ({
      key,
      topicKey: entry.topicKey,
      topicTitle: entry.topicTitle,
      note: entry.note || "",
    }));
  const topics = buildResearchTopics(selectedEntries, pinnedTopics);
  return {
    generatedAt: new Date().toISOString(),
    formatVersion: "research-pack/v2",
    apiBase: trimSlash(elements.apiBase.value),
    params: {
      days: Number(elements.days.value),
      limitPerSource: Number(elements.limitPerSource.value),
      maxItemsPerCategory: Number(elements.maxItems.value),
      includeTaiwan: getSelectedCategories().includes("taiwan_stocks"),
      categories: getSelectedCategories().join(",") || null,
      sources: getSelectedSourceNames().length > 0 ? getSelectedSourceNames() : null,
      usePrivateSignals: elements.usePrivateSignals.checked,
      useBlockBeats: elements.useBlockBeats.checked,
      useOpenNews: elements.useOpenNews.checked,
      useTwitterKols: elements.useTwitterKols.checked,
      keyword: elements.keyword.value.trim() || null,
    },
    pinnedTopics,
    topics,
    writingHandoff: topics.map((topic) => ({
      topicKey: topic.topicKey,
      topicTitle: topic.topicTitle,
      storyAngle: topic.storyAngle,
      officialBackedCount: topic.officialBackedCount,
      strongEvidenceCount: topic.strongEvidenceCount,
      sourceCount: topic.sourceCount,
      articleCount: topic.articleCount,
      keyNumbers: topic.numbers.slice(0, 12),
      keyQuotes: topic.keyQuotes.slice(0, 4),
      factCheckItems: topic.factCheckItems,
      coreLinks: topic.core.map((article) => article.url),
      relatedLinks: topic.related.map((article) => article.url),
    })),
    selectedArticles: selectedEntries.map((entry) => ({
      ...entry,
      officialBacked: entry.officialBacked ?? false,
      evidenceStrength: entry.evidenceStrength ?? summarizeContextEvidence(state.contexts[entry.url]).label,
      sourceContext: state.contexts[entry.url] || null,
    })).filter((entry) => entry.url),
  };
}

function buildResearchTopics(entries, pinnedTopics) {
  const grouped = groupSelectionsByTopic(entries);
  const pinnedMap = new Map(pinnedTopics.map((topic) => [topic.topicKey, topic]));

  return grouped.map((topic) => {
    const core = topic.articles.filter((article) => article.role === "core");
    const related = topic.articles.filter((article) => article.role !== "core");
    const allArticles = [...core, ...related];
    const sources = unique(allArticles.map((article) => article.source));
    const links = allArticles.map((article) => article.url);
    const numbers = unique(
      allArticles.flatMap((article) => article.sourceContext?.numbersMentioned || []),
    );
    const leadTexts = allArticles
      .map((article) => article.sourceContext?.leadText)
      .filter(Boolean)
      .slice(0, 4);
    const keyQuotes = allArticles
      .flatMap((article) => article.sourceContext?.quotedLines || [])
      .slice(0, 6);

    return {
      topicKey: topic.topicKey,
      topicTitle: topic.topicTitle,
      pinned: Boolean(pinnedMap.get(topic.topicKey)?.topicKey),
      topicNote: pinnedMap.get(topic.topicKey)?.note || "",
      articleCount: topic.articleCount,
      sourceCount: sources.length,
      sourceTypes: unique(allArticles.map((article) => article.sourceType || "media")),
      officialBackedCount: allArticles.filter((article) => isOfficialBacked(article)).length,
      strongEvidenceCount: allArticles.filter((article) =>
        summarizeContextEvidence(article.sourceContext).label === "high"
      ).length,
      storyAngle: buildStoryAngle(topic.topicTitle, core, related),
      core,
      related,
      sources,
      links,
      numbers,
      leadTexts,
      keyQuotes,
      factCheckItems: buildFactCheckItems(allArticles),
    };
  });
}

function groupSelectionsByTopic(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry.url) {
      continue;
    }
    const key = entry.topicKey || "unassigned";
    if (!map.has(key)) {
      map.set(key, {
        topicKey: key,
        topicTitle: entry.topicTitle || "unassigned",
        articleCount: 0,
        articles: [],
      });
    }
    const topic = map.get(key);
    topic.articleCount += 1;
    topic.articles.push({
      ...entry,
      sourceContext: state.contexts[entry.url] || null,
    });
  }
  return Array.from(map.values());
}

function buildStoryAngle(topicTitle, core, related) {
  const coreTitles = core.map((article) => article.title).slice(0, 2);
  const relatedTitles = related.map((article) => article.title).slice(0, 2);

  if (coreTitles.length === 0) {
    return `先把「${topicTitle}」的來源結構確認清楚，再決定故事主線。`;
  }

  let angle = `主軸先講 ${coreTitles.join(" / ")}。`;
  if (relatedTitles.length > 0) {
    angle += ` 再用 ${relatedTitles.join(" / ")} 補市場反應、背景或延伸意義。`;
  }
  return angle;
}

function buildFactCheckItems(articles) {
  return unique(
    articles.flatMap((article) => {
      const checks = [];
      if (article.publishedAt) {
        checks.push(`確認「${article.title}」的時間點`);
      }
      if ((article.sourceContext?.numbersMentioned || []).length > 0) {
        checks.push(`確認「${article.title}」裡的關鍵數字`);
      }
      return checks;
    }),
  ).slice(0, 8);
}

function toMarkdown(payload) {
  const lines = [
    `# Weekly Research Pack`,
    ``,
    `Generated at: ${payload.generatedAt}`,
    `API Base: ${payload.apiBase}`,
    ``,
    `## Params`,
    `- days: ${payload.params.days}`,
    `- limitPerSource: ${payload.params.limitPerSource}`,
    `- maxItemsPerCategory: ${payload.params.maxItemsPerCategory}`,
    `- includeTaiwan: ${payload.params.includeTaiwan}`,
    `- categories: ${payload.params.categories || "all"}`,
    `- privateSignals: ${payload.params.usePrivateSignals}`,
    `- blockBeats: ${payload.params.useBlockBeats}`,
    `- openNews: ${payload.params.useOpenNews}`,
    `- twitterKols: ${payload.params.useTwitterKols}`,
    `- keyword: ${payload.params.keyword || "none"}`,
    ``,
  ];

  for (const topic of payload.topics) {
    lines.push(`## ${topic.topicTitle}`);
    lines.push(`- topicKey: ${topic.topicKey}`);
    lines.push(`- pinned: ${topic.pinned}`);
    if (topic.topicNote) {
      lines.push(`- topicNote: ${topic.topicNote}`);
    }
    lines.push(`- articleCount: ${topic.articleCount}`);
    lines.push(`- sourceCount: ${topic.sourceCount}`);
    lines.push(`- sourceTypes: ${topic.sourceTypes.join(", ")}`);
    lines.push(`- officialBackedCount: ${topic.officialBackedCount}`);
    lines.push(`- strongEvidenceCount: ${topic.strongEvidenceCount}`);
    lines.push(`- storyAngle: ${topic.storyAngle}`);
    if (topic.links.length) {
      lines.push(`- links:`);
      for (const link of topic.links) {
        lines.push(`  - ${link}`);
      }
    }
    if (topic.numbers.length) {
      lines.push(`- numbers: ${topic.numbers.join(", ")}`);
    }
    if (topic.factCheckItems.length) {
      lines.push(`- factCheckItems:`);
      for (const item of topic.factCheckItems) {
        lines.push(`  - ${item}`);
      }
    }
    lines.push(``);

    if (topic.core.length) {
      lines.push(`### Core`);
      lines.push(``);
    }
    for (const article of topic.core) {
      lines.push(`#### ${article.title}`);
      lines.push(`- role: ${article.role}`);
      if (article.note) {
        lines.push(`- note: ${article.note}`);
      }
      lines.push(`- source: ${article.source}`);
      lines.push(`- publishedAt: ${article.publishedAt || "no date"}`);
      lines.push(`- url: ${article.url}`);
      lines.push(`- sq/co/mr: ${article.sourceQualityScore}/${article.corroborationScore}/${article.marketReactionScore}`);
      lines.push(`- sourceType: ${article.sourceType || "media"}`);
      lines.push(`- officialBacked: ${Boolean(article.officialBacked)}`);
      lines.push(`- evidenceStrength: ${article.evidenceStrength || "low"}`);
      if (article.sourceContext?.numbersMentioned?.length) {
        lines.push(`- numbers: ${article.sourceContext.numbersMentioned.join(", ")}`);
      }
      if (article.sourceContext?.leadText) {
        lines.push(`- leadText: ${article.sourceContext.leadText}`);
      }
      lines.push(``);
    }

    if (topic.related.length) {
      lines.push(`### Related`);
      lines.push(``);
    }
    for (const article of topic.related) {
      lines.push(`### ${article.title}`);
      lines.push(`- role: ${article.role}`);
      if (article.note) {
        lines.push(`- note: ${article.note}`);
      }
      lines.push(`- source: ${article.source}`);
      lines.push(`- publishedAt: ${article.publishedAt || "no date"}`);
      lines.push(`- url: ${article.url}`);
      lines.push(`- sq/co/mr: ${article.sourceQualityScore}/${article.corroborationScore}/${article.marketReactionScore}`);
      lines.push(`- sourceType: ${article.sourceType || "media"}`);
      lines.push(`- officialBacked: ${Boolean(article.officialBacked)}`);
      lines.push(`- evidenceStrength: ${article.evidenceStrength || "low"}`);
      if (article.sourceContext?.numbersMentioned?.length) {
        lines.push(`- numbers: ${article.sourceContext.numbersMentioned.join(", ")}`);
      }
      if (article.sourceContext?.leadText) {
        lines.push(`- leadText: ${article.sourceContext.leadText}`);
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}

function isOfficialBacked(article) {
  return article?.sourceType === "official" || (article?.sourceQualityScore ?? 0) >= 90;
}

function countOfficialBackedArticles(topic) {
  if (!topic || !state.weekly) return 0;
  return Object.values(state.weekly.categories || {})
    .flat()
    .filter((article) => topic.urls.includes(article.url))
    .filter((article) => isOfficialBacked(article)).length;
}

function countStrongEvidenceArticles(topic) {
  if (!topic || !state.weekly) return 0;
  return Object.values(state.weekly.categories || {})
    .flat()
    .filter((article) => topic.urls.includes(article.url))
    .filter((article) => summarizeContextEvidence(state.contexts[article.url]).label === "high").length;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function trimSlash(value) {
  return value.trim().replace(/\/+$/, "");
}

function unique(values) {
  return Array.from(new Set(values));
}
