#!/usr/bin/env python3
"""Build the v2 symbol proposals: three figurative marks of Manuchie in gold light.

    python3 brand/v2/source/make.py          # writes brand/v2/<concept>/*.svg and brand/v2/boards/*.png

Design-time only. Needs skia-pathops, fontTools and uharfbuzz (for the outlined board labels),
Pillow (to compose the board PNGs) and rsvg-convert. The SVGs it writes are plain paths and
gradients: no rasters, no <text>.
"""
import io
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
V2 = os.path.normpath(os.path.join(HERE, ".."))

import draw as D  # noqa: E402
from draw import G  # noqa: E402
import typeset  # noqa: E402  (board labels only: use the brand folder's own copies of the site fonts)

typeset.FONTS = os.path.normpath(os.path.join(V2, "..", "proposals", "assets", "fonts"))
typeset.FILES = {"serif": "newsreader.woff2", "sans": "inter.woff2"}

CONCEPTS = [
    ("facing-the-light", "Facing the Light"),
    ("the-cue", "The Cue"),
    ("lifted", "Lifted"),
]


# ============================================================ 01 Facing the Light
def facing(mode="dark"):
    dark = mode == "dark"
    S, ox, oy, cx, cy = 0.74, 455, 560, 720, 900
    X = lambda x: (x - cx) * S + ox
    Y = lambda y: (y - cy) * S + oy
    M = lambda p: D.fit(p, S, ox, oy, cx, cy)
    P = D.profile_parts()
    d0, f0 = D.burst(790, 410, 260, "fb", intensity=1.0 if dark else .9)
    d1, f1 = D.arc(500, 520, 380, 8, 112, 332, "fa", peak=.62, colour=D.GOLD if dark else D.GOLD_DEEP,
                   hi=D.GOLD_HI if dark else D.GOLD)
    if dark:
        skin = ("#fffdf8", "#f7f3ec", "#e6ddcf"); tone = ("#cfc2ac", "#a99a83"); hair = ("#b8aa93", "#ece5d9")
    else:
        skin = ("#2a2622", "#1b1917", "#121110"); tone = ("#7d705f", "#5e5346"); hair = ("#6f6353", "#2a2622")
    defs = (f'<linearGradient id="fs" x1="{X(1040):.1f}" y1="0" x2="{X(420):.1f}" y2="0" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{skin[0]}"/><stop offset=".55" stop-color="{skin[1]}"/><stop offset="1" stop-color="{skin[2]}"/></linearGradient>'
            f'<linearGradient id="ft" x1="{X(1040):.1f}" y1="0" x2="{X(420):.1f}" y2="0" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{tone[0]}"/><stop offset="1" stop-color="{tone[1]}"/></linearGradient>'
            f'<linearGradient id="fh" x1="0" y1="{Y(690):.1f}" x2="0" y2="{Y(772):.1f}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{hair[0]}"/><stop offset="1" stop-color="{hair[1]}"/></linearGradient>')
    figure = (f'<path fill="url(#fs)" d="{G.d(M(P["skin"]))}"/>'
              f'<path fill="url(#fh)" d="{G.d(M(P["hair"]))}"/>'
              f'<path fill="url(#ft)" d="{G.d(M(P["tone"]))}"/>'
              f'<path fill="{D.GOLD if dark else D.GOLD_DEEP}" d="{G.d(M(P["chain"]))}"/>')
    if not dark:  # on light the lenses are drawn, not cut, so they stay dark
        figure += f'<path fill="#8a7c69" d="{G.d(M(G.inter(D.glasses(), D.head_outline())))}"/>'
    return f"<defs>{d0}{d1}{defs}</defs>{f0}{f1}{figure}"


SMALL_TONE = "#a7987f"


