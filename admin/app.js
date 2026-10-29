/* ==========================================================================
   MANUCHIE — private dashboard (vanilla JS, no dependencies)
   Hash routes: #/overview  #/analytics  #/enquiries[/id]  #/contacts[/id]  #/consent  #/settings
   All data comes from /api/admin/* (session cookie + CSRF header). Every value from the
   database is inserted as text, never as HTML.
   ========================================================================== */
(function () {
  "use strict";

  const $ = (s, c = document) => c.querySelector(s);
  const main = $("#main");
  let ME = null;

  /* ---------- small DOM builder ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = Boolean(v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
    for (const kid of kids.flat()) if (kid) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }

  /* ---------- storage (per-viewer conveniences only) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("mz:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("mz:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  /* ---------- API ---------- */
  class ApiError extends Error {}
  async function api(path, { method = "GET", body } = {}) {
    const headers = { Accept: "application/json" };
    if (method !== "GET") { headers["Content-Type"] = "application/json"; headers["X-CSRF-Token"] = ME ? ME.csrf : ""; }
    const res = await fetch("/api/admin/" + path, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    if (res.status === 401) { window.location.replace("/admin/login"); throw new ApiError("signed out"); }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) throw new ApiError((data && (data.message || data.error)) || "Request failed (" + res.status + ")");
    return data;
  }

  /* ---------- formatting ---------- */
  const nf = new Intl.NumberFormat();
  const num = (n) => nf.format(n || 0);
  const pct = (x) => (x * 100).toLocaleString(undefined, { maximumFractionDigits: x < 0.1 ? 1 : 0 }) + "%";
  const when = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const dateOnly = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
  const dayLabel = (d) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(undefined, { type: "region" }); } catch { /* old browser */ }
  const country = (c) => { if (!c || c === "Unknown") return "Unknown"; try { return regionNames ? regionNames.of(c) : c; } catch { return c; } };

  const STATUS = { new: "New", read: "Read", replied: "Replied", in_progress: "In progress", booked: "Booked", closed: "Closed", spam: "Spam" };
  const CLICKS = { spotify: "Spotify", apple_music: "Apple Music", youtube: "YouTube", shazam: "Shazam", instagram: "Instagram", email: "Email / contact", book_session: "Book a session" };
  const SECTIONS = { hero: "Hero", story: "Story", mantra: "Mantra", sound: "Sound", studio: "Studio", gallery: "Gallery", contact: "Contact" };
  const DEVICES = { mobile: "Mobile", tablet: "Tablet", desktop: "Desktop", unknown: "Unknown" };

  const pill = (status) => h("span", { class: "pill " + status }, STATUS[status] || status);
  const consentPill = (c) => c.unsubscribed_at ? h("span", { class: "pill withdrawn" }, "Withdrawn")
    : c.marketing_consent ? h("span", { class: "pill yes" }, "Yes") : h("span", { class: "pill no" }, "No");

  function delta(cur, prev, { invert = false, asPct = false, compact = false } = {}) {
    if (!prev && !cur) return h("span", { class: "delta" }, "No change");
    if (!prev) return h("span", { class: "delta up" }, "New this period");
    const change = asPct ? (cur - prev) * 100 : ((cur - prev) / prev) * 100;
    const dir = Math.abs(change) < 0.5 ? "" : (change > 0) !== invert ? "up" : "down";
    const arrow = change > 0.5 ? "▲" : change < -0.5 ? "▼" : "■";
    const label = asPct ? Math.abs(change).toFixed(1) + " pts" : Math.abs(change).toFixed(0) + "%";
    return h("span", { class: "delta " + dir }, h("span", { "aria-hidden": "true" }, arrow), " " + label,
      compact ? h("span", { class: "vh" }, " vs previous period") : " vs previous");
  }

  function toast(message, bad) {
    const t = $("#toast");
    t.textContent = message;
    t.className = "toast" + (bad ? " bad" : "");
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  function confirmAction(title, text, okLabel) {
    const d = $("#confirmDialog");
    $("#confirmTitle").textContent = title;
    $("#confirmText").textContent = text;
    $("#confirmOk").textContent = okLabel;
    return new Promise((resolve) => {
      d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true });
      d.returnValue = "";
      d.showModal();
    });
  }

  /* ---------- date range (shared by Overview and Analytics) ---------- */
  const range = store.get("range", { preset: "30d", from: "", to: "", compare: true });
  const rangeQuery = () => range.preset === "custom" && range.from && range.to
    ? `range=custom&from=${range.from}&to=${range.to}` : `range=${range.preset === "custom" ? "30d" : range.preset}`;

  function rangeControls(onChange) {
    const presets = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["custom", "Custom"]];
    const from = h("input", { type: "date", value: range.from, "aria-label": "From date" });
    const to = h("input", { type: "date", value: range.to, "aria-label": "To date" });
    const custom = h("span", { class: "custom-range", hidden: range.preset !== "custom" }, from, h("span", { class: "muted" }, "to"), to,
      h("button", { class: "btn", type: "button", onclick: () => {
        if (!from.value || !to.value) { toast("Choose both dates.", true); return; }
        range.from = from.value; range.to = to.value; store.set("range", range); onChange();
      } }, "Apply"));
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Date range" },
      presets.map(([key, label]) => h("button", { type: "button", "aria-pressed": String(range.preset === key), onclick: (e) => {
        range.preset = key; store.set("range", range);
        seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
        custom.hidden = key !== "custom";
        if (key !== "custom") onChange(); else from.focus();
      } }, label)));
    const compare = h("label", { class: "check" }, h("input", { type: "checkbox", checked: range.compare, onchange: (e) => {
      range.compare = e.target.checked; store.set("range", range); onChange();
    } }), "Compare with previous period");
    return h("div", { class: "filters" }, seg, custom, compare);
  }

  const rangeText = (r) => r.from === r.to ? dayLabel(r.from) : `${dayLabel(r.from)} – ${dayLabel(r.to)}`;

  /* ---------- charts ---------- */
  function niceMax(v) {
    if (v <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  /* series: [{day, ...}], lines: [{key, label, cls}], prev: same-length series for a dashed comparison of lines[0] */
  function lineChart(series, lines, prev, title) {
    // Size the drawing to the space it gets, so axis labels stay readable on phones.
    const W = Math.round(Math.max(300, Math.min(720, main.clientWidth - 48))), H = W < 480 ? 200 : 230, L = 40, R = 12, T = 14, B = 28;
    const n = series.length;
    const values = series.flatMap((d) => lines.map((l) => d[l.key]));
    if (prev) values.push(...prev.map((d) => d[lines[0].key]));
    const max = niceMax(Math.max(1, ...values));
    const x = (i) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const path = (rows, key) => rows.map((d, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(d[key]).toFixed(1)).join(" ");

    const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${title}. ${lines.map((l) => `${l.label}: ${num(series.reduce((a, d) => a + d[l.key], 0))} in total`).join(", ")}. A data table follows.` });
    svg.append(s("defs", {}, s("linearGradient", { id: "mzArea", x1: "0", x2: "0", y1: "0", y2: "1" },
      s("stop", { offset: "0%", "stop-color": "#c95c2c", "stop-opacity": "0.28" }),
      s("stop", { offset: "100%", "stop-color": "#c95c2c", "stop-opacity": "0" }))));
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      svg.append(s("line", { class: "grid-line", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      svg.append(s("text", { class: "axis", x: L - 8, y: y(v) + 4, "text-anchor": "end" }, num(Math.round(v))));
    }
    const ticks = n <= (W < 480 ? 4 : 8) ? series.map((_, i) => i) : W < 480 ? [0, Math.round((n - 1) / 2), n - 1] : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
    ticks.forEach((i) => svg.append(s("text", { class: "axis", x: x(i), y: H - 8, "text-anchor": n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle" }, dayLabel(series[i].day))));
    if (n > 1) svg.append(s("path", { class: "area", d: path(series, lines[0].key) + ` L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z` }));
    if (prev && prev.length === n && n > 1) svg.append(s("path", { class: "lp", d: path(prev, lines[0].key) }));
    lines.forEach((l) => { if (n > 1) svg.append(s("path", { class: l.cls, d: path(series, l.key) })); });
    series.forEach((d, i) => {
      const tip = `${dayLabel(d.day)}: ` + lines.map((l) => `${num(d[l.key])} ${l.label.toLowerCase()}`).join(", ") + (prev ? ` (previous period: ${num(prev[i] ? prev[i][lines[0].key] : 0)})` : "");
      const colW = n === 1 ? 40 : (W - L - R) / (n - 1);
      svg.append(s("rect", { class: "hit", x: x(i) - colW / 2, y: T, width: colW, height: H - T - B }, s("title", {}, tip)));
      svg.append(s("circle", { class: "dot", cx: x(i), cy: y(d[lines[0].key]), r: n > 45 ? 0 : 3 }));
    });

    const legend = h("ul", { class: "legend" }, lines.map((l) => h("li", {}, h("i", { class: l.cls }), l.label)),
      prev ? h("li", {}, h("i", { class: "lp" }), `${lines[0].label}, previous period`) : null);
    const table = h("table", {}, h("caption", { class: "vh" }, title),
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Day (UTC)"), lines.map((l) => h("th", { scope: "col", class: "num" }, l.label)))),
      h("tbody", {}, series.map((d) => h("tr", {}, h("th", { scope: "row" }, dayLabel(d.day)), lines.map((l) => h("td", { class: "num" }, num(d[l.key])))))));
    return h("div", {}, svg, legend, h("details", { class: "data" }, h("summary", {}, "Show as a table"), h("div", { class: "table-wrap" }, table)));
  }

  function bars(rows, { label = (r) => r.name, value = (r) => r.n, cls = "", empty = "No data for this period yet." } = {}) {
    if (!rows || !rows.length) return h("p", { class: "empty" }, empty);
    const max = Math.max(1, ...rows.map(value));
    return h("ul", { class: "bars" }, rows.map((r) => h("li", { class: cls, style: { "--w": ((value(r) / max) * 100).toFixed(1) + "%" } },
      h("span", {}, label(r)), h("b", {}, num(value(r))))));
  }

  const card = (k, v, d, accent) => h("div", { class: "card" + (accent ? " card-accent" : "") }, h("span", { class: "card-k" }, k), h("span", { class: "card-v" }, v), d || null);
  const panel = (title, sub, ...body) => h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, title), sub ? h("p", {}, sub) : null), ...body);
  const head = (title, sub, ...right) => h("div", { class: "head" }, h("div", {}, h("h1", {}, title), sub ? h("p", {}, sub) : null), ...right);

  function render(...nodes) {
    main.replaceChildren(...nodes);
  }
  const loading = () => render(h("p", { class: "loading" }, "Loading…"));
  const failed = (err) => render(h("p", { class: "empty" }, "Couldn't load this page: " + err.message + ". Try refreshing."));

  /* ---------- Overview ---------- */
  async function overview() {
    loading();
    const d = await api("overview?" + rangeQuery());
    const c = d.current, p = d.previous, cmp = range.compare;
    const dl = (k, opts) => (cmp ? delta(c[k], p[k], opts) : null);
    render(
      head("Overview", rangeText(d.range) + " · days in UTC", rangeControls(overview)),
      h("div", { class: "grid cards" },
        card("Website visits", num(c.visits), dl("visits")),
        card("Page views", num(c.pageviews), dl("pageviews")),
        card("Unique visitors", num(c.visitors), dl("visitors")),
        card("New enquiries", num(c.enquiries), dl("enquiries"), true),
        card("Unread enquiries", num(d.unread), h("a", { class: "delta", href: "#/enquiries?status=new" }, "Open the inbox →")),
        card("Enquiry conversion", pct(c.conversion), cmp ? delta(c.conversion, p.conversion, { asPct: true }) : null)),
      h("div", { class: "section-gap panel" },
        h("div", { class: "panel-head" }, h("h2", {}, "Visits over time"), h("p", {}, "Visits and page views per day")),
        lineChart(d.series, [{ key: "visits", label: "Visits", cls: "l1" }, { key: "pageviews", label: "Page views", cls: "l2" }], cmp ? d.previousSeries : null, "Visits and page views per day")),
      h("section", { class: "section-gap" },
        h("div", { class: "panel-head" }, h("h2", {}, "Clicks"), h("p", {}, "Streaming, social, email and booking links")),
        h("div", { class: "grid cards small" },
          Object.entries(CLICKS).map(([k, label]) => h("div", { class: "card small-v" }, h("span", { class: "card-k" }, label),
            h("span", { class: "card-v" }, num(c.clicks[k])), cmp ? delta(c.clicks[k], p.clicks[k], { compact: true }) : null)))),
      h("div", { class: "grid two section-gap" },
        panel("Most-viewed sections", "Times each part of the page was seen", bars(d.sections, { label: (r) => SECTIONS[r.name] || r.name })),
        panel("Leading traffic sources", "Visits by where people came from", bars(d.sources, { cls: "gold" }))),
      h("div", { class: "section-gap" }, panel("Recent enquiries", null, recentTable(d.recent))),
    );
    setUnread(d.unread);
  }

  function recentTable(rows) {
    if (!rows.length) return h("p", { class: "empty" }, "No enquiries yet. They'll appear here as soon as someone sends the form.");
    return h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Received"), h("th", { scope: "col" }, "Name"), h("th", { scope: "col", class: "hide-sm" }, "Email"), h("th", { scope: "col" }, "Status"))),
      h("tbody", {}, rows.map((r) => h("tr", { class: r.status === "new" ? "unread" : "" },
        h("td", { class: "nowrap muted" }, when(r.created_at)),
        h("td", {}, h("a", { class: "row-link", href: "#/enquiries/" + r.id }, r.name)),
        h("td", { class: "hide-sm" }, r.email),
        h("td", {}, pill(r.status)))))));
  }

  /* ---------- Analytics ---------- */
  async function analytics() {
    loading();
    const d = await api("analytics?" + rangeQuery());
    const c = d.current, p = d.previous, cmp = range.compare;
    const metric = store.get("metric", "visits");
    const metrics = { visits: "Visits", pageviews: "Page views", visitors: "Unique visitors" };
    const chartBox = h("div");
    const drawChart = (m) => chartBox.replaceChildren(lineChart(d.series, [{ key: m, label: metrics[m], cls: "l1" }], cmp ? d.previousSeries : null, metrics[m] + " per day"));
    drawChart(metric);
    const metricSeg = h("div", { class: "seg", role: "group", "aria-label": "Chart metric" }, Object.entries(metrics).map(([k, label]) =>
      h("button", { type: "button", "aria-pressed": String(k === metric), onclick: (e) => {
        store.set("metric", k); drawChart(k);
        metricSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
      } }, label)));
    const f = d.funnel;
    const funnelRows = [
      { name: "Visited the site", n: f.visits }, { name: "Reached the contact section", n: f.saw_contact },
      { name: "Started the enquiry form", n: f.form_starts }, { name: "Sent an enquiry", n: f.enquiries },
    ];
    const clickRows = Object.entries(CLICKS).map(([k, label]) => ({ name: label, n: c.clicks[k] })).sort((a, b) => b.n - a.n);
    render(
      head("Analytics", rangeText(d.range) + " · anonymous, cookie-free · days in UTC", rangeControls(analytics)),
      h("div", { class: "grid cards" },
        card("Website visits", num(c.visits), cmp ? delta(c.visits, p.visits) : null),
        card("Page views", num(c.pageviews), cmp ? delta(c.pageviews, p.pageviews) : null),
        card("Unique visitors", num(c.visitors), cmp ? delta(c.visitors, p.visitors) : null),
        card("Form starts", num(c.form_starts), cmp ? delta(c.form_starts, p.form_starts) : null),
        card("Enquiries", num(c.enquiries), cmp ? delta(c.enquiries, p.enquiries) : null, true),
        card("Conversion", pct(c.conversion), cmp ? delta(c.conversion, p.conversion, { asPct: true }) : null)),
      h("section", { class: "panel section-gap" }, h("div", { class: "panel-head" }, h("h2", {}, "Traffic"), metricSeg), chartBox),
      h("div", { class: "grid two section-gap" },
        panel("Enquiry funnel", "From first visit to a sent enquiry", bars(funnelRows, { empty: "No visits yet." })),
        panel("Outbound clicks", "Streaming, social and booking links", bars(clickRows, { cls: "gold" }))),
      h("div", { class: "grid three section-gap" },
        panel("Traffic sources", "Visits by source", bars(d.sources)),
        panel("Sections viewed", null, bars(d.sections, { label: (r) => SECTIONS[r.name] || r.name, cls: "gold" })),
        panel("Devices", "Visits by device", bars(d.devices, { label: (r) => DEVICES[r.name] || r.name }))),
      h("div", { class: "grid two section-gap" },
        panel("Countries", "Broad location from the network, never precise", bars(d.countries, { label: (r) => country(r.name), cls: "gold" })),
        panel("Campaigns", "Visits from links tagged with UTM parameters", campaignTable(d.campaigns))),
      h("div", { class: "section-gap" }, panel("Pages", null, bars(d.pages, { label: (r) => r.name }))),
    );
  }

  function campaignTable(rows) {
    if (!rows.length) return h("p", { class: "empty" }, "No tagged campaign links in this period. Add ?utm_source=…&utm_campaign=… to links you share.");
    return h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Source"), h("th", { scope: "col" }, "Medium"), h("th", { scope: "col" }, "Campaign"), h("th", { scope: "col", class: "num" }, "Visits"))),
      h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, r.source), h("td", {}, r.medium || "—"), h("td", {}, r.campaign || "—"), h("td", { class: "num" }, num(r.n)))))));
  }

  /* ---------- Enquiries ---------- */
  const enqState = { q: "", status: "", from: "", to: "", page: 1, selected: new Set() };

  async function enquiries(params) {
    if (params.has("status")) enqState.status = params.get("status");
    const qs = new URLSearchParams({ page: enqState.page, per: 25 });
    if (enqState.q) qs.set("q", enqState.q);
    if (enqState.status) qs.set("status", enqState.status);
    if (enqState.from) qs.set("from", enqState.from);
    if (enqState.to) qs.set("to", enqState.to);
    const d = await api("enquiries?" + qs);
    setUnread(d.counts.new || 0);
    const reload = () => { enqState.page = 1; enquiries(new URLSearchParams()).catch(failed); };

    const search = h("input", { type: "search", placeholder: "Search by name or email", value: enqState.q, "aria-label": "Search enquiries" });
    let t;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { enqState.q = search.value.trim(); reload(); }, 300); });
    const statusSel = h("select", { "aria-label": "Status", onchange: (e) => { enqState.status = e.target.value; reload(); } },
      h("option", { value: "" }, "All (without spam)"),
      Object.entries(STATUS).map(([k, label]) => h("option", { value: k }, label)),
      h("option", { value: "all" }, "Everything, including spam"));
    statusSel.value = enqState.status;
    const from = h("input", { type: "date", value: enqState.from, "aria-label": "Received from", onchange: (e) => { enqState.from = e.target.value; reload(); } });
    const to = h("input", { type: "date", value: enqState.to, "aria-label": "Received until", onchange: (e) => { enqState.to = e.target.value; reload(); } });

    const exportQs = new URLSearchParams(qs); exportQs.delete("page"); exportQs.delete("per");
    const selCount = h("span", { class: "muted" });
    const exportSel = h("a", { class: "btn", href: "#", onclick: (e) => {
      if (!enqState.selected.size) { e.preventDefault(); toast("Select at least one enquiry first.", true); return; }
      e.currentTarget.href = "/api/admin/enquiries.csv?ids=" + [...enqState.selected].join(",");
    } }, "Export selected");
    const updateSel = () => { selCount.textContent = enqState.selected.size ? `${enqState.selected.size} selected` : ""; };
    updateSel();

    const allBox = h("input", { type: "checkbox", "aria-label": "Select all on this page", onchange: (e) => {
      d.rows.forEach((r) => (e.target.checked ? enqState.selected.add(r.id) : enqState.selected.delete(r.id)));
      main.querySelectorAll("input[data-id]").forEach((b) => { b.checked = e.target.checked; });
      updateSel();
    } });

    const chips = h("div", { class: "chips", role: "group", "aria-label": "Quick status filters" },
      [["", "Active"], ["new", "New"], ["in_progress", "In progress"], ["booked", "Booked"], ["spam", "Spam"]].map(([k, label]) =>
        h("button", { type: "button", class: "chip", "aria-pressed": String(enqState.status === k), onclick: () => { enqState.status = k; reload(); } },
          label, h("b", {}, num(k ? d.counts[k] || 0 : Object.entries(d.counts).filter(([s]) => s !== "spam").reduce((a, [, n]) => a + n, 0))))));

    const pages = Math.max(1, Math.ceil(d.total / d.per));
    render(
      head("Enquiries", `${num(d.total)} ${d.total === 1 ? "enquiry" : "enquiries"} match`,
        h("div", { class: "actions" }, h("a", { class: "btn", href: "/api/admin/enquiries.csv?" + exportQs }, "Export all matching (CSV)"))),
      chips,
      h("div", { class: "toolbar" }, h("div", { class: "grow" }, search), statusSel, from, to, selCount, exportSel),
      h("section", { class: "panel" },
        !d.rows.length ? h("p", { class: "empty" }, enqState.q || enqState.status || enqState.from || enqState.to ? "Nothing matches these filters." : "No enquiries yet.")
        : h("div", { class: "table-wrap" }, h("table", {},
          h("caption", { class: "vh" }, "Enquiries, newest first"),
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, allBox), ["Received", "Name", "Email"].map((x) => h("th", { scope: "col" }, x)),
            h("th", { scope: "col", class: "hide-sm" }, "Message"), h("th", { scope: "col" }, "Status"), h("th", { scope: "col", class: "hide-sm" }, "Marketing"))),
          h("tbody", {}, d.rows.map((r) => h("tr", { class: r.status === "new" ? "unread" : "" },
            h("td", {}, h("input", { type: "checkbox", "data-id": r.id, checked: enqState.selected.has(r.id), "aria-label": "Select enquiry from " + r.name, onchange: (e) => {
              e.target.checked ? enqState.selected.add(r.id) : enqState.selected.delete(r.id); updateSel();
            } })),
            h("td", { class: "nowrap muted" }, when(r.created_at)),
            h("td", {}, h("a", { class: "row-link", href: "#/enquiries/" + r.id }, r.name), r.has_notes ? h("span", { class: "muted", title: "Has notes" }, " ✎") : null),
            h("td", {}, r.email),
            h("td", { class: "hide-sm" }, h("div", { class: "preview" }, r.preview + (r.truncated ? "…" : ""))),
            h("td", {}, pill(r.status)),
            h("td", { class: "hide-sm" }, r.marketing_consent ? h("span", { class: "pill yes" }, "Opted in") : h("span", { class: "muted" }, "—"))))))),
        h("div", { class: "pager" }, h("span", {}, `Page ${d.page} of ${pages}`), h("div", { class: "actions" },
          h("button", { class: "btn", type: "button", disabled: d.page <= 1, onclick: () => { enqState.page--; enquiries(new URLSearchParams()).catch(failed); } }, "Previous"),
          h("button", { class: "btn", type: "button", disabled: d.page >= pages, onclick: () => { enqState.page++; enquiries(new URLSearchParams()).catch(failed); } }, "Next")))));
  }

  async function enquiry(id) {
    loading();
    const { enquiry: e, contact } = await api("enquiries/" + id);
    refreshUnread();
    const save = async (body, msg) => {
      try { await api("enquiries/" + id, { method: "PATCH", body }); toast(msg); enquiry(id).catch(failed); }
      catch (err) { toast(err.message, true); }
    };
    const statusSel = h("select", { "aria-label": "Status" }, Object.entries(STATUS).map(([k, label]) => h("option", { value: k }, label)));
    statusSel.value = e.status;
    statusSel.addEventListener("change", () => save({ status: statusSel.value }, "Status changed to " + STATUS[statusSel.value] + "."));
    const notes = h("textarea", { id: "notes", rows: "5", placeholder: "Private notes — only you can see these." }, e.notes);
    const subject = "Re: your enquiry via manuchie.org";
    const campaign = [e.utm_source, e.utm_medium, e.utm_campaign].filter(Boolean).join(" / ");
    render(
      h("a", { class: "back", href: "#/enquiries" }, "← All enquiries"),
      head(e.name, "Received " + when(e.created_at)),
      h("div", { class: "detail" },
        h("div", { class: "stack" },
          panel("The project", null, h("p", { class: "message" }, e.message)),
          h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, h("label", { for: "notes" }, "Private notes"))), notes,
            h("div", { class: "actions section-gap" }, h("button", { class: "btn btn-primary", type: "button", onclick: () => save({ notes: notes.value }, "Notes saved.") }, "Save notes")))),
        h("div", { class: "stack" },
          h("section", { class: "panel" },
            h("div", { class: "panel-head" }, h("h2", {}, "Status"), pill(e.status)),
            h("div", { class: "stack" }, statusSel,
              h("div", { class: "actions" },
                h("a", { class: "btn btn-terra", href: `mailto:${encodeURIComponent(e.email)}?subject=${encodeURIComponent(subject)}` }, "Reply by email"),
                h("button", { class: "btn", type: "button", onclick: () => save({ replied: true }, "Recorded that you replied.") }, "Record reply sent")),
              e.last_contacted_at ? h("p", { class: "muted" }, "Last contacted " + when(e.last_contacted_at)) : null)),
          h("section", { class: "panel" },
            h("div", { class: "panel-head" }, h("h2", {}, "Details")),
            h("dl", { class: "meta" },
              h("dt", {}, "Email"), h("dd", {}, e.email, " ", h("button", { class: "btn btn-ghost", type: "button", onclick: async () => {
                try { await navigator.clipboard.writeText(e.email); toast("Email address copied."); } catch { toast("Couldn't copy — select the address instead.", true); }
              } }, "Copy")),
              h("dt", {}, "Marketing"), h("dd", {}, e.marketing_consent ? "Opted in on the form" : "Not given — reply about this enquiry only"),
              h("dt", {}, "Page"), h("dd", {}, e.source_page || "—"),
              h("dt", {}, "Came from"), h("dd", {}, e.referrer || "Direct or unknown"),
              h("dt", {}, "Campaign"), h("dd", {}, campaign || "—"),
              h("dt", {}, "Email to you"), h("dd", {}, { sent: "Delivered to your inbox", failed: "Sending failed — it's safe here", not_configured: "Email not set up yet — see Settings", pending: "Sending…", skipped: "Not sent (spam)" }[e.email_status] || e.email_status),
              e.spam_reason ? [h("dt", {}, "Spam check"), h("dd", {}, { honeypot: "Hidden bot field was filled in", too_fast: "Sent too quickly to be typed", links: "Contains many links" }[e.spam_reason] || e.spam_reason)] : null,
              contact ? [h("dt", {}, "Contact"), h("dd", {}, h("a", { href: "#/contacts/" + contact.id }, `View contact (${contact.enquiry_count} ${contact.enquiry_count === 1 ? "enquiry" : "enquiries"})`))] : null)),
          h("section", { class: "panel" },
            h("div", { class: "panel-head" }, h("h2", {}, "More")),
            h("div", { class: "actions" },
              e.status === "spam"
                ? h("button", { class: "btn", type: "button", onclick: () => save({ status: "new" }, "Moved back to the inbox.") }, "Not spam")
                : h("button", { class: "btn", type: "button", onclick: () => save({ status: "spam" }, "Marked as spam.") }, "Mark as spam"),
              h("a", { class: "btn", href: "/api/admin/enquiries.csv?ids=" + e.id }, "Export CSV"),
              h("button", { class: "btn btn-danger", type: "button", onclick: async () => {
                if (!(await confirmAction("Delete this enquiry?", `The message from ${e.name} will be removed permanently. This can't be undone.`, "Delete enquiry"))) return;
                try { await api("enquiries/" + id, { method: "DELETE" }); toast("Enquiry deleted."); location.hash = "#/enquiries"; }
                catch (err) { toast(err.message, true); }
              } }, "Delete"))))));
  }

  /* ---------- Contacts ---------- */
  const conState = { q: "", consent: "", status: "", tag: "", sort: "latest", dir: "desc", page: 1 };

  async function contacts() {
    const qs = new URLSearchParams({ page: conState.page, per: 25, sort: conState.sort, dir: conState.dir });
    for (const k of ["q", "consent", "status", "tag"]) if (conState[k]) qs.set(k, conState[k]);
    const d = await api("contacts?" + qs);
    const reload = () => { conState.page = 1; contacts().catch(failed); };
    const search = h("input", { type: "search", placeholder: "Search name, email or notes", value: conState.q, "aria-label": "Search contacts" });
    let t;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { conState.q = search.value.trim(); reload(); }, 300); });
    const sel = (key, label, options) => {
      const el = h("select", { "aria-label": label, onchange: (e) => { conState[key] = e.target.value; reload(); } }, options.map(([v, l]) => h("option", { value: v }, l)));
      el.value = conState[key];
      return el;
    };
    const sortSel = h("select", { "aria-label": "Sort", onchange: (e) => { [conState.sort, conState.dir] = e.target.value.split(":"); reload(); } },
      [["latest:desc", "Latest enquiry"], ["created:desc", "Newest added"], ["created:asc", "Oldest added"], ["name:asc", "Name A–Z"], ["enquiries:desc", "Most enquiries"]]
        .map(([v, l]) => h("option", { value: v }, l)));
    sortSel.value = conState.sort + ":" + conState.dir;
    const exportQs = new URLSearchParams(qs); exportQs.delete("page"); exportQs.delete("per");
    const pages = Math.max(1, Math.ceil(d.total / d.per));
    render(
      head("Contacts", `${num(d.total)} ${d.total === 1 ? "person" : "people"} · one record per email address`,
        h("a", { class: "btn", href: "/api/admin/contacts.csv?" + exportQs }, "Export CSV")),
      h("div", { class: "toolbar" }, h("div", { class: "grow" }, search),
        sel("consent", "Marketing consent", [["", "Any consent"], ["yes", "Opted in"], ["no", "Not opted in"], ["withdrawn", "Withdrawn"]]),
        sel("status", "Contact status", [["", "Any status"], ["active", "Active"], ["suppressed", "Suppressed"]]),
        sel("tag", "Tag", [["", "Any tag"], ...d.tags.map((x) => [x.tag, `${x.tag} (${x.n})`])]),
        sortSel),
      h("section", { class: "panel" },
        !d.rows.length ? h("p", { class: "empty" }, "No contacts match.")
        : h("div", { class: "table-wrap" }, h("table", {},
          h("caption", { class: "vh" }, "Contacts"),
          h("thead", {}, h("tr", {}, ["Name", "Email"].map((x) => h("th", { scope: "col" }, x)),
            h("th", { scope: "col", class: "num" }, "Enquiries"), h("th", { scope: "col" }, "Latest"), h("th", { scope: "col" }, "Status"),
            h("th", { scope: "col" }, "Marketing"), h("th", { scope: "col", class: "hide-sm" }, "Source"), h("th", { scope: "col", class: "hide-sm" }, "Tags"), h("th", { scope: "col", class: "hide-sm" }, "Added"))),
          h("tbody", {}, d.rows.map((r) => h("tr", {},
            h("td", {}, h("a", { class: "row-link", href: "#/contacts/" + r.id }, r.name)),
            h("td", {}, r.email),
            h("td", { class: "num" }, num(r.enquiry_count)),
            h("td", { class: "nowrap" }, r.latest_status ? pill(r.latest_status) : "—", " ", h("span", { class: "muted" }, dateOnly(r.latest_enquiry))),
            h("td", {}, r.status === "suppressed" ? h("span", { class: "pill suppressed" }, "Suppressed") : h("span", { class: "muted" }, "Active")),
            h("td", { class: "nowrap" }, consentPill(r), r.consent_at && r.marketing_consent ? h("span", { class: "muted" }, " " + dateOnly(r.consent_at)) : null),
            h("td", { class: "hide-sm" }, r.source || "—"),
            h("td", { class: "hide-sm" }, r.tags.map((x) => h("span", { class: "tag" }, x))),
            h("td", { class: "hide-sm nowrap muted" }, dateOnly(r.created_at))))))),
        h("div", { class: "pager" }, h("span", {}, `Page ${d.page} of ${pages}`), h("div", { class: "actions" },
          h("button", { class: "btn", type: "button", disabled: d.page <= 1, onclick: () => { conState.page--; contacts().catch(failed); } }, "Previous"),
          h("button", { class: "btn", type: "button", disabled: d.page >= pages, onclick: () => { conState.page++; contacts().catch(failed); } }, "Next")))));
  }

  async function contact(id) {
    loading();
    const { contact: c, enquiries: list, consent } = await api("contacts/" + id);
    const save = async (body, msg) => {
      try { await api("contacts/" + id, { method: "PATCH", body }); toast(msg); contact(id).catch(failed); }
      catch (err) { toast(err.message, true); }
    };
    const tags = h("input", { type: "text", id: "tags", value: c.tags.join(", "), placeholder: "e.g. church, label, artist" });
    const notes = h("textarea", { id: "cnotes", rows: "4", placeholder: "Private notes about this person." }, c.notes);
    render(
      h("a", { class: "back", href: "#/contacts" }, "← All contacts"),
      head(c.name, c.email),
      h("div", { class: "detail" },
        h("div", { class: "stack" },
          panel("Enquiries", null, list.length ? h("div", { class: "table-wrap" }, h("table", {},
            h("thead", {}, h("tr", {}, ["Received", "Message", "Status"].map((x) => h("th", { scope: "col" }, x)))),
            h("tbody", {}, list.map((e) => h("tr", {},
              h("td", { class: "nowrap" }, h("a", { class: "row-link", href: "#/enquiries/" + e.id }, when(e.created_at))),
              h("td", {}, h("div", { class: "preview" }, e.preview)), h("td", {}, pill(e.status)))))))
            : h("p", { class: "empty" }, "No enquiries.")),
          panel("Consent history", "Proof of what this person agreed to, and when",
            consent.length ? h("ul", { class: "bars" }, consent.map((r) => h("li", { class: r.action === "granted" ? "gold" : "" },
              h("span", {}, `${r.action === "granted" ? "Opted in" : "Withdrawn"} · ${when(r.created_at)} · ${r.method}`), h("b", {}, ""))))
            : h("p", { class: "empty" }, "Never opted in to marketing.")),
          consent.filter((r) => r.action === "granted").slice(0, 1).map((r) => h("p", { class: "note" }, "Wording agreed to: “" + r.wording + "”"))),
        h("div", { class: "stack" },
          h("section", { class: "panel" },
            h("div", { class: "panel-head" }, h("h2", {}, "Details")),
            h("dl", { class: "meta" },
              h("dt", {}, "Added"), h("dd", {}, when(c.created_at)),
              h("dt", {}, "Source"), h("dd", {}, c.source || "—"),
              h("dt", {}, "Enquiries"), h("dd", {}, num(c.enquiry_count)),
              h("dt", {}, "Last contacted"), h("dd", {}, when(c.last_contacted_at)),
              h("dt", {}, "Marketing"), h("dd", {}, consentPill(c), c.marketing_consent && c.consent_at ? " since " + dateOnly(c.consent_at) : ""),
              h("dt", {}, "Status"), h("dd", {}, c.status === "suppressed" ? "Suppressed — never include in marketing" : "Active"))),
          h("section", { class: "panel" },
            h("div", { class: "stack" },
              h("label", { class: "fld", for: "tags" }, h("span", {}, "Tags (comma-separated)"), tags),
              h("label", { class: "fld", for: "cnotes" }, h("span", {}, "Private notes"), notes),
              h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "button", onclick: () => save({ tags: tags.value, notes: notes.value }, "Contact saved.") }, "Save")))),
          h("section", { class: "panel" },
            h("div", { class: "panel-head" }, h("h2", {}, "Privacy")),
            h("div", { class: "actions" },
              c.marketing_consent ? h("button", { class: "btn", type: "button", onclick: async () => {
                if (await confirmAction("Unsubscribe this person?", "Their marketing consent will be recorded as withdrawn. They'll stay in your contacts for enquiries.", "Unsubscribe")) save({ unsubscribe: true }, "Unsubscribed. Withdrawal recorded.");
              } }, "Unsubscribe") : null,
              h("button", { class: "btn", type: "button", onclick: () => save({ suppressed: c.status !== "suppressed" }, c.status === "suppressed" ? "No longer suppressed." : "Suppressed from all marketing exports.") },
                c.status === "suppressed" ? "Remove suppression" : "Suppress"),
              h("a", { class: "btn", href: `/api/admin/contacts/${c.id}/export` }, "Export their data (JSON)"),
              h("button", { class: "btn btn-danger", type: "button", onclick: async () => {
                if (!(await confirmAction("Delete this person?", `${c.name}, their ${c.enquiry_count} ${c.enquiry_count === 1 ? "enquiry" : "enquiries"} and their consent history will be erased permanently.`, "Delete everything"))) return;
                try { await api("contacts/" + id, { method: "DELETE" }); toast("Contact and their data deleted."); location.hash = "#/contacts"; }
                catch (err) { toast(err.message, true); }
              } }, "Delete"))))));
  }

  /* ---------- Marketing consent ---------- */
  const consentState = { q: "", action: "", page: 1 };

  async function consentPage() {
    const qs = new URLSearchParams({ page: consentState.page, per: 25 });
    if (consentState.q) qs.set("q", consentState.q);
    if (consentState.action) qs.set("action", consentState.action);
    const d = await api("consent?" + qs);
    const sm = d.summary || {};
    const search = h("input", { type: "search", placeholder: "Search name or email", value: consentState.q, "aria-label": "Search consent records" });
    let t;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { consentState.q = search.value.trim(); consentState.page = 1; consentPage().catch(failed); }, 300); });
    const actionSel = h("select", { "aria-label": "Record type", onchange: (e) => { consentState.action = e.target.value; consentState.page = 1; consentPage().catch(failed); } },
      h("option", { value: "" }, "All records"), h("option", { value: "granted" }, "Opted in"), h("option", { value: "withdrawn" }, "Withdrawn"));
    actionSel.value = consentState.action;
    render(
      head("Marketing consent", "Who has agreed to hear about new music and projects",
        h("a", { class: "btn btn-primary", href: "/api/admin/consent.csv" }, "Export marketing list (CSV)")),
      h("div", { class: "grid cards" },
        card("Can be emailed", num(sm.marketable), h("span", { class: "delta" }, "Opted in, active, not withdrawn"), true),
        card("Withdrawn", num(sm.withdrawn)), card("Suppressed", num(sm.suppressed)), card("All contacts", num(sm.contacts))),
      h("p", { class: "note section-gap" }, "An enquiry is not permission to market. Only people who ticked the optional box on the form appear in the export, and anyone who withdrew or whom you suppressed is left out. The export is ready to import into an email platform; this dashboard doesn't send bulk email."),
      h("div", { class: "toolbar section-gap" }, h("div", { class: "grow" }, search), actionSel),
      h("section", { class: "panel" },
        !d.rows.length ? h("p", { class: "empty" }, "No consent records yet.")
        : h("div", { class: "table-wrap" }, h("table", {},
          h("caption", { class: "vh" }, "Consent records, newest first"),
          h("thead", {}, h("tr", {}, ["When", "Name", "Email", "Record", "How", "Wording"].map((x, i) => h("th", { scope: "col", class: i === 5 ? "hide-sm" : null }, x)))),
          h("tbody", {}, d.rows.map((r) => h("tr", {},
            h("td", { class: "nowrap muted" }, when(r.created_at)),
            h("td", {}, h("a", { class: "row-link", href: "#/contacts/" + r.contact_id }, r.name)),
            h("td", {}, r.email),
            h("td", {}, h("span", { class: "pill " + (r.action === "granted" ? "yes" : "withdrawn") }, r.action === "granted" ? "Opted in" : "Withdrawn")),
            h("td", {}, r.method + (r.source_page ? " · " + r.source_page : "")),
            h("td", { class: "hide-sm" }, h("div", { class: "preview" }, r.wording))))))),
        h("div", { class: "pager" }, h("span", {}, `Page ${d.page}`), h("div", { class: "actions" },
          h("button", { class: "btn", type: "button", disabled: d.page <= 1, onclick: () => { consentState.page--; consentPage().catch(failed); } }, "Previous"),
          h("button", { class: "btn", type: "button", disabled: d.rows.length < d.per, onclick: () => { consentState.page++; consentPage().catch(failed); } }, "Next")))));
  }

  /* ---------- Settings ---------- */
  async function settings() {
    loading();
    const d = await api("settings");
    const cur = h("input", { type: "password", autocomplete: "current-password", id: "pwCur", required: true });
    const next = h("input", { type: "password", autocomplete: "new-password", id: "pwNew", minlength: "12", required: true });
    const again = h("input", { type: "password", autocomplete: "new-password", id: "pwAgain", required: true });
    const err = h("p", { class: "form-error", role: "alert" });
    const form = h("form", { class: "stack", onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      if (next.value.length < 12) { err.textContent = "Use at least 12 characters."; next.focus(); return; }
      if (next.value !== again.value) { err.textContent = "The new passwords don't match."; again.focus(); return; }
      try {
        await api("settings/password", { method: "POST", body: { current: cur.value, next: next.value } });
        form.reset(); toast("Password changed. Other devices have been signed out."); settings().catch(failed);
      } catch (x) { err.textContent = x.message; }
    } },
      h("label", { class: "fld", for: "pwCur" }, h("span", {}, "Current password"), cur),
      h("div", { class: "form-row" }, h("label", { class: "fld", for: "pwNew" }, h("span", {}, "New password (12+ characters)"), next),
        h("label", { class: "fld", for: "pwAgain" }, h("span", {}, "New password again"), again)),
      err, h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "submit" }, "Change password")));
    const em = d.email;
    render(
      head("Settings", "Account, security and email delivery"),
      h("div", { class: "grid two" },
        panel("Account", null, h("dl", { class: "meta" },
          h("dt", {}, "Signed in as"), h("dd", {}, d.admin.email),
          h("dt", {}, "Admin since"), h("dd", {}, dateOnly(d.admin.created_at)),
          h("dt", {}, "Last sign-in"), h("dd", {}, when(d.admin.last_login_at)))),
        panel("Email delivery", em.configured ? "New enquiries are emailed to you" : "Not set up yet",
          h("dl", { class: "meta" },
            h("dt", {}, "Status"), h("dd", {}, em.configured ? h("span", { class: "pill yes" }, "Working") : h("span", { class: "pill withdrawn" }, "Not configured")),
            h("dt", {}, "Sent to"), h("dd", {}, em.to || "—"),
            h("dt", {}, "Sent from"), h("dd", {}, em.from || "—"),
            h("dt", {}, "Visitor confirmation"), h("dd", {}, em.acknowledgement ? "On" : "Off")),
          em.configured ? null : h("p", { class: "note section-gap" }, "Enquiries are still saved here. To have them emailed too, set MAIL_TO, MAIL_FROM and RESEND_API_KEY (see docs/DEPLOYMENT.md)."))),
      h("div", { class: "grid two section-gap" },
        panel("Change password", null, form),
        panel("Signed-in devices", "Sessions end automatically after 12 hours",
          h("ul", { class: "bars" }, d.sessions.map((x) => h("li", { class: x.current ? "gold" : "" },
            h("span", {}, (x.current ? "This device · " : "") + (x.user_agent || "Unknown device").replace(/^Mozilla\/5\.0 /, "").slice(0, 60)),
            h("b", {}, "active " + when(x.last_seen_at))))),
          d.sessions.length > 1 ? h("div", { class: "actions section-gap" }, h("button", { class: "btn", type: "button", onclick: async () => {
            try { await api("settings/sign-out-others", { method: "POST" }); toast("Other devices signed out."); settings().catch(failed); } catch (x) { toast(x.message, true); }
          } }, "Sign out other devices")) : null)),
      h("div", { class: "section-gap" }, panel("Data", null, h("dl", { class: "meta" },
        h("dt", {}, "Enquiries"), h("dd", {}, num(d.counts.enquiries)),
        h("dt", {}, "Contacts"), h("dd", {}, num(d.counts.contacts)),
        h("dt", {}, "Analytics events"), h("dd", {}, num(d.counts.events) + (d.counts.first_event_day ? " since " + dayLabel(d.counts.first_event_day) : "")),
        h("dt", {}, "Retention"), h("dd", {}, d.retention)))),
    );
  }

  /* ---------- shell: unread badge, menu, logout, router ---------- */
  function setUnread(n) {
    const b = $("#unreadBadge");
    b.hidden = !n;
    b.textContent = n > 99 ? "99+" : String(n);
    b.setAttribute("aria-label", n + " unread");
  }
  const refreshUnread = () => api("enquiries?status=new&per=5").then((d) => setUnread(d.total)).catch(() => {});

  const side = $("#side"), scrim = $("#scrim"), menuBtn = $("#menuBtn");
  const setMenu = (open) => {
    side.classList.toggle("open", open);
    scrim.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
    if (open) { const a = side.querySelector("a"); if (a) a.focus(); }
  };
  menuBtn.addEventListener("click", () => setMenu(!side.classList.contains("open")));
  scrim.addEventListener("click", () => setMenu(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && side.classList.contains("open")) { setMenu(false); menuBtn.focus(); } });

  $("#logoutBtn").addEventListener("click", async () => {
    try { await api("logout", { method: "POST" }); } catch { /* signed out anyway */ }
    window.location.replace("/admin/login");
  });

  const TITLES = { overview: "Overview", analytics: "Analytics", enquiries: "Enquiries", contacts: "Contacts", consent: "Marketing consent", settings: "Settings" };
  async function route() {
    const raw = location.hash.replace(/^#\/?/, "") || "overview";
    const [pathPart, query = ""] = raw.split("?");
    const [name, id] = pathPart.split("/");
    const key = TITLES[name] ? name : "overview";
    document.querySelectorAll(".nav a[data-route]").forEach((a) => (a.dataset.route === key ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    document.title = (TITLES[key] || "Dashboard") + " — Manuchie";
    setMenu(false);
    try {
      if (key === "enquiries" && id) await enquiry(id);
      else if (key === "contacts" && id) await contact(id);
      else if (key === "analytics") await analytics();
      else if (key === "enquiries") await enquiries(new URLSearchParams(query));
      else if (key === "contacts") await contacts();
      else if (key === "consent") await consentPage();
      else if (key === "settings") await settings();
      else await overview();
      if (route.ran) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); } // not on first load: keep the skip link first
      route.ran = true;
    } catch (err) {
      if (!(err instanceof ApiError && err.message === "signed out")) failed(err);
    }
  }

  (async function boot() {
    try { ME = await api("me"); } catch { return; }
    $("#whoami").textContent = ME.email;
    window.addEventListener("hashchange", route);
    route();
  })();
})();
