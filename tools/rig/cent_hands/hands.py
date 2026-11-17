# Centurion hands v2: realistic adult-male gloved hands (palm, knuckles, separate jointed fingers + thumb, slight taper) replacing
# the bulky mitten hands. Re-places the finger bones to real proportions (hand ~0.19 m, palm ~0.085 m wide for 1.83 m), builds new
# hand geometry skinned to hand / finger bones (white glove texel of the body atlas), joins it into cent_body (so LOD1 decimates it),
# and fixes the palm_L/R markers (palm centre, used by js/heroes.js for the finger-curl axes).
# usage: blender -b --python hands.py -- <src blend name> <out blend name>   (files in hero-game-assets/rig)
import bpy, bmesh, sys, math, numpy as np
from mathutils import Vector, Matrix
a_ = sys.argv[sys.argv.index('--') + 1:]; SRC, OUT = a_[0], a_[1]
RIG = '/workspace/hero-game-assets/rig'
bpy.ops.wm.open_mainfile(filepath=f'{RIG}/{SRC}.blend')
ao = bpy.data.objects['cent_rig']; ao.animation_data.action = None
for pb in ao.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.context.view_layer.update()
body = bpy.data.objects['cent_body']; me = body.data
FING = ['index', 'middle', 'ring', 'pinky']
# real proportions (m): knuckle distance from the wrist along the hand axis, offset across (+ = index side), finger length, base radius
KN = {'index': (0.094, 0.029, 0.074, 0.0103), 'middle': (0.099, 0.0095, 0.083, 0.0106), 'ring': (0.095, -0.0105, 0.077, 0.0099), 'pinky': (0.086, -0.0285, 0.060, 0.0087)}
SEG1 = 0.46   # proximal phalanx share of the finger (bone 1); bone 2 = middle + distal
# ---------- 1. bones ----------
bpy.context.view_layer.objects.active = ao
for o in bpy.data.objects: o.select_set(o == ao)
bpy.ops.object.mode_set(mode='EDIT'); EB = ao.data.edit_bones
FR = {}
for sd in ('L', 'R'):
    h = EB['hand.' + sd]; W = h.head.copy()
    a = (EB['middle1.' + sd].head - W).normalized()
    b = (EB['index1.' + sd].head - EB['pinky1.' + sd].head); b = (b - a * b.dot(a)).normalized()
    n = a.cross(b); sx = 1 if W.x > 0 else -1
    if n.dot(Vector((-sx, 0, 0))) < 0: n = -n            # palm faces the thigh in the rest pose
    FR[sd] = (W, a, b, n)
    for f in FING:
        L, B, ln, r = KN[f]; b1, b2 = EB[f + '1.' + sd], EB[f + '2.' + sd]
        d1 = (b1.tail - b1.head).normalized(); d2 = (b2.tail - b2.head).normalized()
        d1 = (d1 * 0.3 + a * 0.7).normalized(); d2 = (d2 * 0.3 + a * 0.7).normalized()   # straighter, fingers together
        k = W + a * L + b * B
        b1.head = k; b1.tail = k + d1 * ln * SEG1; b2.head = b1.tail; b2.tail = b2.head + d2 * ln * (1 - SEG1)
    t1, t2 = EB['thumb1.' + sd], EB['thumb2.' + sd]
    tb = W + a * 0.034 + b * 0.031 + n * 0.006
    td = (a * 0.985 + b * 0.10 + n * 0.10).normalized()   # rest: lying flat along the side of the index finger (flight blade ref)             # thumb points along the index side, a little toward the palm
    t1.head = tb; t1.tail = tb + td * 0.036; t2.head = t1.tail; t2.tail = t2.head + (td * 0.5 + a * 0.5 - b * 0.04).normalized() * 0.048
BONES = {sd: {nm: (EB[nm + '.' + sd].head.copy(), EB[nm + '.' + sd].tail.copy()) for nm in ['hand', 'forearm', 'thumb1', 'thumb2'] + [f + s for f in FING for s in '12']} for sd in ('L', 'R')}
bpy.ops.object.mode_set(mode='OBJECT')
# ---------- 2. remove the mitten (verts mostly weighted to hand / finger bones) and pick a glove texel ----------
gi = {g.name: g.index for g in body.vertex_groups}
def hand_w(v, sd):
    return sum(g.weight for g in v.groups if body.vertex_groups[g.group].name.endswith('.' + sd) and body.vertex_groups[g.group].name.split('.')[0].rstrip('12') in ('hand', 'thumb', 'index', 'middle', 'ring', 'pinky'))
