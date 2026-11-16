# Retarget CC0 Quaternius UAL clips + keyframe superhero clips procedurally, add cape/tail secondary motion.
# usage: blender -b --python anim.py -- tiger|cent
import bpy, sys, math, numpy as np
from mathutils import Vector, Matrix, Quaternion
name = sys.argv[sys.argv.index('--')+1:][0]
FPS = 24
bpy.ops.wm.open_mainfile(filepath=f'/workspace/hero-game-assets/rig/{name}_rigged.blend')
sc = bpy.context.scene; sc.render.fps = FPS
ao = bpy.data.objects[f'{name}_rig']; arm = ao.data
bpy.ops.import_scene.gltf(filepath='/workspace/hero-game-assets/anim/AnimationLibrary_Godot_Standard.gltf')
src = bpy.data.objects['Rig']; srcmesh = [o for o in bpy.data.objects if o.name in ('Mannequin', 'Icosphere')]
for o in srcmesh: o.hide_render = True
TIGER = name == 'tiger'
MAP = {'hips': 'DEF-hips', 'spine': 'DEF-spine.001', 'chest': 'DEF-spine.002', 'upper_chest': 'DEF-spine.003', 'neck': 'DEF-neck', 'head': 'DEF-head'}
for s in 'LR':
    for b in ('shoulder', 'upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe'): MAP[f'{b}.{s}'] = f'DEF-{b}.{s}'
LIMB = {k for k in MAP if '.' in k}
BODY = list(MAP.keys())
order = [b.name for b in arm.bones]  # parents before children
R0 = {b.name: b.matrix_local.to_3x3() for b in arm.bones}
S0 = {b.name: b.matrix_local.to_3x3() for b in src.data.bones}
def bdir(bn, bones): b = bones[bn]; return (b.tail_local - b.head_local).normalized()
ALIGN = {}
for t, s in MAP.items():
    if t in LIMB: ALIGN[t] = bdir(t, arm.bones).rotation_difference(bdir(s, src.data.bones)).to_matrix()
    else: ALIGN[t] = Matrix.Identity(3)
src_hip_h = src.data.bones['DEF-hips'].head_local.z; tgt_hip_h = arm.bones['hips'].head_local.z
HS = tgt_hip_h / src_hip_h
def ortho(m): return m.to_quaternion().normalized().to_matrix()
def basis_from_world(des):
    """des: {bone: armature-space 3x3}; returns {bone: local basis quaternion}"""
    out = {}
    for n in order:
        if n not in des: continue
        b = arm.bones[n]; p = b.parent
        if p is None or p.name not in des: Rp_rest, Rp_des = (R0[p.name], R0[p.name]) if p else (Matrix.Identity(3), Matrix.Identity(3))
        else: Rp_rest, Rp_des = R0[p.name], des[p.name]
        B = R0[n].inverted() @ Rp_rest @ Rp_des.inverted() @ des[n]
        out[n] = B.to_quaternion().normalized()
    return out
def new_action(nm):
    if nm in bpy.data.actions: bpy.data.actions.remove(bpy.data.actions[nm])
    a = bpy.data.actions.new(nm); a.use_fake_user = True
    if not ao.animation_data: ao.animation_data_create()
    ao.animation_data.action = a
    for pb in ao.pose.bones: pb.rotation_mode = 'QUATERNION'
    return a
def key_all(f, basis, hiploc=Vector()):
    for pb in ao.pose.bones:
        q = basis.get(pb.name, Quaternion()); pb.rotation_quaternion = q
        pb.keyframe_insert('rotation_quaternion', frame=f, group=pb.name)
        if pb.name == 'hips':
            pb.location = hiploc; pb.keyframe_insert('location', frame=f, group=pb.name)
