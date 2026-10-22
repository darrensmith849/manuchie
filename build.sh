#!/usr/bin/env bash
# Build dist/ for Cloudflare Pages.
#   - copies the page, styles, scripts, self-hosted fonts and only the images the page uses
#   - puts the Web3Forms key from config.js into the form, so the no-JS POST works
#     (config.js is git-ignored — the key never lands in the repo)
#   - versions CSS, JS and images with a content hash (?v=…) so _headers can cache them for a year
#
# Deploy:  ./build.sh && npx wrangler pages deploy dist --project-name manuchie --branch main
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist/assets/fonts
cp index.html styles.css fonts.css script.js _headers dist/
cp assets/fonts/*.woff2 dist/assets/fonts/
grep -oE 'assets/[a-z0-9-]+\.jpg' index.html | sort -u | while read -r f; do cp "$f" "dist/$f"; done

if [ -f config.js ]; then
  cp config.js dist/
  key=$(sed -nE 's/.*web3formsKey: *"([^"]*)".*/\1/p' config.js)
  if [[ "$key" =~ ^[A-Za-z0-9-]+$ && "$key" != PASTE_* ]]; then
    perl -pi -e 's/(name="access_key" value=")"/${1}'"$key"'"/' dist/index.html
  else
    echo "note: no Web3Forms key in config.js — with JS the form opens the visitor's mail app; without JS it cannot send"
  fi
else
  echo "warning: config.js missing — the page will use the default booking email and no form key"
fi

# content-hash the CSS/JS references
for f in styles.css fonts.css script.js config.js; do
  [ -f "dist/$f" ] || continue
  h=$(shasum -a 256 "dist/$f" | cut -c1-10)
  perl -pi -e "s/\Q$f\E\?v=[^\"]*/$f?v=$h/g" dist/index.html
done

# content-hash relative image references in src/srcset (absolute og/twitter/JSON-LD URLs stay clean)
perl -MDigest::SHA -pi -e 's{(?<![/\w])(assets/[\w-]+\.jpg)}{ $1 . "?v=" . substr(Digest::SHA->new(256)->addfile($1)->hexdigest, 0, 10) }ge' dist/index.html

echo "dist/ ready: $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
