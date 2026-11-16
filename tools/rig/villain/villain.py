# Build a villain (Ben's two villain sheets) on Centurion's rig: same skeleton, skin weights, finger bones and every clip.
#  - new face: a frontal portrait made from the sheet's head panels (villain_{a,b}_face_proj.png, aligned to the same
#    projection mapping as tools/rig/face_cent/bake.py) projected onto the sculpted head; no glowing eyes, no beard
#  - suit repainted from scratch per texel by its 3D rest position (white / light-grey bodysuit, centre seam, wrist cuffs,
#    belt, boots with cuffs; villain B gets darker side panels), bare hands, hair + ears regenerated (dark / blond)
#  - cape removed; a front + back tabard, belt band and high collar added as one skinned 'cape_cent' mesh (tabard rows blend
#    hips -> thighs so it swings with the legs), with its own vertex-colour material
#  - fly_fast replaced by the villain flight pose (Ben's pose reference: chest leading, arms swept straight back and down
#    with open hands, one knee bent forward, the other leg trailing straight back); the game pitches the body ~45 deg
# usage: blender -b --python villain.py -- a|b      -> /workspace/hero-game-assets/rig/villain_{a,b}_anim_face.blend
import bpy, bmesh, math, random, sys, os, numpy as np
from mathutils import Vector, Quaternion, Matrix
from mathutils.bvhtree import BVHTree
VK = sys.argv[sys.argv.index('--') + 1:][0]
RIG = '/workspace/hero-game-assets/rig'; VD = '/workspace/hero-game-assets/villains'
SRC = f'{RIG}/cent_anim_face.blend'; OUT = f'{RIG}/villain_{VK}_anim_face.blend'
def srgb(c): return np.array(c, float) / 255.0
CFG = {
 'a': dict(suit=(226, 226, 224), suit2=(214, 214, 212), seam=(168, 168, 166), belt=(204, 204, 202), boot=(232, 232, 230), cuff=(186, 186, 184),
           panel=None, hair=[(24, 19, 16), (34, 27, 22), (44, 35, 28), (58, 46, 36)], tab=(220, 220, 218), tab2=(196, 196, 194), hairlen=1.0),
 'b': dict(suit=(176, 177, 182), suit2=(160, 161, 166), seam=(118, 119, 124), belt=(146, 147, 152), boot=(184, 185, 190), cuff=(132, 133, 138),
           panel=(138, 139, 145), hair=[(120, 86, 48), (150, 112, 66), (176, 136, 84), (200, 162, 106)], tab=(184, 185, 190), tab2=(166, 167, 172), hairlen=1.25),
}[VK]
bpy.ops.wm.open_mainfile(filepath=SRC)
random.seed(7 if VK == 'a' else 9)
ao = bpy.data.objects['cent_rig']; arm = ao.data; ao.animation_data.action = None
for pb in ao.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.context.view_layer.update()
for n in ('CentFaceDetail', 'eye_emit_L', 'eye_emit_R', 'cape_cent'):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o)
body = bpy.data.objects['cent_body']; me = body.data
vg = {g.name: g.index for g in body.vertex_groups}
HAND = {vg[n] for n in vg if n.startswith('hand.') or any(n.startswith(f) for f in ('thumb', 'index', 'middle', 'ring', 'pinky'))}
hi = vg['head']
# ---------------- bake helper maps (projection colour/weight, rest position, hand + head weights) ----------------
RW, RH, SX, U0 = 274, 358, 0.0007, 140
def vpx(z): return 150 + (1.722 - z) / SX
def ss(a, b, x): t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
pu = me.uv_layers.new(name='proj'); orig_uv = me.uv_layers['UVMap']; me.uv_layers.active = orig_uv
for l in me.loops:
    v = me.vertices[l.vertex_index]; pu.data[l.index].uv = ((U0 + v.co.x / SX) / RW, 1 - vpx(v.co.z) / RH)
