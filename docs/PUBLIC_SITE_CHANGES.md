# Public site — rebuild changes

Date: 29 Oct 2026. Scope: the public page only (`index.html`, `styles.css`, `script.js`,
`fonts.css`, `_headers`, `build.sh`, `robots.txt`, `sitemap.xml`, derived images in `assets/`,
`scripts/images.sh`, `docs/qa/public-*`). Nothing in `worker/`, `admin/`, `migrations/`,
`brand/`, `wrangler.jsonc`, `package.json`, `.gitignore` or `README.md` was touched. Nothing was
committed or deployed.

**Result in one line:** same words, photos, links, sections and look. The page now has one
grid, a working `/api/enquiry` form (it still works without JavaScript), a first-party analytics
client, AVIF/WebP images, a stricter CSP, and Lighthouse scores of 100 / 100 / 100 / 100 on
mobile and desktop (median of 5 runs).

---

## 1. Files

| File | Status | What changed |
|---|---|---|
| `index.html` | rewritten (same content) | new wrappers for the grid, `<picture>` with AVIF/WebP for every photo, a real form, consent checkbox, complete OG/Twitter metadata, `@graph` JSON-LD (Person + WebSite), deferred scripts, the Spotify iframe moved into a `<noscript>` (see §5), descriptive alt text |
| `styles.css` | rewritten | one rail and one two-column split for every section, one spacing scale, `clamp()` type, designed phone and tablet layouts, reduced-motion rules, focus styles, 44 px targets, `content-visibility` for sections below the first screen, unused rules removed |
| `script.js` | rewritten | enquiry form → `/api/enquiry` (JSON), analytics → `/api/collect`, drawer focus handling, marquee pause, layout-free reveal, deferred Spotify player, event delegation (one listener per event type) |
| `fonts.css` | compacted | the same files and subsets; 41 `@font-face` blocks → 13 (Inter is a variable font, so one block per subset with `font-weight: 300 700`); 3 metric-matched fallback faces added (Georgia/Arial scaled to Newsreader/Inter) |
| `_headers` | updated | CSP (`form-action 'self'`, no `mailto:`, no third-party scripts), HSTS, COOP, `X-Frame-Options: DENY`, Permissions-Policy; caching rules |
| `build.sh` | updated | mailto rewriting removed; esbuild minify (pinned `esbuild@0.28.2`, falls back to plain copy); fonts.css folded into styles.css for the page; AVIF/WebP copied; `admin/` copied to `dist/admin/` (the plan says build.sh does this); fails on any missing referenced file |
| `robots.txt` | updated | `Disallow: /admin` and `Disallow: /api/` |
| `sitemap.xml` | unchanged from the working tree (`manuchie.org`, lastmod 2026-10-29) |
| `scripts/images.sh` | new | regenerates the AVIF/WebP copies from the originals (never modifies them) |
| `assets/*.avif`, `assets/*.webp` | new, 51 files | see §4 |
| `docs/qa/public-*` | new | screenshots, Lighthouse reports and the JSON evidence below |

## 2. Design pass, section by section

**System.** Every section uses the existing tokens: content rail `--wrap` (1320 px) with side
gutter `--gutter`, one two-column split (`1fr | --col-gap | 1fr`, so the right-hand column
starts on the same line in the hero, story, mantra, sound, studio, worldwide block and contact),
section padding `--sec-y`, and the rhythm tokens `--s-label` (label → heading), `--s-head`
(heading → copy), `--s-p`, `--s-cta`, `--s-block`. Body copy is capped at `--measure` (38 rem).
Breakpoints: 640 px (large phone), 768 px (tablet), 1024 px (desktop), 1280 px (wide). Sizes use
`clamp()`; the hero additionally scales with viewport height so it fits a laptop screen.

- **Header/nav** — fixed, height token `--nav-h` (64/72 px) used for anchor offsets too. Full
  links from 768 px (they fit), burger below. All links and the burger are ≥ 44 px.
  Drawer: focus moves in, Tab cycles inside, Escape closes and returns focus, the page behind
  is `inert`, closes itself if the window grows past 768 px.
