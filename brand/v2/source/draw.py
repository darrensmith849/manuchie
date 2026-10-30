"""Vector drawing for the v2 symbol proposals (pathops-based; no rasters, no text).

The figure outlines were drawn point by point over Manuchie's own press photos
(assets/IMG_2416.PNG, the terracotta profile portrait) and then simplified; the photo itself is
never embedded anywhere.
"""
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "..", "source")))

import pathops  # noqa: E402
import geom as G  # noqa: E402
from fontTools.svgLib.path import parse_path  # noqa: E402

GOLD = "#c8a15a"
GOLD_HI = "#f3d79a"
GOLD_CORE = "#fff4dc"
GOLD_DEEP = "#9a7432"
BLACK = "#0a0a0b"
CHARCOAL = "#141416"
WHITE = "#f7f3ec"
PAPER = "#f3f0ea"


# ------------------------------------------------------------------ curve helpers
def _cr(P, n):
    out = []
    Q = [P[0]] + list(P) + [P[-1]]
    for i in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    out.append(P[-1])
    return out


def catmull(pts, closed=False):
    """Smooth Catmull-Rom curve through pts, as cubic Beziers."""
    p = pathops.Path()
    P = list(pts)
    P = ([P[-1]] + P + [P[0], P[1]]) if closed else ([P[0]] + P + [P[-1]])
    p.moveTo(*P[1])
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        p.cubicTo(c1[0], c1[1], c2[0], c2[1], p2[0], p2[1])
    if closed:
        p.close()
    return p


def shape(pts):
    p = catmull(pts, closed=True)
    p.simplify()
    return p


def stroke(path, w, cap="round"):
    q = pathops.Path(path)
    caps = {"round": pathops.LineCap.ROUND_CAP, "butt": pathops.LineCap.BUTT_CAP}
    q.stroke(w, caps[cap], pathops.LineJoin.ROUND_JOIN, 4)
    q.convertConicsToQuads()
    q.simplify()
    return q


def line(pts, w, cap="round"):
    return stroke(catmull(pts), w, cap)


