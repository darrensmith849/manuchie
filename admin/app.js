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

  const STATUS = { new: "New", read: "Read", replied: "Replied", in_progress: "In progress", booked: "Booked", closed: "Complete", spam: "Spam" };
  const CLICKS = { spotify: "Spotify", apple_music: "Apple Music", youtube: "YouTube", shazam: "Shazam", instagram: "Instagram", email: "Email", book_session: "Book a session" };
  const SECTIONS = { hero: "Hero", story: "Story", mantra: "Mantra", sound: "Sound", studio: "Studio", gallery: "Gallery", contact: "Contact" };
  const DEVICES = { mobile: "Mobile", tablet: "Tablet", desktop: "Desktop", unknown: "Unknown" };

  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const avatar = (name, cls) => h("span", { class: "av" + (cls ? " " + cls : ""), "aria-hidden": "true" }, initials(name));
  const rtf = (() => { try { return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }); } catch { return null; } })();
  function ago(iso) {
    if (!iso) return "—";
    const s = (Date.parse(iso) - Date.now()) / 1000;
    const steps = [[60, "second"], [3600, "minute"], [86400, "hour"], [604800, "day"], [2629800, "week"], [31557600, "month"], [Infinity, "year"]];
    let unit = "second", div = 1;
    for (let i = 0, prev = 1; i < steps.length; prev = steps[i][0], i++) { if (Math.abs(s) < steps[i][0]) { unit = steps[i][1]; div = prev; break; } }
    const v = Math.round(s / div);
    if (Math.abs(s) < 45) return "just now";
    return rtf ? rtf.format(v, unit) : when(iso);
  }
  const pill = (status) => h("span", { class: "pill " + status }, STATUS[status] || status);

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

  function bars(rows, { label = (r) => r.name, value = (r) => r.n, cls = "", empty = "No data for this period yet.", fmt = num } = {}) {
    if (!rows || !rows.length) return h("p", { class: "empty" }, empty);
    const max = Math.max(1, ...rows.map(value));
    return h("ul", { class: "bars" }, rows.map((r) => h("li", { class: cls, style: { "--w": ((value(r) / max) * 100).toFixed(1) + "%" } },
      h("span", {}, label(r)), h("b", {}, fmt(value(r))))));
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
  /* Visits drawn as an audio waveform: one mirrored bar per day, the previous period as a ghost. */
  function waveChart(series, key, prev, title) {
    const W = Math.round(Math.max(300, Math.min(1100, main.clientWidth - 64))), H = W < 520 ? 120 : 156;
    const n = series.length, slot = W / n;
    const bw = Math.max(1.5, Math.min(14, slot * (n > 60 ? 0.6 : 0.46))), gap = slot - bw;
    const max = Math.max(1, ...series.map((d) => d[key]), ...(prev || []).map((d) => d[key]));
    const mid = H / 2, room = H - 10;
    const svg = s("svg", { class: "chart wave", viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `${title}. ${num(series.reduce((a, d) => a + d[key], 0))} in total. A data table follows.` });
    svg.append(s("defs", {}, s("linearGradient", { id: "mzWave", x1: "0", x2: "0", y1: "0", y2: "1" },
      s("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": ".95" }),
      s("stop", { offset: "50%", "stop-color": "#a6a7ac", "stop-opacity": ".75" }),
      s("stop", { offset: "100%", "stop-color": "#ffffff", "stop-opacity": ".95" }))));
    svg.append(s("line", { class: "mid", x1: 0, x2: W, y1: mid, y2: mid }));
    series.forEach((d, i) => {
      const x = i * slot + gap / 2, r = bw / 2;
      const g = s("g", { class: "col" });
      if (prev && prev[i]) {
        const ph = Math.max(2, (prev[i][key] / max) * room);
        g.append(s("rect", { class: "bar prev", x, y: mid - ph / 2, width: bw, height: ph, rx: r }));
      }
      const bh = Math.max(2, (d[key] / max) * room);
      g.append(s("rect", { class: "bar" + (i === n - 1 ? " now" : ""), x, y: mid - bh / 2, width: bw, height: bh, rx: r }));
      g.append(s("rect", { class: "hit", x: x - gap / 2, y: 0, width: bw + gap, height: H },
        s("title", {}, `${dayLabel(d.day)}: ${num(d[key])} ${title.toLowerCase()}` + (prev && prev[i] ? ` · previous period ${num(prev[i][key])}` : ""))));
      svg.append(g);
    });
    const peak = series.reduce((a, d) => (d[key] > a[key] ? d : a), series[0]);
    const table = h("table", {}, h("caption", { class: "vh" }, title),
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Day (UTC)"), h("th", { scope: "col", class: "num" }, title))),
      h("tbody", {}, series.map((d) => h("tr", {}, h("th", { scope: "row" }, dayLabel(d.day)), h("td", { class: "num" }, num(d[key]))))));
    return h("div", {}, svg,
      h("div", { class: "wave-foot" }, h("span", {}, dayLabel(series[0].day)),
        h("span", {}, peak && peak[key] ? `Busiest: ${num(peak[key])} on ${dayLabel(peak.day)}` : "No visits in this period yet"),
        h("span", {}, n > 1 ? dayLabel(series[n - 1].day) : "")),
      prev ? h("ul", { class: "legend" }, h("li", {}, h("i", {}), "This period"), h("li", {}, h("i", { class: "lp" }), "Previous period (ghost bars)")) : null,
      h("details", { class: "data" }, h("summary", {}, "Show as a table"), h("div", { class: "table-wrap" }, table)));
  }

  const periodText = (r) => ({ today: "today", "7d": "in the last 7 days", "30d": "in the last 30 days", "90d": "in the last 90 days" }[range.preset] || `between ${rangeText(r)}`);

  async function overview() {
    loading();
    const d = await api("overview?" + rangeQuery());
    const c = d.current, p = d.previous, cmp = range.compare;
    const sc = d.statusCounts || {};
    const toReply = (sc.new || 0) + (sc.read || 0);
    const dl = (k, opts) => (cmp ? delta(c[k], p[k], opts) : null);
    const link = (href, text) => h("a", { class: "delta", href }, text);
    const hour = new Date().getHours();
    const greet = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    render(
      h("section", { class: "hero", "aria-labelledby": "greeting" },
        h("div", { class: "hero-copy" },
          h("span", { class: "hero-k" }, today),
          h("h1", { id: "greeting" }, greet + ", ", h("em", {}, "Manuchie.")),
          h("p", {}, toReply
            ? [h("b", {}, `${num(toReply)} ${toReply === 1 ? "enquiry is" : "enquiries are"} waiting for a reply.`), ` ${num(c.visits)} ${c.visits === 1 ? "visit" : "visits"} to the website ${periodText(d.range)}.`]
            : ["You're all caught up. ", h("b", {}, `${num(c.visits)} ${c.visits === 1 ? "visit" : "visits"}`), ` to the website ${periodText(d.range)}.`]),
          h("div", { class: "actions" },
            h("a", { class: "btn btn-primary", href: "#/enquiries?view=todo" }, toReply ? "Open the inbox" : "See enquiries"),
            h("a", { class: "btn", href: "https://manuchie.org/", target: "_blank", rel: "noopener" }, "View website ", h("span", { "aria-hidden": "true" }, "↗"), h("span", { class: "vh" }, " (opens in a new tab)")))),
        h("figure", { class: "hero-photo" }, h("img", { src: "/admin/img/portrait.webp", alt: "", width: "536", height: "640" }))),
      studioStrip(d.studio),
      h("div", { class: "head section-top" }, h("div", {}, h("h2", { class: "head-h2" }, "Enquiries and the website"), h("p", {}, rangeText(d.range) + " · days in UTC")), rangeControls(overview)),
      h("div", { class: "grid cards six" },
        card("To reply", num(toReply), link("#/enquiries?view=todo", "Open the inbox →"), true),
        card("In progress", num((sc.replied || 0) + (sc.in_progress || 0)), link("#/enquiries?view=progress", "See them →")),
        card("Booked", num(sc.booked || 0), link("#/enquiries?view=booked", "See them →")),
        card("New enquiries", num(c.enquiries), dl("enquiries")),
        card("Website visits", num(c.visits), dl("visits")),
        card("Conversion", pct(c.conversion), cmp ? delta(c.conversion, p.conversion, { asPct: true }) : null)),
      h("div", { class: "section-gap" }, panel("Needs your attention", "New, read and in-progress enquiries, newest first", attentionList(d.recent))),
      h("section", { class: "panel section-gap" },
        h("div", { class: "panel-head" }, h("h2", {}, "The website's waveform"), h("p", {}, "Visits per day")),
        waveChart(d.series, "visits", cmp ? d.previousSeries : null, "Visits")),
      h("section", { class: "section-gap" },
        h("div", { class: "panel-head" }, h("h2", {}, "Clicks"), h("p", {}, "Streaming, social, email and booking links")),
        h("div", { class: "grid cards seven" },
          Object.entries(CLICKS).map(([k, label]) => h("div", { class: "card small-v" }, h("span", { class: "card-k", title: label }, label),
            h("span", { class: "card-v" }, num(c.clicks[k])), cmp ? delta(c.clicks[k], p.clicks[k], { compact: true }) : null)))),
      h("div", { class: "grid two section-gap" },
        panel("Most-viewed sections", "Times each part of the page was seen", bars(d.sections, { label: (r) => SECTIONS[r.name] || r.name })),
        panel("Leading traffic sources", "Visits by where people came from", bars(d.sources, { cls: "alt" }))),
    );
    setUnread(d.unread);
  }

  function attentionList(rows) {
    if (!rows.length) return h("p", { class: "empty" }, "You're all caught up. New enquiries will appear here.");
    return h("ul", { class: "inbox" }, rows.map((r) => h("li", { class: r.status === "new" ? "unread" : "" },
      h("a", { class: "inbox-main", href: "#/enquiries/" + r.id }, avatar(r.name),
        h("span", { class: "inbox-body" },
          h("span", { class: "inbox-top" }, h("b", {}, r.name), h("span", { class: "muted nowrap", title: when(r.created_at) }, ago(r.created_at))),
          h("span", { class: "inbox-msg" }, r.preview))),
      h("span", { class: "inbox-side" }, pill(r.status),
        r.status !== "closed" ? h("button", { class: "btn btn-sm btn-done", type: "button", "aria-label": "Mark the enquiry from " + r.name + " complete",
          onclick: () => setStatus(r.id, "closed", "Marked complete.").then(overview) }, "Complete") : null))));
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
      h("div", { class: "grid cards six" },
        card("Website visits", num(c.visits), cmp ? delta(c.visits, p.visits) : null),
        card("Page views", num(c.pageviews), cmp ? delta(c.pageviews, p.pageviews) : null),
        card("Unique visitors", num(c.visitors), cmp ? delta(c.visitors, p.visitors) : null),
        card("Form starts", num(c.form_starts), cmp ? delta(c.form_starts, p.form_starts) : null),
        card("Enquiries", num(c.enquiries), cmp ? delta(c.enquiries, p.enquiries) : null, true),
        card("Conversion", pct(c.conversion), cmp ? delta(c.conversion, p.conversion, { asPct: true }) : null)),
      h("section", { class: "panel section-gap" }, h("div", { class: "panel-head" }, h("h2", {}, "Traffic"), metricSeg), chartBox),
      h("div", { class: "grid two section-gap" },
        panel("Enquiry funnel", "From first visit to a sent enquiry", bars(funnelRows, { empty: "No visits yet." })),
        panel("Outbound clicks", "Streaming, social and booking links", bars(clickRows, { cls: "alt" }))),
      h("div", { class: "grid three section-gap" },
        panel("Traffic sources", "Visits by source", bars(d.sources)),
        panel("Sections viewed", null, bars(d.sections, { label: (r) => SECTIONS[r.name] || r.name, cls: "alt" })),
        panel("Devices", "Visits by device", bars(d.devices, { label: (r) => DEVICES[r.name] || r.name }))),
      h("div", { class: "grid two section-gap" },
        panel("Countries", "Broad location from the network, never precise", bars(d.countries, { label: (r) => country(r.name), cls: "alt" })),
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
  const VIEWS = [
    ["todo", "To reply", ["new", "read"]],
    ["progress", "In progress", ["replied", "in_progress"]],
    ["booked", "Booked", ["booked"]],
    ["done", "Complete", ["closed"]],
    ["all", "All", null],
    ["spam", "Spam", ["spam"]],
  ];
  const enqState = { view: "todo", q: "", sort: "newest", page: 1, selected: new Set() };

  /* One status change, used by list rows, the overview and the detail page. */
  async function setStatus(id, status, message) {
    try { await api("enquiries/" + id, { method: "PATCH", body: { status } }); toast(message); refreshUnread(); }
    catch (err) { toast(err.message, true); }
  }

  async function enquiries(params) {
    if (params.has("view") && VIEWS.some((v) => v[0] === params.get("view"))) { enqState.view = params.get("view"); enqState.page = 1; enqState.selected.clear(); }
    const view = VIEWS.find((v) => v[0] === enqState.view);
    const qs = new URLSearchParams({ page: enqState.page, per: 25, sort: enqState.sort });
    if (enqState.q) qs.set("q", enqState.q);
    if (view[2]) qs.set("status", view[2].join(","));
    const d = await api("enquiries?" + qs);
    setUnread(d.counts.new || 0);
    const reload = (resetPage) => { if (resetPage) enqState.page = 1; enquiries(new URLSearchParams()).catch(failed); };
    const countOf = (v) => v[2] ? v[2].reduce((a, s) => a + (d.counts[s] || 0), 0)
      : Object.entries(d.counts).filter(([s]) => s !== "spam").reduce((a, [, n]) => a + n, 0);

    const tabs = h("div", { class: "chips", role: "group", "aria-label": "Show" }, VIEWS.map((v) =>
      h("button", { type: "button", class: "chip", "aria-pressed": String(enqState.view === v[0]), onclick: () => {
        enqState.view = v[0]; enqState.selected.clear(); history.replaceState(null, "", "#/enquiries?view=" + v[0]); reload(true);
      } }, v[1], h("b", {}, num(countOf(v))))));

    const search = h("input", { type: "search", placeholder: "Search name, email or message", value: enqState.q, "aria-label": "Search enquiries" });
    let t;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { enqState.q = search.value.trim(); reload(true); }, 300); });
    const sort = h("select", { "aria-label": "Order", onchange: (e) => { enqState.sort = e.target.value; reload(true); } },
      h("option", { value: "newest" }, "Newest first"), h("option", { value: "oldest" }, "Oldest first"));
    sort.value = enqState.sort;

    /* bulk actions for the ticked rows */
    const ids = () => [...enqState.selected];
    const bulk = async (body, message) => {
      try { const r = await api("enquiries/bulk", { method: "POST", body: { ids: ids(), ...body } }); toast(message.replace("{n}", r.changed)); enqState.selected.clear(); refreshUnread(); reload(); }
      catch (err) { toast(err.message, true); }
    };
    const bulkBar = h("div", { class: "bulkbar", hidden: !enqState.selected.size, role: "region", "aria-label": "Selected enquiries" },
      h("span", { class: "bulk-count" }),
      h("button", { class: "btn btn-sm", type: "button", onclick: () => bulk({ status: "read" }, "{n} marked read.") }, "Mark read"),
      h("button", { class: "btn btn-sm", type: "button", onclick: () => bulk({ status: "closed" }, "{n} marked complete.") }, "Mark complete"),
      enqState.view === "spam"
        ? h("button", { class: "btn btn-sm", type: "button", onclick: () => bulk({ status: "new" }, "{n} moved to the inbox.") }, "Not spam")
        : h("button", { class: "btn btn-sm", type: "button", onclick: () => bulk({ status: "spam" }, "{n} moved to spam.") }, "Spam"),
      h("a", { class: "btn btn-sm", href: "#", onclick: (e) => { e.currentTarget.href = "/api/admin/enquiries.csv?ids=" + ids().join(","); } }, "Export"),
      h("button", { class: "btn btn-sm btn-danger", type: "button", onclick: async () => {
        if (await confirmAction("Delete " + enqState.selected.size + " enquiries?", "They'll be removed permanently. This can't be undone.", "Delete")) bulk({ delete: true }, "{n} deleted.");
      } }, "Delete"),
      h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => { enqState.selected.clear(); main.querySelectorAll("input[data-id]").forEach((b) => { b.checked = false; }); syncBulk(); } }, "Clear"));
    const syncBulk = () => {
      bulkBar.hidden = !enqState.selected.size;
      bulkBar.querySelector(".bulk-count").textContent = enqState.selected.size + " selected";
      if (allBox) allBox.checked = d.rows.length > 0 && d.rows.every((r) => enqState.selected.has(r.id));
    };
    const allBox = h("input", { type: "checkbox", "aria-label": "Select all on this page", onchange: (e) => {
      d.rows.forEach((r) => (e.target.checked ? enqState.selected.add(r.id) : enqState.selected.delete(r.id)));
      main.querySelectorAll("input[data-id]").forEach((b) => { b.checked = e.target.checked; });
      syncBulk();
    } });

    const quick = (r) => {
      const acts = [];
      if (r.status === "new") acts.push(["Mark read", "read", "Marked read."]);
      else if (r.status === "read") acts.push(["Mark unread", "new", "Marked unread."]);
      if (r.status === "closed") acts.push(["Reopen", "read", "Reopened."]);
      else if (r.status === "spam") acts.push(["Not spam", "new", "Moved to the inbox."]);
      else acts.push(["Complete", "closed", "Marked complete."]);
      return acts.map(([label, status, msg]) => h("button", { class: "btn btn-sm" + (status === "closed" ? " btn-done" : ""), type: "button",
        "aria-label": label + ": " + r.name, onclick: async () => { await setStatus(r.id, status, msg); reload(); } }, label));
    };

    const pages = Math.max(1, Math.ceil(d.total / d.per));
    const emptyText = enqState.q ? "Nothing matches that search." : { todo: "Nothing waiting for a reply. 🎉", progress: "Nothing in progress.", booked: "No bookings yet.", done: "Nothing marked complete yet.", spam: "No spam.", all: "No enquiries yet." }[enqState.view];
    render(
      head("Enquiries", `${num(d.total)} ${d.total === 1 ? "enquiry" : "enquiries"} · ${view[1].toLowerCase()}`,
        h("a", { class: "btn", href: "/api/admin/enquiries.csv?" + new URLSearchParams([...qs].filter(([k]) => k !== "page" && k !== "per")) }, "Export (CSV)")),
      tabs,
      h("div", { class: "toolbar" }, h("div", { class: "grow" }, search), sort),
      bulkBar,
      h("section", { class: "panel" },
        !d.rows.length ? h("p", { class: "empty" }, emptyText)
        : h("div", { class: "table-wrap" }, h("table", { class: "enq" },
          h("caption", { class: "vh" }, "Enquiries. Select a row to open it."),
          h("thead", {}, h("tr", {}, h("th", { scope: "col", class: "c-check" }, allBox), h("th", { scope: "col" }, "From"),
            h("th", { scope: "col" }, "Message"), h("th", { scope: "col", class: "c-side" }, "Status"))),
          h("tbody", {}, d.rows.map((r) => h("tr", { class: "row" + (r.status === "new" ? " unread" : ""), onclick: (e) => {
              if (e.target.closest("input, button, a")) return;
              location.hash = "#/enquiries/" + r.id;
            } },
            h("td", { class: "c-check" }, h("input", { type: "checkbox", "data-id": r.id, checked: enqState.selected.has(r.id), "aria-label": "Select the enquiry from " + r.name, onchange: (e) => {
              e.target.checked ? enqState.selected.add(r.id) : enqState.selected.delete(r.id); syncBulk();
            } })),
            h("td", { class: "c-who" }, h("div", { class: "who" }, avatar(r.name), h("span", {},
              h("a", { class: "row-link", href: "#/enquiries/" + r.id }, r.name),
              h("span", { class: "sub ellipsis", title: r.email }, r.email), h("span", { class: "sub", title: when(r.created_at) }, ago(r.created_at))))),
            h("td", { class: "c-msg" }, h("div", { class: "preview clamp" }, r.preview + (r.truncated ? "…" : "")), r.has_notes ? h("span", { class: "sub" }, "✎ has notes") : null),
            h("td", { class: "c-side" }, h("div", { class: "side-stack" }, pill(r.status), h("div", { class: "row-actions" }, quick(r))))))))),
        h("div", { class: "pager" }, h("span", {}, `Page ${d.page} of ${pages}`), h("div", { class: "actions" },
          h("button", { class: "btn", type: "button", disabled: d.page <= 1, onclick: () => { enqState.page--; reload(); } }, "Previous"),
          h("button", { class: "btn", type: "button", disabled: d.page >= pages, onclick: () => { enqState.page++; reload(); } }, "Next")))));
    syncBulk();
  }

  async function enquiry(id) {
    loading();
    const { enquiry: e, contact, others } = await api("enquiries/" + id);
    refreshUnread();
    const again = () => enquiry(id).catch(failed);
    const save = async (body, msg) => {
      try { await api("enquiries/" + id, { method: "PATCH", body }); toast(msg); refreshUnread(); again(); return true; }
      catch (err) { toast(err.message, true); return false; }
    };
    const first = e.name.split(" ")[0];
    const quoted = e.message.length > 900 ? e.message.slice(0, 900) + "…" : e.message;
    const mailto = `mailto:${encodeURIComponent(e.email)}?subject=${encodeURIComponent("Re: your enquiry via manuchie.org")}` +
      `&body=${encodeURIComponent(`Hi ${first},\n\n\n\n—\nOn ${when(e.created_at)} you wrote:\n${quoted}\n`)}`;

    /* status actions: the common ones as buttons, everything else in "Move to" */
    const done = e.status === "closed";
    const actions = h("div", { class: "actions action-bar" },
      h("a", { class: "btn btn-terra", href: mailto }, "Reply by email"),
      h("a", { class: "btn", href: "#/projects/new?" + new URLSearchParams({ enquiry: e.id, client: e.contact_id || "", title: "Project for " + e.name, notes: e.message.slice(0, 2000) }) }, "Start a project"),
      h("button", { class: "btn", type: "button", onclick: () => save({ replied: true }, "Marked replied.") }, "Mark replied"),
      done ? h("button", { class: "btn", type: "button", onclick: () => save({ status: "read" }, "Reopened.") }, "Reopen")
           : h("button", { class: "btn btn-done", type: "button", onclick: () => save({ status: "closed" }, "Marked complete.") }, "Mark complete"),
      e.status !== "booked" ? h("button", { class: "btn", type: "button", onclick: () => save({ status: "booked" }, "Marked booked.") }, "Booked") : null,
      // opening an enquiry marks it read, so "unread" goes straight back to the list
      h("button", { class: "btn btn-ghost", type: "button", onclick: async () => {
        try { await api("enquiries/" + id, { method: "PATCH", body: { status: "new" } }); toast("Marked unread."); location.hash = "#/enquiries"; }
        catch (err) { toast(err.message, true); }
      } }, "Mark unread"));
    const moveTo = h("select", {}, Object.entries(STATUS).map(([k, label]) => h("option", { value: k }, label)));
    moveTo.value = e.status;
    moveTo.addEventListener("change", () => save({ status: moveTo.value }, "Moved to " + STATUS[moveTo.value] + "."));

    /* details, with an edit form for name and email */
    const details = h("div");
    const showDetails = () => details.replaceChildren(
      h("div", { class: "panel-head" }, h("h2", {}, "Details"), h("button", { class: "btn btn-sm", type: "button", onclick: showEdit }, "Edit")),
      h("dl", { class: "meta" },
        h("dt", {}, "Name"), h("dd", {}, e.name),
        h("dt", {}, "Email"), h("dd", {}, e.email, " ", h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: async () => {
          try { await navigator.clipboard.writeText(e.email); toast("Email address copied."); } catch { toast("Couldn't copy — select the address instead.", true); }
        } }, "Copy")),
        h("dt", {}, "Received"), h("dd", {}, when(e.created_at)),
        h("dt", {}, "Status"), h("dd", {}, pill(e.status)),
        h("dt", {}, "Last replied"), h("dd", {}, e.last_contacted_at ? when(e.last_contacted_at) : "Not yet"),
        h("dt", {}, "Came from"), h("dd", {}, e.utm_source ? [e.utm_source, e.utm_medium, e.utm_campaign].filter(Boolean).join(" / ") : e.referrer || "Direct"),
        h("dt", {}, "Mailing list"), h("dd", {}, e.marketing_consent ? "Yes — ticked the box" : "No"),
        h("dt", {}, "Email alert"), h("dd", {}, { sent: "Sent to your inbox", failed: "Sending failed — it's safe here", not_configured: "Email alerts not set up yet", pending: "Sending…", skipped: "Not sent (spam)" }[e.email_status] || e.email_status),
        e.spam_reason ? [h("dt", {}, "Spam check"), h("dd", {}, { honeypot: "Hidden bot field was filled in", too_fast: "Sent too quickly to be typed", links: "Contains many links" }[e.spam_reason] || e.spam_reason)] : null,
        contact ? [h("dt", {}, "Contact"), h("dd", {}, h("a", { href: "#/contacts/" + contact.id }, `View contact (${contact.enquiry_count} ${contact.enquiry_count === 1 ? "enquiry" : "enquiries"})`))] : null));
    const showEdit = () => {
      const name = h("input", { type: "text", id: "editName", value: e.name, required: true, autocomplete: "off" });
      const email = h("input", { type: "email", id: "editEmail", value: e.email, required: true, autocomplete: "off" });
      const err = h("p", { class: "form-error", role: "alert" });
      details.replaceChildren(
        h("div", { class: "panel-head" }, h("h2", {}, "Edit details")),
        h("form", { class: "stack", onsubmit: async (ev) => {
          ev.preventDefault();
          err.textContent = "";
          try { await api("enquiries/" + id, { method: "PATCH", body: { name: name.value, email: email.value } }); toast("Details saved."); again(); }
          catch (x) { err.textContent = x.message; }
        } },
          h("label", { class: "fld", for: "editName" }, h("span", {}, "Name"), name),
          h("label", { class: "fld", for: "editEmail" }, h("span", {}, "Email"), email),
          err,
          h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "submit" }, "Save"), h("button", { class: "btn", type: "button", onclick: showDetails }, "Cancel"))));
      name.focus();
    };
    showDetails();

    const notes = h("textarea", { id: "notes", rows: "5", placeholder: "Private notes — dates, budget, next steps. Only you can see these." }, e.notes);
    render(
      h("a", { class: "back", href: "#/enquiries" }, "← Enquiries"),
      h("div", { class: "head" }, h("div", { class: "person-head" }, avatar(e.name, "lg"),
          h("div", {}, h("h1", {}, e.name), h("p", {}, e.email + " · ", h("span", { title: when(e.created_at) }, ago(e.created_at))))),
        h("label", { class: "head-status" }, h("span", { class: "muted" }, "Status"), moveTo)),
      actions,
      h("div", { class: "detail section-gap" },
        h("div", { class: "stack" },
          h("section", { class: "panel letter" }, h("div", { class: "panel-head" }, h("h2", {}, "The project")), h("p", { class: "message" }, e.message)),
          h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, h("label", { for: "notes" }, "Private notes"))), notes,
            h("div", { class: "actions section-gap" }, h("button", { class: "btn btn-primary", type: "button", onclick: () => save({ notes: notes.value }, "Notes saved.") }, "Save notes"))),
          others && others.length ? panel("Earlier enquiries from " + first, null, h("ul", { class: "inbox" }, others.map((o) => h("li", {},
            h("a", { class: "inbox-main", href: "#/enquiries/" + o.id }, h("span", { class: "inbox-body" }, h("span", { class: "inbox-top" }, h("b", { title: when(o.created_at) }, ago(o.created_at))), h("span", { class: "inbox-msg" }, o.preview))),
            h("span", { class: "inbox-side" }, pill(o.status)))))) : null),
        h("div", { class: "stack" },
          h("section", { class: "panel" }, details),
          h("section", { class: "panel" },
            h("div", { class: "panel-head" }, h("h2", {}, "More")),
            h("div", { class: "actions" },
              e.status === "spam"
                ? h("button", { class: "btn", type: "button", onclick: () => save({ status: "new" }, "Moved to the inbox.") }, "Not spam")
                : h("button", { class: "btn", type: "button", onclick: () => save({ status: "spam" }, "Moved to spam.") }, "Move to spam"),
              h("a", { class: "btn", href: "/api/admin/enquiries.csv?ids=" + e.id }, "Export CSV"),
              h("button", { class: "btn btn-danger", type: "button", onclick: async () => {
                if (!(await confirmAction("Delete this enquiry?", `The message from ${e.name} will be removed permanently. This can't be undone.`, "Delete enquiry"))) return;
                try { await api("enquiries/" + id, { method: "DELETE" }); toast("Enquiry deleted."); location.hash = "#/enquiries"; }
                catch (err) { toast(err.message, true); }
              } }, "Delete"))))));
  }

  /* ---------- Contacts ---------- */
  const conState = { q: "", list: "", tag: "", sort: "latest", dir: "desc", page: 1 };

  async function contacts() {
    const qs = new URLSearchParams({ page: conState.page, per: 25, sort: conState.sort, dir: conState.dir });
    if (conState.q) qs.set("q", conState.q);
    if (conState.list) qs.set("consent", conState.list);
    if (conState.tag) qs.set("tag", conState.tag);
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
      [["latest:desc", "Latest enquiry"], ["created:desc", "Newest added"], ["name:asc", "Name A–Z"], ["enquiries:desc", "Most enquiries"]]
        .map(([v, l]) => h("option", { value: v }, l)));
    sortSel.value = conState.sort + ":" + conState.dir;
    const exportQs = new URLSearchParams(qs); exportQs.delete("page"); exportQs.delete("per");
    const pages = Math.max(1, Math.ceil(d.total / d.per));
    const addSlot = h("div");
    const addClientForm = () => {
      const f = (id, label, input) => h("label", { class: "fld", for: id }, h("span", {}, label), input);
      const n = h("input", { type: "text", id: "acName", required: true, placeholder: "Full name" });
      const e = h("input", { type: "email", id: "acEmail", placeholder: "name@email.com" });
      const ph = h("input", { type: "tel", id: "acPhone", placeholder: "+263 …" });
      const co = h("input", { type: "text", id: "acCompany", placeholder: "Church, label, band…" });
      const err = h("p", { class: "form-error", role: "alert" });
      setTimeout(() => n.focus(), 0);
      return h("form", { class: "panel section-gap", onsubmit: async (ev) => {
        ev.preventDefault();
        err.textContent = "";
        try { const r = await api("clients", { method: "POST", body: { name: n.value, email: e.value, phone: ph.value, company: co.value } }); toast("Client added."); location.hash = "#/contacts/" + r.id; }
        catch (x) { err.textContent = x.message; }
      } }, h("div", { class: "panel-head" }, h("h2", {}, "Add a client")),
        h("div", { class: "form-row" }, f("acName", "Name", n), f("acEmail", "Email (optional)", e), f("acPhone", "Phone (optional)", ph), f("acCompany", "Company (optional)", co)),
        err, h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "submit" }, "Add client"), h("button", { class: "btn", type: "button", onclick: () => addSlot.replaceChildren() }, "Cancel")));
    };
    render(
      head("Clients", `${num(d.total)} ${d.total === 1 ? "person" : "people"} · everyone who has enquired or worked with you`,
        h("div", { class: "actions" },
          h("button", { class: "btn btn-primary", type: "button", onclick: () => addSlot.replaceChildren(addClientForm()) }, "+ Add client"),
          h("a", { class: "btn", href: "/api/admin/contacts.csv?" + exportQs }, "Export (CSV)"),
          h("a", { class: "btn btn-ghost", href: "/api/admin/consent.csv", title: "Only people who ticked the box to hear about new music" }, "Export mailing list"))),
      addSlot,
      h("div", { class: "toolbar" }, h("div", { class: "grow" }, search),
        d.tags.length ? sel("tag", "Tag", [["", "Any tag"], ...d.tags.map((x) => [x.tag, `${x.tag} (${x.n})`])]) : null,
        sel("list", "Mailing list", [["", "Everyone"], ["yes", "On the mailing list"], ["no", "Not on the mailing list"]]),
        sortSel),
      h("section", { class: "panel" },
        !d.rows.length ? h("p", { class: "empty" }, conState.q || conState.list || conState.tag ? "No clients match." : "No clients yet. Everyone who sends an enquiry appears here, or add one with “+ Add client”.")
        : h("div", { class: "table-wrap" }, h("table", { class: "enq con" },
          h("caption", { class: "vh" }, "Clients. Select a row to open it."),
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Name"), h("th", { scope: "col", class: "num" }, "Enquiries"),
            h("th", { scope: "col" }, "Latest"), h("th", { scope: "col", class: "hide-sm" }, "Tags"), h("th", { scope: "col", class: "hide-sm" }, "Added"))),
          h("tbody", {}, d.rows.map((r) => h("tr", { class: "row", onclick: (e) => { if (!e.target.closest("a, button, input")) location.hash = "#/contacts/" + r.id; } },
            h("td", { class: "c-who" }, h("div", { class: "who" }, avatar(r.name), h("span", {},
              h("a", { class: "row-link", href: "#/contacts/" + r.id }, r.name),
              h("span", { class: "sub ellipsis", title: [r.email, r.phone].filter(Boolean).join(" · ") }, [r.email, r.phone].filter(Boolean).join(" · ") || "No contact details yet"),
              r.company ? h("span", { class: "sub" }, r.company) : null))),
            h("td", { class: "num c-num" }, num(r.enquiry_count)),
            h("td", { class: "nowrap c-latest" }, r.latest_status ? pill(r.latest_status) : "—", " ", h("span", { class: "muted" }, dateOnly(r.latest_enquiry))),
            h("td", { class: "hide-sm" }, r.tags.length ? r.tags.map((x) => h("span", { class: "tag" }, x)) : h("span", { class: "muted" }, "—")),
            h("td", { class: "hide-sm nowrap muted" }, dateOnly(r.created_at))))))),
        h("div", { class: "pager" }, h("span", {}, `Page ${d.page} of ${pages}`), h("div", { class: "actions" },
          h("button", { class: "btn", type: "button", disabled: d.page <= 1, onclick: () => { conState.page--; contacts().catch(failed); } }, "Previous"),
          h("button", { class: "btn", type: "button", disabled: d.page >= pages, onclick: () => { conState.page++; contacts().catch(failed); } }, "Next")))));
  }

  async function contact(id) {
    loading();
    const { contact: c, enquiries: list, consent, projects: projList } = await api("contacts/" + id);
    const again = () => contact(id).catch(failed);
    const save = async (body, msg) => {
      try { await api("contacts/" + id, { method: "PATCH", body }); toast(msg); again(); return null; }
      catch (err) { toast(err.message, true); return err.message; }
    };
    const onList = c.marketing_consent && !c.unsubscribed_at;
    const name = h("input", { type: "text", id: "cName", value: c.name, required: true, autocomplete: "off" });
    const email = h("input", { type: "email", id: "cEmail", value: c.email, autocomplete: "off" });
    const phone = h("input", { type: "tel", id: "cPhone", value: c.phone || "", autocomplete: "off", placeholder: "+263 …" });
    const company = h("input", { type: "text", id: "cCompany", value: c.company || "", autocomplete: "off" });
    const tags = h("input", { type: "text", id: "tags", value: c.tags.join(", "), placeholder: "e.g. church, label, artist" });
    const notes = h("textarea", { id: "cnotes", rows: "4", placeholder: "Private notes about this person." }, c.notes);
    const err = h("p", { class: "form-error", role: "alert" });
    render(
      h("a", { class: "back", href: "#/contacts" }, "← Clients"),
      h("div", { class: "head" }, h("div", { class: "person-head" }, avatar(c.name, "lg"),
          h("div", {}, h("h1", {}, c.name), h("p", {}, [c.company, c.email, c.phone].filter(Boolean).join(" · ") || "No contact details yet"))),
        h("div", { class: "actions" }, reachButtons(c.name, c.email, c.phone, true),
          h("button", { class: "btn", type: "button", onclick: () => newInvoice({ contact_id: c.id }) }, "New invoice"))),
      h("div", { class: "detail" },
        h("div", { class: "stack" },
          h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "Projects"),
              h("a", { class: "btn btn-sm", href: "#/projects/new?" + new URLSearchParams({ client: c.id, title: "Project for " + c.name }) }, "+ New project")),
            projList.length ? h("ul", { class: "inbox" }, projList.map((p) => h("li", {},
              h("a", { class: "inbox-main", href: "#/projects/" + p.id }, h("span", { class: "inbox-body" },
                h("span", { class: "inbox-top" }, h("b", {}, p.title), h("span", { class: "muted nowrap" }, p.fee_cents ? `${money(p.received_cents, { whole: true })} of ${money(p.fee_cents, { whole: true })}` : "")),
                progressBar(p.progress, p.title + ": " + p.progress + "% done"))),
              h("span", { class: "inbox-side" }, projPill(p.status))))) : h("p", { class: "empty" }, "No projects with " + c.name.split(" ")[0] + " yet.")),
          panel("Enquiries", null, list.length ? h("ul", { class: "inbox" }, list.map((e) => h("li", { class: e.status === "new" ? "unread" : "" },
            h("a", { class: "inbox-main", href: "#/enquiries/" + e.id }, h("span", { class: "inbox-body" }, h("span", { class: "inbox-top" }, h("b", { title: when(e.created_at) }, ago(e.created_at))), h("span", { class: "inbox-msg" }, e.preview))),
            h("span", { class: "inbox-side" }, pill(e.status))))) : h("p", { class: "empty" }, "No enquiries.")),
          h("section", { class: "panel" },
            h("div", { class: "panel-head" }, h("h2", {}, "Details")),
            h("form", { class: "stack", onsubmit: async (ev) => {
              ev.preventDefault();
              err.textContent = (await save({ name: name.value, email: email.value, phone: phone.value, company: company.value, tags: tags.value, notes: notes.value }, "Client saved.")) || "";
            } },
              h("div", { class: "form-row" }, h("label", { class: "fld", for: "cName" }, h("span", {}, "Name"), name), h("label", { class: "fld", for: "cCompany" }, h("span", {}, "Company"), company)),
              h("div", { class: "form-row" }, h("label", { class: "fld", for: "cEmail" }, h("span", {}, "Email"), email), h("label", { class: "fld", for: "cPhone" }, h("span", {}, "Phone"), phone)),
              h("label", { class: "fld", for: "tags" }, h("span", {}, "Tags (comma-separated)"), tags),
              h("label", { class: "fld", for: "cnotes" }, h("span", {}, "Private notes"), notes),
              err,
              h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "submit" }, "Save changes"))))),
        h("div", { class: "stack" },
          h("section", { class: "panel" },
            h("div", { class: "panel-head" }, h("h2", {}, "At a glance")),
            h("dl", { class: "meta" },
              h("dt", {}, "First enquiry"), h("dd", {}, when(c.created_at)),
              h("dt", {}, "Enquiries"), h("dd", {}, num(c.enquiry_count)),
              h("dt", {}, "Last replied"), h("dd", {}, c.last_contacted_at ? when(c.last_contacted_at) : "Not yet"),
              h("dt", {}, "Came from"), h("dd", {}, c.source || "—"),
              h("dt", {}, "Mailing list"), h("dd", {}, onList ? "Yes, since " + dateOnly(c.consent_at) : c.unsubscribed_at ? "Removed " + dateOnly(c.unsubscribed_at) : "No"))),
          h("section", { class: "panel" },
            h("div", { class: "panel-head" }, h("h2", {}, "More")),
            h("div", { class: "actions" },
              onList ? h("button", { class: "btn", type: "button", onclick: async () => {
                if (await confirmAction("Remove from the mailing list?", `${c.name} won't be included in mailing-list exports any more. Their enquiries stay.`, "Remove")) save({ unsubscribe: true }, "Removed from the mailing list.");
              } }, "Remove from mailing list") : null,
              h("a", { class: "btn", href: `/api/admin/contacts/${c.id}/export` }, "Download their data"),
              h("button", { class: "btn btn-danger", type: "button", onclick: async () => {
                if (!(await confirmAction("Delete this person?", `${c.name}, their ${c.enquiry_count} ${c.enquiry_count === 1 ? "enquiry" : "enquiries"} and notes will be erased permanently.`, "Delete everything"))) return;
                try { await api("contacts/" + id, { method: "DELETE" }); toast("Contact and their data deleted."); location.hash = "#/contacts"; }
                catch (x) { toast(x.message, true); }
              } }, "Delete")),
            consent.length ? h("details", { class: "data" }, h("summary", {}, "Mailing-list record"),
              h("ul", { class: "plain" }, consent.map((r) => h("li", {}, `${r.action === "granted" ? "Ticked the box" : "Removed"} · ${when(r.created_at)} · ${r.method}`))),
              consent.filter((r) => r.action === "granted").slice(0, 1).map((r) => h("p", { class: "muted" }, "Wording: “" + r.wording + "”"))) : null))));
  }

  /* ---------- Studio: shared helpers ---------- */
  const DEFAULT_STAGES = { lead: "Lead", booked: "Booked", in_progress: "In progress", review: "Final touches", completed: "Completed", on_hold: "On hold", cancelled: "Cancelled" };
  const stages = () => ({ ...DEFAULT_STAGES, ...((ME && ME.lists && ME.lists.stage_labels) || {}) });
  // project types are his own labels; the first version stored a few as keys
  const LEGACY_TYPES = { production: "Production", songwriting: "Songwriting", vocal_production: "Vocal production", mixing_mastering: "Mixing & mastering",
    music_direction: "Music direction", keys: "Keys session", arrangement: "Arrangement", other: "Other" };
  const typeLabel = (t) => LEGACY_TYPES[t] || t || "";
  const P_VIEWS = [["active", "Active", ["booked", "in_progress", "review"]], ["leads", "Leads", ["lead"]], ["completed", "Completed", ["completed"]],
    ["on_hold", "On hold", ["on_hold", "cancelled"]], ["all", "All", null]];
  const CURRENCY_NAMES = { USD: "US dollar", AUD: "Australian dollar", ZAR: "South African rand", GBP: "British pound", EUR: "Euro", NZD: "New Zealand dollar",
    CAD: "Canadian dollar", ZWG: "Zimbabwe gold", NGN: "Nigerian naira", KES: "Kenyan shilling" };

  function money(cents, opts = {}) {
    const v = (cents || 0) / 100;
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: (ME && ME.currency) || "USD",
        minimumFractionDigits: opts.whole || !(cents % 100) ? 0 : 2, maximumFractionDigits: opts.whole ? 0 : 2 }).format(v);
    } catch { return v.toFixed(2); }
  }
  const projPill = (status) => h("span", { class: "pill p-" + status }, stages()[status] || status);
  const dayText = (d) => d ? new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
  function dueInfo(p, today) {
    if (!p.due_date) return null;
    if (["completed", "cancelled"].includes(p.status)) return { text: "Was due " + dayText(p.due_date), cls: "" };
    const diff = Math.round((Date.parse(p.due_date) - Date.parse(today)) / 86400000);
    if (diff < 0) return { text: `Overdue by ${-diff} ${diff === -1 ? "day" : "days"}`, cls: "over" };
    if (diff === 0) return { text: "Due today", cls: "soon" };
    if (diff <= 7) return { text: `Due in ${diff} ${diff === 1 ? "day" : "days"}`, cls: "soon" };
    return { text: "Due " + dayText(p.due_date), cls: "" };
  }
  const telHref = (phone) => "tel:" + String(phone).replace(/[^\d+]/g, "");
  const waHref = (phone) => "https://wa.me/" + String(phone).replace(/\D/g, "");
  function progressBar(value, label) {
    return h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(value), "aria-label": label || "Progress" },
      h("span", { style: { "--p": value + "%" } }));
  }
  /* Buttons to reach a client: email, call, WhatsApp — whichever details exist. */
  function reachButtons(name, email, phone, primary) {
    const first = String(name || "").split(" ")[0] || "them";
    return [
      email ? h("a", { class: "btn" + (primary ? " btn-terra" : ""), href: `mailto:${encodeURIComponent(email)}` }, "Email " + first) : null,
      phone ? h("a", { class: "btn", href: telHref(phone) }, "Call") : null,
      phone ? h("a", { class: "btn", href: waHref(phone), target: "_blank", rel: "noopener" }, "WhatsApp", h("span", { class: "vh" }, " (opens in a new tab)")) : null,
    ];
  }
  async function clientOptions() {
    const d = await api("contacts?per=100&sort=name&dir=asc");
    return d.rows.map((c) => ({ id: c.id, label: c.name + (c.email ? " · " + c.email : c.phone ? " · " + c.phone : "") }));
  }

  /* The overview's studio strip: projects and money at a glance. */
  function studioStrip(st) {
    if (!st) return null;
    return h("section", { class: "studio-strip", "aria-labelledby": "studioH" },
      h("div", { class: "head" }, h("div", {}, h("h2", { class: "head-h2", id: "studioH" }, "Your studio"), h("p", {}, "Projects and money")),
        h("div", { class: "actions" }, h("a", { class: "btn btn-sm btn-primary", href: "#/projects/new" }, "+ New project"), h("a", { class: "btn btn-sm", href: "#/money" }, "Money →"))),
      h("div", { class: "grid cards four" },
        card("Active projects", num(st.active), h("a", { class: "delta", href: "#/projects" }, st.leads ? `${st.leads} ${st.leads === 1 ? "lead" : "leads"} waiting →` : "See projects →"), true),
        card("Due this week", num(st.due_soon), st.overdue ? h("a", { class: "delta down", href: "#/projects" }, `${st.overdue} overdue →`) : h("span", { class: "delta" }, "Nothing overdue")),
        card("Received this month", money(st.received_month, { whole: true }), h("span", { class: "delta" }, "Spent " + money(st.spent_month, { whole: true }))),
        card("Coming in", money(st.expected, { whole: true }), h("a", { class: "delta", href: "#/money" }, "Expected payments →"))),
      st.projects.length
        ? h("section", { class: "panel section-gap" }, h("div", { class: "panel-head" }, h("h2", {}, "In the studio now"), h("p", {}, "Active projects, soonest due first")),
          h("ul", { class: "inbox" }, st.projects.map((p) => {
            const due = dueInfo(p, st.today);
            return h("li", {},
              h("a", { class: "inbox-main", href: "#/projects/" + p.id }, avatar(p.client_name || p.title),
                h("span", { class: "inbox-body" },
                  h("span", { class: "inbox-top" }, h("b", {}, p.title), due ? h("span", { class: "due nowrap " + due.cls }, due.text) : null),
                  h("span", { class: "inbox-msg" }, (p.client_name || "No client") + " · " + typeLabel(p.type) + " · " + p.progress + "% done"),
                  progressBar(p.progress, p.title + ": " + p.progress + "% done"))),
              h("span", { class: "inbox-side" }, projPill(p.status)));
          })))
        : h("p", { class: "empty section-gap" }, "No active projects yet. ", h("a", { href: "#/projects/new" }, "Log your first project"), "."));
  }

  /* ---------- Projects ---------- */
  const projState = { view: "active", q: "" };

  function projectCard(p, today) {
    const due = dueInfo(p, today);
    const paidOf = p.fee_cents ? `${money(p.received_cents, { whole: true })} of ${money(p.fee_cents, { whole: true })} paid` : p.received_cents ? money(p.received_cents, { whole: true }) + " received" : "No fee set";
    return h("a", { class: "proj", href: "#/projects/" + p.id },
      h("span", { class: "proj-top" }, h("span", { class: "tag" }, typeLabel(p.type)), projPill(p.status)),
      h("span", { class: "proj-title" }, p.title),
      p.client_name ? h("span", { class: "who" }, avatar(p.client_name), h("span", {}, h("span", { class: "proj-client" }, p.client_name),
        p.client_company ? h("span", { class: "sub" }, p.client_company) : null)) : h("span", { class: "sub" }, "No client linked"),
      h("span", { class: "proj-prog" }, progressBar(p.progress, `${p.title}: ${p.progress}% done`),
        h("span", { class: "proj-prog-k" }, h("b", {}, p.progress + "%"), p.tasks_total ? ` · ${p.tasks_done}/${p.tasks_total} to-dos` : "")),
      h("span", { class: "proj-foot" }, due ? h("span", { class: "due " + due.cls }, due.text) : h("span", { class: "muted" }, "No due date"), h("span", { class: "muted" }, paidOf)));
  }

  async function projects(params) {
    if (params.has("view") && P_VIEWS.some((v) => v[0] === params.get("view"))) projState.view = params.get("view");
    const qs = new URLSearchParams({ view: projState.view });
    if (projState.q) qs.set("q", projState.q);
    const d = await api("projects?" + qs);
    const countOf = (v) => v[2] ? v[2].reduce((a, s) => a + (d.counts[s] || 0), 0) : Object.values(d.counts).reduce((a, n) => a + n, 0);
    const search = h("input", { type: "search", placeholder: "Search projects, clients or notes", value: projState.q, "aria-label": "Search projects" });
    let t;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { projState.q = search.value.trim(); projects(new URLSearchParams()).catch(failed); }, 300); });
    const view = P_VIEWS.find((v) => v[0] === projState.view);
    render(
      head("Projects", `${num(d.rows.length)} ${d.rows.length === 1 ? "project" : "projects"} · ${view[1].toLowerCase()}`,
        h("a", { class: "btn btn-primary", href: "#/projects/new" }, "+ New project")),
      h("div", { class: "chips", role: "group", "aria-label": "Show" }, P_VIEWS.map((v) =>
        h("button", { type: "button", class: "chip", "aria-pressed": String(projState.view === v[0]), onclick: () => {
          projState.view = v[0]; history.replaceState(null, "", "#/projects?view=" + v[0]); projects(new URLSearchParams()).catch(failed);
        } }, v[1], h("b", {}, num(countOf(v)))))),
      h("div", { class: "toolbar" }, h("div", { class: "grow" }, search)),
      d.rows.length ? h("div", { class: "proj-grid" }, d.rows.map((p) => projectCard(p, d.today)))
        : h("p", { class: "empty" }, projState.q ? "No projects match that search."
          : { active: "No active projects. Start one with New project, or from an enquiry.", leads: "No leads waiting.", completed: "Nothing completed yet.", on_hold: "Nothing on hold.", all: "No projects yet." }[projState.view]));
  }

  /* The project form, for new projects and for editing details. */
  function projectForm(initial, clients, { submitLabel, onSubmit, onCancel }) {
    const f = (id, label, input, hint) => h("label", { class: "fld", for: id }, h("span", {}, label), input, hint ? h("small", { class: "muted" }, hint) : null);
    const title = h("input", { type: "text", id: "pTitle", value: initial.title || "", required: true, maxlength: "160", placeholder: "e.g. Live worship album" });
    const typeList = [...((ME && ME.lists && ME.lists.project_types) || ["Production"])];
    if (initial.type && !typeList.includes(typeLabel(initial.type))) typeList.push(typeLabel(initial.type));
    const type = h("select", { id: "pType" }, typeList.map((l) => h("option", { value: l }, l)));
    type.value = typeLabel(initial.type) || typeList[0];
    const status = h("select", { id: "pStatus" }, Object.entries(stages()).map(([k, l]) => h("option", { value: k }, l)));
    status.value = initial.status || "booked";
    const client = h("select", { id: "pClient" }, h("option", { value: "" }, "No client yet"), clients.map((c) => h("option", { value: c.id }, c.label)));
    client.value = initial.contact_id || "";
    const nName = h("input", { type: "text", id: "nName", placeholder: "Full name or organisation" });
    const nEmail = h("input", { type: "email", id: "nEmail", placeholder: "name@email.com" });
    const nPhone = h("input", { type: "tel", id: "nPhone", placeholder: "+263 …" });
    const nCompany = h("input", { type: "text", id: "nCompany", placeholder: "Church, label, band…" });
    const existingBox = h("div", {}, f("pClient", "Choose a client", client));
    const newBox = h("div", { class: "stack inset-box", hidden: true },
      h("div", { class: "form-row" }, f("nName", "Name", nName), f("nCompany", "Company (optional)", nCompany)),
      h("div", { class: "form-row" }, f("nEmail", "Email (optional)", nEmail), f("nPhone", "Phone (optional)", nPhone)));
    let mode = "existing";
    const modeSeg = h("div", { class: "seg", role: "group", "aria-label": "Client" }, [["existing", "Existing client"], ["new", "New client"]].map(([k, l]) =>
      h("button", { type: "button", "aria-pressed": String(k === mode), onclick: (e) => {
        mode = k;
        modeSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
        existingBox.hidden = k !== "existing"; newBox.hidden = k !== "new";
        (k === "new" ? nName : client).focus();
      } }, l)));
    if (!clients.length) { mode = "new"; existingBox.hidden = true; newBox.hidden = false; modeSeg.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === 1))); }
    const start = h("input", { type: "date", id: "pStart", value: initial.start_date || "" });
    const due = h("input", { type: "date", id: "pDue", value: initial.due_date || "" });
    const fee = h("input", { type: "text", id: "pFee", inputmode: "decimal", placeholder: "0", value: initial.fee_cents ? (initial.fee_cents / 100).toString() : "" });
    const notes = h("textarea", { id: "pNotes", rows: "4", placeholder: "What's the brief? Songs, references, budget, people involved…" }, initial.notes || "");
    const err = h("p", { class: "form-error", role: "alert" });
    const showNotes = initial.notes !== undefined;
    return h("form", { class: "stack", onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      const body = { title: title.value, type: type.value, status: status.value, start_date: start.value, due_date: due.value, fee: fee.value };
      if (showNotes) body.notes = notes.value;
      if (mode === "new" && nName.value.trim()) body.client = { name: nName.value, email: nEmail.value, phone: nPhone.value, company: nCompany.value };
      else if (mode === "existing") body.contact_id = client.value;
      const msg = await onSubmit(body);
      if (msg) { err.textContent = msg; title.focus(); }
    } },
      f("pTitle", "Project name", title),
      h("div", { class: "form-row" }, f("pType", "Type", type), f("pStatus", "Stage", status)),
      h("div", { class: "stack client-pick" }, h("div", { class: "panel-head" }, h("span", { class: "fld-k" }, "Client"), modeSeg), existingBox, newBox),
      h("div", { class: "form-row" }, f("pStart", "Start date", start), f("pDue", "Due date", due), f("pFee", `Agreed fee (${(ME && ME.currency) || "USD"})`, fee)),
      showNotes ? f("pNotes", "Notes", notes) : null,
      err,
      h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "submit" }, submitLabel), onCancel ? h("button", { class: "btn", type: "button", onclick: onCancel }, "Cancel") : null));
  }

  async function newProject(params) {
    loading();
    const clients = await clientOptions();
    const initial = { title: params.get("title") || "", contact_id: params.get("client") || "", status: params.get("enquiry") ? "lead" : "booked", notes: params.get("notes") || "" };
    render(
      h("a", { class: "back", href: "#/projects" }, "← Projects"),
      head("New project", params.get("enquiry") ? "Started from an enquiry — the client is already linked" : "Log a project to track its to-dos, notes and money"),
      h("section", { class: "panel form-panel" }, projectForm(initial, clients, {
        submitLabel: "Create project",
        onSubmit: async (body) => {
          if (params.get("enquiry")) body.enquiry_id = params.get("enquiry");
          try { const r = await api("projects", { method: "POST", body }); toast("Project created."); location.hash = "#/projects/" + r.id; return null; }
          catch (err) { return err.message; }
        },
        onCancel: () => { location.hash = "#/projects"; },
      })));
  }

  /* A small form to log money, inline. */
  function moneyForm(kind, { projects: projList, projectId, onDone, onCancel, categories }) {
    const f = (id, label, input) => h("label", { class: "fld", for: id }, h("span", {}, label), input);
    const uid = kind + Math.random().toString(36).slice(2, 7);
    const amount = h("input", { type: "text", id: uid + "a", inputmode: "decimal", placeholder: "0.00", required: true });
    const date = h("input", { type: "date", id: uid + "d", value: new Date().toISOString().slice(0, 10) });
    const settled = h("select", { id: uid + "s" }, kind === "income"
      ? [h("option", { value: "1" }, "Received"), h("option", { value: "0" }, "Expected (still to come in)")]
      : [h("option", { value: "1" }, "Paid"), h("option", { value: "0" }, "Still to pay")]);
    const cat = h("select", { id: uid + "c" }, categories.map((c) => h("option", { value: c }, c)));
    const desc = h("input", { type: "text", id: uid + "x", maxlength: "300", placeholder: kind === "income" ? "e.g. 50% deposit" : "e.g. Session drummer" });
    const proj = projList ? h("select", { id: uid + "p" }, h("option", { value: "" }, "General studio (no project)"), projList.map((p) => h("option", { value: p.id }, p.title))) : null;
    const err = h("p", { class: "form-error", role: "alert" });
    setTimeout(() => amount.focus(), 0);
    return h("form", { class: "panel money-form " + kind, onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      try {
        await api("transactions", { method: "POST", body: { kind, amount: amount.value, date: date.value, settled: settled.value === "1", category: cat.value,
          description: desc.value, project_id: projectId || (proj ? proj.value : "") } });
        toast(kind === "income" ? "Income logged." : "Expense logged.");
        onDone();
      } catch (x) { err.textContent = x.message; }
    } },
      h("div", { class: "panel-head" }, h("h2", {}, kind === "income" ? "Log income" : "Log an expense")),
      h("div", { class: "form-row" }, f(uid + "a", `Amount (${(ME && ME.currency) || "USD"})`, amount), f(uid + "d", "Date", date), f(uid + "s", "Status", settled)),
      h("div", { class: "form-row" }, f(uid + "c", "Category", cat), f(uid + "x", "Description", desc), proj ? f(uid + "p", "Project", proj) : null),
      err,
      h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "submit" }, "Save"), h("button", { class: "btn", type: "button", onclick: onCancel }, "Cancel")));
  }

  /* Edit a money entry in place. */
  function txEditForm(x, li, onChange) {
    const inc = x.kind === "income";
    const cats = [...((ME.lists && (inc ? ME.lists.income_categories : ME.lists.expense_categories)) || [])];
    if (x.category && !cats.includes(x.category)) cats.push(x.category);
    const amount = h("input", { type: "text", inputmode: "decimal", value: (x.amount_cents / 100).toFixed(2).replace(/\.00$/, ""), "aria-label": "Amount" });
    const date = h("input", { type: "date", value: x.date, "aria-label": "Date" });
    const settled = h("select", { "aria-label": "Status" }, inc ? [h("option", { value: "1" }, "Received"), h("option", { value: "0" }, "Expected")]
      : [h("option", { value: "1" }, "Paid"), h("option", { value: "0" }, "To pay")]);
    settled.value = x.settled ? "1" : "0";
    const cat = h("select", { "aria-label": "Category" }, cats.map((c) => h("option", { value: c }, c)));
    cat.value = x.category;
    const desc = h("input", { type: "text", value: x.description, maxlength: "300", "aria-label": "Description", placeholder: "Description" });
    const err = h("p", { class: "form-error", role: "alert" });
    return h("li", { class: "tx editing" }, h("form", { class: "tx-edit", onsubmit: async (e) => {
      e.preventDefault();
      try { await api("transactions/" + x.id, { method: "PATCH", body: { amount: amount.value, date: date.value, settled: settled.value === "1", category: cat.value, description: desc.value } }); toast("Entry saved."); onChange(); }
      catch (y) { err.textContent = y.message; }
    } }, desc, amount, date, settled, cat, h("div", { class: "actions" }, h("button", { class: "btn btn-sm btn-primary", type: "submit" }, "Save"),
      h("button", { class: "btn btn-sm", type: "button", onclick: (e) => e.currentTarget.closest("li").replaceWith(li) }, "Cancel")), err));
  }

  function txRow(x, { onChange, showProject }) {
    const inc = x.kind === "income";
    const state = inc ? (x.settled ? "Received" : "Expected") : (x.settled ? "Paid" : "To pay");
    const li = h("li", { class: "tx " + (inc ? "in" : "out") + (x.settled ? "" : " pending") },
      h("span", { class: "tx-sign", "aria-hidden": "true" }, inc ? "+" : "−"),
      h("span", { class: "tx-body" },
        h("b", {}, x.description || x.category || (inc ? "Income" : "Expense")),
        h("span", { class: "sub" }, [dayText(x.date), x.category, showProject && x.project_title ? x.project_title : null].filter(Boolean).join(" · "))),
      h("span", { class: "tx-amt" }, h("b", {}, (inc ? "" : "−") + money(x.amount_cents)), h("span", { class: "sub" }, state)),
      h("span", { class: "tx-act" },
        !x.settled ? h("button", { class: "btn btn-sm btn-done", type: "button", onclick: async () => {
          try { await api("transactions/" + x.id, { method: "PATCH", body: { settled: true } }); toast(inc ? "Marked received." : "Marked paid."); onChange(); } catch (e) { toast(e.message, true); }
        } }, inc ? "Received" : "Paid") : null,
        h("button", { class: "btn btn-sm btn-ghost", type: "button", "aria-label": "Edit " + (x.description || x.category || "entry"), onclick: () => li.replaceWith(txEditForm(x, li, onChange)) }, "Edit"),
        h("button", { class: "btn btn-sm btn-ghost", type: "button", "aria-label": "Delete " + (x.description || x.category || "entry"), onclick: async () => {
          if (!(await confirmAction("Delete this entry?", `${(inc ? "" : "−") + money(x.amount_cents)} on ${dayText(x.date)} will be removed.`, "Delete"))) return;
          try { await api("transactions/" + x.id, { method: "DELETE" }); toast("Entry deleted."); onChange(); } catch (e) { toast(e.message, true); }
        } }, "✕")));
    return li;
  }

  /* The client on a project: edit their details here, or link / add one. */
  function clientPanel(p, again) {
    const box = h("div", { class: "stack" });
    const f = (id, label, input) => h("label", { class: "fld", for: id }, h("span", {}, label), input);
    const linkTo = async (contactId, msg) => {
      try { await api("projects/" + p.id, { method: "PATCH", body: { contact_id: contactId } }); toast(msg); again(); } catch (x) { toast(x.message, true); }
    };
    const pick = async () => {
      const clients = await clientOptions();
      const sel = h("select", { id: "cpSel" }, h("option", { value: "" }, "Choose a client…"), clients.map((c) => h("option", { value: c.id }, c.label)));
      const nName = h("input", { type: "text", id: "cpName", placeholder: "Name" });
      const nCompany = h("input", { type: "text", id: "cpCompany", placeholder: "Company (optional)" });
      const nEmail = h("input", { type: "email", id: "cpEmail", placeholder: "Email (optional)" });
      const nPhone = h("input", { type: "tel", id: "cpPhone", placeholder: "Phone (optional)" });
      const err = h("p", { class: "form-error", role: "alert" });
      box.replaceChildren(
        h("div", { class: "panel-head" }, h("h2", {}, "Client"), p.contact_id ? h("button", { class: "btn btn-sm", type: "button", onclick: show }, "Cancel") : null),
        clients.length ? h("div", { class: "form-row" }, f("cpSel", "An existing client", sel),
          h("button", { class: "btn", type: "button", onclick: () => sel.value && linkTo(sel.value, "Client linked.") }, "Link")) : null,
        h("p", { class: "muted" }, clients.length ? "…or add a new one:" : "Add the client:"),
        h("form", { class: "stack", onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = "";
          try {
            const r = await api("clients", { method: "POST", body: { name: nName.value, company: nCompany.value, email: nEmail.value, phone: nPhone.value } });
            await linkTo(r.id, "Client added and linked.");
          } catch (x) { err.textContent = x.message; }
        } }, h("div", { class: "form-row" }, f("cpName", "Name", nName), f("cpCompany", "Company", nCompany)),
          h("div", { class: "form-row" }, f("cpEmail", "Email", nEmail), f("cpPhone", "Phone", nPhone)), err,
          h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "submit" }, "Add client"))));
    };
    const show = () => {
      if (!p.contact_id) return pick();
      const name = h("input", { type: "text", id: "cpeName", value: p.client_name || "" });
      const company = h("input", { type: "text", id: "cpeCompany", value: p.client_company || "" });
      const email = h("input", { type: "email", id: "cpeEmail", value: p.client_email || "" });
      const phone = h("input", { type: "tel", id: "cpePhone", value: p.client_phone || "", placeholder: "+263 …" });
      const err = h("p", { class: "form-error", role: "alert" });
      box.replaceChildren(
        h("div", { class: "panel-head" }, h("h2", {}, "Client"), h("a", { class: "btn btn-sm btn-ghost", href: "#/contacts/" + p.contact_id }, "Open client →")),
        h("form", { class: "stack", onsubmit: async (e) => {
          e.preventDefault();
          err.textContent = "";
          try { await api("contacts/" + p.contact_id, { method: "PATCH", body: { name: name.value, company: company.value, email: email.value, phone: phone.value } }); toast("Client details saved."); again(); }
          catch (x) { err.textContent = x.message; }
        } }, h("div", { class: "form-row" }, f("cpeName", "Name", name), f("cpeCompany", "Company", company)),
          h("div", { class: "form-row" }, f("cpeEmail", "Email", email), f("cpePhone", "Phone", phone)), err,
          h("div", { class: "actions" }, h("button", { class: "btn btn-primary btn-sm", type: "submit" }, "Save client"),
            h("button", { class: "btn btn-sm", type: "button", onclick: pick }, "Change client"),
            h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => linkTo("", "Client unlinked.") }, "Unlink"))));
    };
    show();
    return box;
  }

  async function project(id) {
    loading();
    const [d, meta, inv] = await Promise.all([api("projects/" + id), api("money?range=month"), api("invoices?project=" + id)]);
    const p = d.project;
    const again = () => project(id).catch(failed);
    const save = async (body, msg) => {
      try { await api("projects/" + id, { method: "PATCH", body }); toast(msg); again(); return null; }
      catch (err) { toast(err.message, true); return err.message; }
    };
    const due = dueInfo(p, d.today);
    const balance = Math.max(0, p.fee_cents - p.received_cents - p.expected_cents);
    const profit = p.received_cents - p.expenses_cents;

    /* to-do list */
    const newTask = h("input", { type: "text", placeholder: "Add a to-do, e.g. Record backing vocals", maxlength: "300", "aria-label": "New to-do" });
    const taskForm = h("form", { class: "task-add", onsubmit: async (e) => {
      e.preventDefault();
      if (!newTask.value.trim()) return;
      try { await api(`projects/${id}/tasks`, { method: "POST", body: { title: newTask.value } }); again(); } catch (x) { toast(x.message, true); }
    } }, newTask, h("button", { class: "btn btn-primary", type: "submit" }, "Add"));
    const renameTask = (t, li) => {
      const input = h("input", { type: "text", value: t.title, maxlength: "300", "aria-label": "Rename to-do" });
      const done = async (keep) => {
        if (keep && input.value.trim() && input.value.trim() !== t.title) { try { await api("tasks/" + t.id, { method: "PATCH", body: { title: input.value } }); again(); return; } catch (x) { toast(x.message, true); } }
        form.replaceWith(li);
      };
      const form = h("form", { class: "task-add task-rename", onsubmit: (e) => { e.preventDefault(); done(true); } }, input,
        h("button", { class: "btn btn-sm btn-primary", type: "submit" }, "Save"), h("button", { class: "btn btn-sm", type: "button", onclick: () => done(false) }, "Cancel"));
      li.replaceWith(form);
      input.focus(); input.select();
    };
    const tasks = h("ul", { class: "tasks" }, d.tasks.map((t) => { const li = h("li", { class: t.done ? "done" : "" },
      h("label", { class: "task" }, h("input", { type: "checkbox", checked: !!t.done, onchange: async (e) => {
        try { await api("tasks/" + t.id, { method: "PATCH", body: { done: e.target.checked } }); again(); } catch (x) { toast(x.message, true); }
      } }), h("span", {}, t.title)),
      h("button", { class: "btn btn-sm btn-ghost", type: "button", "aria-label": "Rename to-do: " + t.title, onclick: () => renameTask(t, li) }, "Edit"),
      h("button", { class: "btn btn-sm btn-ghost", type: "button", "aria-label": "Delete to-do: " + t.title, onclick: async () => {
        try { await api("tasks/" + t.id, { method: "DELETE" }); again(); } catch (x) { toast(x.message, true); }
      } }, "✕")); return li; }));

    /* progress */
    const slider = h("input", { type: "range", min: "0", max: "100", step: "5", value: String(p.progress), "aria-label": "Progress", class: "slider", style: { "--p": p.progress + "%" } });
    const pctLabel = h("b", { class: "big-pct" }, p.progress + "%");
    slider.addEventListener("input", () => { pctLabel.textContent = slider.value + "%"; slider.style.setProperty("--p", slider.value + "%"); });
    slider.addEventListener("change", () => save({ progress: Number(slider.value) }, "Progress saved."));

    /* money */
    const moneySlot = h("div");
    const showMoneyForm = (kind) => moneySlot.replaceChildren(moneyForm(kind, { projectId: id, categories: kind === "income" ? meta.incomeCategories : meta.expenseCategories,
      onDone: again, onCancel: () => moneySlot.replaceChildren() }));

    /* details / edit */
    const detailsBox = h("div");
    const showDetails = () => detailsBox.replaceChildren(
      h("div", { class: "panel-head" }, h("h2", {}, "Details"), h("button", { class: "btn btn-sm", type: "button", onclick: showEdit }, "Edit")),
      h("dl", { class: "meta" },
        h("dt", {}, "Client"), h("dd", {}, p.contact_id ? h("a", { href: "#/contacts/" + p.contact_id }, p.client_name) : "None linked"),
        h("dt", {}, "Type"), h("dd", {}, typeLabel(p.type)),
        h("dt", {}, "Start"), h("dd", {}, dayText(p.start_date)),
        h("dt", {}, "Due"), h("dd", {}, p.due_date ? [dayText(p.due_date), due && due.cls ? h("span", { class: "due " + due.cls }, " · " + due.text) : null] : "—"),
        p.completed_at ? [h("dt", {}, "Completed"), h("dd", {}, when(p.completed_at))] : null,
        p.enquiry_id ? [h("dt", {}, "From"), h("dd", {}, h("a", { href: "#/enquiries/" + p.enquiry_id }, "Their enquiry"))] : null,
        h("dt", {}, "Created"), h("dd", {}, when(p.created_at))));
    const showEdit = async () => {
      const clients = await clientOptions();
      detailsBox.replaceChildren(h("div", { class: "panel-head" }, h("h2", {}, "Edit details")),
        projectForm(p, clients, { submitLabel: "Save", onSubmit: (body) => save(body, "Project saved."), onCancel: showDetails }));
    };
    showDetails();

    const notes = h("textarea", { id: "projNotes", rows: "7", placeholder: "Your notes: the brief, references, decisions, who's playing, what's next…" }, p.notes);
    render(
      h("a", { class: "back", href: "#/projects" }, "← Projects"),
      h("div", { class: "head" },
        h("div", {}, h("span", { class: "hero-k" }, typeLabel(p.type)), h("h1", {}, p.title),
          h("p", {}, p.client_name ? p.client_name + (p.client_company ? " · " + p.client_company : "") : "No client linked", due ? [" · ", h("span", { class: "due " + due.cls }, due.text)] : null)),
        h("label", { class: "head-status" }, h("span", { class: "muted" }, "Stage"),
          (() => { const sel = h("select", {}, Object.entries(stages()).map(([k, l]) => h("option", { value: k }, l))); sel.value = p.status;
            sel.addEventListener("change", () => save({ status: sel.value }, "Moved to " + stages()[sel.value] + ".")); return sel; })())),
      h("div", { class: "actions action-bar" },
        p.status === "completed"
          ? h("button", { class: "btn", type: "button", onclick: () => save({ status: "in_progress" }, "Reopened.") }, "Reopen")
          : h("button", { class: "btn btn-done", type: "button", onclick: () => save({ status: "completed" }, "Project completed. 🎉") }, "Mark complete"),
        reachButtons(p.client_name, p.client_email, p.client_phone, true),
        h("button", { class: "btn", type: "button", onclick: () => newInvoice({ project_id: id }) }, "Create invoice")),
      h("section", { class: "panel progress-panel section-gap" },
        h("div", { class: "panel-head" }, h("h2", {}, "Progress"), h("p", {}, d.tasks.length ? "Moves with your to-do list — or set it yourself" : "Drag to set how far along it is")),
        h("div", { class: "progress-row" }, pctLabel, h("div", { class: "grow" }, slider))),
      h("div", { class: "detail section-gap" },
        h("div", { class: "stack" },
          h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "To do"),
            h("p", {}, d.tasks.length ? `${d.tasks.filter((t) => t.done).length} of ${d.tasks.length} done` : "Break the project into steps")), taskForm,
            d.tasks.length ? tasks : h("p", { class: "empty" }, "No to-dos yet. Add the first step above.")),
          h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, h("label", { for: "projNotes" }, "Notes"))), notes,
            h("div", { class: "actions section-gap" }, h("button", { class: "btn btn-primary", type: "button", onclick: () => save({ notes: notes.value }, "Notes saved.") }, "Save notes")))),
        h("div", { class: "stack" },
          h("section", { class: "panel" },
            h("div", { class: "panel-head" }, h("h2", {}, "Money")),
            h("dl", { class: "money-sum" },
              h("div", {}, h("dt", {}, "Agreed fee"), h("dd", {}, money(p.fee_cents))),
              h("div", {}, h("dt", {}, "Received"), h("dd", { class: "pos" }, money(p.received_cents))),
              h("div", {}, h("dt", {}, "Expected"), h("dd", {}, money(p.expected_cents))),
              h("div", {}, h("dt", {}, "Still to invoice"), h("dd", {}, money(balance))),
              h("div", {}, h("dt", {}, "Expenses"), h("dd", { class: "neg" }, money(p.expenses_cents))),
              h("div", { class: "total" }, h("dt", {}, "Profit so far"), h("dd", {}, money(profit)))),
            h("div", { class: "actions section-gap" },
              h("button", { class: "btn btn-sm", type: "button", onclick: () => showMoneyForm("income") }, "+ Payment"),
              h("button", { class: "btn btn-sm", type: "button", onclick: () => showMoneyForm("expense") }, "+ Expense")),
            moneySlot,
            d.transactions.length ? h("ul", { class: "txs" }, d.transactions.map((x) => txRow(x, { onChange: again }))) : null,
            h("div", { class: "panel-head section-gap" }, h("h3", { class: "h3" }, "Invoices"), h("button", { class: "btn btn-sm", type: "button", onclick: () => newInvoice({ project_id: id }) }, "+ Invoice")),
            inv.rows.length ? h("ul", { class: "inbox" }, inv.rows.map((iv) => h("li", {},
              h("a", { class: "inbox-main", href: "#/invoices/" + iv.id }, h("span", { class: "inbox-body" },
                h("span", { class: "inbox-top" }, h("b", {}, iv.number), h("span", { class: "inv-amt" }, money(iv.totals.total))),
                h("span", { class: "inbox-msg" }, "Issued " + dayText(iv.issue_date)))),
              h("span", { class: "inbox-side" }, invPill(iv.display_status))))) : h("p", { class: "muted" }, "No invoices yet.")),
          h("section", { class: "panel" }, clientPanel(p, again)),
          h("section", { class: "panel" }, detailsBox),
          h("section", { class: "panel" }, h("div", { class: "actions" },
            h("button", { class: "btn btn-danger", type: "button", onclick: async () => {
              if (!(await confirmAction("Delete this project?", `“${p.title}”, its to-dos and its ${d.transactions.length} money ${d.transactions.length === 1 ? "entry" : "entries"} will be removed permanently.`, "Delete project"))) return;
              try { await api("projects/" + id, { method: "DELETE" }); toast("Project deleted."); location.hash = "#/projects"; } catch (x) { toast(x.message, true); }
            } }, "Delete project"))))));
  }

  /* ---------- Money ---------- */
  const moneyState = { range: store.get("moneyRange", "month"), form: null };

  function monthBars(months) {
    const W = Math.round(Math.max(300, Math.min(1100, main.clientWidth - 64))), H = W < 520 ? 160 : 190, B = 22;
    const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
    const slot = W / months.length, bw = Math.max(4, Math.min(16, slot * 0.26));
    const svg = s("svg", { class: "chart mbars", viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": "Income and expenses per month for the last 12 months. A data table follows." });
    svg.append(s("line", { class: "grid-line", x1: 0, x2: W, y1: H - B, y2: H - B }));
    months.forEach((m, i) => {
      const cx = i * slot + slot / 2;
      const ih = Math.max(m.income ? 2 : 0, (m.income / max) * (H - B - 10));
      const eh = Math.max(m.expense ? 2 : 0, (m.expense / max) * (H - B - 10));
      const label = new Date(m.month + "-01T00:00:00Z").toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
      const g = s("g", {});
      g.append(s("rect", { class: "in", x: cx - bw - 1.5, y: H - B - ih, width: bw, height: ih, rx: Math.min(4, bw / 2) }));
      g.append(s("rect", { class: "out", x: cx + 1.5, y: H - B - eh, width: bw, height: eh, rx: Math.min(4, bw / 2) }));
      g.append(s("rect", { class: "hit", x: i * slot, y: 0, width: slot, height: H }, s("title", {}, `${label}: in ${money(m.income)}, out ${money(m.expense)}`)));
      if (W > 520 || i % 2 === 0) g.append(s("text", { class: "axis", x: cx, y: H - 6, "text-anchor": "middle" }, label));
      svg.append(g);
    });
    const table = h("table", {}, h("caption", { class: "vh" }, "Income and expenses per month"),
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Month"), h("th", { scope: "col", class: "num" }, "Income"), h("th", { scope: "col", class: "num" }, "Expenses"))),
      h("tbody", {}, months.map((m) => h("tr", {}, h("th", { scope: "row" }, m.month), h("td", { class: "num" }, money(m.income)), h("td", { class: "num" }, money(m.expense))))));
    return h("div", {}, svg, h("ul", { class: "legend" }, h("li", {}, h("i", {}), "Income received"), h("li", {}, h("i", { class: "out" }), "Expenses paid")),
      h("details", { class: "data" }, h("summary", {}, "Show as a table"), h("div", { class: "table-wrap" }, table)));
  }

  async function moneyPage() {
    loading();
    const [d, projs] = await Promise.all([api("money?range=" + moneyState.range), api("projects?view=all")]);
    const t = d.totals;
    const ranges = [["month", "This month"], ["3m", "3 months"], ["year", "This year"], ["all", "All time"]];
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Period" }, ranges.map(([k, l]) =>
      h("button", { type: "button", "aria-pressed": String(moneyState.range === k), onclick: () => { moneyState.range = k; store.set("moneyRange", k); moneyPage().catch(failed); } }, l)));
    const formSlot = h("div");
    const openForm = (kind) => formSlot.replaceChildren(moneyForm(kind, { projects: projs.rows, categories: kind === "income" ? d.incomeCategories : d.expenseCategories,
      onDone: () => moneyPage().catch(failed), onCancel: () => formSlot.replaceChildren() }));
    const rangeLabel = { month: "this month", "3m": "in the last 3 months", year: "this year", all: "all time" }[d.range.range];
    render(
      head("Money", "Income and production costs, " + rangeLabel + " · " + (CURRENCY_NAMES[d.currency] || d.currency),
        h("div", { class: "actions" },
          h("button", { class: "btn btn-primary", type: "button", onclick: () => openForm("income") }, "+ Income"),
          h("button", { class: "btn", type: "button", onclick: () => openForm("expense") }, "+ Expense"),
          h("a", { class: "btn", href: "#/invoices" }, "Invoices"),
          h("a", { class: "btn btn-ghost", href: "/api/admin/transactions.csv" }, "Export"))),
      h("div", { class: "toolbar" }, seg),
      formSlot,
      h("div", { class: "grid cards five" },
        card("Received", money(t.received, { whole: true }), h("span", { class: "delta" }, "Income " + rangeLabel), true),
        card("Coming in", money(t.expected, { whole: true }), h("span", { class: "delta" }, "Logged as expected")),
        card("Still to invoice", money(t.uninvoiced, { whole: true }), h("span", { class: "delta" }, "Agreed fees not yet logged")),
        card("Spent", money(t.spent, { whole: true }), h("span", { class: "delta" }, "Production costs " + rangeLabel)),
        card("Profit", money(t.net, { whole: true }), h("span", { class: "delta " + (t.net >= 0 ? "up" : "down") }, "Received minus spent"))),
      h("section", { class: "panel section-gap" }, h("div", { class: "panel-head" }, h("h2", {}, "The last 12 months"), h("p", {}, "Money in and out each month")), monthBars(d.months)),
      h("div", { class: "grid two section-gap" },
        panel("Coming in and due", "Expected payments and unpaid costs, soonest first",
          d.upcoming.length ? h("ul", { class: "txs" }, d.upcoming.map((x) => txRow(x, { onChange: () => moneyPage().catch(failed), showProject: true })))
            : h("p", { class: "empty" }, "Nothing outstanding. Log expected payments with “+ Income”.")),
        panel("Where the money goes", "Expenses by category " + rangeLabel,
          bars(d.categories, { label: (r) => r.name, value: (r) => r.n, fmt: (v) => money(v), cls: "alt", empty: "No expenses " + rangeLabel + "." }))),
      h("section", { class: "panel section-gap" }, h("div", { class: "panel-head" }, h("h2", {}, "All entries"), h("p", {}, rangeLabel)),
        d.recent.length ? h("ul", { class: "txs" }, d.recent.map((x) => txRow(x, { onChange: () => moneyPage().catch(failed), showProject: true })))
          : h("p", { class: "empty" }, "No income or expenses logged " + rangeLabel + ".")));
  }

  /* ---------- Invoices ---------- */
  const I_STATUS = { draft: "Draft", sent: "Sent", overdue: "Overdue", paid: "Paid", void: "Void" };
  const invPill = (s) => h("span", { class: "pill i-" + s }, I_STATUS[s] || s);
  const invState = { status: "all", q: "" };
  const centsToInput = (c) => (c ? (c / 100).toFixed(2).replace(/\.00$/, "") : "");

  async function newInvoice(body) {
    try { const r = await api("invoices", { method: "POST", body: body || {} }); toast("Invoice started."); location.hash = "#/invoices/" + r.id; }
    catch (x) { toast(x.message, true); }
  }

  async function invoices(params) {
    if (params.has("status")) invState.status = params.get("status");
    const qs = new URLSearchParams({ status: invState.status });
    if (invState.q) qs.set("q", invState.q);
    const d = await api("invoices?" + qs);
    const sm = d.summary, cnt = sm.counts || {};
    const views = [["all", "All"], ["draft", "Drafts"], ["sent", "Sent"], ["overdue", "Overdue"], ["paid", "Paid"], ["void", "Void"]];
    const search = h("input", { type: "search", placeholder: "Search number, client or project", value: invState.q, "aria-label": "Search invoices" });
    let t;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { invState.q = search.value.trim(); invoices(new URLSearchParams()).catch(failed); }, 300); });
    render(
      head("Invoices", "Branded PDF invoices, ready to download or send", h("button", { class: "btn btn-primary", type: "button", onclick: () => newInvoice() }, "+ New invoice")),
      h("div", { class: "grid cards four" },
        card("Outstanding", money(sm.outstanding, { whole: true }), h("span", { class: "delta" }, "Sent and not yet paid"), true),
        card("Overdue", money(sm.overdue, { whole: true }), sm.overdue ? h("span", { class: "delta down" }, "Past the due date") : h("span", { class: "delta" }, "Nothing overdue")),
        card("Paid this year", money(sm.paid_year, { whole: true }), h("span", { class: "delta" }, "Logged in Money")),
        card("Drafts", num(sm.drafts), h("span", { class: "delta" }, "Not sent yet"))),
      h("div", { class: "chips section-gap", role: "group", "aria-label": "Show" }, views.map(([k, l]) =>
        h("button", { type: "button", class: "chip", "aria-pressed": String(invState.status === k), onclick: () => { invState.status = k; invoices(new URLSearchParams()).catch(failed); } },
          l, h("b", {}, num(k === "all" ? ["draft", "sent", "paid", "void"].reduce((a, s2) => a + (cnt[s2] || 0), 0) : cnt[k] || 0))))),
      h("div", { class: "toolbar" }, h("div", { class: "grow" }, search)),
      h("section", { class: "panel" }, d.rows.length ? h("ul", { class: "inbox" }, d.rows.map((iv) => h("li", { class: iv.display_status === "overdue" ? "unread" : "" },
        h("a", { class: "inbox-main", href: "#/invoices/" + iv.id }, avatar(iv.client_name || iv.number),
          h("span", { class: "inbox-body" },
            h("span", { class: "inbox-top" }, h("b", {}, iv.client_name || "No client yet"), h("span", { class: "inv-amt" }, money(iv.totals.total))),
            h("span", { class: "inbox-msg" }, [iv.number, iv.project_title, "issued " + dayText(iv.issue_date), iv.due_date && iv.status !== "paid" ? "due " + dayText(iv.due_date) : null].filter(Boolean).join(" · ")))),
        h("span", { class: "inbox-side" }, invPill(iv.display_status),
          h("a", { class: "btn btn-sm", href: `/api/admin/invoices/${iv.id}/pdf`, "aria-label": "Download " + iv.number + " as PDF" }, "PDF")))))
        : h("p", { class: "empty" }, invState.q ? "No invoices match that search." : "No invoices yet. Start one here, or from a project with “Create invoice”.")));
  }

  /* Grows a one-line textarea to fit what's typed (where CSS field-sizing isn't supported). */
  function fitText(el) {
    if (CSS.supports && CSS.supports("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  }

  async function invoice(id) {
    loading();
    const [d, clientList, projList] = await Promise.all([api("invoices/" + id), clientOptions(), api("projects?view=all")]);
    let inv = d.invoice;
    const again = () => invoice(id).catch(failed);
    const act = async (path, body, msg, method = "POST") => {
      try { const r = await api(path, { method, body }); toast(msg); again(); return r; } catch (x) { toast(x.message, true); return null; }
    };
    const f = (id2, label, input) => h("label", { class: "fld", for: id2 }, h("span", {}, label), input);
    const inp = (id2, value, attrs = {}) => h("input", { type: "text", id: id2, value: value ?? "", autocomplete: "off", ...attrs });

    /* client */
    const cName = inp("ivName", inv.client_name, { placeholder: "Client or organisation" });
    const cCompany = inp("ivCompany", inv.client_company);
    const cEmail = inp("ivEmail", inv.client_email, { type: "email" });
    const cPhone = inp("ivPhone", inv.client_phone, { type: "tel" });
    const cAddr = h("textarea", { id: "ivAddr", rows: "3", placeholder: "Street, city, country" }, inv.client_address);
    const fill = h("select", { class: "inv-fill", "aria-label": "Fill from a client" }, h("option", { value: "" }, "Fill from a client…"), clientList.map((c) => h("option", { value: c.id }, c.label)));
    fill.addEventListener("change", async () => {
      if (!fill.value) return;
      const { contact: c } = await api("contacts/" + fill.value);
      cName.value = c.name; cCompany.value = c.company || ""; cEmail.value = c.email || ""; cPhone.value = c.phone || "";
      contactId = c.id; fill.value = ""; queueSave();
    });
    let contactId = inv.contact_id || "";

    /* invoice details */
    const number = inp("ivNumber", inv.number);
    const issue = h("input", { type: "date", id: "ivIssue", value: inv.issue_date || "" });
    const due = h("input", { type: "date", id: "ivDue", value: inv.due_date || "" });
    const proj = h("select", { id: "ivProject" }, h("option", { value: "" }, "No project"), projList.rows.map((p) => h("option", { value: p.id }, p.title)));
    proj.value = inv.project_id || "";

    /* line items */
    const rows = h("div", { class: "items" });
    const lineTotal = (q, u) => Math.round((Number(String(q).replace(",", ".")) || 0) * Math.round((Number(String(u).replace(/[^\d.]/g, "")) || 0) * 100));
    const addRow = (it = { description: "", qty: 1, unit_cents: 0 }) => {
      const desc = h("textarea", { rows: "1", placeholder: "What you did, e.g. Production — 4 songs", "aria-label": "Description" }, it.description);
      const qty = h("input", { type: "text", inputmode: "decimal", value: String(it.qty ?? 1), "aria-label": "Quantity" });
      const unit = h("input", { type: "text", inputmode: "decimal", value: centsToInput(it.unit_cents), placeholder: "0.00", "aria-label": "Rate" });
      const amt = h("span", { class: "item-amt" }, money(lineTotal(qty.value, unit.value)));
      const row = h("div", { class: "item" }, desc, qty, unit, amt,
        h("button", { class: "btn btn-sm btn-ghost", type: "button", "aria-label": "Remove line", onclick: () => { row.remove(); queueSave(); } }, "✕"));
      row._get = () => ({ description: desc.value, qty: qty.value, unit: unit.value });
      [qty, unit].forEach((el) => el.addEventListener("input", () => { amt.textContent = money(lineTotal(qty.value, unit.value)); }));
      desc.addEventListener("input", () => fitText(desc));
      rows.append(row);
      return desc;
    };
    inv.items.forEach((it) => addRow(it));
    if (!inv.items.length) addRow();

    /* totals */
    const discount = inp("ivDiscount", centsToInput(inv.discount_cents), { inputmode: "decimal", placeholder: "0" });
    const taxLabel = inp("ivTaxLabel", inv.tax_label || "Tax");
    const taxRate = inp("ivTaxRate", inv.tax_bp ? String(inv.tax_bp / 100) : "", { inputmode: "decimal", placeholder: "0" });
    const totalsBox = h("dl", { class: "money-sum inv-totals" });
    const drawTotals = (t) => totalsBox.replaceChildren(
      h("div", {}, h("dt", {}, "Subtotal"), h("dd", {}, money(t.subtotal))),
      h("div", {}, h("dt", {}, "Discount"), h("dd", {}, t.discount ? "– " + money(t.discount) : money(0))),
      h("div", {}, h("dt", {}, (taxLabel.value || "Tax") + (taxRate.value ? ` (${taxRate.value}%)` : "")), h("dd", {}, money(t.tax))),
      h("div", { class: "total" }, h("dt", {}, inv.status === "paid" ? "Total (paid)" : "Total due"), h("dd", {}, money(t.total))));
    drawTotals(inv.totals);

    const notes = h("textarea", { id: "ivNotes", rows: "4", placeholder: "Payment terms, thank-you note…" }, inv.notes);

    /* live PDF preview */
    // the fragment hides Chrome's viewer toolbar and fits the page to the frame's width
    const previewSrc = () => `/api/admin/invoices/${id}/pdf?inline=1&v=${Date.now()}#toolbar=0&navpanes=0&view=FitH`;
    const frame = h("iframe", { class: "pdf-frame", title: "Invoice preview", src: previewSrc() });
    const saveState = h("span", { class: "save-state", role: "status", "aria-live": "polite" }, "All changes saved");

    let timer = null, saving = false, pending = false;
    const payload = () => ({
      client_name: cName.value, client_company: cCompany.value, client_email: cEmail.value, client_phone: cPhone.value, client_address: cAddr.value,
      contact_id: contactId || "", number: number.value, issue_date: issue.value, due_date: due.value, project_id: proj.value,
      items: [...rows.children].map((r) => r._get()), discount: discount.value, tax_label: taxLabel.value, tax_rate: taxRate.value, notes: notes.value,
    });
    async function save() {
      if (saving) { pending = true; return; }
      saving = true;
      saveState.textContent = "Saving…";
      saveState.className = "save-state";
      try {
        const r = await api("invoices/" + id, { method: "PATCH", body: payload() });
        inv = r.invoice;
        drawTotals(inv.totals);
        saveState.textContent = "All changes saved";
        frame.src = previewSrc();
      } catch (x) { saveState.textContent = x.message; saveState.className = "save-state bad"; }
      saving = false;
      if (pending) { pending = false; save(); }
    }
    const queueSave = () => { clearTimeout(timer); saveState.textContent = "Editing…"; timer = setTimeout(save, 700); };
    const editor = h("div", { class: "stack inv-editor", oninput: queueSave, onchange: (e) => { if (e.target !== fill) queueSave(); } },
      h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "Billed to"), fill),
        h("div", { class: "form-row" }, f("ivName", "Name", cName), f("ivCompany", "Company", cCompany)),
        h("div", { class: "form-row" }, f("ivEmail", "Email", cEmail), f("ivPhone", "Phone", cPhone)),
        f("ivAddr", "Address", cAddr)),
      h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "Invoice")),
        h("div", { class: "form-row tight" }, f("ivNumber", "Number", number), f("ivIssue", "Issued", issue), f("ivDue", "Due", due)),
        f("ivProject", "Project", proj)),
      h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, "Items"), h("p", {}, "Description · qty · rate")),
        h("div", { class: "item item-head", "aria-hidden": "true" }, h("span", {}, "Description"), h("span", {}, "Qty"), h("span", {}, "Rate"), h("span", {}, "Amount"), h("span", {})),
        rows,
        h("div", { class: "actions section-gap" }, h("button", { class: "btn btn-sm", type: "button", onclick: () => { addRow().focus(); } }, "+ Add a line"),
          (ME.lists ? ME.lists.project_types : []).slice(0, 4).map((tp) => h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => { addRow({ description: tp, qty: 1, unit_cents: 0 }); queueSave(); } }, "+ " + tp))),
        h("div", { class: "form-row tight section-gap" }, f("ivDiscount", `Discount (${ME.currency})`, discount), f("ivTaxLabel", "Tax name", taxLabel), f("ivTaxRate", "Tax %", taxRate)),
        totalsBox),
      h("section", { class: "panel" }, h("div", { class: "panel-head" }, h("h2", {}, h("label", { for: "ivNotes" }, "Notes and terms"))), notes));

    const shareAndMail = async () => {
      if (!cEmail.value) { toast("Add the client's email first.", true); cEmail.focus(); return; }
      const r = await api(`invoices/${id}/share`, { method: "POST" });
      const body = `Hi ${(cName.value || "").split(" ")[0] || "there"},\n\nPlease find invoice ${number.value} for ${money(inv.totals.total)}${due.value ? `, due ${dayText(due.value)}` : ""}:\n${r.url}\n\nThank you,\nManuchie`;
      window.location.href = `mailto:${encodeURIComponent(cEmail.value)}?subject=${encodeURIComponent(`Invoice ${number.value} from Manuchie`)}&body=${encodeURIComponent(body)}`;
      if (inv.status === "draft") act("invoices/" + id, { status: "sent" }, "Marked as sent.", "PATCH");
    };
    const st = inv.display_status;
    render(
      h("a", { class: "back", href: "#/invoices" }, "← Invoices"),
      h("div", { class: "head" },
        h("div", {}, h("span", { class: "hero-k" }, "Invoice"), h("h1", {}, inv.number),
          h("p", {}, [inv.client_name || "No client yet", money(inv.totals.total)].join(" · "), " ", invPill(st))),
        h("div", { class: "actions" }, h("a", { class: "btn btn-primary", href: `/api/admin/invoices/${id}/pdf` }, "Download PDF"))),
      h("div", { class: "actions action-bar" },
        st === "draft" ? h("button", { class: "btn", type: "button", onclick: () => act("invoices/" + id, { status: "sent" }, "Marked as sent.", "PATCH") }, "Mark as sent") : null,
        st === "sent" || st === "overdue" ? h("button", { class: "btn btn-done", type: "button", onclick: () => act(`invoices/${id}/paid`, {}, "Paid — income logged in Money.") }, "Mark as paid") : null,
        st === "paid" ? h("button", { class: "btn", type: "button", onclick: () => act("invoices/" + id, { status: "sent" }, "Marked unpaid.", "PATCH") }, "Mark unpaid") : null,
        h("button", { class: "btn btn-terra", type: "button", onclick: shareAndMail }, "Email to client"),
        h("button", { class: "btn", type: "button", onclick: async () => {
          const r = await api(`invoices/${id}/share`, { method: "POST" });
          try { await navigator.clipboard.writeText(r.url); toast("Private link copied — anyone with it can open the PDF."); } catch { toast(r.url); }
        } }, "Copy link"),
        h("button", { class: "btn btn-ghost", type: "button", onclick: async () => { const r = await act(`invoices/${id}/duplicate`, {}, "Duplicated as a new draft."); if (r) location.hash = "#/invoices/" + r.id; } }, "Duplicate"),
        inv.share_token ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => act(`invoices/${id}/share`, undefined, "Link turned off.", "DELETE") }, "Turn off link") : null,
        st !== "void" && st !== "paid" ? h("button", { class: "btn btn-ghost", type: "button", onclick: () => act("invoices/" + id, { status: "void" }, "Invoice voided.", "PATCH") }, "Void") : null,
        h("button", { class: "btn btn-danger", type: "button", onclick: async () => {
          if (!(await confirmAction("Delete this invoice?", `${inv.number} will be removed${inv.status === "paid" ? ", and the payment it logged in Money will be undone" : ""}.`, "Delete invoice"))) return;
          try { await api("invoices/" + id, { method: "DELETE" }); toast("Invoice deleted."); location.hash = "#/invoices"; } catch (x) { toast(x.message, true); }
        } }, "Delete")),
      h("div", { class: "inv-layout section-gap" }, editor,
        h("aside", { class: "inv-preview" }, h("div", { class: "panel" },
          h("div", { class: "panel-head" }, h("h2", {}, "Preview"), saveState), frame,
          h("a", { class: "btn btn-sm inv-open", href: `/api/admin/invoices/${id}/pdf?inline=1`, target: "_blank", rel: "noopener" }, "Open the PDF full size ↗")))));
    rows.querySelectorAll("textarea").forEach(fitText);
  }

  /* ---------- Settings: business details and editable lists ---------- */
  async function businessPanel() {
    const { business: b } = await api("business");
    const f = (id, label, input, hint) => h("label", { class: "fld", for: id }, h("span", {}, label), input, hint ? h("small", { class: "muted" }, hint) : null);
    const i = (id, v, attrs = {}) => h("input", { type: "text", id, value: v ?? "", autocomplete: "off", ...attrs });
    const t = (id, v, rows, ph) => h("textarea", { id, rows: String(rows), placeholder: ph || "" }, v ?? "");
    const fields = {
      name: i("bName", b.name), tagline: i("bTag", b.tagline), legal_name: i("bLegal", b.legal_name, { placeholder: "e.g. Emmanuel Chiwanga" }),
      email: i("bEmail", b.email || (ME && ME.email) || "", { type: "email" }), phone: i("bPhone", b.phone, { type: "tel" }), website: i("bWeb", b.website),
      address: t("bAddr", b.address, 2), tax_label: i("bTaxL", b.tax_label, { placeholder: "e.g. VAT number" }), tax_number: i("bTaxN", b.tax_number),
      bank: t("bBank", b.bank, 4, "Bank, account name, account number, branch / SWIFT, or how to pay you"),
      terms: t("bTerms", b.terms, 3), prefix: i("bPrefix", b.prefix), due_days: i("bDue", String(b.due_days), { inputmode: "numeric" }),
      tax_rate: i("bTax", b.tax_bp ? String(b.tax_bp / 100) : "", { inputmode: "decimal", placeholder: "0" }),
    };
    const err = h("p", { class: "form-error", role: "alert" });
    return h("form", { class: "stack", onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = "";
      try { await api("business", { method: "POST", body: Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value])) }); toast("Invoice details saved."); }
      catch (x) { err.textContent = x.message; }
    } },
      h("div", { class: "form-row" }, f("bName", "Name on invoices", fields.name), f("bTag", "Line under your name", fields.tagline)),
      h("div", { class: "form-row" }, f("bLegal", "Legal or trading name (optional)", fields.legal_name), f("bWeb", "Website", fields.website)),
      h("div", { class: "form-row" }, f("bEmail", "Email", fields.email), f("bPhone", "Phone", fields.phone)),
      f("bAddr", "Address", fields.address),
      h("div", { class: "form-row" }, f("bTaxL", "Tax registration label", fields.tax_label), f("bTaxN", "Tax registration number", fields.tax_number)),
      f("bBank", "Payment details", fields.bank, "Printed on every invoice."),
      f("bTerms", "Default notes and terms", fields.terms),
      h("div", { class: "form-row tight top" }, f("bPrefix", "Invoice number prefix", fields.prefix, "e.g. MAN → MAN-2026-001"), f("bDue", "Payment due after (days)", fields.due_days), f("bTax", "Default tax %", fields.tax_rate)),
      err, h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "submit" }, "Save invoice details")));
  }

  function listsPanel() {
    const L = JSON.parse(JSON.stringify((ME && ME.lists) || {}));
    const chipEditor = (key, title, hint) => {
      const box = h("div", { class: "chip-edit" });
      const draw = () => box.replaceChildren(...L[key].map((v, i) => h("span", { class: "chip-e" },
        h("input", { type: "text", value: v, "aria-label": title + " " + (i + 1), size: String(Math.max(6, v.length)), oninput: (e) => { L[key][i] = e.target.value; } }),
        h("button", { type: "button", class: "btn btn-sm btn-ghost", "aria-label": "Remove " + v, onclick: () => { L[key].splice(i, 1); draw(); } }, "✕"))));
      const add = h("input", { type: "text", placeholder: "Add…", "aria-label": "Add to " + title });
      draw();
      return h("div", { class: "stack" }, h("div", { class: "panel-head" }, h("h3", { class: "h3" }, title), hint ? h("p", {}, hint) : null), box,
        h("form", { class: "task-add", onsubmit: (e) => { e.preventDefault(); if (add.value.trim()) { L[key].push(add.value.trim()); add.value = ""; draw(); } } }, add, h("button", { class: "btn btn-sm", type: "submit" }, "Add")));
    };
    const stages = Object.entries(L.stage_labels || {}).map(([k, v]) => {
      const el = h("input", { type: "text", id: "st-" + k, value: v, oninput: (e) => { L.stage_labels[k] = e.target.value; } });
      return h("label", { class: "fld", for: "st-" + k }, h("span", {}, { lead: "First contact", booked: "Confirmed", in_progress: "Working on it", review: "Nearly done", completed: "Done", on_hold: "Paused", cancelled: "Stopped" }[k]), el);
    });
    const err = h("p", { class: "form-error", role: "alert" });
    return h("div", { class: "stack" },
      chipEditor("project_types", "Project types", "Shown when you create a project"),
      chipEditor("expense_categories", "Expense categories"),
      chipEditor("income_categories", "Income categories"),
      h("div", { class: "stack" }, h("div", { class: "panel-head" }, h("h3", { class: "h3" }, "Stage names"), h("p", {}, "Rename the stages a project moves through")), h("div", { class: "form-grid" }, stages)),
      err,
      h("div", { class: "actions" }, h("button", { class: "btn btn-primary", type: "button", onclick: async () => {
        err.textContent = "";
        try { const r = await api("settings/lists", { method: "POST", body: L }); ME.lists = r.lists; toast("Lists saved."); }
        catch (x) { err.textContent = x.message; }
      } }, "Save lists")));
  }

  /* ---------- More (phones) ---------- */
  function more() {
    const row = (href, label, sub, attrs = {}) => h("a", { class: "more-row", href, ...attrs }, h("span", {}, h("b", {}, label), h("small", {}, sub)), h("span", { "aria-hidden": "true" }, "›"));
    render(
      head("More", null),
      h("nav", { class: "more", "aria-label": "More sections" },
        row("#/invoices", "Invoices", "Create, download and send branded PDF invoices"),
        row("#/contacts", "Clients", "Everyone you've worked with, with their email and phone"),
        row("#/analytics", "Analytics", "Visits, clicks and where people come from"),
        row("#/settings", "Settings", "Password, currency and email alerts"),
        row("https://manuchie.org/", "View website ↗", "manuchie.org", { target: "_blank", rel: "noopener" }),
        h("button", { class: "more-row", type: "button", onclick: logout }, h("span", {}, h("b", {}, "Log out"), h("small", {}, ME ? ME.email : "")), h("span", { "aria-hidden": "true" }, "›"))));
  }

  /* ---------- Settings ---------- */
  async function settings() {
    loading();
    const [d, bizForm] = await Promise.all([api("settings"), businessPanel()]);
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
      head("Settings", "Account, invoices, your lists and security"),
      h("div", { class: "grid two" },
        panel("Account", null, h("dl", { class: "meta" },
          h("dt", {}, "Signed in as"), h("dd", {}, d.admin.email),
          h("dt", {}, "Admin since"), h("dd", {}, dateOnly(d.admin.created_at)),
          h("dt", {}, "Last sign-in"), h("dd", {}, when(d.admin.last_login_at))),
          h("div", { class: "actions section-gap" },
            h("a", { class: "btn", href: "https://manuchie.org/", target: "_blank", rel: "noopener" }, "View website ", h("span", { "aria-hidden": "true" }, "↗"), h("span", { class: "vh" }, " (opens in a new tab)")),
            h("button", { class: "btn", type: "button", onclick: logout }, "Log out"))),
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
          h("ul", { class: "bars" }, d.sessions.map((x) => h("li", { class: x.current ? "alt" : "" },
            h("span", {}, (x.current ? "This device · " : "") + (x.user_agent || "Unknown device").replace(/^Mozilla\/5\.0 /, "").slice(0, 60)),
            h("b", {}, "active " + when(x.last_seen_at))))),
          d.sessions.length > 1 ? h("div", { class: "actions section-gap" }, h("button", { class: "btn", type: "button", onclick: async () => {
            try { await api("settings/sign-out-others", { method: "POST" }); toast("Other devices signed out."); settings().catch(failed); } catch (x) { toast(x.message, true); }
          } }, "Sign out other devices")) : null)),
      h("div", { class: "section-gap" }, panel("Invoice details", "Your name, contact and payment details as they appear on every invoice", bizForm)),
      h("div", { class: "section-gap" }, panel("Your lists", "Edit the options used across the dashboard", listsPanel())),
      h("div", { class: "section-gap" }, panel("Studio currency", "Fees, income and expenses are shown in this currency", (() => {
        const sel = h("select", { "aria-label": "Studio currency" }, Object.entries(CURRENCY_NAMES).map(([k, l]) => h("option", { value: k }, `${l} (${k})`)));
        sel.value = (ME && ME.currency) || "USD";
        sel.addEventListener("change", async () => {
          try { await api("settings/currency", { method: "POST", body: { currency: sel.value } }); ME.currency = sel.value; toast("Currency set to " + CURRENCY_NAMES[sel.value] + "."); }
          catch (x) { toast(x.message, true); }
        });
        return h("div", { class: "stack" }, sel, h("p", { class: "muted" }, "Changing it relabels amounts already logged; it doesn't convert them."));
      })())),
      h("div", { class: "section-gap" }, panel("Data", null, h("dl", { class: "meta" },
        h("dt", {}, "Enquiries"), h("dd", {}, num(d.counts.enquiries)),
        h("dt", {}, "Contacts"), h("dd", {}, num(d.counts.contacts)),
        h("dt", {}, "Analytics events"), h("dd", {}, num(d.counts.events) + (d.counts.first_event_day ? " since " + dayLabel(d.counts.first_event_day) : "")),
        h("dt", {}, "Retention"), h("dd", {}, d.retention)))),
    );
  }

  /* ---------- shell: unread badges, logout, router ---------- */
  function setUnread(n) {
    document.querySelectorAll("[data-unread]").forEach((b) => {
      b.hidden = !n;
      b.textContent = n > 99 ? "99+" : String(n);
      b.setAttribute("aria-label", n + " unread");
    });
  }
  const refreshUnread = () => api("enquiries?status=new&per=5").then((d) => setUnread(d.total)).catch(() => {});

  async function logout() {
    try { await api("logout", { method: "POST" }); } catch { /* signed out anyway */ }
    window.location.replace("/admin/login");
  }
  document.querySelectorAll("[data-logout]").forEach((b) => b.addEventListener("click", logout));

  const TITLES = { overview: "Overview", analytics: "Analytics", enquiries: "Enquiries", projects: "Projects", money: "Money", invoices: "Invoices", contacts: "Clients", settings: "Settings", more: "More" };
  async function route() {
    const raw = location.hash.replace(/^#\/?/, "") || "overview";
    const [pathPart, query = ""] = raw.split("?");
    const [name, id] = pathPart.split("/");
    const key = TITLES[name] ? name : "overview";
    const underMore = ["contacts", "analytics", "settings", "more", "invoices"].includes(key);
    document.querySelectorAll("a[data-route]").forEach((a) => (a.dataset.route === key || (a.dataset.route === "more" && underMore)
      ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    document.title = (TITLES[key] || "Studio") + " — Manuchie";
    try {
      if (key === "enquiries" && id) await enquiry(id);
      else if (key === "contacts" && id) await contact(id);
      else if (key === "analytics") await analytics();
      else if (key === "enquiries") await enquiries(new URLSearchParams(query));
      else if (key === "contacts") await contacts();
      else if (key === "settings") await settings();
      else if (key === "projects" && id === "new") await newProject(new URLSearchParams(query));
      else if (key === "projects" && id) await project(id);
      else if (key === "projects") await projects(new URLSearchParams(query));
      else if (key === "money") await moneyPage();
      else if (key === "invoices" && id) await invoice(id);
      else if (key === "invoices") await invoices(new URLSearchParams(query));
      else if (key === "more") more();
      else await overview();
      main.style.animation = "none"; void main.offsetWidth; main.style.animation = ""; // replay the page-enter fade
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
