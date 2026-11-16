# Head close-up previews (rest pose): textured + clay, front/34/side. usage: blender -b --python headprev.py -- <blendname> <tag>
import bpy, sys
sys.path.insert(0, '/workspace/hero-game-assets/rig'); import prevlib
a = sys.argv[sys.argv.index('--')+1:]; src, tag = a[:2]; SC = float(a[2]) if len(a) > 2 else 0.36; CZ = 1.715 if SC > 0.3 else 1.70
bpy.ops.wm.open_mainfile(filepath=f'/workspace/hero-game-assets/rig/{src}.blend')
ao = bpy.data.objects['cent_rig']; ao.animation_data.action = None
for pb in ao.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
for o in list(bpy.data.objects):
    if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o)
co = prevlib.setup(400 if SC > 0.3 else 600, samples=12)
for az, n in ((0, 'front'), (35, '34'), (90, 'side')):
    prevlib.shoot(co, (0, -0.03, CZ), SC, az, f'/tmp/hp_{tag}_{n}.png', el=4)
clay = bpy.data.materials.new('clay'); clay.use_nodes = True; clay.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.30, 0.28, 1)
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.data.materials.clear(); o.data.materials.append(clay)
for az, n in ((0, 'front'), (35, '34'), (90, 'side')):
    prevlib.shoot(co, (0, -0.03, CZ), SC, az, f'/tmp/hp_{tag}_clay_{n}.png', el=4)
