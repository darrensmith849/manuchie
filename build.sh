#!/usr/bin/env bash
# Build dist/ for Cloudflare Pages.
#   - copies the page, styles, scripts, self-hosted fonts and only the images the page uses
#   - writes the booking email from config.js into the form's mailto: action, so the
#     form opens the visitor's email app even without JavaScript (config.js is git-ignored)
#   - versions CSS, JS and images with a content hash (?v=…) so _headers can cache them for a year
#
# Deploy:  ./build.sh && npx wrangler pages deploy dist --project-name manuchie --branch main
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist/assets/fonts
cp index.html styles.css fonts.css script.js _headers robots.txt sitemap.xml dist/
cp assets/fonts/*.woff2 dist/assets/fonts/
grep -oE 'assets/[a-z0-9-]+\.(jpg|png)' index.html | sort -u | while read -r f; do cp "$f" "dist/$f"; done

if [ -f config.js ]; then
  cp config.js dist/
  email=$(sed -nE 's/.*bookingEmail: *"([^"]*)".*/\1/p' config.js)
  if [[ "$email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
    EMAIL="$email" perl -pi -e 's/action="mailto:[^?"]*/action="mailto:$ENV{EMAIL}/' dist/index.html
  else
    echo "warning: no valid bookingEmail in config.js — the form keeps its default address"
  fi
  [ "$email" = "bookings@manuchie.com" ] && echo "note: bookingEmail is still the placeholder bookings@manuchie.com"
else
  echo "warning: config.js missing — the page will use the default booking email"
fi

# content-hash the CSS/JS references
for f in styles.css fonts.css script.js config.js; do
  [ -f "dist/$f" ] || continue
  h=$(shasum -a 256 "dist/$f" | cut -c1-10)
  perl -pi -e "s/\Q$f\E\?v=[^\"]*/$f?v=$h/g" dist/index.html
done

# content-hash relative image references (jpg/png) in src/srcset (absolute og/twitter/JSON-LD URLs stay clean)
perl -MDigest::SHA -pi -e 's{(?<![/\w])(assets/[\w-]+\.(?:jpg|png))}{ $1 . "?v=" . substr(Digest::SHA->new(256)->addfile($1)->hexdigest, 0, 10) }ge' dist/index.html

echo "dist/ ready: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