# per-hero arm/leg spread (bulky bodies need wider arms so hands clear the torso)
SPREAD = 14 if TIGER else 6
def spread_mat(side, deg): return Matrix.Rotation(math.radians(deg) * (1 if side == 'L' else -1), 3, 'Y')
def retarget(src_action, out, f0=None, f1=None, mirror=False, hip_xy=True, extra=None):
    a = bpy.data.actions[src_action]; src.animation_data.action = a
    fr = [int(x) for x in a.frame_range]; f0 = fr[0] if f0 is None else f0; f1 = fr[1] if f1 is None else f1
    frames = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f); des = {}
        Msrc = {n: ortho(src.pose.bones[n].matrix.to_3x3()) for n in S0}
        for t, s in MAP.items():
            if mirror:  # use the opposite side, reflected across X
                so = s.replace('.L', '.X').replace('.R', '.L').replace('.X', '.R')
                Mx = Matrix.Diagonal((-1, 1, 1))
                D = Mx @ (Msrc[so] @ S0[so].inverted()) @ Mx
                al = ALIGN[t]
            else:
                D = Msrc[s] @ S0[s].inverted(); al = ALIGN[t]
            if t.startswith('shoulder'): D = Quaternion().slerp(D.to_quaternion(), 0.45).to_matrix()
            des[t] = ortho(D @ al @ R0[t])
        for sd in 'LR':
            Q = spread_mat(sd, SPREAD)
            for k in ('upper_arm', 'forearm', 'hand'): des[f'{k}.{sd}'] = Q @ des[f'{k}.{sd}']
        hp = src.pose.bones['DEF-hips'].head - src.data.bones['DEF-hips'].head_local
        if mirror: hp.x = -hp.x
        if not hip_xy: hp.x = hp.y = 0
        frames.append((des, hp * HS))
    new_action(out)
    for i, (des, hp) in enumerate(frames):
        if extra: extra(i, des)
        basis = basis_from_world(des)
        loc = R0['hips'].inverted() @ hp
        key_all(i, basis, loc)
    return len(frames) - 1
# ---------- procedural pose helpers (FK in armature-rest axes) ----------
def rest_dir(n): b = arm.bones[n]; return (b.tail_local - b.head_local).normalized()
def q_aim(n, d): return rest_dir(n).rotation_difference(Vector(d).normalized())
def q_rot(axis, deg): return Quaternion(Vector(axis), math.radians(deg))
def to_local(n, qa): M = R0[n]; return (M.inverted() @ qa.to_matrix() @ M).to_quaternion().normalized()
def pose(spec):
    """spec: {bone: [('aim', dir) | ('rot', axis, deg), ...]}.
    'aim' = absolute final direction in armature space (minimal swing from the inherited orientation);
    'rot' = rotation about armature-rest axes applied in the parent's frame (FK bend). Returns local basis quats."""
    Qw = {}; out = {}
    for n in order:
        b = arm.bones[n]; Qp = Qw.get(b.parent.name, Quaternion()) if b.parent else Quaternion()
        q = Qp.copy()
        for op in spec.get(n, []):
            if op[0] == 'rot': q = q @ q_rot(op[1], op[2])
            else:
                cur = q @ rest_dir(n); q = cur.rotation_difference(Vector(op[1]).normalized()) @ q
        Qw[n] = q
        if n in spec: out[n] = to_local(n, Qp.inverted() @ q)
    return out
def lerp_pose(A, B, t):
    out = {}
    for n in set(A) | set(B):
        out[n] = A.get(n, Quaternion()).slerp(B.get(n, Quaternion()), t)
    return out
def smooth(t): t = max(0, min(1, t)); return t * t * (3 - 2 * t)
def keyframes(out, keys, length, loop=False, hip=None, noise=None):
    """keys: list of (frame, pose-dict); interpolated per frame with smoothstep; hip(f)->Vector (armature offsets)"""
    new_action(out)
    for f in range(length + 1):
        k = max(i for i in range(len(keys)) if keys[i][0] <= f)
        if k == len(keys) - 1: P = keys[k][1]
        else:
            fa, A = keys[k]; fb, B = keys[k + 1]; P = lerp_pose(A, B, smooth((f - fa) / (fb - fa)))
        P = dict(P)
        if noise: noise(f, P)
        loc = R0['hips'].inverted() @ (hip(f) if hip else Vector())
        key_all(f, P, loc)
    return length
