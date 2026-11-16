# Batch-5 clips for both heroes (keyframed with the same FK helpers as anim.py / counter.py), added to {name}_anim_face.blend:
#   land_boom               superhero landing: three-point crouch (right fist + left foot planted, right knee down), rise to idle
#   sprint_super            super-speed sprint loop: hard forward lean, high knees, fast pumping arms
#   leg_grab_spin           (rival AI) reach down and seize an ankle, both arms locked straight out for the giant swing, throw
#   leg_grabbed_hang        (victim) hanging from one ankle mid-swing: grabbed leg straight, free leg bent, arms flung out
#   leg_counter_curl_punch  (victim counter) crunch up toward the grabber (knee + torso curl) and drive a punch into them
# usage: blender -b --python batch5.py -- tiger|cent   (last step after fingers.py / cent_flight.py; see build_hands.sh)
import bpy, sys, math, shutil
from mathutils import Vector, Quaternion
name = sys.argv[sys.argv.index('--')+1:][0]
SRC = f'/workspace/hero-game-assets/rig/{name}_anim_face.blend'
import os
if not os.path.exists(SRC.replace('.blend', '_prebatch5.blend')): shutil.copy(SRC, SRC.replace('.blend', '_prebatch5.blend'))
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
made = {}
def P(spine=0, chest=0, neck=0, head=0, arms=None, legs=None, extra=None):
    d = {'spine': [('rot', X, spine)], 'chest': [('rot', X, chest)], 'neck': [('rot', X, neck)], 'head': [('rot', X, head)]}
    for sd in 'LR':
        s = s_(sd)
        if arms: ua, fa, ha = arms(sd, s); d[f'upper_arm.{sd}'] = [('aim', ua)]; d[f'forearm.{sd}'] = [('aim', fa)]
        if arms and ha: d[f'hand.{sd}'] = [('aim', ha)]
        if legs: th, sh, ft = legs(sd, s); d[f'thigh.{sd}'] = [('aim', th)]; d[f'shin.{sd}'] = [('aim', sh)]
        if legs and ft: d[f'foot.{sd}'] = [('aim', ft)]
    if extra: d.update(extra)
    return pose(d)
# ---- land_boom (0.46 s): impact crouch by f2, hold the three-point to f6, stand by f11 ----
def three_point():
    def arms(sd, s):
        if sd == 'R': return (-0.12, -0.35, -1), (-0.05, -0.15, -1), (0, -0.2, -1)        # right fist planted on the ground
        return (0.75, 0.45, -0.2), (0.6, 0.6, -0.35), None                                   # left arm flung back/out
    def legs(sd, s):
        if sd == 'L': return (0.2, -0.95, -0.15), (0.02, 0.18, -1), (0, -1, -0.15)          # left foot planted, knee up
        return (-0.12, -0.25, -1), (0, 1, -0.08), (0, 0.35, -1)                              # right knee on the ground, shin back
    return P(spine=32, chest=12, neck=-20, head=-18, arms=arms, legs=legs)
TP = three_point()
made['land_boom'] = keyframes('land_boom', [(0, {}), (2, TP), (6, TP), (11, {})], 11,
    hip=lambda f: Vector((0, 0, -hh * 0.5 * (smooth(f / 2) if f < 2 else (1 if f <= 6 else 1 - smooth((f - 6) / 5))))),
    cape=lambda f: 10 + 25 * (smooth(f / 2) if f < 2 else max(0, 1 - (f - 2) / 9)))
# ---- sprint_super (loop 10 frames = 0.42 s at timeScale 1; the game speeds it up with velocity) ----
def stride(k):  # k = +1: left leg forward / right arm forward
    def arms(sd, s):
        fw = (k if sd == 'R' else -k)
        if fw > 0: return (s * 0.12, -0.85, -0.25), (s * -0.1, -0.6, 0.8), None         # fist driven up in front
        return (s * 0.15, 0.85, -0.55), (s * 0.05, 0.2, -1), None                        # elbow ripped back
    def legs(sd, s):
        fw = (k if sd == 'L' else -k)
        if fw > 0: return (s * 0.04, -0.95, 0.05), (0, 0.15, -1), (0, -1, -0.3)          # knee up high
        return (s * 0.04, 0.55, -1), (0, 1, -0.35), (0, 0.6, -1)                         # driving leg pushed back
    return P(spine=24, chest=8, neck=-10, head=-14, arms=arms, legs=legs)
