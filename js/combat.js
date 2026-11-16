import * as THREE from 'three';
import { whooshSound, roarSound, fireBlastSound } from './audio.js';
// Combat: player vs computer-controlled rival (Tiger <-> Centurion), player-only beams (Tiger roar blast / Centurion eye beam),
// tackle-grab that can smash the target into buildings, super punch with ragdoll, momentum-based damage,
// procedural ragdoll with building/ground collisions, KO + respawn, and the AI opponent.
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GRAV = 32, CHEST = 1.15;
const t1 = V(), t2 = V(), t3 = V(), t4 = V();
const clamp = THREE.MathUtils.clamp;
// lock-on: range to acquire, distance / KO time that breaks it
export const LOCK = { range: 520, lose: 800, loseT: 1.0, koT: 1.5 };
// punch dash: very fast lunge over a short distance, then the strike lands
// tackle homing (the lunge that turns into the choke grab): locked = strong steering, unlocked = aim-assist steering when the
// rival is roughly in front; both lead a moving target. Player catch radius is larger than the AI's (swept test, metres).
export const TACKLE = { assistCone: 0.5, assistRange: 220, lockTurn: 16, assistTurn: 7, assistMinDot: 0.15, lead: 0.6, catchR: 2.6, playerCatchR: 3.6 };
// choke grab (tackle connects): hold time, charged punch / spin throw / forward drive tuning
export const CHOKE = { hold: 5, chargeT: 1.0, spinT: 0.85, spinTurns: 1.5, throwSpeed: 220, driveStick: 0.6 };
// Centurion eye beam (player only): charge-up, sustained beam while RT is held, push + tumble scaled by beam time
export const EYE = { charge: 0.16, min: 0.35, max: 1.8, dps: 24, range: 300, hitR: 1.6, snap: 0.9 };
// Tiger roar blast (player only): same push / damage / ragdoll as the eye beam, but a wide cone of fire from the mouth.
// The cone radius at distance d is r0 + spread*d; anything whose body overlaps it is hit.
export const ROAR = { charge: 0.24, min: 0.4, max: 1.8, dps: 24, range: 140, r0: 0.3, spread: 0.13, body: 0.7, snap: 0.86 };
// grab counter (player only, Y while held in the rival's choke grab): Centurion double-foot kick / Tiger arm-grab overhead slam
export const COUNTER = { invuln: 0.9,
  kick: { dur: 0.9, hitAt: 0.25, flipAt: 0.32, flipDur: 0.55, dmg: 38, speed: 230, up: 0.22, push: 22 },
  slam: { dur: 0.95, gripT: 0.12, liftT: 0.33, slamAt: 0.42, dmg: 24, down: 150, fwd: 8, radius: 1.25 } };
// X punch = lock-on lunge "Superman punch": dash at the rival (nearest in front within assist range/cone even without lock-on;
// locked on = range up to max and perfect homing, unlocked = softer steering), lead a moving target, end in a heavy punch.
// Range is capped (no teleport): a target beyond max gets a max-length lunge toward it. Lunges over superMin m use the
// stretched Superman pose and the heavy impact.
export const DASH = { speed: 230, max: 90, free: 14, stop: 1.8, maxT: 0.6, assist: 75, cone: 0.55, lead: 0.5, softTurn: 11, superMin: 7,
  impact: { kb: 120, kbSpeed: 0.55, up: 0.32, spin: 14, dmgBonus: 10 } };

// screen-facing lock-on reticle: spinning outer brackets + inward chevrons, drawn on top of everything
function makeReticle() {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.45, 0.25), transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const g = new THREE.Group(), spin = new THREE.Group(), chev = new THREE.Group();
  for (let i = 0; i < 4; i++) spin.add(new THREE.Mesh(new THREE.RingGeometry(0.88, 1.0, 24, 1, i * Math.PI / 2 + 0.22, Math.PI / 2 - 0.44), mat));
  const tri = new THREE.Shape(); tri.moveTo(0, 0.55); tri.lineTo(-0.16, 0.8); tri.lineTo(0.16, 0.8); tri.closePath();
  const tg = new THREE.ShapeGeometry(tri);
  for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(tg, mat); m.rotation.z = i * Math.PI / 2; chev.add(m); }
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), mat);
  g.add(spin, chev, dot); g.userData = { spin, chev, mat };
  g.traverse(o => { o.renderOrder = 999; o.frustumCulled = false; });
  g.visible = false; return g;
}

// cooldowns (s) / durations
const MOVES = {
  blast: { dur: 0.55, cd: 0.7, fireAt: 0.14 },
  punch: { dur: 0.5, cd: 0.9, hitAt: 0.16 },
  tackle: { dur: 1.1, cd: 2.2 },
};

class AIBrain {
  constructor() { this.t = 0; this.strafe = 1; this.strafeT = 0; this.think = 0; this.mode = 'approach'; this.wantFly = false; this.flyHold = 0; }
}

const ROAR_VS = `uniform float r0, r1, len, t; varying float vz; varying vec3 vP; varying vec3 vN; varying vec3 vV;
void main() {
  vec3 p = position; float z = p.z, a = atan(p.y, p.x);
  float r = mix(r0, r1, pow(z, 0.8)) * (1.0 + 0.13 * sin(z * len * 0.3 - t * 17.0 + a * 3.0) + 0.07 * sin(z * len * 0.7 - t * 29.0 - a * 5.0));
  vN = normalize(mat3(modelMatrix) * vec3(p.xy, 0.0));
  p.xy *= r; p.z = z * len; vz = z; vP = vec3(cos(a), sin(a), z * len);
  vec4 wp = modelMatrix * vec4(p, 1.0); vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ROAR_FS = `uniform float t, op, hot; varying float vz; varying vec3 vP; varying vec3 vN; varying vec3 vV;
