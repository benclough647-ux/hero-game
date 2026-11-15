import bpy, sys, os
sys.path.insert(0, '/workspace/hero-game-assets/rig'); import prevlib
a = sys.argv[sys.argv.index('--')+1:]; name = a[0]; tag = a[1] if len(a) > 1 else 'anim'
bpy.ops.wm.open_mainfile(filepath=f'/workspace/hero-game-assets/rig/{name}_{tag}.blend')
ao = bpy.data.objects[f'{name}_rig']
co = prevlib.setup(340, samples=10)
H = 2.3 if name == 'tiger' else 2.0
SHOTS = [('idle', 0, 30), ('run', 3, 60), ('run', 11, 60), ('air', 10, 30), ('punch', 7, 40), ('blast', 6, 30),
         ('tackle', 12, 70), ('fly_hover', 12, 30), ('fly_fast', 6, 60), ('fly_fast', 6, 180), ('hit', 3, 30), ('fall', 5, 30), ('getup', 8, 60), ('down', 0, 60), ('blast', 6, 90), ('tackle', 12, 90), ('getup', 9, 90), ('fly_fast', 6, 90)]
os.makedirs(f'/tmp/prev_{name}', exist_ok=True)
for clip, f, az in SHOTS:
    ao.animation_data.action = bpy.data.actions[clip]; bpy.context.scene.frame_set(f)
    prevlib.shoot(co, (0, 0, H / 2 - 0.1), H * 1.15, az, f'/tmp/prev_{name}/{clip}_{f}_{az}.png')
