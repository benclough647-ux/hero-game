# Add finger bones + finger geometry to a hero's hands (the TRELLIS meshes have mitten-like hand blobs, no fingers).
# Per hand: index/middle/ring/pinky (2 segments each) + thumb (2 segments), parented to hand.L/R, rolled so local Z points out
# of the palm (curl = +X rotation). The front of the hand blob is reweighted to the middle finger so it folds with the fist,
# and capsule fingers are added to the body mesh (UVs/material copied from the nearest hand vertex, rigid to their bone).
# A 'palm_L'/'palm_R' empty (palm centre, +0.06 m along the palm normal) is parented to each hand bone for the game.
# usage: blender -b --python fingers.py -- tiger|cent      (edits {name}_anim_face.blend in place; backup *_prefingers.blend)
import bpy, bmesh, sys, math, shutil
import numpy as np
from mathutils import Vector, Matrix, kdtree
name = sys.argv[sys.argv.index('--')+1:][0]
SRC = f'/workspace/hero-game-assets/rig/{name}_anim_face.blend'
bak = SRC.replace('.blend', '_prefingers.blend')
import os
if not os.path.exists(bak): shutil.copy(SRC, bak)
bpy.ops.wm.open_mainfile(filepath=bak)  # always rebuild from the pre-finger file (idempotent)
ao = bpy.data.objects[f'{name}_rig']; arm = ao.data; body = bpy.data.objects[f'{name}_body']
TIGER = name == 'tiger'
AW = ao.matrix_world; BW = body.matrix_world; BWi = BW.inverted()
FINGERS = ['index', 'middle', 'ring', 'pinky']
info = {}
me = body.data
for sd in 'LR':
    hb = arm.bones[f'hand.{sd}']; M = AW @ hb.matrix_local; R = M.to_3x3().normalized(); O = M.translation
    gi = body.vertex_groups[f'hand.{sd}'].index
    vs = [v for v in me.vertices if any(g.group == gi and g.weight > 0.45 for g in v.groups)]
    P = np.array([list(R.inverted() @ ((BW @ v.co) - O)) for v in vs])  # hand-bone local (x, y along bone, z)
    y0, y1 = P[:, 1].min(), P[:, 1].max()
    C = P[:, [0, 2]] - P[:, [0, 2]].mean(0); w, U = np.linalg.eigh(np.cov(C.T))  # ascending: thickness first
    th2, wd2 = Vector((U[0, 0], 0, U[1, 0])), Vector((U[0, 1], 0, U[1, 1]))
    ctr = Vector((P[:, 0].mean(), 0, P[:, 2].mean()))
    # palm faces the body midline in the A-pose rest; thumb on the forward (-Y armature) side
    to_mid = R.inverted() @ Vector((-(O.x), 0, 0)).normalized()
    palm = th2 if th2.dot(to_mid) > 0 else -th2
    fwd = R.inverted() @ Vector((0, -1, 0))
    thumbSide = wd2 if wd2.dot(fwd) > 0 else -wd2
    proj = lambda a: float(np.abs(C @ np.array([a.x, a.z])).max())
    width, thick = 2 * proj(wd2), 2 * proj(th2)
    yk = y0 + 0.5 * (y1 - y0); L = max(0.05, (y1 - yk) * (1.25 if TIGER else 1.15))
    info[sd] = dict(R=R, O=O, palm=palm, thumb=thumbSide, ctr=ctr, width=width, thick=thick, yk=yk, y0=y0, y1=y1, L=L, verts=[v.index for v in vs], P=P)
    print('HAND', sd, 'verts', len(vs), 'len', round(y1 - y0, 3), 'width', round(width, 3), 'thick', round(thick, 3), 'palm', tuple(round(c, 2) for c in palm))