- **Hero** — desktop ≥ 1280: introduction and portrait side by side on the shared split, the
  portrait filling its column at its natural shape (never taller than the screen), centred
  against the text. 1024–1279: the buttons and waveform move to a full-width row under both
  columns, so text and portrait are level. Tablet: name and tagline beside the portrait, the
  introduction below at reading width. Phone: text, buttons, waveform, then the portrait (the
  original order; putting the portrait first made it the LCP element and cost ~2 s of
  simulated LCP). Buttons no longer wrap their labels; the eyebrow wraps balanced.
- **Collaborator marquee** — semantic list; edge fades; a small icon-only pause/play button
  (WCAG 2.2.2; label is `aria-label` only, so no new visible text); pauses itself off screen;
  with reduced motion it stops and shows every name, wrapped and centred.
- **Story** — photo left (sticky, never taller than the screen), copy right; 5/7 split on
  tablets so the copy keeps a readable line length; stacked on phones.
- **Mantra** — full-bleed halves on desktop with the text on the page's right-column line; on
  phones/tablets the photo sits on top and the text is on a vertical warm band (the old 92°
  gradient put cream text on bright terracotta on phones: about 2.9 : 1 contrast).
- **Sound + Spotify** — split head (copy aligned to the heading, not the label), player and
  featured card a matched pair from 768 px, records rows on the grid, platform links with
  44 px targets.
- **Studio services** — 3 / 2 / 1 columns; on phones the cards become compact rows (number
  beside the title), roughly halving their height.
- **Worldwide block** — same split as the head above it.
- **Gallery** — the four photos in one row from 640 px, a 2 × 2 grid on phones (the old
  sideways scroller hid three photos and was not keyboard-scrollable).
- **Contact** — two columns from 1024 px, stacked below; email/Instagram cards are equal
  widths; the form is a single card with labelled fields.
- **Footer** — same three rows; links are 44 px targets and form a tidy grid on phones.

The logo (the text wordmark) and the favicon were unchanged by this pass. *Later, after the client approved the Hallmark identity:* the header now shows the Hallmark lockup (`assets/logo-lockup.svg`, alt "Manuchie"), the footer the Hallmark wordmark (`assets/logo-wordmark.svg`), and the old inline gold-M favicon is replaced by the Hallmark favicon set and web-app manifest copied from `brand/package/` by `build.sh`.

## 3. Enquiry form

```html
<form id="bookingForm" action="/api/enquiry" method="post">   <!-- no enctype, no mailto -->
```

Fields (unchanged labels, placeholders and button): `name` (text, required, maxlength 120),
`email` (email, required, maxlength 254), `message` (textarea, required, maxlength 5000), plus

- `marketing_consent` — optional, **unticked**, label exactly
  `Keep me posted about new music and projects from Manuchie. Optional — you can unsubscribe at any time.`
  (checked character-for-character against `CONSENT_WORDING` in `worker/src/enquiry.js`: identical);
- `botcheck` — honeypot checkbox, off-screen, `tabindex="-1"`, inside an `aria-hidden` wrapper;
- `source_page` — hidden, value `/` (only matters for the no-JavaScript post).

**With JavaScript:** `fetch('/api/enquiry', {method:'POST', headers:{'Content-Type':'application/json'}})`
with `name, email, message` (trimmed), `marketing_consent` and `botcheck` as booleans,
`started_at` (`Date.now()` at the first focus/input inside the form), `source_page`
(`location.pathname`), `referrer`, `utm_source`, `utm_medium`, `utm_campaign` (captured on the
first page load of the tab into `sessionStorage` key `m_landing`) and `sid` (the analytics id;
empty string when the visitor sends GPC/DNT). Never opens an email app.

| State | Behaviour |
|---|---|
| busy | button `disabled` + `aria-busy="true"` (also on the form), small spinner |
| `200 {ok:true}` | status `Thank you — your enquiry has been sent. Manuchie will be in touch soon.`, form cleared |
| `400 {error:"validation", fields}` | each string in `fields.name/email/message` shown under its field (`aria-invalid="true"`, `aria-describedby` → the message), focus on the first one; if `fields` is empty → generic failure |
| `429` | `Too many attempts — please wait a minute and try again.` |
| 403, 5xx, non-JSON, network error, 20 s timeout | `Sorry — your enquiry couldn't be sent. Please try again in a moment.` |

