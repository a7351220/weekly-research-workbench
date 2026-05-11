export function handleTaiwanTestPage(): Response {
  return new Response(renderTaiwanTestPageHtml(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function renderTaiwanTestPageHtml(): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>台股產業測試台</title>
  <style>
    :root {
      --bg: #f2efe5;
      --ink: #191814;
      --muted: #6e6a5f;
      --line: #d9d2c0;
      --panel: #fffaf0;
      --panel-2: #ebe4d3;
      --green: #157f45;
      --red: #b33a31;
      --amber: #b16c00;
      --blue: #244f89;
      --shadow: 0 22px 70px rgba(47, 39, 23, .12);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        radial-gradient(circle at 12% 0%, rgba(177, 108, 0, .12), transparent 30rem),
        radial-gradient(circle at 88% 10%, rgba(36, 79, 137, .13), transparent 34rem),
        linear-gradient(135deg, #f7f3e8 0%, var(--bg) 48%, #e7dfcd 100%);
      font-family: "Avenir Next", "Noto Sans TC", "PingFang TC", sans-serif;
    }

    .shell {
      width: min(1440px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 26px 0 42px;
    }

    header {
      display: grid;
      grid-template-columns: 1.2fr .8fr;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 18px;
    }

    .hero,
    .control,
    .card,
    .raw {
      border: 1px solid var(--line);
      background: rgba(255, 250, 240, .86);
      box-shadow: var(--shadow);
    }

    .hero {
      position: relative;
      overflow: hidden;
      min-height: 190px;
      padding: 24px;
      border-radius: 28px;
    }

    .hero:before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(25, 24, 20, .07) 1px, transparent 1px),
        linear-gradient(rgba(25, 24, 20, .05) 1px, transparent 1px);
      background-size: 34px 34px;
      mask-image: linear-gradient(90deg, #000 0%, transparent 78%);
      pointer-events: none;
    }

    .kicker {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border: 1px solid var(--ink);
      border-radius: 999px;
      font-size: 12px;
      letter-spacing: .12em;
      text-transform: uppercase;
      background: rgba(255,255,255,.45);
    }

    h1 {
      position: relative;
      margin: 22px 0 8px;
      font-family: Georgia, "Noto Serif TC", serif;
      font-size: clamp(42px, 8vw, 86px);
      line-height: .88;
      letter-spacing: -.08em;
    }

    .subtitle {
      position: relative;
      max-width: 760px;
      margin: 0;
      color: var(--muted);
      font-size: 16px;
      line-height: 1.75;
    }

    .control {
      border-radius: 28px;
      padding: 18px;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    input {
      width: 100%;
      height: 44px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fffdfa;
      color: var(--ink);
      padding: 0 12px;
      font: 700 16px "Avenir Next", "Noto Sans TC", sans-serif;
      outline: none;
    }

    input:focus {
      border-color: var(--ink);
      box-shadow: 0 0 0 3px rgba(25, 24, 20, .1);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    button {
      border: 1px solid var(--ink);
      border-radius: 999px;
      background: var(--ink);
      color: #fffaf0;
      padding: 10px 14px;
      font-weight: 800;
      cursor: pointer;
    }

    button.secondary {
      background: transparent;
      color: var(--ink);
    }

    .status {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 14px;
      background: var(--panel-2);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .layout {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 18px;
      align-items: start;
    }

    .stack { display: grid; gap: 14px; }

    .card {
      border-radius: 24px;
      padding: 18px;
    }

    .card h2 {
      margin: 0 0 12px;
      font-size: 18px;
      letter-spacing: -.03em;
    }

    .big-symbol {
      font-family: Georgia, "Noto Serif TC", serif;
      font-size: 74px;
      line-height: .9;
      letter-spacing: -.07em;
      margin: 4px 0;
    }

    .company-name {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: -.04em;
      margin: 0 0 12px;
    }

    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 5px 9px;
      border-radius: 999px;
      background: #efe7d5;
      color: var(--ink);
      font-size: 12px;
      font-weight: 800;
    }

    .metric {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      padding: 10px 0;
      border-top: 1px dashed var(--line);
      color: var(--muted);
      font-size: 14px;
    }

    .metric strong {
      color: var(--ink);
      font-size: 18px;
    }

    .section-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 10px;
    }

    .section-title h2 {
      margin: 0;
      font-size: 24px;
      letter-spacing: -.05em;
    }

    .section-title span {
      color: var(--muted);
      font-size: 13px;
    }

    .industry-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
    }

    .industry-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      background: rgba(255,255,255,.5);
    }

    .industry-card a {
      color: var(--ink);
      font-weight: 900;
      text-decoration: none;
    }

    .industry-card a:hover,
    .news a:hover { text-decoration: underline; }

    .return {
      color: var(--green);
      font-weight: 900;
      font-size: 13px;
    }

    .position {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed var(--line);
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }

    .news-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .news {
      display: grid;
      min-height: 170px;
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      background: rgba(255,255,255,.58);
    }

    .news a {
      color: var(--ink);
      text-decoration: none;
      font-size: 16px;
      font-weight: 900;
      line-height: 1.45;
    }

    .desc {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.65;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .news-foot {
      align-self: end;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 12px;
      color: var(--muted);
      font-size: 12px;
    }

    .score {
      color: var(--blue);
      font-weight: 900;
    }

    .empty {
      border: 1px dashed var(--line);
      border-radius: 18px;
      padding: 20px;
      color: var(--muted);
      background: rgba(255,255,255,.38);
    }

    details.raw {
      border-radius: 24px;
      overflow: hidden;
    }

    summary {
      cursor: pointer;
      padding: 16px 18px;
      font-weight: 900;
    }

    pre {
      margin: 0;
      max-height: 460px;
      overflow: auto;
      padding: 18px;
      background: #191814;
      color: #f7f0df;
      font-size: 12px;
      line-height: 1.5;
    }

    @media (max-width: 980px) {
      header,
      .layout {
        grid-template-columns: 1fr;
      }

      .news-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 560px) {
      .shell {
        width: min(100vw - 18px, 720px);
        padding-top: 10px;
      }

      .hero,
      .control,
      .card {
        border-radius: 20px;
        padding: 14px;
      }

      .form-grid {
        grid-template-columns: 1fr 1fr;
      }

      h1 {
        font-size: 48px;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <section class="hero">
        <div class="kicker">Taiwan Equity Lab</div>
        <h1>台股產業測試台</h1>
        <p class="subtitle">輸入股票代號，檢查公司資料、StatementDog 產業鏈位置，以及 RSS 新聞池裡抓到的公司直新聞與供應鏈新聞。</p>
      </section>

      <section class="control">
        <div class="form-grid">
          <div>
            <label for="symbol">股票代號</label>
            <input id="symbol" value="2330" inputmode="numeric" maxlength="6">
          </div>
          <div>
            <label for="days">回看天數</label>
            <input id="days" value="30" inputmode="numeric">
          </div>
          <div>
            <label for="limitPerSource">每來源筆數</label>
            <input id="limitPerSource" value="50" inputmode="numeric">
          </div>
          <div>
            <label for="newsLimit">新聞上限</label>
            <input id="newsLimit" value="8" inputmode="numeric">
          </div>
        </div>
        <div class="actions">
          <button id="run">查詢</button>
          <button class="secondary preset" data-symbol="2330">2330 台積電</button>
          <button class="secondary preset" data-symbol="2383">2383 台光電</button>
          <button class="secondary preset" data-symbol="6669">6669 緯穎</button>
          <button class="secondary preset" data-symbol="2308">2308 台達電</button>
        </div>
        <div id="status" class="status">尚未查詢。</div>
      </section>
    </header>

    <section class="layout">
      <aside class="stack">
        <section class="card" id="company-card">
          <h2>公司資料</h2>
          <div class="empty">等待查詢。</div>
        </section>

        <section class="card" id="meta-card">
          <h2>資料源狀態</h2>
          <div class="empty">會同步讀取產業地圖狀態。</div>
        </section>
      </aside>

      <section class="stack">
        <section class="card">
          <div class="section-title">
            <h2>產業鏈位置</h2>
            <span id="industry-count">0 matches</span>
          </div>
          <div id="industries" class="industry-grid"></div>
        </section>

        <section class="card">
          <div class="section-title">
            <h2>公司直新聞</h2>
            <span id="company-news-count">0 items</span>
          </div>
          <div id="company-news" class="news-grid"></div>
        </section>

        <section class="card">
          <div class="section-title">
            <h2>供應鏈新聞</h2>
            <span id="supply-news-count">0 items</span>
          </div>
          <div id="supply-news" class="news-grid"></div>
        </section>

        <details class="raw">
          <summary>Raw JSON</summary>
          <pre id="raw-json">{}</pre>
        </details>
      </section>
    </section>
  </main>

  <script>
    var qs = new URLSearchParams(location.search);
    var el = function(id) { return document.getElementById(id); };
    var state = { latest: null };

    if (qs.get("symbol")) el("symbol").value = qs.get("symbol");
    if (qs.get("days")) el("days").value = qs.get("days");

    document.querySelectorAll(".preset").forEach(function(button) {
      button.addEventListener("click", function() {
        el("symbol").value = button.dataset.symbol;
        run();
      });
    });
    el("run").addEventListener("click", run);
    el("symbol").addEventListener("keydown", function(event) {
      if (event.key === "Enter") run();
    });

    loadIndustryMeta();
    run();

    function buildStockUrl() {
      var symbol = el("symbol").value.trim();
      var params = new URLSearchParams();
      params.set("days", clampNumber(el("days").value, 1, 45, 30));
      params.set("limitPerSource", clampNumber(el("limitPerSource").value, 1, 50, 50));
      params.set("maxItems", "300");
      params.set("newsLimit", clampNumber(el("newsLimit").value, 1, 50, 8));
      return "/taiwan/stock/" + encodeURIComponent(symbol) + ".json?" + params.toString();
    }

    function clampNumber(value, min, max, fallback) {
      var n = Number(value);
      if (!Number.isFinite(n)) return String(fallback);
      return String(Math.max(min, Math.min(max, Math.trunc(n))));
    }

    async function run() {
      var symbol = el("symbol").value.trim();
      if (!/^\\d{4,6}$/.test(symbol)) {
        setStatus("股票代號格式錯誤，請輸入 4 到 6 位數字。", true);
        return;
      }
      var url = buildStockUrl();
      setStatus("讀取中：" + url, false);
      try {
        var res = await fetch(url);
        var data = await res.json();
        state.latest = data;
        if (!res.ok || data.ok === false) throw new Error(data.error || "request failed");
        history.replaceState(null, "", "/taiwan?symbol=" + encodeURIComponent(symbol));
        render(data);
        setStatus("完成：" + data.symbol + " / " + ((data.company && data.company.stockName) || "N/A"), false);
      } catch (error) {
        setStatus("查詢失敗：" + error.message, true);
      }
    }

    async function loadIndustryMeta() {
      try {
        var res = await fetch("/taiwan/industry-map.json");
        var data = await res.json();
        el("meta-card").innerHTML = [
          "<h2>資料源狀態</h2>",
          '<div class="metric"><span>產業數</span><strong>' + escapeHtml(String(data.totalIndustries || "N/A")) + '</strong></div>',
          '<div class="metric"><span>來源更新</span><strong>' + escapeHtml(data.sourceLastUpdatedText || "N/A") + '</strong></div>',
          '<div class="metric"><span>來源</span><strong>StatementDog</strong></div>'
        ].join("");
      } catch (error) {
        el("meta-card").innerHTML = '<h2>資料源狀態</h2><div class="empty">產業地圖讀取失敗。</div>';
      }
    }

    function render(data) {
      renderCompany(data);
      renderIndustries(data.industryMatches || []);
      renderNews("company-news", "company-news-count", data.relatedNews && data.relatedNews.items || []);
      renderNews("supply-news", "supply-news-count", data.supplyChainNews && data.supplyChainNews.items || []);
      el("raw-json").textContent = JSON.stringify(data, null, 2);
    }

    function renderCompany(data) {
      var company = data.company || {};
      var industries = company.officialIndustries || [];
      var markets = company.marketTypes || [];
      el("company-card").innerHTML = [
        "<h2>公司資料</h2>",
        '<div class="big-symbol">' + escapeHtml(data.symbol || "N/A") + '</div>',
        '<p class="company-name">' + escapeHtml(company.stockName || "N/A") + '</p>',
        '<div class="pill-row">' + renderPills(industries.concat(markets)) + '</div>',
        '<div class="metric"><span>公司直新聞</span><strong>' + escapeHtml(String((data.relatedNews && data.relatedNews.totalItems) || 0)) + '</strong></div>',
        '<div class="metric"><span>供應鏈新聞</span><strong>' + escapeHtml(String((data.supplyChainNews && data.supplyChainNews.totalItems) || 0)) + '</strong></div>',
        '<div class="metric"><span>資料日期</span><strong>' + escapeHtml(company.date || "N/A") + '</strong></div>'
      ].join("");
    }

    function renderIndustries(items) {
      el("industry-count").textContent = items.length + " matches";
      if (!items.length) {
        el("industries").innerHTML = '<div class="empty">沒有找到 StatementDog 產業位置。</div>';
        return;
      }
      el("industries").innerHTML = items.map(function(item) {
        var positions = (item.positions || []).map(function(pos) {
          return '<div class="position"><strong>' + escapeHtml(pos.position) + '</strong><br>' +
            escapeHtml(pos.streamName) + '<br><span>' + escapeHtml(pos.subIndustry) + '</span></div>';
        }).join("");
        return '<article class="industry-card">' +
          '<a href="' + escapeAttr(item.industryUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(item.industry) + '</a>' +
          '<div class="return">' + escapeHtml(item.annualReturn || "N/A") + '</div>' +
          positions +
        '</article>';
      }).join("");
    }

    function renderNews(targetId, countId, items) {
      el(countId).textContent = items.length + " items";
      if (!items.length) {
        el(targetId).innerHTML = '<div class="empty">目前沒有符合條件的新聞。</div>';
        return;
      }
      el(targetId).innerHTML = items.map(function(item) {
        var aliases = item.relatedNewsMatchedAliases || [];
        return '<article class="news">' +
          '<div>' +
            '<a href="' + escapeAttr(item.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(item.title || "Untitled") + '</a>' +
            '<p class="desc">' + escapeHtml(item.description || "N/A") + '</p>' +
          '</div>' +
          '<div class="news-foot">' +
            '<span>' + escapeHtml(item.source || "N/A") + '</span>' +
            '<span class="score">score ' + escapeHtml(String(Math.round(item.relatedNewsScore || item.editorialScore || 0))) + '</span>' +
            '<span>' + escapeHtml(aliases.slice(0, 3).join(" / ")) + '</span>' +
          '</div>' +
        '</article>';
      }).join("");
    }

    function renderPills(items) {
      if (!items.length) return '<span class="pill">N/A</span>';
      return items.map(function(item) { return '<span class="pill">' + escapeHtml(item) + '</span>'; }).join("");
    }

    function setStatus(message, isError) {
      el("status").textContent = message;
      el("status").style.color = isError ? "var(--red)" : "var(--muted)";
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/'/g, "&#39;");
    }
  </script>
</body>
</html>`;
}