def addrot(P, n, axis, deg):
    P[n] = (to_local(n, q_rot(axis, deg)) @ P.get(n, Quaternion())).normalized()
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
s_ = lambda sd: 1 if sd == 'L' else -1
# ---------- clips ----------
clips = {}
clips['idle'] = retarget('Idle_Loop_Rig', 'idle')
clips['run'] = retarget('Sprint_Loop_Rig', 'run', hip_xy=False)
clips['air'] = retarget('Jump_Loop_Rig', 'air')
clips['punch'] = retarget('Punch_Cross_Rig', 'punch', 0, 20)
clips['hit'] = retarget('Hit_Chest_Rig', 'hit', hip_xy=False)
# hover: upright, legs dangling, slow bob
def hover_pose(ph):
    if TIGER: return endeavor_hover(ph)
    sp = 0.42
    d = {}
    for sd in 'LR':
        s = s_(sd); fwd = -0.18 if sd == 'L' else 0.12
        d[f'upper_arm.{sd}'] = [('aim', (s * sp, -0.08, -1))]
        d[f'forearm.{sd}'] = [('aim', (s * sp * 0.6, -0.45, -1))]
        d[f'hand.{sd}'] = [('aim', (s * 0.3, -0.45, -1))]
        d[f'thigh.{sd}'] = [('aim', (s * 0.06, fwd + 0.04 * math.sin(ph + s), -1))]
        d[f'shin.{sd}'] = [('aim', (0, 0.32 + (0.12 if sd == 'R' else 0), -1))]
        d[f'foot.{sd}'] = [('aim', (0, -0.55, -0.7))]
    d['spine'] = [('rot', X, 3)]; d['head'] = [('rot', X, -3)]
    return pose(d)
# ---- Temper Tiger: jet-propulsion flight (fists are the thrusters; armature space: +X = his left, -Y = forward, +Z = up) ----
# The game pitches the whole body forward in flight, so body-space "down and a bit back" becomes world "straight back".
def endeavor_hover(ph):
    """hovering on the jets: chest up, fists driven down and out beside the hips, one knee drawn up, the other leg hanging"""
    d = {}; b = math.sin(ph); b2 = math.sin(ph + 1.3)
    for sd in 'LR':
        s = s_(sd); k = b if sd == 'L' else b2
        d[f'shoulder.{sd}'] = [('rot', Y, -4 * s)]
        d[f'upper_arm.{sd}'] = [('aim', (s * (0.48 + 0.04 * k), 0.24, -1))]
        d[f'forearm.{sd}'] = [('aim', (s * 0.3, 0.14 + 0.03 * k, -1))]
        d[f'hand.{sd}'] = [('aim', (s * 0.26, 0.1, -1))]
    d['thigh.L'] = [('aim', (0.14, -0.55 + 0.05 * b, -0.85))]; d['shin.L'] = [('aim', (0.04, 0.42, -1))]
    d['thigh.R'] = [('aim', (-0.1, 0.02 + 0.04 * b2, -1))]; d['shin.R'] = [('aim', (-0.02, 0.22, -1))]
    for sd in 'LR': d[f'foot.{sd}'] = [('aim', (0, -0.15, -1))]
    d['spine'] = [('rot', X, 5)]; d['chest'] = [('rot', X, -4)]; d['upper_chest'] = [('rot', X, -4)]
    d['neck'] = [('rot', X, -2)]; d['head'] = [('rot', X, -4)]
    return pose(d)