On every failure everything typed stays. Status is a `role="status"` live region. Empty or
whitespace-only fields are stopped in the browser with its native messages before anything is
sent. **Without JavaScript** the browser validates the required fields and posts
`application/x-www-form-urlencoded` with the same names (checkbox → `marketing_consent=on`;
unchecked boxes are absent), expecting the Worker's HTML confirmation page.

`build.sh` no longer touches the form. `config.js` is still copied; it only feeds the
"Email — Direct to the inbox" link, which is still a `mailto:` link built at runtime exactly as
before.

## 4. Performance

**Images.** `scripts/images.sh` resizes each original with `sips` (no crop, no upscaling; the
largest copy is the original's own width), then encodes WebP (`cwebp -q 80 -m 6 -sharp_yuv
-metadata icc`) and AVIF (`avifenc -q 62 -s 4 -y 420`), keeping each file's colour profile
(sRGB or Display P3). Existing images were not modified or deleted.

| Photo | AVIF/WebP widths | JPEG fallback srcset (existing files) |
|---|---|---|
| portrait-terracotta (hero) | 400, 536 | 536 |
| studio (story) | 480, 640, 960, 1119 | 640, 960, 1119 |
| studio-mantra | 640, 960, 1252 | 640, 960, 1252 |
| worship-rays (featured) | 640, 960, 1280, 1600 | 640, 960, 1280, 1600 |
| window, recline, portrait-cap, tux-gallery | 480, 720, 1119/1120 | 480, 720, 1119/1120 |
| alltheglory-dove (footer) | lossless WebP | PNG |

Verification (`docs/qa/public-image-check.json`): every copy decoded in Chromium and compared
with its source at the same size — aspect ratio identical for all 51, mean colour within
0.1–1.1 / 255 per channel, PSNR 36–45 dB (full-size copies 41–45 dB). Example: the hero is
60 KB as JPEG, 15 KB as AVIF; the 960 px story photo 198 KB → 50 KB.

Every `<img>` has intrinsic `width`/`height`; `sizes` match the layout at each breakpoint;
everything below the first screen is `loading="lazy" decoding="async"`; the hero has
`fetchpriority="high"` and a preload (`media="(min-width: 640px)"`, where it is above the fold).

**Fonts.** Same families, files and `font-display: swap`. Preloads cut from three files to two
(Newsreader roman + Inter, Latin); the italic loads on demand. Metric-matched fallbacks keep
line breaks stable while fonts load (measured: hero identical, story column within 35 px versus
94 px before).

**CSS/JS.** Minified by esbuild in `build.sh` (styles 7.8 KB, script 4.5 KB, HTML 8.6 KB
gzipped). One render-blocking stylesheet in `dist/` (`fonts.css` folded in; `dist/fonts.css`
also kept for the Worker's confirmation page). Both scripts `defer`. No forced layout on load
(the reveal reads nothing up front; layouts on load went from 51 to 9). Analytics wait for
idle time. Sections below the first screen use `content-visibility: auto`; in-page jumps switch
it off first so anchors land exactly.

**Spotify.** The iframe sits in a `<noscript>` (so it works without JavaScript) and is put in
place when the sound section is ~1000 px away. Lighthouse no longer sees Spotify's third-party
cookies (Best Practices was 77 on desktop when the iframe loaded with the page). The
reachability probe is now a one-off image request to `open.spotify.com/favicon.ico` instead of
running Spotify's iframe-API script on the page; that script tried to load a second script from
`embed-cdn.spotifycdn.com`, which the CSP blocked (a console error the old site also had). The
Apple Music fallback is unchanged.

**Caching** (`_headers`): HTML, `/` revalidate; CSS/JS/images a year, immutable (content-hashed
`?v=` URLs from `build.sh`, fonts have hashed names); `/fonts.css` a day (the Worker's
confirmation page links it without a hash); robots/sitemap an hour. `og:image` stays the
absolute JPEG URL and is not hashed.

## 5. SEO

Canonical `https://manuchie.org/`; title and description unchanged; `robots`
`index, follow, max-image-preview:large`; Open Graph type/url/site_name/locale (`en_GB`)/
title/description/image (+ `secure_url`, `type`, `width` 536, `height` 640, `alt`); Twitter
card/title/description/image/image:alt; JSON-LD `@graph` with the existing Person node (`@id`
added) and a WebSite node. Headings: one `h1`; `h2` per section; `h3` for cards and the
worldwide block. Sitemap unchanged; robots disallows `/admin` and `/api/`.

## 6. Accessibility

Skip link now targets `main` (it used to skip the hero), visible focus on every stop, labelled
fields with programmatic errors and a live status, descriptive alt text on every photo (below),
reduced motion (marquee, waveform, reveals, smooth scrolling, hover lifts), drawer focus
handling, 44 px targets (checked at every width), contrast fix in the phone mantra band, the
gallery no longer a keyboard-inaccessible scroller, collaborators as a named list, decorative
glyphs hidden from screen readers.

Alt text (not page wording, but listed for review): hero "Manuchie in black sunglasses and a
silver chain, chin resting on his hand, against a terracotta-orange wall"; story "Manuchie in
headphones working at a laptop at his studio desk, beside a studio monitor speaker"; mantra
"Manuchie in sunglasses and a black top in his studio, beneath a sign that reads Better Music
Bigger Purpose"; featured "Still from the Been So Good film: Manuchie with The Unveiled in a
hall crossed by shafts of light, beneath the title Been So Good"; gallery "…in a white cap,
sunglasses and a white T-shirt, standing beside a wooden window", "…dressed in white, reclining
on a sofa in dappled sunlight", "Portrait of Manuchie in a white cap and sunglasses, glancing
to one side", "…in a white tuxedo jacket and black bow tie, in a dark room hung with a leopard
painting". The footer mark stays `alt=""` (the link text names it).

## 7. Security headers (`/*`)

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data: https://open.spotify.com; font-src 'self'; connect-src 'self';
  frame-src https://open.spotify.com https://embed.music.apple.com; form-action 'self';
  base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(),
  microphone=(), payment=(), usb=(), browsing-topics=()
```

`script-src` no longer needs `https://open.spotify.com` (see §4). Autoplay, encrypted-media,
fullscreen and picture-in-picture are deliberately left unrestricted so the embeds can still be
granted them through their `allow` attribute.

## 8. Testing

All runs used headless Playwright Chromium 156 (cached `chromium-1248`, its own temporary
profile) and Lighthouse 13.6.0 with `CHROME_PATH` pointing at the same Chromium, installed in a
temp folder outside the repo. `dist/` was served on 127.0.0.1 by a small `http.server`
subclass that also applies the `_headers` rules, gzips text like the CDN and answers
`POST /api/collect` with 204 (plain `python3 -m http.server` returns 501 for POSTs, which shows
up as console errors). `/api/enquiry` was mocked with `page.route` in every form test.

| Check | 390 | 768 | 1024 | 1440 |
|---|---|---|---|---|
| horizontal overflow (scrollWidth = viewport) | none | none | none | none |
| elements outside the viewport / clipped text | none | none | none | none |
| anchors #story #sound #studio #contact land exactly under the header (target top = header bottom) | 64 = 64 (via drawer) | 72 = 72 | 72 = 72 | 72 = 72 |
| focus moves to the target section | yes | yes | yes | yes |
| tab stops, all with a visible focus style | 28 | 31 | 31 | 31 |
| touch targets under 44 px | 0 | 0 | 0 | 0 |
| CLS on load / after scrolling the page | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| console errors from our code | 0 | 0 | 0 | 0 |

Also passed: reduced motion (marquee and waveform stopped, every collaborator visible, no hidden
reveals, `scroll-behavior: auto`, pause button hidden); pause button pauses; drawer (focus in,
Tab cycle, Escape → back to the burger, page inert); every form state in §3 (busy, success +
reset, per-field errors + focus, 429, 403, 500, non-JSON, network failure, empty submit not
sent); no navigation or popup on submit; no form content in any analytics payload; no-JS post
(`source_page=%2F&name=No+Script&email=ns%40example.com&message=Hello&marketing_consent=on`);
nothing hidden without JavaScript.

Analytics, one page load scrolled to the end with nine CTA/outbound clicks and a form focus:
`pageview`, `section_view` × 7 (hero, story, mantra, sound, studio, gallery, contact — once
each), `click`: spotify, apple_music, youtube, shazam, instagram, email, book_session × 3,
`form_start` once; payload carries `sid`, `path`, `ref`, UTM and `w`. With GPC or DNT: nothing sent.

Live embed (real network, CSP applied): the Spotify player loads and plays, no fallback, **zero
console messages** from the page or third parties at 390 and 1440. With Spotify blocked, the
Apple Music fallback appears; Apple's musickit logs one warning ("robustness level") — theirs.

**Lighthouse** (local build, median of 5 runs each; `docs/qa/public-lighthouse-summary.json`
has every run, the HTML reports are the median runs):

| | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| Mobile | 100 (97–100) | 100 | 100 | 100 | 1.0 s | 1.0 s | 70 ms | 0 |
| Desktop | 100 (all 5) | 100 | 100 | 100 | 0.3 s | 0.6 s | 0 ms | 0 |

The machine was heavily loaded during development (load average up to ~67 on 8 cores from
other projects); mobile Performance in that period ranged 82–99 for the same build, almost
entirely TBT noise. The final batch ran at load ~8.

Screenshots (refreshed after the logo change, now JPEG to keep the repo small): `docs/qa/public-390.jpg`, `-768.jpg`, `-1024.jpg`, `-1440.jpg` (full page, every
section rendered and every image loaded). Chromium does not paint the cross-origin Spotify
iframe into full-page captures, so its box looks empty there; `public-player-390.png` and
`public-player-1440.png` show the live player.

## 9. Content lock — verification

Method (`docs/qa/public-content-lock.json`): the page before this work (the working tree as
handed over, which differs from `HEAD` only in the deliberate `manuchie.pages.dev` →
`manuchie.org` URLs in `<head>`/JSON-LD — checked with `diff`) and the new page were both built
and rendered in the same headless Chromium at 390 and 1440 px, with every section rendered. For
each, the script collected (a) every text node in document order, hidden ones included
(drawer, Spotify fallback, marquee copy), (b) the rendered `innerText`, (c) every `<img>` in
document order, reduced to its base photo name, (d) every external and `mailto:` link `href`
(after the script builds the Email link), (e) headings, (f) CTA labels, (g) form labels and
placeholders. Text was compared with a word-level LCS diff.

Result, at both widths:
- text (all nodes and rendered): **one difference — the added consent label**; nothing removed,
  changed or reordered;
- images: identical order — portrait-terracotta, studio, studio-mantra, worship-rays, window,
  recline, portrait-cap, tux-gallery, alltheglory-dove (only the formats served changed);
- external links: **identical, 20 of 20, same order** (Spotify, Apple Music, YouTube, Shazam,
  Instagram, the email `mailto:` and the All The Glory credit); the Spotify embed URL and the
  Apple Music fallback URL are unchanged;
- headings, CTA labels, field labels and placeholders: identical;
- sections: same order (hero, marquee, story, mantra, sound, studio, gallery, contact, footer).

## 10. Open issues and notes

- `README.md` (not mine) still says build.sh writes the booking email into the form — no
  longer true. The `Caddyfile` (Hetzner path) has none of the new `_headers` rules.
- HSTS has `includeSubDomains` (no `preload`). Drop it if any `*.manuchie.org` subdomain will
  ever be served over plain HTTP.
- The share image is the 536 × 640 portrait (kept as instructed). Facebook/LinkedIn prefer
  1200 × 630; a dedicated share image would be new imagery and needs approval.
- The hero portrait source is only 536 px wide, so on desktop it is shown slightly upscaled
  (as it was before). A larger original of the same photo would sharpen it on retina screens.
- Under Playwright request interception, Chromium fails `favicon.ico` image requests, so the
  Spotify probe reports "blocked" in mocked tests (the fallback shows). Without interception it
  works; this is a test-harness artifact only.
- `docs/qa/public-*.png` are 5–9 MB each (the film grain defeats PNG compression).
- Not verified here: real devices and Safari/Firefox (Chromium only); the real Worker endpoints
  (mocked); production response headers (Cloudflare applies `_headers` — check once deployed).
