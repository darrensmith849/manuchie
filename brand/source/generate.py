#!/usr/bin/env python3
"""Generate every Manuchie identity SVG from code: the three concepts and the production package.

    python3 brand/source/generate.py                  # concepts + package for the chosen concept
    python3 brand/source/generate.py --package lumen  # build the production package from another concept

The chosen concept is the one named in brand/package/.concept (Hallmark, chosen by the client on
29 October 2026); --package overrides it and becomes the new choice.

Needs fontTools, brotli, uharfbuzz and skia-pathops (design-time only; the output SVGs are plain
outlined paths with no fonts, no <text> and no rasters). brand/build.sh then rasterises them.
"""
import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
BRAND = os.path.normpath(os.path.join(HERE, ".."))

import geom as G  # noqa: E402
from typeset import draw_text, draw_text_on_circle  # noqa: E402

# ---------------------------------------------------------------------------- palette
BLACK = "#0a0a0b"      # near-black (site --bg)
CHARCOAL = "#141416"   # charcoal (site --surface)
WHITE = "#f3f0ea"      # warm off-white
TERRA = "#b5481e"      # terracotta (site --warm)
GOLD = "#c8a15a"       # muted warm gold, for use on dark grounds
GOLD_DEEP = "#8c6727"  # the same gold, deepened for light grounds
INK_BLACK = "#000000"  # single-colour black
INK_WHITE = "#ffffff"  # single-colour white

CHOSEN = "hallmark"  # the client's choice (29 Oct 2026); package/.concept, when present, wins


class Art:
    """Vector artwork: ordered (role, path) layers in a y-down box."""

    def __init__(self, layers, box=None, pad=0.0):
        self.layers = [(r, p) for r, p in layers if p is not None]
        if box is None:
            xs = [G.bounds(p) for _, p in self.layers]
            box = (min(b[0] for b in xs), min(b[1] for b in xs), max(b[2] for b in xs), max(b[3] for b in xs))
            box = (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)
        self.box = box  # xmin, ymin, xmax, ymax

    @property
    def w(self):
        return self.box[2] - self.box[0]

    @property
    def h(self):
        return self.box[3] - self.box[1]

    def placed(self, x, y, height):
        """Copy scaled to `height`, top-left of its box at (x, y)."""
        s = height / self.h
        bx, by = self.box[0], self.box[1]
        layers = [(r, G.mapped(p, lambda px, py: (x + (px - bx) * s, y + (py - by) * s))) for r, p in self.layers]
        return Art(layers, (x, y, x + self.w * s, y + height))


def combine(*arts, box=None, pad=0.0):
    layers = []
    for a in arts:
        layers += a.layers
    return Art(layers, box=box, pad=pad)


def svg(art, colours, title, bg=None, vb=None, extra_defs="", extra=""):
    """colours: {role: hex}. Layers sharing a colour are merged into a single path."""
    x0, y0, x1, y1 = vb or art.box
    w, h = round(x1 - x0, 2), round(y1 - y0, 2)
    merged = {}
    order = []
    for role, p in art.layers:
        c = colours[role]
        if c not in merged:
            merged[c] = G.path()
            order.append(c)
        # normalise so every file's viewBox starts at 0 0
        merged[c] = G.union(merged[c], G.moved(p, dx=-x0, dy=-y0))
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" role="img" aria-label="%s">'
           % (G.fmt(w), G.fmt(h), title)]
    out.append("<title>%s</title>" % title)
    if extra_defs:
        out.append(extra_defs)
    if bg:
        out.append('<rect width="%s" height="%s" fill="%s"/>' % (G.fmt(w), G.fmt(h), bg))
    for c in order:
        out.append('<path fill="%s" d="%s"/>' % (c, G.d(merged[c])))
    if extra:
        out.append(extra)
    out.append("</svg>")
    return "\n".join(out) + "\n"


def text_path(txt, font="serif", axes=None, size=100.0, x=0.0, y=0.0, **kw):
    p = G.path()
    glyphs, total = draw_text(p.getPen(), txt, font, axes, size, x, y, **kw)
    return G.simplify(p), glyphs, total


