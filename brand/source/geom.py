"""Small vector toolkit on top of skia-pathops: shapes, booleans and clean SVG path output."""
import math

import pathops
from fontTools.pens.svgPathPen import SVGPathPen

from typeset import MapPen

K = 0.5522847498  # cubic circle constant


def _num(v):
    s = ("%.2f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def path():
    return pathops.Path()


def poly(pts):
    p = pathops.Path()
    p.moveTo(*pts[0])
    for q in pts[1:]:
        p.lineTo(*q)
    p.close()
    return p


def rect(x, y, w, h):
    return poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)])


def circle(cx, cy, r):
    p = pathops.Path()
    k = K * r
    p.moveTo(cx, cy - r)
    p.cubicTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    p.cubicTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    p.cubicTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    p.cubicTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    p.close()
    return p


def rounded_rect(x, y, w, h, r):
    r = min(r, w / 2, h / 2)
    k = K * r
    p = pathops.Path()
    p.moveTo(x + r, y)
    p.lineTo(x + w - r, y)
    p.cubicTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r)
    p.lineTo(x + w, y + h - r)
    p.cubicTo(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h)
    p.lineTo(x + r, y + h)
    p.cubicTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r)
    p.lineTo(x, y + r)
    p.cubicTo(x, y + r - k, x + r - k, y, x + r, y)
    p.close()
    return p


def tine(x, y, w, h):
    """A bar with a square top and a semicircular bottom end (an mbira key)."""
    r = w / 2
    k = K * r
    p = pathops.Path()
    p.moveTo(x, y)
    p.lineTo(x + w, y)
    p.lineTo(x + w, y + h - r)
    p.cubicTo(x + w, y + h - r + k, x + r + k, y + h, x + r, y + h)
    p.cubicTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r)
    p.close()
    return p


def ring(cx, cy, r_out, r_in):
    return diff(circle(cx, cy, r_out), circle(cx, cy, r_in))


def polyline_stroke(pts, width, closed=False, miter=10):
    p = pathops.Path()
    p.moveTo(*pts[0])
    for q in pts[1:]:
        p.lineTo(*q)
    if closed:
        p.close()
    p.stroke(width, pathops.LineCap.BUTT_CAP, pathops.LineJoin.MITER_JOIN, miter)
    return simplify(p)


def simplify(p):
    q = pathops.Path(p)
    q.simplify()
    return q


def union(*paths):
    out = pathops.Path()
    for p in paths:
        if p is None:
            continue
        out = pathops.op(out, p, pathops.PathOp.UNION)
    return out


def diff(a, b):
    return pathops.op(a, b, pathops.PathOp.DIFFERENCE)


def inter(a, b):
    return pathops.op(a, b, pathops.PathOp.INTERSECTION)


def mapped(p, fn):
    out = pathops.Path()
    p.draw(MapPen(out.getPen(), fn))
    return out


def moved(p, dx=0.0, dy=0.0, s=1.0, ox=0.0, oy=0.0):
    """Scale about (ox, oy) by s, then translate by (dx, dy)."""
    return mapped(p, lambda x, y: (ox + (x - ox) * s + dx, oy + (y - oy) * s + dy))


def bounds(p):
    return p.bounds  # (xmin, ymin, xmax, ymax)


def d(p):
    pen = SVGPathPen(None, ntos=_num)
    p.draw(pen)
    return pen.getCommands()


def fmt(v):
    return _num(v)
