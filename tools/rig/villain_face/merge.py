# Put the new villain head on the rig: remove the body's old head (and the old hair/ear detail), conform the new neck into
# the collar, copy skin weights from the nearest old body vertices, join the head into cent_body (so LOD1 decimates it
# too), and replace CentFaceDetail (head-bone rigid) with the hair / moustache / brow shells + eyeballs.
# usage: blender -b --python merge.py -- a|b   -> /workspace/hero-game-assets/rig/villain_{a,b}_anim_face_v2.blend
import bpy, bmesh, sys, os, math, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
VK = sys.argv[sys.argv.index('--') + 1:][0]
RIG = '/workspace/hero-game-assets/rig'; D = '/workspace/hero-game-assets/villain_face'
bpy.ops.wm.open_mainfile(filepath=f'{RIG}/villain_{VK}_anim_face.blend')
ao = bpy.data.objects['cent_rig']; ao.animation_data.action = None
for pb in ao.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.context.view_layer.update()
body = bpy.data.objects['cent_body']; bme = body.data
old = bpy.data.objects.get('CentFaceDetail')
if old: bpy.data.objects.remove(old)
with bpy.data.libraries.load(f'{D}/villain_{VK}_head.blend') as (src, dst): dst.objects = ['VHead', 'VDetail']
head, det = dst.objects
for o in (head, det): bpy.context.scene.collection.objects.link(o)
bmb = bmesh.new(); bmb.from_mesh(bme); bvh = BVHTree.FromBMesh(bmb)
kd = KDTree(len(bme.vertices))
for v in bme.vertices: kd.insert(v.co, v.index)
kd.balance()
gname = {g.index: g.name for g in body.vertex_groups}
hm = head.data
def ss(a, b, x): t = min(1, max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
def neck_centre(z):
    pts = [v.co for v in bme.vertices if abs(v.co.z - z) < 0.008 and abs(v.co.x) < 0.12 and -0.15 < v.co.y < 0.15]
    return Vector((0, sum(p.y for p in pts) / max(1, len(pts)), z))
def ctop(y): return 1.585 + 0.045 * ss(-0.02, 0.03, y)       # top of the painted high collar on the body (villain.py)
cache = {}; moved = 0
for v in hm.vertices:
    z = v.co.z; ct = ctop(v.co.y); w = ss(ct + 0.045, ct + 0.004, z)
    if w <= 0: continue
    zk = round(z, 3); c = cache[zk] if zk in cache else cache.setdefault(zk, neck_centre(z))
    d = Vector((v.co.x - c.x, v.co.y - c.y, 0)); rh = d.length
    if rh < 1e-5: continue
    d.normalize(); loc, n, i, dist = bvh.ray_cast(c, d, 0.16)
    rb = (loc - c).length - 0.003 if loc is not None else None   # just inside the body's neck: the collar stays on top
    if rb is None or rb > 0.13: rb = min(rh, 0.075)
    if z < ct + 0.004: r = min(rh, rb)                  # never poke out through the collar / shoulders
    else: r = rh * (1 - w) + rb * w
    v.co = Vector((c.x + d.x * r, c.y + d.y * r, z)); moved += 1
print('NECK conformed', moved)
head.vertex_groups.clear()
for g in body.vertex_groups: head.vertex_groups.new(name=g.name)
for v in hm.vertices:
    co, idx, dist = kd.find(v.co)
    for g in bme.vertices[idx].groups:
        if g.weight > 1e-3: head.vertex_groups[gname[g.group]].add([v.index], g.weight, 'REPLACE')
bmb.faces.ensure_lookup_table()
kill = [f for f in bmb.faces if min(v.co.z - ctop(v.co.y) for v in f.verts) > 0.004 and abs(f.calc_center_median().x) < 0.16 and -0.22 < f.calc_center_median().y < 0.17]
bmesh.ops.delete(bmb, geom=kill, context='FACES')
loose = [v for v in bmb.verts if not v.link_faces]; bmesh.ops.delete(bmb, geom=loose, context='VERTS')
bmb.to_mesh(bme); bmb.free(); print('BODY faces removed', len(kill))
if 'mhpos' in hm.attributes: hm.attributes.remove(hm.attributes['mhpos'])
head.name = 'cent_head'; head.data.name = 'cent_head'
head.parent = ao; md = head.modifiers.new('Armature', 'ARMATURE'); md.object = ao
print('HEAD verts', len(hm.vertices), 'body verts', len(bme.vertices))
det.name = 'CentFaceDetail'; det.data.name = 'CentFaceDetail'
mw = det.matrix_world.copy(); det.parent = ao; det.parent_type = 'BONE'; det.parent_bone = 'head'; bpy.context.view_layer.update(); det.matrix_world = mw
bpy.ops.wm.save_as_mainfile(filepath=f'{RIG}/villain_{VK}_anim_face_v2.blend')
print('DONE')
