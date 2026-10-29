"""Outline text from the site's own variable fonts (Newsreader, Inter) as vector paths.

Design-time helper for generate.py only. The published SVGs contain plain <path> outlines, so
nothing here is needed to *use* the logos. Needs fontTools, brotli, uharfbuzz and skia-pathops.
Both fonts are SIL Open Font License 1.1, which allows outlining them into a logo.
"""
import io
import math
import os

import uharfbuzz as hb
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.normpath(os.path.join(HERE, "..", "..", "assets", "fonts"))
FILES = {
    "serif": "newsreader-v26-cY9AfjOCX1hbuyalUrK4397yjIJFJpc.woff2",   # Newsreader roman (latin)
    "sans": "inter-v20-UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2",  # Inter (latin)
}
_faces = {}


def _face(name):
    if name not in _faces:
        tt = TTFont(os.path.join(FONTS, FILES[name]))
        tt.flavor = None
        buf = io.BytesIO()
        tt.save(buf)
        _faces[name] = (hb.Face(buf.getvalue()), tt["head"].unitsPerEm)
    return _faces[name]


class MapPen:
    """Pen filter: maps every point through fn(x, y) before passing it on."""

    def __init__(self, out, fn):
        self.out, self.fn = out, fn

    def moveTo(self, p):
        self.out.moveTo(self.fn(*p))

    def lineTo(self, p):
        self.out.lineTo(self.fn(*p))

    def curveTo(self, *pts):
        self.out.curveTo(*[self.fn(*p) for p in pts])

    def qCurveTo(self, *pts):
        self.out.qCurveTo(*[None if p is None else self.fn(*p) for p in pts])

    def closePath(self):
        self.out.closePath()

    def endPath(self):
        self.out.endPath()


def layout(txt, font="serif", axes=None, size=100.0, tracking=0.0, kern=True, adjust=None):
    """Shape txt; return (hb_font, scale, [(gid, x, advance)], total_advance) in output units.

    tracking is in em; adjust maps glyph index -> extra em added before that glyph."""
    face, upem = _face(font)
    f = hb.Font(face)
    if axes:
        f.set_variations(axes)
    buf = hb.Buffer()
    buf.add_str(txt)
    buf.guess_segment_properties()
    hb.shape(f, buf, {"kern": kern, "liga": False})
    s = size / upem
    out, cx = [], 0.0
    n = len(buf.glyph_infos)
    for i, (inf, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
        if adjust and i in adjust:
            cx += adjust[i] * size
        out.append((inf.codepoint, cx + pos.x_offset * s, pos.x_advance * s))
        cx += pos.x_advance * s
        if i < n - 1:
            cx += tracking * size
    return f, s, out, cx


def draw_text(pen, txt, font="serif", axes=None, size=100.0, x=0.0, y=0.0, **kw):
    """Draw txt with its baseline at (x, y) in y-down (SVG) space. Returns the glyph layout."""
    f, s, glyphs, total = layout(txt, font, axes, size, **kw)
    for gid, gx, adv in glyphs:
        f.draw_glyph_with_pen(gid, MapPen(pen, lambda px, py, gx=gx: (x + gx + px * s, y - py * s)))
    return glyphs, total


def draw_text_on_circle(pen, txt, cx, cy, r, centre_deg, size, font="serif", axes=None,
                        bottom=False, **kw):
    """Bend txt round a circle. Top text reads clockwise with its baseline on radius r; bottom
    text reads left-to-right along the lower arc with its baseline on r (letters point inward).
    Angles: 0 = 12 o'clock, clockwise."""
    f, s, glyphs, total = layout(txt, font, axes, size, **kw)
    sweep = total / r
    for gid, gx, adv in glyphs:
        if not bottom:
            a0 = math.radians(centre_deg) - sweep / 2

            def fn(px, py, gx=gx):
                ang = a0 + (gx + px * s) / r
                rr = r + py * s
                return (cx + rr * math.sin(ang), cy - rr * math.cos(ang))
        else:
            a0 = math.radians(centre_deg) + sweep / 2

            def fn(px, py, gx=gx):
                ang = a0 - (gx + px * s) / r
                rr = r - py * s
                return (cx + rr * math.sin(ang), cy - rr * math.cos(ang))
        f.draw_glyph_with_pen(gid, MapPen(pen, fn))
    return total