float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * n3(p); p *= 2.07; a *= 0.5; } return v; }
void main() {
  vec3 q = vec3(vP.xy * 1.6, vP.z * 0.22 - t * 11.0);
  float n = fbm(q + vec3(0.0, 0.0, fbm(q * 0.7 + t) * 1.5));
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float fade = smoothstep(1.0, 0.72, vz) * smoothstep(0.0, 0.03, vz);
  float f = clamp(n * 1.9 - 0.45 + hot * 0.35, 0.0, 1.0);
  vec3 col = mix(vec3(1.2, 0.12, 0.01), vec3(2.8, 0.9, 0.12), f);
  col = mix(col, vec3(3.6, 2.4, 0.9), smoothstep(0.7, 1.0, f) * (0.3 + 0.7 * hot));
  float a = f * mix(0.3, 1.0, pow(facing, 1.1)) * fade * op * (hot > 0.5 ? 0.85 : 0.7);
  gl_FragColor = vec4(col, a);
}`;

export class Combat {
  constructor(scene, fx, city, cam, hud) {
    this.scene = scene; this.fx = fx; this.city = city; this.cam = cam; this.hud = hud;
    this.projectiles = []; this.t = 0; this.lastCombat = -99; this.ai = new AIBrain();
    this.aiCam = { forward: V(0, 0, 1), flatForward: V(0, 0, 1), right: V(-1, 0, 0), yawFacing: 0 };
    this.stats = { hits: [] }; // for automated tests
    // light-ray beam: additive HDR core + soft glow cylinder (bloom picks up the >1 colour)
    const g = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true); g.translate(0, 0.5, 0); g.rotateX(Math.PI / 2);
    this.beamCore = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8, 5.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true }));
    this.beamGlow = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 0.45), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.beamCore.visible = this.beamGlow.visible = false; this.beamCore.frustumCulled = this.beamGlow.frustumCulled = false;
    scene.add(this.beamCore, this.beamGlow); this.beam = null;
    // twin eye beams: HDR core + soft glow per eye (bloom picks them up)
    const coreM = new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 9.5, 7.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.5, 0.8), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.eyeMeshes = [0, 1].map(() => { const c = new THREE.Mesh(g, coreM), w = new THREE.Mesh(g, glowM); for (const m of [c, w]) { m.visible = false; m.frustumCulled = false; m.renderOrder = 6; scene.add(m); } return { c, w }; });
    this.eyeGlowM = glowM; this.eyeBeam = null; this._eyes = [V(), V()];
    // roar blast cone: two additive shader cones (outer roiling fire + hot inner core), radius flares with distance
    const cg = new THREE.CylinderGeometry(1, 1, 1, 40, 32, true); cg.translate(0, 0.5, 0); cg.rotateX(Math.PI / 2);
    const mkCone = hot => new THREE.Mesh(cg, new THREE.ShaderMaterial({
      uniforms: { t: { value: 0 }, r0: { value: 0.3 }, r1: { value: 5 }, len: { value: 30 }, op: { value: 1 }, hot: { value: hot } },
      vertexShader: ROAR_VS, fragmentShader: ROAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.roarCones = [mkCone(0), mkCone(1)]; for (const m of this.roarCones) { m.visible = false; m.frustumCulled = false; m.renderOrder = 6; scene.add(m); }
    this.cFire0 = new THREE.Color(6, 3.4, 0.9); this.cFire1 = new THREE.Color(3, 0.35, 0.04);
    this.cGold0 = new THREE.Color(7, 6, 3.5); this.cGold1 = new THREE.Color(2.5, 1.6, 0.4);
    this.lockOn = false; this.lockLostT = 0; this.lockPop = 0; this.reticle = makeReticle(); scene.add(this.reticle);
  }

  // ---------- lock-on ----------
  setLock(v) { this.lockOn = v; this.lockLostT = 0; this.lockPop = v ? 1 : 0; }
  updateLock(dt, P, E, inp) {
    if (inp && inp.lockPressed) {
      if (this.lockOn) { this.setLock(false); this.hud?.say('Lock off'); }
      else if (!E.ko && P.pos.distanceTo(E.pos) < LOCK.range) { this.setLock(true); this.hud?.say(`Locked on: ${E.def.name}`); }
      else this.hud?.say('No target in range');
    }
    if (this.lockOn) {
      const far = P.pos.distanceTo(E.pos) > LOCK.lose;
      if (far || E.ko) this.lockLostT += dt; else this.lockLostT = 0;
      if (this.lockLostT > (E.ko ? LOCK.koT : LOCK.loseT)) { this.setLock(false); this.hud?.say(E.ko ? 'Target down – lock off' : 'Target out of range – lock off'); }
    }
    this.updateReticle(dt, E);
  }
  updateReticle(dt, E) {
    const r = this.reticle, cam = this.cam.cam;
    r.visible = this.lockOn && E.visibleFlag !== false;
    if (!r.visible) return;
    this.lockPop = Math.max(0, this.lockPop - dt * 4);
    this.chest(E, r.position); r.quaternion.copy(cam.quaternion);
    const d = r.position.distanceTo(cam.position);
    const k = d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * 0.12 * (1 + 1.6 * this.lockPop * this.lockPop);
    r.scale.setScalar(Math.max(k, 0.9));
    const u = r.userData; u.spin.rotation.z += dt * 1.6; u.chev.scale.setScalar(1 + 0.08 * Math.sin(this.t * 7));
    u.mat.opacity = (this.lockLostT > 0 ? 0.45 + 0.4 * Math.abs(Math.sin(this.t * 12)) : 0.95);
  }
  lockTarget(E) { return this.lockOn && !E.ko ? E : null; }

  // ---------- helpers ----------
  chest(h, out) { return out.copy(h.pos).setY(h.pos.y + CHEST * h.def.height / 1.83); }
  handPos(h, out) { const f = h.fists?.[0]; if (f) { h.rig.root.updateMatrixWorld(true); return f.getWorldPosition(out); } return this.chest(h, out).addScaledVector(h.aim, 0.8); }
  canAct(h) { return !h.ragdoll && !h.grabbedBy && !h.ko && !h.action; }
  // aim assist: snap to the opponent if roughly in front, else use the given direction
  aimAt(h, target, fallback, cone = 0.72, range = 220) {
    const to = this.chest(target, t1).sub(this.chest(h, t2)); const d = to.length();
    if (target.ko || d > range) return fallback.clone().normalize();
    to.divideScalar(d);
    return to.dot(fallback) > cone || d < 5 ? to.clone() : fallback.clone().normalize();
  }
  // target: hero to track during the move (lock-on / aim assist), or null
  start(h, type, aim, target = null) {
    if (!this.canAct(h) || h.cd[type] > 0) return false;
    if (type === 'blast' && this.player && h !== this.player) return false; // eye beam / roar blast are player-only (the AI has no ranged blast)
    h.aim.copy(aim).normalize(); h.action = { type, t: 0, dur: MOVES[type].dur, done: false, target };
    h.cd[type] = MOVES[type].cd;
    if (type === 'blast' && (h.def.style === 'clean' || h.def.style === 'fire')) { Object.assign(h.action, { beam: true, dur: 99, onT: 0, hitT: 0, dmgAcc: 0 }); h.cd.blast = 0; }
    if (type === 'tackle') { h.action.carryDir = h.aim.clone(); h.action.carrySpeed = h.def.tackleSpeed * 1.25;
      h.vel.copy(h.aim).multiplyScalar(Math.max(h.vel.dot(h.aim), h.def.tackleSpeed * 0.6)); // explosive launch
      if (h.def.style === 'fire') h.fireBurst(h.pos, 70, 20); else this.fx.shockwave(h.pos.clone().setY(Math.max(h.pos.y, 0)), 0xe8e2d0, 18); this.shakeNear(h.pos, 0.25); }
    if (type === 'punch') this.startDash(h, target);
    return true;
  }
  // punch lunge: dash at very high speed toward the target (stop just short of it) or a short way forward
  startDash(h, target) {
    let dist = DASH.free;
    if (target) { const to = this.chest(target, t1).sub(this.chest(h, t2)); const d = to.length(); h.aim.copy(to.divideScalar(d || 1)); dist = clamp(d - DASH.stop, 0, DASH.max); }
    else if (h.state === 'ground') { h.aim.y = 0; if (h.aim.lengthSq() < 1e-4) h.aim.set(Math.sin(h.yaw), 0, Math.cos(h.yaw)); h.aim.normalize(); }
    if (dist < 0.8) { h.vel.addScaledVector(h.aim, 10); return; } // already in reach: plain punch
    const act = h.action;
    act.dash = { left: dist, t: 0, speed: DASH.speed, cap: DASH.speed, used: 0, trav: 0, skip: true, pre: Math.max(0, h.vel.dot(h.aim)) }; act.dashed = true; act.dashPre = act.dash.pre;
    act.lunge = !!target && dist > DASH.superMin; // Superman pose + heavy impact
    const fire = h.def.style === 'fire', c = this.chest(h, V());
    this.fx.shockwaveOriented?.(c.clone().addScaledVector(h.aim, -0.5), h.aim, fire ? 0xff8a30 : 0xe8f0ff, 7, 0.35, 0.7);
    this.burst(c.clone().addScaledVector(h.aim, 1.2), h, 10, 6);
    if (h.isPlayer) { h.fovKick = (h.fovKick || 0) + 9; this.cam.shake(0.18); }
    whooshSound(fire);
  }
  // per frame while dashing: re-aim at the target, trail effect, end on arrival / distance / wall
  dashStep(dt, a, act) {
    const ds = act.dash; ds.t += dt;
    const tgt = act.target && !act.target.ko ? act.target : null;
    if (ds.skip) ds.skip = false; else { const st = a.vel.length() * dt; ds.left -= st; ds.trav += st; } // (the start frame hasn't moved yet)
    if (tgt) { // home in, leading a moving target; the last step is capped so we arrive exactly at striking distance
      const to = this.chest(tgt, t1).sub(this.chest(a, t2)); const d = to.length();
      to.addScaledVector(tgt.vel, clamp(d / DASH.speed, 0, 0.4) * DASH.lead);
      const dl = to.length(); if (dl > 1e-3) { to.divideScalar(dl); if (act.soft) a.aim.lerp(to, Math.min(1, dt * DASH.softTurn)).normalize(); else a.aim.copy(to); }
      if (d < DASH.stop + 0.3) ds.left = 0; else { ds.cap = (d - DASH.stop) / dt; ds.left = Math.min(DASH.max - ds.trav, d - DASH.stop); } // range budget (no teleport)
    } else ds.cap = Math.max(0, ds.left) / dt;
    const fire = a.def.style === 'fire', P = fire ? this.fx.fire : this.fx.spark, c0 = fire ? this.cFire0 : this.cGold0, c1 = fire ? this.cFire1 : this.cGold1;
    const c = this.chest(a, t3);
    for (let i = 0; i < 6; i++) P.emit(t4.copy(c).addScaledVector(a.aim, -0.3 - 0.7 * Math.random()).add(t2.set((Math.random() - .5) * 0.6, (Math.random() - .5) * 0.9, (Math.random() - .5) * 0.6)), t1.copy(a.aim).multiplyScalar(-4 - Math.random() * 6), 0.1 + Math.random() * 0.12, c0, c1);
    const blocked = ds.used > 10 && a.vel.length() < ds.used * 0.4; // hit a wall / the ground
    if (ds.left <= 0 || ds.t > DASH.maxT || blocked) this.endDash(a, act);
  }
  endDash(a, act) {
    if (!act.dash) return; act.dash = null;
    const keep = a.state === 'ground' ? 8 : 18; const v = a.vel.length(); if (v > keep) a.vel.multiplyScalar(keep / v);
  }

  damage(target, amount, attacker, kind, extra = {}) {
    if (target.ko) return 0;
    if (target.invulnT > 0) { this.stats.hits.push({ t: this.t, kind: 'blocked', amount: 0, target: target.key, attacker: attacker?.key, by: kind }); return 0; }
    amount = Math.round(clamp(amount, 1, 60));
    target.hp = Math.max(0, target.hp - amount); target.lastHitT = this.t; this.lastCombat = this.t;
    this.stats.hits.push({ t: this.t, kind, amount, target: target.key, attacker: attacker?.key, ...extra });
    if (target.hp <= 0) this.knockOut(target);
    return amount;
  }
  knockback(target, dir, speed, up = 0.25, ragdoll = false, spin = 6) {
    if (target.grabbedBy) this.releaseGrab(target.grabbedBy);
    target.action = null;
    const v = t1.copy(dir).setY(dir.y + up).normalize().multiplyScalar(speed / target.def.mass);
    target.vel.copy(v);
    if (ragdoll || target.ko) this.startRagdoll(target, spin);
    else { target.knockT = 0.45; if (target.state === 'ground') { target.state = 'air'; target.vel.y = Math.max(target.vel.y, 7); target.pos.y += 0.1; } }
  }
  startRagdoll(h, spin = 6) {
    h.action = null; h.knockT = 0; h.charge = 0;
    if (h.grabbing) this.releaseGrab(h);
    const q = h.ragdoll ? h.ragdoll.q : new THREE.Quaternion().setFromEuler(h.rig.body.rotation);
    // spin mostly about the axis perpendicular to travel (tumble head over heels)
    const lv = t2.copy(h.vel).applyAxisAngle(V(0, 1, 0), -h.yaw); // velocity in root space
    const axis = V(lv.z, 0, -lv.x); if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0); axis.normalize();
    axis.x += (Math.random() - 0.5) * 0.6; axis.y += (Math.random() - 0.5) * 0.8; axis.normalize();
    // tumble rate follows the hit: harder hits spin you end over end faster
    const sp = Math.min(16, Math.max(spin, h.vel.length() * 0.12));
    h.ragdoll = { q, av: axis.multiplyScalar(sp + Math.random() * 3), t: 0, rest: 0, getUp: 0, flail: 1, bounces: 0, floor: 0 };
    h.state = 'air';
    if (h.pos.y < 0.05) h.pos.y = 0.05;
  }
  knockOut(h) {
    h.ko = true; h.koT = 0;
    if (!h.ragdoll) { h.vel.y = Math.max(h.vel.y, 8); this.startRagdoll(h, 7); }
    this.hud?.say(`${h.def.name} is down!`);
  }

  // ---------- grab / building smash ----------
  releaseGrab(att) { const v = att.grabbing; if (v) v.grabbedBy = null; att.grabbing = null; if (att.action?.type === 'tackle') att.action.t = att.action.dur; }
  smash(att, victim, normal, hitPoint, speed) {
    const dmg = this.damage(victim, 6 + 0.36 * speed, att, 'building', { speed });
    this.fx.crash(hitPoint.clone().setY(Math.max(0.5, hitPoint.y - 0.6)), normal, speed, 'wall');
    const pw = clamp(speed / 100, 0.4, 3);
    this.fx.impact(hitPoint, normal, pw, false);
    if (pw > 1.3) { this.fx.impact(hitPoint.clone().add(t4.set(0, 2.5, 0)), normal, pw * 0.6, false); this.fx.dustBurst(hitPoint.clone().setY(Math.max(0, hitPoint.y - 2)), 60 + speed * 0.3, 20 + speed * 0.1); }
    this.fx.shockwave(hitPoint.clone().setY(Math.max(0, hitPoint.y - 1)), 0xd8d0c0, Math.min(80, 8 + speed * 0.22));
    this.fx.shockwaveOriented?.(hitPoint.clone().addScaledVector(normal, 0.3), normal, 0xfff0d8, Math.min(60, 6 + speed * 0.15), 0.6, 0.7);
    this.shakeNear(hitPoint, 0.35 + speed / 110);
    this.releaseGrab(att);
    // rebound off the wall carries real momentum now (bounces down the street / into the next block)
    victim.vel.copy(normal).multiplyScalar(8 + speed * 0.2); victim.vel.y = 5 + speed * 0.04;
    this.startRagdoll(victim, 12);
    att.vel.copy(normal).multiplyScalar(14); att.vel.y = 6; att.action = null; att.knockT = 0.25;
    return dmg;
  }
  shakeNear(p, a) { const d = p.distanceTo(this.cam.cam.position); this.cam.shake(a * clamp(1.3 - d / 120, 0, 1)); }

  // wall test: push a probe out of building boxes and report the face normal
  wallHit(pos, r) {
    const p = t3.copy(pos), v = t4.set(0, 0, 0); this.city.collide(p, v, r);
    const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
    if (d < 1e-3) return null;
    return { normal: V(dx / d, 0, dz / d), point: V(p.x - dx / d * r, pos.y, p.z - dz / d * r) };
  }

  // ---------- per-frame ----------
  update(dt, player, enemy, inp, camFwd) {
    this.t += dt;
    player.isPlayer = true; enemy.isPlayer = false; this.player = player; this.pInp = inp; this.camFwd = camFwd;
    // recovery backflip: double-tap jump while tumbling (player only, never the AI)
    if (inp && inp.jumpPressed && player.ragdoll && !player.ko && !player.grabbedBy) {
      const rd = player.ragdoll;
      if (rd.getUp <= 0 && player.cd.recover <= 0 && this.t - (rd.lastTap ?? -9) < 0.3) this.recover(player);
      else rd.lastTap = this.t;
    }
    for (const h of [player, enemy]) {
      for (const k in h.cd) h.cd[k] = Math.max(0, h.cd[k] - dt);
      if (h.invulnT > 0) h.invulnT = Math.max(0, h.invulnT - dt);
      // the punch wind-up holds while the dash is still closing the gap, so the fist lands on arrival
      if (h.action) { if (!(h.action.dash && h.action.t >= 0.08)) h.action.t += dt; }
    }
    // grab counter: Y while the rival holds you (player only: the AI never counters)
    if (inp && inp.switchPressed && this.canCounter(player)) this.counter(player, player.grabbedBy);
    // player commands (locked on: always aim at / track the enemy)
    if (inp && !player.ko) {
      const fwd = camFwd.clone(), lock = this.lockTarget(enemy);
      const toE = () => this.chest(enemy, V()).sub(this.chest(player, V())).normalize();
      if (inp.blastPressed) this.start(player, 'blast', lock ? toE() : this.aimAt(player, enemy, fwd, 0.8));
      else if (inp.punchPressed) {
        if (lock) this.start(player, 'punch', toE(), enemy);
        else { // aim assist: lunge at the rival if roughly in front and in range, with softer steering than lock-on
          const a = this.aimAt(player, enemy, fwd, DASH.cone, DASH.assist); const assist = !enemy.ko && (a.dot(fwd) < 0.9999 || this.chest(enemy, V()).distanceTo(this.chest(player, V())) < 5);
          if (this.start(player, 'punch', a, assist ? enemy : null) && assist) player.action.soft = true; }
      }
      else if (inp.tacklePressed) {
        if (lock) this.start(player, 'tackle', toE(), enemy);
        else { // aim assist: if the rival is roughly in front, snap to them and keep (softer) homing on during the lunge
          const a = this.aimAt(player, enemy, fwd, TACKLE.assistCone, TACKLE.assistRange), assist = !enemy.ko && a.dot(fwd.clone().normalize()) < 0.9999;
          if (this.start(player, 'tackle', a, assist ? enemy : null) && assist) player.action.soft = true;
        }
      }
    }
    for (const [a, b] of [[player, enemy], [enemy, player]]) this.actionStep(dt, a, b);
    this.updateProjectiles(dt, [player, enemy]);
    this.updateBeam(dt); this.updateEyeBeam(dt);
    for (const h of [player, enemy]) {
      if (h.ragdoll) this.ragdollStep(dt, h);
      if (h.grabbedBy) this.carryStep(h.grabbedBy, h);
      if (h.slammedBy) this.slamCarry(h.slammedBy, h);
    }
  }
  actionStep(dt, a, b) {
    const act = a.action; if (!act) return;
    if (act.type === 'counter') { this.counterStep(dt, a, b, act); return; }
    const m = MOVES[act.type];
    if (act.type === 'blast' && act.beam) { this.eyeBeamStep(dt, a, b, act); return; }
    if (act.type === 'blast' && !act.done && act.t >= m.fireAt) { act.done = true; this.fireBlast(a, b); }
    if (act.dash) this.dashStep(dt, a, act);
    if (act.type === 'punch' && !act.done && act.t >= (a.vel.length() > 20 || act.dashed ? 0.05 : m.hitAt)) { // active strike window: a fast flyer can't pass through the target
      if (!act.swung) { act.swung = true; this.burst(this.handPos(a, V()), a, 14, 6); }
      if (this.tryPunch(a, b)) { act.done = true; this.endDash(a, act); if (act.dash === null) a.vel.multiplyScalar(0.3); }
      else if (act.t > 0.34) act.done = true;
    }
    if (act.type === 'tackle' && act.mode && act.mode !== 'drive') {
      if (a.grabbing) this.chokeStep(dt, a, a.grabbing); else if (act.mode === 'punch' && act.strikeT !== undefined) act.strikeT += dt;
      if (act.t >= act.dur && !a.grabbing) a.action = null;
      return;
    }
    if (act.type === 'tackle') {
      // homing: steer the drive toward a locked target in 3D
      if (!a.grabbing && act.target && !act.target.ko && !act.target.grabbedBy) {
        // lead the target: aim where it will be when we arrive (capped), so a moving / strafing rival can still be caught
        const tc = this.chest(act.target, t1), ac = this.chest(a, t2), dist = tc.distanceTo(ac);
        const tti = Math.min(TACKLE.lead, dist / Math.max(a.def.tackleSpeed, a.vel.length(), 1));
        const to = tc.addScaledVector(act.target.vel, tti).sub(ac).normalize();
        if (!act.soft || to.dot(a.aim) > TACKLE.assistMinDot) { a.aim.lerp(to, 1 - Math.exp(-dt * (act.soft ? TACKLE.assistTurn : TACKLE.lockTurn))).normalize(); act.homing = true; }
      }
      if (!a.grabbing && !b.ko && !b.ragdoll) {
        // swept test (at 250+ m/s the attacker moves several metres per frame)
        const cb = this.chest(b, t2), c1 = this.chest(a, t1), rel = t3.copy(a.vel).sub(b.vel).multiplyScalar(dt), L = rel.length();
        const c0 = t4.copy(c1).sub(rel); let d;
        if (L > 1e-4) { const s = clamp(t1.copy(cb).sub(c0).dot(rel) / (L * L), 0, 1); d = c0.addScaledVector(rel, s).distanceTo(cb); } else d = c1.distanceTo(cb);
        if (d < (a === this.player ? TACKLE.playerCatchR : TACKLE.catchR)) this.grab(a, b);
      }
      if (a.grabbing) {
        act.grabT = (act.grabT || 0) + dt;
        // attacker hit a wall first (lost most of its speed)
        if (act.grabT > 0.12 && a.vel.length() < act.carrySpeed * 0.35) {
          const victim = a.grabbing; const w = this.wallHit(victim.pos.clone().addScaledVector(act.carryDir, 1.2), 0.6);
          const n = w ? w.normal : act.carryDir.clone().negate().setY(0).normalize();
          this.smash(a, victim, n, w ? w.point.setY(victim.pos.y + 1) : this.chest(victim, V()), act.carrySpeed);
          return;
        }
        if (act.grabT > 1.2) { // no building in the way: hurl them forward
          const v = a.grabbing; this.releaseGrab(a);
          this.damage(v, 3 + 0.06 * act.carrySpeed, a, 'throw', { speed: act.carrySpeed });
          v.vel.copy(act.carryDir).multiplyScalar(act.carrySpeed * 0.9); v.vel.y += 6; this.startRagdoll(v, 10);
          this.fx.shockwaveOriented?.(this.chest(v, V()), act.carryDir, a.def.style === 'fire' ? 0xff8a30 : 0xe8e2d0, 14, 0.5, 0.6);
          a.action = null; return;
        }
      }
    }
    if (act.t >= act.dur && !a.grabbing) a.action = null;
  }
  grab(a, b) {
    if (b.invulnT > 0 || b.slammedBy) return;
    const rel = t1.copy(a.vel).sub(b.vel).length();
    a.grabbing = b; b.grabbedBy = a; b.action = null; b.knockT = 0; b.state = 'air';
    const act = a.action; act.grabT = 0; act.carryDir = a.aim.clone(); if (act.carryDir.y < -0.3) act.carryDir.y = -0.3; act.carryDir.normalize();
    act.carrySpeed = Math.max(a.def.tackleSpeed * 1.25, a.vel.length() * 1.15);
    this.damage(b, 4 + 0.1 * rel, a, 'tackle', { speed: rel });
    // the tackle ends in a one-handed choke hold: the attacker brakes hard and hangs the victim at arm's length
    if (b.ko) { this.releaseGrab(a); return; }
    act.mode = 'hold'; act.holdT = 0; b.endSuper?.(); a.endSuper?.(); b.ragdoll = null;
    a.vel.multiplyScalar(0.25);
    if (a !== this.player) { const B = this.ai; B.chokeT = 1 + Math.random() * 2; B.chokeOpt = ['punch', 'spin', 'drive'][Math.floor(Math.random() * 3)]; B.chokeCharge = 0.45 + Math.random() * 0.55; }
    this.shakeNear(a.pos, 0.3 + rel / 400); this.fx.flash(this.chest(b, t2), a.def.style === 'fire' ? 0xff7020 : 0xfff0c0, 30, 0.2);
    this.burst(this.chest(b, V()), a, 30, 10);
  }
  carryStep(att, victim) {
    const act = att.action; if (!act) { this.releaseGrab(att); return; }
    if (act.mode && act.mode !== 'drive') { this.holdStep(att, victim); return; }
    const dir = act.carryDir;
    const target = this.chest(att, t1).addScaledVector(dir, 1.7).setY(att.pos.y + 0.1);
    for (let s = 0.4; s <= 1.7; s += 0.3) { // march from the attacker: stop the victim at the first building face
      const q = t3.copy(att.pos).addScaledVector(dir, s); q.y = att.pos.y + 0.9;
      if (this.city.heightAt(q.x, q.z) > q.y) { target.copy(att.pos).addScaledVector(dir, Math.max(0.3, s - 0.4)).setY(att.pos.y + 0.1); break; }
    }
    victim.pos.copy(target); victim.vel.copy(att.vel); victim.yaw = att.yaw + Math.PI; victim.state = 'air';
    // victim's front edge meets a building -> smash
    const w = this.wallHit(victim.pos.clone().setY(victim.pos.y + 0.8), 0.7);
    if (w && w.normal.dot(dir) < -0.2) {
      const into = -att.vel.dot(w.normal);
      victim.pos.addScaledVector(w.normal, 0.05);
      this.smash(att, victim, w.normal, w.point.setY(victim.pos.y + 1.2), Math.max(into, act.carrySpeed * 0.75));
    }
  }
  // victim hangs from the attacker's gripping fist by the neck
  holdStep(att, victim) {
    const fist = this.handPos(att, t1);
    const F = t2.set(Math.sin(att.yaw), 0, Math.cos(att.yaw));
    let neck = null;
    const nb = victim.anim?.B?.('neck');
    if (nb && victim.rig.root.visible !== undefined) { victim.rig.root.updateMatrixWorld(true); neck = nb.getWorldPosition(t3).sub(victim.pos); if (neck.y < 0.5 || neck.length() > 3) neck = null; }
    if (!neck) neck = t3.set(0, 1.5 * victim.def.height / 1.83, 0);
    victim.pos.copy(fist).sub(neck).addScaledVector(F, 0.16);
    victim.vel.copy(att.vel); victim.yaw = att.yaw + Math.PI; victim.state = 'air'; victim.knockT = 0;
  }
  // ---- choke hold options (player: X charged punch / B spin throw / LS forward drive; AI picks after 1-3 s) ----
  chokeStep(dt, a, b) {
    const act = a.action, isP = a === this.player, inp = isP ? this.pInp : null, B = this.ai;
    act.holdT += dt;
    const F = V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    if (act.mode === 'hold') {
      let pick = null;
      if (isP && inp) { if (inp.punchPressed) pick = 'punch'; else if (inp.cancelPressed) pick = 'spin'; else if (inp.moveY > CHOKE.driveStick) pick = 'drive'; }
      else if (!isP && act.holdT > B.chokeT) pick = B.chokeOpt;
      if (pick === 'punch') { act.mode = 'punch'; act.charge = 0; }
      else if (pick === 'spin') { act.mode = 'spin'; act.spinT = 0; act.spinRate = 0; }
      else if (pick === 'drive') {
        // rocket forward carrying the victim: the existing carry / building-smash system takes over
        const dir = isP ? this.camFwd.clone() : this.aiDriveDir(a);
        if (dir.y < -0.3) dir.y = -0.3; dir.normalize();
        act.mode = 'drive'; act.carryDir = dir; a.aim.copy(dir); act.carrySpeed = a.def.tackleSpeed * 1.25; act.grabT = 0;
        a.vel.copy(dir).multiplyScalar(act.carrySpeed * 0.6);
        this.fx.shockwaveOriented?.(this.chest(a, V()).addScaledVector(dir, -0.6), dir, a.def.style === 'fire' ? 0xff8a30 : 0xe8e2d0, 14, 0.45, 0.7);
        if (a.def.style === 'fire') a.fireBurst(a.pos, 60, 16); else this.burst(this.chest(a, V()), a, 30, 10);
        whooshSound(a.def.style === 'fire'); this.shakeNear(a.pos, 0.3);
        return;
      }
      if (!pick && act.holdT >= CHOKE.hold) { this.breakFree(a, b); return; }
      return;
    }
    if (act.mode === 'punch') {
      const fire = a.def.style === 'fire';
      if (act.strikeT === undefined) {
        act.charge = Math.min(1, act.charge + dt / CHOKE.chargeT);
        const hand = this.fistL(a, t1);
        for (let i = 0; i < 4 + act.charge * 14; i++) (fire ? this.fx.fire : this.fx.spark).emit(hand, t4.set((Math.random() - .5) * 3, (fire ? 2 : 0) + (Math.random() - .5) * 3, (Math.random() - .5) * 3).multiplyScalar(0.5 + act.charge), 0.15 + Math.random() * 0.2, fire ? this.cFire0 : this.cGold0, fire ? this.cFire1 : this.cGold1);
        if (this.fx.lightT <= 0.05) { this.fx.light.position.copy(hand); this.fx.light.color.setHex(fire ? 0xff6a20 : 0xfff0c0); this.fx.light.intensity = 80 + 500 * act.charge; this.fx.lightT = 0.06; this.fx.lightDur = 0.06; }
        const release = isP ? (!inp || !inp.punch || act.charge >= 1) : act.charge >= B.chokeCharge;
        if (release) act.strikeT = 0;
        return;
      }
      act.strikeT += dt;
      if (!act.struck && act.strikeT >= 0.08) { // the fist lands: huge knockback into a ragdoll
        act.struck = true; const c = act.charge;
        const dir = (isP ? this.camFwd.clone().setY(Math.max(-0.2, this.camFwd.y)) : F.clone()).normalize(); dir.y += 0.15; dir.normalize();
        const hp = this.chest(b, V());
        this.releaseGrab(a); act.t = act.dur - 0.3; // keep the follow-through pose briefly
        this.damage(b, 12 + 33 * c, a, 'chargedPunch', { charge: +c.toFixed(2) });
        b.vel.copy(dir).multiplyScalar((80 + 180 * c) / b.def.mass); this.startRagdoll(b, 14);
        this.fx.shockwaveOriented?.(hp, dir, fire ? 0xff8a30 : 0xfff2c8, 18 + 45 * c, 0.6, 0.85);
        this.fx.shockwave(hp.clone().setY(Math.max(0, hp.y - 1)), fire ? 0xff7020 : 0xe8e2d0, 15 + 30 * c);
        this.fx.flash(hp, fire ? 0xff7020 : 0xfff0c0, 80 + 120 * c, 0.4);
        this.burst(hp, a, 80 + 120 * c, 20 + 20 * c); this.shakeNear(hp, 0.6 + 0.6 * c);
        if (fire) for (let i = 0; i < 80 * c; i++) this.fx.fire.emit(hp, t4.copy(dir).multiplyScalar(20 + Math.random() * 60).add(t1.set((Math.random() - .5) * 20, (Math.random() - .5) * 20, (Math.random() - .5) * 20)), 0.3 + Math.random() * 0.4, this.cFire0, this.cFire1);
        if (isP) a.fovKick = (a.fovKick || 0) + 6 + 10 * c;
      }
      return;
    }
    if (act.mode === 'spin') {
      act.spinT += dt; const u = act.spinT / CHOKE.spinT;
      const total = Math.PI * 2 * CHOKE.spinTurns; // angular speed ramps up then holds (integrated in Hero.update)
      act.spinRate = total / CHOKE.spinT * 1.6 * Math.min(1, u * 2.2);
      if (Math.random() < 0.6) this.burst(this.chest(b, V()), a, 3, 4);
      if (u >= 1) { // let go: hurl them along the camera / aim direction
        const dir = (isP ? this.camFwd.clone() : this.aiDriveDir(a)); if (dir.y < -0.25) dir.y = -0.25; dir.y += 0.06; dir.normalize();
        if (isP) a.yaw = Math.atan2(dir.x, dir.z);
        this.releaseGrab(a); act.t = act.dur - 0.2; act.spinRate = 0;
        this.damage(b, 8, a, 'spinThrow', { speed: CHOKE.throwSpeed });
        b.vel.copy(dir).multiplyScalar(CHOKE.throwSpeed / b.def.mass); this.startRagdoll(b, 12);
        const hp = this.chest(b, V());
        this.fx.shockwaveOriented?.(hp, dir, a.def.style === 'fire' ? 0xff8a30 : 0xe8e2d0, 22, 0.5, 0.75); this.burst(hp, a, 50, 14); this.shakeNear(hp, 0.45);
        whooshSound(a.def.style === 'fire');
      }
    }
  }
  // ---- grab counter (player only) ----
  canCounter(h) { const g = h.grabbedBy; return !!g && h === this.player && !h.ko && g.grabbing === h && h.action?.type !== 'counter'; }
  counter(v, att) {
    const style = v.def.style === 'fire' ? 'slam' : 'kick', C = COUNTER[style];
    const F = V(Math.sin(att.yaw), 0, Math.cos(att.yaw)); // attacker's forward = from the attacker toward the victim
    this.releaseGrab(att); att.action = null; att.knockT = 0; att.charge = 0;
    v.grabbedBy = null; v.ragdoll = null; v.knockT = 0; v.flip = null;
    v.yaw = Math.atan2(-F.x, -F.z); v.aim.copy(F).negate(); // face the grabber
    v.state = 'fly'; v.vel.copy(att.vel);
    v.action = { type: 'counter', style, clip: style === 'kick' ? 'counter_kick' : 'counter_slam', t: 0, dur: C.dur, done: false, target: att };
    v.invulnT = COUNTER.invuln;
    att.slammedBy = v; att.vel.set(0, 0, 0); att.state = 'air'; // the grabber is pinned (wrists caught / knees coming up) until the counter lands
    this.fx.flash(this.chest(v, V()), v.def.style === 'fire' ? 0xff7020 : 0xfff0c0, 40, 0.2); this.burst(this.chest(v, V()), v, 30, 8);
    this.hud?.say(style === 'kick' ? 'COUNTER! Double kick' : 'COUNTER! Slam');
    this.stats.hits.push({ t: this.t, kind: 'counter', amount: 0, target: att.key, attacker: v.key, style });
    whooshSound(v.def.style === 'fire');
  }
  counterStep(dt, a, b, act) {
    const C = COUNTER[act.style], tgt = act.target, fire = a.def.style === 'fire';
    const F = V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    if (act.style === 'kick') {
      if (!act.done && act.t >= C.hitAt) { // both heels drive into the grabber's chest
        act.done = true; tgt.slammedBy = null;
        const dir = F.clone(); dir.y += C.up; dir.normalize();
        const hp = this.chest(tgt, V()).addScaledVector(F, -0.3);
        this.damage(tgt, C.dmg, a, 'counterKick', { speed: C.speed });
        tgt.vel.copy(dir).multiplyScalar(C.speed / tgt.def.mass); this.startRagdoll(tgt, 13);
        this.fx.shockwaveOriented?.(hp, dir, 0xfff2c8, 34, 0.55, 0.85);
        this.fx.shockwave(hp.clone().setY(Math.max(0, hp.y - 1)), 0xe8e2d0, 26);
        this.fx.flash(hp, 0xfff0c0, 170, 0.4); this.fx.dustBurst?.(hp, 40, 18);
        this.burst(hp, a, 140, 28); this.shakeNear(hp, 0.9);
        a.vel.copy(F).multiplyScalar(-C.push); a.vel.y = 10; // recoil back off the kick
        if (a === this.player) a.fovKick = (a.fovKick || 0) + 12;
        whooshSound(false);
      }
      if (act.done && !act.flipped && act.t >= C.flipAt) { act.flipped = true; a.flip = { t: 0, dur: C.flipDur, q0: new THREE.Quaternion() }; }
    } else {
      if (!act.done && act.t >= C.slamAt && tgt.slammedBy === a) { // hurl them straight down into the ground in front
        act.done = true; tgt.slammedBy = null; tgt.slamPitch = 0;
        const hp = this.chest(tgt, V());
        this.damage(tgt, C.dmg, a, 'counterSlam', { speed: C.down });
        tgt.vel.copy(F).multiplyScalar(C.fwd); tgt.vel.y = -C.down / tgt.def.mass; this.startRagdoll(tgt, 9);
        tgt.ragdoll.slam = true;
        this.fx.shockwaveOriented?.(hp, V(0, -1, 0), 0xff8a30, 26, 0.5, 0.8); this.fx.flash(hp, 0xff7020, 120, 0.3);
        for (let i = 0; i < 70; i++) this.fx.fire.emit(hp, t4.set((Math.random() - .5) * 30, -20 - Math.random() * 50, (Math.random() - .5) * 30), 0.3 + Math.random() * 0.3, this.cFire0, this.cFire1);
        this.shakeNear(hp, 0.7); whooshSound(true);
        if (a === this.player) a.fovKick = (a.fovKick || 0) + 8;
      }
    }
    if (act.t >= act.dur) { if (tgt.slammedBy === a) { tgt.slammedBy = null; tgt.slamPitch = 0; } a.action = null; }
  }
  // Tiger's slam: the grabber is held by the wrists and swung from in front of Tiger up over his head
  slamCarry(a, v) {
    const act = a.action; if (!act || act.type !== 'counter') { v.slammedBy = null; return; }
    if (act.style === 'kick') { v.vel.set(0, 0, 0); v.state = 'air'; v.knockT = 0.2; v.action = null; v.yaw = a.yaw + Math.PI; return; } // stunned in place as the knees come up
    const C = COUNTER.slam, F = V(Math.sin(a.yaw), 0, Math.cos(a.yaw)), U = V(0, 1, 0);
    // arc angle: 0 = in front at chest height, ~1.6 = straight overhead; then whipped back down to the front (-0.55 = near the ground)
    const u = clamp((act.t - C.gripT) / (C.liftT - C.gripT), 0, 1), e = u * u * (3 - 2 * u);
    const w = clamp((act.t - C.liftT) / (C.slamAt - C.liftT), 0, 1), ew = w * w;
    const th = act.t < C.liftT ? e * 1.6 : 1.6 - ew * 2.15, R = C.radius * (1 + 0.35 * ew);
    const pivot = this.chest(a, t1).addScaledVector(U, 0.35);
    const chest = pivot.addScaledVector(F, Math.cos(th) * R * 1.15).addScaledVector(U, Math.sin(th) * R * 1.6);
    const fl = this.city.heightAt(chest.x, chest.z, 0.5); if (chest.y < fl + 0.5) chest.y = fl + 0.5;
    v.pos.copy(chest).addScaledVector(U, -CHEST * v.def.height / 1.83);
    v.vel.copy(a.vel); v.state = 'air'; v.knockT = 0.2; v.action = null; v.yaw = a.yaw + Math.PI;
    v.slamPitch = -(e * 1.6 + ew * 2.15) * 0.85; // tipped backwards over the top and driven down back-first
  }
  breakFree(a, b) {
    const F = V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    this.releaseGrab(a); a.action = null;
    b.vel.copy(F).multiplyScalar(12); b.vel.y = 4; b.state = 'air'; b.knockT = 0.6; a.knockT = 0.45; a.vel.addScaledVector(F, -6);
    this.fx.flash(this.chest(b, V()), 0xffffff, 25, 0.2); this.hud?.say(b === this.player ? 'You broke free!' : `${b.def.name} broke free!`);
    this.stats.hits.push({ t: this.t, kind: 'breakFree', amount: 0, target: b.key, attacker: a.key });
  }
  fistL(h, out) { const f = h.fists?.[1]; if (f) { h.rig.root.updateMatrixWorld(true); return f.getWorldPosition(out); } return this.chest(h, out); }
  // AI: drive / throw toward the nearest building face if there is one in reach, else straight ahead
  aiDriveDir(a) {
    let best = null;
    for (let k = 0; k < 12; k++) { const ang = a.yaw + k / 12 * Math.PI * 2, d = V(Math.sin(ang), 0, Math.cos(ang));
      for (let s = 6; s < 140; s += 3) { const p = t1.copy(a.pos).addScaledVector(d, s); if (this.city.heightAt(p.x, p.z) > a.pos.y + 1) { if (!best || s < best.s) best = { s, d }; break; } } }
    return best ? best.d : V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
  }
  // ---- recovery backflip (player only): double-tap A while tumbling ----
  recover(h) {
    const rd = h.ragdoll; if (!rd) return false;
    const q0 = rd.q.clone(); h.ragdoll = null; h.knockT = 0;
    h.vel.multiplyScalar(0.12); h.vel.y = Math.max(h.vel.y, 7);
    const fl = this.city.heightAt(h.pos.x, h.pos.z, 0.5); if (h.pos.y < fl + 0.6) h.pos.y = fl + 0.6;
    h.state = 'fly'; h.flip = { t: 0, dur: 0.55, q0 }; h.cd.recover = 1.4;
    const c = this.chest(h, V()), fire = h.def.style === 'fire';
    this.fx.shockwaveOriented?.(c, V(0, 1, 0), fire ? 0xff8a30 : 0xfff2d0, 9, 0.4, 0.75);
    this.fx.flash(c, fire ? 0xff7020 : 0xfff0c0, 45, 0.25);
    if (fire) h.fireBurst(h.pos, 70, 14); else this.burst(c, h, 40, 9);
    whooshSound(fire);
    this.stats.hits.push({ t: this.t, kind: 'recover', amount: 0, target: h.key });
    return true;
  }
  // HUD state for the grab timer / prompts
  grabState(player, enemy) {
    for (const [a, role] of [[player, 'attacker'], [enemy, 'victim']]) {
      const act = a.action; if (act?.type === 'tackle' && act.mode && act.mode !== 'drive' && a.grabbing) return { role, mode: act.mode, left: Math.max(0, CHOKE.hold - act.holdT), max: CHOKE.hold, charge: act.charge || 0 };
    }
    return null;
  }
  tryPunch(a, b) {
    const ca = this.chest(a, t1), cb = this.chest(b, t2), to = t3.copy(cb).sub(ca); const d = to.length();
    const reach = 3.2 + a.def.height * 0.3;
    if (b.ko || d > reach) return false;
    to.normalize(); if (to.dot(a.aim) < 0.25 && d > 2.2) return false;
    const rel = t4.copy(a.vel).sub(b.vel).dot(to);
    const act = a.action; // a dash punch: count ~30% of the dash plus the momentum you already had (not the full 170 m/s ram)
    const dbase = act?.dashed ? act.dashPre + DASH.speed * 0.3 : 0; // (lunge hits mid-dash would otherwise count the full 230 m/s)
    const sp = act?.dashed ? clamp(Math.max(rel, dbase - b.vel.dot(to)), 0, dbase + 20) : Math.max(0, rel);
    const L = act?.lunge ? DASH.impact : null, fire = a.def.style === 'fire';
    const dmg = this.damage(b, 9 + 0.24 * sp + (L ? L.dmgBonus : 0), a, 'punch', { speed: sp, lunge: !!L });
    const dir = to.clone(); dir.y = Math.max(dir.y, 0);
    if (L) this.knockback(b, dir, L.kb + L.kbSpeed * sp, L.up, true, L.spin); else this.knockback(b, dir, 48 + 0.5 * sp, 0.3, true, 10);
    const hp = cb.clone().addScaledVector(to, -0.4);
    if (L) { // Superman punch impact: oriented shock ring + ground ring, big flash, debris burst, shake, FOV punch
      this.fx.shockwaveOriented?.(hp, to, fire ? 0xff8a30 : 0xfff2c8, 26, 0.5, 0.9);
      if (hp.y < 4) this.fx.shockwave(hp.clone().setY(0.1), fire ? 0xff7020 : 0xe8e2d0, 22);
      this.fx.flash(hp, fire ? 0xff7020 : 0xfff0c0, 140, 0.35); this.burst(hp, a, 140, 26);
      if (fire) for (let i = 0; i < 60; i++) this.fx.fire.emit(hp, t4.copy(to).multiplyScalar(20 + Math.random() * 40).add(t1.set((Math.random() - .5) * 18, (Math.random() - .5) * 18, (Math.random() - .5) * 18)), 0.3 + Math.random() * 0.3, this.cFire0, this.cFire1);
      this.shakeNear(hp, 0.9); if (a.isPlayer) a.fovKick = (a.fovKick || 0) + 8;
    }
    this.fx.shockwave(hp, a.def.style === 'fire' ? 0xff8a30 : 0xfff2c8, 6);
    this.fx.flash(hp, a.def.style === 'fire' ? 0xff7020 : 0xfff0c0, 45, 0.25);
    this.burst(hp, a, 60, 16);
    this.shakeNear(hp, 0.55);
    return dmg;
  }
  burst(p, a, n, s) {
    const fire = a.def.style === 'fire', P = fire ? this.fx.fire : this.fx.spark, c0 = fire ? this.cFire0 : this.cGold0, c1 = fire ? this.cFire1 : this.cGold1;
    for (let i = 0; i < n; i++) P.emit(p, t4.set((Math.random() - .5) * s * 2, (Math.random() - .5) * s * 2, (Math.random() - .5) * s * 2), 0.25 + Math.random() * 0.35, c0, c1);
  }

  // ---------- player beam moves: Centurion eye beam / Tiger roar blast ----------
  beamOrigin(a, out) {
    if (a.mouth) return a.mouthPosition(out);
    const e = a.eyePositions?.(this._eyes);
    if (e) return out.copy(e[0]).add(e[1]).multiplyScalar(0.5);
    return this.chest(a, out).setY(a.pos.y + 1.62 * a.def.height / 1.83);
  }
  eyeMid(a, out) { return this.beamOrigin(a, out); }
  eyeBeamStep(dt, a, b, act) {
    const roar = a.def.style === 'fire', C = roar ? ROAR : EYE, kind = roar ? 'roar' : 'eyebeam';
    const isP = a === this.player, inp = isP ? this.pInp : null;
    if (roar && !act.sfx) act.sfx = roarSound() || { stop() {} };
    a.eyeGlow = Math.min(1, act.t / C.charge);
    const mid = this.beamOrigin(a, V());
    const lock = isP ? this.lockTarget(b) : null;
    let dir;
    if (lock) dir = this.chest(b, V()).sub(mid).normalize();
    else { const fwd = isP && this.camFwd ? this.camFwd : a.aim; const to = this.chest(b, V()).sub(mid); const d = to.length(); to.divideScalar(d || 1);
      dir = (!b.ko && d < 260 && (to.dot(fwd) > C.snap || d < 5)) ? to : fwd.clone().normalize(); }
    a.aim.lerp(dir, Math.min(1, dt * 14)).normalize(); dir = a.aim.clone();
    if (act.t < C.charge) { // wind-up
      a.beamTarget = mid.clone().addScaledVector(dir, 30); this.eyeBeam = { owner: a, on: false, roar, sfx: act.sfx };
      if (roar) { // embers gathering at the mouth
        for (let i = 0; i < 6; i++) { const p = t3.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(0.5 + Math.random() * 0.7).add(mid); this.fx.fire.emit(p, t4.subVectors(mid, p).multiplyScalar(5), 0.18, this.cFire0, this.cFire1); }
        if (this.fx.lightT <= 0.05) { this.fx.light.position.copy(mid); this.fx.light.color.setHex(0xff6a20); this.fx.light.intensity = 60 + 300 * a.eyeGlow; this.fx.lightT = 0.06; this.fx.lightDur = 0.06; }
      }
      return;
    }
    if (roar && !act.snapped) { act.snapped = true; for (let i = 0; i < 40; i++) this.fx.fire.emit(mid, t3.copy(dir).multiplyScalar(20 + Math.random() * 30).add(t4.set((Math.random() - .5) * 14, (Math.random() - .5) * 14, (Math.random() - .5) * 14)), 0.15 + Math.random() * 0.2, this.cFire0, this.cFire1); /* the snap: burst of flame at the mouth */ if (isP) this.shakeNear(mid, 0.2); }
    act.onT += dt;
    // march the beam centre line: first building / ground; the target is hit if it overlaps the beam (wide cone for the roar)
    let len = C.range, hit = null;
    for (let s = 0.5; s < C.range; s += 1.5) {
      const p = t4.copy(mid).addScaledVector(dir, s);
      if (p.y < 0) { len = s; hit = 'ground'; break; }
      if (this.city.heightAt(p.x, p.z) > p.y) { len = s; hit = 'wall'; break; }
    }
    const cb = this.chest(b, t2), tc = clamp(t1.copy(cb).sub(mid).dot(dir), 0, C.range);
    const hitR = roar ? C.r0 + C.spread * tc + C.body : C.hitR;
    if (!b.ko && tc < len && t3.copy(mid).addScaledVector(dir, tc).distanceTo(cb) < hitR) { len = tc; hit = 'enemy'; }
    const end = mid.clone().addScaledVector(dir, len), imp = hit === 'enemy' ? cb.clone() : end;
    a.beamTarget = end; this.eyeBeam = { owner: a, on: true, end, imp, dir, len, t: act.onT, hit, roar, sfx: act.sfx };
    if (a.state === 'fly') a.vel.addScaledVector(dir, -5 * dt); // recoil
    if (hit === 'enemy') {
      act.hitT += dt; const k = Math.min(1, act.hitT / 1.0), m = b.def.mass;
      if (act.hitT <= dt * 1.01) { this.fx.flash(imp, roar ? 0xff7020 : 0xfff0d0, 70, 0.3); this.burst(imp, a, 50, 14); this.fx.shockwaveOriented?.(imp, dir, roar ? 0xff8a30 : 0xfff2c8, 8, 0.35, 0.7); }
      act.dmgAcc += dt * C.dps; if (act.dmgAcc >= 3) { this.damage(b, act.dmgAcc, a, kind, { charge: +k.toFixed(2) }); act.dmgAcc = 0; }
      if (b.grabbedBy) { /* held by someone: no push */ }
      else if (!b.ragdoll) { if (b.grabbing) this.releaseGrab(b); // sustained push, then the victim is knocked into a tumble
        b.knockT = Math.max(b.knockT, 0.25); b.action = null;
        if (b.state === 'ground') { b.state = 'air'; b.pos.y += 0.1; b.vel.y = Math.max(b.vel.y, 5); }
        b.vel.lerp(t1.copy(dir).multiplyScalar((30 + 50 * k) / m), Math.min(1, dt * 5));
        if (act.hitT > 0.4) { b.vel.copy(dir).multiplyScalar((45 + 70 * k) / m); this.startRagdoll(b, 7 + 6 * k); }
      } else b.vel.addScaledVector(dir, 110 * dt / m); // keep driving the tumbling body
      if (roar) for (let i = 0; i < 14; i++) this.fx.fire.emit(t3.copy(imp).addScaledVector(dir, -0.6), t1.set((Math.random() - .5) * 24, (Math.random() - .2) * 18, (Math.random() - .5) * 24).addScaledVector(dir, -6), 0.25 + Math.random() * 0.3, this.cFire0, this.cFire1);
      else for (let i = 0; i < 8; i++) this.fx.spark.emit(imp, t1.set((Math.random() - .5) * 18, (Math.random() - .3) * 18, (Math.random() - .5) * 18), 0.2 + Math.random() * 0.25, this.cGold0, this.cGold1);
      if (isP) this.shakeNear(imp, 0.04);
    } else if (hit) { // scorching the wall / ground: sparks or fire splash, heat shimmer, scorch marks
      const n = hit === 'ground' ? V(0, 1, 0) : (this.wallHit(end.clone().addScaledVector(dir, 0.6), 0.1)?.normal || dir.clone().negate());
      if (roar) { // fire splashes out along the surface
        const sp = t4.copy(dir).addScaledVector(n, -dir.dot(n)); if (sp.lengthSq() < 1e-4) sp.set(1, 0, 0); sp.normalize();
        for (let i = 0; i < 20; i++) this.fx.fire.emit(t3.copy(end).addScaledVector(n, 0.4), t1.copy(n).multiplyScalar(3 + Math.random() * 8).addScaledVector(sp, 10 + Math.random() * 20).add(t2.set((Math.random() - .5) * 22, (Math.random() - .5) * 6, (Math.random() - .5) * 22)), 0.3 + Math.random() * 0.35, this.cFire0, this.cFire1);
      } else for (let i = 0; i < 6; i++) this.fx.spark.emit(end, t1.copy(n).multiplyScalar(4 + Math.random() * 12).add(t3.set((Math.random() - .5) * 12, Math.random() * 8, (Math.random() - .5) * 12)), 0.2 + Math.random() * 0.3, this.cGold0, this.cGold1);
      for (let i = 0; i < 2; i++) this.fx.dust.emit(t3.copy(end).addScaledVector(n, 0.4), t1.set((Math.random() - .5) * 1.5, 2 + Math.random() * 2.5, (Math.random() - .5) * 1.5), 0.6 + Math.random() * 0.5, this.cHeat0 || (this.cHeat0 = new THREE.Color(1.1, 1.05, 0.95)), this.cHeat1 || (this.cHeat1 = new THREE.Color(0.5, 0.48, 0.45)));
      if ((act.scorchT = (act.scorchT || 0) - dt) <= 0) { act.scorchT = 0.22; this.fx.impact(end, n, roar ? 0.55 : 0.3, true); }
    }
    if (this.fx.lightT <= 0.05) { this.fx.light.position.copy(roar ? mid.clone().lerp(end, 0.3) : end); this.fx.light.color.setHex(roar ? 0xff6a20 : 0xfff0c8); this.fx.light.intensity = roar ? 420 : 260; this.fx.lightT = 0.06; this.fx.lightDur = 0.06; }
    const release = (isP ? !(inp && inp.blast) : true) && act.onT >= C.min;
    if (release || act.onT >= C.max) this.endEyeBeam(a, b, act, dir, imp);
  }
  endEyeBeam(a, b, act, dir, end) {
    const roar = a.def.style === 'fire', kind = roar ? 'roar' : 'eyebeam';
    if (act.hitT > 0 && !b.ko && !b.grabbedBy) { // explosion on the victim: final shove scaled by how long the beam held them
      const k = Math.min(1, act.hitT / 1.0), m = b.def.mass;
      this.damage(b, 6 + 10 * k, a, kind, { charge: +k.toFixed(2), final: true });
      if (!b.ko) { if (b.ragdoll) b.vel.addScaledVector(dir, (30 + 90 * k) / m); else { b.vel.copy(dir).multiplyScalar((50 + 110 * k) / m); this.startRagdoll(b, 8 + 6 * k); } }
      this.fx.flash(end, roar ? 0xff6a20 : 0xfff0d0, 90 + 80 * k, 0.4); this.burst(end, a, 60 + 60 * k, 16 + 10 * k);
      if (roar) { a.fireBurst(end, 120 + 120 * k, 22 + 14 * k); this.fx.shockwave(end, 0xff7020, 10 + 20 * k); fireBlastSound(k); }
      this.fx.shockwaveOriented?.(end, dir, roar ? 0xff8a30 : 0xfff2c8, 10 + 25 * k, 0.5, 0.8); this.shakeNear(end, 0.35 + 0.4 * k);
    }
    act.sfx?.stop();
    a.action = null; a.cd.blast = 0.8; a.eyeGlow = 0; a.beamTarget = null;
  }
  updateEyeBeam(dt) {
    const eb = this.eyeBeam, on = eb && eb.on && eb.owner.action?.beam;
    if (eb && !eb.owner.action?.beam) { eb.owner.eyeGlow = 0; eb.owner.beamTarget = null; eb.sfx?.stop(); this.eyeBeam = null; }
    for (const m of this.eyeMeshes) m.c.visible = m.w.visible = !!on && !eb.roar;
    for (const m of this.roarCones) m.visible = !!on && eb.roar;
    if (!on) return;
    if (eb.roar) return this.updateRoarCone(eb);
    const eyes = eb.owner.eyePositions?.(this._eyes) || [this.eyeMid(eb.owner, this._eyes[0]), this._eyes[0].clone()];
    const fl = 0.85 + 0.15 * Math.sin(this.t * 60) + 0.1 * Math.random(), grow = Math.min(1, eb.t / 0.06);
    for (let i = 0; i < 2; i++) {
      const from = eyes[i], len = from.distanceTo(eb.end), M = this.eyeMeshes[i];
      for (const [m, r] of [[M.c, 0.04], [M.w, 0.17]]) { m.position.copy(from); m.lookAt(eb.end); m.scale.set(r * fl * grow, r * fl * grow, len); }
    }
    this.eyeGlowM.opacity = 0.45 * fl;
    if (Math.random() < 0.8) this.fx.spark.emit(t2.copy(eyes[0]).lerp(eb.end, Math.random()), t3.set((Math.random() - .5) * 3, (Math.random() - .5) * 3, (Math.random() - .5) * 3), 0.25, this.cGold0, this.cGold1);
  }
  // roar blast: shader cones from the mouth + roiling fire particles through the cone + heat shimmer above it
  updateRoarCone(eb) {
    const from = this.beamOrigin(eb.owner, t1.clone()), dir = eb.dir, grow = Math.min(1, eb.t / 0.12);
    const len = Math.max(2, eb.len * grow + (eb.hit === 'enemy' ? 2.5 : 0.5)), r1 = (ROAR.r0 + ROAR.spread * len) * (0.6 + 0.4 * grow);
    const look = t2.copy(from).add(dir);
    this.roarCones.forEach((m, i) => {
      m.position.copy(from); m.lookAt(look);
      const u = m.material.uniforms; u.t.value = this.t + i * 3.7; u.len.value = len; u.r0.value = ROAR.r0 * (i ? 0.5 : 1); u.r1.value = r1 * (i ? 0.45 : 1); u.op.value = 0.85 + 0.15 * Math.random();
    });
    const up = Math.abs(dir.y) > 0.9 ? V(1, 0, 0) : V(0, 1, 0), sx = t3.crossVectors(dir, up).normalize(), sy = t4.crossVectors(sx, dir).normalize();
    for (let i = 0; i < 60; i++) {
      const s = Math.pow(Math.random(), 0.8) * len, r = (ROAR.r0 + ROAR.spread * s) * Math.sqrt(Math.random()) * 0.8, a = Math.random() * 6.283;
      const p = V().copy(from).addScaledVector(dir, s).addScaledVector(sx, Math.cos(a) * r).addScaledVector(sy, Math.sin(a) * r);
      this.fx.fire.emit(p, V().copy(dir).multiplyScalar(30 + Math.random() * 40).addScaledVector(sx, Math.cos(a) * 6).addScaledVector(sy, Math.sin(a) * 6), 0.12 + Math.random() * 0.2, this.cFire0, this.cFire1);
    }
    for (let i = 0; i < 6; i++) { // heat distortion: faint additive shimmer rising off the blast (no smoke)
      const s = Math.random() * len, p = V().copy(from).addScaledVector(dir, s).addScaledVector(sy, (ROAR.r0 + ROAR.spread * s) * (0.6 + 0.5 * Math.random()));
      this.fx.fire.emit(p, V((Math.random() - .5) * 2, 3 + Math.random() * 4, (Math.random() - .5) * 2), 0.5 + Math.random() * 0.5, this.cHaze0 || (this.cHaze0 = new THREE.Color(0.32, 0.16, 0.06)), this.cHaze1 || (this.cHaze1 = new THREE.Color(0.06, 0.04, 0.03)));
    }
  }
  // ---------- ranged ----------
  fireBlast(a, b) {
    const from = this.handPos(a, V()).addScaledVector(a.aim, 0.3);
    // re-aim from the hand toward the target if it is still in the cone
    const to = this.chest(b, V()).sub(from); const d = to.length(); to.normalize();
    const dir = (!b.ko && to.dot(a.aim) > 0.85 && d < 250) ? to : a.aim.clone();
    if (a.def.style === 'fire') {
      this.projectiles.push({ pos: from.clone(), vel: dir.clone().multiplyScalar(130), life: 1.8, owner: a, r: 1.6 });
      for (let i = 0; i < 40; i++) { const v = t4.copy(dir).multiplyScalar(10 + Math.random() * 40).add(t1.set((Math.random() - .5) * 10, (Math.random() - .5) * 10, (Math.random() - .5) * 10)); this.fx.fire.emit(from, v, 0.2 + Math.random() * 0.25, this.cFire0, this.cFire1); }
      this.fx.flash(from, 0xff7020, 25, 0.2);
    } else this.fireRay(a, b, from, dir);
  }
  fireRay(a, b, from, dir) {
    // march the ray: stop at the first building or the opponent
    let len = 260, hit = null;
    const cb = this.chest(b, t2);
    const tc = clamp(t1.copy(cb).sub(from).dot(dir), 0, 260);
    const closest = t3.copy(from).addScaledVector(dir, tc);
    const hitEnemy = !b.ko && closest.distanceTo(cb) < 1.5;
    for (let s = 0; s < 260; s += 1.5) {
      const p = t4.copy(from).addScaledVector(dir, s);
      if (p.y < 0) { len = s; hit = { type: 'ground', p: p.clone() }; break; }
      if (this.city.heightAt(p.x, p.z) > p.y) { len = s; hit = { type: 'wall', p: p.clone() }; break; }
    }
    if (hitEnemy && tc < len) { len = tc; hit = { type: 'enemy', p: cb.clone() }; }
    this.beam = { from: from.clone(), dir: dir.clone(), len, t: 0, dur: 0.42, owner: a };
    if (hit) {
      this.burst(hit.p, a, 50, 14); this.fx.flash(hit.p, 0xfff0c0, 50, 0.35);
      if (hit.type === 'enemy') { this.damage(b, 11, a, 'ray'); this.knockback(b, dir, 34, 0.2, false); this.shakeNear(hit.p, 0.2); }
      else if (hit.type === 'wall') { const w = this.wallHit(hit.p.clone().addScaledVector(dir, 0.6), 0.1); this.fx.impact(hit.p, w ? w.normal : dir.clone().negate(), 0.35, true); }
    }
  }
  updateBeam(dt) {
    const bm = this.beam;
    if (!bm) { this.beamCore.visible = this.beamGlow.visible = false; return; }
    bm.t += dt; if (bm.t > bm.dur) { this.beam = null; this.beamCore.visible = this.beamGlow.visible = false; return; }
    // the beam stays locked to the hand
    const from = this.handPos(bm.owner, t1).addScaledVector(bm.dir, 0.25);
    const k = 1 - bm.t / bm.dur, w = Math.sin(Math.min(1, bm.t / 0.05) * Math.PI / 2) * (0.35 + 0.65 * k);
    for (const [m, r] of [[this.beamCore, 0.11], [this.beamGlow, 0.42]]) {
      m.visible = true; m.position.copy(from); m.lookAt(t2.copy(from).add(bm.dir)); m.scale.set(r * w, r * w, bm.len);
    }
    this.beamGlow.material.opacity = 0.5 * k;
    if (Math.random() < 0.7) this.fx.spark.emit(t2.copy(from).addScaledVector(bm.dir, Math.random() * bm.len), t3.set((Math.random() - .5) * 4, (Math.random() - .5) * 4, (Math.random() - .5) * 4), 0.3, this.cGold0, this.cGold1);
  }
  updateProjectiles(dt, heroes) {
    this.projectiles = this.projectiles.filter(p => {
      p.life -= dt; const prev = t1.copy(p.pos); p.pos.addScaledVector(p.vel, dt);
      // flame trail
      for (let i = 0; i < 14; i++) { const q = t2.copy(prev).lerp(p.pos, Math.random()); this.fx.fire.emit(q, t3.set((Math.random() - .5) * 6, (Math.random() - .5) * 6, (Math.random() - .5) * 6).addScaledVector(p.vel, 0.08), 0.18 + Math.random() * 0.25, this.cFire0, this.cFire1); }
      if (this.fx.lightT <= 0.05) { this.fx.light.position.copy(p.pos); this.fx.light.color.setHex(0xff6a20); this.fx.light.intensity = 300; this.fx.lightT = 0.06; this.fx.lightDur = 0.06; }
      for (const h of heroes) {
        if (h === p.owner || h.ko) continue;
        const c = this.chest(h, t3); const seg = t4.copy(p.pos).sub(prev); const L = seg.length(); seg.divideScalar(L || 1);
        const tt = clamp(t2.copy(c).sub(prev).dot(seg), 0, L); const closest = t2.copy(prev).addScaledVector(seg, tt);
        if (closest.distanceTo(c) < p.r) {
          this.damage(h, 10, p.owner, 'fire');
          this.knockback(h, p.vel.clone().normalize(), 36, 0.25, false);
          this.explode(closest, 1); this.shakeNear(closest, 0.25); return false;
        }
      }
      if (p.pos.y < 0 || this.city.heightAt(p.pos.x, p.pos.z) > p.pos.y) {
        const w = this.wallHit(p.pos, 0.1); const n = w ? w.normal : V(0, 1, 0);
        if (p.pos.y >= 0) this.fx.impact(p.pos.clone().addScaledVector(p.vel, -0.01), n, 0.4, true);
        this.explode(p.pos, 0.8); return false;
      }
      return p.life > 0;
    });
  }
  explode(p, s) {
    for (let i = 0; i < 70 * s; i++) this.fx.fire.emit(p, t4.set((Math.random() - .5) * 30, (Math.random() - .3) * 30, (Math.random() - .5) * 30), 0.3 + Math.random() * 0.4, this.cFire0, this.cFire1);
    this.fx.flash(p, 0xff6a20, 60 * s, 0.35);
  }

  // ---------- procedural ragdoll ----------
  ragdollStep(dt, h) {
    const rd = h.ragdoll; rd.t += dt;
    const r = 0.45 * h.def.height / 1.83;
    h.vel.y -= GRAV * dt; h.vel.multiplyScalar(Math.exp(-dt * 0.15));
    const steps = Math.max(1, Math.ceil(h.vel.length() * dt / 0.6));
    let onGround = false;
    for (let i = 0; i < steps; i++) {
      h.pos.addScaledVector(h.vel, dt / steps);
      const pre = t1.copy(h.vel), before = t2.copy(h.pos);
      const floor = this.city.collide(h.pos, h.vel, r); rd.floor = floor;
      // bounce off walls; impact damage from speed into the wall (momentum)
      const dx = h.pos.x - before.x, dz = h.pos.z - before.z, pd = Math.hypot(dx, dz);
      if (pd > 1e-4) {
        const n = t3.set(dx / pd, 0, dz / pd), into = -pre.dot(n);
        if (into > 0) {
          h.vel.copy(pre).addScaledVector(n, into * 1.4); // restitution 0.4
          h.vel.multiplyScalar(0.7); rd.av.multiplyScalar(-0.7).add(t4.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(6));
          if (into > 16) {
            const hp = V(h.pos.x - n.x * r, h.pos.y + 0.9, h.pos.z - n.z * r);
            this.damage(h, 0.3 * into, null, 'wall', { speed: into });
            this.fx.impact(hp, n.clone(), clamp(into / 90, 0.3, 1.1), false); this.shakeNear(hp, 0.2 + into / 200);
            if (into > 25 && this.t - (rd.lastCrashT ?? -9) > 0.3) { rd.lastCrashT = this.t; this.fx.crash(hp, n.clone(), into, 'wall'); }
          }
        }
      }
      if (h.pos.y <= floor) {
        h.pos.y = floor; onGround = true;
        if (h.vel.y < -4) {
          const imp = -h.vel.y;
          h.vel.y = imp * 0.32; h.vel.x *= 0.75; h.vel.z *= 0.75; rd.av.multiplyScalar(0.6); rd.bounces++;
          // glancing ground hits kick the body into a roll along the slide direction
          const lv = t4.copy(h.vel).applyAxisAngle(t1.set(0, 1, 0), -h.yaw), hs = Math.hypot(lv.x, lv.z);
          if (hs > 3) rd.av.add(t1.set(lv.z, 0, -lv.x).multiplyScalar(0.35 / 0.45)).add(t4.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(2));
          if (imp > 10) this.fx.dustBurst(h.pos, 12 + Math.min(40, imp), 4 + Math.min(14, imp * 0.2));
          if (imp > 30) { this.damage(h, 0.15 * imp, null, 'ground', { speed: imp }); this.fx.shockwave(h.pos, 0xd8d0c0, Math.min(20, imp * 0.3)); this.fx.crash(h.pos.clone(), V(0, 1, 0), imp, 'ground'); this.shakeNear(h.pos, 0.15 + imp / 250); }
        } else { h.vel.y = 0; }
      }
    }
    if (onGround && Math.abs(h.vel.y) < 0.5) {
      const hs = Math.hypot(h.vel.x, h.vel.z);
      if (hs > 4) { // sliding / rolling along the ground: lower friction, spin blends toward rolling over the slide
        const f = Math.exp(-dt * 1.8); h.vel.x *= f; h.vel.z *= f;
        const lv = t4.copy(h.vel).applyAxisAngle(t1.set(0, 1, 0), -h.yaw);
        rd.av.lerp(t1.set(lv.z, 0, -lv.x).normalize().multiplyScalar(Math.min(9, hs * 0.55 / 0.45)), Math.min(1, dt * 3));
      } else { const f = Math.exp(-dt * 5); h.vel.x *= f; h.vel.z *= f; rd.av.multiplyScalar(Math.exp(-dt * 6)); }
    }
    if (rd.av.length() > 18) rd.av.setLength(18);
    rd.flail = clamp(h.vel.length() / 12 + rd.av.length() / 10, 0, 1);
    // integrate orientation (root-space angular velocity)
    const w = rd.av.length();
    if (w > 1e-3 && rd.getUp <= 0) rd.q.premultiply(new THREE.Quaternion().setFromAxisAngle(t4.copy(rd.av).divideScalar(w), w * dt));
    // when resting on the ground, settle flat (on back or front) instead of balancing on the head
    if (onGround && rd.getUp <= 0) {
      const up = t4.set(0, 1, 0).applyQuaternion(rd.q);
      if (up.y > 0.25 && h.vel.length() < 6) { const tgt = new THREE.Quaternion().setFromUnitVectors(up.clone(), t3.set(up.x, 0, up.z).normalize()).multiply(rd.q); rd.q.slerp(tgt, Math.min(1, dt * 4)); }
    }
    // get back up
    const resting = onGround && h.vel.length() < 1.2;
    if (resting) rd.rest += dt; else if (rd.getUp <= 0) rd.rest = 0;
    if (!h.ko && rd.rest > 0.6 && rd.t > 1.0) {
      if (rd.getUp <= 0) rd.q0 = rd.q.clone();
      rd.getUp += dt / 0.65;
      rd.q.copy(rd.q0).slerp(new THREE.Quaternion(), Math.min(1, rd.getUp * rd.getUp * (3 - 2 * rd.getUp)));
      if (rd.getUp >= 1) {
        h.ragdoll = null; h.state = 'ground'; h.vel.set(0, 0, 0); h.knockT = 0; h.rig.body.rotation.set(0, 0, 0);
        h.landSquash = 0.85; this.fx.dustBurst(h.pos, 15, 5);
      }
    }
  }

  // ---------- AI opponent ----------
  aiInput(dt, ai, player) {
    const B = this.ai; B.t += dt;
    const inp = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, jumpReleased: false, boost: 0, descend: 0, cancelPressed: false };
    if (ai.grabbing) { this.aiCam.yawFacing = ai.yaw; return inp; } // holding someone: the choke logic decides
    if (ai.ko || ai.ragdoll || ai.grabbedBy || this.aiOff) return inp;
    const me = this.chest(ai, V()), tgt = this.chest(player, V());
    const to = tgt.clone().sub(me); const d = to.length(); const dir = to.clone().divideScalar(d || 1);
    const flat = V(to.x, 0, to.z); const fd = flat.length(); if (fd > 1e-3) flat.divideScalar(fd); else flat.set(Math.sin(ai.yaw), 0, Math.cos(ai.yaw));
    const c = this.aiCam; c.flatForward.copy(flat); c.right.set(-flat.z, 0, flat.x); c.yawFacing = Math.atan2(flat.x, flat.z);
    if (player.ko) { // idle: back off a little and hover/stand
      c.forward.copy(flat); inp.moveY = d < 25 ? -0.5 : 0; return inp;
    }
    // flight decisions: follow the player into the air, land when they land
    const playerAir = player.state !== 'ground' || player.pos.y > 4;
    if (playerAir || fd > 70 || (this.city.heightAt(ai.pos.x + flat.x * 8, ai.pos.z + flat.z * 8) > ai.pos.y + 1 && fd > 12)) B.flyHold = 2.5; else B.flyHold -= dt;
    if (B.flyHold > 0 && ai.state === 'ground' && !ai.action) ai.forceFly();
    if (B.flyHold <= 0 && ai.state === 'fly') { inp.descend = 1; }
    // keep fighting distance: approach, circle, sometimes rush in
    B.strafeT -= dt; if (B.strafeT < 0) { B.strafe = Math.random() < 0.5 ? -1 : 1; B.strafeT = 1.5 + Math.random() * 2; }
    B.think -= dt;
    const ideal = B.mode === 'rush' ? 2.2 : 16;
    let fwd = d > ideal + 4 ? 1 : d < ideal - 4 ? -0.7 : 0;
    const side = B.mode === 'rush' ? 0 : B.strafe * (d < 40 ? 0.8 : 0.2);
    if (ai.state === 'fly') { // 3D steering toward an offset point near the player
      const goal = tgt.clone().addScaledVector(dir, -ideal); goal.y = Math.max(goal.y, playerAir ? tgt.y : 1.5);
      const g = goal.sub(me); const gl = g.length(); c.forward.copy(gl > 1e-3 ? g.divideScalar(gl) : dir);
      fwd = clamp(gl / 6, 0, 1); inp.boost = gl > 90 ? 1 : 0;
      if (B.flyHold <= 0) { inp.descend = 1; fwd *= 0.5; }
    } else { c.forward.copy(flat); inp.boost = d > 30 ? 1 : 0; }
    inp.moveY = fwd; inp.moveX = side;
    // dodge when the player attacks nearby
    const pa = player.action;
    if (pa && pa.t < 0.12 && !B.dodged && d < 35 && ai.cd.dodge <= 0 && Math.random() < 0.45) {
      B.dodged = true; ai.cd.dodge = 2.5;
      const sd = c.right.clone().multiplyScalar(B.strafe * (ai.state === 'fly' ? 45 : 28)); ai.vel.add(sd); if (ai.state === 'ground') { ai.vel.y = 9; ai.state = 'air'; }
      if (ai.def.style === 'fire') ai.fireBurst(ai.pos, 25, 8); else this.fx.dustBurst(ai.pos, 12, 6);
    }
    if (!pa) B.dodged = false;
    // attacks (same moveset, with cooldowns + reaction delay)
    if (B.think <= 0 && this.canAct(ai) && !player.ragdoll) {
      B.think = 0.35 + Math.random() * 0.5;
      const r = Math.random();
      if (d < 4.2 && ai.cd.punch <= 0) { this.start(ai, 'punch', dir); B.mode = 'circle'; }
      else if (d < 45 && d > 6 && ai.cd.tackle <= 0 && r < 0.22) { this.start(ai, 'tackle', dir); }
      // (no ranged blast: Centurion's eye beam and Tiger's roar blast are player-only)
      else if (r > 0.82) B.mode = B.mode === 'rush' ? 'circle' : 'rush';
    }
    if (B.mode === 'rush' && d < 3.5 && ai.cd.punch <= 0 && this.canAct(ai)) { this.start(ai, 'punch', dir); B.mode = 'circle'; }
    return inp;
  }

  // respawn helpers
  respawnNear(h, other) {
    const a = Math.random() * Math.PI * 2; const p = other.pos.clone().add(V(Math.cos(a) * 45, 0, Math.sin(a) * 45));
    p.y = Math.max(other.pos.y, this.city.heightAt(p.x, p.z, 2)) + 12;
    this.reset(h, p); h.state = 'fly'; h.vel.set(0, 0, 0);
  }
  reset(h, p) {
    h.endSuper?.(); h.ko = false; h.hp = h.maxHp; h.ragdoll = null; h.grabbedBy = null; h.grabbing = null; h.action = null; h.knockT = 0;
    if (p) h.pos.copy(p); h.vel.set(0, 0, 0); h.rig.body.rotation.set(0, 0, 0); h.state = h.pos.y > 0.5 ? 'air' : 'ground';
  }
  inCombat(player, enemy) {
    return this.t - this.lastCombat < 6 || (!enemy.ko && player.pos.distanceTo(enemy.pos) < 90) || player.hp < player.maxHp && this.t - this.lastCombat < 12;
  }
}