# =============================================================================
# Concept 1 — LUMEN: an M of two pillars and a falling wedge of light
# =============================================================================
class Lumen:
    slug = "lumen"
    name = "Lumen"
    S, GAP, KNEE = 22.0, 6.0, 48.0  # stem width at top, slit width, height where the slit stops
    SERIF = {"wght": 520, "opsz": 60}

    colourways = {
        "on-dark": {"ink": WHITE, "accent": TERRA},
        "on-light": {"ink": BLACK, "accent": TERRA},
        "black": {"ink": INK_BLACK, "accent": INK_BLACK},
        "white": {"ink": INK_WHITE, "accent": INK_WHITE},
    }

    def symbol(self):
        S, g, k = self.S, self.GAP, self.KNEE
        a = S + g
        slope = (50 - a) / 100.0
        kx = S + slope * k
        left = G.poly([(0, 0), (S, 0), (kx, k), (kx, 100), (0, 100)])
        right = G.poly([(100, 0), (100 - S, 0), (100 - kx, k), (100 - kx, 100), (100, 100)])
        wedge = G.poly([(a, 0), (100 - a, 0), (50, 100)])
        return Art([("ink", G.union(left, right)), ("accent", wedge)], (0, 0, 100, 100))

    def wordmark(self, size=100.0):
        ax = self.SERIF
        body, glyphs, total = text_path("Manuchıe", "serif", ax, size)
        # the dotless i is glyph 6: find its stem from a thin horizontal slice at half x-height
        xh, _, _ = text_path("x", "serif", ax, size)
        xheight = -G.bounds(xh)[1]
        gid, gx, adv = glyphs[6]
        i_only, _, _ = text_path("ı", "serif", ax, size, x=gx)
        sl = G.bounds(G.inter(i_only, G.rect(gx - size, -xheight * 0.55, adv + 2 * size, xheight * 0.1)))
        stem_l, stem_r = sl[0], sl[2]
        stem = stem_r - stem_l
        dotted, _, _ = text_path("i", "serif", ax, size, x=gx)
        i_top = G.bounds(i_only)[1]
        dot = G.bounds(G.inter(dotted, G.rect(gx - size, -2 * size, adv + 2 * size, 2 * size + i_top - 0.5)))
        # a small falling wedge replaces the round tittle: same weight as the dot, apex on the stem
        cx = (stem_l + stem_r) / 2
        w = (dot[2] - dot[0]) * 1.2
        h = w * 1.0
        top = dot[1] - 0.006 * size
        tittle = G.poly([(cx - w / 2, top), (cx + w / 2, top), (cx, top + h)])
        art = Art([("ink", body), ("accent", tittle)])
        xs = G.bounds(body)
        art.box = (xs[0], min(xs[1], top), xs[2], 0.0)  # baseline at y = 0; no descenders
        return art

    def lockup(self):
        wm = self.wordmark()
        hp, _, _ = text_path("h", "serif", self.SERIF, 100)
        asc = -G.bounds(hp)[1]
        H = asc * 1.0
        sym = self.symbol().placed(0, -H, H)
        gap = H * 0.42
        wm2 = Art([(r, G.moved(p, dx=H + gap - wm.box[0])) for r, p in wm.layers])
        top = min(-H, wm.box[1])
        return combine(sym, wm2, box=(0, top, H + gap + wm.w, 0.0))


