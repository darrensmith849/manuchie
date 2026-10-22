# Manuchie — Official Website

A fast, self-contained, single-page website for **Manuchie** (Emmanuel Chiwanga) —
Zimbabwean producer, songwriter, artist and Music Director. Built with plain HTML, CSS
and JavaScript (no build step, no dependencies) so it deploys anywhere and is easy to
edit.

A warm, photography-led editorial design (bone paper · espresso ink · terracotta) using
Manuchie's own press and video imagery. Sections: Cover · Lead statement · Story ·
Interstitial · Sound (live Spotify player + records index) · Company (collaborators) ·
Studio (services) · Contact · Colophon.

---

## 🚀 Quick preview

Just open `index.html` in a browser — or, for the embeds to behave exactly as in
production, run a tiny local server:

```bash
# from this folder
python3 -m http.server 8099
# then visit http://127.0.0.1:8099
```

---

## ✅ Go live: the 1 thing to configure

The booking form and the "Email" button don't send anything themselves: they open the
visitor's own email app with the enquiry written out, addressed to Manuchie. Set that
address in **`config.js`** — git-ignored, but copied into `dist/` and deployed with the
site. Create it if it's missing:

```js
window.MANUCHIE_CONFIG = {
  bookingEmail: "bookings@manuchie.com",   // ← Manuchie's real booking inbox
};
```

`build.sh` also writes this address into the form itself, so it works for visitors
without JavaScript too.

---

## 🖼️ The photos

Real photography ships in **`assets/`** — pulled from Manuchie's press shots and music
videos:

- `portrait-terracotta.jpg` — the cover portrait (also the social-share image)
- `harare-rooftop.jpg` — the Story spread

To swap either one, drop a replacement into `assets/` (keep the same filename, or update
the `src` in `index.html`). Landscape ~3:2 or portrait ~4:5 crops work best. The **Spotify
player** already pulls Manuchie's real cover art automatically — no upload needed.

> These images were sourced from his public Spotify/YouTube artwork for his own site. If
> you have higher-resolution originals (or want different shots featured), send them over
> and they'll slot straight in.

---

## 🌍 Deploy — Cloudflare + Hetzner

Because it's static (just files), deployment is simple. Two paths, pick either — or use
both (Cloudflare in front of Hetzner).

### Path A — Cloudflare Pages (simplest, global CDN, free HTTPS)

Build `dist/` (copies only what the page uses, puts the form key from `config.js` into
the form, and content-hashes CSS/JS/image URLs), then upload it with Wrangler:

```bash
./build.sh && npx wrangler pages deploy dist --project-name manuchie --branch main
```

Always deploy `dist/`, not the repo folder: `_headers` caches CSS, JS and images for a
year, which is only safe because `build.sh` gives every changed file a new `?v=` URL.
The included `_headers` file also sets the security headers (CSP etc.). Add the custom
domain under **Custom domains**.

### Path B — Hetzner VPS, with Cloudflare for DNS/CDN/SSL in front

On the Hetzner server (Caddy = auto‑HTTPS, gzip, one binary):

```bash
# 1. build, then copy the built site up (run from your machine)
./build.sh && rsync -avz --delete dist/ root@YOUR_HETZNER_IP:/var/www/manuchie/

# 2. install Caddy on the server, then use the included Caddyfile
sudo cp /var/www/manuchie/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

In **Cloudflare** → add the domain, create an **A record** for `manuchie.com` →
`YOUR_HETZNER_IP` (proxied / orange cloud), and set **SSL/TLS mode = Full (strict)**.
Edit the domain names at the top of the `Caddyfile` to match.

> Prefer nginx? Point its `root` at `/var/www/manuchie`, `index index.html;`, and use
> `try_files $uri $uri/ /index.html;`.

---

## 📁 Files

```
index.html   — page markup & content
styles.css   — design system (colour, type, layout, scroll-driven animation)
fonts.css    — self-hosted Fraunces + Inter (@font-face, same subsets as Google Fonts)
script.js    — nav, mobile menu, form handling, Spotify fallback
config.js    — booking email (git-ignored, deployed)
build.sh     — builds dist/ for deployment
assets/      — photography (originals + -480/-640/-720/-960/-1280 responsive copies)
assets/fonts — font files
Caddyfile    — Hetzner static-hosting config
_headers     — Cloudflare Pages caching + security headers
README.md    — this file
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
