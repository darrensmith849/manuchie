#!/usr/bin/env bash
# Manuchie identity: export pipeline.
#
#   brand/build.sh                       re-export every PNG / ICO from the SVG sources
#   brand/build.sh --regenerate          rebuild all SVGs from brand/source/generate.py first
#   brand/build.sh --package mbira       make another concept the production package, then export
#
# Needs rsvg-convert (librsvg) and python3 (standard library only) for the exports.
# --regenerate / --package also need a Python with fontTools, brotli, uharfbuzz and skia-pathops:
#   python3 -m venv /tmp/brand-venv && /tmp/brand-venv/bin/pip install fonttools brotli uharfbuzz skia-pathops
#   BRAND_PYTHON=/tmp/brand-venv/bin/python brand/build.sh --package mbira
# proposals/preview.png (full-page screenshot) is refreshed only when PLAYWRIGHT_DIR points at a
# folder that has node_modules/playwright installed (keep it outside the repo).
set -euo pipefail
cd "$(dirname "$0")"
BRAND="$(pwd)"

REGEN=0
PACKAGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --regenerate) REGEN=1 ;;
    --package) PACKAGE="${2:?--package needs a concept: lumen, mbira or hallmark}"; REGEN=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found (brew install librsvg)" >&2; exit 1; }

if [ "$REGEN" = 1 ]; then
  PY="${BRAND_PYTHON:-python3}"
  "$PY" -c "import fontTools, brotli, uharfbuzz, pathops" 2>/dev/null || {
    echo "$PY lacks fontTools/brotli/uharfbuzz/skia-pathops; set BRAND_PYTHON (see the top of this file)" >&2; exit 1; }
  PYTHONDONTWRITEBYTECODE=1 "$PY" source/generate.py ${PACKAGE:+--package "$PACKAGE"}
fi

CONCEPT="$(cat package/.concept 2>/dev/null || echo lumen)"
BLACK="#0a0a0b"
WHITE="#f3f0ea"

# render <svg> <png> [rsvg-convert options...]
render() { mkdir -p "$(dirname "$2")"; local src="$1" out="$2"; shift 2; rsvg-convert "$@" "$src" -o "$out"; }

echo "== concepts (proposal previews)"
for dir in concepts/*/; do
  c="$(basename "$dir")"
  p="concepts/$c/preview"
  render "concepts/$c/preview-board.svg" "$p/board.png"
  for s in 16 32 48; do render "concepts/$c/icons/icon-$s.svg" "$p/icon-$s.png" -w $s -h $s; done
  render "concepts/$c/symbol-on-dark.svg" "$p/symbol-on-dark-800.png" -w 800 -b "$BLACK"
  render "concepts/$c/symbol.svg"         "$p/symbol-on-light-800.png" -w 800 -b "$WHITE"
  render "concepts/$c/lockup-on-dark.svg" "$p/lockup-on-dark.png" -h 160 -b "$BLACK"
  render "concepts/$c/lockup.svg"         "$p/lockup-on-light.png" -h 160 -b "$WHITE"
  render "concepts/$c/social-1080.svg"    "$p/social-1080.png" -w 1080 -h 1080
done

echo "== package ($CONCEPT)"
P=package
for s in 16 32 48 180 192 512 1080; do
  render "$P/svg/icons/icon-$s.svg" "$P/png/symbol-$s.png" -w $s -h $s
done
render "$P/svg/icons/maskable-512.svg" "$P/png/maskable-512.png" -w 512 -h 512
render "$P/svg/social-1080.svg"        "$P/png/social-1080.png" -w 1080 -h 1080
render "$P/svg/symbol-on-dark.svg"     "$P/png/transparent/symbol-on-dark-1080.png" -w 1080
render "$P/svg/symbol-on-light.svg"    "$P/png/transparent/symbol-on-light-1080.png" -w 1080
render "$P/svg/lockup-on-dark.svg"     "$P/png/transparent/lockup-on-dark-2000w.png" -w 2000
render "$P/svg/lockup-on-light.svg"    "$P/png/transparent/lockup-on-light-2000w.png" -w 2000
rm -f "$P"/png/transparent/mark-*.png
if [ -f "$P/svg/mark-on-dark.svg" ]; then   # concepts with a separate small-size mark (Hallmark)
  render "$P/svg/mark-on-dark.svg"  "$P/png/transparent/mark-on-dark-1080.png" -w 1080
  render "$P/svg/mark-on-light.svg" "$P/png/transparent/mark-on-light-1080.png" -w 1080
fi

# favicon.ico: the three hand-fitted PNGs in one Vista-style (PNG-compressed) icon container
python3 - "$P/favicon.ico" "$P/png/symbol-16.png" "$P/png/symbol-32.png" "$P/png/symbol-48.png" <<'PY'
import struct, sys
out, pngs = sys.argv[1], sys.argv[2:]
blobs = [open(p, "rb").read() for p in pngs]
head = struct.pack("<HHH", 0, 1, len(blobs))
offset = 6 + 16 * len(blobs)
entries, body = b"", b""
for b in blobs:
    assert b[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    w, h = struct.unpack(">II", b[16:24])
    entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(b), offset + len(body))
    body += b
open(out, "wb").write(head + entries + body)
print("  favicon.ico:", ", ".join("%dx%d" % struct.unpack(">II", b[16:24]) for b in blobs))
PY

# the web-root drop-in set
cp "$P/png/symbol-180.png"   "$P/apple-touch-icon.png"
cp "$P/png/symbol-192.png"   "$P/icon-192.png"
cp "$P/png/symbol-512.png"   "$P/icon-512.png"
cp "$P/png/maskable-512.png" "$P/maskable-512.png"
cp "$P/svg/favicon.svg"      "$P/favicon.svg"

echo "== proposals page assets"
A=proposals/assets
mkdir -p "$A/fonts"
cp ../assets/fonts/newsreader-v26-cY9AfjOCX1hbuyalUrK4397yjIJFJpc.woff2 "$A/fonts/newsreader.woff2"
cp ../assets/fonts/newsreader-v26-cY9CfjOCX1hbuyalUrK439vCjohCBJWxZA.woff2 "$A/fonts/newsreader-italic.woff2"
cp ../assets/fonts/inter-v20-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2 "$A/fonts/inter.woff2"
for dir in concepts/*/; do
  c="$(basename "$dir")"
  mkdir -p "$A/$c"
  for f in symbol.svg symbol-on-dark.svg wordmark.svg wordmark-on-dark.svg lockup.svg lockup-on-dark.svg core.svg; do
    [ -f "concepts/$c/$f" ] || continue
    cp "concepts/$c/$f" "$A/$c/$f"
  done
  for s in 16 32 48; do cp "concepts/$c/preview/icon-$s.png" "$A/$c/icon-$s.png"; done
  for m in light dark; do for s in 16 32; do render "concepts/$c/icons/favicon-$m.svg" "$A/$c/favicon-$m-$s.png" -w $s -h $s; done; done
  render "concepts/$c/social-1080.svg" "$A/$c/social-540.png" -w 540 -h 540
done

if [ -n "${PLAYWRIGHT_DIR:-}" ] && [ -d "$PLAYWRIGHT_DIR/node_modules/playwright" ]; then
  echo "== proposals/preview.png"
  NODE_PATH="$PLAYWRIGHT_DIR/node_modules" node source/shoot.cjs "$BRAND/proposals/index.html" "$BRAND/proposals/preview.png"
else
  echo "(skipping proposals/preview.png: set PLAYWRIGHT_DIR to refresh it)"
fi
echo "done."
