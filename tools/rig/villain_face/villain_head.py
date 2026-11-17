# DCUO-style head for a villain: base head (head_base.py, MakeHuman CC0 topology + sliders) dialled in from his sheet,
# baked shape, painted albedo + bump-baked normal map (brow ridge / nasolabial folds / furrows / stubble / pores / hair
# strands), sculpted hair shell, moustache + eyebrow shells, eyeballs. Saves a standalone head blend.
# usage: blender -b --python villain_head.py -- a|b   -> /workspace/hero-game-assets/villain_face/villain_{a,b}_head.blend
import bpy, bmesh, sys, os, json, math, numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); import paint
from paint import ss, fbm, vnoise
VK = sys.argv[sys.argv.index('--') + 1:][0]
D = '/workspace/hero-game-assets/villain_face'; TEX = f'{D}/tex'; os.makedirs(TEX, exist_ok=True)
R = int(os.environ.get('TEXRES', 2048))
LM = json.load(open(f'{D}/base_head.json')); S = LM['S']; NZ = LM['nose_mh'][2]; NY = LM['nose_mh'][1]
def to_game(p): p = np.atleast_2d(p); return np.stack([p[:, 0] * S, -(p[:, 2] - NZ) * S - 0.163, (p[:, 1] - NY) * S + 1.686], 1)
def srgb(c): return (np.array(c, float) / 255.0) ** 2.2   # paint in linear, save as sRGB
CFG = {
 'a': dict(sl=dict(jaw_width=.55, chin=.55, chin_cleft=.25, cheekbones=.75, brow_ridge=.32, brow_angle=.35, nose_length=.25, nose_hump=.45,
                   nose_width=.1, nose_depth=.2, eye_narrow=.5, eye_tilt=-.2, lips=-.25, mouth_width=.1, face_length=.2, head_width=.12,
                   temples=.3, neck_thick=1.0, age=.35, scowl=.45),
           skin=(182, 128, 102), skin_red=(172, 96, 80), beard=(96, 84, 84), lip=(150, 88, 76),
           hair0=(12, 9, 7), hair1=(44, 33, 25), brow=(26, 19, 15), mst0=(22, 16, 12), mst1=(58, 42, 30),
           iris0=(60, 38, 20), iris1=(122, 84, 46), stubble=1.0, wrinkle=1.5),
 'b': dict(sl=dict(jaw_width=.85, chin=.45, cheekbones=.55, brow_ridge=.38, brow_angle=.25, nose_length=.1, nose_width=.35, nose_hump=.2,
                   nose_depth=.1, eye_narrow=.35, eye_bags=.4, lips=.0, mouth_width=.2, face_length=.05, head_width=.3, temples=.2,
                   neck_thick=1.25, age=.55, scowl=.35),
           skin=(200, 136, 104), skin_red=(196, 104, 84), beard=(150, 112, 92), lip=(168, 94, 80),
           hair0=(112, 78, 40), hair1=(198, 158, 98), brow=(122, 84, 50), mst0=(104, 62, 34), mst1=(158, 106, 62),
           iris0=(58, 88, 112), iris1=(128, 160, 184), stubble=0.6, wrinkle=1.8),
 'c': dict(sl=dict(jaw_width=.75, chin=.5, cheekbones=.6, brow_ridge=.48, brow_angle=.45, nose_length=.15, nose_width=.2, nose_hump=.1,
                   nose_depth=.15, eye_narrow=.45, eye_tilt=-.1, lips=-.1, mouth_width=.1, face_length=.15, head_width=.2, temples=.3,
                   neck_thick=1.15, age=.45, scowl=.5),
           skin=(168, 120, 96), skin_red=(160, 96, 78), beard=(60, 44, 34), lip=(140, 84, 70),
           hair0=(16, 11, 8), hair1=(70, 50, 34), brow=(22, 16, 12), mst0=(24, 17, 12), mst1=(96, 70, 48),
           iris0=(255, 176, 70), iris1=(255, 236, 170), stubble=0.6, wrinkle=1.7, fullbeard=True, glow=True),
}[VK]
FB = CFG.get('fullbeard', False)
bpy.ops.wm.open_mainfile(filepath=f'{D}/base_head.blend')
sc = bpy.context.scene; h = bpy.data.objects['VHead']; me = h.data; NV = len(me.vertices)
def getco(m): a = np.zeros(len(m.vertices) * 3); m.vertices.foreach_get('co', a); return a.reshape(-1, 3)
MHP = np.zeros(NV * 3); me.attributes['mhpos'].data.foreach_get('vector', MHP); MHP = MHP.reshape(-1, 3)
# ---------------- 1. dial the sliders in and bake the shape ----------------
kbs = me.shape_keys.key_blocks; base = np.zeros(NV * 3); kbs['Basis'].data.foreach_get('co', base); base = base.reshape(-1, 3); co = base.copy()
for k, v in CFG['sl'].items():
    kb = kbs[k + ('+' if v >= 0 else '-')]; a = np.zeros(NV * 3); kb.data.foreach_get('co', a); co += abs(v) * (a.reshape(-1, 3) - base)