def endeavor_cruise(ph=0.0):
    """cruising: chest thrust out, shoulders back, arms driven out and back behind him (jets streaming straight back),
    head up, legs trailing with the right knee bent"""
    d = {}
    for sd in 'LR':
        s = s_(sd)
        d[f'shoulder.{sd}'] = [('rot', Y, -10 * s)]
        d[f'upper_arm.{sd}'] = [('aim', (s * 0.58, 0.48, -0.85))]
        d[f'forearm.{sd}'] = [('aim', (s * 0.42, 0.44, -0.9))]
        d[f'hand.{sd}'] = [('aim', (s * 0.34, 0.44, -0.9))]
        d[f'foot.{sd}'] = [('aim', (0, 0.25, -1))]
    d['thigh.L'] = [('aim', (0.12, 0.14, -1))]; d['shin.L'] = [('aim', (0.05, 0.3, -1))]
    d['thigh.R'] = [('aim', (-0.1, -0.12, -1))]; d['shin.R'] = [('aim', (-0.02, 0.95, -0.55))]
    d['spine'] = [('rot', X, -5)]; d['chest'] = [('rot', X, -8)]; d['upper_chest'] = [('rot', X, -7)]
    d['neck'] = [('rot', X, -16)]; d['head'] = [('rot', X, -24)]
    return pose(d)
def endeavor_boost():
    """full burn: arms locked straight back like twin afterburners, fists clenched, legs together and streamlined, head driven forward"""
    d = {}
    for sd in 'LR':
        s = s_(sd)
        d[f'shoulder.{sd}'] = [('rot', Y, -14 * s)]
        d[f'upper_arm.{sd}'] = [('aim', (s * 0.4, 0.36, -0.93))]
        d[f'forearm.{sd}'] = [('aim', (s * 0.3, 0.34, -0.95))]
        d[f'hand.{sd}'] = [('aim', (s * 0.26, 0.34, -0.95))]
        d[f'thigh.{sd}'] = [('aim', (s * 0.06, 0.1, -1))]
        d[f'shin.{sd}'] = [('aim', (s * 0.03, 0.34 if sd == 'R' else 0.2, -1))]
        d[f'foot.{sd}'] = [('aim', (0, 0.35, -1))]
    d['spine'] = [('rot', X, -3)]; d['chest'] = [('rot', X, -6)]; d['upper_chest'] = [('rot', X, -5)]
    d['neck'] = [('rot', X, -24)]; d['head'] = [('rot', X, -32)]
    return pose(d)
N = 48
clips['fly_hover'] = keyframes('fly_hover', [(f, hover_pose(2 * math.pi * f / N)) for f in range(0, N + 1, 6)], N,
                               hip=lambda f: Vector((0, 0, 0.035 * math.sin(2 * math.pi * f / N))))
# fast flight (the game pitches the whole body forward, so "up" here becomes "forward" in flight)
def flyfast():
    d = {}
    if TIGER: return endeavor_cruise()
    else:      # Superman: right fist straight ahead (overhead in body space), left arm along the side
        d['upper_arm.R'] = [('aim', (-0.08, -0.12, 1))]; d['forearm.R'] = [('aim', (-0.06, -0.12, 1))]; d['hand.R'] = [('aim', (-0.05, -0.1, 1))]
        d['shoulder.R'] = [('rot', Y, 12)]
        d['upper_arm.L'] = [('aim', (0.22, 0.22, -1))]; d['forearm.L'] = [('aim', (0.15, 0.3, -1))]; d['hand.L'] = [('aim', (0.1, 0.35, -1))]
        d['thigh.L'] = [('aim', (0.04, 0.04, -1))]; d['shin.L'] = [('aim', (0.02, 0.08, -1))]
        d['thigh.R'] = [('aim', (-0.03, 0.12, -1))]; d['shin.R'] = [('aim', (0, 0.45, -1))]
        for sd in 'LR': d[f'foot.{sd}'] = [('aim', (0, -0.2, -1))]
        d['chest'] = [('rot', X, -5)]; d['neck'] = [('rot', X, -22)]; d['head'] = [('rot', X, -30)]; d['upper_chest'] = [('rot', Y, 6)]
    return pose(d)
