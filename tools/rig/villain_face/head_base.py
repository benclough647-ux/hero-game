# Base head for the villains: MakeHuman hm08 (CC0) head + neck topology, male / muscular macro, every face slider as
# shape keys (+ / - per slider), fitted to Centurion's head (crown z 1.83, nose tip z 1.686 / y -0.163), eyeballs.
# usage: blender -b --python head_base.py      -> /workspace/hero-game-assets/villain_face/base_head.blend
import bpy, bmesh, sys, os, json, numpy as np
sys.path.insert(0, os.path.dirname(__file__)); import mhlib
OUTD = '/workspace/hero-game-assets/villain_face'; os.makedirs(OUTD, exist_ok=True)
V0, VT, F, FT, G = mhlib.load_obj()
# macro: caucasian male ~38 y, max muscle, average weight (MakeHuman weighting: age 0.5 = 25 y, 1.0 = 90 y)
old = 0.2; young = 1 - old
MACRO = [('macrodetails/caucasian-male-young', young), ('macrodetails/caucasian-male-old', old),
         ('macrodetails/universal-male-young-maxmuscle-averageweight', young), ('macrodetails/universal-male-old-maxmuscle-averageweight', old)]
V = V0.copy()
for n, w in MACRO: V = mhlib.apply(V, n, w)
CUT = None
_c = V[(np.abs(V[:, 0]) < 0.02) & (V[:, 1] > 6.5)]; _nose_y = _c[_c[:, 2].argmax(), 1]
CUT = float(_nose_y - 1.75)   # ~0.167 m below the nose tip in game units: down inside the high collar
fsel = [i for i, (f, g) in enumerate(zip(F, G)) if g == 'body' and V[f, 1].min() > CUT]
used = np.unique(np.concatenate([F[i] for i in fsel])); remap = {int(o): n for n, o in enumerate(used)}
# fit: MH (x, y up, z front, dm) -> game (x, -z, y) metres, crown -> 1.83, nose tip -> (z 1.686, y -0.163)
P = V[used]; cen = P[np.abs(P[:, 0]) < 0.02]
nose = cen[cen[:, 2].argmax()]; crown = P[P[:, 1].argmax()]
S = (1.83 - 1.686) / (crown[1] - nose[1])
def to_game(p): p = np.atleast_2d(p); return np.stack([p[:, 0] * S, -(p[:, 2] - nose[2]) * S - 0.163, (p[:, 1] - nose[1]) * S + 1.686], 1)
def d_game(d): d = np.atleast_2d(d); return np.stack([d[:, 0] * S, -d[:, 2] * S, d[:, 1] * S], 1)
print('SCALE', S)
me = bpy.data.meshes.new('VHead'); bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
G0 = to_game(V[used]); bv = [bm.verts.new(tuple(p)) for p in G0]
for i in fsel:
    f = bm.faces.new([bv[remap[int(v)]] for v in F[i]])
    for l, t in zip(f.loops, FT[i]): l[uvl].uv = tuple(VT[t])
bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
ob = bpy.data.objects.new('VHead', me); bpy.context.scene.collection.objects.link(ob)
# MH-space rest position (base, after macro) kept as an attribute: a stable parametric frame for painting / sculpt masks
a = me.attributes.new('mhpos', 'FLOAT_VECTOR', 'POINT'); a.data.foreach_set('vector', V[used].ravel())
# ---------------- sliders (shape keys) ----------------
def lr(n): return [n.replace('?', 'l'), n.replace('?', 'r')]
SL = {  # slider: (+ targets, - targets) with weights
 'jaw_width':   ([('chin/chin-width-incr', .6), ('head/head-square', .6)], [('chin/chin-width-decr', 1)]),
 'chin':        ([('chin/chin-prominent-incr', 1), ('chin/chin-height-incr', .5), ('chin/chin-bones-incr', .6)], [('chin/chin-prominent-decr', 1), ('chin/chin-height-decr', .5)]),
 'chin_cleft':  ([('chin/chin-cleft-incr', 1)], [('chin/chin-cleft-decr', 1)]),
 'cheekbones':  ([(t, 1) for t in lr('cheek/?-cheek-bones-incr')] + [(t, .5) for t in lr('cheek/?-cheek-volume-decr')], [(t, 1) for t in lr('cheek/?-cheek-bones-decr')]),
 'brow_ridge':  ([('eyebrows/eyebrows-trans-forward', 1), ('forehead/forehead-nubian-incr', .5), ('eyebrows/eyebrows-trans-down', .4)], [('eyebrows/eyebrows-trans-backward', 1)]),
 'brow_angle':  ([('eyebrows/eyebrows-angle-down', 1)], [('eyebrows/eyebrows-angle-up', 1)]),
 'nose_length': ([('nose/nose-scale-vert-incr', 1)], [('nose/nose-scale-vert-decr', 1)]),
 'nose_width':  ([('nose/nose-scale-horiz-incr', .6), ('nose/nose-flaring-incr', .6), ('nose/nose-point-width-incr', .5)], [('nose/nose-scale-horiz-decr', 1)]),
 'nose_hump':   ([('nose/nose-hump-incr', 1)], [('nose/nose-hump-decr', 1)]),
 'nose_depth':  ([('nose/nose-scale-depth-incr', 1)], [('nose/nose-scale-depth-decr', 1)]),
 'eye_narrow':  ([(t, 1) for t in lr('eyes/?-eye-height2-decr')] + [(t, .6) for t in lr('eyes/?-eye-eyefold-down')], [(t, 1) for t in lr('eyes/?-eye-height2-incr')]),
 'eye_tilt':    ([(t, 1) for t in lr('eyes/?-eye-corner2-up')], [(t, 1) for t in lr('eyes/?-eye-corner2-down')]),
 'eye_bags':    ([(t, 1) for t in lr('eyes/?-eye-bag-incr')], [(t, 1) for t in lr('eyes/?-eye-bag-decr')]),
 'lips':        ([('mouth/mouth-upperlip-volume-incr', 1), ('mouth/mouth-lowerlip-volume-incr', 1)], [('mouth/mouth-upperlip-volume-decr', 1), ('mouth/mouth-lowerlip-volume-decr', 1)]),
 'mouth_width': ([('mouth/mouth-scale-horiz-incr', 1)], [('mouth/mouth-scale-horiz-decr', 1)]),
 'face_length': ([('head/head-scale-vert-incr', 1)], [('head/head-scale-vert-decr', 1)]),
 'head_width':  ([('head/head-scale-horiz-incr', 1)], [('head/head-scale-horiz-decr', 1)]),
 'temples':     ([('forehead/forehead-temple-decr', 1)], [('forehead/forehead-temple-incr', 1)]),
 'neck_thick':  ([('neck/neck-scale-horiz-incr', 1), ('neck/neck-scale-depth-incr', 1)], [('neck/neck-scale-horiz-decr', 1)]),
 'age':         ([('head/head-age-incr', 1)], [('head/head-age-decr', 1)]),
 'scowl':       ([(f'expression/units/caucasian/eyebrows-{s}-down', 1) for s in ('left', 'right')], [(f'expression/units/caucasian/eyebrows-{s}-up', 1) for s in ('left', 'right')]),
 'sneer':       ([('expression/units/caucasian/mouth-depression', 1)], [('expression/units/caucasian/mouth-elevation', 1)]),
}
ob.shape_key_add(name='Basis', from_mix=False)
N = len(used); used_idx = {int(o): n for n, o in enumerate(used)}
def delta(tlist):
    D = np.zeros((N, 3))
    for t, w in tlist:
        i, d = mhlib.target(t)
        for k, dd in zip(i, d):
            n = used_idx.get(int(k))
            if n is not None: D[n] += dd * w
    return d_game(D)
for s, (plus, minus) in SL.items():
    for sign, tl in (('+', plus), ('-', minus)):
        D = delta(tl); kb = ob.shape_key_add(name=f'{s}{sign}', from_mix=False)
        kb.data.foreach_set('co', (G0 + D).astype(np.float32).ravel()); kb.slider_min = 0; kb.slider_max = 2
        print('KEY', kb.name, 'max mm', round(float(np.abs(D).max()) * 1000, 2))
# eyeballs (MakeHuman eye helpers give centre + size)
eyes = {}
for sd, g in (('L', 'helper-l-eye'), ('R', 'helper-r-eye')):
    vi = np.unique(np.concatenate([f for f, gg in zip(F, G) if gg == g])); E = V[vi]
    c = to_game(E.mean(0))[0]; r = float((E.max(0) - E.min(0)).mean() / 2 * S)
    eyes[sd] = dict(c=c.tolist(), r=r, mh=E.mean(0).tolist())
# landmarks in MH base space for later passes
lm = dict(S=S, nose_mh=nose.tolist(), crown_mh=crown.tolist(), eyes=eyes, cut=CUT, n=int(N))
json.dump(lm, open(f'{OUTD}/base_head.json', 'w'), indent=1)
np.save(f'{OUTD}/base_used.npy', used)
print('TRIS', sum(len(p.vertices) - 2 for p in me.polygons), 'VERTS', len(me.vertices), 'EYES', eyes)
bpy.ops.wm.save_as_mainfile(filepath=f'{OUTD}/base_head.blend')
