# quick Cycles preview of a head blend: front + 3/4 (+ side); args: blend outdir [json shape-key values] [tag]
import bpy, sys, json, math, os
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]; blend, outd = a[0], a[1]; vals = json.loads(a[2]) if len(a) > 2 and a[2] else {}; tag = a[3] if len(a) > 3 else 'p'
bpy.ops.wm.open_mainfile(filepath=blend); os.makedirs(outd, exist_ok=True)
sc = bpy.context.scene
for o in list(bpy.data.objects):
    if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o)
h = bpy.data.objects.get('VHead')
if h and h.data.shape_keys:
    for kb in h.data.shape_keys.key_blocks[1:]: kb.value = 0
    for k, v in vals.items():
        kb = h.data.shape_keys.key_blocks.get(k + ('+' if v >= 0 else '-'))
        if kb: kb.value = abs(v)
if 'mat_clay' not in bpy.data.materials:
    m = bpy.data.materials.new('mat_clay'); m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.45, 0.32, 0.26, 1)
for o in bpy.data.objects:
    if o.type == 'MESH' and not o.data.materials: o.data.materials.append(bpy.data.materials['mat_clay'])
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = int(os.environ.get('SAMPLES', 24)); sc.cycles.use_denoising = True
sc.render.resolution_x = sc.render.resolution_y = int(os.environ.get('RES', 560))
sc.world = sc.world or bpy.data.worlds.new('w'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.32, 0.33, 0.36, 1)
C = Vector(json.loads(os.environ.get('CEN', '[0,-0.03,1.71]')))
def light(loc, e, s=0.3):
    L = bpy.data.lights.new('l', 'AREA'); L.energy = e; L.size = s; o = bpy.data.objects.new('l', L); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector(C) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
light(C + Vector((-0.5, -0.8, 0.4)), 14); light(C + Vector((0.7, -0.4, 0.1)), 4); light(C + Vector((0.2, 0.8, 0.5)), 8)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 85
D = float(os.environ.get('DIST', 0.75))
for name, ang in (('front', 0), ('q34', 35), ('side', 88)):
    if name not in os.environ.get('VIEWS', 'front,q34'): continue
    r = math.radians(ang); cam.location = C + Vector((math.sin(r) * D, -math.cos(r) * D, 0.02))
    cam.rotation_euler = (C - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{outd}/{tag}_{name}.png'; bpy.ops.render.render(write_still=True)
