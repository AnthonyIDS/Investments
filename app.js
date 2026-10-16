/* Investments dashboard — vanilla JS + Chart.js */
(function () {
  "use strict";

  const RANGES = [
    { id: "1M", label: "1M" },
    { id: "3M", label: "3M" },
    { id: "YTD", label: "YTD" },
    { id: "1Y", label: "1Y" }
  ];
  const MAX_CMP = 4;
  const SLOTS = ["--series-1", "--series-2", "--series-3", "--series-4"];

  const state = {
    watch: null,
    market: null,
    group: "all",
    range: "1Y",
    sort: { key: "group", dir: 1 },
    compare: new Map(), // symbol -> slot index (stable: colour follows the symbol)
    charts: {}
  };

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmtPrice = (v, cur) =>
    v == null ? "—" : (cur && cur !== "USD" ? cur + " " : "$") +
      v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (v) => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(1) + "%");
  const cls = (v) => (v == null || !isFinite(v) || Math.abs(v) < 0.0005 ? "flat" : v > 0 ? "up" : "down");
  const arrow = (v) => (v == null || !isFinite(v) || Math.abs(v) < 0.0005 ? "" : v > 0 ? "▲ " : "▼ ");
  const groupLabel = (id) => (state.watch.groups.find((g) => g.id === id) || {}).label || id;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function rangeStart(hist, range) {
    if (!hist || !hist.length) return null;
    const last = new Date(hist[hist.length - 1][0] + "T00:00:00Z");
    let d;
    if (range === "YTD") d = new Date(Date.UTC(last.getUTCFullYear(), 0, 1));
    else {
      const months = { "1M": 1, "3M": 3, "1Y": 12 }[range];
      d = new Date(last);
      d.setUTCMonth(d.getUTCMonth() - months);
    }
    const iso = d.toISOString().slice(0, 10);
    // last close on or before the start date (the base), else first available
    let idx = 0;
    for (let i = 0; i < hist.length; i++) { if (hist[i][0] <= iso) idx = i; else break; }
    return idx;
  }

  function stats(sym) {
    const m = state.market && state.market.symbols && state.market.symbols[sym];
    if (!m) return null;
    const h = m.history || [];
    const out = { price: m.price, currency: m.currency, stale: !!m.stale };
    out.day = m.prev_close ? m.price / m.prev_close - 1 : null;
    const i = rangeStart(h, state.range);
    out.range = i != null && h[i] ? m.price / h[i][1] - 1 : null;
    const i1y = rangeStart(h, "1Y");
    out.y1 = i1y != null && h[i1y] ? m.price / h[i1y][1] - 1 : null;
    const closes = h.map((x) => x[1]).concat([m.price]);
    out.lo = Math.min(...closes);
    out.hi = Math.max(...closes);
    return out;
  }

  // ---------- load ----------
  async function load() {
    const theme = safeGet("theme");
    if (theme) document.documentElement.setAttribute("data-theme", theme);

    state.watch = await fetch("data/watchlist.json", { cache: "no-store" }).then((r) => r.json());
    try {
      const r = await fetch("data/market.json", { cache: "no-store" });
      if (r.ok) state.market = await r.json();
    } catch (e) { /* no data yet */ }

    const savedCmp = (safeGet("compare") || "VOO,QQQ,ACHR,RGTI").split(",").filter(Boolean);
    savedCmp.slice(0, MAX_CMP).forEach((s, i) => {
      if (state.watch.symbols.some((x) => x.symbol === s)) state.compare.set(s, i);
    });
    state.range = safeGet("range") || "1Y";

    buildControls();
    renderAll();
    $("#themeBtn").addEventListener("click", toggleTheme);
    document.querySelectorAll("th[data-sort]").forEach((th) =>
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === "symbol" || k === "group" ? 1 : -1 };
        renderTable();
      })
    );
  }

  function safeGet(k) { try { return localStorage.getItem("inv." + k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem("inv." + k, v); } catch (e) { /* ignore */ } }

  function toggleTheme() {
    const root = document.documentElement;
    const isDark = root.getAttribute("data-theme")
      ? root.getAttribute("data-theme") === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = isDark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    safeSet("theme", next);
    renderCharts();
  }

  // ---------- controls ----------
  function buildControls() {
    const g = $("#groupSeg");
    const groups = [{ id: "all", label: "All" }].concat(state.watch.groups);
    g.innerHTML = groups.map((x) => `<button type="button" data-g="${x.id}">${esc(x.label)}</button>`).join("");
    g.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      state.group = b.dataset.g; renderAll();
    });
    const r = $("#rangeSeg");
    r.innerHTML = RANGES.map((x) => `<button type="button" data-r="${x.id}">${x.label}</button>`).join("");
    r.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      state.range = b.dataset.r; safeSet("range", state.range); renderAll();
    });
  }

  function syncControls() {
    document.querySelectorAll("#groupSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.g === state.group)));
    document.querySelectorAll("#rangeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.r === state.range)));
    $("#rangeHead").textContent = state.range;
  }

  // ---------- render ----------
  function renderAll() {
    syncControls();
    renderHeader();
    renderTiles();
    renderTable();
    renderCharts();
  }

  function visibleSymbols() {
    return state.watch.symbols.filter((s) => state.group === "all" || s.group === state.group);
  }

  function renderHeader() {
    const n = state.watch.symbols.length;
    const gen = state.market && state.market.generated;
    const when = gen ? new Date(gen).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null;
    $("#subline").textContent = `${n} holdings · ` + (when ? `Prices updated ${when}` : "Waiting for first price update");
    const banner = $("#banner");
    if (!state.market) {
      banner.hidden = false;
      banner.innerHTML = "<strong>No prices yet.</strong> They appear after the “Update prices” GitHub Action runs (it runs automatically each weekday after the close, or start it from the repo’s Actions tab).";
    } else if (state.market.failed && state.market.failed.length) {
      banner.hidden = false;
      banner.innerHTML = `<strong>Some prices didn’t update:</strong> ${state.market.failed.map(esc).join(", ")}. Showing the last good data where available.`;
    } else banner.hidden = true;
    const srcs = state.market ? [...new Set(Object.values(state.market.symbols).map((m) => m.source))].join(" and ") : "";
    $("#footSource").textContent = srcs ? `Prices: ${srcs}, end-of-day closes, refreshed by GitHub Actions.` : "";
  }

  function renderTiles() {
    const rows = visibleSymbols().map((s) => ({ s, st: stats(s.symbol) })).filter((r) => r.st);
    const tile = (label, value, meta, c) =>
      `<div class="tile"><div class="label">${label}</div><div class="value ${c || ""}">${value}</div><div class="meta">${meta}</div></div>`;
    if (!rows.length) {
      $("#tiles").innerHTML = tile("Holdings", visibleSymbols().length, "Prices pending") +
        tile("Up today", "—", "") + tile(`Best ${state.range}`, "—", "") + tile(`Worst ${state.range}`, "—", "");
      return;
    }
    const up = rows.filter((r) => r.st.day > 0).length;
    const byRange = rows.filter((r) => r.st.range != null).sort((a, b) => b.st.range - a.st.range);
    const best = byRange[0], worst = byRange[byRange.length - 1];
    const byDay = rows.filter((r) => r.st.day != null).sort((a, b) => b.st.day - a.st.day)[0];
    $("#tiles").innerHTML =
      tile("Up today", `${up} of ${rows.length}`, byDay ? `Biggest move: ${byDay.s.symbol} ${fmtPct(byDay.st.day)}` : "") +
      tile(`Best ${state.range}`, best ? best.s.symbol : "—", best ? `${fmtPct(best.st.range)} · ${esc(best.s.name)}` : "", "") +
      tile(`Worst ${state.range}`, worst ? worst.s.symbol : "—", worst ? `${fmtPct(worst.st.range)} · ${esc(worst.s.name)}` : "") +
      tile("VOO vs QQQ", vsLabel(), `${state.range} return, S&P 500 vs Nasdaq-100`);
  }

  function vsLabel() {
    const a = stats("VOO"), b = stats("QQQ");
    if (!a || !b || a.range == null || b.range == null) return "—";
    return `${fmtPct(a.range)} / ${fmtPct(b.range)}`;
  }

  function renderTable() {
    const groupOrder = state.watch.groups.map((g) => g.id);
    const rows = visibleSymbols().map((s) => ({ s, st: stats(s.symbol) || {} }));
    const { key, dir } = state.sort;
    const val = (r) => {
      if (key === "symbol") return r.s.symbol;
      if (key === "group") return groupOrder.indexOf(r.s.group);
      return r.st[key];
    };
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      const a = th.querySelector(".arrow"); if (a) a.remove();
      if (th.dataset.sort === key) th.insertAdjacentHTML("beforeend", `<span class="arrow">${dir > 0 ? "▲" : "▼"}</span>`);
    });

    $("#table tbody").innerHTML = rows.map(({ s, st }) => {
      const checked = state.compare.has(s.symbol);
      const disabled = !checked && state.compare.size >= MAX_CMP;
      let r52 = "—";
      if (st.lo != null && st.hi > st.lo) {
        const pos = ((st.price - st.lo) / (st.hi - st.lo)) * 100;
        r52 = `<div class="range52"><span>${st.lo.toFixed(2)}</span><span class="track"><span class="dot" style="left:${pos.toFixed(1)}%"></span></span><span>${st.hi.toFixed(2)}</span></div>`;
      }
      return `<tr>
        <td class="c-cmp"><input type="checkbox" data-sym="${s.symbol}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} aria-label="Compare ${s.symbol}"></td>
        <td><span class="sym">${s.symbol}</span>${st.stale ? '<span class="stale">(stale)</span>' : ""}<span class="name" title="${esc(s.name)} — ${esc(s.about)}">${esc(s.name)}</span></td>
        <td class="c-group">${esc(groupLabel(s.group))}</td>
        <td class="num">${fmtPrice(st.price, st.currency)}</td>
        <td class="num ${cls(st.day)}">${arrow(st.day)}${fmtPct(st.day)}</td>
        <td class="num ${cls(st.range)}">${arrow(st.range)}${fmtPct(st.range)}</td>
        <td class="c-52">${r52}</td>
      </tr>`;
    }).join("");

    document.querySelectorAll("#table input[type=checkbox]").forEach((cb) =>
      cb.addEventListener("change", () => {
        const sym = cb.dataset.sym;
        if (cb.checked) {
          const used = new Set(state.compare.values());
          const slot = [0, 1, 2, 3].find((i) => !used.has(i));
          state.compare.set(sym, slot);
        } else state.compare.delete(sym);
        safeSet("compare", [...state.compare.keys()].join(","));
        renderTable();
        renderCompare();
      })
    );
  }

  // ---------- charts ----------
  function baseOpts() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      font: { family: css("--font") }
    };
  }

  function renderCharts() {
    if (typeof Chart === "undefined") return;
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    Chart.defaults.color = css("--muted");
    renderCompare();
    renderEbitda();
  }

  // Direct labels at the right end of each line
  const endLabels = {
    id: "endLabels",
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      const placed = [];
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        const pt = meta.data[meta.data.length - 1];
        if (!pt) return;
        let y = pt.y;
        placed.forEach((p) => { if (Math.abs(p - y) < 14) y = p + (y >= p ? 14 : -14); });
        placed.push(y);
        ctx.save();
        ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.fillStyle = css("--text");
        ctx.textBaseline = "middle";
        ctx.fillText(ds.label, chartArea.right + 8, Math.min(Math.max(y, chartArea.top + 6), chartArea.bottom - 6));
        ctx.restore();
      });
    }
  };

  function renderCompare() {
    if (typeof Chart === "undefined") return;
    const box = $("#cmpChart").parentElement;
    const syms = [...state.compare.keys()].filter((s) => state.market && state.market.symbols[s]);
    $("#cmpTitle").textContent = `Growth of $100 · ${state.range}`;
    $("#cmpHint").textContent = syms.length
      ? "What $100 invested at the start of the period would be worth now, price only (dividends not included)."
      : "";
    if (state.charts.cmp) { state.charts.cmp.destroy(); state.charts.cmp = null; }
    if (!syms.length) {
      $("#cmpLegend").innerHTML = "";
      box.innerHTML = `<div class="empty-chart">${state.market ? "Tick rows in the watchlist to compare them here." : "The chart appears once prices have loaded."}</div>`;
      return;
    }
    if (!box.querySelector("canvas")) box.innerHTML = '<canvas id="cmpChart" aria-label="Comparison chart"></canvas>';

    // Union of dates within range, from the first selected symbol's calendar
    const series = syms.map((sym) => {
      const h = state.market.symbols[sym].history;
      const i = rangeStart(h, state.range);
      const slice = h.slice(i);
      const base = slice[0][1];
      return { sym, map: new Map(slice.map(([d, c]) => [d, (c / base) * 100])) };
    });
    const dates = [...new Set(series.flatMap((s) => [...s.map.keys()]))].sort();

    $("#cmpLegend").innerHTML = syms.map((s) =>
      `<span class="key"><i style="background:var(${SLOTS[state.compare.get(s)]})"></i>${s}</span>`).join("");

    state.charts.cmp = new Chart($("#cmpChart"), {
      type: "line",
      data: {
        labels: dates,
        datasets: series.map((s) => {
          const color = css(SLOTS[state.compare.get(s.sym)]);
          return {
            label: s.sym,
            data: dates.map((d) => (s.map.has(d) ? +s.map.get(d).toFixed(2) : null)),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBorderWidth: 2,
            pointHoverBorderColor: css("--surface"),
            spanGaps: true,
            tension: 0
          };
        })
      },
      options: Object.assign(baseOpts(), {
        layout: { padding: { right: 48 } },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: css("--surface"),
            titleColor: css("--text"),
            bodyColor: css("--text"),
            borderColor: css("--border"),
            borderWidth: 1,
            padding: 10,
            boxPadding: 4,
            usePointStyle: true,
            callbacks: {
              title: (items) => new Date(items[0].label + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
              label: (it) => ` ${it.dataset.label}  $${it.parsed.y.toFixed(2)}  (${fmtPct(it.parsed.y / 100 - 1)})`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: css("--axis") },
            ticks: {
              maxTicksLimit: 6, maxRotation: 0,
              callback: function (v) {
                const d = new Date(this.getLabelForValue(v) + "T00:00:00Z");
                return d.toLocaleDateString("en-US", { month: "short", day: state.range === "1M" ? "numeric" : undefined, timeZone: "UTC" });
              }
            }
          },
          y: {
            grid: { color: css("--grid") },
            border: { display: false },
            ticks: { callback: (v) => "$" + v, maxTicksLimit: 6 }
          }
        }
      }),
      plugins: [endLabels, {
        id: "baseline100",
        beforeDatasetsDraw(chart) {
          const y = chart.scales.y.getPixelForValue(100);
          if (y < chart.chartArea.top || y > chart.chartArea.bottom) return;
          const c = chart.ctx; c.save();
          c.strokeStyle = css("--axis"); c.setLineDash([4, 4]); c.lineWidth = 1;
          c.beginPath(); c.moveTo(chart.chartArea.left, y); c.lineTo(chart.chartArea.right, y); c.stroke();
          c.restore();
        }
      }]
    });
  }

  function renderEbitda() {
    if (typeof Chart === "undefined") return;
    const sc = state.watch.ebitda_screen;
    const rows = sc.rows.slice().sort((a, b) => b.ebitda_b - a.ebitda_b);
    $("#ebitdaHint").textContent =
      `The four largest energy and four largest tech companies by trailing twelve-month EBITDA, screened ${new Date(sc.screened_on + "T00:00:00Z").toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}. Billions of US dollars.`;
    $("#ebitdaMethod").textContent = sc.method + " " + (sc.next_in_line || "");
    $("#ebitdaSources").innerHTML = rows.map((r) =>
      `<li>${r.symbol}: $${r.ebitda_b.toFixed(1)}B, twelve months to ${r.period_end}${r.note ? " (" + esc(r.note) + ")" : ""} · <a href="${esc(r.source)}" target="_blank" rel="noopener">source</a></li>`).join("");

    if (state.charts.ebitda) state.charts.ebitda.destroy();
    const colors = rows.map((r) => css(r.sector === "tech" ? "--series-1" : "--series-2"));
    state.charts.ebitda = new Chart($("#ebitdaChart"), {
      type: "bar",
      data: {
        labels: rows.map((r) => r.symbol),
        datasets: [{
          label: "TTM EBITDA",
          data: rows.map((r) => r.ebitda_b),
          backgroundColor: colors,
          borderRadius: { topRight: 4, bottomRight: 4 },
          borderSkipped: "left",
          barPercentage: 0.7,
          categoryPercentage: 0.9
        }]
      },
      options: Object.assign(baseOpts(), {
        indexAxis: "y",
        layout: { padding: { right: 56 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: css("--surface"), titleColor: css("--text"), bodyColor: css("--text"),
            borderColor: css("--border"), borderWidth: 1, padding: 10,
            callbacks: {
              title: (it) => {
                const r = rows[it[0].dataIndex];
                const s = state.watch.symbols.find((x) => x.symbol === r.symbol);
                return `${r.symbol} · ${s ? s.name : ""}`;
              },
              label: (it) => ` $${it.parsed.x.toFixed(1)}B, 12 months to ${rows[it.dataIndex].period_end}`
            }
          }
        },
        scales: {
          x: { grid: { color: css("--grid") }, border: { display: false }, ticks: { callback: (v) => "$" + v + "B", maxTicksLimit: 6, maxRotation: 0 } },
          y: { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: css("--text"), font: { weight: "600" } } }
        }
      }),
      plugins: [{
        id: "barValues",
        afterDatasetsDraw(chart) {
          const c = chart.ctx; c.save();
          c.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
          c.fillStyle = css("--text-2"); c.textBaseline = "middle";
          chart.getDatasetMeta(0).data.forEach((bar, i) => c.fillText("$" + rows[i].ebitda_b.toFixed(1) + "B", bar.x + 6, bar.y));
          c.restore();
        }
      }]
    });
  }

  let resizeT;
  window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => state.watch && renderCharts(), 150); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state.watch && renderCharts());

  load().catch((e) => {
    document.getElementById("subline").textContent = "Couldn’t load the watchlist.";
    console.error(e);
  });
})();