# =============================================================================
# Concept 2 — MBIRA: an M of seven tuned keys under a bridge
# =============================================================================
class Mbira:
    slug = "mbira"
    name = "Mbira"
    LENGTHS = [100, 47, 75, 47, 100]
    SANS = {"wght": 500}

    colourways = {
        "on-dark": {"ink": WHITE, "accent": GOLD},
        "on-light": {"ink": BLACK, "accent": GOLD_DEEP},
        "black": {"ink": INK_BLACK, "accent": INK_BLACK},
        "white": {"ink": INK_WHITE, "accent": INK_WHITE},
    }

    def symbol(self, lengths=None, inset=4.0, ratio=0.55, by=13.0, bh=8.0, clear=3.0, stubs=True):
        """Five keys passing over the bridge. The outer keys are the M's stems; the inner three
        trace its V. stubs=False drops the short key ends above the bridge (small sizes)."""
        L = lengths or self.LENGTHS
        n = len(L)
        t = (100 - 2 * inset) / (n + (n - 1) * ratio)
        g = t * ratio
        keys = G.path()
        for i, ln in enumerate(L):
            x = inset + i * (t + g)
            keys = G.union(keys, G.rounded_rect(x, -t, t, ln + t, t * 0.28))  # square top, softened tip
        keys = G.inter(keys, G.rect(-1, 0, 102, 101))
        if not stubs:
            by = 0.0
            keys = G.diff(keys, G.rect(-1, -1, 102, bh + clear + 1))
        else:
            keys = G.diff(keys, G.rect(-1, by - clear, 102, bh + 2 * clear))
        bridge = G.rect(0, by, 100, bh)
        return Art([("ink", keys), ("accent", bridge)], (0, 0, 100, 100))

    def wordmark(self, size=100.0):
        body, glyphs, total = text_path("MANUCHIE", "sans", self.SANS, size, tracking=0.26)
        b = G.bounds(body)
        return Art([("ink", body)], (b[0], b[1], b[2], 0.0))

    def lockup(self):
        wm = self.wordmark()
        cap = -wm.box[1]
        H = cap * 1.9
        sym = self.symbol().placed(0, -(H + cap) / 2, H)
        gap = H * 0.5
        wm2 = Art([(r, G.moved(p, dx=H + gap - wm.box[0])) for r, p in wm.layers])
        return combine(sym, wm2, box=(0, -(H + cap) / 2, H + gap + wm.w, (H - cap) / 2))


# =============================================================================
# Concept 3 — HALLMARK: a maker's seal with the Great Zimbabwe chevron course
# =============================================================================
class Hallmark:
    slug = "hallmark"
    name = "Hallmark"
    SERIF = {"wght": 540, "opsz": 72}
    SEAL_TEXT = {"wght": 600, "opsz": 14}
    SOCIAL_FRAC = 0.66

    colourways = {
        "on-dark": {"ink": GOLD, "accent": GOLD, "core": WHITE},
        "on-light": {"ink": BLACK, "accent": TERRA, "core": BLACK},
        "black": {"ink": INK_BLACK, "accent": INK_BLACK, "core": INK_BLACK},
        "white": {"ink": INK_WHITE, "accent": INK_WHITE, "core": INK_WHITE},
    }

    def core(self, role="core", rule_role="accent", courses=True):
        """The M as a chevron course: a zigzag laid between two bands of stone, itself built
        of three courses (dry-stone joints) at large sizes."""
        sw = 15.5
        zig = G.polyline_stroke([(-7, 114), (25, -10), (50, 79), (75, -10), (107, 114)], sw)
        zig = G.inter(zig, G.rect(0, 9, 100, 82))
        if courses:
            for y in (36.3, 63.7):
                zig = G.diff(zig, G.rect(-1, y - 1.25, 102, 2.5))
        rules = G.union(G.rect(0, 0, 100, 4.5), G.rect(0, 95.5, 100, 4.5))
        return Art([(role, zig), (rule_role, rules)], (0, 0, 100, 100))

    def symbol(self):
        cx = cy = 50.0
        rings = G.union(G.ring(cx, cy, 50, 48.9), G.ring(cx, cy, 36.2, 35.2))
        txt = G.path()
        size = 6.0
        top_total = draw_text_on_circle(txt.getPen(), "EMMANUEL MANUCHIE CHIWANGA", cx, cy, 40.1, 0, size,
                                        "serif", self.SEAL_TEXT, tracking=0.17)
        bot_total = draw_text_on_circle(txt.getPen(), "PLAY SKILFULLY", cx, cy, 44.55, 180, size,
                                        "serif", self.SEAL_TEXT, bottom=True, tracking=0.22)
        self._sweeps = (math.degrees(top_total / 40.1), math.degrees(bot_total / 44.55))
        txt = G.simplify(txt)
        # diamonds midway in the gaps between the two lines of lettering
        a_top_end = self._sweeps[0] / 2
        a_bot_end = 180 - self._sweeps[1] / 2
        mid = (a_top_end + a_bot_end) / 2
        dia = G.path()
        for ang in (mid, -mid):
            a = math.radians(ang)
            r = 42.3
            px, py = cx + r * math.sin(a), cy - r * math.cos(a)
            dia = G.union(dia, G.poly([(px, py - 1.7), (px + 1.7, py), (px, py + 1.7), (px - 1.7, py)]))
        # the chevron frieze, running round like the wall of the Great Enclosure
        n = 44
        pts = []
        for i in range(2 * n):
            a = 2 * math.pi * i / (2 * n)
            rr = 33.6 if i % 2 == 0 else 31.0
            pts.append((cx + rr * math.sin(a), cy - rr * math.cos(a)))
        frieze = G.polyline_stroke(pts + [pts[0]], 0.95, closed=True)
        core = self.core().placed(cx - 17.5, cy - 17.5, 35)
        layers = [("ink", rings), ("ink", txt), ("accent", dia), ("accent", frieze)] + core.layers
        return Art(layers, (0, 0, 100, 100))

    def wordmark(self, size=100.0):
        body, glyphs, total = text_path("MANUCHIE", "serif", self.SERIF, size, tracking=0.16)
        b = G.bounds(body)
        return Art([("ink", body)], (b[0], b[1], b[2], 0.0))

    def lockup(self):
        wm = self.wordmark()
        cap = -wm.box[1]
        H = cap * 1.32
        sym = self.core(role="ink", rule_role="accent", courses=False).placed(0, -(H + cap) / 2, H)
        gap = H * 0.55
        wm2 = Art([(r, G.moved(p, dx=H + gap - wm.box[0])) for r, p in wm.layers])
        return combine(sym, wm2, box=(0, -(H + cap) / 2, H + gap + wm.w, (H - cap) / 2))