def attr(name, f):
    ca = me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    for v in me.vertices: w = float(f(v)); ca.data[v.index].color = (w, w, w, 1.0)
attr('projw', lambda v: ss(0.4, 0.8, sum(g.weight for g in v.groups if g.group == hi)) * ss(0.1, 0.5, -v.normal.y) * (1 - ss(1.80, 1.822, v.co.z)) * ss(1.575, 1.595, v.co.z) * (1 - ss(0.07, 0.086, abs(v.co.x))))
attr('handw', lambda v: sum(g.weight for g in v.groups if g.group in HAND))
attr('headw', lambda v: sum(g.weight for g in v.groups if g.group == hi))
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 1
sc.render.bake.margin = 8; sc.render.bake.use_clear = True
bpy.context.view_layer.update()
for o in bpy.data.objects:
    try: o.select_set(False)
    except Exception: pass
body.select_set(True); bpy.context.view_layer.objects.active = body
mat = bpy.data.materials.new('bakemat'); mat.use_nodes = True; nt = mat.node_tree; N = nt.nodes
for n in list(N): N.remove(n)
out = N.new('ShaderNodeOutputMaterial'); em = N.new('ShaderNodeEmission'); nt.links.new(em.outputs[0], out.inputs[0])
uvn = N.new('ShaderNodeUVMap'); uvn.uv_map = 'proj'; tex = N.new('ShaderNodeTexImage'); tex.extension = 'EXTEND'; nt.links.new(uvn.outputs[0], tex.inputs[0])
an = N.new('ShaderNodeAttribute'); geo = N.new('ShaderNodeNewGeometry'); tgt = N.new('ShaderNodeTexImage')
old = list(me.materials); me.materials.clear(); me.materials.append(mat)
def bake(sock, res):
    im = bpy.data.images.new('bk', res, res, alpha=False, float_buffer=True); im.colorspace_settings.name = 'Non-Color'
    tgt.image = im; N.active = tgt
    for l in list(em.inputs[0].links): nt.links.remove(l)
    nt.links.new(sock, em.inputs[0]); bpy.ops.object.bake(type='EMIT')
    a = np.array(im.pixels[:]).reshape(res, res, 4)[..., :3].copy(); bpy.data.images.remove(im); return a
def load(p): im = bpy.data.images.load(p); im.colorspace_settings.name = 'Non-Color'; return im
def arr(p): im = load(p); r = im.size[0]; return np.array(im.pixels[:]).reshape(r, r, 4)[..., :3].copy()
A0 = arr(f'{RIG}/face_tex/cent_albedo_face.png'); R = A0.shape[0]
tex.image = load(f'{VD}/villain_{VK}_face_proj.png'); PROJ = bake(tex.outputs[0], R)
an.attribute_name = 'projw'; MP = bake(an.outputs[0], R)[..., 0]
an.attribute_name = 'handw'; MH = bake(an.outputs[0], R)[..., 0]
an.attribute_name = 'headw'; MHd = bake(an.outputs[0], R)[..., 0]
POS = bake(geo.outputs['Position'], R)
me.materials.clear()
for m in old: me.materials.append(m)
me.uv_layers.remove(me.uv_layers['proj'])
for n in ('projw', 'handw', 'headw'): me.color_attributes.remove(me.color_attributes[n])
bpy.data.materials.remove(mat)
print('BAKED', R)
# ---------------- repaint the atlas ----------------
x, y, z = POS[..., 0], POS[..., 1], POS[..., 2]; ax_ = np.abs(x)
pim = np.array(bpy.data.images.load(f'{VD}/villain_{VK}_face_proj.png').pixels[:]).reshape(RH, RW, 4)[::-1, :, :3]
skin = (pim[195:215, 85:105].reshape(-1, 3).mean(0) + pim[195:215, 175:195].reshape(-1, 3).mean(0)) / 2
skin_sh = skin * 0.8
C = {k: srgb(CFG[k]) for k in ('suit', 'suit2', 'seam', 'belt', 'boot', 'cuff')}
OUTC = np.zeros_like(A0); OUTC[:] = C['suit']
def paint(mask, col, a=1.0):
    m = (mask.astype(float) * a)[..., None]; OUTC[:] = OUTC * (1 - m) + np.asarray(col) * m
