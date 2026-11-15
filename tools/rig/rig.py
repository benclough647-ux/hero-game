# Build a humanoid armature for the A-pose body, auto-weight it, add cape/tail chains with procedural weights,
# parent the mohawk to the head bone. usage: blender -b --python rig.py -- tiger|cent
import bpy, sys, json, math, numpy as np, bmesh
from mathutils import Vector, Matrix
name = sys.argv[sys.argv.index('--')+1:][0]
J = json.load(open('/workspace/mx/joints.json'))[name]
bpy.ops.wm.open_mainfile(filepath=f'/workspace/hero-game-assets/mixamo/{name}_mixamo_work.blend')
body = bpy.data.objects[f'{name}_body']; cape = bpy.data.objects[f'cape_{name}']; moh = bpy.data.objects.get('Mohawk')
P = np.array([v.co[:] for v in body.data.vertices])
H = J['H']
# ---- arm landmarks in A-pose (the A-pose was made by rotating the upper arm about the shoulder by (apose - phi0) around Y)
def apose(s):
    S = Vector(J['shoulder']); S.x *= s; E = Vector(J['elbow']); E.x *= s; W = Vector(J['hand']); W.x *= s
    d = W - S; phi0 = math.atan2(abs(d.x), -d.z); ang = math.radians(J['apose']) - phi0
    R = Matrix.Translation(S) @ Matrix.Rotation(-s*ang, 4, 'Y') @ Matrix.Translation(-S)
    return S, R @ E, R @ W
def slab_centroid(c, axis, half, radius):
    d = P - np.array(c); t = d @ np.array(axis); perp = d - np.outer(t, axis)
    m = (abs(t) < half) & (np.linalg.norm(perp, axis=1) < radius)
    if m.sum() < 5: return Vector(c)
    Q = P[m]; return Vector(((Q.min(0) + Q.max(0)) / 2).tolist())  # bbox centre of the slab = centre of the limb
L = {}
for s, sd in ((1, 'L'), (-1, 'R')):   # model faces -Y, so the character's left is +X
    S, E0, W0 = apose(s)
    # arm straight from the mesh: vertices clearly outboard of the shoulder, axis by PCA
    am = (P[:, 0] * s > abs(S.x) + 0.04) & (P[:, 2] > 0.6)
    A_ = P[am]; c = A_.mean(0); u, sv, vt = np.linalg.svd(A_ - c); ax = Vector(vt[0].tolist())
    if ax.x * s < 0: ax = -ax
    t = (P - np.array(S[:])) @ np.array(ax[:]); perp = np.linalg.norm((P - np.array(S[:])) - np.outer(t, ax[:]), axis=1)
    rad = 0.17 if name == 'tiger' else 0.13
    tip = t[am & (perp < rad)].max()
    rE, rW, rH = (0.43, 0.76, 0.9)
    E2 = slab_centroid(S + ax * tip * rE, ax, 0.025, rad); W2 = slab_centroid(S + ax * tip * rW, ax, 0.025, rad)
    Hd = slab_centroid(S + ax * tip * rH, ax, 0.02, rad)
    S2 = slab_centroid(S, ax, 0.03, rad)
    S2 = Vector((S.x, S2.y, S.z))   # keep the authored shoulder height/width, centre depth
    print('ARM', sd, 'axis', [round(x, 3) for x in ax], 'length to tip', round(float(tip), 3))
    L[sd] = dict(S=S2, E=E2, W=W2, Hd=Hd)
    # legs
    lx = J['legx'] * s
    def legc(z):
        m = (abs(P[:, 2] - z) < 0.02) & (P[:, 0] * s > 0.01)
        Q = P[m]; return Vector((((Q[:, 0].min() + Q[:, 0].max()) / 2), (Q[:, 1].min() + Q[:, 1].max()) / 2, z))
    K = legc(J['kneez']); A = legc(J['anklez'] + 0.02)
    hipc = legc(J['hipz'] - 0.12); Hp = Vector((hipc.x * 0.85, hipc.y, J['hipz']))
    fm = (P[:, 2] < 0.06) & (P[:, 0] * s > 0.0); F = P[fm]
    # toe tip = low vertex farthest in front of the ankle (feet may be turned out)
    rel = F[:, :2] - np.array([A.x, A.y]); fwd = -rel[:, 1]; cand = F[fwd > 0.6 * fwd.max()]
    tipxy = cand[:, :2].mean(0); dvec = Vector((tipxy[0] - A.x, tipxy[1] - A.y, 0))
    toe = Vector((A.x, A.y, 0.03)) + dvec * 0.92; toe.z = 0.03
    ball = Vector((A.x, A.y, 0.04)) + dvec * 0.6; ball.z = 0.045
    L[sd].update(Hp=Hp, K=K, A=A, ball=ball, toe=toe)