# =============================================================================
# Small sizes: hand-fitted to the pixel grid (16, 32, 48 px). Every vertical edge sits on a whole
# pixel; only true diagonals are left to anti-aliasing. Coordinates below are in pixels.
# =============================================================================
def lumen_px(ox, m, S, gap, knee_y, knee_x, bevel=True):
    """Lumen drawn in a box of side m at (ox, ox). knee_x = stem width below the knee."""
    a = S + gap
    o = ox
    if bevel:
        left = G.poly([(o, o), (o + S, o), (o + knee_x, o + knee_y), (o + knee_x, o + m), (o, o + m)])
        right = G.poly([(o + m, o), (o + m - S, o), (o + m - knee_x, o + knee_y), (o + m - knee_x, o + m), (o + m, o + m)])
    else:
        left = G.rect(o, o, S, m)
        right = G.rect(o + m - S, o, S, m)
    wedge = G.poly([(o + a, o), (o + m - a, o), (o + m / 2, o + m)])
    return [("ink", G.union(left, right)), ("accent", wedge)]


def lumen_icon(size, frac=0.5):
    if size == 16:
        return lumen_px(1, 14, 3, 1, 0, 3, bevel=False)
    if size == 32:
        return lumen_px(2, 28, 6, 2, 14, 9)
    if size == 48:
        return lumen_px(3, 42, 9, 3, 19, 13)
    m = size * frac
    s = m / 100
    o = (size - m) / 2
    return [(r, G.moved(p, dx=o, dy=o, s=s)) for r, p in Lumen().symbol().layers]


def mbira_px(x0, y0, kw, kg, bridge, keys_top, ends, stubs=None, tip=0.28):
    """keys of width kw / gap kg from x0; bridge=(y, h); ends = bottom y of each key."""
    keys = G.path()
    n = len(ends)
    width = n * kw + (n - 1) * kg
    for i, e in enumerate(ends):
        x = x0 + i * (kw + kg)
        keys = G.union(keys, G.rounded_rect(x, keys_top - kw, kw, e - keys_top + kw, kw * tip))
        if stubs:
            keys = G.union(keys, G.rect(x, stubs[0], kw, stubs[1] - stubs[0]))
    keys = G.inter(keys, G.rect(x0 - 1, stubs[0] if stubs else keys_top, width + 2, 200))
    by, bh = bridge
    br = G.rect(x0, by, width, bh)
    return [("ink", keys), ("accent", br)]


