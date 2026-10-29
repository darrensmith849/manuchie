# Manuchie identity — production package (concept 03, Hallmark)

**Status: approved by the client on 29 October 2026; it is now being wired into the site.** The
three original concepts are still in `brand/proposals/index.html` for reference, with Hallmark
marked as the chosen one.

## The idea

Hallmark is a **maker's seal**, the way a craftsman signs finished work.

- **Rim:** his full name, **EMMANUEL MANUCHIE CHIWANGA**, runs round the top. At the foot is
  **PLAY SKILFULLY**, the charge from Psalm 33:3 ("Sing unto him a new song; play skilfully…") that
  the site already uses as its creative philosophy. Two small diamonds separate the two lines.
- **Frieze:** inside the lettering runs the **chevron frieze** from the wall of the Great Enclosure
  at Great Zimbabwe, the country's masterwork of dry-stone building. It also reads as a continuous
  sound wave.
- **Centre:** the **M is laid like a course of stone**, a chevron set between two bands. At large
  sizes two dry-stone joints split it into three courses.

That coursed-stone M is also **the mark used on its own**. The seal's lettering needs room, so
wherever the seal would be smaller than about 144 px (30 mm) the M stands in for it: in the header
lockup, the favicon, app icons, small avatars and watermarks.

All files are outlined vector paths: no fonts, no `<text>` and no embedded images. They render the
same everywhere.

---

## Colours

| Name | Hex | In the Hallmark files | Contrast |
|---|---|---|---|
| Muted gold | `#c8a15a` | **On dark:** rings, lettering, diamonds, chevron frieze, the M mark, the wordmark and the lockup | 8.2 : 1 on near-black · 7.6 : 1 on charcoal |
| Warm off-white | `#f3f0ea` | **On dark:** the M at the centre of the seal only. Also the light ground | 17.4 : 1 on near-black |
| Near-black | `#0a0a0b` | **On light:** rings, lettering, the M and the wordmark. Also the main dark ground | 17.4 : 1 on off-white · 19.8 : 1 on white |
| Terracotta | `#b5481e` | **On light:** chevron frieze, diamonds and the M's two course bands. Also the social image's glow | 4.7 : 1 on off-white |
| Charcoal | `#141416` | Second dark ground (cards, surfaces) | — |
| Deep gold | `#8c6727` | Optional gold accent on light grounds in other materials; not used in the logo files | 4.5 : 1 on off-white |
| Black / white | `#000000` / `#ffffff` | Single-colour files: print, foil, embroidery, engraving, overlays | — |

The identity is **gold-led on dark**: near-black or charcoal ground, gold artwork, and off-white
only for the M inside the seal. **On light** it turns to near-black with terracotta accents.
Never set gold on a light ground (2.1 : 1).

For real gold foil or metallic ink, use the single-colour black file as the foil artwork.

## Typography

- **Seal lettering:** Newsreader capitals, weight 600, optical size 14, set on the circle and outlined.
- **Wordmark:** Newsreader capitals, weight 540, optical size 72, tracked +16 %, outlined.
- **Supporting text:** Newsreader for display lines, Inter for body text and labels (as on the site).
- Both fonts are SIL Open Font License, which permits outlining them into a logo. Never retype the
  logo or the seal lettering in a live font.

## Construction (measured from the files)

**Seal** (`symbol-*.svg`, a 100 × 100 grid, D = diameter):

- Outer ring: 1.1 % of D thick.
- Lettering band: between the outer and inner rings. Capitals are **4.3 % of D** tall.
- Inner ring: 1 % of D thick, at 72 % of D across.
- Chevron frieze: 44 points, 2.6 % of D deep.
- M at the centre: 35 % of D square.

**Mark** (`mark-*.svg`, a 100 × 100 grid, H = height):

- Course bands: 4.5 % of H, at the top and bottom.
- Chevron M: strokes 15.5 % of H wide, filling the space between the bands with a 4.5 % gap.
- `mark-*` (coursed) adds two dry-stone joints, each 2.5 % of H, at 36 % and 64 % of the height.
- `mark-solid-*` leaves the joints out, for smaller sizes.

**Lockup** (`lockup-*.svg`, 8.77 : 1):

- The solid mark is at full height H.
- The wordmark's capitals are 0.76 H tall, centred on the mark.
- The gap between them is 0.55 H.

**Wordmark** (`wordmark-*.svg`, 9.53 : 1): the file's height is the cap height.