def facing_small(size):
    """Simplified for small sizes: the head in two tones with bold sunglasses, a gold sun ahead."""
    P = D.profile_parts(trunc=(724, 598, 620), chain=False, clip=D.NECK_CLIP, bold=30 if size <= 32 else 14, ear_line=False)
    F = lambda p: D.fit(p, 0.74, 455, 560, 720, 900)
    layers = [(D.WHITE, F(P["skin"])), (SMALL_TONE, F(G.union(P["hair"], P["tone"]))),
              (D.GOLD, G.circle(812, 372, 96 if size <= 16 else 80))]
    if size >= 48:
        layers.append((D.GOLD, D.arc_shape(500, 520, 380, 16, 112, 332, .62)))
    crop = {16: (215, 165, 700), 32: (195, 160, 720), 48: (110, 110, 810)}[size]
    return layers, crop


# ============================================================ 02 The Cue
def cue(mode="dark"):
    dark = mode == "dark"
    H = D.hand_parts()
    T = lambda p: D.fit(D.rot(p, 9), 1.85, 490, 700)
    d0, f0 = D.burst(586, 262, 250, "cb", intensity=1.0 if dark else .9)
    d1, f1 = D.arc(500, 530, 372, 8, 168, 392, "ca", peak=.55, colour=D.GOLD if dark else D.GOLD_DEEP,
                   hi=D.GOLD_HI if dark else D.GOLD)
    c = ("#fffdf8", "#f4efe6", "#e5dccc") if dark else ("#2a2622", "#1b1917", "#141210")
    grad = (f'<linearGradient id="cl" x1="580" y1="270" x2="440" y2="1000" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{c[0]}"/><stop offset=".45" stop-color="{c[1]}"/><stop offset=".72" stop-color="{c[2]}"/>'
            f'<stop offset=".97" stop-color="{c[2]}" stop-opacity="0"/></linearGradient>')
    return (f"<defs>{d0}{d1}{grad}</defs>{f0}{f1}"
            f'<path fill="url(#cl)" d="{G.d(T(H["hand"]))}"/>'
            f'<path fill="{D.GOLD if dark else D.GOLD_DEEP}" d="{G.d(T(H["strap"]))}"/>')


def cue_small(size):
    H = D.hand_parts(sep=5.0 if size >= 48 else 0.01)
    T = lambda p: D.fit(D.rot(p, 9), 1.85, 490, 700)
    hand = H["hand"] if size >= 48 else G.diff(H["solid"], G.rect(-90, 27, 180, 14))
    layers = [(D.WHITE, T(hand)), (D.GOLD, G.circle(590, 226, 84 if size <= 16 else 70))]
    if size >= 48:
        layers.append((D.GOLD, D.arc_shape(500, 530, 372, 16, 168, 392, .55)))
        layers.append((D.GOLD, T(H["strap"])))
    crop = {16: (300, 170, 540), 32: (280, 150, 590), 48: (110, 140, 780)}[size]
    return layers, crop


# ============================================================ 03 Lifted
LIFT = dict(tilt=-16, S=0.70, ox=440, oy=600, cx=740, cy=860)