def mbira_icon(size, frac=0.54):
    if size == 16:
        return mbira_px(1, 0, 2, 1, (1, 2), 4, [15, 8, 12, 8, 15], tip=0)
    if size == 32:
        return mbira_px(2, 0, 4, 2, (2, 3), 7, [30, 15, 23, 15, 30], tip=0)
    if size == 48:
        return mbira_px(3, 0, 6, 3, (10, 4), 16, [45, 25, 36, 25, 45], stubs=(3, 8), tip=0.25)
    m = size * frac
    s = m / 100
    o = (size - m) / 2
    return [(r, G.moved(p, dx=o, dy=o, s=s)) for r, p in Mbira().symbol().layers]


def hallmark_icon(size, frac=0.5):
    h = Hallmark()
    if size in (32, 48):
        o, m, rh, gap = {32: (2, 28, 2, 2), 48: (3, 42, 2, 3)}[size]
        zig = G.polyline_stroke([(-7, 114), (25, -10), (50, 79), (75, -10), (107, 114)], 15.5 * 1.08)
        top, bot = o + rh + gap, o + m - rh - gap
        s = m / 100
        zig = G.moved(zig, dx=o, dy=0, s=s)
        # stretch the zig band vertically to fill between the rules
        zig = G.mapped(zig, lambda x, y: (x, top + (y - 9 * s) * (bot - top) / (82 * s)))
        zig = G.inter(zig, G.rect(o, top, m, bot - top))
        rules = G.union(G.rect(o, o, m, rh), G.rect(o, o + m - rh, m, rh))
        return [("ink", zig), ("accent", rules)]
    m = size * frac
    o = (size - m) / 2
    return [(r, G.moved(p, dx=o, dy=o, s=m / 100)) for r, p in h.core(role="ink").layers]


# 16 px masters drawn by hand, one character per pixel: '#' ink, 'o' accent, 'h' accent at half
# strength (pre-blended over the tile), '.' tile. Mbira needs no override: its 16 px vector
# already lands on whole pixels.
PIXELS_16 = {
    "lumen": [
        "................",
        ".###.oooooo.###.",
        ".###.hooooh.###.",
        ".###.hooooh.###.",
        ".###..oooo..###.",
        ".###..oooo..###.",
        ".###..oooo..###.",
        ".###..hooh..###.",
        ".###..hooh..###.",
        ".###...oo...###.",
        ".###...oo...###.",
        ".###...oo...###.",
        ".###...hh...###.",
        ".###...hh...###.",
        ".###........###.",
        "................",
    ],
    "hallmark": [
        "................",
        ".oooooooooooooo.",
        "................",
        "..####....####..",
        "..####....####..",
        "..##.##..##.##..",
        "..##.##..##.##..",
        "..##..####..##..",
        ".##...####...##.",
        ".##....##....##.",
        ".##....##....##.",
        ".##..........##.",
        ".##..........##.",
        "................",
        ".oooooooooooooo.",
        "................",
    ],
}


def pixel_art(rows, colours, tile):
    out = {}
    for y, row in enumerate(rows):
        assert len(row) == 16, (y, row)
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            col = {"#": colours["ink"], "o": colours["accent"],
                   "h": _mix(colours["accent"], tile, 0.5), "+": _mix(colours["ink"], tile, 0.5)}[ch]
            out.setdefault(col, G.path())
            out[col] = G.union(out[col], G.rect(x, y, 1, 1))
    return out


ICONS = {"lumen": lumen_icon, "mbira": mbira_icon, "hallmark": hallmark_icon}