## Clear space

| Artwork | Keep clear on every side |
|---|---|
| Seal | ⅛ of its diameter |
| Mark | ¼ of its height |
| Lockup | ½ the height of the mark (≈ the gap between mark and name) |
| Wordmark | ½ its cap height |

## Minimum sizes

| Artwork | Screen | Print |
|---|---|---|
| Seal | **144 px** diameter (lettering ≈ 6 px tall) | **30 mm**; embroidery or engraving: 60 mm, or use the mark |
| Mark, coursed (`mark-*`) | 64 px | 15 mm (below this the joints close up) |
| Mark, solid (`mark-solid-*`) | 20 px | 5 mm |
| Below 20 px | only the hand-fitted icons: `png/symbol-16/32/48.png`, `favicon.ico`, `favicon.svg` | — |
| Lockup | 20 px tall | 6 mm tall |
| Wordmark | 12 px tall | 4 mm tall |

## Which version when

- **Full seal:** when the identity is the centrepiece and there is room. Profile pictures, record
  sleeves and back covers, merchandise (chest prints, labels, stickers), certificates, press-kit
  covers, stage screens and video end-cards, embossing and stamps. Use it at 144 px / 30 mm or more.
- **M mark:** wherever the seal would be too small, or the space is square and small. Favicons and
  app icons (through the icon files), small avatars, watermarks on photos and video, social
  highlight covers, sleeve spines and small merch placements. Use the coursed version at 64 px or
  more and the solid version below that.
- **Horizontal lockup:** when the name has to be read in a wide space. The website header,
  letterheads, invoices, email signatures and partner or festival logo strips.
- **Wordmark:** when the mark is already nearby, or for typographic credits. The site footer,
  "Produced by" credits, film titles and liner notes.
- Use **one** of these per view. Don't put the seal and the lockup side by side.

## Do / don't

- Do use on-dark files on near-black, charcoal or dark photography, and on-light files on off-white or white.
- Do switch to the M mark rather than shrink the seal below 144 px / 30 mm.
- Do use the single-colour black or white files when only one colour is possible.
- Don't set gold artwork on light grounds, or the on-light files on dark ones.
- Don't retype, respace or translate the seal lettering, or replace "PLAY SKILFULLY" with other words.
- Don't rotate, stretch or crop the seal, or remove the chevron frieze or the rings.
- Don't pull the M away from its two course bands, or use the coursed M below 64 px.
- Don't add bevels, gradients, glows or fake-metal effects. Real foil in print is fine.
- Don't recolour the frieze or diamonds on dark: they stay gold.

---

## Files

**`svg/`** holds editable vectors, each with a `viewBox` that starts at 0 0, in four colourways:
`on-dark`, `on-light`, `black` and `white`.

| File | What it is |
|---|---|
| `symbol-*.svg` | **The full seal** |
| `mark-*.svg` | The coursed-stone M with its two joints, for large use |
| `mark-solid-*.svg` | The same M without joints, for 20–64 px |
| `lockup-*.svg` | Solid M + MANUCHIE, horizontal |
| `wordmark-*.svg` | MANUCHIE |
| `favicon.svg` | Transparent M on the 32 px grid. Near-black with terracotta bands on light browser themes, all gold on dark |
| `social-1080.svg` | Profile image: the seal on near-black under a terracotta glow |
| `icons/` | Sources for the PNG icons. `icon-16/32/48.svg` are hand-fitted to the pixel grid (16 px is drawn pixel by pixel). Also `icon-180/192/512/1080.svg` and `maskable-512.svg` |

**`png/`** holds raster exports from those sources.

| File | What it is |
|---|---|
| `symbol-16.png`, `symbol-32.png`, `symbol-48.png` | Favicon sizes: the gold solid M on a rounded near-black tile, crisp at actual size |
| `symbol-180.png`, `symbol-1080.png` | Coursed M on a full-bleed near-black square |
| `symbol-192.png`, `symbol-512.png` | The same with 20 % rounded corners |
| `maskable-512.png` | M at 42 %, inside the 80 % safe circle |
| `social-1080.png` | Profile picture, safe for round crops |
| `transparent/` | `symbol-on-dark-1080.png` / `symbol-on-light-1080.png` (the seal), `mark-on-dark-1080.png` / `mark-on-light-1080.png`, and `lockup-on-dark-2000w.png` / `lockup-on-light-2000w.png` |