FF = flyfast()
def ff_noise(f, P):
    w = 2 * math.pi * f / 24
    addrot(P, 'hips', Y, 1.5 * math.sin(w)); addrot(P, 'thigh.L', X, 2 * math.sin(w * 2)); addrot(P, 'thigh.R', X, -2 * math.sin(w * 2))
    if TIGER:  # thrust corrections: the fists steer the jets, the shoulders roll against them
        for sd in 'LR': addrot(P, f'upper_arm.{sd}', X, 3 * math.sin(w * 2 + (0 if sd == 'L' else 1.6)))
        addrot(P, 'upper_chest', Y, 2 * math.sin(w))
clips['fly_fast'] = keyframes('fly_fast', [(0, FF), (24, FF)], 24, noise=ff_noise)
if TIGER:  # full-burn boost / sonic-boom flight (blended in by speed)
    FB = endeavor_boost()
    def fb_noise(f, P):  # high-frequency buffeting from the jets
        w = 2 * math.pi * f / 16
        addrot(P, 'upper_chest', Z, 1.5 * math.sin(w * 2)); addrot(P, 'head', X, 1.2 * math.sin(w * 3))
        for sd in 'LR': addrot(P, f'forearm.{sd}', X, 2 * math.sin(w * 4 + (0 if sd == 'L' else 2)))
    clips['fly_boost'] = keyframes('fly_boost', [(0, FB), (16, FB)], 16, noise=fb_noise)
# tackle: both arms thrust forward/up, leaning in, legs trailing
def tackle_pose():
    d = {'spine': [('rot', X, 14)], 'chest': [('rot', X, 10)], 'neck': [('rot', X, -18)], 'head': [('rot', X, -22)]}
    for sd in 'LR':
        s = s_(sd)
        d[f'shoulder.{sd}'] = [('rot', Y, 10 * s)]
        d[f'upper_arm.{sd}'] = [('aim', (s * 0.22, -0.85, 0.5))]
        d[f'forearm.{sd}'] = [('aim', (s * 0.12, -1, 0.3))]
        d[f'hand.{sd}'] = [('aim', (s * 0.05, -1, 0.2))]
        d[f'thigh.{sd}'] = [('aim', (s * 0.1, 0.3 if sd == 'L' else 0.15, -1))]
        d[f'shin.{sd}'] = [('aim', (0, 0.7 if sd == 'L' else 0.45, -1))]
        d[f'foot.{sd}'] = [('aim', (0, -0.2, -1))]
    return pose(d)
TP = tackle_pose()
def tk_noise(f, P):
    if f >= 4: addrot(P, 'upper_chest', Z, 2.5 * math.sin(f * 1.7)); addrot(P, 'head', X, 2 * math.sin(f * 2.3))
clips['tackle'] = keyframes('tackle', [(0, {}), (4, TP), (24, TP)], 24, noise=tk_noise)
# blast: right hand thrust forward at shoulder height, palm out; torso twists into it (13 frames = game's 0.55 s)
def blast_pose(k):
    d = {'upper_chest': [('rot', Z, 16 * k)], 'spine': [('rot', Z, 6 * k)], 'head': [('rot', Z, -14 * k)],
         'upper_arm.R': [('aim', (-0.12, -1, 0.06))], 'forearm.R': [('aim', (-0.05, -1, 0.1))], 'hand.R': [('aim', (0, -0.35, 1))],
         'upper_arm.L': [('aim', (0.5, 0.3, -1))], 'forearm.L': [('aim', (0.4, 0.05, -1))], 'hand.L': [('aim', (0.3, 0.0, -1))],
         'thigh.L': [('aim', (0.12, -0.2, -1))], 'shin.L': [('aim', (0, 0.15, -1))], 'thigh.R': [('aim', (-0.14, 0.18, -1))], 'shin.R': [('aim', (0, 0.25, -1))]}
    return pose(d)
