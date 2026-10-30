#!/usr/bin/env bash
# Build dist/ for Cloudflare (Worker "manuchie" with static assets, on manuchie.org).
#   - copies the page, robots.txt, sitemap.xml, _headers, the self-hosted fonts that fonts.css
#     uses and only the images the page references (JPEG/PNG originals + AVIF/WebP copies)
#   - minifies styles.css, fonts.css and script.js with esbuild (exact version pinned below);
#     if esbuild can't be fetched the files are copied as they are, with a warning
#   - folds fonts.css into styles.css for the page (one render-blocking stylesheet)
#   - copies config.js (git-ignored; holds the address behind the "Email" link)
#   - copies the private dashboard shell admin/ to dist/admin/ (served only through the Worker)
#   - versions CSS, JS and images with a content hash (?v=…) so _headers can cache them for a year
#   - fails if the page references a file that isn't in dist/
# The enquiry form posts to /api/enquiry (handled by the Worker); nothing is written into it here.
# Responsive image copies are made once with scripts/images.sh, not on every build.
#
# Deploy:  ./build.sh && npx wrangler deploy
set -euo pipefail
cd "$(dirname "$0")"

ESBUILD="esbuild@0.28.2"

rm -rf dist
mkdir -p dist/assets/fonts
cp index.html _headers robots.txt sitemap.xml favicon.ico dist/

# --- CSS + JS (minified) --------------------------------------------------------------
minify() { # minify <file> <esbuild args…>
  local f=$1; shift
  if [ "${NO_MINIFY:-}" != "1" ] && npx -y "$ESBUILD" "$f" --minify --log-level=warning "$@" --outfile="dist/$f" 2>/dev/null; then
    return 0
  fi
  echo "warning: $f copied without minifying (esbuild unavailable)" >&2
  cp "$f" "dist/$f"
}
minify styles.css --target=chrome100,edge100,firefox100,safari15
minify fonts.css  --target=chrome100,edge100,firefox100,safari15
minify script.js  --target=es2019
# the page gets one render-blocking stylesheet: the @font-face rules go in front of styles.css
# (fonts.css stays in dist/ on its own too — the Worker's no-JavaScript confirmation page links it)
cat dist/fonts.css dist/styles.css > dist/styles.tmp && mv dist/styles.tmp dist/styles.css
perl -0pi -e 's{[ \t]*<link rel="stylesheet" href="fonts\.css[^>]*>\n}{}' dist/index.html

if [ -f config.js ]; then
  cp config.js dist/
  email=$(sed -nE 's/.*bookingEmail: *"([^"]*)".*/\1/p' config.js)
  [[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || echo "warning: no valid bookingEmail in config.js — the Email link uses the default address"
  [ "$email" = "bookings@manuchie.com" ] && echo "note: bookingEmail is still the placeholder bookings@manuchie.com"
else
  echo "warning: config.js missing — the Email link uses the default address"
  printf 'window.MANUCHIE_CONFIG = window.MANUCHIE_CONFIG || {};\n' > dist/config.js
fi

# --- fonts and images: only what is referenced -----------------------------------------
grep -oE 'assets/fonts/[A-Za-z0-9_.-]+\.woff2' fonts.css | sort -u | while read -r f; do cp "$f" "dist/$f"; done
grep -oE 'assets/[A-Za-z0-9_.-]+\.(jpg|png|webp|avif|svg)' index.html | sort -u | while read -r f; do cp "$f" "dist/$f"; done

# --- private dashboard shell (auth-gated by the Worker; never linked from the page) -----
if [ -d admin ]; then
  mkdir -p dist/admin
  cp -R admin/. dist/admin/
fi

# --- HTML: drop developer comments ----------------------------------------------------
perl -0pi -e 's/[ \t]*<!--(?!\[).*?-->\n?//gs' dist/index.html

# --- content-hash the CSS/JS references -------------------------------------------------
for f in styles.css fonts.css script.js config.js; do
  [ -f "dist/$f" ] || continue
  h=$(shasum -a 256 "dist/$f" | cut -c1-10)
  perl -pi -e "s/\Q$f\E\?v=[^\"]*/$f?v=$h/g" dist/index.html
done

# --- content-hash relative image references (src, srcset, preload) ---------------------
# absolute og:/twitter:/JSON-LD URLs (https://manuchie.org/assets/…) stay clean
perl -MDigest::SHA -pi -e 's{(?<![/\w])(assets/[\w-]+\.(?:jpg|png|webp|avif|svg))(?![\w?])}{ $1 . "?v=" . substr(Digest::SHA->new(256)->addfile($1)->hexdigest, 0, 10) }ge' dist/index.html

# --- every local reference must exist ---------------------------------------------------
missing=0
for ref in $(perl -ne 'while (/\b(?:src|href|srcset|imagesrcset)="([^"]*)"/g) { my $v = $1; next if $v =~ m{^(?:https?:|mailto:|data:|#|/)}; for (split /,\s*/, $v) { my ($u) = split /\s+/; $u =~ s/\?.*//; print "$u\n" if length $u } }' dist/index.html | sort -u); do
  [ -f "dist/$ref" ] || { echo "error: dist/$ref is missing" >&2; missing=1; }
done
for ref in $(grep -oE 'url\(assets/[^)]+\)' dist/fonts.css | sed -E 's/^url\(//; s/\)$//' | sort -u); do
  [ -f "dist/$ref" ] || { echo "error: dist/$ref is missing" >&2; missing=1; }
done
[ $missing = 0 ] || exit 1

echo "dist/ ready: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
