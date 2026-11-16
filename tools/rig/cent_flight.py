# Centurion's fly_fast clip re-keyed in Ben's Omni-Man reference pose (FK helpers are the same as counter.py / anim.py).
# Build order: anim.py -> face_cent/* -> counter.py -> fingers.py -> cent_flight.py -> export.py -> gltf-transform
# usage: blender -b --python cent_flight.py -- cent   (after fingers.py; then export.py + gltf-transform as in face_cent/build.sh)
import bpy, sys, math, shutil
from mathutils import Vector, Quaternion
name = sys.argv[sys.argv.index('--')+1:][0]
SRC = f'/workspace/hero-game-assets/rig/{name}_anim_face.blend'
import os
if not os.path.exists(SRC.replace('.blend', '_preflight.blend')): shutil.copy(SRC, SRC.replace('.blend', '_preflight.blend'))  # one-time backup
bpy.ops.wm.open_mainfile(filepath=SRC)
FPS = 24; bpy.context.scene.render.fps = FPS
ao = bpy.data.objects[f'{name}_rig']; arm = ao.data
order = [b.name for b in arm.bones]; R0 = {b.name: b.matrix_local.to_3x3() for b in arm.bones}
hh = arm.bones['hips'].head_local.z
# --- same FK helpers as anim.py (armature space: forward -Y, up +Z, character's left +X) ---
def rest_dir(n): b = arm.bones[n]; return (b.tail_local - b.head_local).normalized()
def q_rot(axis, deg): return Quaternion(Vector(axis), math.radians(deg))
def to_local(n, qa): M = R0[n]; return (M.inverted() @ qa.to_matrix() @ M).to_quaternion().normalized()
def pose(spec):
    Qw = {}; out = {}
    for n in order:
        b = arm.bones[n]; Qp = Qw.get(b.parent.name, Quaternion()) if b.parent else Quaternion()
        q = Qp.copy()
        for op in spec.get(n, []):
            if op[0] == 'rot': q = q @ q_rot(op[1], op[2])
            else: cur = q @ rest_dir(n); q = cur.rotation_difference(Vector(op[1]).normalized()) @ q
        Qw[n] = q
        if n in spec: out[n] = to_local(n, Qp.inverted() @ q)
    return out
def lerp_pose(A, B, t): return {n: A.get(n, Quaternion()).slerp(B.get(n, Quaternion()), t) for n in set(A) | set(B)}
def smooth(t): t = max(0, min(1, t)); return t * t * (3 - 2 * t)
def new_action(nm):
    if nm in bpy.data.actions: bpy.data.actions.remove(bpy.data.actions[nm])
    a = bpy.data.actions.new(nm); a.use_fake_user = True
    if not ao.animation_data: ao.animation_data_create()
    ao.animation_data.action = a
    for pb in ao.pose.bones: pb.rotation_mode = 'QUATERNION'
    return a
capes = [b.name for b in arm.bones if b.name.startswith('cape_')]; tails = [b.name for b in arm.bones if b.name.startswith('tail')]
def keyframes(out, keys, length, hip=None, cape=None):
    new_action(out)
    for f in range(length + 1):
        k = max(i for i in range(len(keys)) if keys[i][0] <= f)
        if k == len(keys) - 1: P = dict(keys[k][1])
        else: fa, A = keys[k]; fb, B = keys[k + 1]; P = lerp_pose(A, B, smooth((f - fa) / (fb - fa)))
        for pb in ao.pose.bones:
            q = P.get(pb.name, Quaternion())
            if cape and pb.name in capes: i = int(pb.name[6]) - 1; q = to_local(pb.name, q_rot((1, 0, 0), cape(f) * (1 if i == 0 else 0.35)))
            if pb.name in tails: k2 = tails.index(pb.name); q = to_local(pb.name, q_rot((0, 0, 1), (6 + 5 * k2) * math.sin(f * 0.6 - k2)))
            pb.rotation_quaternion = q; pb.keyframe_insert('rotation_quaternion', frame=f, group=pb.name)
            if pb.name == 'hips':
                pb.location = R0['hips'].inverted() @ (hip(f) if hip else Vector()); pb.keyframe_insert('location', frame=f, group=pb.name)
    for fc in bpy.data.actions[out].fcurves:
        for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
    return length
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
s_ = lambda sd: 1 if sd == 'L' else -1