def _mix(fg, bg, t):
    f = [int(fg[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(bg[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02x%02x%02x" % tuple(round(b[i] + (f[i] - b[i]) * t) for i in range(3))


def pixel_hint(layers, size, colours, tile, levels=(0.3, 0.7)):
    """Hint vector artwork to whole pixels: measure each pixel's exact coverage per layer, then
    snap it to empty / half / full. Half pixels are pre-blended over the tile colour, so the
    result is a handful of opaque squares that rasterise identically everywhere."""
    lo, hi = levels
    out = {}
    for role, p in layers:
        col = colours[role]
        for y in range(size):
            for x in range(size):
                c = abs(G.inter(p, G.rect(x, y, 1, 1)).area)
                if c < lo:
                    continue
                key = col if c >= hi else _mix(col, tile, 0.5)
                out.setdefault(key, G.path())
                out[key] = G.union(out[key], G.rect(x, y, 1, 1))
    return out


def icon_parts(slug, size, colours, tile=BLACK, radius=None, hint=None, frac=None):
    """[(fill, path, crisp)] for a square icon on a near-black tile (radius None = full-bleed).
    16 px uses the hand-drawn pixel masters; frac = symbol share of the tile at large sizes."""
    layers = ICONS[slug](size) if frac is None else ICONS[slug](size, frac)
    if hint is None:
        hint = size <= 16
    parts = []
    if tile:
        shape = G.rounded_rect(0, 0, size, size, radius) if radius else G.rect(0, 0, size, size)
        parts.append((tile, shape, False))
    if size == 16 and slug in PIXELS_16:
        parts += [(c, p, True) for c, p in pixel_art(PIXELS_16[slug], colours, tile or BLACK).items()]
    elif hint:
        parts += [(c, p, True) for c, p in pixel_hint(layers, size, colours, tile or BLACK).items()]
    else:
        merged, order = {}, []
        for role, p in layers:
            c = colours[role]
            if c not in merged:
                merged[c] = G.path()
                order.append(c)
            merged[c] = G.union(merged[c], p)
        parts += [(c, merged[c], False) for c in order]
    return parts


def icon_svg(slug, size, colours, tile=BLACK, radius=None, title="Manuchie", hint=None, frac=None):
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" role="img" aria-label="%s">' % (size, size, title),
           "<title>%s</title>" % title]
    for c, p, crisp in icon_parts(slug, size, colours, tile, radius, hint, frac):
        out.append('<path fill="%s"%s d="%s"/>' % (c, ' shape-rendering="crispEdges"' if crisp else "", G.d(p)))
    out.append("</svg>")
    return "\n".join(out) + "\n"


def board_svg(c, index):
    """A 1600 x 1000 preview board: symbol + lockup on dark and on light, and the 16/32/48 px
    icons at actual size and at 4x."""
    W, H, split, strip = 1600, 1000, 800, 800
    parts = [(BLACK, G.rect(0, 0, split, strip), False), (WHITE, G.rect(split, 0, W - split, strip), False),
             (CHARCOAL, G.rect(0, strip, W, H - strip), False)]
    for x0, cwn in ((0, "on-dark"), (split, "on-light")):
        cols = c.colourways[cwn]
        sym = c.symbol()
        sh = 300
        sp = sym.placed(x0 + (split - sh * sym.w / sym.h) / 2, 150, sh)
        parts += [(cols[r], p, False) for r, p in sp.layers]
        lk = c.lockup()
        lh = 64
        lw = lh * lk.w / lk.h
        if lw > split - 160:
            lh = (split - 160) * lk.h / lk.w
            lw = split - 160
        lp = lk.placed(x0 + (split - lw) / 2, 560 + (64 - lh) / 2, lh)
        parts += [(cols[r], p, False) for r, p in lp.layers]
    # labels, outlined Inter
    lab, _, _ = text_path("%02d  %s" % (index, c.name.upper()), "sans", {"wght": 600}, 15, x=40, y=56, tracking=0.2)
    parts.append(("#8a8b90", lab, False))
    if c.slug == CHOSEN:
        rec, _, _ = text_path("CHOSEN", "sans", {"wght": 600}, 15, x=split + 40, y=56, tracking=0.2)
        parts.append((TERRA, rec, False))
    dark = c.colourways["on-dark"]
    x = 60
    cy = strip + (H - strip) / 2
    for size, mag in ((16, 6), (32, 3), (48, 2)):
        for scale in (1, mag):
            for col, p, crisp in icon_parts(c.slug, size, dark, radius=size / 8):
                parts.append((col, G.moved(p, dx=x, dy=cy - size * scale / 2, s=scale), crisp))
            x += size * scale + (24 if scale == 1 else 64)
    cap, _, _ = text_path("16 / 32 / 48 PX \u2014 ACTUAL SIZE, THEN ENLARGED", "sans", {"wght": 600}, 13,
                          x=x + 10, y=cy + 5, tracking=0.18)
    parts.append(("#8a8b90", cap, False))
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" role="img" aria-label="Manuchie identity: %s">' % (W, H, c.name),
           "<title>Manuchie identity — concept %02d, %s</title>" % (index, c.name)]
    for col, p, crisp in parts:
        out.append('<path fill="%s"%s d="%s"/>' % (col, ' shape-rendering="crispEdges"' if crisp else "", G.d(p)))
    out.append("</svg>")
    return "\n".join(out) + "\n"


CONCEPTS = {c.slug: c for c in (Lumen, Mbira, Hallmark)}
ORDER = ["lumen", "mbira", "hallmark"]


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def favicon_svg(c, force=None):
    """Vector favicon on the 32 px grid (crisp at 16 and 32), transparent, following the
    browser's light/dark theme. force='light'/'dark' writes a fixed-colour copy for previews."""
    slug = c.slug
    layers = ICONS[slug](32)
    light = c.colourways["on-light"]
    dark = c.colourways["on-dark"]
    merged, order = {}, []
    for role, p in layers:
        merged.setdefault(role, G.path())
        if role not in order:
            order.append(role)
        merged[role] = G.union(merged[role], p)
    css = ["path.%s{fill:%s}" % (r, light[r]) for r in order]
    css_dark = ["path.%s{fill:%s}" % (r, dark[r]) for r in order]
    if force:
        style = "".join(css if force == "light" else css_dark)
    else:
        style = "%s@media (prefers-color-scheme:dark){%s}" % ("".join(css), "".join(css_dark))
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">', "<style>%s</style>" % style]
    for r in order:
        out.append('<path class="%s" d="%s"/>' % (r, G.d(merged[r])))
    out.append("</svg>")
    return "\n".join(out) + "\n"


def social_svg(c, frac=None):
    """1080 x 1080 profile image: the symbol on near-black under a low terracotta glow, everything
    important inside the central circle so any round crop is safe."""
    art = c.symbol()
    frac = frac or getattr(c, "SOCIAL_FRAC", 0.44)
    m = 1080 * frac
    placed = art.placed((1080 - m) / 2, (1080 - m) / 2 + 1080 * 0.015, m)
    defs = ('<defs><radialGradient id="glow" cx="540" cy="-140" r="1020" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="%s"/><stop offset=".32" stop-color="#6a2a12"/>'
            '<stop offset=".58" stop-color="#2a130c"/><stop offset=".86" stop-color="%s"/></radialGradient></defs>'
            % (TERRA, BLACK))
    s = svg(placed, c.colourways["on-dark"], "Manuchie", vb=(0, 0, 1080, 1080), extra_defs=defs)
    s = s.replace(defs, defs + '\n<rect width="1080" height="1080" fill="%s"/><rect width="1080" height="1080" fill="url(#glow)"/>' % BLACK, 1)
    return s


def concept_files(c):
    """Proposal-level masters: on-light colourway so they show on any default (white) canvas."""
    d = os.path.join(BRAND, "concepts", c.slug)
    cw = c.colourways["on-light"]
    write(os.path.join(d, "symbol.svg"), svg(c.symbol(), cw, "Manuchie — %s symbol" % c.name))
    write(os.path.join(d, "wordmark.svg"), svg(c.wordmark(), cw, "Manuchie"))
    write(os.path.join(d, "lockup.svg"), svg(c.lockup(), cw, "Manuchie"))
    dark = c.colourways["on-dark"]
    write(os.path.join(d, "wordmark-on-dark.svg"), svg(c.wordmark(), dark, "Manuchie"))
    write(os.path.join(d, "symbol-on-dark.svg"), svg(c.symbol(), dark, "Manuchie — %s symbol" % c.name))
    write(os.path.join(d, "lockup-on-dark.svg"), svg(c.lockup(), dark, "Manuchie"))
    if hasattr(c, "core"):
        write(os.path.join(d, "core.svg"), svg(c.core(role="ink"), cw, "Manuchie — %s core mark" % c.name))
    for size in (16, 32, 48):
        write(os.path.join(d, "icons", "icon-%d.svg" % size), icon_svg(c.slug, size, dark, radius=size / 8))
    write(os.path.join(d, "icons", "favicon.svg"), favicon_svg(c))
    for mode in ("light", "dark"):
        write(os.path.join(d, "icons", "favicon-%s.svg" % mode), favicon_svg(c, force=mode))
    write(os.path.join(d, "social-1080.svg"), social_svg(c))
    write(os.path.join(d, "preview-board.svg"), board_svg(c, ORDER.index(c.slug) + 1))


def package(c):
    """The production set for one concept: every lockup in four colourways, favicon sources,
    app icons and the social image."""
    sv = os.path.join(BRAND, "package", "svg")
    arts = {"wordmark": c.wordmark(), "symbol": c.symbol(), "lockup": c.lockup()}
    for kind, art in arts.items():
        title = "Manuchie" if kind != "symbol" else "Manuchie symbol"
        for cw_name, cols in c.colourways.items():
            write(os.path.join(sv, "%s-%s.svg" % (kind, cw_name)), svg(art, cols, title))
    if hasattr(c, "core"):
        # the mark used on its own: coursed (with dry-stone joints) for large sizes, solid below
        for cw_name, cols in c.colourways.items():
            write(os.path.join(sv, "mark-%s.svg" % cw_name), svg(c.core(role="ink"), cols, "Manuchie mark"))
            write(os.path.join(sv, "mark-solid-%s.svg" % cw_name), svg(c.core(role="ink", courses=False), cols, "Manuchie mark"))
    else:
        for cw_name in c.colourways:
            for stale in ("mark-%s.svg" % cw_name, "mark-solid-%s.svg" % cw_name):
                if os.path.exists(os.path.join(sv, stale)):
                    os.remove(os.path.join(sv, stale))
    dark = c.colourways["on-dark"]
    write(os.path.join(sv, "favicon.svg"), favicon_svg(c))
    write(os.path.join(sv, "social-1080.svg"), social_svg(c))
    ic = os.path.join(sv, "icons")
    for size in (16, 32, 48):
        write(os.path.join(ic, "icon-%d.svg" % size), icon_svg(c.slug, size, dark, radius=size / 8))
    write(os.path.join(ic, "icon-180.svg"), icon_svg(c.slug, 180, dark))                    # iOS masks it
    write(os.path.join(ic, "icon-192.svg"), icon_svg(c.slug, 192, dark, radius=192 * 0.2))
    write(os.path.join(ic, "icon-512.svg"), icon_svg(c.slug, 512, dark, radius=512 * 0.2))
    write(os.path.join(ic, "icon-1080.svg"), icon_svg(c.slug, 1080, dark))
    write(os.path.join(ic, "maskable-512.svg"), icon_svg(c.slug, 512, dark, frac=0.42))       # inside the 80 % safe circle
    with open(os.path.join(BRAND, "package", ".concept"), "w") as f:
        f.write(c.slug + "\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    current = os.path.join(BRAND, "package", ".concept")
    default = open(current).read().strip() if os.path.exists(current) else CHOSEN
    ap.add_argument("--package", default=default if default in CONCEPTS else CHOSEN, choices=sorted(CONCEPTS))
    ap.add_argument("--concepts-only", action="store_true")
    args = ap.parse_args()
    for cls in CONCEPTS.values():
        concept_files(cls())
    print("concepts written")
    if not args.concepts_only:
        package(CONCEPTS[args.package]())
        print("package written for", args.package)