BP = blast_pose(1)
idle0 = None
clips['blast'] = keyframes('blast', [(0, {}), (3, BP), (10, BP), (13, {})], 13,
                           noise=lambda f, P: addrot(P, 'hand.R', X, -6 * math.sin(f * 2.1) if 3 <= f <= 10 else 0))
# fall: limp flailing loop used while ragdolled
def flail(f):
    w = 2 * math.pi * f / 20; d = {}
    for sd in 'LR':
        s = s_(sd); p = 0 if sd == 'L' else 1.9
        d[f'upper_arm.{sd}'] = [('aim', (s * (0.9 + 0.3 * math.sin(w + p)), -0.4 * math.cos(w * 1.3 + p), 0.5 * math.sin(w + p)))]
        d[f'forearm.{sd}'] = [('aim', (s * 0.8, -0.6 + 0.3 * math.sin(w * 1.7 + p), 0.6))]
        d[f'thigh.{sd}'] = [('aim', (s * 0.25, -0.5 * math.sin(w + p * 1.3), -1))]
        d[f'shin.{sd}'] = [('aim', (0, 0.6 + 0.3 * math.cos(w + p), -1))]
    d['spine'] = [('rot', X, -12)]; d['chest'] = [('rot', X, -8)]; d['head'] = [('rot', X, -20 + 10 * math.sin(w))]
    return pose(d)
clips['fall'] = keyframes('fall', [(f, flail(f)) for f in range(0, 21, 2)], 20)
# get-up: from the limp "down" pose to standing (the game uprights the body; this unfolds the limbs)
def down_pose():
    d = {'spine': [('rot', X, -8)], 'head': [('rot', X, -10)]}
    for sd in 'LR':
        s = s_(sd)
        d[f'upper_arm.{sd}'] = [('aim', (s * 1, -0.15, 0.25))]; d[f'forearm.{sd}'] = [('aim', (s * 0.9, -0.3, 0.45))]
        d[f'thigh.{sd}'] = [('aim', (s * 0.3, -0.15, -1))]; d[f'shin.{sd}'] = [('aim', (s * 0.1, 0.2, -1))]
    return pose(d)
def crouch_pose():
    d = {'spine': [('rot', X, 22)], 'chest': [('rot', X, 8)], 'head': [('rot', X, -18)]}
    for sd in 'LR':
        s = s_(sd)
        d[f'upper_arm.{sd}'] = [('aim', (s * 0.35, -0.6, -1))]; d[f'forearm.{sd}'] = [('aim', (s * 0.1, -0.5, -1))]
        d[f'thigh.{sd}'] = [('aim', (s * 0.3, -1, -0.75))]; d[f'shin.{sd}'] = [('aim', (0, 0.45, -1))]; d[f'foot.{sd}'] = [('aim', (0, -1, -0.15))]
    return pose(d)
DN, CR = down_pose(), crouch_pose()
hh = tgt_hip_h
clips['getup'] = keyframes('getup', [(0, DN), (7, CR), (11, CR), (16, {})], 16,
                           hip=lambda f: Vector((0, 0.06, -hh * 0.38 * (smooth(f / 7) if f < 11 else 1 - smooth((f - 11) / 5)))))
