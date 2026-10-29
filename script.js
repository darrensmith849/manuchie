/* ==========================================================================
   MANUCHIE — interactions, enquiry form and first-party analytics
   --------------------------------------------------------------------------
   Loaded with `defer` (config.js first). No dependencies.
   CONFIG — the real value lives in config.js (git-ignored, deployed):
     bookingEmail : address behind the "Email — Direct to the inbox" link.
   The enquiry form posts to /api/enquiry; page analytics go to /api/collect
   (see docs/IMPLEMENTATION_PLAN.md for both contracts).
   ========================================================================== */
(function () {
  "use strict";
  var CONFIG = Object.assign({ bookingEmail: "bookings@manuchie.com" }, window.MANUCHIE_CONFIG);
  var d = document, w = window, root = d.documentElement;
  var $ = function (s, c) { return (c || d).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };
  var reduceMotion = w.matchMedia("(prefers-reduced-motion: reduce)");
  var hasIO = "IntersectionObserver" in w;
  var onMedia = function (mq, fn) { if (mq.addEventListener) mq.addEventListener("change", fn); else if (mq.addListener) mq.addListener(fn); };
  var session = {
    get: function (k) { try { return w.sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { w.sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };

  /* ---------- attribution: UTM + landing referrer, kept for the tab session ---------- */
  var landing = (function () {
    var saved = null;
    try { saved = JSON.parse(session.get("m_landing") || "null"); } catch (e) { saved = null; }
    if (saved && typeof saved === "object") return saved;
    var q = new URLSearchParams(location.search);
    var a = {
      referrer: d.referrer || "",
      utm_source: q.get("utm_source") || "",
      utm_medium: q.get("utm_medium") || "",
      utm_campaign: q.get("utm_campaign") || ""
    };
    session.set("m_landing", JSON.stringify(a));
    return a;
  })();

  /* ---------- analytics (POST /api/collect): anonymous, cookie-free, never form content ---------- */
  var optedOut = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || w.doNotTrack === "1";
  var sid = "";
  if (!optedOut) {
    sid = session.get("m_sid") || "";
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(sid)) {
      var bytes = new Uint8Array(12);
      try { w.crypto.getRandomValues(bytes); } catch (e) { for (var b = 0; b < bytes.length; b++) bytes[b] = Math.floor(Math.random() * 256); }
      sid = Array.prototype.map.call(bytes, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      session.set("m_sid", sid);
    }
  }
  function track(type, name) {
    if (optedOut) return;
    var body = JSON.stringify({
      type: type, name: name || "", path: location.pathname, ref: landing.referrer,
      utm_source: landing.utm_source, utm_medium: landing.utm_medium, utm_campaign: landing.utm_campaign,
      sid: sid, w: w.innerWidth
    });
    try { if (navigator.sendBeacon && navigator.sendBeacon("/api/collect", body)) return; } catch (e) { /* fall through */ }
    try {
      fetch("/api/collect", { method: "POST", body: body, keepalive: true, credentials: "same-origin",
        headers: { "Content-Type": "text/plain;charset=UTF-8" } }).catch(function () {});
    } catch (e) { /* offline or blocked: analytics are best-effort */ }
  }
  // analytics wait until the page has rendered (never compete with the first screen)
  var later = function (fn) { if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 1); };
  later(function () {
    track("pageview");
    /* section views, once each */
    var sections = $$("[data-section]");
    if (hasIO && !optedOut && sections.length) {
      var seen = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          seen.unobserve(en.target);
          track("section_view", en.target.getAttribute("data-section"));
        });
      }, { rootMargin: "0px 0px -45% 0px" });
      sections.forEach(function (s) { seen.observe(s); });
    }
  });

  /* outbound clicks, by destination */
  var HOSTS = [["open.spotify.com", "spotify"], ["music.apple.com", "apple_music"], ["youtube.com", "youtube"],
    ["shazam.com", "shazam"], ["instagram.com", "instagram"]];
  function clickName(a) {
    var t = a.getAttribute("data-track");
    if (t) return t;
    if (/^mailto:/i.test(a.getAttribute("href") || "")) return "email";
    var host = "";
    try { host = new URL(a.href, location.href).hostname; } catch (e) { return ""; }
    for (var i = 0; i < HOSTS.length; i++) {
      var h = HOSTS[i][0];
      if (host === h || host.slice(-(h.length + 1)) === "." + h) return HOSTS[i][1];
    }
    return "";
  }
  function onLinkActivate(e) {
    if (e.type === "auxclick" && e.button !== 1) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var n = clickName(a);
    if (n) track("click", n);
  }
  if (!optedOut) {
    d.addEventListener("click", onLinkActivate, true);
    d.addEventListener("auxclick", onLinkActivate, true);
  }

  if (location.hash.length > 1) root.classList.add("cv-off"); // arriving at #contact etc.

  /* ---------- year ---------- */
  var y = $("#year");
  if (y) y.textContent = String(new Date().getFullYear());

  /* ---------- header: solid once the page scrolls ---------- */
  var nav = $("#nav");
  var solid = null;
  function onScroll() {
    var s = w.scrollY > 12;
    if (s !== solid && nav) { solid = s; nav.classList.toggle("solid", s); }
  }
  w.addEventListener("scroll", onScroll, { passive: true });
  if (w.requestAnimationFrame) w.requestAnimationFrame(function () { setTimeout(onScroll, 0); }); // restored scroll position

  /* ---------- mobile menu: focus moves in, stays in, and returns to the button ---------- */
  var burger = $("#burger");
  var drawer = $("#drawer");
  var outside = [$(".skip-link"), $("main"), $("footer")];
  function drawerOpen() { return drawer && !drawer.hidden; }
  function setDrawer(open, restoreFocus) {
    if (!burger || !drawer) return;
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    drawer.hidden = !open;
    root.classList.toggle("drawer-open", open);
    outside.forEach(function (el) { if (el) el.inert = open; });
    if (open) { var first = $("a", drawer); if (first) first.focus(); }
    else if (restoreFocus) burger.focus();
  }
  if (burger && drawer) {
    burger.addEventListener("click", function () { setDrawer(!drawerOpen(), true); });
    drawer.addEventListener("click", function (e) { if (e.target.closest("a")) setDrawer(false, false); });
    d.addEventListener("keydown", function (e) {
      if (!drawerOpen()) return;
      if (e.key === "Escape") { e.preventDefault(); setDrawer(false, true); return; }
      if (e.key !== "Tab") return;
      var items = [$(".nav-logo"), burger].concat($$("a", drawer)).filter(Boolean);
      var i = items.indexOf(d.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === items.length - 1)) { e.preventDefault(); items[0].focus(); }
    });
    onMedia(w.matchMedia("(min-width: 768px)"), function (m) { if (m.matches && drawerOpen()) setDrawer(false, false); });
  }

  /* ---------- in-page links: land below the header, move focus to the target ---------- */
  d.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute("href").slice(1);
    var t = id && d.getElementById(id);
    if (!t) return;
    e.preventDefault();
    if (drawerOpen()) setDrawer(false, false);
    root.classList.add("cv-off"); // lay out every section first, so the jump lands exactly
    t.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
    if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1");
    t.focus({ preventScroll: true });
    if (location.hash !== "#" + id) history.pushState(null, "", "#" + id);
    // if something above the target changed height mid-scroll (an embed loading), settle on it once
    if ("onscrollend" in w) {
      var cancel = function () {
        clearTimeout(expire);
        w.removeEventListener("scrollend", settle);
        ["wheel", "touchstart", "keydown"].forEach(function (ev) { w.removeEventListener(ev, cancel); });
      };
      var settle = function () {
        cancel();
        var gap = t.getBoundingClientRect().top - (nav ? nav.getBoundingClientRect().bottom : 0);
        if (Math.abs(gap) > 2) t.scrollIntoView({ behavior: "auto", block: "start" });
      };
      var expire = setTimeout(cancel, 3000);
      w.addEventListener("scrollend", settle);
      ["wheel", "touchstart", "keydown"].forEach(function (ev) { w.addEventListener(ev, cancel, { passive: true }); });
    }
  });

  /* ---------- reveal on scroll. Nothing is measured up front: the observer's first report
     (made after the first paint) says what is still below the fold, and only that is hidden,
     so nothing on screen ever flashes and the page is never laid out twice on load. ---------- */
  var reveals = $$(".reveal");
  if (hasIO && !reduceMotion.matches && reveals.length) {
    var first = new Set(reveals);
    var io = new IntersectionObserver(function (entries) {
      var batch = [];
      entries.forEach(function (en) {
        var el = en.target;
        if (first.delete(el)) {
          // first report: leave what is in view (or above it) alone, hide what is below
          var r = en.boundingClientRect;
          var skipped = !r.width && !r.height; // not laid out yet (content-visibility), so off screen
          if (en.isIntersecting || (!skipped && r.top < en.rootBounds.bottom)) { io.unobserve(el); return; }
          el.classList.add("is-pending");
          return;
        }
        if (en.isIntersecting) batch.push(el);
      });
      batch.forEach(function (el, i) {
        io.unobserve(el);
        el.style.setProperty("--d", String(Math.min(i, 5)));
        el.classList.add("is-revealing");
        el.classList.remove("is-pending");
        setTimeout(function () { el.classList.remove("is-revealing"); el.style.removeProperty("--d"); }, 1400);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---------- motion that pauses off screen (and can be paused by the visitor) ---------- */
  function whileVisible(el, cls) {
    if (!el || !hasIO) return;
    new IntersectionObserver(function (entries) {
      el.classList.toggle(cls, !entries[0].isIntersecting);
    }).observe(el);
  }

  /* hero waveform */
  var wave = $("#wave");
  if (wave) {
    var bars = d.createDocumentFragment();
    for (var i = 0; i < 60; i++) {
      var bar = d.createElement("span");
      bar.style.height = (15 + Math.random() * 85).toFixed(0) + "%";
      bar.style.animationDelay = (Math.random() * 2.6).toFixed(2) + "s";
      bar.style.animationDuration = (2 + Math.random() * 1.6).toFixed(2) + "s";
      bars.appendChild(bar);
    }
    wave.replaceChildren(bars);
    whileVisible(wave, "is-off");
  }

  /* collaborator ticker */
  var marquee = $("#marquee");
  var mToggle = $("#marqueeToggle");
  if (marquee) {
    whileVisible(marquee, "is-off");
    if (mToggle) {
      var syncToggle = function () { mToggle.hidden = reduceMotion.matches; };
      syncToggle();
      onMedia(reduceMotion, syncToggle);
      mToggle.addEventListener("click", function () {
        var paused = mToggle.getAttribute("aria-pressed") !== "true";
        mToggle.setAttribute("aria-pressed", String(paused));
        mToggle.setAttribute("aria-label", paused ? "Play the collaborators ticker" : "Pause the collaborators ticker");
        marquee.classList.toggle("is-paused", paused);
      });
    }
  }

  /* ---------- Spotify player — the iframe (kept in a <noscript> so it also works without
     JavaScript) is put in place when the section is about a screen away, so it never competes
     with the first screen or sets cookies for visitors who don't scroll that far. Some networks
     (office firewalls) block Spotify, which leaves a broken frame: the host is probed with a
     one-off image request and, if it can't be reached, an Apple Music player plus platform
     links take its place. ---------- */
  var player = $("#player");
  function probeSpotify() {
    // a tiny image request is enough to know whether Spotify is reachable — no Spotify code runs on this page
    var probe = new Image();
    probe.referrerPolicy = "no-referrer";
    probe.onerror = function () {
      var frame = $("iframe", player);
      if (frame) frame.remove();
      var slot = $(".pf-player", player);
      if (slot && !$("iframe", slot)) {
        var am = d.createElement("iframe");
        am.title = "Manuchie on Apple Music";
        am.src = slot.getAttribute("data-src");
        am.height = "175";
        am.loading = "lazy";
        am.allow = "autoplay *; encrypted-media *; fullscreen *; clipboard-write";
        am.setAttribute("sandbox", "allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation");
        slot.appendChild(am);
      }
      var fb = $(".player-fallback", player);
      if (fb) fb.hidden = false;
    };
    probe.src = "https://open.spotify.com/favicon.ico";
  }
  function loadPlayer() {
    var ns = $(".player-embed", player);
    if (ns && !$("iframe", player)) ns.insertAdjacentHTML("afterend", ns.textContent);
    probeSpotify();
  }
  if (player) {
    var soundSec = player.closest("section") || player;
    if (hasIO) {
      var pio = new IntersectionObserver(function (entries) {
        if (entries.some(function (en) { return en.isIntersecting; })) { pio.disconnect(); loadPlayer(); }
      }, { rootMargin: "1000px 0px" });
      pio.observe(soundSec);
    } else {
      loadPlayer();
    }
  }

  /* ---------- direct email link (assembled at runtime) ---------- */
  var de = $("#directEmail");
  if (de) {
    var addr = CONFIG.bookingEmail ||
      (de.getAttribute("data-user") || "bookings") + "@" + (de.getAttribute("data-domain") || "manuchie.com");
    de.href = "mailto:" + addr +
      "?subject=" + encodeURIComponent("Session enquiry") +
      "&body=" + encodeURIComponent("Hi Manuchie,\n\nI'd love to work on…\n\n");
  }

  /* ---------- enquiry form → POST /api/enquiry (JSON). Without JavaScript the same form
     posts normally and the Worker answers with its own confirmation page. ---------- */
  var form = $("#bookingForm");
  if (!form) return;
  var MSG = {
    ok: "Thank you — your enquiry has been sent. Manuchie will be in touch soon.",
    rate: "Too many attempts — please wait a minute and try again.",
    fail: "Sorry — your enquiry couldn't be sent. Please try again in a moment."
  };
  var statusEl = $("#formStatus");
  var submitBtn = $("#submitBtn");
  var names = ["name", "email", "message"];
  var fields = {};
  names.forEach(function (n) { fields[n] = form.elements[n]; });
  var startedAt = 0;        // per enquiry: reset after each send (spam timing)
  var formStartSent = false; // per page load: the form_start event is counted once
  var busy = false;

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "form-status" + (kind ? " " + kind : "");
  }
  function errEl(n) { return d.getElementById(fields[n].id + "-err"); }
  function clearError(n) {
    var f = fields[n], el = errEl(n);
    f.removeAttribute("aria-invalid");
    f.removeAttribute("aria-describedby");
    if (el) { el.textContent = ""; el.hidden = true; }
  }
  function showError(n, text) {
    var f = fields[n], el = errEl(n);
    f.setAttribute("aria-invalid", "true");
    if (el && text) { el.textContent = text; el.hidden = false; f.setAttribute("aria-describedby", el.id); }
  }
  function setBusy(on) {
    busy = on;
    submitBtn.disabled = on;
    if (on) { submitBtn.setAttribute("aria-busy", "true"); form.setAttribute("aria-busy", "true"); }
    else { submitBtn.removeAttribute("aria-busy"); form.removeAttribute("aria-busy"); }
  }

  form.noValidate = true; // validated in the submit handler, with the browser's own messages
  function onFirstTouch() {
    if (!startedAt) startedAt = Date.now();
    if (!formStartSent) { formStartSent = true; track("form_start"); }
  }
  form.addEventListener("focusin", onFirstTouch);
  form.addEventListener("input", function (e) {
    onFirstTouch();
    var n = e.target && e.target.name;
    if (fields[n] && fields[n].getAttribute("aria-invalid")) clearError(n);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    if (!startedAt) startedAt = Date.now();

    // whitespace-only answers count as empty; nothing else the visitor typed is changed
    names.forEach(function (n) { if (!fields[n].value.trim()) fields[n].value = ""; });
    var firstBad = null;
    names.forEach(function (n) {
      if (fields[n].checkValidity()) clearError(n);
      else { showError(n, ""); firstBad = firstBad || fields[n]; }
    });
    if (firstBad) { form.reportValidity(); return; }

    var payload = {
      name: fields.name.value.trim(),
      email: fields.email.value.trim(),
      message: fields.message.value.trim(),
      marketing_consent: Boolean(form.elements.marketing_consent && form.elements.marketing_consent.checked),
      botcheck: Boolean(form.elements.botcheck && form.elements.botcheck.checked),
      started_at: startedAt,
      source_page: location.pathname,
      referrer: landing.referrer,
      utm_source: landing.utm_source,
      utm_medium: landing.utm_medium,
      utm_campaign: landing.utm_campaign,
      sid: sid
    };

    setBusy(true);
    setStatus("");
    var ctrl = "AbortController" in w ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : 0;

    fetch(form.getAttribute("action") || "/api/enquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data || {} }; });
    }).then(function (r) {
      if (r.status >= 200 && r.status < 300 && r.data.ok) {
        form.reset();
        names.forEach(clearError);
        startedAt = 0;
        setStatus(MSG.ok, "ok");
        return;
      }
      if (r.status === 429 || r.data.error === "rate_limited") { setStatus(MSG.rate, "err"); return; }
      var bad = r.data.error === "validation" && r.data.fields ? r.data.fields : null;
      var shown = [];
      if (bad) {
        names.forEach(function (n) {
          if (typeof bad[n] === "string" && bad[n]) { showError(n, bad[n]); shown.push(fields[n]); }
          else clearError(n);
        });
      }
      if (shown.length) { setStatus(""); shown[0].focus(); }
      else setStatus(MSG.fail, "err");
    }).catch(function () {
      setStatus(MSG.fail, "err");
    }).then(function () {
      clearTimeout(timer);
      var lostFocus = d.activeElement === d.body || d.activeElement === submitBtn || !d.activeElement;
      setBusy(false);
      if (lostFocus) submitBtn.focus();
    });
  });
})();