def tapered(pts, w0, w1, n=14):
    """Filled band along a smooth curve, width w0 -> w1."""
    S = _cr(pts, n)
    N = len(S)
    L, R = [], []
    for i, (x, y) in enumerate(S):
        a, b = S[max(i - 1, 0)], S[min(i + 1, N - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        d = math.hypot(dx, dy) or 1
        nx, ny = -dy / d, dx / d
        w = w0 + (w1 - w0) * i / (N - 1)
        L.append((x + nx * w / 2, y + ny * w / 2))
        R.append((x - nx * w / 2, y - ny * w / 2))
    p = G.poly(L + R[::-1])
    p.simplify()
    return p


def rot(p, deg, cx=0.0, cy=0.0):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return G.mapped(p, lambda x, y: (cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c))


def fit(p, s, ox, oy, cx=0.0, cy=0.0):
    return G.mapped(p, lambda x, y: ((x - cx) * s + ox, (y - cy) * s + oy))


# ------------------------------------------------------------------ gold light
def burst(cx, cy, R, uid, n=30, seed=7, intensity=1.0, rays=True):
    """Soft radial glow with fine, alternating rays (gradients only, no blur filters)."""
    rnd = random.Random(seed)
    k = intensity
    defs = (f'<radialGradient id="{uid}g" cx="{cx:.1f}" cy="{cy:.1f}" r="{R:.1f}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{GOLD_CORE}" stop-opacity="{min(1, k):.2f}"/>'
            f'<stop offset=".12" stop-color="{GOLD_HI}" stop-opacity="{.9 * k:.2f}"/>'
            f'<stop offset=".38" stop-color="{GOLD}" stop-opacity="{.42 * k:.2f}"/>'
            f'<stop offset=".7" stop-color="{GOLD}" stop-opacity="{.12 * k:.2f}"/>'
            f'<stop offset="1" stop-color="{GOLD}" stop-opacity="0"/></radialGradient>'
            f'<radialGradient id="{uid}r" cx="{cx:.1f}" cy="{cy:.1f}" r="{R:.1f}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{GOLD_HI}" stop-opacity="{.95 * k:.2f}"/>'
            f'<stop offset=".35" stop-color="{GOLD}" stop-opacity="{.55 * k:.2f}"/>'
            f'<stop offset="1" stop-color="{GOLD}" stop-opacity="0"/></radialGradient>')
    frag = f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{R:.1f}" fill="url(#{uid}g)"/>'
    if rays:
        p = G.path()
        for i in range(n):
            a = 2 * math.pi * i / n + rnd.uniform(-0.06, 0.06)
            L = R * (1.0 if i % 2 == 0 else 0.62) * rnd.uniform(0.7, 1.0)
            w = R * 0.055 * rnd.uniform(0.6, 1.1)
            ux, uy = math.cos(a), math.sin(a)
            nx, ny = -uy, ux
            r0 = R * 0.08
            p = G.union(p, G.poly([(cx + ux * r0 + nx * w / 2, cy + uy * r0 + ny * w / 2), (cx + ux * L, cy + uy * L),
                                   (cx + ux * r0 - nx * w / 2, cy + uy * r0 - ny * w / 2)]))
        frag += f'<path fill="url(#{uid}r)" d="{G.d(p)}"/>'
    return defs, frag


def arc_shape(cx, cy, r, thick, a0, a1, peak=0.5, w_end=0.0):
    """A hairline arc that swells to `thick` and tapers to points (degrees, clockwise from 3 o'clock)."""
    N = 160
    L, R = [], []
    for k in range(N + 1):
        t = k / N
        a = math.radians(a0 + (a1 - a0) * t)
        f = (t / peak) if t < peak else ((1 - t) / (1 - peak))
        w = w_end + (thick - w_end) * math.sin(f * math.pi / 2) ** 1.2
        x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
        L.append((x + math.cos(a) * w / 2, y + math.sin(a) * w / 2))
        R.append((x - math.cos(a) * w / 2, y - math.sin(a) * w / 2))
    p = G.poly(L + R[::-1])
    p.simplify()
    return p


def arc(cx, cy, r, thick, a0, a1, uid, peak=0.5, colour=GOLD, hi=GOLD_HI):
    p = arc_shape(cx, cy, r, thick, a0, a1, peak)
    x0, y0 = cx + math.cos(math.radians(a0)) * r, cy + math.sin(math.radians(a0)) * r
    x1, y1 = cx + math.cos(math.radians(a1)) * r, cy + math.sin(math.radians(a1)) * r
    defs = (f'<linearGradient id="{uid}" x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{colour}" stop-opacity="0"/><stop offset=".4" stop-color="{colour}"/>'
            f'<stop offset="1" stop-color="{hi}"/></linearGradient>')
    return defs, f'<path fill="url(#{uid})" d="{G.d(p)}"/>'


def beams(src, angles, length, widths, uid, colour=GOLD, hi=GOLD_HI, strength=1.0):
    """Shafts of light from a source outside the frame, widening as they fall (worship rays)."""
    sx, sy = src
    defs = (f'<radialGradient id="{uid}" cx="{sx:.1f}" cy="{sy:.1f}" r="{length:.1f}" gradientUnits="userSpaceOnUse">'
            f'<stop offset="0" stop-color="{hi}" stop-opacity="{.95 * strength:.2f}"/>'
            f'<stop offset=".55" stop-color="{colour}" stop-opacity="{.55 * strength:.2f}"/>'
            f'<stop offset="1" stop-color="{colour}" stop-opacity="0"/></radialGradient>')
    p = G.path()
    for a, (w0, w1) in zip(angles, widths):
        r = math.radians(a)
        ux, uy = math.cos(r), math.sin(r)
        nx, ny = -uy, ux
        p = G.union(p, G.poly([(sx + nx * w0 / 2, sy + ny * w0 / 2), (sx + ux * length + nx * w1 / 2, sy + uy * length + ny * w1 / 2),
                               (sx + ux * length - nx * w1 / 2, sy + uy * length - ny * w1 / 2), (sx - nx * w0 / 2, sy - ny * w0 / 2)]))
    return defs, f'<path fill="url(#{uid})" d="{G.d(p)}"/>', p


# ------------------------------------------------------------------ the profile (IMG_2416)
# Points in the photo's own pixel coordinates (1320 x 1752), drawn over the portrait.
HAIR_TOP = [(470, 654), (471, 610), (489, 566), (516, 522), (548, 482), (584, 452), (628, 434), (672, 424), (716, 417),
            (764, 419), (810, 428), (852, 447), (892, 468), (922, 503), (936, 548), (941, 592)]
FRONT = [
    (941, 592), (956, 617), (968, 650), (978, 690), (988, 722), (998, 749),                   # forehead
    (1042, 751), (1063, 760), (1066, 784), (1059, 810), (1046, 834), (1020, 855), (998, 868),  # sunglasses
    (1001, 890), (1004, 906), (992, 922), (978, 935), (986, 955), (995, 973), (983, 991), (990, 1008), (979, 1030),  # nose, lips
    (973, 1075), (960, 1122), (935, 1165), (898, 1196), (852, 1214), (812, 1218),             # beard
    (790, 1232), (786, 1262), (800, 1310), (830, 1380), (850, 1460), (300, 1460), (330, 1080),  # throat, chest (cut later)
    (400, 1012), (450, 975), (478, 940), (492, 900), (498, 850), (500, 792), (490, 740), (478, 700), (470, 654),  # nape, back
]
HAIR = [(380, 380), (1000, 380), (1000, 588), (950, 588), (880, 590), (815, 594), (764, 600), (790, 688),
        (720, 706), (640, 722), (560, 738), (470, 760), (380, 770)]                           # line-up with its temple notch
BEARD = [(636, 800), (660, 850), (705, 896), (780, 938), (850, 958), (912, 963), (948, 972), (1010, 960), (1020, 1100),
         (1000, 1240), (800, 1226), (736, 1170), (680, 1080), (646, 980), (630, 880)]
LIPS = [(958, 980), (982, 975), (994, 973), (986, 990), (991, 1006), (972, 1006)]
LENS = [(860, 772), (960, 764), (1040, 765), (1052, 790), (1042, 824), (1010, 842), (950, 852), (882, 844)]
ARM = [(588, 760), (680, 765), (790, 773), (868, 782)]
EAR = [(604, 766), (556, 768), (524, 812), (530, 866), (572, 900)]
CHAIN = [(482, 940), (536, 1012), (604, 1098), (682, 1186), (752, 1258)]
LINEUP = [[(958, 586), (880, 588), (815, 593), (764, 600)], [(764, 600), (777, 645), (790, 688)]]


def _textured(points, amp=5.0, period=34.0):
    """The high top's curl: a gentle scallop along the hair dome, fading out at both ends."""
    pts = _cr(points, 20)
    out, s = [], 0.0
    for i, (x, y) in enumerate(pts):
        if i:
            s += math.hypot(x - pts[i - 1][0], y - pts[i - 1][1])
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        d = math.hypot(dx, dy) or 1
        e = min(1.0, i / 25, (len(pts) - 1 - i) / 25)
        bump = amp * e * (0.5 - 0.5 * math.cos(2 * math.pi * s / period))
        out.append((x + dy / d * bump, y - dx / d * bump))
    return out


def head_outline(texture=True):
    body = shape(HAIR_TOP + FRONT[1:])
    if texture:
        dome = G.poly([(460, 380), (950, 380), (950, 600), (470, 660)])
        tex = G.poly(_textured(HAIR_TOP) + [(941, 700), (470, 700)])
        body = G.union(G.diff(body, dome), G.inter(tex, dome))
    return body


def glasses():
    return G.union(shape(LENS), tapered(ARM, 14, 30))


def lineup(w):
    return G.union(line(LINEUP[0], w), line(LINEUP[1], w))


def chain_band():
    band = tapered(CHAIN, 15, 24)
    cuts = G.path()
    S = _cr(CHAIN, 30)
    for k in range(1, 15):
        i = int(k / 15 * (len(S) - 1))
        (x, y), (x2, y2) = S[i], S[min(i + 1, len(S) - 1)]
        d = math.hypot(x2 - x, y2 - y) or 1
        dx, dy = (x2 - x) / d, (y2 - y) / d
        sk = 0.5 if k % 2 else -0.5
        ex, ey = -dy + dx * sk, dx + dy * sk
        cuts = G.union(cuts, line([(x - ex * 20, y - ey * 20), (x + ex * 20, y + ey * 20)], 3.2, cap="butt"))
    return G.diff(band, cuts)


NECK_CLIP = [(380, 300), (1200, 300), (1200, 1320), (600, 1320), (520, 1120), (486, 960), (440, 760)]


def profile_parts(trunc=(640, 640, 690), chain=True, clip=None, bold=0.0, ear_line=True):
    """Tonal parts of the profile bust: skin, hair (with its fade), beard + ear, chain."""
    out = G.inter(head_outline(), G.circle(*trunc))
    if clip:
        out = G.inter(out, shape(clip))
    gl = glasses()
    if bold:
        gl = G.union(gl, stroke(gl, bold))
    out = G.diff(out, gl)
    hair = G.inter(out, shape(HAIR))
    beard = G.diff(G.inter(out, shape(BEARD)), shape(LIPS))
    skin = G.diff(G.diff(out, hair), beard)
    ear = G.inter(line(EAR, 9), skin) if ear_line else G.path()
    skin = G.diff(skin, ear)
    ch = None
    if chain:
        ch = G.inter(chain_band(), out)
        skin = G.diff(skin, line(CHAIN, 32))
    return dict(skin=skin, hair=hair, tone=G.union(beard, ear), chain=ch)


def profile_single(cut=True, with_lineup=False, bold=0.0, ear=False):
    """The profile as one white form with the sunglasses cut out (the 'Lifted' concept and the
    small sizes). cut = head and upper neck only, finished with a smooth convex truncation.
    bold > 0 thickens the sunglasses so they survive at favicon sizes."""
    out = head_outline()
    if cut:
        out = G.inter(out, G.circle(724, 598, 620))
        out = G.inter(out, shape([(380, 300), (1200, 300), (1200, 1320), (600, 1320), (520, 1120), (486, 960), (440, 760)]))
    gl = glasses()
    if bold:
        gl = G.union(gl, stroke(gl, bold))
    out = G.diff(out, gl)
    if with_lineup:
        out = G.diff(out, lineup(10))
    if ear:
        out = G.diff(out, line(EAR, 9))
    return out


# ------------------------------------------------------------------ the hand (the cue)
def finger(bx, by, length, wb, wt, angle, curl=0.0, knuckle=0.0):
    """A finger from its base centre, pointing up (rotated by angle, + = toward the thumb), with a
    clean semicircular tip and a gentle taper; curl bends it slightly forward (+) or back (-)."""
    a = math.radians(angle)
    ux, uy = math.sin(a), -math.cos(a)
    nx, ny = -uy, ux
    spine = [(bx + ux * length * k / 10 + nx * curl * length * (k / 10) ** 2,
              by + uy * length * k / 10 + ny * curl * length * (k / 10) ** 2) for k in range(11)]
    N = len(spine)
    L, R = [], []
    for i, (x, y) in enumerate(spine):
        t = i / (N - 1)
        w = wb + (wt - wb) * (t ** 0.8) + knuckle * math.sin(math.pi * t)
        p0, p1 = spine[max(i - 1, 0)], spine[min(i + 1, N - 1)]
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        d = math.hypot(dx, dy) or 1
        L.append((x - dy / d * w / 2, y + dx / d * w / 2))
        R.append((x + dy / d * w / 2, y - dx / d * w / 2))
    tx, ty = spine[-1]
    p0 = spine[-2]
    dx, dy = tx - p0[0], ty - p0[1]
    d = math.hypot(dx, dy) or 1
    dx, dy = dx / d, dy / d
    cap = []
    for k in range(1, 8):
        th = math.pi * k / 8
        # from the L side round the tip to the R side
        cx_, cy_ = -dy * math.cos(th) + dx * math.sin(th), dx * math.cos(th) + dy * math.sin(th)
        cap.append((tx + cx_ * wt / 2, ty + cy_ * wt / 2))
    outline = L + cap + R[::-1]
    p = G.poly(outline)
    p.simplify()
    return p, spine


def hand_parts(sep=2.4):
    """A raised right hand, palm out, fingers together; local units, wrist at (0, 0)."""
    base = shape([(-45, -96), (-49, -60), (-45, -22), (-38, 2), (-35, 60), (-31, 150), (-24, 236), (-14, 316),
                  (-9, 322), (-3, 300), (14, 230), (28, 150), (35, 60), (40, 2), (52, -26), (57, -52), (53, -84),
                  (47, -106), (20, -120), (-10, -121), (-35, -110)])
    specs = [(-35, -92, 82, 20.5, 15, -5, 0.025), (-12.5, -108, 104, 23, 16.5, -2, 0.02),
             (11.5, -113, 114, 24, 17.5, 0.8, 0.015), (34.5, -104, 102, 23, 16.5, 3.8, 0.015)]
    fingers = [finger(*s) for s in specs]
    thumb, _ = finger(46, -36, 80, 28, 19, 34, -0.08)
    h = base
    for f, _ in fingers:
        h = G.union(h, f)
    solid = G.union(h, thumb)
    h = solid
    for (f1, p1), (f2, p2) in zip(fingers, fingers[1:]):
        mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(p1, p2)]
        ext = (mid[-1][0] + (mid[-1][0] - mid[-2][0]) * 3, mid[-1][1] + (mid[-1][1] - mid[-2][1]) * 3)
        h = G.diff(h, line(mid[3:] + [ext], sep))
    h = G.diff(h, line([(50, -68), (57, -94), (64, -122)], sep))
    strap = G.inter(h, G.rect(-90, 30, 180, 8))
    h = G.diff(h, G.rect(-90, 27, 180, 14))
    return dict(hand=h, strap=strap, solid=solid)


def svg_doc(inner, w=1000, h=1000, bg=None, title="Manuchie symbol", vb=None):
    x, y, ww, hh = vb or (0, 0, w, h)
    rect = f'<rect x="{x}" y="{y}" width="{ww}" height="{hh}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {ww} {hh}" role="img" aria-label="{title}">\n'
            f'<title>{title}</title>\n{rect}{inner}\n</svg>\n')


def from_d(d):
    p = pathops.Path()
    parse_path(d, p.getPen())
    return p