def torso_y(z):
    m = (abs(P[:, 2] - z) < 0.02) & (abs(P[:, 0]) < 0.12)
    Q = P[m]; return float((Q[:, 1].min() + Q[:, 1].max()) / 2) if len(Q) else 0.0
hz, cz, nz, headz = J['hipz'], J['chestz'], J['neckz'], J['headz']
top = P[:, 2].max()
sp = [hz, hz + (cz - hz) * 0.45, cz, cz + (nz - cz) * 0.55, nz, headz, top]
spine = [Vector((0, torso_y(z), z)) for z in sp]
spine[-1] = Vector((0, spine[-2].y, top))
# ---- armature
arm = bpy.data.armatures.new(f'{name}_rig'); ao = bpy.data.objects.new(f'{name}_rig', arm); bpy.context.scene.collection.objects.link(ao)
bpy.context.view_layer.objects.active = ao
for x in bpy.context.view_layer.objects: x.select_set(False)
ao.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); eb = arm.edit_bones
def bone(n, h, t, parent=None, conn=False, deform=True):
    b = eb.new(n); b.head = Vector(h); b.tail = Vector(t)
    if parent: b.parent = eb[parent]; b.use_connect = conn
    b.use_deform = deform; return b
bone('root', (0, 0, 0), (0, 0.3, 0), deform=False)
names = ['hips', 'spine', 'chest', 'upper_chest', 'neck', 'head']
for i, n in enumerate(names): bone(n, spine[i], spine[i+1], 'root' if i == 0 else names[i-1], conn=i > 0 and n != 'neck')
for sd in 'LR':
    D = L[sd]; s = 1 if sd == 'L' else -1
    bone(f'shoulder.{sd}', (0.04 * s, spine[3].y, D['S'].z - 0.02), D['S'], 'upper_chest')
    bone(f'upper_arm.{sd}', D['S'], D['E'], f'shoulder.{sd}', True)
    bone(f'forearm.{sd}', D['E'], D['W'], f'upper_arm.{sd}', True)
    bone(f'hand.{sd}', D['W'], D['Hd'], f'forearm.{sd}', True)
    bone(f'thigh.{sd}', D['Hp'], D['K'], 'hips')
    bone(f'shin.{sd}', D['K'], D['A'], f'thigh.{sd}', True)
    bone(f'foot.{sd}', D['A'], D['ball'], f'shin.{sd}', True)
    bone(f'toe.{sd}', D['ball'], D['toe'], f'foot.{sd}', True)
# ---- cape chains: sample the cape mid-surface along 3 vertical lines
C = np.array([v.co[:] for v in cape.data.vertices])
czmax, czmin = C[:, 2].max(), C[:, 2].min()
xs = np.array([-1, 0, 1]) * (0.27 if name == 'tiger' else 0.22)
NSEG = 4
z0 = czmax - (0.13 if name == 'tiger' else 0.12)   # pinned band above z0 follows the upper chest
zs = np.linspace(z0, czmin + 0.02, NSEG + 1)
def cape_pt(x, z):
    m = (abs(C[:, 2] - z) < 0.05) & (abs(C[:, 0] - x) < 0.09)
    if name == 'tiger': m &= ~((abs(C[:, 0]) < 0.1) & (C[:, 1] > 0.42) & (C[:, 2] < 0.75))   # skip the tail lump
    Q = C[m]; return Vector((x, float(np.median(Q[:, 1])), z)) if len(Q) else Vector((x, 0.25, z))
chains = {}
for ci, x in zip('RML', xs):   # -X is the character's right
    pts = [cape_pt(x, z) for z in zs]; chains[ci] = pts
    for i in range(NSEG): bone(f'cape_{ci}{i+1}', pts[i], pts[i+1], 'upper_chest' if i == 0 else f'cape_{ci}{i}', conn=i > 0)
tail = None
if name == 'tiger':
    m = (abs(C[:, 0]) < 0.1) & (C[:, 1] > 0.42) & (C[:, 2] < 0.75); T = C[m]
    tz = np.linspace(T[:, 2].max(), T[:, 2].min() + 0.01, 4)
    tail = [Vector((0, float(np.median(T[abs(T[:, 2] - z) < 0.05][:, 1])), z)) for z in tz]
    seg = max(0, min(NSEG - 1, int(np.searchsorted(-zs, -tail[0].z)) - 1))
    tail_parent = f'cape_M{seg+1}'; print('TAIL parent', tail_parent)
    for i in range(3): bone(f'tail{i+1}', tail[i], tail[i+1], tail_parent if i == 0 else f'tail{i}', conn=i > 0)