# ---- Centurion fly_fast: Omni-Man style - stretched out, BOTH arms reaching forward-up past the head slightly apart,
# knife hands (palms down), head up looking ahead, legs together straight back, toes pointed (game pitches the body ~85 deg)
assert name == 'cent'
bpy.context.view_layer.update()
palmA = {}
for sd in 'LR':  # palm direction at rest, armature space (from the palm_ markers added by fingers.py)
    e = bpy.data.objects[f'palm_{sd}']; hb = arm.bones[f'hand.{sd}']
    p = ao.matrix_world.inverted() @ e.matrix_world.translation; a = hb.head_local; d = (hb.tail_local - a).normalized()
    v = p - a; v -= d * v.dot(d); palmA[sd] = v.normalized()
def pose_tw(spec, twist_hands):
    Qw = {}; out = {}
    for n in order:
        b = arm.bones[n]; Qp = Qw.get(b.parent.name, Quaternion()) if b.parent else Quaternion()
        q = Qp.copy()
        for op in spec.get(n, []):
            if op[0] == 'rot': q = q @ q_rot(op[1], op[2])
            else: cur = q @ rest_dir(n); q = cur.rotation_difference(Vector(op[1]).normalized()) @ q
        if n in twist_hands:  # twist the hand about its own axis so the palm faces the wanted direction
            sd = n[-1]; ax = (q @ rest_dir(n)).normalized(); pw = q @ palmA[sd]; want = Vector(twist_hands[n]); want -= ax * want.dot(ax); pw -= ax * pw.dot(ax)
            if want.length > 1e-4 and pw.length > 1e-4:
                ang = pw.normalized().angle(want.normalized()); sgn = 1 if pw.cross(want).dot(ax) > 0 else -1
                q = Quaternion(ax, sgn * ang) @ q
        Qw[n] = q
        if n in spec or n in twist_hands: out[n] = to_local(n, Qp.inverted() @ q)
    return out
def omni(ph=0.0):
    d = {'spine': [('rot', X, -4)], 'chest': [('rot', X, -4)], 'upper_chest': [('rot', X, -3)], 'neck': [('rot', X, -24)], 'head': [('rot', X, -30)]}
    for sd in 'LR':
        s = s_(sd)
        d[f'shoulder.{sd}'] = [('rot', Y, -14 * s)]
        d[f'upper_arm.{sd}'] = [('aim', (s * 0.07, 0.15, 1))]; d[f'forearm.{sd}'] = [('aim', (s * 0.02, 0.1, 1))]; d[f'hand.{sd}'] = [('aim', (s * 0.0, 0.06, 1))]
        d[f'thigh.{sd}'] = [('aim', (s * 0.025, 0.05 + 0.01 * math.sin(ph + (0 if sd == 'L' else 1)), -1))]; d[f'shin.{sd}'] = [('aim', (s * 0.01, 0.07, -1))]
        d[f'foot.{sd}'] = [('aim', (0, 0.12, -1))]
    return pose_tw(d, {'hand.L': (0, -1, 0), 'hand.R': (0, -1, 0)})  # palms down (body front = ground side in flight)
keys = [(f, omni(2 * math.pi * f / 24)) for f in range(0, 25, 6)]
n = keyframes('fly_fast', keys, 24, cape=lambda f: 18 + 7 * math.sin(2 * math.pi * 4 * f / 24))
ao.animation_data.action = bpy.data.actions['idle']
for pb in ao.pose.bones: pb.rotation_quaternion = Quaternion(); pb.location = Vector()
bpy.ops.wm.save_as_mainfile(filepath=SRC)
print('FLY_FAST', n, 'frames; palm dirs', {k: tuple(round(c, 2) for c in v) for k, v in palmA.items()})