front = y < 0
# panel / seam work on the torso (rest pose: arms out at 45 deg so the torso is |x| < ~0.2)
torso = (ax_ < 0.24) & (z > 1.0) & (z < 1.47)
paint(torso & front & (z > 1.08) & (ax_ < 0.007), C['seam'])                              # centre seam
paint(torso & front & (np.abs(z - 1.25) < 0.005) & (ax_ > 0.03) & (ax_ < 0.17), C['seam'], 0.7)   # under-pec line
paint(torso & (~front) & (ax_ < 0.006) & (z > 1.1), C['seam'], 0.8)                            # back seam
paint(torso & (np.abs(z - 1.40 + 0.25 * ax_) < 0.005) & (ax_ > 0.05), C['seam'], 0.7)            # shoulder yoke
if CFG['panel']:
    pc = srgb(CFG['panel'])
    paint(torso & (ax_ > 0.09) & (ax_ < 0.2) & (z > 1.1) & (z < 1.36), pc, 0.9)                 # side panels (villain B)
    paint(torso & front & (ax_ < 0.06) & (ax_ > 0.012) & (z > 1.08) & (z < 1.2), pc, 0.85)       # abdominal panels
    paint((~front) & (ax_ < 0.2) & (ax_ > 0.02) & (z > 1.12) & (z < 1.38) & (np.abs(ax_ - 0.11) < 0.04), pc, 0.8)
paint((z > 0.965) & (z < 1.075) & (ax_ < 0.25), C['belt'])                                      # belt
paint(((np.abs(z - 0.968) < 0.004) | (np.abs(z - 1.072) < 0.004)) & (ax_ < 0.25), C['seam'], 0.8)
boot_top = 0.47 if VK == 'a' else 0.44
paint(z < boot_top, C['boot'])
paint(np.abs(z - boot_top) < 0.012, C['cuff'])
if VK == 'b': paint(np.abs(z - 0.62) < 0.014, C['cuff'], 0.9)                                   # knee band
paint((MH > 0.15) & (MH < 0.55), C['cuff'])                                                     # wrist cuff
paint(MH >= 0.55, skin)                                                                         # bare hands
paint((MH > 0.85), skin_sh, 0.25)
# high collar up the neck, skin on the head, hair over the scalp, projected face on the front
head = (MHd > 0.45) & (z > 1.565)
paint(head, skin)
def hairline(ax):
    pts = [(0, 1.789), (0.03, 1.787), (0.056, 1.775), (0.072, 1.752), (0.085, 1.735), (0.2, 1.72)]
    return np.interp(ax, [p[0] for p in pts], [p[1] for p in pts])