for b in eb: b.roll = 0
# arm rolls: align X axis to world Y-ish for predictability
bpy.ops.object.mode_set(mode='OBJECT')
# ---- body: automatic weights with only body bones deforming
cape_bones = [b.name for b in arm.bones if b.name.startswith(('cape_', 'tail'))]
for n in cape_bones: arm.bones[n].use_deform = False
for x in bpy.context.view_layer.objects: x.select_set(False)
body.select_set(True); ao.select_set(True); bpy.context.view_layer.objects.active = ao
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for n in cape_bones: arm.bones[n].use_deform = True
me = body.data
unw = [v.index for v in me.vertices if sum(g.weight for g in v.groups) < 1e-4]
print('BODY unweighted verts after heat:', len(unw), 'of', len(me.vertices))
gi = {g.name: g.index for g in body.vertex_groups}
nb = len(body.vertex_groups); W = np.zeros((len(P), nb))
for v in me.vertices:
    for g in v.groups: W[v.index, g.group] = g.weight
bones = {b.name: (np.array(b.head_local[:]), np.array(b.tail_local[:])) for b in arm.bones if b.use_deform and b.name in gi}
def segd(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)
D = {n: segd(P, *bones[n]) for n in bones}
if len(unw) > 0.02 * len(P) or W.sum() == 0:
    # heat failed: fall back to an envelope-style inverse-distance weighting
    print('HEAT FAILED -> distance weights')
    for n, j in gi.items():
        if n in D: W[:, j] = 1.0 / (D[n] + 0.02) ** 4
else:
    for i in unw:
        best = min(D, key=lambda n: D[n][i]); W[i, gi[best]] = 1
# keep limb bones local (prevents arms dragging the torso / legs dragging each other)
lim = {'upper_arm': 0.17, 'forearm': 0.15, 'hand': 0.14, 'thigh': 0.2, 'shin': 0.16, 'foot': 0.2, 'toe': 0.2}
sc = 1.25 if name == 'tiger' else 1.0
for sd in 'LR':
    for k, r in lim.items():
        n = f'{k}.{sd}'
        if n in gi: r *= sc; fade = np.clip((D[n] - r * 0.7) / (r * 0.3), 0, 1); W[:, gi[n]] *= (1 - fade)
# left/right separation for legs: a left-leg bone never weights a right-side vertex (crotch bleed)
for sd, s in (('L', 1), ('R', -1)):
    for k in ('thigh', 'shin', 'foot', 'toe'):
        n = f'{k}.{sd}'; W[P[:, 0] * s < -0.03, gi[n]] = 0
for sd in 'LR':
    a_z = arm.bones[f'foot.{sd}'].head_local.z
    low = P[:, 2] < a_z - 0.015
    W[low, gi[f'foot.{sd}']] += W[low, gi[f'shin.{sd}']]; W[low, gi[f'shin.{sd}']] = 0
def adjacency(mesh):
    E = np.array([e.vertices[:] for e in mesh.edges]); n = len(mesh.vertices)
    deg = np.bincount(E.ravel(), minlength=n).astype(float); deg[deg == 0] = 1
    return E, deg
def smooth_w(W, E, deg, it, keep=0.5):
    for _ in range(it):
        S = np.zeros_like(W); np.add.at(S, E[:, 0], W[E[:, 1]]); np.add.at(S, E[:, 1], W[E[:, 0]])
        W = keep * W + (1 - keep) * S / deg[:, None]
    return W
Aj, dg_ = adjacency(me)
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
W = smooth_w(W, Aj, dg_, 4)
for sd, s in (('L', 1), ('R', -1)):
    for k in ('thigh', 'shin', 'foot', 'toe'):
        n = f'{k}.{sd}'; W[P[:, 0] * s < -0.03, gi[n]] = 0
tot = W.sum(1); zero = tot < 1e-6
for i in np.where(zero)[0]:
    best = min(D, key=lambda n: D[n][i]); W[i, gi[best]] = 1