kill = {v.index for v in me.vertices if hand_w(v, 'L') > 0.5 or hand_w(v, 'R') > 0.5}
uvl = me.uv_layers.active.data; img = None
for nd in body.material_slots[0].material.node_tree.nodes:
    if nd.type == 'TEX_IMAGE' and nd.outputs[0].links and any(l.to_socket.name == 'Base Color' for l in nd.outputs[0].links): img = nd.image
px = np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4); cands = []
for p in me.polygons:
    if all(v in kill for v in p.vertices):
        for li in p.loop_indices:
            u, v = uvl[li].uv; c = px[min(img.size[1] - 1, int(v * img.size[1])), min(img.size[0] - 1, int(u * img.size[0])), :3]; cands.append((float(c.mean()), float(c.std()), (u, v)))
cands.sort(key=lambda c: -c[0] + 3 * c[1]); GUV = cands[len(cands) // 10][2]
print('GLOVE texel', GUV, 'colour', round(cands[len(cands) // 10][0], 3), 'from', len(cands))
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.verts[i] for i in kill], context='VERTS'); bm.to_mesh(me); bm.free()
print('MITTEN verts removed', len(kill))
# ---------- 3. new hands ----------
nb = bmesh.new(); uvn = nb.loops.layers.uv.new('UVMap'); dl = nb.verts.layers.deform.verify()
def gidx(name):
    if name not in gi: g = body.vertex_groups.new(name=name); gi[name] = g.index
    return gi[name]
def ring(c, X, Y, rx, ry, nseg=10, e=2.6, bumps=None):
    vs = []
    for i in range(nseg):
        th = 2 * math.pi * i / nseg; cx, cy = math.cos(th), math.sin(th)
        sx = math.copysign(abs(cx) ** (2 / e), cx); sy = math.copysign(abs(cy) ** (2 / e), cy)
        p = c + X * (sx * rx) + Y * (sy * ry)
        if bumps: p = p + bumps(th, sx, sy)
        vs.append(nb.verts.new(p))
    return vs
def bridge(r0, r1):
    n = len(r0)
    for i in range(n):
        f = nb.faces.new([r0[i], r0[(i + 1) % n], r1[(i + 1) % n], r1[i]])
        for l in f.loops: l[uvn].uv = GUV
def cap(r, tip):
    v = nb.verts.new(tip); n = len(r)
    for i in range(n):
        f = nb.faces.new([r[i], r[(i + 1) % n], v])
        for l in f.loops: l[uvn].uv = GUV
    return v
def weigh(vs, wd):
    for v in vs:
        for name, w in wd.items():
            if w > 1e-3: v[dl][gidx(name)] = w
def ssf(a, b, x): t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
for sd in ('L', 'R'):
    W, a, b, n = FR[sd]; Bn = BONES[sd]; fa = lambda nm: nm + '.' + sd
    # palm: rounded box lofted wrist -> knuckles (tapers in at the wrist), thenar pad on the thumb side, knuckle bumps on the back
    prev = None; T = [-0.012, 0.0, 0.015, 0.032, 0.050, 0.066, 0.080, 0.090, 0.097]
    for t in T:
        u = ssf(0.0, 0.085, t)
        wd = 0.029 + 0.0135 * u; th = 0.0150 - 0.0018 * u
        def bumps(ang, sx, sy, t=t):
            off = Vector((0, 0, 0))
            if sy > 0.2 and sx > -0.1: off += n * (0.006 * sy * math.exp(-((t - 0.035) / 0.022) ** 2) * ssf(-0.1, 0.6, sx))   # thenar pad (palm side, thumb side)
            if sy > 0.3 and sx < 0.2: off += n * (0.003 * sy * math.exp(-((t - 0.04) / 0.03) ** 2))                            # hypothenar
            if sy < -0.3: off += -n * (0.0022 * (-sy) * math.exp(-((t - 0.092) / 0.008) ** 2) * (0.6 + 0.4 * math.cos(sx * 9.4) ** 2))  # knuckles
            return off
        rv = ring(W + a * t + n * 0.0015, b, n, wd, th, 12, 3.2, bumps)
        tw = ssf(0.012, -0.008, t)
        weigh(rv, {fa('hand'): 1 - 0.45 * tw, fa('forearm'): 0.45 * tw})
        if prev: bridge(prev, rv)
        prev = rv
    tip = W + a * 0.104 + n * 0.0005; cv = cap(prev, tip); weigh([cv], {fa('hand'): 1.0})
    # fingers: tapered tubes along the bone chain, joint bulges, rounded tips
    for f in FING:
        L, B, ln, r0 = KN[f]; h1, t1 = Bn[f + '1']; h2, t2 = Bn[f + '2']
        pts = [h1 - (t1 - h1).normalized() * 0.010, h1, t1, h2 + (t2 - h2) * 0.55, t2]
        prev = None; segs = []
        for i in range(len(pts) - 1):
            p0, p1 = pts[i], pts[i + 1]; nn = 3 if i > 0 else 1
            for j in range(nn + (1 if i == len(pts) - 2 else 0)):
                s = j / nn; segs.append((p0.lerp(p1, s), i + s))
        for p, s in segs:
            ax = (pts[min(len(pts) - 1, int(s) + 1)] - pts[int(min(s, len(pts) - 2))]).normalized()
            Y = (n - ax * n.dot(ax)).normalized(); X = ax.cross(Y)
            taper = 1 - 0.22 * min(1, max(0, (s - 1) / 3)); joint = 1 + 0.07 * (math.exp(-((s - 2) / 0.18) ** 2) + math.exp(-((s - 3) / 0.18) ** 2))
            r = r0 * taper * joint
            rv = ring(p, X, Y, r, r * 0.88, 8, 2.3)
            w2 = ssf(1.82, 2.18, s); w1 = ssf(0.6, 1.25, s) * (1 - w2)
            weigh(rv, {fa('hand'): 1 - w1 - w2, fa(f + '1'): w1, fa(f + '2'): w2})
            if prev: bridge(prev, rv)
            prev = rv
        cv = cap(prev, pts[-1] + (pts[-1] - pts[-2]).normalized() * r0 * 0.7); weigh([cv], {fa(f + '2'): 1.0})
    # thumb
    h1, t1 = Bn['thumb1']; h2, t2 = Bn['thumb2']
    pts = [h1 - (t1 - h1).normalized() * 0.012, h1, t1, h2 + (t2 - h2) * 0.5, t2]; prev = None; segs = []
    for i in range(len(pts) - 1):
        nn = 3 if i > 0 else 1
        for j in range(nn + (1 if i == len(pts) - 2 else 0)): segs.append((pts[i].lerp(pts[i + 1], j / nn), i + j / nn))
    for p, s in segs:
        ax = (pts[min(len(pts) - 1, int(s) + 1)] - pts[int(min(s, len(pts) - 2))]).normalized()
        Y = (n - ax * n.dot(ax)).normalized(); X = ax.cross(Y)
        r = 0.0125 * (1 - 0.25 * min(1, max(0, (s - 1) / 3))) * (1.25 if s < 1.4 else 1.0)
        rv = ring(p, X, Y, r, r * 0.86, 8, 2.3)
        w2 = ssf(1.8, 2.2, s); w1 = ssf(0.3, 1.2, s) * (1 - w2)
        weigh(rv, {fa('hand'): 1 - w1 - w2, fa('thumb1'): w1, fa('thumb2'): w2})
        if prev: bridge(prev, rv)
        prev = rv
    cv = cap(prev, pts[-1] + (pts[-1] - pts[-2]).normalized() * 0.008); weigh([cv], {fa('thumb2'): 1.0})
bmesh.ops.recalc_face_normals(nb, faces=nb.faces[:])
hm = bpy.data.meshes.new('cent_hand_v2'); nb.to_mesh(hm); nb.free()
for p in hm.polygons: p.use_smooth = True
ho = bpy.data.objects.new('cent_hand_v2', hm); bpy.context.scene.collection.objects.link(ho)
for g in body.vertex_groups: ho.vertex_groups.new(name=g.name)
# copy the deform layer weights: bmesh used body group indices -> same names/order in ho
ho.data.materials.append(body.material_slots[0].material)
print('HAND tris', sum(len(p.vertices) - 2 for p in hm.polygons))
for o in bpy.data.objects: o.select_set(o in (body, ho))
bpy.context.view_layer.objects.active = body; bpy.ops.object.join()
# ---------- 4. palm markers: palm centre, a little out from the palm surface ----------
for sd in ('L', 'R'):
    W, a, b, n = FR[sd]; e = bpy.data.objects.get('palm_' + sd)
    if e is None: continue
    hb = ao.pose.bones['hand.' + sd]; M = ao.matrix_world @ hb.matrix
    e.parent = ao; e.parent_type = 'BONE'; e.parent_bone = 'hand.' + sd; bpy.context.view_layer.update()
    m = e.matrix_world.copy(); m.translation = W + a * 0.058 + n * 0.022; e.matrix_world = m; bpy.context.view_layer.update()
    print('PALM', sd, [round(x, 4) for x in e.matrix_world.translation], 'local', [round(x, 4) for x in e.location])
bpy.ops.wm.save_as_mainfile(filepath=f'{RIG}/{OUT}.blend')
print('DONE')