# comic exaggeration on top of the sliders (MH-space masks): deeper eye sockets, squarer jaw angle, stronger cheekbone shelf
def g3(P, c, r): return np.exp(-np.sum(((P - np.array(c)) / np.array(r)) ** 2, -1))
dz = np.zeros(NV); dx = np.zeros(NV)
for s in (-1, 1):
    dz -= 0.10 * g3(MHP, (s * 0.26, 8.20, 1.30), (0.13, 0.07, 0.25))          # under the brow: socket in
    dx += s * 0.06 * g3(MHP, (s * 0.62, 7.30, 0.55), (0.18, 0.22, 0.35))     # gonial angle out
    dz += 0.05 * g3(MHP, (s * 0.50, 7.86, 1.05), (0.16, 0.06, 0.3))          # cheekbone shelf
co[:, 0] += dx * S; co[:, 1] -= dz * S
h.shape_key_clear(); me.vertices.foreach_set('co', co.ravel()); me.update()
# eyeballs follow the local deformation around the sockets
EYE = {}
for sd, e in LM['eyes'].items():
    w = np.exp(-np.sum(((MHP - np.array(e['mh'])) / 0.30) ** 2, -1)); w /= w.sum()
    G0 = to_game(np.array(e['mh']))[0]; EYE[sd] = (G0 + (w[:, None] * (co - to_game(MHP))).sum(0), e['r'])
print('EYES', {k: (np.round(v[0], 4).tolist(), round(v[1], 4)) for k, v in EYE.items()})
# ---------------- 2. repack the UV islands (MakeHuman seams, uniform texel density, face island boosted) ----------------
for o in bpy.data.objects: o.select_set(False)
h.select_set(True); bpy.context.view_layer.objects.active = h
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.select_all(action='SELECT'); bpy.ops.uv.average_islands_scale()
bm = bmesh.from_edit_mesh(me); uvl = bm.loops.layers.uv.active
# boost the face island 1.35x (faces near the front) before packing
islands = []; seen = set()
def isl_from(f0):
    stack = [f0]; out = []; seen.add(f0.index)
    while stack:
        f = stack.pop(); out.append(f)
        for l in f.loops:
            for lo in l.edge.link_loops:
                g = lo.face
                if g.index in seen: continue
                # same island if the shared edge has matching UVs on both sides
                a0, a1 = l[uvl].uv, l.link_loop_next[uvl].uv
                b0, b1 = lo[uvl].uv, lo.link_loop_next[uvl].uv
                if ((a0 - b1).length < 1e-5 and (a1 - b0).length < 1e-5) or ((a0 - b0).length < 1e-5 and (a1 - b1).length < 1e-5):
                    seen.add(g.index); stack.append(g)
    return out
for f in bm.faces:
    if f.index not in seen: islands.append(isl_from(f))
mlay = None
for isl in islands:
    vs = {v.index for f in isl for v in f.verts}; P = MHP[list(vs)]
    if len(isl) == max(len(i) for i in islands):
        uvs = [l[uvl].uv for f in isl for l in f.loops]; c = sum(uvs, Vector((0, 0))) / len(uvs)
        for f in isl:
            for l in f.loops: l[uvl].uv = c + (l[uvl].uv - c) * 1.35
        print('FACE island boosted', len(isl))
bmesh.update_edit_mesh(me)
bpy.ops.uv.pack_islands(rotate=True, margin=0.006)
bpy.ops.object.mode_set(mode='OBJECT')
print('ISLANDS', len(islands))
# ---------------- 3. bake helpers: MH position + AO in texture space ----------------
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 1; sc.render.bake.margin = 16; sc.render.bake.use_clear = True
mat = bpy.data.materials.new('bk'); mat.use_nodes = True; nt = mat.node_tree; N = nt.nodes
for n in list(N): N.remove(n)
out = N.new('ShaderNodeOutputMaterial'); em = N.new('ShaderNodeEmission'); nt.links.new(em.outputs[0], out.inputs[0])
at = N.new('ShaderNodeAttribute'); at.attribute_name = 'mhpos'; tgt = N.new('ShaderNodeTexImage')
me.materials.clear(); me.materials.append(mat)
def newimg(name, res, flt=True):
    im = bpy.data.images.new(name, res, res, alpha=False, float_buffer=flt); im.colorspace_settings.name = 'Non-Color'; return im