print('fallback-assigned verts', int(zero.sum()))
W /= W.sum(1, keepdims=True)
# limit to 4 influences
idx = np.argsort(-W, axis=1); keep = np.zeros_like(W, bool); np.put_along_axis(keep, idx[:, :4], True, axis=1)
W[~keep] = 0; W[W < 0.01] = 0; W /= W.sum(1, keepdims=True)
for j, g in enumerate(body.vertex_groups):
    g.remove(list(range(len(P))))
for j, g in enumerate(body.vertex_groups):
    nz = np.where(W[:, j] > 0)[0]
    for i in nz: g.add([int(i)], float(W[i, j]), 'REPLACE')
# ---- cape weights (procedural): pinned band -> upper_chest, below: lateral gaussian over chains x vertical blend
cw = {}
def addw(n, i, w):
    if w > 1e-3: cw.setdefault(n, {})[i] = cw.get(n, {}).get(i, 0) + w
sig = (xs[2] - xs[1]) * 0.75
mids = [(zs[i] + zs[i+1]) / 2 for i in range(NSEG)]
for i, (x, y, z) in enumerate(C):
    lat = np.exp(-((x - xs) / sig) ** 2); lat /= lat.sum()
    pin = np.clip((z - z0) / 0.08 + 0.5, 0, 1)     # 1 at/above the shoulders
    if pin > 0: addw('upper_chest', i, pin)
    rest = 1 - pin
    if rest <= 0: continue
    # vertical: linear blend between neighbouring segment midpoints (top segment holds near z0)
    if z >= mids[0]: segw = {0: 1.0}
    elif z <= mids[-1]: segw = {NSEG - 1: 1.0}
    else:
        k = max(j for j in range(NSEG) if mids[j] >= z); f = (mids[k] - z) / (mids[k] - mids[k+1]); segw = {k: 1 - f, k + 1: f}
    for ci, lw in zip('RML', lat):
        for k, sw in segw.items(): addw(f'cape_{ci}{k+1}', i, rest * lw * sw)
if tail:
    tzs = [t.z for t in tail]
    for i, (x, y, z) in enumerate(C):
        # tail lump: distance from the tail line, blended in smoothly
        if z > tzs[0] + 0.05: continue
        ty = np.interp(z, tzs[::-1], [t.y for t in tail][::-1])
        dd = math.hypot(x, max(0.0, ty - y) * 0.6)
        wt = float(np.clip(1 - (dd - 0.05) / 0.06, 0, 1)) * (1.0 if y > 0.36 else 0.0) * float(np.clip((tzs[0] + 0.05 - z) / 0.1, 0, 1))
        if wt <= 0: continue
        for n in list(cw):
            if i in cw[n]: cw[n][i] *= (1 - wt)
        k = 0 if z > (tzs[0] + tzs[1]) / 2 else (1 if z > (tzs[1] + tzs[2]) / 2 else 2)
        addw(f'tail{k+1}', i, wt)
gn = sorted(cw); CW = np.zeros((len(C), len(gn)))
for j, n in enumerate(gn):
    for i, w in cw[n].items(): CW[i, j] = w
Ac, dc = adjacency(cape.data); CW /= np.maximum(CW.sum(1, keepdims=True), 1e-9); CW = smooth_w(CW, Ac, dc, 6)
cw = {n: {int(i): float(CW[i, j]) for i in np.where(CW[:, j] > 1e-3)[0]} for j, n in enumerate(gn)}
cape.parent = ao; cape.vertex_groups.clear()
for n, d in cw.items():
    g = cape.vertex_groups.new(name=n)
    for i, w in d.items(): g.add([i], w, 'REPLACE')
md = cape.modifiers.new('Armature', 'ARMATURE'); md.object = ao
# normalise + limit 4
for v in cape.data.vertices:
    gs = sorted(v.groups, key=lambda g: -g.weight); s = sum(g.weight for g in gs[:4]) or 1
    for k, g in enumerate(gs):
        if k >= 4: cape.vertex_groups[g.group].remove([v.index])
        else: g.weight /= s
# ---- mohawk rides on the head bone (rigid child, so the game can keep flickering it)
if moh:
    mw = moh.matrix_world.copy(); moh.parent = ao; moh.parent_type = 'BONE'; moh.parent_bone = 'head'
    bpy.context.view_layer.update(); moh.matrix_world = mw
print('BONES', len(arm.bones), [b.name for b in arm.bones])
print('LANDMARKS', {k: {kk: [round(c, 3) for c in vv] for kk, vv in v.items()} for k, v in L.items()})
bpy.ops.wm.save_as_mainfile(filepath=f'/workspace/hero-game-assets/rig/{name}_rigged.blend')
print('SAVED')