# ---- bones ----
bpy.context.view_layer.objects.active = ao; ao.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.edit_bones; AWi = AW.inverted()
segs = {}
for sd in 'LR':
    I = info[sd]; R, O = I['R'], I['O']; Y = Vector((0, 1, 0))
    toA = lambda p: AWi @ (O + R @ p)  # hand-local -> armature space
    palmA = (AWi.to_3x3() @ (R @ I['palm'])).normalized()
    fw = I['width'] / 4 * 0.92
    for j, f in enumerate(FINGERS):
        off = (j - 1.5) * fw * (1 if True else 1)
        side = -I['thumb'] * off * -1  # index nearest the thumb side
        base = I['ctr'] + I['thumb'] * (-(j - 1.5) * fw) + Y * I['yk'] + I['palm'] * (I['thick'] * 0.05)
        ln = I['L'] * (1.0 if f in ('index', 'ring') else 1.08 if f == 'middle' else 0.85)
        p0, p1, p2 = base, base + Y * ln * 0.55, base + Y * ln
        for k, (a, b) in enumerate([(p0, p1), (p1, p2)]):
            n = f'{f}{k + 1}.{sd}'; e = eb.new(n); e.head = toA(a); e.tail = toA(b); e.parent = eb[f'hand.{sd}' if k == 0 else f'{f}1.{sd}']; e.use_connect = k == 1; e.use_deform = True
            e.align_roll(palmA); segs[n] = (a, b, sd, f)
    tb = I['ctr'] + Y * (I['y0'] + 0.32 * (I['y1'] - I['y0'])) + I['thumb'] * (I['width'] * 0.42) + I['palm'] * (I['thick'] * 0.25)
    td = (Y * 0.75 + I['thumb'] * 0.45 + I['palm'] * 0.35).normalized(); tl = I['L'] * 0.85
    for k, (a, b) in enumerate([(tb, tb + td * tl * 0.5), (tb + td * tl * 0.5, tb + td * tl)]):
        n = f'thumb{k + 1}.{sd}'; e = eb.new(n); e.head = toA(a); e.tail = toA(b); e.parent = eb[f'hand.{sd}' if k == 0 else f'thumb1.{sd}']; e.use_connect = k == 1; e.use_deform = True
        e.align_roll(palmA); segs[n] = (a, b, sd, 'thumb')
bpy.ops.object.mode_set(mode='OBJECT')
# ---- palm markers ----
for sd in 'LR':
    I = info[sd]; R, O = I['R'], I['O']
    e = bpy.data.objects.new(f'palm_{sd}', None); bpy.context.scene.collection.objects.link(e)
    p = I['ctr'] + Vector((0, I['y0'] + 0.5 * (I['y1'] - I['y0']), 0)) + I['palm'] * 0.06
    e.parent = ao; e.parent_type = 'BONE'; e.parent_bone = f'hand.{sd}'
    bm_ = arm.bones[f'hand.{sd}']; Mb = AW @ bm_.matrix_local @ Matrix.Translation((0, bm_.length, 0))  # bone-parent space is at the tail
    e.matrix_world = Matrix.Translation(O + R @ p)
    e.matrix_parent_inverse = Mb.inverted()
    e.location = (0, 0, 0)
    print('PALM', sd, tuple(round(c, 3) for c in (O + R @ p)))
# ---- geometry: capsule fingers + reweight the blob front ----
bm = bmesh.new(); bm.from_mesh(me)
uvl = bm.loops.layers.uv.active; dl = bm.verts.layers.deform.verify()
bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
gidx = {}
for n in segs: gidx[n] = (body.vertex_groups.get(n) or body.vertex_groups.new(name=n)).index
# nearest-vertex UV/material source per hand
src = {}
for sd in 'LR':
    kd = kdtree.KDTree(len(info[sd]['verts']))
    for i, vi in enumerate(info[sd]['verts']): kd.insert(BW @ bm.verts[vi].co, vi)
    kd.balance(); src[sd] = kd
vuv = {}
for f in bm.faces:
    for l in f.loops: vuv.setdefault(l.vert.index, (l[uvl].uv.copy(), f.material_index))
handg = {sd: body.vertex_groups[f'hand.{sd}'].index for sd in 'LR'}
# one representative texel per hand for the new fingers (nearest-vertex UVs land on seams / cuffs): sample the base-colour
# texture under the hand blob's loops; Centurion takes the bright glove colour, Tiger the median gauntlet colour, claws the brightest
img = None
for m in body.data.materials:
    if m and m.use_nodes:
        for nd in m.node_tree.nodes:
            if nd.type == 'TEX_IMAGE' and nd.image and any(l.to_socket.name == 'Base Color' for l in nd.outputs[0].links): img = nd.image