def pix(im): r = im.size[0]; return np.array(im.pixels[:]).reshape(r, r, 4)[..., :3].copy()
im = newimg('mhp', R); tgt.image = im; N.active = tgt; nt.links.new(at.outputs['Vector'], em.inputs[0])
bpy.ops.object.bake(type='EMIT'); PM = pix(im)
# validity (inside islands, before margin dilation): bake with no margin
sc.render.bake.margin = 0; cv = N.new('ShaderNodeRGB'); cv.outputs[0].default_value = (1, 1, 1, 1)
for l in list(em.inputs[0].links): nt.links.remove(l)
nt.links.new(cv.outputs[0], em.inputs[0]); im2 = newimg('val', R); tgt.image = im2; bpy.ops.object.bake(type='EMIT'); VAL = pix(im2)[..., 0] > 0.5
sc.render.bake.margin = 16
# AO (geometry only, eyes included so the sockets shade properly)
def eyeball(sd):
    c, r = EYE[sd]; bme = bmesh.new()
    bme.loops.layers.uv.new('UVMap'); bmesh.ops.create_uvsphere(bme, u_segments=28, v_segments=18, radius=r, calc_uvs=True)
    bmesh.ops.rotate(bme, verts=bme.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'))
    bmesh.ops.translate(bme, verts=bme.verts, vec=Vector(c) + Vector((0, 0.0012, 0)))
    m = bpy.data.meshes.new('eye_' + sd); bme.to_mesh(m); bme.free()
    for p in m.polygons: p.use_smooth = True
    o = bpy.data.objects.new('eye_' + sd, m); sc.collection.objects.link(o); return o
eyes = [eyeball('L'), eyeball('R')]
sc.cycles.samples = 48; AR = R // 2; im3 = newimg('ao', AR); tgt.image = im3
bpy.ops.object.bake(type='AO'); AO = pix(im3)[..., 0]; AO = np.kron(AO, np.ones((2, 2)))
sc.cycles.samples = 1
print('BAKED maps', R)
# ---------------- 4. paint (texel space, MH coordinates) ----------------
P = PM.reshape(-1, 3); x, y, z = P[:, 0], P[:, 1], P[:, 2]; ax = np.abs(x); sgn = np.sign(x) + (x == 0)
front = ss(0.6, 1.0, z)
Hmm = np.zeros(len(P))                          # height, mm
def g2(cx, cy, rx, ry, zmin=0.8): return np.exp(-(((ax - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)) * ss(zmin - 0.2, zmin + 0.2, z)
def line_dist(pts):  # distance (MH units) from (|x|, y) to a polyline
    q = np.stack([ax, y], 1); best = np.full(len(q), 9.0)
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        a = np.array([x0, y0]); b = np.array([x1, y1]); ab = b - a; t = np.clip(((q - a) @ ab) / (ab @ ab), 0, 1)
        best = np.minimum(best, np.linalg.norm(q - (a + t[:, None] * ab), axis=1))
    return best
W = CFG['wrinkle']
# nasolabial fold: from the nose wing round past the mouth corner (groove + raised cheek side)
nl = [(0.13, 7.70), (0.20, 7.58), (0.26, 7.45), (0.30, 7.33)]
dn = line_dist(nl); side_cheek = (ax > np.interp(y, [7.33, 7.70], [0.30, 0.13]))
Hmm += (-0.9 * np.exp(-(dn / 0.022) ** 2) + 0.55 * np.exp(-((dn - 0.05) / 0.04) ** 2) * side_cheek) * front * W * (y > 7.25) * (y < 7.74)
# brow furrows (scowl): two vertical creases + a procerus line, forehead lines, crow's feet, under-eye line, mentolabial sulcus
Hmm += -0.55 * np.exp(-((ax - 0.045) / 0.012) ** 2) * ss(8.24, 8.30, y) * ss(8.47, 8.40, y) * front * W
Hmm += -0.35 * np.exp(-((y - 8.255) / 0.012) ** 2) * ss(0.09, 0.03, ax) * front * W
for k, yy in enumerate((8.56, 8.66, 8.77)):
    Hmm += -0.14 * W * np.exp(-((y - yy - 0.03 * (ax / 0.3) ** 2) / 0.012) ** 2) * ss(0.36, 0.2, ax) * front * (0.6 + 0.4 * fbm(P, 3, 2))
ang = np.arctan2(y - 8.15, ax - 0.46); rr = np.hypot(ax - 0.46, y - 8.15)
Hmm += -0.10 * W * (np.sin(ang * 9) ** 8) * ss(0.03, 0.06, rr) * ss(0.16, 0.08, rr) * (ax > 0.46) * ss(0.6, 0.9, z)
Hmm += -0.30 * W * np.exp(-((y - (8.035 - 0.25 * (ax - 0.29) ** 2)) / 0.012) ** 2) * ss(0.48, 0.38, np.abs(ax - 0.29) + 0.2) * front
Hmm += -0.7 * np.exp(-((y - 7.285) / 0.02) ** 2) * ss(0.18, 0.08, ax) * front
Hmm += -0.3 * np.exp(-(((y - 7.55) / 0.08) ** 2 + (ax / 0.035) ** 2)) * front    # philtrum
# cheekbone / jaw definition (comic shading via bump): soft ridge along the zygomatic + mandible line
Hmm += 0.35 * np.exp(-((y - (7.88 - 0.25 * (ax - 0.45))) / 0.05) ** 2) * ss(0.25, 0.45, ax) * ss(0.75, 0.55, ax) * ss(0.3, 0.8, z)
# stubble / beard area, pores everywhere on skin
beard = ss(7.78, 7.62, y + 0.25 * np.clip(0.5 - ax, 0, 1) * 0) * ss(-0.2, 0.3, z) * (y > 6.75)
beard *= np.where(ax < 0.55, ss(7.80 - 0.6 * np.clip(ax - 0.12, 0, 1), 7.55 - 0.6 * np.clip(ax - 0.12, 0, 1), y), ss(7.98, 7.75, y)) * (0.75 + 0.25 * fbm(P, 5, 2))
beard *= 1 - np.exp(-(((y - 7.445) / 0.035) ** 2 + (ax / 0.2) ** 2) * 1.0) * 0.9        # not on the lips
neckfade = ss(6.85, 7.05, y)
pores = fbm(P, 60, 2) - 0.5; stub = (vnoise(P, 140) > 0.62).astype(float) * vnoise(P + 3, 90)
Hmm += 0.06 * pores + 0.08 * stub * beard * neckfade * CFG['stubble']
# masks for hair / brows / moustache
HM = paint.hair_mask(P, VK, soft=0.8); EM = paint.ear_mask(P)
def brow_mask():
    m = np.zeros(len(P)); c = paint.BROW[VK]
    u = (ax - c['x0']) / (c['x1'] - c['x0'])
    yc = np.where(u < 0.55, c['y_in'] + (c['y_peak'] - c['y_in']) * ss(0, 0.55, u), c['y_peak'] + (c['y_out'] - c['y_peak']) * ss(0.55, 1, u))
    hh = c['h_in'] + (c['h_out'] - c['h_in']) * np.clip(u, 0, 1); v = 0.5 - (y - yc) / hh
    m = ss(-0.05, 0.08, u) * ss(1.05, 0.9, u) * ss(-0.15, 0.1, v) * ss(1.15, 0.9, v) * ss(0.7, 1.0, z)
    return m, u, v
BM_, bu, bv = brow_mask()
def mst_mask():
    c = paint.MST[VK]; v = np.full(len(P), 0.5)
    for _ in range(4):
        u = np.clip(x / (c['w'] * (0.62 + 0.38 * v)), -1.3, 1.3)
        top = c['top'] - 0.10 * (np.abs(u) ** 1.6); bot = c['bot'] - c['droop'] * (np.abs(u) ** 2.2)
        v = (top - y) / (top - bot)
    return ss(1.08, 0.95, np.abs(u)) * ss(-0.12, 0.04, v) * ss(1.25, 1.0, v) * ss(1.2, 1.45, z), u, v
MM, mu, mv = mst_mask()
# strand patterns
phi, along = paint.hair_across(P, VK)
warp = 2.5 * fbm(P, 3, 2) + 0.8 * fbm(P, 9, 2)
str1 = np.sin(phi * 230 + 4 * warp) * 0.5 + 0.5; str3 = np.sin(phi * 95 + 2 * warp + 1.3) * 0.5 + 0.5
str2 = vnoise(np.stack([phi * 70, along * 3, np.zeros_like(phi)], 1), 1.0)
clump = np.sin(phi * (26 if VK == 'a' else 20) + 1.2 * fbm(P, 1.4, 2)) * 0.5 + 0.5
hstr = np.clip(0.35 * str1 + 0.25 * str3 + 0.4 * str2, 0, 1) * (0.55 + 0.45 * clump)
if VK == 'c': hstr = np.clip(0.15 * str1 + 0.15 * str3 + 0.3 * str2 + 0.5 * fbm(P, 14, 2), 0, 1) * (0.5 + 0.5 * fbm(P, 5, 2))  # tousled, no combed lines
Hmm += (0.45 * (hstr - 0.5) + 0.35 * (clump - 0.5)) * HM
macr = x - 0.45 * sgn * (y - 7.6); mstr = np.sin(macr * 260 + 2 * fbm(P, 8, 2)) * 0.5 + 0.5
Hmm = Hmm * (1 - MM) + MM * (0.4 * (mstr - 0.5) + 0.2)
bacr = (y - 0.25 * ax) ; bstr = np.sin(bacr * 300 + 2 * fbm(P, 9, 2)) * 0.5 + 0.5
Hmm = Hmm * (1 - BM_ * 0.8) + BM_ * 0.8 * (0.35 * (bstr - 0.5) + 0.15)
BD = paint.beard_mask(P) if FB else np.zeros(len(P))
if FB:  # full beard: downward-flowing strands + clumps (the shell carries the volume)
    bw = 2.0 * fbm(P, 3, 2); bacr2 = x + 0.25 * sgn * (7.6 - y) * ss(0.2, 0.5, ax)
    bstr2 = np.clip(0.25 * (np.sin(bacr2 * 240 + 3 * bw) * 0.5 + 0.5) + 0.35 * vnoise(np.stack([bacr2 * 80, y * 6, z], 1), 1.0) + 0.4 * fbm(P, 16, 2), 0, 1)
    bcl = fbm(P, 7, 2)
    Hmm = Hmm * (1 - BD) + BD * (0.45 * (bstr2 - 0.5) + 0.4 * (bcl - 0.5))
# ---- albedo ----
C = lambda k: srgb(CFG[k])
col = np.tile(C('skin'), (len(P), 1))
mott = fbm(P, 2.5, 3); col *= (0.92 + 0.16 * mott)[:, None]
red = np.clip(g2(0.0, 7.74, 0.16, 0.12, 1.4) * 0.8 + g2(0.42, 7.85, 0.2, 0.14) * 0.55 + EM * 0.5 + g2(0.0, 8.7, 0.35, 0.25, 1.0) * 0.15, 0, 1)
col = col * (1 - red[:, None] * 0.55) + C('skin_red') * red[:, None] * 0.55
bsh = np.clip(beard * neckfade * CFG['stubble'], 0, 1)
col = col * (1 - bsh[:, None] * 0.38) + C('beard') * bsh[:, None] * 0.38
col *= (1 - 0.35 * stub * bsh)[:, None]
lipm = np.exp(-(((y - 7.44) / 0.055) ** 2 + (ax / 0.21) ** 4)) * ss(1.35, 1.5, z)
col = col * (1 - lipm[:, None] * 0.6) + C('lip') * lipm[:, None] * 0.6
lid = np.exp(-(((ax - 0.29) / 0.15) ** 2 + ((y - 8.22) / 0.06) ** 2)) * front
col *= (1 - 0.10 * lid)[:, None]
crease = np.clip(-Hmm, 0, 1.2); col *= (1 - 0.22 * crease)[:, None]
shadow = (g2(0.42, 7.62, 0.12, 0.14, 0.9) * 0.5 + g2(0.62, 8.62, 0.14, 0.2, 0.5) * 0.3 + np.exp(-((y - 7.0) / 0.12) ** 2) * ss(-0.2, 0.6, z) * 0.35
          + g2(0.16, 8.22, 0.08, 0.06, 1.1) * 0.35)
hi = g2(0.0, 8.62, 0.22, 0.16, 1.0) * 0.25 + g2(0.0, 7.95, 0.05, 0.2, 1.5) * 0.25 + g2(0.45, 7.92, 0.12, 0.05, 0.9) * 0.2 + g2(0.0, 7.17, 0.1, 0.06, 1.3) * 0.15
col *= (1 - 0.35 * shadow + 0.25 * hi)[:, None]
col *= (0.62 + 0.38 * AO.reshape(-1))[:, None]
# hair (shell + scalp share this texture), brows, moustache
hc = C('hair0')[None] * (1 - hstr[:, None]) + C('hair1')[None] * hstr[:, None]
hc *= (0.75 + 0.35 * fbm(P, 4, 2))[:, None] * (0.7 + 0.3 * clump)[:, None]
hm = HM * (1 - EM)
col = col * (1 - hm[:, None]) + hc * hm[:, None]
bc = C('brow')[None] * (0.7 + 0.6 * bstr[:, None]); col = col * (1 - BM_[:, None] * 0.92) + bc * BM_[:, None] * 0.92
mc = C('mst0')[None] * (1 - mstr[:, None]) + C('mst1')[None] * mstr[:, None]; col = col * (1 - MM[:, None]) + mc * MM[:, None]
if FB:
    bc2 = C('mst0')[None] * (1 - bstr2[:, None] ** 1.5) + C('mst1')[None] * bstr2[:, None] ** 1.5; bc2 *= (0.55 + 0.6 * bcl)[:, None]
    col = col * (1 - BD[:, None] * 0.97) + bc2 * BD[:, None] * 0.97
ALB = np.clip(col, 0, 1).reshape(R, R, 3) ** (1 / 2.2); HMAP = Hmm.reshape(R, R)
def save(arr, name, flt=False, srgb_=True):
    r = arr.shape[0]; im = bpy.data.images.new(name, r, r, alpha=False, float_buffer=flt); im.colorspace_settings.name = 'sRGB' if srgb_ else 'Non-Color'
    a = arr if arr.ndim == 3 else np.repeat(arr[..., None], 3, 2)
    im.pixels.foreach_set(np.concatenate([a, np.ones((r, r, 1))], 2).astype(np.float32).ravel())
    p = f'{TEX}/{name}.{"exr" if flt else "png"}'; im.filepath_raw = p; im.file_format = 'OPEN_EXR' if flt else 'PNG'; im.save(); return im
alb_im = save(ALB, f'villain_{VK}_head_albedo'); h_im = save(HMAP, f'villain_{VK}_head_height', flt=True, srgb_=False)
print('PAINTED')
# ---------------- 5. shells: hair (offset scalp), moustache + brows (raycast grids), using the head's UVs ----------------
bmh = bmesh.new(); bmh.from_mesh(me); bmh.verts.ensure_lookup_table(); bmh.faces.ensure_lookup_table()
uvh = bmh.loops.layers.uv.active
bmt = bmh.copy(); bmesh.ops.triangulate(bmt, faces=bmt.faces[:]); bmt.faces.ensure_lookup_table(); uvt = bmt.loops.layers.uv.active
bvh = BVHTree.FromBMesh(bmt)
VN = np.array([v.normal[:] for v in bmh.verts])
def surf(p):
    loc, nrm, fi, dist = bvh.find_nearest(Vector(p)); f = bmt.faces[fi]; a, b, c = [l.vert for l in f.loops]
    def bt(va, vb, vc): return barycentric_transform(loc, a.co, b.co, c.co, Vector(va), Vector(vb), Vector(vc))
    n = bt(VN[a.index], VN[b.index], VN[c.index]).normalized()
    mh = bt(MHP[a.index], MHP[b.index], MHP[c.index])
    uv = bt((*f.loops[0][uvt].uv, 0), (*f.loops[1][uvt].uv, 0), (*f.loops[2][uvt].uv, 0))
    return loc, n, np.array(mh[:]), (uv.x, uv.y)
def ray(p, d):
    loc, nrm, fi, dist = bvh.ray_cast(Vector(p), Vector(d).normalized()); return loc
out = bmesh.new(); ouv = out.loops.layers.uv.new('UVMap')
def face(vs, uvs, mi=0):
    try: f = out.faces.new(vs)
    except ValueError: return None
    f.material_index = mi
    for l, u in zip(f.loops, uvs): l[ouv].uv = u
    return f
# hair shell
hmv = paint.hair_mask(MHP, VK, soft=0.8)
sel = [f for f in bmh.faces if max(hmv[v.index] for v in f.verts) > 0.35]
hb = bmesh.new(); huv = hb.loops.layers.uv.new('UVMap'); vm = {}
for f in sel:
    vs = []
    for v in f.verts:
        if v.index not in vm: vm[v.index] = hb.verts.new(v.co)
        vs.append(vm[v.index])
    nf = hb.faces.new(vs)
    for l, lo in zip(nf.loops, f.loops): l[huv].uv = lo[uvh].uv
bmesh.ops.subdivide_edges(hb, edges=hb.edges[:], cuts=1, use_grid_fill=True)
for v in hb.verts:
    loc, n, mh, _ = surf(v.co); t = float(paint.hair_thick(mh[None], VK)[0]) * float(paint.hair_mask(mh[None], VK, soft=2.5)[0])
    v.co = loc + n * (t - 0.0009)   # sinks just under the skin at the hairline: the painted hairline takes over
bmesh.ops.recalc_face_normals(hb, faces=hb.faces[:])
nh = len(hb.faces)
tmp = bpy.data.meshes.new('hairtmp'); hb.to_mesh(tmp); hb.free(); out.from_mesh(tmp); bpy.data.meshes.remove(tmp)
ouv = out.loops.layers.uv['UVMap']
print('HAIR faces', nh)
if FB:
    bmv = paint.beard_mask(MHP, soft=1.0)
    selb = [f for f in bmh.faces if max(bmv[v.index] for v in f.verts) > 0.3]
    bb = bmesh.new(); buv = bb.loops.layers.uv.new('UVMap'); vm = {}
    for f in selb:
        vs = []
        for v in f.verts:
            if v.index not in vm: vm[v.index] = bb.verts.new(v.co)
            vs.append(vm[v.index])
        nf = bb.faces.new(vs)
        for l, lo in zip(nf.loops, f.loops): l[buv].uv = lo[uvh].uv
    for v in bb.verts:  # (no subdivide: the head is dense enough there, keeps the shell ~3k tris)
        loc, n, mh, _ = surf(v.co); t = float(paint.beard_thick(mh[None])[0]) * float(paint.beard_mask(mh[None], soft=2.0)[0])
        v.co = loc + n * (t - 0.0009) + Vector((0, 0, -0.35 * t))  # a little droop: the beard hangs
    bmesh.ops.recalc_face_normals(bb, faces=bb.faces[:])
    tmp = bpy.data.meshes.new('beardtmp'); bb.to_mesh(tmp); print('BEARD faces', len(bb.faces)); bb.free(); out.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    ouv = out.loops.layers.uv['UVMap']
# grid shell builder (moustache / brows)
def grid_shell(xy, nu, nv, thick, droop=0.0, mi=0, flip=False):
    top = [[None] * (nu + 1) for _ in range(nv + 1)]; bot = [[None] * (nu + 1) for _ in range(nv + 1)]; UV = [[None] * (nu + 1) for _ in range(nv + 1)]
    for i in range(nv + 1):
        for j in range(nu + 1):
            u, v = j / nu, i / nv; mx, my = xy(u, v); g = to_game(np.array([mx, my, 2.8]))[0]
            hit = ray(g, (0, 1, 0))
            if hit is None: hit = Vector(g)
            loc, n, mh, uv = surf(hit); t = thick(u, v)
            dv = Vector((0, 0, -droop * v ** 2))
            top[i][j] = out.verts.new(loc + n * t + dv); bot[i][j] = out.verts.new(loc - n * 0.0006); UV[i][j] = uv
    for i in range(nv):
        for j in range(nu):
            q = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
            if flip: q = q[::-1]
            face([top[a][b] for a, b in q], [UV[a][b] for a, b in q], mi)
    ring = [(0, j) for j in range(nu)] + [(i, nu) for i in range(nv)] + [(nv, j) for j in range(nu, 0, -1)] + [(i, 0) for i in range(nv, 0, -1)]
    for k in range(len(ring)):
        (a0, b0), (a1, b1) = ring[k], ring[(k + 1) % len(ring)]
        q = [top[a0][b0], bot[a0][b0], bot[a1][b1], top[a1][b1]]; uq = [UV[a0][b0], UV[a0][b0], UV[a1][b1], UV[a1][b1]]
        if flip: q, uq = q[::-1], uq[::-1]
        face(q, uq, mi)
c = paint.MST[VK]
def mthick(u, v):
    uu = abs(2 * u - 1); prof = (0.35 + 0.65 * ss(0.0, 0.45, v)) * (1 - 0.7 * uu ** 1.5)
    return c['t'] * prof * (1 + 0.12 * math.sin(u * 40)) + 0.0004
grid_shell(lambda u, v: [float(a) for a in paint.moustache_xy(np.array(2 * u - 1), np.array(v), VK)], 30, 9, mthick, droop=0.0015)
cb = paint.BROW[VK]
for sd in (1, -1):
    def bthick(u, v): return cb['t'] * (1 - 0.55 * u) * math.sin(math.pi * min(1, max(0, v * 0.9 + 0.05))) ** 0.6 + 0.0003
    grid_shell(lambda u, v, sd=sd: [float(a) for a in paint.brow_xy(np.array(u), np.array(v), VK, sd)], 14, 4, bthick, flip=(sd < 0))
bmesh.ops.recalc_face_normals(out, faces=out.faces[:])
# eyes go into the same detail mesh (material 1)
for o in eyes:
    m = o.data; ob = bmesh.new(); ob.from_mesh(m); euv = ob.loops.layers.uv.active or (ob.loops.layers.uv[0] if len(ob.loops.layers.uv) else None)
    vm = {v: out.verts.new(v.co) for v in ob.verts}
    for f in ob.faces: face([vm[v] for v in f.verts], [l[euv].uv for l in f.loops], 1)
    ob.free(); bpy.data.objects.remove(o)
dm = bpy.data.meshes.new('VDetail'); out.to_mesh(dm); out.free()
for p in dm.polygons: p.use_smooth = True
det = bpy.data.objects.new('VDetail', dm); sc.collection.objects.link(det)
print('DETAIL tris', sum(len(p.vertices) - 2 for p in dm.polygons))
# ---------------- 6. eye texture ----------------
ER = 256; vv, uu = np.mgrid[0:ER, 0:ER]; vv = (vv + 0.5) / ER; uu = (uu + 0.5) / ER
th = (1 - vv) * math.pi                                    # angle from the front pole
lon = uu * 2 * math.pi
ir = 0.52; pu = 0.19
irf = ss(ir + 0.02, ir - 0.02, th); pupil = ss(pu + 0.015, pu - 0.015, th)
fib = 0.5 + 0.5 * np.sin(lon * 60 + 4 * np.sin(lon * 7)) * (0.6 + 0.4 * np.cos(th * 30))
irisc = srgb(CFG['iris0'])[None, None] * (1 - fib[..., None] * 0.6) + srgb(CFG['iris1'])[None, None] * fib[..., None] * 0.6
irisc *= (0.75 + 0.5 * ss(pu, ir, th))[..., None] ** -0.3
limb = np.exp(-((th - ir) / 0.03) ** 2)
scl = np.array([0.80, 0.76, 0.72]) * (1 - 0.25 * ss(0.9, 1.6, th))[..., None]
scl = scl * (1 - 0.15 * (np.sin(lon * 23) > 0.96)[..., None] * ss(0.8, 1.3, th)[..., None] * np.array([0, 1, 1]))
E = scl * (1 - irf[..., None]) + irisc * irf[..., None]; E *= (1 - 0.7 * limb)[..., None]; E *= (1 - pupil[..., None] * 0.97)
eye_im = save(np.clip(E, 0, 1) ** (1 / 2.2), f'villain_{VK}_eye')
# ---------------- 7. normal map: bump from the painted height, baked tangent-space on the head ----------------
mh_ = bpy.data.materials.new(f'villain_{VK}_head'); mh_.use_nodes = True; t = mh_.node_tree; bs = t.nodes['Principled BSDF']
ta = t.nodes.new('ShaderNodeTexImage'); ta.image = alb_im; t.links.new(ta.outputs[0], bs.inputs['Base Color'])
th_ = t.nodes.new('ShaderNodeTexImage'); th_.image = h_im; th_.interpolation = 'Cubic'
bump = t.nodes.new('ShaderNodeBump'); bump.inputs['Distance'].default_value = 0.0012; bump.inputs['Strength'].default_value = 1.0
t.links.new(th_.outputs[0], bump.inputs['Height']); t.links.new(bump.outputs[0], bs.inputs['Normal'])
bs.inputs['Roughness'].default_value = 0.55
me.materials.clear(); me.materials.append(mh_)
nim = newimg(f'villain_{VK}_head_normal', R, flt=False); tn = t.nodes.new('ShaderNodeTexImage'); tn.image = nim; t.nodes.active = tn
for o in bpy.data.objects: o.select_set(False)
h.select_set(True); bpy.context.view_layer.objects.active = h
sc.render.bake.normal_space = 'TANGENT'; bpy.ops.object.bake(type='NORMAL')
nim.scale(R // 2, R // 2); nim.filepath_raw = f'{TEX}/villain_{VK}_head_normal.png'; nim.file_format = 'PNG'; nim.save()
# final material: albedo + normal map (glTF-friendly)
for n in (th_, bump, tn): t.nodes.remove(n)
tnm = t.nodes.new('ShaderNodeTexImage'); tnm.image = bpy.data.images.load(f'{TEX}/villain_{VK}_head_normal.png'); tnm.image.colorspace_settings.name = 'Non-Color'
nmap = t.nodes.new('ShaderNodeNormalMap'); t.links.new(tnm.outputs[0], nmap.inputs['Color']); t.links.new(nmap.outputs[0], bs.inputs['Normal'])
ta.image = bpy.data.images.load(f'{TEX}/villain_{VK}_head_albedo.png')
me_ = bpy.data.materials.new(f'villain_{VK}_eye'); me_.use_nodes = True; t2 = me_.node_tree; b2 = t2.nodes['Principled BSDF']
te = t2.nodes.new('ShaderNodeTexImage'); te.image = bpy.data.images.load(f'{TEX}/villain_{VK}_eye.png'); t2.links.new(te.outputs[0], b2.inputs['Base Color'])
b2.inputs['Roughness'].default_value = 0.12
if CFG.get('glow'):  # glowing eyes (eye-beam hero): emissive iris
    GE = irisc * irf[..., None] * 1.6 + np.array([1.0, 0.8, 0.45]) * ss(0.75, 0.3, th)[..., None] * 0.25
    save(np.clip(GE, 0, 1) ** (1 / 2.2), f'villain_{VK}_eye_emit')
    tg = t2.nodes.new('ShaderNodeTexImage'); tg.image = bpy.data.images.load(f'{TEX}/villain_{VK}_eye_emit.png')
    t2.links.new(tg.outputs[0], b2.inputs['Emission Color']); b2.inputs['Emission Strength'].default_value = 3.0
dm.materials.append(mh_); dm.materials.append(me_)
for n in ('mhp', 'val', 'ao'):
    if n in bpy.data.images: bpy.data.images.remove(bpy.data.images[n])
bpy.data.materials.remove(mat)
json.dump({'eyes': {k: [list(map(float, v[0])), v[1]] for k, v in EYE.items()}}, open(f'{D}/villain_{VK}_head.json', 'w'))
print('TRIS head', sum(len(p.vertices) - 2 for p in me.polygons))
bpy.ops.wm.save_as_mainfile(filepath=f'{D}/villain_{VK}_head.blend')
print('DONE')
