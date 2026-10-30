#!/usr/bin/env bash
# Puts the site live in one step: unit tests, database migrations, build, deploy, a live check,
# then pushes the commits to GitHub. Uses Manuchie's own Cloudflare login, kept in ~/.cf-manuchie
# apart from the default Wrangler login.   Run: ./scripts/ship.sh   (or: npm run ship)
set -euo pipefail
cd "$(dirname "$0")/.."

CF_HOME="$HOME/.cf-manuchie"
NPM_CACHE="$HOME/.npm"
wrangler() { HOME="$CF_HOME" npm_config_cache="$NPM_CACHE" npx -y wrangler@4.155.0 "$@"; }

echo "→ Unit tests"
npm test --silent > /dev/null

echo "→ Database migrations"
wrangler d1 migrations apply manuchie --remote

echo "→ Build"
./build.sh

echo "→ Deploy"
wrangler deploy

echo "→ Live check"
local_size=$(wc -c < dist/admin/admin.css | tr -d ' ')
for i in 1 2 3 4 5; do
  live_size=$(curl -s https://manuchie.org/admin/admin.css | wc -c | tr -d ' ')
  [ "$live_size" = "$local_size" ] && break
  sleep 3
done
if [ "$live_size" != "$local_size" ]; then
  echo "✗ manuchie.org is not serving this build yet (admin.css $live_size bytes, expected $local_size)" >&2
  exit 1
fi
echo "✓ manuchie.org is serving this build"

if [ -n "$(git log origin/main..HEAD --oneline 2>/dev/null)" ]; then
  echo "→ Push to GitHub"
  git push origin HEAD:main
fi
echo "✓ Shipped"
