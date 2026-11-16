# preview renders of a villain blend: rest front/side/back + flight pose (side, world pitch ~45 deg like the game)
import bpy, sys, os, math
sys.path.insert(0, '/workspace/hero-game-assets/rig'); import prevlib
VK = sys.argv[sys.argv.index('--') + 1:][0]; tag = sys.argv[sys.argv.index('--') + 2] if len(sys.argv) > sys.argv.index('--') + 2 else 'v'
bpy.ops.wm.open_mainfile(filepath=f'/workspace/hero-game-assets/rig/villain_{VK}_anim_face.blend')
ao = bpy.data.objects['cent_rig']; co = prevlib.setup(560, samples=16); os.makedirs('/tmp/vprev', exist_ok=True)
ao.animation_data.action = bpy.data.actions['idle']; bpy.context.scene.frame_set(0)
for az in (0, 90, 180): prevlib.shoot(co, (0, 0, 0.95), 2.2, az, f'/tmp/vprev/{VK}_{tag}_idle_{az}.png')
prevlib.shoot(co, (0, -0.02, 1.68), 0.42, 0, f'/tmp/vprev/{VK}_{tag}_head_0.png'); prevlib.shoot(co, (0, -0.02, 1.68), 0.42, 40, f'/tmp/vprev/{VK}_{tag}_head_40.png')
ao.animation_data.action = bpy.data.actions['fly_fast']; bpy.context.scene.frame_set(6)
ao.rotation_mode = 'XYZ'; ao.rotation_euler = (math.radians(45), 0, 0); ao.location = (0, 0, 0.3)  # pitch forward (forward = -Y)
prevlib.shoot(co, (0, 0.2, 0.9), 2.9, 90, f'/tmp/vprev/{VK}_{tag}_fly_90.png'); prevlib.shoot(co, (0, 0.2, 0.9), 2.9, 60, f'/tmp/vprev/{VK}_{tag}_fly_60.png')
