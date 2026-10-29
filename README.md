# Manuchie — Official Website

The website of **Manuchie** (Emmanuel Manuchie Chiwanga) — Zimbabwean producer,
songwriter, music director and keyboardist — live at **https://manuchie.org**.

- **Public site:** a fast single page in plain HTML, CSS and JavaScript (no framework).
  Dark, photography-led design. Sections: hero · collaborators · story · mantra · sound
  (Spotify player, featured project, records) · studio services · gallery · contact.
- **Enquiry system:** the contact form posts to the site's own API — no email app opens.
  Each enquiry is validated, rate-limited, spam-checked, stored, and emailed to Manuchie.
- **Private dashboard** at `/admin`: overview, first-party analytics, enquiries, contacts,
  marketing consent and settings, behind a secure sign-in.
- **Hosting:** one Cloudflare Worker (`manuchie`) with static assets and a D1 database, in
  Manuchie01@gmail.com's Cloudflare account.

Architecture and API contracts: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).
Setup, email, admin and deploy steps: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
Security and privacy: [`docs/SECURITY_PRIVACY.md`](docs/SECURITY_PRIVACY.md).

---

## 🚀 Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply manuchie --local
node scripts/create-admin.mjs --email you@example.com --local
./build.sh && npx wrangler dev --infer-origin-from-routes=false
# site: http://localhost:8787   dashboard: http://localhost:8787/admin/login
```

For a quick look at the page alone, `python3 -m http.server 8099` in this folder works
too (the form then has no backend to post to).

---

## ✅ Go live

1. `npx wrangler login` with Manuchie's Cloudflare account.
2. `npx wrangler d1 migrations apply manuchie --remote` (once).
3. Set up Resend and the three secrets `MAIL_TO`, `MAIL_FROM`, `RESEND_API_KEY`.
4. `./build.sh && npx wrangler deploy`
5. `node scripts/create-admin.mjs --email manuchie01@gmail.com`, then sign in at
   https://manuchie.org/admin/login.

Details for each step are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

`config.js` (git-ignored, deployed) now only holds the address behind the "Email — Direct
to the inbox" link:

```js
window.MANUCHIE_CONFIG = {
  bookingEmail: "manuchie01@gmail.com",
};
```

---

## 🖼️ The photos

Real photography ships in **`assets/`**, pulled from Manuchie's press shots and music
videos. `scripts/images.sh` makes the responsive and AVIF/WebP copies from the originals
(same crop and colour); `build.sh` copies only the files the page uses. The **Spotify
player** pulls Manuchie's real cover art automatically.

> These images were sourced from his public Spotify/YouTube artwork for his own site. If
> you have higher-resolution originals (or want different shots featured), send them over
> and they'll slot straight in.

---

## 🌍 Deploy

```bash
./build.sh && npx wrangler deploy
```

Always deploy through `build.sh`: it builds `dist/` (minified CSS/JS, content-hashed
asset URLs so `_headers` can cache them for a year, the dashboard copied to
`dist/admin/`). `wrangler.jsonc` keeps `manuchie.org` and `www.manuchie.org` attached and
sends `/api/*` and `/admin/*` through the Worker.

> The `Caddyfile` (Hetzner VPS) can still serve the static page, but the enquiry form,
> analytics and dashboard need the Cloudflare Worker.

---

## 📁 Files

```
index.html        page markup & content
styles.css        public-site design system
fonts.css         self-hosted Newsreader + Inter
script.js         nav, menu, enquiry form, analytics beacon, Spotify fallback
config.js         address behind the Email link (git-ignored, deployed)
_headers          caching + security headers for the static site
build.sh          builds dist/
assets/           photography (originals + responsive AVIF/WebP/JPEG copies), fonts
worker/src/       Cloudflare Worker: enquiry API, analytics, auth, dashboard API, email
worker/test/      unit tests, end-to-end test, dashboard visual/accessibility QA
admin/            private dashboard (served only after sign-in)
migrations/       D1 database schema
scripts/          create-admin.mjs (first admin / password reset), images.sh
brand/            logo and identity proposals (not live until approved)
docs/             plan, deployment, security & privacy, test reports, QA screenshots
wrangler.jsonc    Worker, domains and database configuration
.dev.vars.example template for local secrets
Caddyfile         static-only hosting on a VPS (optional)
```

---

## 🔗 Manuchie online

- Instagram — https://www.instagram.com/manuchie1/
- Spotify — https://open.spotify.com/artist/0ipSaL44aiNFpQzx5O3vLM
- Apple Music — https://music.apple.com/us/artist/manuchie/1708095589
- YouTube — https://www.youtube.com/channel/UCkNNnWe8Or5WWjzsIohnlZQ
- Shazam — https://www.shazam.com/artist/manuchie/1662208702

*Biography and credits compiled from public profiles across Spotify, Apple Music, Shazam
and press. Please review the copy in `index.html` and adjust any detail you'd like worded
differently.*