clips['down'] = keyframes('down', [(0, DN), (24, DN)], 24, noise=lambda f, P: addrot(P, 'chest', X, 1.5 * math.sin(f / 24 * 2 * math.pi)))
# ---------- cape + tail secondary motion (keyed per clip) ----------
capes = [b.name for b in arm.bones if b.name.startswith('cape_')]
tails = [b.name for b in arm.bones if b.name.startswith('tail')]
CFG = {  # base lift (deg), flutter amplitude (deg), flutter speed (cycles/sec), gravity compensation
    'idle': (2, 2.5, 0.5, 0.9), 'run': (28, 7, 2.5, 0.6), 'air': (14, 6, 1.5, 0.3), 'punch': (6, 4, 2, 0.8), 'hit': (8, 6, 3, 0.6),
    'fly_hover': (6, 5, 0.8, 0.7), 'fly_fast': (16, 7, 4, 0.0), 'fly_boost': (24, 9, 6, 0.0), 'tackle': (20, 8, 4, 0.2), 'blast': (5, 4, 2, 0.8),
    'fall': (22, 10, 2.0, 0.0), 'getup': (6, 3, 1, 0.6), 'down': (-10, 0.5, 0.3, 0.0)}
def chest_pitch(f):
    sc.frame_set(f); bpy.context.view_layer.update()
    m = (ao.pose.bones['upper_chest'].matrix.to_3x3() @ Vector((0, 1, 0))).normalized()  # bone Y axis = up
    return math.degrees(math.atan2(-m.y, m.z))
rb = arm.bones['upper_chest']; _u = (rb.matrix_local.to_3x3() @ Vector((0, 1, 0))).normalized(); rest_pitch = math.degrees(math.atan2(-_u.y, _u.z))
for clip, length in clips.items():
    act = bpy.data.actions[clip]; ao.animation_data.action = act
    lift, amp, spd, comp = CFG[clip]
    pitches = [chest_pitch(f) for f in range(length + 1)]
    loop = clip in ('idle', 'run', 'air', 'fly_hover', 'fly_fast', 'fly_boost', 'tackle', 'fall', 'down')
    # loops: snap flutter speed to a whole number of cycles over the clip so it loops cleanly
    cyc = max(1, round(spd * length / FPS)) if loop else spd * length / FPS
    for f in range(length + 1):
        ph = 2 * math.pi * cyc * f / max(1, length)
        for n in capes:
            ch, i = n[5], int(n[6]) - 1
            off = {'L': 0.0, 'M': 0.35, 'R': 0.7}[ch]
            a = (lift - comp * (pitches[f] - rest_pitch)) if i == 0 else lift * 0.25
            a += amp * (0.4 + 0.3 * i) * math.sin(ph - i * 1.1 + off)
            if clip in ('fly_fast', 'fly_boost', 'tackle', 'fall'): a += amp * 0.4 * math.sin(2 * ph + off * 2 - i)
            twist = (amp * 0.15 * math.sin(ph * 0.5 + off + i)) if i > 0 else 0
            pb = ao.pose.bones[n]
            pb.rotation_quaternion = (to_local(n, q_rot(X, a)) @ to_local(n, q_rot(Y, twist))).normalized()
            pb.keyframe_insert('rotation_quaternion', frame=f, group=n)
        for k, n in enumerate(tails):
            pb = ao.pose.bones[n]; a = (5 + 4 * k) * math.sin(ph * 0.8 - k * 0.9)
            pb.rotation_quaternion = (to_local(n, q_rot(Z, a)) @ to_local(n, q_rot(X, 3 * math.sin(ph - k)))).normalized()
            pb.keyframe_insert('rotation_quaternion', frame=f, group=n)
for a in bpy.data.actions:
    if a.name in clips:
        for fc in a.fcurves:
            for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
# clean up: remove the source library
for o in [src] + srcmesh: bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    if a.name not in clips: bpy.data.actions.remove(a)
ao.animation_data.action = bpy.data.actions['idle']
for pb in ao.pose.bones: pb.rotation_quaternion = Quaternion(); pb.location = Vector()
bpy.ops.wm.save_as_mainfile(filepath=f'/workspace/hero-game-assets/rig/{name}_anim.blend')
print('CLIPS', {k: round(v / FPS, 2) for k, v in clips.items()})