Note on names: the SVG `symbol-*` files are the seal. The PNG `symbol-<size>.png` files are the
icon set, built from the M mark, because the seal cannot work at icon sizes.

**Package root** (the files that go into the web root, ready to drop in):

- `favicon.ico` (16, 32 and 48 px inside)
- `favicon.svg`
- `apple-touch-icon.png` (180 px, full-bleed; iOS rounds it)
- `icon-192.png`, `icon-512.png`, `maskable-512.png`
- `site.webmanifest`

---

## Putting it on the site

**1. Copy the files.** The web-root set goes next to `index.html`. The logos go into assets:

```
cp brand/package/{favicon.ico,favicon.svg,apple-touch-icon.png,icon-192.png,icon-512.png,maskable-512.png,site.webmanifest} .
mkdir -p assets/brand && cp brand/package/svg/{lockup-on-dark.svg,wordmark-on-dark.svg,symbol-on-dark.svg} assets/brand/
```

**2. In `<head>`:** replace the current inline `data:image/svg+xml` favicon `<link rel="icon">` (the
old gold "M") with:

```html
<link rel="icon" href="favicon.ico" sizes="32x32">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
```

Keep the existing `<meta name="theme-color" content="#0a0a0b">`; it matches the manifest. Chrome,
Edge and Firefox use the SVG, which follows the browser's light or dark theme. Safari and older
browsers use the ICO.

**3. Header logo.** Replace `<a class="nav-logo" href="#top">Manuchie</a>` with:

```html
<a class="nav-logo" href="#top" aria-label="Manuchie, back to top">
  <img src="assets/brand/lockup-on-dark.svg" alt="Manuchie" width="246" height="28">
</a>
```

```css
.nav-logo img{display:block;height:28px;width:auto}
@media (max-width:900px){.nav-logo img{height:24px}}
```

The lockup is 8.77 : 1, so 246 × 28 px on desktop and 211 × 24 px on phones.

**4. Footer (optional).** `<span class="foot-logo">Manuchie</span>` can become the wordmark
(9.53 : 1, e.g. `width="381" height="40"`):

```html
<img class="foot-logo" src="assets/brand/wordmark-on-dark.svg" alt="Manuchie" width="381" height="40">
```

Alternatively, use the seal (`symbol-on-dark.svg`) as a sign-off at 144 px or more.

**5. Manifest** (`site.webmanifest`, already in the package; the paths are relative to it):

```json
{
  "name": "Manuchie",
  "short_name": "Manuchie",
  "start_url": "./",
  "scope": "./",
  "display": "browser",
  "theme_color": "#0a0a0b",
  "background_color": "#0a0a0b",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

**6. The site's `build.sh`.** It copies only `index.html`, `_headers`, `robots.txt`, `sitemap.xml`
and the `.jpg/.png/.webp/.avif` images that sit directly in `assets/`. Add the new files to it:

```
cp favicon.ico favicon.svg apple-touch-icon.png icon-192.png icon-512.png maskable-512.png site.webmanifest dist/
mkdir -p dist/assets/brand && cp assets/brand/*.svg dist/assets/brand/
```

Its reference check fails the build if one of these is missing, which is a useful safety net. The
Content-Security-Policy in `_headers` already allows all of this: the images and the manifest are
same-origin.

---

## Rebuilding

`brand/build.sh` re-exports every PNG and the ICO, plus the proposal previews, from the SVG sources.
It needs only `rsvg-convert` and `python3`.

```
brand/build.sh                                                         # re-export from the current SVGs
BRAND_PYTHON=/path/to/venv/bin/python brand/build.sh --regenerate      # rebuild the SVGs too (keeps Hallmark)
```

`--regenerate` rebuilds the concept named in `brand/package/.concept`, which is now `hallmark`.
The SVGs are generated by `brand/source/generate.py` (Hallmark is `class Hallmark`; the 16 px
icon is the character grid `PIXELS_16["hallmark"]`). It outlines the site's own font files, so edit
the numbers there rather than the SVGs by hand. That keeps every colourway and size in step. It
needs fontTools, brotli, uharfbuzz and skia-pathops (`pip install fonttools brotli uharfbuzz
skia-pathops` into a virtualenv). `proposals/preview.png` is refreshed only when `PLAYWRIGHT_DIR`
points at a `playwright` install whose Chromium build is present.
