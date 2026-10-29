#!/usr/bin/env bash
# Derive responsive AVIF + WebP copies of the site photographs, next to the originals in assets/.
#   - the originals are never touched: every copy is the original JPEG/PNG resized to a width
#     (same crop, same pixels), with the original's colour profile embedded (sRGB or Display P3)
#   - the largest width of each photo is the original's own width (no upscaling)
#   - existing copies are kept; pass -f to re-encode them all
# Needs (macOS): sips (built in), cwebp (libwebp), avifenc (libavif).
# Run after adding or replacing a photo, then reference the new files in index.html.
set -euo pipefail
cd "$(dirname "$0")/.."
force=0; [ "${1:-}" = "-f" ] && force=1
for t in sips cwebp avifenc; do command -v "$t" >/dev/null || { echo "images.sh: $t not found" >&2; exit 1; }; done
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# file : widths
photos=(
  "portrait-terracotta.jpg : 400 536"
  "studio.jpg              : 480 640 960 1119"
  "studio-mantra.jpg       : 640 960 1252"
  "worship-rays.jpg        : 640 960 1280 1600"
  "window.jpg              : 480 720 1119"
  "recline.jpg             : 480 720 1119"
  "portrait-cap.jpg        : 480 720 1119"
  "tux-gallery.jpg         : 480 720 1120"
)

made=0
for entry in "${photos[@]}"; do
  file=$(echo "${entry%%:*}" | tr -d ' '); widths=${entry#*:}
  src="assets/$file"; base="assets/${file%.*}"
  full=$(sips -g pixelWidth "$src" | awk '/pixelWidth/{print $2}')
  for w in $widths; do
    out="$base-$w"
    if [ $force = 0 ] && [ -f "$out.avif" ] && [ -f "$out.webp" ]; then continue; fi
    png="$tmp/$(basename "$out").png"
    if [ "$w" -ge "$full" ]; then sips -s format png "$src" --out "$png" >/dev/null
    else sips -s format png --resampleWidth "$w" "$src" --out "$png" >/dev/null; fi
    cwebp -quiet -q 80 -m 6 -sharp_yuv -metadata icc "$png" -o "$out.webp"
    avifenc -q 62 -s 4 -y 420 -j all "$png" "$out.avif" >/dev/null
    made=$((made + 1))
  done
done

# the footer credit mark: lossless WebP of the PNG (keeps its transparency)
if [ $force = 1 ] || [ ! -f assets/alltheglory-dove.webp ]; then
  cwebp -quiet -lossless -z 9 -metadata icc assets/alltheglory-dove.png -o assets/alltheglory-dove.webp
  made=$((made + 1))
fi

echo "images.sh: $made file set(s) written"
