# Procedural "painted" maps for the villain heads, evaluated on MakeHuman-space rest positions (dm, y up, z front).
# Shared by texel painting (albedo / height) and by the shell builders (hair / moustache / brow thickness).
import numpy as np
Hc = np.array([0.0, 8.45, 0.40])
EYE = np.array([0.293, 8.149, 1.286]); NOSE = np.array([0.0, 7.74, 1.742]); MOUTH = np.array([0.0, 7.445, 1.60])
def ss(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def sph(P):
    q = P - Hc; r = np.linalg.norm(q, axis=-1) + 1e-9
    return np.degrees(np.arctan2(q[..., 0], q[..., 2])), np.degrees(np.arcsin(np.clip(q[..., 1] / r, -1, 1))), r
# ---- value noise (3D) ----
_rng = np.random.default_rng(1234); _perm = _rng.permutation(4096); _vals = _rng.random(4096)
def _h(ix, iy, iz): return _vals[_perm[(_perm[(_perm[ix & 4095] + iy) & 4095] + iz) & 4095]]
def vnoise(P, f):
    q = P * f; i = np.floor(q).astype(np.int64); t = q - i; t = t * t * (3 - 2 * t)
    x0, y0, z0 = i[..., 0], i[..., 1], i[..., 2]; tx, ty, tz = t[..., 0], t[..., 1], t[..., 2]
    def L(a, b, w): return a + (b - a) * w
    c = [[[_h(x0 + dx, y0 + dy, z0 + dz) for dz in (0, 1)] for dy in (0, 1)] for dx in (0, 1)]
    return L(L(L(c[0][0][0], c[0][0][1], tz), L(c[0][1][0], c[0][1][1], tz), ty), L(L(c[1][0][0], c[1][0][1], tz), L(c[1][1][0], c[1][1][1], tz), ty), tx)
def fbm(P, f, oct=4, g=0.5):
    s, a, n = 0.0, 1.0, 0.0
    for k in range(oct): s = s + a * vnoise(P + k * 17.3, f * 2 ** k); n += a; a *= g
    return s / n
def interp(x, pts): return np.interp(x, [p[0] for p in pts], [p[1] for p in pts])
# ---- hair ----
HAIRLINE = {
 'a': [(0, 9.5), (16, 9), (34, 7.5), (48, 3), (58, -2), (64, -10), (70, -24), (78, -27), (84, -22), (88, -8), (100, -2), (114, -8), (126, -30), (150, -46), (180, -50)],
 'c': [(0, 8.0), (16, 7.5), (34, 6.0), (48, 2), (58, -3), (64, -11), (70, -24), (78, -27), (84, -22), (88, -8), (100, -2), (114, -8), (126, -30), (150, -46), (180, -50)],
 'b': [(0, 14), (16, 13.5), (32, 11.5), (46, 5), (56, -2), (63, -10), (70, -22), (77, -25), (83, -20), (88, -7), (100, -1), (114, -7), (126, -28), (150, -44), (180, -48)],
}
def ear_mask(P):
    az, el, r = sph(P); a = np.abs(az)
    return ss(0.25, 0.05, np.hypot((a - 97) / 12, (el + 24) / 15) - 0.75) * (np.abs(P[..., 0]) > 0.6)
def hair_mask(P, vk, soft=1.5):
    az, el, r = sph(P); a = np.abs(az); eh = interp(a, HAIRLINE[vk])
    m = ss(-soft, soft, el - eh) * (1 - ear_mask(P))
    return m
def hair_across(P, vk):
    """coordinate whose iso-lines follow the strands (swept back: angle around the front-back axis), in dm-ish units"""
    q = P - Hc; phi = np.arctan2(q[..., 0], q[..., 1] + 0.25)        # 0 on top, +-pi/2 on the sides
    wav = 0.10 * np.sin(q[..., 2] * (5.0 if vk == 'b' else 3.0) + q[..., 0] * 2) * (1.0 if vk == 'b' else 0.4)
    if vk == 'c': wav = wav + 0.22 * (fbm(P, 1.6, 2) - 0.5) + 0.08 * np.sin(q[..., 2] * 7 + q[..., 0] * 5)  # tousled
    part = 0.0
    return (phi + wav) * 1.0, q[..., 2]
def hair_thick(P, vk):
    """hair volume above the scalp, metres (game units)"""
    az, el, r = sph(P); a = np.abs(az); q = P - Hc
    top = ss(-10, 40, el)                      # 0 on the sides / back low, 1 on top
    front = ss(60, 0, a) * ss(10, 30, el)     # front quiff zone
    if vk == 'a': t = 0.0045 + 0.011 * top + 0.008 * front
    elif vk == 'c': t = 0.005 + 0.008 * top + 0.006 * front
    else:         t = 0.005 + 0.014 * top + 0.010 * front
    phi, along = hair_across(P, vk)
    clump = np.sin(phi * (26 if vk == 'a' else 20) + 1.2 * fbm(P, 1.4, 2)) * 0.5 + 0.5
    t = t * (0.86 + 0.22 * clump)
    if vk == 'c': t = t * (0.65 + 0.75 * fbm(P, 5.0, 2))  # messy tufts
    if vk == 'b': t = t * (0.9 + 0.2 * (np.sin(q[..., 2] * 6.0 + phi * 3) * 0.5 + 0.5))
    edge = ss(0.0, 6.0, el - interp(a, HAIRLINE[vk]))  # taper to the hairline
    return t * (0.12 + 0.88 * edge)
# ---- moustache: chevron, param (u across -1..1, v top 0 .. bottom 1) -> MH xy ----
MST = {'a': dict(w=0.30, top=7.635, bot=7.442, droop=0.07, t=0.0050, rim=0.0035),
       'c': dict(w=0.31, top=7.645, bot=7.45, droop=0.11, t=0.0058, rim=0.004),
       'b': dict(w=0.34, top=7.64, bot=7.44, droop=0.085, t=0.0050, rim=0.0042)}
def moustache_xy(u, v, vk):
    c = MST[vk]; x = u * c['w'] * (0.62 + 0.38 * v)
    top = c['top'] - 0.10 * (np.abs(u) ** 1.6)
    bot = c['bot'] - c['droop'] * (np.abs(u) ** 2.2)
    return x, top + (bot - top) * v
# ---- eyebrows: param (u inner 0 .. outer 1, v top 0 .. bottom 1) -> MH xy per side ----
BROW = {'a': dict(x0=0.07, x1=0.50, y_in=8.36, y_peak=8.40, y_out=8.35, h_in=0.095, h_out=0.055, t=0.0022),
        'c': dict(x0=0.06, x1=0.50, y_in=8.33, y_peak=8.385, y_out=8.35, h_in=0.10, h_out=0.06, t=0.0026),
        'b': dict(x0=0.08, x1=0.50, y_in=8.35, y_peak=8.39, y_out=8.34, h_in=0.09, h_out=0.05, t=0.0020)}
def brow_xy(u, v, vk, side):
    c = BROW[vk]; x = side * (c['x0'] + (c['x1'] - c['x0']) * u)
    yc = np.where(u < 0.55, c['y_in'] + (c['y_peak'] - c['y_in']) * ss(0, 0.55, u), c['y_peak'] + (c['y_out'] - c['y_peak']) * ss(0.55, 1, u))
    h = c['h_in'] + (c['h_out'] - c['h_in']) * u
    return x, yc + h * (0.5 - v)
# ---- full beard (Centurion): cheeks, jaw, chin, under the jaw; lips left clear ----
BEARD_TOP = [(0.0, 7.60), (0.16, 7.585), (0.28, 7.66), (0.40, 7.76), (0.52, 7.90), (0.60, 8.04), (0.66, 8.16)]
BEARD_LOW = [(0.0, 6.93), (0.25, 6.97), (0.42, 7.10), (0.55, 7.32), (0.64, 7.62), (0.70, 7.95)]   # front: under the jaw; sides: the jaw line
def beard_mask(P, soft=1.0):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]; ax = np.abs(x); up = interp(ax, BEARD_TOP)
    lo = interp(ax, BEARD_LOW)
    m = ss(up + 0.03 * soft, up - 0.05 * soft, y) * ss(lo - 0.03 * soft, lo + 0.06 * soft, y) * ss(0.35, 0.6, z) * ss(0.74, 0.66, ax)
    lip = np.exp(-(((y - 7.425) / 0.06) ** 2 + (ax / 0.19) ** 4) * 1.0)
    return np.clip(m * (1 - lip * ss(1.2, 1.4, z)), 0, 1)
def beard_thick(P):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]; ax = np.abs(x); up = interp(ax, BEARD_TOP)
    t = 0.004 + 0.011 * ss(7.6, 7.15, y) + 0.003 * ss(0.3, 0.6, ax) * ss(7.9, 7.4, y)      # full and square at the chin / jaw
    t = t * (0.8 + 0.4 * fbm(P, 4.0, 2))
    return t * (0.15 + 0.85 * ss(0.0, 0.1, up - y)) * (0.3 + 0.7 * ss(0.0, 0.12, y - interp(ax, BEARD_LOW)))