def lifted(mode="dark"):
    """The same drawing, head lifted toward light that falls from above (the worship rays)."""
    dark = mode == "dark"
    P = D.profile_parts(trunc=(724, 598, 620), chain=False, clip=D.NECK_CLIP)
    t, S, ox, oy, cx, cy = LIFT["tilt"], LIFT["S"], LIFT["ox"], LIFT["oy"], LIFT["cx"], LIFT["cy"]
    T = lambda p: D.fit(D.rot(p, t, cx, cy), S, ox, oy, cx, cy)
    d0, f0, _ = D.beams((900, -120), [100, 108, 116, 124, 132], 1150, [(6, 70), (4, 40), (6, 90), (4, 36), (6, 60)], "lr",
                        colour=D.GOLD if dark else D.GOLD_DEEP, hi=D.GOLD_HI if dark else D.GOLD, strength=1.0 if dark else .85)
    glow = (f'<radialGradient id="lg" cx="720" cy="330" r="380" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{D.GOLD}" stop-opacity="{.35 if dark else .28}"/><stop offset="1" stop-color="{D.GOLD}" stop-opacity="0"/></radialGradient>')
    if dark:
        skin = ("#fffdf8", "#f7f3ec", "#e6ddcf"); tone = ("#cfc2ac", "#a99a83"); hair = ("#b8aa93", "#ece5d9")
    else:
        skin = ("#2a2622", "#1b1917", "#121110"); tone = ("#7d705f", "#5e5346"); hair = ("#6f6353", "#2a2622")
    # light falls from the upper right: gradients run from there
    defs = (f'<linearGradient id="ls" x1="760" y1="300" x2="260" y2="860" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{skin[0]}"/><stop offset=".5" stop-color="{skin[1]}"/><stop offset="1" stop-color="{skin[2]}"/></linearGradient>'
            f'<linearGradient id="lt" x1="760" y1="300" x2="260" y2="860" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{tone[0]}"/><stop offset="1" stop-color="{tone[1]}"/></linearGradient>')
    # the hair fade runs along the (rotated) head, so build it in drawing space and rotate the axis
    a = math.radians(t)
    def R(x, y):
        x2, y2 = cx + (x - cx) * math.cos(a) - (y - cy) * math.sin(a), cy + (x - cx) * math.sin(a) + (y - cy) * math.cos(a)
        return (x2 - cx) * S + ox, (y2 - cy) * S + oy
    (hx1, hy1), (hx2, hy2) = R(700, 690), R(700, 772)
    defs += (f'<linearGradient id="lh" x1="{hx1:.1f}" y1="{hy1:.1f}" x2="{hx2:.1f}" y2="{hy2:.1f}" gradientUnits="userSpaceOnUse">'
             f'<stop offset="0" stop-color="{hair[0]}"/><stop offset="1" stop-color="{hair[1]}"/></linearGradient>')
    figure = (f'<path fill="url(#ls)" d="{G.d(T(P["skin"]))}"/>'
              f'<path fill="url(#lh)" d="{G.d(T(P["hair"]))}"/>'
              f'<path fill="url(#lt)" d="{G.d(T(P["tone"]))}"/>')
    if not dark:
        clipped = G.inter(G.inter(D.glasses(), D.head_outline()), G.circle(724, 598, 620))
        figure += f'<path fill="#8a7c69" d="{G.d(T(clipped))}"/>'
    return f"<defs>{d0}{glow}{defs}</defs>" + f'<circle cx="720" cy="330" r="380" fill="url(#lg)"/>{f0}{figure}'


def lifted_small(size):
    P = D.profile_parts(trunc=(724, 598, 620), chain=False, clip=D.NECK_CLIP, bold=30 if size <= 32 else 14, ear_line=False)
    T = lambda p: D.fit(D.rot(p, LIFT["tilt"], LIFT["cx"], LIFT["cy"]), LIFT["S"], LIFT["ox"], LIFT["oy"], LIFT["cx"], LIFT["cy"])
    n = [108, 124] if size <= 16 else ([104, 117, 130] if size < 48 else [100, 112, 124, 136])
    w = [(12, 150), (12, 150)] if size <= 16 else ([(10, 130), (8, 100), (10, 130)] if size < 48 else [(8, 90), (6, 60), (8, 110), (6, 60)])
    _, _, bp = D.beams((900, -120), n, 1300, w, "x")
    crop = {16: (170, 170, 700), 32: (150, 160, 730), 48: (90, 90, 840)}[size]
    return [(D.GOLD, bp), (D.WHITE, T(P["skin"])), (SMALL_TONE, T(G.union(P["hair"], P["tone"])))], crop


ART = {"facing-the-light": (facing, facing_small), "the-cue": (cue, cue_small), "lifted": (lifted, lifted_small)}