SA, SB = stride(1), stride(-1)
made['sprint_super'] = keyframes('sprint_super', [(0, SA), (5, SB), (10, SA)], 10,
    hip=lambda f: Vector((0, 0, -hh * 0.06 + hh * 0.04 * abs(math.sin(math.pi * f / 5)))), cape=lambda f: 45 + 8 * math.sin(2 * math.pi * f / 5))
# ---- leg_grab_spin (1.75 s = 42 f): reach low f0-f4, lock arms out holding the ankle f8, lean back through the swing, throw f38 ----
def reach():
    return P(spine=40, chest=12, neck=-18, head=-10, arms=lambda sd, s: ((s * 0.12, -0.6, -0.8), (s * -0.05, -0.75, -0.65), (0, -0.7, -0.7)),
             legs=lambda sd, s: ((s * 0.22, -0.55, -0.85), (0, 0.4, -1), None))
def swing(lean):
    return P(spine=-10 - lean, chest=-6, neck=12, head=8, arms=lambda sd, s: ((s * 0.1, -1, 0.05), (s * -0.06, -1, 0.05), (0, -1, 0)),
             legs=lambda sd, s: ((s * 0.32, -0.25, -1), (s * 0.12, 0.3, -1), None))
def fling():
    return P(spine=18, chest=10, neck=-8, head=-6, arms=lambda sd, s: ((s * 0.45, -0.7, 0.55), (s * 0.4, -0.6, 0.7), None),
             legs=lambda sd, s: ((s * 0.25, -0.35, -1), (0, 0.25, -1), None))
RC, S1, S2, FL = reach(), swing(6), swing(18), fling()
made['leg_grab_spin'] = keyframes('leg_grab_spin', [(0, {}), (4, RC), (8, S1), (20, S2), (36, S2), (38, FL), (42, {})], 42,
    hip=lambda f: Vector((0, 0, -hh * 0.12 * (smooth(f / 4) if f < 6 else max(0, 1 - (f - 6) / 4)))), cape=lambda f: 12 + 40 * smooth(min(1, max(0, (f - 6) / 14))))
# ---- leg_grabbed_hang (loop 12 f): grabbed (right) leg straight, left leg flailing, arms flung out wide (the game lays the body
#      out along the swing, feet toward the grabber) ----
def hang(k):
    return P(spine=-6, chest=-4, neck=-10, head=-8,
             arms=lambda sd, s: ((s * 0.8, 0.25 * k * s, 0.55), (s * 0.7, 0.3, 0.65), None),
             legs=lambda sd, s: ((0, 0, -1), (0, 0.02, -1), (0, -0.2, -1)) if sd == 'R' else ((s * 0.3, -0.45 - 0.15 * k, -0.85), (s * 0.1, 0.55, -0.85), None))
made['leg_grabbed_hang'] = keyframes('leg_grabbed_hang', [(0, hang(1)), (6, hang(-1)), (12, hang(1))], 12, cape=lambda f: 50)
# ---- leg_counter_curl_punch (0.6 s = 14 f): crunch toward the grabber at the feet (torso folds over the legs, free knee
#      to the chest) by f5, right fist drives toward the feet at f7-f8 (game hit at 0.3 s), straighten out by f14 ----
HG = hang(1)
CURL = P(spine=55, chest=28, neck=18, head=10, arms=lambda sd, s: ((s * 0.25, -0.75, -0.6), (s * -0.1, -0.9, 0.2), None),
         legs=lambda sd, s: ((0, 0, -1), (0, 0.05, -1), None) if sd == 'R' else ((s * 0.1, -0.95, 0.15), (0, 0.6, -0.8), None))
PUNCH = P(spine=62, chest=30, neck=12, head=6,
          arms=lambda sd, s: ((s * 0.05, -0.35, -1), (0, -0.3, -1), (0, -0.3, -1)) if sd == 'R' else ((s * 0.55, 0.3, 0.6), (s * 0.4, -0.6, 0.5), None),
          legs=lambda sd, s: ((0, 0, -1), (0, 0.05, -1), None) if sd == 'R' else ((s * 0.1, -0.9, 0.25), (0, 0.55, -0.8), None))
made['leg_counter_curl_punch'] = keyframes('leg_counter_curl_punch', [(0, HG), (5, CURL), (7, PUNCH), (9, PUNCH), (14, {})], 14, cape=lambda f: 30)
ao.animation_data.action = bpy.data.actions['idle']
for pb in ao.pose.bones: pb.rotation_quaternion = Quaternion(); pb.location = Vector()
bpy.ops.wm.save_as_mainfile(filepath=SRC)
print('BATCH5_CLIPS', {k: round(v / FPS, 2) for k, v in made.items()}, 'actions', len(bpy.data.actions))
