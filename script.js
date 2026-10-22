/* ==========================================================================
   MANUCHIE — interactions
   --------------------------------------------------------------------------
   CONFIG — the real values live in config.js (git-ignored, deployed).
     bookingEmail : where enquiries (and the "Email" link) go.
     web3formsKey : free key from https://web3forms.com. Until it's set the
                    form falls back to opening the visitor's mail app — no
                    enquiry is lost.
   ========================================================================== */
const CONFIG = Object.assign({
  bookingEmail: "bookings@manuchie.com",
  web3formsKey: "",
}, window.MANUCHIE_CONFIG);

/* mark that JS is on so CSS can safely hide reveal elements */
document.documentElement.classList.add("js");

(function () {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const on = (el, ev, fn, o) => el && el.addEventListener(ev, fn, o);

  /* year */
  const y = $("#year");
  if (y) y.textContent = new Date().getFullYear();

  /* nav solid on scroll */
  const nav = $("#nav");
  const onScroll = () => nav && nav.classList.toggle("solid", window.scrollY > 12);
  onScroll();
  on(window, "scroll", onScroll, { passive: true });

  /* mobile drawer */
  const burger = $("#burger");
  const drawer = $("#drawer");
  const setDrawer = (open) => {
    if (!burger || !drawer) return;
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    drawer.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  };
  on(burger, "click", () => {
    const open = drawer.hidden;
    setDrawer(open);
    if (open) { const first = $("a", drawer); if (first) first.focus(); }
  });
  $$("#drawer a").forEach((a) => on(a, "click", () => setDrawer(false)));
  on(document, "keydown", (e) => {
    if (e.key !== "Escape" || !drawer || drawer.hidden) return;
    setDrawer(false);
    burger.focus();
  });

  /* reveal on scroll */
  const reveals = $$(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* build the hero audio waveform */
  const wave = $("#wave");
  if (wave) {
    const N = 60;
    const bars = document.createDocumentFragment();
    for (let i = 0; i < N; i++) {
      const bar = document.createElement("span");
      bar.style.height = (15 + Math.random() * 85).toFixed(0) + "%";
      bar.style.animationDelay = (Math.random() * 2.6).toFixed(2) + "s";
      bar.style.animationDuration = (2 + Math.random() * 1.6).toFixed(2) + "s";
      bars.appendChild(bar);
    }
    wave.replaceChildren(bars);
  }

  /* Spotify player — some networks (office firewalls) block Spotify, which
     leaves a broken frame. Probe the host with Spotify's own embed script and,
     if it can't be reached, swap in an Apple Music player plus platform links.
     The probe waits until the player is near the viewport (the iframe itself is
     lazy-loaded), so it never competes with the first screen. */
  const player = $("#player");
  const probeSpotify = () => {
    const probe = document.createElement("script");
    probe.async = true;
    probe.src = "https://open.spotify.com/embed/iframe-api/v1";
    probe.onerror = () => {
      const frame = $("iframe", player);
      if (frame) frame.remove();
      const slot = $(".pf-player", player);
      if (slot) {
        const am = document.createElement("iframe");
        am.title = "Manuchie on Apple Music";
        am.src = slot.dataset.src;
        am.height = "175";
        am.allow = "autoplay *; encrypted-media *; fullscreen *; clipboard-write";
        am.setAttribute("sandbox", "allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation");
        slot.appendChild(am);
      }
      $(".player-fallback", player).hidden = false;
    };
    document.head.appendChild(probe);
  };
  if (player) {
    if ("IntersectionObserver" in window) {
      const pio = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { pio.disconnect(); probeSpotify(); }
      }, { rootMargin: "1200px 0px" });
      pio.observe(player);
    } else {
      probeSpotify();
    }
  }

  /* direct email link (assembled at runtime) */
  const de = $("#directEmail");
  if (de) {
    const addr = CONFIG.bookingEmail ||
      `${de.dataset.user || "bookings"}@${de.dataset.domain || "manuchie.com"}`;
    de.href = "mailto:" + addr +
      "?subject=" + encodeURIComponent("Session enquiry") +
      "&body=" + encodeURIComponent("Hi Manuchie,\n\nI'd love to work on…\n\n");
  }

  /* booking form — POSTs to Web3Forms (the form's action). Without JS the
     browser validates the required fields and submits it itself; with JS it is
     validated here, sent with fetch, and the result shown in the status line. */
  const form = $("#bookingForm");
  const statusEl = $("#formStatus");
  const btn = $("#submitBtn");
  const label = btn && $(".btn-label", btn);
  const setStatus = (m, k) => { if (statusEl) { statusEl.textContent = m; statusEl.className = "form-status" + (k ? " " + k : ""); } };
  const keySet = Boolean(CONFIG.web3formsKey) && !CONFIG.web3formsKey.startsWith("PASTE_");
  const fields = form ? ["name", "email", "message"].map((n) => form.elements[n]) : [];
  let sending = false;

  if (form) {
    form.noValidate = true; // validated in the submit handler, using the browser's own messages
    const keyField = form.elements.access_key;
    if (keyField && keySet) keyField.defaultValue = keyField.value = CONFIG.web3formsKey;
    fields.forEach((f) => on(f, "input", () => f.removeAttribute("aria-invalid")));
  }

  const mailtoFallback = (d) => {
    const body = `Name: ${d.name}\nEmail: ${d.email}\n\n${d.message}\n`;
    window.location.href = "mailto:" + CONFIG.bookingEmail +
      "?subject=" + encodeURIComponent("Session enquiry via manuchie") +
      "&body=" + encodeURIComponent(body);
    setStatus("Opening your email app… thanks!", "ok");
  };

  on(form, "submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    if (form.elements.botcheck && form.elements.botcheck.checked) return;

    // whitespace-only answers count as empty
    fields.forEach((f) => { f.value = f.value.trim(); });
    fields.forEach((f) => (f.checkValidity() ? f.removeAttribute("aria-invalid") : f.setAttribute("aria-invalid", "true")));
    if (!form.reportValidity()) return;

    const d = { name: fields[0].value, email: fields[1].value, message: fields[2].value };
    if (!keySet) { mailtoFallback(d); return; }

    sending = true;
    btn.disabled = true;
    form.setAttribute("aria-busy", "true");
    if (label) label.textContent = "Sending…";
    setStatus("");

    try {
      const res = await fetch(form.action, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(form),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.success) { form.reset(); setStatus("Got it — I'll be in touch soon. Thank you.", "ok"); }
      else setStatus("Something went wrong. Please email " + CONFIG.bookingEmail + ".", "err");
    } catch (_) {
      mailtoFallback(d);
    } finally {
      sending = false;
      btn.disabled = false;
      form.removeAttribute("aria-busy");
      if (label) label.textContent = "Send it over";
    }
  });

  /* in-page links — scroll-margin-top (CSS) keeps targets clear of the fixed
     nav; focus moves to the target so the skip link and keyboard users land in
     the right place. Smooth only when reduced motion isn't requested. */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  $$('a[href^="#"]').forEach((a) => {
    on(a, "click", (e) => {
      const id = a.getAttribute("href");
      if (id.length < 2) return;
      const t = document.getElementById(id.slice(1));
      if (!t) return;
      e.preventDefault();
      t.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
      if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1");
      t.focus({ preventScroll: true });
      history.pushState(null, "", id);
    });
  });
})();