# ============================================================ small-size icon files
def _mix(fg, bg, t):
    f = [int(fg[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(bg[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02x%02x%02x" % tuple(round(b[i] + (f[i] - b[i]) * t) for i in range(3))


# The raised hand cannot be sampled down to 16 px cleanly, so it is drawn pixel by pixel:
# '#' white, 'o' gold, '.' tile.
CUE_16 = [
    "................",
    "........ooo.....",
    "........ooo.....",
    "......#.ooo.....",
    "....#.#.#.......",
    "....#.#.#.#.....",
    "....#.#.#.#.....",
    "..#.#.#.#.#.....",
    "..#.#.#.#.#.....",
    "..#########..##.",
    "..#########.##..",
    "..###########...",
    "...#########....",
    "...########.....",
    "....######......",
    "....######......",
]


def small_svg(slug, size):
    """Icon on a near-black rounded tile. 16 px is snapped to whole pixels (empty / half / full
    coverage, half pre-blended over the tile) so it stays crisp; 32 and 48 are vector."""
    layers, (cx0, cy0, side) = ART[slug][1](size)
    k = size / side
    layers = [(c, G.mapped(p, lambda x, y: ((x - cx0) * k, (y - cy0) * k))) for c, p in layers]
    tile = G.rounded_rect(0, 0, size, size, size * 0.18)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" aria-label="Manuchie symbol">',
           "<title>Manuchie symbol</title>", f'<path fill="{D.BLACK}" d="{G.d(tile)}"/>']
    if size <= 16 and slug == "the-cue":
        cover = {}
        for y, row in enumerate(CUE_16):
            for x, ch in enumerate(row):
                if ch in "#o":
                    c = D.WHITE if ch == "#" else D.GOLD
                    cover.setdefault(c, G.path())
                    cover[c] = G.union(cover[c], G.rect(x, y, 1, 1))
        for c, p in cover.items():
            out.append(f'<path fill="{c}" shape-rendering="crispEdges" d="{G.d(G.inter(p, tile))}"/>')
    elif size <= 16:
        cover = {}
        for col, p in layers:
            for y in range(size):
                for x in range(size):
                    a = abs(G.inter(p, G.rect(x, y, 1, 1)).area)
                    if a < (0.22 if col == D.WHITE else 0.3):
                        continue
                    c = col if a >= 0.7 else _mix(col, D.BLACK, 0.5)
                    cover.setdefault(c, G.path())
                    cover[c] = G.union(cover[c], G.rect(x, y, 1, 1))
        for c, p in cover.items():
            out.append(f'<path fill="{c}" shape-rendering="crispEdges" d="{G.d(G.inter(p, tile))}"/>')
    else:
        for col, p in layers:
            out.append(f'<path fill="{col}" d="{G.d(G.inter(p, tile))}"/>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


def avatar_svg(slug):
    inner = ART[slug][0]("dark")
    clip = '<clipPath id="round"><circle cx="500" cy="500" r="500"/></clipPath>'
    return D.svg_doc(f'<defs>{clip}</defs><g clip-path="url(#round)"><rect width="1000" height="1000" fill="{D.BLACK}"/>{inner}</g>',
                     title="Manuchie profile picture")


# ============================================================ rendering + boards
def rsvg(svg, w, h=None, bg=None):
    args = ["rsvg-convert", "-w", str(w)] + (["-h", str(h)] if h else []) + (["-b", bg] if bg else [])
    from PIL import Image
    return Image.open(io.BytesIO(subprocess.run(args, input=svg.encode(), capture_output=True, check=True).stdout)).convert("RGBA")


def label(txt, size, colour, weight=600, tracking=0.16, font="sans"):
    from typeset import draw_text
    p = G.path()
    _, total = draw_text(p.getPen(), txt, font, {"wght": weight} if font == "sans" else {"wght": weight, "opsz": 60}, size, 0, size, tracking=tracking)
    p.simplify()
    b = p.bounds
    w = int(math.ceil(b[2])) + 4
    h = int(size * 1.4)
    return rsvg(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"><path fill="{colour}" d="{G.d(p)}"/></svg>', w * 2, h * 2).resize((w, h))


def board(slug, name, index, out_png):
    from PIL import Image, ImageDraw
    W, H = 1800, 1000
    img = Image.new("RGBA", (W, H), (20, 20, 22, 255))
    big = rsvg(D.svg_doc(ART[slug][0]("dark"), bg=D.BLACK), 1000, 1000)
    img.alpha_composite(big, (0, 0))
    lab = lambda t, s=15, c="#8a8b90", **k: label(t, s, c, **k)
    img.alpha_composite(lab(f"{index:02d}", 15, "#8a8b90"), (40, 34))
    img.alpha_composite(label(name, 34, "#f3f0ea", weight=500, tracking=-0.01, font="serif"), (40, 60))
    x0 = 1040
    img.alpha_composite(lab("ON LIGHT"), (x0, 40))
    light = rsvg(D.svg_doc(ART[slug][0]("light"), bg=D.PAPER), 360, 360)
    img.alpha_composite(light, (x0, 70))
    img.alpha_composite(lab("PROFILE PICTURE"), (x0 + 400, 40))
    av = rsvg(avatar_svg(slug), 300, 300)
    img.alpha_composite(av, (x0 + 400, 100))
    av2 = rsvg(avatar_svg(slug), 64, 64)
    img.alpha_composite(av2, (x0 + 400, 360 - 30 + 20))
    av3 = rsvg(avatar_svg(slug), 40, 40)
    img.alpha_composite(av3, (x0 + 480, 382))
    # sizes strip
    y0 = 480
    d = ImageDraw.Draw(img)
    d.rectangle((x0 - 20, y0, W - 40, H - 40), fill=(10, 10, 11, 255))
    img.alpha_composite(lab("180 · 48 · 32 · 16 PX, ACTUAL SIZE"), (x0, y0 + 20))
    s180 = rsvg(D.svg_doc(ART[slug][0]("dark"), bg=D.BLACK), 180, 180)
    img.alpha_composite(s180, (x0, y0 + 60))
    x = x0 + 210
    for s in (48, 32, 16):
        im = rsvg(small_svg(slug, s), s, s)
        img.alpha_composite(im, (x, y0 + 60 + 180 - s))
        x += s + 28
    img.alpha_composite(lab("ENLARGED: 48 × 2 · 32 × 3 · 16 × 6"), (x0, y0 + 290))
    x = x0
    for s, m in ((48, 2), (32, 3), (16, 6)):
        im = rsvg(small_svg(slug, s), s, s).resize((s * m, s * m), Image.NEAREST)
        img.alpha_composite(im, (x, y0 + 330))
        x += s * m + 30
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    img.convert("RGB").save(out_png)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def png(svg_path, out, w, h=None, bg=None):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    args = ["rsvg-convert", "-w", str(w)] + (["-h", str(h)] if h else []) + (["-b", bg] if bg else []) + [svg_path, "-o", out]
    subprocess.run(args, check=True)


def main():
    import shutil
    fonts = os.path.join(V2, "assets", "fonts")
    os.makedirs(fonts, exist_ok=True)
    for f in ("newsreader.woff2", "newsreader-italic.woff2", "inter.woff2"):
        shutil.copyfile(os.path.join(typeset.FONTS, f), os.path.join(fonts, f))
    for i, (slug, name) in enumerate(CONCEPTS, 1):
        d = os.path.join(V2, slug)
        write(os.path.join(d, "symbol.svg"), D.svg_doc(ART[slug][0]("dark"), title=f"Manuchie symbol: {name}"))
        write(os.path.join(d, "symbol-on-dark-square.svg"), D.svg_doc(ART[slug][0]("dark"), bg=D.BLACK, title=f"Manuchie symbol: {name}"))
        write(os.path.join(d, "symbol-on-light.svg"), D.svg_doc(ART[slug][0]("light"), title=f"Manuchie symbol: {name} (light grounds)"))
        write(os.path.join(d, "avatar.svg"), avatar_svg(slug))
        for s in (16, 32, 48):
            write(os.path.join(d, f"icon-{s}.svg"), small_svg(slug, s))
        p = os.path.join(d, "png")
        for s in (16, 32, 48):
            png(os.path.join(d, f"icon-{s}.svg"), os.path.join(p, f"icon-{s}.png"), s, s)
        png(os.path.join(d, "symbol-on-dark-square.svg"), os.path.join(p, "symbol-180.png"), 180, 180)
        png(os.path.join(d, "symbol-on-dark-square.svg"), os.path.join(p, "symbol-1000.png"), 1000, 1000)
        png(os.path.join(d, "avatar.svg"), os.path.join(p, "avatar-540.png"), 540, 540)
        board(slug, name, i, os.path.join(V2, "boards", f"{i:02d}-{slug}.png"))
        print("built", slug)


if __name__ == "__main__":
    main()
