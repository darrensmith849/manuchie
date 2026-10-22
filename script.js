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
  on(burger, "click", () => setDrawer(drawer.hidden));
  $$("#drawer a").forEach((a) => on(a, "click", () => setDrawer(false)));
  on(document, "keydown", (e) => { if (e.key === "Escape") setDrawer(false); });

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
    let bars = "";
    for (let i = 0; i < N; i++) {
      const h = (15 + Math.random() * 85).toFixed(0);
      const delay = (Math.random() * 2.6).toFixed(2);
      const dur = (2 + Math.random() * 1.6).toFixed(2);
      bars += `<span style="height:${h}%;animation-delay:${delay}s;animation-duration:${dur}s"></span>`;
    }
    wave.innerHTML = bars;
  }

  /* Spotify player — some networks (office firewalls) block Spotify, which
     leaves a broken frame. Probe the host with Spotify's own embed script and,
     if it can't be reached, swap in an Apple Music player plus platform links. */
  const player = $("#player");
  if (player) {
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

  /* booking form */
  const form = $("#bookingForm");
  const statusEl = $("#formStatus");
  const btn = $("#submitBtn");
  const setStatus = (m, k) => { if (statusEl) { statusEl.textContent = m; statusEl.className = "form-status" + (k ? " " + k : ""); } };

  const mailtoFallback = (d) => {
    const body = `Name: ${d.name}\nEmail: ${d.email}\n\n${d.message}\n`;
    window.location.href = "mailto:" + CONFIG.bookingEmail +
      "?subject=" + encodeURIComponent("Session enquiry via manuchie") +
      "&body=" + encodeURIComponent(body);
    setStatus("Opening your email app… thanks!", "ok");
  };

  on(form, "submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (form.botcheck && form.botcheck.checked) return;

    const d = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      message: form.message.value.trim(),
    };

    const keySet = CONFIG.web3formsKey && !CONFIG.web3formsKey.startsWith("PASTE_");
    if (!keySet) { mailtoFallback(d); return; }

    btn.disabled = true;
    const label = $(".btn-label", btn);
    if (label) label.textContent = "Sending…";
    setStatus("");

    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: CONFIG.web3formsKey,
          subject: "New session enquiry via manuchie",
          from_name: "Manuchie Website",
          ...d,
        }),
      });
      const out = await res.json();
      if (out.success) { form.reset(); setStatus("Got it — I'll be in touch soon. Thank you.", "ok"); }
      else setStatus("Something went wrong. Please email " + CONFIG.bookingEmail + ".", "err");
    } catch (_) {
      mailtoFallback(d);
    } finally {
      btn.disabled = false;
      if (label) label.textContent = "Send it over";
    }
  });

  /* smooth-scroll with sticky-header offset */
  $$('a[href^="#"]').forEach((a) => {
    on(a, "click", (e) => {
      const id = a.getAttribute("href");
      if (id.length < 2) return;
      const t = $(id);
      if (!t) return;
      e.preventDefault();
      const top = t.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top, behavior: "smooth" });
      history.pushState(null, "", id);
    });
  });
})();