W, H = img.size; PX = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, img.channels)
def texel(uv): x = int((uv.x % 1) * (W - 1)); y = int((uv.y % 1) * (H - 1)); return PX[y, x, :3]
pick = {}
for sd in 'LR':
    hv = set(info[sd]['verts']); cands = []
    for f in bm.faces:
        for l in f.loops:
            if l.vert.index in hv: c = texel(l[uvl].uv); cands.append((float(c.mean()), l[uvl].uv.copy(), f.material_index, c))
    cands.sort(key=lambda c: c[0]); n = len(cands)
    body_c = cands[int(n * (0.5 if TIGER else 0.8))]; claw_c = cands[int(n * 0.97)]
    pick[sd] = (body_c, claw_c); print('TEXEL', sd, [round(float(x), 2) for x in body_c[3]], 'claw', [round(float(x), 2) for x in claw_c[3]])
for sd in 'LR':  # blob: verts past the knuckle line follow the middle finger (fist folds the mitten front), front squeezed in a little
    I = info[sd]; R, O = I['R'], I['O']
    for vi, p in zip(I['verts'], I['P']):
        y = p[1]; t = (y - I['yk']) / max(1e-4, I['y1'] - I['yk'])
        if t <= -0.15: continue
        k = max(0.0, min(1.0, (t + 0.15) / 0.6)); v = bm.verts[vi]
        w = dict(v[dl]); hw = w.get(handg[sd], 0)
        v[dl][handg[sd]] = hw * (1 - k)
        v[dl][gidx[f'middle1.{sd}']] = hw * k * (1 - 0.5 * max(0, t))
        v[dl][gidx[f'middle2.{sd}']] = hw * k * 0.5 * max(0, t)
        if t > 0:  # squeeze the mitten tip so the capsule fingers read as the fingers
            q = Vector(p); c = I['ctr']; q.x = c.x + (q.x - c.x) * (1 - 0.3 * t); q.z = c.z + (q.z - c.z) * (1 - 0.35 * t); q.y = I['yk'] + (q.y - I['yk']) * (1 - 0.25 * t)
            v.co = BWi @ (O + R @ q)
added = 0
for n, (a, b, sd, f) in segs.items():
    I = info[sd]; R, O = I['R'], I['O']
    r = I['thick'] * (0.21 if f != 'thumb' else 0.25) * (1.15 if TIGER else 1.0); r = min(r, I['width'] / 8 * 1.05)
    A, Bp = O + R @ a, O + R @ b; d = (Bp - A); ln = d.length
    q = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    Mx = Matrix.Translation((A + Bp) / 2) @ q
    tip = n.endswith('2.' + sd)
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=r, radius2=r * (0.8 if tip else 0.92), depth=ln * (1.12 if tip else 1.2), matrix=BWi @ Mx)
    nv = res['verts']
    for v in nv:
        _, vi, _ = src[sd].find(BW @ v.co); uv, mi = vuv.get(vi, (None, 0))
        v[dl][gidx[n]] = 1.0
        v.co = v.co  # noqa
        v.tag = True
    faces = {f2 for v in nv for f2 in v.link_faces}
    for f2 in faces:
        f2.smooth = True; _, uv, mi, _ = pick[sd][0]
        for l in f2.loops: l[uvl].uv = uv
        f2.material_index = mi
    if TIGER and tip and f != 'thumb':  # claws
        cl = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=r * 0.55, radius2=0.0005, depth=r * 2.2,
                                   matrix=BWi @ Matrix.Translation(Bp + d.normalized() * r * 0.9) @ q)
        for v in cl['verts']: v[dl][gidx[n]] = 1.0
        for f2 in {f3 for v in cl['verts'] for f3 in v.link_faces}:
            f2.smooth = False
            _, uv, mi, _ = pick[sd][1]
            for l in f2.loops: l[uvl].uv = uv
            f2.material_index = mi
    added += len(nv)
bm.normal_update(); bm.to_mesh(me); bm.free(); me.update()
print('ADDED_VERTS', added, 'BONES', len(segs))
bpy.ops.wm.save_as_mainfile(filepath=SRC)
print('SAVED', SRC)