hairm = head & (((y > 0.0) & (z > 1.64)) | (z > hairline(ax_)) | ((y > -0.04) & (z > 1.735)))
hc = srgb(CFG['hair'][1]); paint(hairm, hc)
paint(head, PROJ, 1.0 * 0) if False else None
mp = np.clip(MP * 1.0, 0, 1)[..., None]
OUTC[:] = OUTC * (1 - mp) + np.clip(PROJ * 1.08, 0, 1) * mp
collar = (z > 1.43) & (z < 1.585 + np.where(y > 0, 0.045, 0.0)) & (ax_ < 0.13) & ~(head & (MP > 0.3))
paint(collar & (MH < 0.1), C['suit2'])
paint(collar & (np.abs(z - 1.45) < 0.004), C['seam'], 0.8)
# a touch of the original ambient occlusion so folds / muscles keep some depth
ORM = arr('/workspace/hero-game-assets/mixamo/tex/cent_orm.png'); ao_ = ORM[..., 0]
if ORM.shape[0] != R: ao_ = np.kron(ao_, np.ones((R // ORM.shape[0], R // ORM.shape[0]))) if R > ORM.shape[0] else ao_[::ORM.shape[0] // R, ::ORM.shape[0] // R]
shade = (0.78 + 0.22 * ao_)[..., None]; shade = np.where((MP > 0.5)[..., None], 1.0, shade)
OUTC = np.clip(OUTC * shade, 0, 1)
# finger capsules share a few UV points (fingers.py copies one hand texel); paint a skin disc around each so the fingers are bare
FG = {vg[n] for n in vg if any(n.startswith(f) for f in ('thumb', 'index', 'middle', 'ring', 'pinky'))}
fv = {v.index for v in me.vertices if sum(g.weight for g in v.groups if g.group in FG) > 0.5}
uvs = set()
for l in me.loops:
    if l.vertex_index in fv: u = me.uv_layers.active.data[l.index].uv; uvs.add((int(u.x * (R - 1)), int(u.y * (R - 1))))
for (ux, uy) in uvs: OUTC[max(0, uy - 3):uy + 4, max(0, ux - 3):ux + 4] = skin * 0.95
print('FINGER UV points', len(uvs))
TEX = f'{RIG}/face_tex'
def save(a, name):
    r = a.shape[0]; im = bpy.data.images.new(name, r, r, alpha=False); im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(np.concatenate([np.clip(a, 0, 1), np.ones((r, r, 1))], 2).astype(np.float32).ravel())
    p = f'{TEX}/{name}.png'; im.filepath_raw = p; im.file_format = 'PNG'; im.save(); return p
pa = save(OUTC, f'villain_{VK}_albedo')
Em = arr(f'{RIG}/face_tex/cent_emit_face.png'); pe = save(np.zeros_like(Em), f'villain_{VK}_emit')   # no glowing eyes
Nm = arr(f'{RIG}/face_tex/cent_normal_face.png'); flat = np.array([0.5, 0.5, 1.0])
k = np.where((MHd > 0.45)[..., None] if Nm.shape[0] == R else 0.0, 0.0, 0.35); Nn = Nm * (1 - k) + flat * k; pn = save(Nn, f'villain_{VK}_normal')
O2 = ORM.copy(); O2[..., 2] = 0.0; O2[..., 1] = 0.62; po = save(O2, f'villain_{VK}_orm')
m = bpy.data.materials['cent_mat']; m.name = f'villain_{VK}_mat'
for n in m.node_tree.nodes:
    if n.type == 'TEX_IMAGE' and n.image:
        nm = n.image.name
        if 'albedo' in nm: n.image = load(pa); n.image.colorspace_settings.name = 'sRGB'
        elif 'emit' in nm: n.image = load(pe); n.image.colorspace_settings.name = 'sRGB'
        elif 'normal' in nm: n.image = load(pn)
        elif 'orm' in nm: n.image = load(po)
print('PAINTED skin', (skin * 255).astype(int))
# ---------------- hair locks + ears (rigid on the head bone; same approach as face_cent/details.py) ----------------
bmb = bmesh.new(); bmb.from_mesh(me); bvh = BVHTree.FromBMesh(bmb)
def hit(o, d): loc, nrm, i, dist = bvh.ray_cast(Vector(o), Vector(d).normalized()); return loc, nrm
def vmat(name, rough=0.8, double=False):
    mm = bpy.data.materials.new(name); mm.use_nodes = True; t = mm.node_tree; bs = t.nodes['Principled BSDF']
    ca = t.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'Col'; t.links.new(ca.outputs[0], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = rough; mm.use_backface_culling = not double; return mm
M_HAIR = vmat(f'villain_{VK}_hair', 0.55); M_SKIN = vmat(f'villain_{VK}_skin', 0.6)
bm = bmesh.new(); col = bm.loops.layers.color.new('Col')
def lin(c): return tuple(((v / 255) ** 2.2) for v in c) + (1,)
CARD = {}
def tube(path, radii, colors, mi, sides=3, flat=1.0, nh=None):
    rings = []
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        a = t.cross(nh).normalized(); bb = t.cross(a).normalized(); r = radii[i]; ring = []
        for kk in range(sides):
            th = 2 * math.pi * kk / sides + math.pi / sides; vv = bm.verts.new(p + a * math.cos(th) * r + bb * math.sin(th) * r * flat); ring.append(vv); CARD[vv] = nh.copy()
        rings.append((ring, colors[i]))
    for i in range(len(rings) - 1):
        (r0, c0), (r1, c1) = rings[i], rings[i + 1]
        for kk in range(sides):
            try: f = bm.faces.new([r0[kk], r0[(kk + 1) % sides], r1[(kk + 1) % sides], r1[kk]])
            except ValueError: continue
            f.material_index = mi
            for l in f.loops: l[col] = lin(c0 if l.vert in r0 else c1)
def lock(root, n, d, L, w, cs, mi, lift, curl=0.0, flat=0.3):
    d = (d - n * d.dot(n)).normalized(); side = d.cross(n)
    pts = [root + d * L * t + n * (0.0015 + lift * t * t) + side * curl * L * t * t for t in (0, 0.4, 0.75, 1.0)]
    tube(pts, [w, w * 0.85, w * 0.5, w * 0.12], cs, mi, sides=3, flat=flat, nh=n)
Cc = Vector((0, -0.025, 1.715)); HC = CFG['hair']; nh = 0
def hl(ax): return float(hairline(np.array(ax)))
for i in range(6000):
    u = random.uniform(-1, 1); th = random.uniform(0, 2 * math.pi); r = math.sqrt(1 - u * u)
    dv = Vector((r * math.cos(th), r * math.sin(th), u))
    if dv.z < -0.25: continue
    loc, n = hit(Cc + dv * 0.4, -dv)
    if loc is None or n.dot(dv) < 0.2: continue
    X_, Y_, Z_ = loc; ax = abs(X_)
    if Y_ < -0.07 and Z_ < hl(ax) + 0.004: continue
    if Z_ < 1.735 and Y_ < 0.03: continue
    if Z_ < 1.665: continue
    front = Y_ < -0.06
    if front: d = Vector((random.uniform(-0.3, 0.3), 0.55, 1.0))                     # swept back off the hairline
    elif Z_ > 1.8: d = Vector((X_ * 3 + random.uniform(-0.4, 0.4), 1.0, 0.1))
    else: d = Vector((0, 0.7, -0.6)) + Vector((random.uniform(-0.2, 0.2), 0, 0))
    L = random.uniform(0.014, 0.022) * CFG['hairlen']; w = random.uniform(0.0035, 0.0055)
    j = random.uniform(0.8, 1.2); cs = [tuple(min(255, int(c * j)) for c in cc) for cc in (HC[0], HC[1], HC[2], HC[3])]
    lock(loc - n * 0.003, n, d, L, w, cs, 0, lift=random.uniform(0.003, 0.008) * (1.4 if VK == 'b' else 1), curl=random.uniform(-0.35, 0.35) * (1.6 if VK == 'b' else 1), flat=0.5)
    nh += 1
    if nh >= 520: break
sk = tuple(int(c * 255) for c in skin); skd = tuple(int(c * 200) for c in skin); skr = tuple(min(255, int(c * 275)) for c in skin)
for s in (-1, 1):
    loc, n = hit(Vector((s * 0.3, -0.022, 1.708)), Vector((-s, 0, 0)))
    base = loc - Vector((s * 0.004, 0, 0)); up = Vector((0, 0.18, 1)).normalized(); back = Vector((0, 1, 0)); outv = Vector((s, 0, 0))
    H = 0.056; Wd = 0.028; rows = 8; cols = 6
    def Pe(t, u, inner=False):
        zz = (t - 0.5) * H; wf = math.sqrt(max(0.0, 1 - (2 * t - 1) ** 2)) * (0.85 + 0.3 * t); b = (u + 1) / 2 * Wd * wf
        pro = 0.002 + 0.010 * (u + 1) / 2 * (0.6 + 0.4 * t) * min(1.0, wf * 1.6); cup = -0.0035 * (1 - u * u) * math.sin(math.pi * t)
        p = base + up * zz + back * b + outv * (pro + cup); return p - outv * 0.004 if inner else p
    fr = [[bm.verts.new(Pe(i / rows, kk / cols * 2 - 1)) for kk in range(cols + 1)] for i in range(rows + 1)]
    bk = [[bm.verts.new(Pe(i / rows, kk / cols * 2 - 1, True)) for kk in range(cols + 1)] for i in range(rows + 1)]
    for i in range(rows):
        for kk in range(cols):
            for G, rev in ((fr, False), (bk, True)):
                vs = [G[i][kk], G[i][kk + 1], G[i + 1][kk + 1], G[i + 1][kk]]
                if rev: vs = vs[::-1]
                if s < 0: vs = vs[::-1]
                try: f = bm.faces.new(vs)
                except ValueError: continue
                f.material_index = 1; uu = kk / cols * 2 - 1; tt = i / rows
                for l in f.loops: l[col] = lin(skr if (uu > 0.6 or tt > 0.85) else (skd if (abs(uu) < 0.5 and 0.25 < tt < 0.75) else sk))
bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f.material_index == 1])
bm.verts.index_update(); cardn = {v.index: nn for v, nn in CARD.items()}
dm = bpy.data.meshes.new('CentFaceDetail'); bm.to_mesh(dm); bm.free()
for p in dm.polygons: p.use_smooth = True
for mm in (M_HAIR, M_SKIN): dm.materials.append(mm)
dm.normals_split_custom_set_from_vertices([tuple(cardn[v.index]) if v.index in cardn else tuple(v.normal) for v in dm.vertices])
fo = bpy.data.objects.new('CentFaceDetail', dm); bpy.context.scene.collection.objects.link(fo)
mw = fo.matrix_world.copy(); fo.parent = ao; fo.parent_type = 'BONE'; fo.parent_bone = 'head'; bpy.context.view_layer.update(); fo.matrix_world = mw
print('HAIR locks', nh)
# ---------------- tabard (front + back), belt band, high collar: one skinned mesh 'cape_cent' ----------------
bm = bmesh.new(); col = bm.loops.layers.color.new('Col'); dl = bm.verts.layers.deform.verify()
gi = {}
def gidx(n):
    if n not in gi: gi[n] = len(gi)
    return gi[n]
def wv(v, ws):
    for n, w in ws.items():
        if w > 1e-3: v[dl][gidx(n)] = w
def surf_y(xx, zz, sign):  # body surface y at (x, z) from the front (sign=-1) or back (+1)
    loc, n = hit(Vector((xx, sign * 1.0, zz)), Vector((0, -sign, 0)))
    return None if loc is None else loc.y
def grid(cols_x, rows_z, ypos, color_fn, weight_fn):
    V = [[None] * len(cols_x) for _ in rows_z]
    for i, zz in enumerate(rows_z):
        for j, xx in enumerate(cols_x):
            v = bm.verts.new(Vector((xx, ypos[i][j], zz))); wv(v, weight_fn(i, j, xx, zz)); V[i][j] = v
    for i in range(len(rows_z) - 1):
        for j in range(len(cols_x) - 1):
            f = bm.faces.new([V[i][j], V[i][j + 1], V[i + 1][j + 1], V[i + 1][j]])
            for l in f.loops: l[col] = lin(color_fn(i, j))
    return V
TC, TC2 = CFG['tab'], CFG['tab2']
ztop, zbot = 1.0, (0.56 if VK == 'a' else 0.53)
rows_z = list(np.linspace(ztop, zbot, 16))
for sign in (-1, 1):  # front panel, back panel
    hw0, hw1 = (0.155, 0.165) if sign < 0 else (0.15, 0.16)
    ys = []; prev = None
    for i, zz in enumerate(rows_z):
        hw = hw0 + (hw1 - hw0) * i / (len(rows_z) - 1); cols_x = list(np.linspace(-hw, hw, 13))
        hits = [surf_y(xx, zz, sign) for xx in cols_x]
        good = [h for h in hits if h is not None]
        ext = (min(good) if sign < 0 else max(good)) if good else (prev if prev is not None else sign * 0.15)
        if zz > 0.86:  # waist: follow the body's curve
            row = [((h if h is not None else ext) + sign * 0.014) for h in hits]
        else:          # below the crotch: hang flat in front of / behind the thighs, never closer than the row above
            e = ext + sign * 0.03
            if prev is not None: e = min(e, prev) if sign < 0 else max(e, prev)
            row = [e] * len(cols_x)
        prev = (min(row) if sign < 0 else max(row)); ys.append(row)
    def wf(i, j, xx, zz, _n=len(rows_z)):
        t = i / (_n - 1); wl = ss(0.1, 1.0, t) * 0.8; fl = min(1, max(0, 0.5 + xx / 0.32))
        return {'hips': 1 - wl, 'thigh.L': wl * fl, 'thigh.R': wl * (1 - fl)}
    def cf(i, j, _sign=sign): return TC2 if (j in (0, 11)) else TC
    # x coordinates per row differ (flare): build row by row with the right widths
    V = []
    for i, zz in enumerate(rows_z):
        hw = hw0 + (hw1 - hw0) * i / (len(rows_z) - 1); cols_x = list(np.linspace(-hw, hw, 13)); r = []
        for j, xx in enumerate(cols_x):
            v = bm.verts.new(Vector((xx, ys[i][j], zz))); wv(v, wf(i, j, xx, zz)); r.append(v)
        V.append(r)
    for i in range(len(rows_z) - 1):
        for j in range(12):
            q = [V[i][j], V[i][j + 1], V[i + 1][j + 1], V[i + 1][j]]
            if sign > 0: q = q[::-1]
            f = bm.faces.new(q)
            for l in f.loops: l[col] = lin(TC2 if (j in (0, 11) or i == len(rows_z) - 2) else TC)
def ring(zs, center_fn, off, weights_fn, color, segs=56, rmax=0.3):
    rings = []
    for zz in zs:
        c = center_fn(zz); r = []
        for k in range(segs):
            a = 2 * math.pi * k / segs; d = Vector((math.cos(a), math.sin(a), 0))
            loc, n = hit(c, d)   # from the centre outward: first hit = this body section (not the arms)
            dist = (loc - c).length if loc is not None else rmax
            p = c + d * min(rmax, dist + off)
            v = bm.verts.new(Vector((p.x, p.y, zz))); wv(v, weights_fn(zz)); r.append(v)
        rings.append(r)
    for i in range(len(rings) - 1):
        for k in range(segs):
            f = bm.faces.new([rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]])
            for l in f.loops: l[col] = lin(color)
    return rings
BELT = tuple(int(c) for c in CFG['belt'])
ring([0.965, 0.99, 1.045, 1.075], lambda zz: Vector((0, -0.01, zz)), 0.009, lambda zz: {"hips": 0.6, "spine": 0.4}, BELT)
ring(list(np.linspace(1.50, 1.585, 4)), lambda zz: Vector((0, 0.01, zz)), 0.011,
     lambda zz: {'upper_chest': 1 - ss(1.47, 1.56, zz), 'neck': ss(1.47, 1.56, zz)}, tuple(int(c) for c in CFG['suit2']), segs=40, rmax=0.13)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
cm = bpy.data.meshes.new('cape_cent'); bm.to_mesh(cm); bm.free()
for p in cm.polygons: p.use_smooth = True
cm.materials.append(vmat(f'villain_{VK}_cloth', 0.7, double=True))
co = bpy.data.objects.new('cape_cent', cm); bpy.context.scene.collection.objects.link(co)
for n in sorted(gi, key=gi.get): co.vertex_groups.new(name=n)
co.parent = ao; md = co.modifiers.new('Armature', 'ARMATURE'); md.object = ao
print('CLOTH verts', len(cm.vertices), 'groups', list(gi))
# ---------------- flight pose (replaces fly_fast) ----------------
FPS = 24; sc.render.fps = FPS
order = [b.name for b in arm.bones]; R0 = {b.name: b.matrix_local.to_3x3() for b in arm.bones}
def rest_dir(n): b = arm.bones[n]; return (b.tail_local - b.head_local).normalized()
def q_rot(axis, deg): return Quaternion(Vector(axis), math.radians(deg))
def to_local(n, qa): M = R0[n]; return (M.inverted() @ qa.to_matrix() @ M).to_quaternion().normalized()
def pose(spec):
    Qw = {}; o = {}
    for n in order:
        b = arm.bones[n]; Qp = Qw.get(b.parent.name, Quaternion()) if b.parent else Quaternion(); q = Qp.copy()
        for op in spec.get(n, []):
            if op[0] == 'rot': q = q @ q_rot(op[1], op[2])
            else: cur = q @ rest_dir(n); q = cur.rotation_difference(Vector(op[1]).normalized()) @ q
        Qw[n] = q
        if n in spec: o[n] = to_local(n, Qp.inverted() @ q)
    return o
Xa = (1, 0, 0)
def flight(k):  # k in [-1, 1]: tiny breathing / drift so the hold reads alive
    d = {'spine': [('rot', Xa, -6)], 'chest': [('rot', Xa, -8 - 2 * k)], 'upper_chest': [('rot', Xa, -4)], 'neck': [('rot', Xa, -16)], 'head': [('rot', Xa, -26)]}
    for sd, s in (('L', 1), ('R', -1)):
        d[f'upper_arm.{sd}'] = [('aim', (s * 0.2, 0.55 + 0.03 * k, -0.81))]          # swept straight back and down behind
        d[f'forearm.{sd}'] = [('aim', (s * 0.22, 0.62 + 0.03 * k, -0.76))]
        d[f'hand.{sd}'] = [('aim', (s * 0.2, 0.72, -0.66))]                           # open hands trailing
    d['thigh.R'] = [('aim', (-0.06, -0.72, -0.69))]                                     # right knee bent forward
    d['shin.R'] = [('aim', (-0.02, 0.62 - 0.02 * k, -0.78))]
    d['foot.R'] = [('aim', (0, 0.75, -0.62))]
    d['thigh.L'] = [('aim', (0.07, 0.32, -0.95))]                                       # left leg trailing straight back
    d['shin.L'] = [('aim', (0.07, 0.36 + 0.02 * k, -0.93))]
    d['foot.L'] = [('aim', (0.04, 0.45, -0.89))]
    return pose(d)
act = bpy.data.actions.get('fly_fast')
if act: bpy.data.actions.remove(act)
a = bpy.data.actions.new('fly_fast'); a.use_fake_user = True; ao.animation_data.action = a
for pb in ao.pose.bones: pb.rotation_mode = 'QUATERNION'
LEN = 24
for f in range(LEN + 1):
    P_ = flight(math.sin(2 * math.pi * f / LEN))
    for pb in ao.pose.bones:
        pb.rotation_quaternion = P_.get(pb.name, Quaternion()); pb.keyframe_insert('rotation_quaternion', frame=f, group=pb.name)
ao.animation_data.action = None
for pb in ao.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0)
print('FLY_FAST villain pose')
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('DONE', OUT)
