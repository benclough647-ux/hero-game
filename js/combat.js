import * as THREE from 'three';
import { PLAYER_GRAB } from './heroes.js';
import { whooshSound, roarSound, fireBlastSound, punchSound, laserSound, setWorldSfx } from './audio.js';
// Combat: the player (Tiger or Centurion) vs two computer-controlled villains at once (coordinated: one grab at a time,
// staggered attacks), player-only beams (Tiger roar blast / Centurion eye beam),
// tackle-grab that can smash the target into buildings, super punch with ragdoll, momentum-based damage,
// procedural ragdoll with building/ground collisions, KO + respawn, and the AI opponent.
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GRAV = 32, CHEST = 1.15;
const t1 = V(), t2 = V(), t3 = V(), t4 = V(), t5 = V();
const clamp = THREE.MathUtils.clamp;
// lock-on: range to acquire, distance / KO time that breaks it
export const LOCK = { range: 520, lose: 800, loseT: 1.0, koT: 1.5 };
// lock switching: flick the right stick left / right (raw axis) while locked on. The stick must return inside `dead`
// before the next flick counts, plus a cooldown; the camera eases over to the new target over `ease` s (no jerk).
export const LOCKSW = { dead: 0.3, flick: 0.72, cd: 0.35, ease: 0.6 }; // (now the stick's UP / DOWN flick: left / right is the dodge)
// lock-on dodge (Ben): flick the right stick left / right (from near-centre past `flick` within `window` s; keyboard Shift+A / D)
// while locked on: a very fast sidestep around the target (`dist` m in `dur` s) with i-frames (`iframes` s: punches and grabs
// miss, villain tackles in flight lose their homing), a wind (Centurion) / flame (Tiger) burst, and world slow motion for a
// `slowT` s real-time counter window (main.js); hits landed in that window knock back `bonus` x harder.
// flying ram (Ben): fly into a villain at full flight speed (>= minSpeed) without pressing grab: impact boom, and they're
// carried ahead of your chest along your flight (no hand grip) until you slow down (< stopK x the impact speed), turn
// more than ~turnDeg away, hit something (wall smash) or maxT runs out; then they're flung on along the carry
export const RAM = { minSpeed: 80, r: 2.4, stopK: 0.45, turnDot: 0.64, maxT: 1.5, minT: 0.1 };
export const DODGE = { centre: 0.25, flick: 0.8, window: 0.12, cd: 0.6, dist: 7, dur: 0.15, iframes: 0.3, slowT: 1.75, bonus: 1.2 };
// choke grab, A: super-fast face-first slam into the ground. Lift `lift` m, then dive at base speed accelerating at `accel`
// (impact speed = sqrt(base^2 + 2*accel*height) + carried speed); crater / dust / damage scale with that momentum.
export const SLAM = { windup: 0.12, lift: 3, base: 120, accel: 2600, maxSpeed: 520, dmg0: 62, dmgK: 0.09, dmgMax: 110, down: 2.4, dustK: 0.7, angle: 0.18 };
// villain coordination: only one villain may be grabbing / tackling / leg-grabbing at a time; attacks staggered by `gap` s;
// the 'lead' role (rushes in) swaps every lead0..lead1 s while the other circles wider
export const VILLAIN_AI = { gap: 0.4, lead0: 4, lead1: 7, supportDist: 24, sep: 7 };
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
  impact: { kb: 120, kbSpeed: 0.55, spin: 14, dmgBonus: 10 } }; // (no upward lift: the lunge sends them along the punch)
// rival-only leg grab: when the player is close (or flies past / right after the rival dodges) it seizes a leg, giant-swings
// them and flings them into a ragdoll tumble. The player has `window` s to counter (Y): curl up and punch the grabber off.
// pursuit of a fleeing player (moving away from the villain): small cruise-speed bonus (not boost: boosting still escapes),
// intercept steering toward where the player will be, and a longer leg-grab / tackle catch from behind
export const PURSUIT = { bonus: 1.1, fleeMin: 15, fleeDot: 0.45, lead: 1.1, leadMax: 1.6, behindR: 6.5, behindChance: 0.5, tackleChance: 0.34, tackleLead: 1.0, behindCatchR: 3.4 };
export const LEG = { cd: 10, range: 4.2, passRange: 6.5, passSpeed: 25, chance: 0.3, passChance: 0.6, dodgeChance: 0.55,
  window: 1.5, throwAt: 1.55, dur: 1.75, spinMax: 12, spinUp: 1.1, armR: 0.95, armH: 1.25, leg: 0.95,
  throwSpeed: 150, throwUp: 0.3, throwDmg: 26,
  counter: { dur: 0.6, hitAt: 0.3, dmg: 30, speed: 140, up: 0.25, flipDur: 0.5 } };
const mom = (speed, h) => speed * (0.6 + 0.4 * (h?.def?.mass ?? 1)); // impact momentum (heavier heroes hit the scenery harder)

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
  constructor(i = 0) { this.i = i; this.t = 0; this.strafe = i ? -1 : 1; this.strafeT = 0; this.think = 0.2 * i; this.mode = 'approach'; this.wantFly = false; this.flyHold = 0; this.legCd = 4 + 3 * i; this.dodgeT = -9; }
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
    this.projectiles = []; this.t = 0; this.wt = 0; this.lastCombat = -99; this.enemies = [];
    this.coord = { lastAtk: -9, lead: 0, leadT: 5, starts: [] }; // villain coordination (see VILLAIN_AI)
    this.flick = { armed: true, cd: 0, switches: 0 }; this.lockTgt = null; this.dodgeIn = { rt: 0, centreT: 0, armed: true, cd: 0, n: 0 }; this.counterWin = 0;
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

  // ---------- AI brains (one per villain) ----------
  brainOf(v) {
    if (!v.brain) { const i = Math.max(0, this.enemies.indexOf(v)); v.brain = new AIBrain(i); v.aiCam = { forward: V(0, 0, 1), flatForward: V(0, 0, 1), right: V(-1, 0, 0), yawFacing: 0 }; }
    return v.brain;
  }
  get ai() { return this.enemies[0] ? this.brainOf(this.enemies[0]) : (this._ai || (this._ai = new AIBrain())); } // (tests / first villain)
  get aiCam() { const e = this.enemies[0]; if (e) { this.brainOf(e); return e.aiCam; } return this._aiCam || (this._aiCam = { forward: V(0, 0, 1), flatForward: V(0, 0, 1), right: V(-1, 0, 0), yawFacing: 0 }); }
  alive() { return this.enemies.filter(e => !e.ko); }
  // the villain the player's moves aim at: the lock target, else the best one in front of the camera (angle + distance)
  focus(P, fwd = this.camFwd) {
    const L = this.lockTarget(); if (L) return L;
    let best = null, bs = -1e9;
    for (const e of this.enemies) {
      if (e.ko) continue;
      const to = this.chest(e, t1).sub(this.chest(P, t2)), d = to.length(); to.divideScalar(d || 1);
      const sc = (fwd ? to.dot(fwd) : 0) * 60 - d * 0.25; if (sc > bs) { bs = sc; best = e; }
    }
    return best || this.enemies[0] || null;
  }
  // ---------- lock-on ----------
  setLock(v, tgt = null) { if (v && !tgt) tgt = (this.enemies || []).find(e => !e.ko) || null; // no target given: first standing villain
    this.lockOn = v && !!tgt; this.lockTgt = this.lockOn ? tgt : null; this.lockLostT = 0; this.lockPop = this.lockOn ? 1 : 0; }
  bestLock(P, range = LOCK.range) { // nearest to the screen centre (and close) within range
    const f = this.focus(P, this.cam.forward); return f && !f.ko && P.pos.distanceTo(f.pos) < range ? f : null;
  }
  switchLock(P, dir) { // flick: the next villain on that side of the screen, else (only one other) whichever is left
    const cur = this.lockTgt, R = this.cam.right, side = h => t1.copy(h.pos).sub(P.pos).dot(R);
    const cands = this.enemies.filter(e => e !== cur && !e.ko && P.pos.distanceTo(e.pos) < LOCK.lose);
    if (!cands.length) return false;
    const s0 = cur ? side(cur) : 0;
    const ahead = cands.filter(e => dir > 0 ? side(e) > s0 : side(e) < s0).sort((a, b) => Math.abs(side(a) - s0) - Math.abs(side(b) - s0));
    const next = ahead[0] || cands[0];
    this.lockTgt = next; this.lockLostT = 0; this.lockPop = 1; this.flick.switches++; this.cam.lockBlend = 0; // the camera eases across
    this.hud?.say(`Locked on: ${next.def.name}`);
    this.stats.hits.push({ t: this.t, kind: 'lockSwitch', amount: 0, target: next.key, dir });
    return true;
  }
  updateLock(dt, P, enemies, inp) {
    if (enemies && !Array.isArray(enemies)) enemies = [enemies]; if (enemies) this.enemies = enemies;
    if (inp && inp.lockPressed) {
      if (this.lockOn) { this.setLock(false); this.hud?.say('Lock off'); }
      else { const t = this.bestLock(P); if (t) { this.setLock(true, t); this.hud?.say(`Locked on: ${t.def.name}`); } else this.hud?.say('No target in range'); }
    }
    // right-stick flick UP / DOWN to switch target (keyboard [ / ]); flick LEFT / RIGHT = dodge
    const F = this.flick, y = inp?.rsY ?? 0, x = inp?.rsX ?? 0; F.cd = Math.max(0, F.cd - dt);
    if (Math.abs(y) < LOCKSW.dead) F.armed = true;
    const D = this.dodgeIn, ax = Math.abs(x); D.rt += dt; D.cd = Math.max(0, D.cd - dt); this.counterWin = Math.max(0, this.counterWin - dt);
    if (ax < DODGE.centre) { D.centreT = D.rt; D.armed = true; }
    if (this.lockOn) {
      if (inp && x) inp.lookX = 0; // while locked the right stick X is the dodge, not a camera orbit (mouse look unaffected)
      if (inp && Math.abs(y) >= LOCKSW.flick) inp.lookY = 0;
      if (F.armed && F.cd <= 0 && Math.abs(y) > LOCKSW.flick) { F.armed = false; F.cd = LOCKSW.cd; this.switchLock(P, y < 0 ? 1 : -1); }
      if (inp?.swX && F.cd <= 0 && !F.kbHeld) { F.cd = LOCKSW.cd; this.switchLock(P, Math.sign(inp.swX)); } F.kbHeld = !!inp?.swX;
      if (ax > DODGE.flick && D.armed) { D.armed = false; if (D.rt - D.centreT <= DODGE.window + 1e-6 && D.cd <= 0) this.startDodge(P, Math.sign(x)); } // a slow push isn't a flick
      if (inp && (inp.dodgeLPressed || inp.dodgeRPressed) && D.cd <= 0) this.startDodge(P, inp.dodgeRPressed ? 1 : -1);
      const E = this.lockTgt, far = P.pos.distanceTo(E.pos) > LOCK.lose;
      if (far || E.ko) this.lockLostT += dt; else this.lockLostT = 0;
      if (this.lockLostT > (E.ko ? LOCK.koT : LOCK.loseT)) {
        const other = E.ko && this.enemies.find(e => e !== E && !e.ko && P.pos.distanceTo(e.pos) < LOCK.range);
        if (other) { this.lockTgt = other; this.lockLostT = 0; this.lockPop = 1; this.cam.lockBlend = 0; this.hud?.say(`Target down – locked on: ${other.def.name}`); }
        else { this.setLock(false); this.hud?.say(E.ko ? 'Target down – lock off' : 'Target out of range – lock off'); }
      }
    }
    this.updateReticle(dt, this.lockTgt);
  }
  // ---------- lock-on dodge ----------
  startDodge(P, s) {
    const E = this.lockTgt;
    if (!this.lockOn || !E || P.ko || P.ragdoll || P.grabbedBy || P.legGrabbedBy || P.slammedBy || P.grabbing || P.dodge) return false;
    if (P.action) { if (P.action.type === 'tackle' && P.action.mode) return false; P.action = null; } // (cancels a wind-up / beam)
    const to = t1.copy(E.pos).sub(P.pos).setY(0); const r = Math.max(2, to.length()); to.normalize();
    const side = V(-to.z, 0, to.x).multiplyScalar(s); // s = +1: to the player's right (as seen looking at the target)
    P.dodge = { t: 0, dur: DODGE.dur, s, tgt: E, r, v: side.clone().multiplyScalar(DODGE.dist / DODGE.dur), side };
    P.vel.copy(P.dodge.v); P.invulnT = Math.max(P.invulnT, DODGE.iframes); P.dodgeUntil = this.t + DODGE.iframes; this.dodgeIn.cd = DODGE.cd; this.dodgeIn.n++;
    for (const e of this.enemies) { const a = e.action; // grab attempts in progress lose the player: they fly past
      if (a && a.type === 'tackle' && !e.grabbing && a.target === P) { a.target = null; a.dodged = true; }
      if (a && a.type === 'punch' && a.target === P) { a.target = null; a.dodged = true; } }
    const fire = P.def.style === 'fire', c = this.chest(P, V());
    if (fire) { P.fireBurst?.(P.pos, 45, 16); this.fx.shockwaveOriented?.(c, side.clone().negate(), 0xff8a30, 9, 0.35, 0.7); }
    else { this.fx.shockwaveOriented?.(c, side.clone().negate(), 0xe8f0ff, 9, 0.35, 0.7); this.fx.shockwave(P.pos.clone().setY(P.pos.y + 0.2), 0xe8e2d0, 6); }
    this.burst(c, P, 14, 7); whooshSound(fire); if (P.isPlayer) { P.fovKick = (P.fovKick || 0) + 6; this.cam.shake?.(0.1); }
    this.counterWin = DODGE.slowT; this.onDodge?.(P, s);
    this.stats.hits.push({ t: this.t, kind: 'dodge', amount: 0, dir: s, target: E.key });
    return true;
  }
  dodgeStep(dt, P) { // strafe around the target at a constant radius; flame / wind trail
    const d = P.dodge; if (!d) return; d.t += dt;
    if (P.ko || P.ragdoll || P.grabbedBy || P.legGrabbedBy || d.t >= d.dur) { P.vel.multiplyScalar(0.15); P.dodge = null; return; }
    const to = t1.copy(d.tgt.pos).sub(P.pos).setY(0), cur = Math.max(0.5, to.length()); to.divideScalar(cur);
    d.side.set(-to.z, 0, to.x).multiplyScalar(d.s);
    d.v.copy(d.side).multiplyScalar(DODGE.dist / DODGE.dur).addScaledVector(to, clamp((cur - d.r) * 10, -20, 20));
    const c = this.chest(P, t2), fire = P.def.style === 'fire';
    for (let i = 0; i < 4; i++) (fire ? this.fx.fire : this.fx.spark).emit(c, t3.copy(d.side).multiplyScalar(-6 - Math.random() * 8).add(t4.set((Math.random() - .5) * 3, (Math.random() - .5) * 3, (Math.random() - .5) * 3)), 0.3 + Math.random() * 0.3, fire ? this.cFire0 : this.cGold0, fire ? this.cFire1 : this.cGold1);
  }
  updateReticle(dt, E) {
    const r = this.reticle, cam = this.cam.cam;
    r.visible = this.lockOn && !!E && E.visibleFlag !== false;
    if (!r.visible) return;
    this.lockPop = Math.max(0, this.lockPop - dt * 4);
    this.chest(E, r.position); r.quaternion.copy(cam.quaternion);
    const d = r.position.distanceTo(cam.position);
    const k = d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * 0.12 * (1 + 1.6 * this.lockPop * this.lockPop);
    r.scale.setScalar(Math.max(k, 0.9));
    const u = r.userData; u.spin.rotation.z += dt * 1.6; u.chev.scale.setScalar(1 + 0.08 * Math.sin(this.t * 7));
    u.mat.opacity = (this.lockLostT > 0 ? 0.45 + 0.4 * Math.abs(Math.sin(this.t * 12)) : 0.95);
  }
  lockTarget() { return this.lockOn && this.lockTgt && !this.lockTgt.ko ? this.lockTgt : null; }

  // ---------- helpers ----------
  chest(h, out) { return out.copy(h.pos).setY(h.pos.y + CHEST * h.def.height / 1.83); }
  handPos(h, out) { const f = h.fists?.[0]; if (f) { h.rig.root.updateMatrixWorld(true); return f.getWorldPosition(out); } return this.chest(h, out).addScaledVector(h.aim, 0.8); }
  canAct(h) { return !h.ragdoll && !h.grabbedBy && !h.legGrabbedBy && !h.ko && !h.action; }
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
    if (type === 'blast' && (h.def.villain || (this.player && h !== this.player))) return false; // eye beam / roar blast are player-only (villains have no beams)
    h.aim.copy(aim).normalize(); h.action = { type, t: 0, dur: MOVES[type].dur, done: false, target };
    h.cd[type] = MOVES[type].cd;
    if (type === 'blast' && (h.def.style === 'clean' || h.def.style === 'fire')) { Object.assign(h.action, { beam: true, dur: 99, onT: 0, hitT: 0, dmgAcc: 0 }); h.cd.blast = 0; }
    if (type === 'tackle') { h.action.carryDir = h.aim.clone(); h.action.carrySpeed = h.mv.tackleSpeed * 1.25;
      h.vel.copy(h.aim).multiplyScalar(Math.max(h.vel.dot(h.aim), h.mv.tackleSpeed * (h === this.player ? PLAYER_GRAB.launch * PLAYER_GRAB.speed : 0.6))); // explosive launch (the player's is harder)
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
    amount = Math.round(clamp(amount, 1, extra.cap ?? 60));
    target.hp = Math.max(0, target.hp - amount); target.lastHitT = this.t; this.lastCombat = this.t;
    this.stats.hits.push({ t: this.t, kind, amount, target: target.key, attacker: attacker?.key, ...extra });
    if (target.hp <= 0) this.knockOut(target);
    return amount;
  }
  // knockback goes exactly along `dir` (plus an optional explicit `up`, 0 by default): no forced lift, so a hit aimed down
  // drives the target down (into the ground / dunes: ragdollStep bounces it with an impact) and a level hit skims
  knockback(target, dir, speed, up = 0, ragdoll = false, spin = 6) {
    if (target.grabbedBy) this.releaseGrab(target.grabbedBy);
    if (target.legGrabbing) this.releaseLeg(target);
    target.action = null;
    const v = t1.copy(dir).setY(dir.y + up).normalize().multiplyScalar(speed / target.def.mass);
    target.vel.copy(v);
    if (ragdoll || target.ko) this.startRagdoll(target, spin);
    else { target.knockT = 0.45; if (target.state === 'ground') { if (v.y > 0.5) { target.state = 'air'; target.pos.y += 0.1; } else target.vel.y = 0; } }
  }
  startRagdoll(h, spin = 6) { h.ragBlend = null;
    if (h.legGrabbing && h.action?.type === 'leggrab') this.releaseLeg(h);
    h.action = null; h.knockT = 0; h.charge = 0; h.endSprint?.(); h.landT = 0;
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
  releaseGrab(att) { const v = att.grabbing; if (v) { v.grabbedBy = null; v.faceSlamPitch = undefined; } att.grabbing = null; att.slamLean = 0; att.slamSpeed = 0; if (att.action?.type === 'tackle') att.action.t = att.action.dur; }
  smash(att, victim, normal, hitPoint, speed) {
    const dmg = this.damage(victim, 6 + 0.36 * speed, att, 'building', { speed });
    const cpw = this.fx.crash(hitPoint.clone().setY(Math.max(0.5, hitPoint.y - 0.6)), normal, mom(speed, victim), 'wall');
    const pw = clamp(speed / 100, 0.4, 3);
    this.fx.impact(hitPoint, normal, pw, false);
    if (pw > 1.3) { this.fx.impact(hitPoint.clone().add(t4.set(0, 2.5, 0)), normal, pw * 0.6, false); this.fx.dustBurst(hitPoint.clone().setY(Math.max(0, hitPoint.y - 2)), 60 + speed * 0.3, 20 + speed * 0.1); }
    this.fx.shockwave(hitPoint.clone().setY(Math.max(0, hitPoint.y - 1)), 0xd8d0c0, Math.min(80, 8 + speed * 0.22));
    this.fx.shockwaveOriented?.(hitPoint.clone().addScaledVector(normal, 0.3), normal, 0xfff0d8, Math.min(60, 6 + speed * 0.15), 0.6, 0.7);
    this.shakeNear(hitPoint, Math.max(0.3, this.fx.crashShake(cpw)));
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
  // dt: the player's (real) frame time; wdt: world time (slow motion scales everything except the player)
  update(dt, player, enemies, inp, camFwd, wdt = dt) {
    this.t += dt; this.wt = (this.wt || 0) + wdt;
    if (!Array.isArray(enemies)) enemies = [enemies];
    this.enemies = enemies; player.isPlayer = true; for (const e of enemies) { e.isPlayer = false; this.brainOf(e); }
    this.player = player; this.pInp = inp; this.camFwd = camFwd;
    this.dodgeStep(dt, player);
    const all = [player, ...enemies];
    // recovery backflip: double-tap jump while tumbling (player only, never the AI)
    if (inp && inp.jumpPressed && player.ragdoll && !player.ko && !player.grabbedBy) {
      const rd = player.ragdoll;
      if (rd.getUp <= 0 && player.cd.recover <= 0 && this.t - (rd.lastTap ?? -9) < 0.3) this.recover(player);
      else rd.lastTap = this.t;
    }
    for (const h of all) { const hdt = h === player ? dt : wdt;
      for (const k in h.cd) h.cd[k] = Math.max(0, h.cd[k] - hdt);
      if (h.invulnT > 0) h.invulnT = Math.max(0, h.invulnT - hdt);
      // the punch wind-up holds while the dash is still closing the gap, so the fist lands on arrival
      if (h.action) { if (!(h.action.dash && h.action.t >= 0.08)) h.action.t += hdt; }
    }
    // grab counter: Y while a villain holds you (player only: the AI never counters)
    if (inp && inp.yPressed && this.canCounter(player)) { if (player.legGrabbedBy) this.legCounter(player, player.legGrabbedBy); else this.counter(player, player.grabbedBy); }
    // player commands, aimed at the focus villain (locked on: always aim at / track it)
    const enemy = this.focus(player, camFwd);
    if (inp && !player.ko && enemy) {
      const fwd = camFwd.clone(), lock = this.lockTarget();
      const toE = () => this.chest(enemy, V()).sub(this.chest(player, V())).normalize();
      if (inp.blastPressed) this.start(player, 'blast', lock ? toE() : this.aimAt(player, enemy, fwd, 0.8), enemy);
      else if (inp.punchPressed) {
        if (lock) this.start(player, 'punch', toE(), enemy);
        else { // aim assist: lunge at the villain if roughly in front and in range, with softer steering than lock-on
          const a = this.aimAt(player, enemy, fwd, DASH.cone, DASH.assist); const assist = !enemy.ko && (a.dot(fwd) < 0.9999 || this.chest(enemy, V()).distanceTo(this.chest(player, V())) < 5);
          if (this.start(player, 'punch', a, assist ? enemy : null) && assist) player.action.soft = true; }
      }
      else if (inp.tacklePressed) {
        if (lock) this.start(player, 'tackle', toE(), enemy);
        else { // aim assist: if the villain is roughly in front, snap to them and keep (softer) homing on during the lunge
          const a = this.aimAt(player, enemy, fwd, TACKLE.assistCone, TACKLE.assistRange), assist = !enemy.ko && a.dot(fwd.clone().normalize()) < 0.9999;
          if (this.start(player, 'tackle', a, assist ? enemy : null) && assist) player.action.soft = true;
        }
      }
    }
    // the player's move resolves against its target, or (untargeted) the nearest villain; each villain only fights the player
    this.ramCheck(dt, player, enemies);
    setWorldSfx(false); if (player.action) this.actionStep(dt, player, this.foeFor(player));
    setWorldSfx(true); for (const e of enemies) this.actionStep(wdt, e, player);
    this.updateProjectiles(wdt, all);
    setWorldSfx(false);
    const odt = o => o && o !== player ? wdt : dt; // beams run on their owner's clock
    this.updateBeam(odt(this.beam?.owner)); this.updateEyeBeam(odt(this.eyeBeam?.owner));
    for (const h of all) { const hdt = h === player ? dt : wdt; setWorldSfx(h !== player);
      if (h.ragdoll) this.ragdollStep(hdt, h);
      if (h.grabbedBy) this.carryStep(h.grabbedBy, h);
      if (h.legGrabbedBy) this.legSwingStep(wdt, h.legGrabbedBy, h); // the villain's swing (world time)
      if (h.slammedBy) this.slamCarry(h.slammedBy, h);
    }
    setWorldSfx(false);
  }
  foeFor(P) {
    const act = P.action;
    if (act?.type === 'counter' && act.target) return act.target;
    if (P.grabbing) return P.grabbing;
    if (act?.target && !act.target.ko) return act.target;
    let best = null, bd = 1e9; const c = this.chest(P, t1);
    for (const e of this.enemies) { if (e.ko) continue; const d = this.chest(e, t2).distanceTo(c); if (d < bd) { bd = d; best = e; } }
    return best || this.enemies[0];
  }
  actionStep(dt, a, b) {
    const act = a.action; if (!act) return;
    if (act.type === 'counter') { if (act.style === 'curl') this.legCounterStep(dt, a, act); else this.counterStep(dt, a, b, act); return; }
    if (act.type === 'leggrab') { if (act.t >= act.dur) { a.action = null; a.legGrabbing = null; } return; }
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
    if (act.type === 'tackle' && act.ram) { // flying ram carry (see RAM): steer it yourself; ends on a stop / sharp turn / timeout
      if (!a.grabbing) { a.action = null; return; }
      act.grabT += dt; const sp = a.vel.length(); if (sp > 1) act.carryDir.copy(a.vel).divideScalar(sp);
      const turned = act.carryDir.dot(act.ramDir0) < RAM.turnDot;
      const wall = sp < act.ramSpeed * RAM.stopK && (this.wallHit(a.pos.clone().addScaledVector(act.ramDir0, 1.4).setY(a.pos.y + 0.9), 0.9) || this.wallHit(a.grabbing.pos.clone().addScaledVector(act.ramDir0, 1.2).setY(a.grabbing.pos.y + 0.9), 0.9));
      if (wall) { this.smash(a, a.grabbing, wall.normal, wall.point.setY(a.grabbing.pos.y + 1), act.ramSpeed); return; } // carried into a building: wall smash
      if (act.grabT > RAM.minT && (sp < act.ramSpeed * RAM.stopK || turned || a.state !== 'fly')) this.ramRelease(a, turned ? 'turn' : 'stop');
      else if (act.grabT > RAM.maxT) this.ramRelease(a, 'time');
      return;
    }
    if (act.type === 'tackle') {
      // homing: steer the drive toward a locked target in 3D
      if (!a.grabbing && act.target && !act.target.ko && !act.target.grabbedBy) {
        // lead the target: aim where it will be when we arrive (capped), so a moving / strafing rival can still be caught
        const tc = this.chest(act.target, t1), ac = this.chest(a, t2), dist = tc.distanceTo(ac);
        const away = a !== this.player && this.fleeing(a, act.target);
        const tti = Math.min(away ? PURSUIT.tackleLead : TACKLE.lead, dist / Math.max(a.mv.tackleSpeed, a.vel.length(), 1));
        const to = tc.addScaledVector(act.target.vel, tti).sub(ac).normalize();
        if (!act.soft || to.dot(a.aim) > TACKLE.assistMinDot) { a.aim.lerp(to, 1 - Math.exp(-dt * (act.soft ? TACKLE.assistTurn : TACKLE.lockTurn))).normalize(); act.homing = true; }
      }
      for (const v of (a === this.player ? [b, ...this.enemies.filter(e => e !== b)] : [b])) {
        if (a.grabbing || v.ko || v.grabbedBy || (v.ragdoll && a !== this.player)) continue; // the player can snatch a villain out of a ragdoll tumble
        // swept test (at 250+ m/s the attacker moves several metres per frame)
        const cb = this.chest(v, t2), c1 = this.chest(a, t1), rel = t3.copy(a.vel).sub(v.vel).multiplyScalar(dt), L = rel.length();
        const c0 = t4.copy(c1).sub(rel); let d;
        if (L > 1e-4) { const s = clamp(t1.copy(cb).sub(c0).dot(rel) / (L * L), 0, 1); d = c0.addScaledVector(rel, s).distanceTo(cb); } else d = c1.distanceTo(cb);
        if (d < (a === this.player ? TACKLE.playerCatchR : this.fleeing(a, v) ? PURSUIT.behindCatchR : TACKLE.catchR)) this.grab(a, v);
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
  // ---------- flying ram ----------
  ramCheck(dt, P, enemies) {
    this.ramCd = Math.max(0, (this.ramCd || 0) - dt);
    if (this.ramCd > 0 || P.state !== 'fly' || !this.canAct(P) || P.grabbing || P.legGrabbedBy || P.dodge) return;
    const sp = P.vel.length(); if (sp < RAM.minSpeed) return;
    for (const v of enemies) {
      if (v.ko || v.grabbedBy || v.slammedBy || v.invulnT > 0 || v.legGrabbing) continue;
      const cb = this.chest(v, t2), c1 = this.chest(P, t1), rel = t3.copy(P.vel).sub(v.vel).multiplyScalar(dt), L = rel.length(), c0 = t4.copy(c1).sub(rel);
      let d; if (L > 1e-4) { const s = clamp(t1.copy(cb).sub(c0).dot(rel) / (L * L), 0, 1); d = c0.addScaledVector(rel, s).distanceTo(cb); } else d = c1.distanceTo(cb);
      if (d < RAM.r) { this.startRam(P, v, sp); return; }
    }
  }
  startRam(P, v, sp) {
    const dir = P.vel.clone().normalize();
    P.action = { type: 'tackle', t: 0, dur: MOVES.tackle.dur, done: false, target: v, ram: true, mode: 'drive', grabT: 0, carryDir: dir.clone(), ramDir0: dir.clone(), carrySpeed: sp, ramSpeed: sp };
    if (v.ragdoll) { v.ragBlend = { q: v.rig.body.quaternion.clone(), y: v.rig.body.position.y, t: 0, dur: 0.25 }; v.ragdoll = null; }
    P.grabbing = v; v.grabbedBy = P; v.action = null; v.knockT = 0; v.state = 'air'; v.endSuper?.();
    P.impactBoom?.(dir); this.shakeNear(P.pos, 0.6);
    this.stats.hits.push({ t: this.t, kind: 'ram', amount: 0, speed: sp, target: v.key, attacker: P.key });
    this.damage(v, 6 + 0.08 * sp, P, 'ram', { speed: sp });
    if (v.ko) { this.releaseGrab(P); P.action = null; v.vel.copy(dir).multiplyScalar(sp * 0.9); this.startRagdoll(v, 12); }
  }
  ramRelease(a, why) {
    const act = a.action, v = a.grabbing; if (!v) { a.action = null; return; }
    const dir = (why === 'turn' ? act.ramDir0 : act.carryDir).clone(), speed = Math.max(act.ramSpeed * 0.8, a.vel.length());
    this.releaseGrab(a); a.action = null; if (a === this.player) this.ramCd = 0.8; // (no instant re-ram of the same body)
    this.damage(v, 3 + 0.04 * speed, a, 'throw', { speed });
    v.vel.copy(dir).multiplyScalar(speed * 0.85); this.startRagdoll(v, 10);
    this.fx.shockwaveOriented?.(this.chest(v, V()), dir, a.def.style === 'fire' ? 0xff8a30 : 0xe8e2d0, 12, 0.5, 0.6);
    this.stats.hits.push({ t: this.t, kind: 'ramRelease', amount: 0, why, target: v.key, attacker: a.key });
  }
  grab(a, b) {
    if (b.invulnT > 0 || b.slammedBy) return;
    const rel = t1.copy(a.vel).sub(b.vel).length();
    a.grabbing = b; b.grabbedBy = a; b.action = null; b.knockT = 0; b.state = 'air';
    const act = a.action; act.grabT = 0; act.carryDir = a.aim.clone(); if (act.carryDir.y < -0.3) act.carryDir.y = -0.3; act.carryDir.normalize();
    act.carrySpeed = Math.max(a.mv.tackleSpeed * 1.25, a.vel.length() * 1.15);
    this.damage(b, 4 + 0.1 * rel, a, 'tackle', { speed: rel });
    // the tackle ends in a one-handed choke hold: the attacker brakes hard and hangs the victim at arm's length
    if (b.ko) { this.releaseGrab(a); return; }
    // caught mid-tumble (ragdolling from a hit): blend the body out of its tumble into the held pose instead of snapping
    // (hero.animate eases rig.body from this pose; the joint layer fades out on its own); the grip lands on the neck as usual
    if (b.ragdoll) { b.ragBlend = { q: b.rig.body.quaternion.clone(), y: b.rig.body.position.y, t: 0, dur: 0.25 }; b.flip = null; b.landT = 0;
      this.stats.hits.push({ t: this.t, kind: 'ragdollGrab', amount: 0, target: b.key, attacker: a.key }); }
    act.mode = 'hold'; act.holdT = 0; b.endSuper?.(); a.endSuper?.(); b.ragdoll = null;
    a.vel.multiplyScalar(0.25);
    if (a !== this.player) { const B = this.brainOf(a); B.chokeT = 1 + Math.random() * 2; B.chokeOpt = ['punch', 'spin', 'drive'][Math.floor(Math.random() * 3)]; B.chokeCharge = 0.45 + Math.random() * 0.55; }
    this.shakeNear(a.pos, 0.3 + rel / 400); this.fx.flash(this.chest(b, t2), a.def.style === 'fire' ? 0xff7020 : 0xfff0c0, 30, 0.2);
    this.burst(this.chest(b, V()), a, 30, 10);
  }
  carryStep(att, victim) {
    const act = att.action; if (!act) { this.releaseGrab(att); return; }
    if (act.mode === 'slam') return; // placed by faceSlamStep
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
    const act = a.action, isP = a === this.player, inp = isP ? this.pInp : null, B = isP ? null : this.brainOf(a);
    act.holdT += dt;
    const F = V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    if (act.mode === 'hold') {
      let pick = null;
      if (isP && inp) { if (inp.jumpPressed) pick = 'slam'; else if (inp.punchPressed) pick = 'punch'; else if (inp.cancelPressed) pick = 'spin'; else if (inp.moveY > CHOKE.driveStick) pick = 'drive'; }
      else if (!isP && act.holdT > B.chokeT) pick = B.chokeOpt;
      if (pick === 'slam') { this.startFaceSlam(a, b, act); return; }
      if (pick === 'punch') { act.mode = 'punch'; act.charge = 0; }
      else if (pick === 'spin') { act.mode = 'spin'; act.spinT = 0; act.spinRate = 0; }
      else if (pick === 'drive') {
        // rocket forward carrying the victim: the existing carry / building-smash system takes over
        const dir = isP ? this.camFwd.clone() : this.aiDriveDir(a);
        if (dir.y < -0.3) dir.y = -0.3; dir.normalize();
        act.mode = 'drive'; act.carryDir = dir; a.aim.copy(dir); act.carrySpeed = a.mv.tackleSpeed * 1.25; act.grabT = 0;
        a.impactBoom?.(dir); this.stats.hits.push({ t: this.t, kind: 'driveBoom', amount: 0, attacker: a.key }); // tackle out of the grab: sonic / flame boom
        a.vel.copy(dir).multiplyScalar(act.carrySpeed * 0.6);
        this.fx.shockwaveOriented?.(this.chest(a, V()).addScaledVector(dir, -0.6), dir, a.def.style === 'fire' ? 0xff8a30 : 0xe8e2d0, 14, 0.45, 0.7);
        if (a.def.style === 'fire') a.fireBurst(a.pos, 60, 16); else this.burst(this.chest(a, V()), a, 30, 10);
        whooshSound(a.def.style === 'fire'); this.shakeNear(a.pos, 0.3);
        return;
      }
      if (!pick && act.holdT >= CHOKE.hold) { this.breakFree(a, b); return; }
      return;
    }
    if (act.mode === 'slam') { this.faceSlamStep(dt, a, b, act); return; }
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
        const dir = (isP ? this.camFwd.clone() : F.clone()).normalize(); if (Math.abs(dir.y) < 0.12) { dir.y = 0; dir.normalize(); } // straight along the punch (no lift)
        const hp = this.chest(b, V());
        this.releaseGrab(a); act.t = act.dur - 0.3; // keep the follow-through pose briefly
        this.damage(b, 12 + 33 * c, a, 'chargedPunch', { charge: +c.toFixed(2) }); this.punchSfx(0.5 + 0.5 * c, a, b);
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
  // ---- choke option A: super-fast face-first slam into the ground ----
  startFaceSlam(a, b, act) {
    const F = V(Math.sin(a.yaw), 0, Math.cos(a.yaw)), g = this.city.heightAt(a.pos.x + F.x, a.pos.z + F.z, 0.5);
    act.mode = 'slam'; act.slam = { t: 0, F, carry: a.vel.length(), v: SLAM.base, top: Math.max(a.pos.y, g + SLAM.lift) + 1.2, y0: a.pos.y, h0: 0, p: a.pos.clone() };
    this.hud?.say('FACE SLAM!'); whooshSound(a.def.style === 'fire');
    this.stats.hits.push({ t: this.t, kind: 'faceSlamStart', amount: 0, target: b.key, attacker: a.key });
  }
  faceSlamStep(dt, a, b, act) {
    const S = act.slam, F = S.F; S.t += dt;
    const fire = a.def.style === 'fire';
    if (S.t < SLAM.windup) { // rear up with them, then drive down
      const u = S.t / SLAM.windup; S.p.y += (S.top - S.p.y) * Math.min(1, dt * 25); a.pos.copy(S.p); a.rig.root.position.copy(a.pos); a.vel.set(0, 0, 0); // kinematic: Hero.update can't double-move it
      a.slamLean = -0.3 * u; b.faceSlamPitch = 0.6 * u; this.placeSlamVictim(a, b, F, 0.6 * u);
      S.h0 = a.pos.y - this.city.heightAt(a.pos.x + F.x * 0.9, a.pos.z + F.z * 0.9, 0.5);
      return;
    }
    const dir = V(F.x * SLAM.angle, -1, F.z * SLAM.angle).normalize();
    S.v = Math.min(SLAM.maxSpeed, S.v + SLAM.accel * dt);
    S.p.addScaledVector(dir, S.v * dt); a.pos.copy(S.p); a.vel.set(0, 0, 0); a.state = 'fly'; a.slamSpeed = S.v; a.rig.root.position.copy(a.pos); // (already animated this frame: keep the mesh on the kinematic path)
    a.slamLean = 0.95; b.faceSlamPitch = 2.25; this.placeSlamVictim(a, b, F, 2.25);
    const head = t3.copy(b.pos).addScaledVector(F, 0.6); head.y += 0.45 * b.def.height / 1.83;
    const fl = this.city.heightAt(head.x, head.z, 0.5);
    // speed trail
    const P = fire ? this.fx.fire : this.fx.spark, c0 = fire ? this.cFire0 : this.cGold0, c1 = fire ? this.cFire1 : this.cGold1;
    for (let i = 0; i < 8; i++) P.emit(t4.copy(head).add(t2.set((Math.random() - .5) * 0.8, Math.random() * 2.5, (Math.random() - .5) * 0.8)), t1.set(0, 10 + Math.random() * 12, 0), 0.12 + Math.random() * 0.12, c0, c1);
    if (head.y > fl + 0.12 && S.t < 2.5) return;
    // impact: crater, dust plume and damage all scale with the dive momentum
    const speed = S.v + 0.5 * S.carry, pt = V(head.x, fl, head.z);
    this.releaseGrab(a); a.action = null; a.slamLean = 0; a.slamSpeed = 0;
    b.faceSlamPitch = undefined; b.pos.set(head.x - F.x * 0.6, fl + 0.05, head.z - F.z * 0.6);
    const dmg = this.damage(b, Math.min(SLAM.dmgMax, SLAM.dmg0 + SLAM.dmgK * speed), a, 'faceSlam', { speed: Math.round(speed), cap: SLAM.dmgMax, height: +S.h0.toFixed(1) });
    const cp = this.fx.crash(pt.clone(), V(0, 1, 0), mom(speed * 1.25, b), 'ground');
    this.fx.dustBurst(pt, Math.round(80 + speed * SLAM.dustK), 18 + speed * 0.07);
    this.fx.shockwave(pt.clone().setY(fl + 0.1), 0xd8d0c0, Math.min(90, 12 + speed * 0.22));
    this.fx.impact(pt.clone().setY(fl + 0.3), V(0, 1, 0), clamp(speed / 100, 0.6, 3), false);
    this.fx.flash(pt.clone().setY(fl + 1), fire ? 0xff7020 : 0xfff0c0, 120 + speed * 0.4, 0.4);
    this.burst(pt.clone().setY(fl + 0.5), a, 120, 26); this.shakeNear(pt, Math.max(0.7, this.fx.crashShake(cp)));
    this.punchSfx(1, a, b);
    if (!b.ko) { b.vel.set(F.x * 3, 4, F.z * 3); b.rig.body.rotation.set(1.5, 0, 0); this.startRagdoll(b, 2); b.ragdoll.down = SLAM.down; b.ragdoll.slam = true; b.ragdoll.av.multiplyScalar(0.3); }
    a.pos.y = Math.max(a.pos.y, fl + 0.2); a.vel.set(-F.x * 4, 7, -F.z * 4); a.state = 'air'; a.knockT = 0.12;
    if (a === this.player) a.fovKick = (a.fovKick || 0) + 12;
    this.slams = (this.slams || 0) + 1; this.lastSlam = { speed: Math.round(speed), dmg, height: +S.h0.toFixed(1), crater: this.fx.destruction?.lastCrash?.craterR ?? 0, dust: this.fx.destruction?.lastCrash?.dust ?? 0, t: this.t };
  }
  placeSlamVictim(a, b, F, pitch) { // held by the back of the neck in front of / below the fist, face toward the ground
    b.pos.copy(a.pos).addScaledVector(F, 0.85 - 0.25 * Math.min(1, pitch / 2.25)); b.pos.y += 0.35 - 0.75 * Math.min(1, pitch / 2.25);
    b.vel.set(0, 0, 0); b.yaw = a.yaw; b.state = 'air'; b.knockT = 0.2; b.action = null;
  }
  // ---- grab counter (player only) ----
  canCounter(h) {
    if (h !== this.player || h.ko || h.action?.type === 'counter') return false;
    const L = h.legGrabbedBy; if (L) return L.legGrabbing === h && L.action?.type === 'leggrab' && L.action.t < LEG.window; // 1.5 s to react
    const g = h.grabbedBy; return !!g && g.grabbing === h;
  }
  // ---- rival leg grab -> giant swing -> fling (AI only); Y counter = curl up + punch ----
  legGrab(a, v) {
    if (v.grabbedBy) this.releaseGrab(v.grabbedBy); if (v.grabbing) this.releaseGrab(v);
    v.endSuper?.(); v.endSprint?.(); v.action = null; v.ragdoll = null; v.knockT = 0; v.flip = null; v.charge = 0; v.landT = 0;
    a.endSuper?.(); a.endSprint?.(); a.charge = 0;
    const to = V(v.pos.x - a.pos.x, 0, v.pos.z - a.pos.z); const yaw = to.lengthSq() > 1e-4 ? Math.atan2(to.x, to.z) : a.yaw;
    a.yaw = yaw; a.aim.set(Math.sin(yaw), 0, Math.cos(yaw)); a.vel.set(0, 0, 0);
    a.action = { type: 'leggrab', t: 0, dur: LEG.dur, rate: 0, thrown: false, victim: v, y0: a.pos.y };
    a.legGrabbing = v; v.legGrabbedBy = a; v.state = 'air'; v.legAlpha = -Math.PI + 0.9;
    if (a !== this.player) { this.brainOf(a).legCd = LEG.cd; for (const e of this.enemies) if (e !== a) { const b2 = this.brainOf(e); b2.legCd = Math.max(b2.legCd, 3); } } this.lastCombat = this.t;
    this.stats.hits.push({ t: this.t, kind: 'legGrab', amount: 0, target: v.key, attacker: a.key });
    if (v === this.player) this.hud?.say(`${a.def.name} grabbed your leg! Y to counter`);
    whooshSound(a.def.style === 'fire');
  }
  releaseLeg(a) { const v = a.legGrabbing; if (v) { v.legGrabbedBy = null; v.legAlpha = undefined; } a.legGrabbing = null; if (a.action?.type === 'leggrab') a.action = null; }
  legSwingStep(dt, a, v) {
    const act = a.action;
    if (!act || act.type !== 'leggrab' || a.legGrabbing !== v || a.ragdoll || a.ko) { // the grabber got hit / KO'd: drop them
      if (a.legGrabbing === v) a.legGrabbing = null; v.legGrabbedBy = null; v.legAlpha = undefined;
      if (v.action?.type !== 'counter') { v.state = 'air'; v.rig.body.rotation.set(0, 0, 0); if (!v.ragdoll) this.startRagdoll(v, 6); }
      return;
    }
    const curling = v.action?.type === 'counter';
    // spin up into a giant swing (slows hard while the victim is curling up to punch)
    const want = curling ? 0 : LEG.spinMax * THREE.MathUtils.smoothstep(act.t, 0, LEG.spinUp);
    act.rate += (want - act.rate) * Math.min(1, dt * (curling ? 7 : 5));
    a.yaw += act.rate * dt; a.aim.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)); a.vel.set(0, 0, 0);
    if (a.state === 'fly' || a.state === 'air') { a.state = 'fly'; a.pos.y = act.y0; }
    const k = a.def.height / 1.83, R = V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    // victim laid out radially, feet in the grabber's hands: hangs low at first, rises level as the swing speeds up
    const sf = clamp(act.rate / LEG.spinMax, 0, 1), th = 0.9 + (Math.PI / 2 - 0.9) * sf;
    const H = a.pos.clone().addScaledVector(R, LEG.armR * k); H.y += LEG.armH * k;
    const dirB = R.clone().multiplyScalar(Math.sin(th)); dirB.y = -Math.cos(th);
    const hips = H.addScaledVector(dirB, LEG.leg * v.def.height / 1.83);
    v.pos.copy(hips); v.pos.y -= v.hipH * v.def.height / 1.83; v.yaw = a.yaw + Math.PI; v.legAlpha = th - Math.PI;
    v.vel.set(Math.cos(a.yaw), 0, -Math.sin(a.yaw)).multiplyScalar(act.rate * (LEG.armR + LEG.leg));
    if (!curling && !act.thrown && act.t >= LEG.throwAt) this.legThrow(a, v, act); // no counter in time: fling
  }
  // after both poses are evaluated (main.combatFrame): pin the victim's grabbed ankle onto the grabber's palm marker, so the
  // hand visibly holds the leg on every frame of the grab / spin / hang (legSwingStep only places them approximately)
  attachLeg(a) {
    const v = a.legGrabbing, act = a.action, B = a.anim?.B; if (!v || act?.type !== 'leggrab' || !B || !v.anim?.B) return;
    a.rig.root.updateMatrixWorld(true); v.rig.root.updateMatrixWorld(true);
    const k = a.def.height / 1.83;
    if (!a.anim.grip) { // grip points: the middle of the closed hand (a little past the wrist, toward the palm)
      a.anim.grip = {}; for (const sd of ['R', 'L']) { const hb = B('hand.' + sd); if (!hb) continue; const o = new THREE.Object3D(); o.name = 'grip' + sd;
        const n = a.anim.hand?.sides?.[sd]?.palmN; o.position.set(0, 0.075 * k, 0); if (n) o.position.addScaledVector(n, 0.025 * k); hb.add(o); a.anim.grip[sd] = o; }
    }
    if (!act.pin) { // first frame: the grabber's nearer hand + the victim's nearer ankle (foot bone head = ankle)
      let best = null;
      for (const hs of ['R', 'L']) { const gp = a.anim.grip[hs]; if (!gp) continue; const pp = gp.getWorldPosition(V());
        for (const fs of ['L', 'R']) { const f = v.anim.B('foot.' + fs); if (!f) continue; const d = f.getWorldPosition(V()).distanceTo(pp); if (!best || d < best.d) best = { d, side: hs, palm: gp, foot: f }; } }
      if (!best) return; act.pin = best; act.gapMax = 0;
    }
    // reach: 2-bone IK of the grabbing arm straight out in front of its shoulder (slightly down), so the victim is held at arm's length
    const up = B('upper_arm.' + act.pin.side), R = V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    if (up) { const want = up.getWorldPosition(V()).addScaledVector(R, 0.75 * k); want.y -= 0.12 * k; this.armIK(up, B('forearm.' + act.pin.side), act.pin.palm, want); }
    const P = act.pin.palm.getWorldPosition(V()), d = P.sub(act.pin.foot.getWorldPosition(V()));
    act.gap0 = d.length(); // how far off the kinematic placement was (before the pin)
    v.pos.add(d); v.rig.root.position.add(d); v.rig.root.updateMatrixWorld(true);
    act.gap = act.pin.palm.getWorldPosition(V()).distanceTo(act.pin.foot.getWorldPosition(V())); act.gapMax = Math.max(act.gapMax, act.gap);
  }
  // two-bone IK (world space): bend the elbow to the target distance, then swing the upper arm so the end point lands on it
  armIK(up, fore, end, target) {
    if (!up || !fore || !end) return;
    const S = up.getWorldPosition(V()), E = fore.getWorldPosition(V()), W = end.getWorldPosition(V());
    const l1 = S.distanceTo(E), l2 = E.distanceTo(W), dT = clamp(S.distanceTo(target), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.995);
    const rot = (bone, q) => { const pw = bone.parent.getWorldQuaternion(new THREE.Quaternion()), bw = bone.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(pw.invert().multiply(q.multiply(bw))); bone.updateMatrixWorld(true); };
    // elbow: interior angle for distance dT (law of cosines)
    const e1 = S.clone().sub(E).normalize(), e2 = W.clone().sub(E).normalize();
    let n = e1.clone().cross(e2); if (n.lengthSq() < 1e-6) n = V(1, 0, 0); n.normalize();
    const cur = Math.acos(clamp(e1.dot(e2), -1, 1)), des = Math.acos(clamp((l1 * l1 + l2 * l2 - dT * dT) / (2 * l1 * l2), -1, 1));
    rot(fore, new THREE.Quaternion().setFromAxisAngle(n, des - cur)); // +angle about e1 x e2 swings the forearm away from the upper arm (opens the elbow)
    const W2 = end.getWorldPosition(V()), a1 = W2.sub(S).normalize(), a2 = target.clone().sub(S).normalize();
    rot(up, new THREE.Quaternion().setFromUnitVectors(a1, a2));
  }
  legThrow(a, v, act) {
    act.thrown = true; a.legGrabbing = null; v.legGrabbedBy = null; v.legAlpha = undefined;
    const T = V(Math.cos(a.yaw), 0, -Math.sin(a.yaw)), R = V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    const dir = T.multiplyScalar(0.85).addScaledVector(R, 0.35); dir.y = LEG.throwUp; dir.normalize();
    v.vel.copy(dir).multiplyScalar(LEG.throwSpeed / v.def.mass); v.rig.body.rotation.set(0, 0, 0);
    this.damage(v, LEG.throwDmg, a, 'legThrow', { speed: LEG.throwSpeed }); this.startRagdoll(v, 14);
    const p = this.chest(v, V()); this.burst(p, a, 40, 10); this.fx.shockwaveOriented?.(p, dir, 0xfff0d8, 18, 0.45, 0.6); this.shakeNear(p, 0.5);
    whooshSound(a.def.style === 'fire');
  }
  legCounter(v, a) { // Y in time: curl the legs + torso up toward the grabber, then punch them off
    v.action = { type: 'counter', style: 'curl', clip: 'leg_counter_curl_punch', t: 0, dur: LEG.counter.dur, done: false, target: a };
    v.invulnT = Math.max(v.invulnT, LEG.counter.hitAt + 0.6);
    this.fx.flash(this.chest(v, V()), v.def.style === 'fire' ? 0xff7020 : 0xfff0c0, 30, 0.15);
    this.hud?.say('COUNTER! Curl up and punch');
    this.stats.hits.push({ t: this.t, kind: 'counter', amount: 0, target: a.key, attacker: v.key, style: 'curl' });
    whooshSound(v.def.style === 'fire');
  }
  legCounterStep(dt, v, act) {
    const C = LEG.counter, a = act.target;
    if (!act.done && act.t >= C.hitAt) {
      act.done = true;
      const q0 = v.rig.body.quaternion.clone();
      if (a.legGrabbing === v) { a.legGrabbing = null; a.action = null; }
      v.legGrabbedBy = null; v.legAlpha = undefined;
      const hp = this.chest(a, V()), dir = V(a.pos.x - v.pos.x, 0, a.pos.z - v.pos.z); if (dir.lengthSq() < 1e-4) dir.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)); dir.normalize(); dir.y = C.up; dir.normalize();
      this.damage(a, C.dmg, v, 'counterPunch', { speed: C.speed }); this.punchSfx(1, v, a);
      a.vel.copy(dir).multiplyScalar(C.speed / a.def.mass); this.startRagdoll(a, 12);
      v.state = 'air'; v.vel.copy(dir).multiplyScalar(-10); v.vel.y = 9; v.flip = { t: 0, dur: C.flipDur, q0 };
      this.fx.flash(hp, v.def.style === 'fire' ? 0xff7020 : 0xfff0c0, 150, 0.35); this.fx.shockwaveOriented?.(hp, dir, 0xfff2c8, 28, 0.5, 0.8);
      this.burst(hp, v, 110, 24); this.shakeNear(hp, 0.8); if (v === this.player) v.fovKick = (v.fovKick || 0) + 10;
      whooshSound(false);
    }
    if (act.t >= act.dur) v.action = null;
  }
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
        this.damage(tgt, C.dmg, a, 'counterKick', { speed: C.speed }); this.punchSfx(1, a, tgt);
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
        this.damage(tgt, C.dmg, a, 'counterSlam', { speed: C.down }); this.punchSfx(0.9, a, tgt);
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
  grabState(player, enemies) {
    if (!Array.isArray(enemies)) enemies = [enemies];
    for (const [a, role] of [[player, 'attacker'], ...enemies.map(e => [e, 'victim'])]) {
      if (role === 'victim' && a.grabbing !== player) continue;
      const act = a.action; if (act?.type === 'tackle' && act.mode && act.mode !== 'drive' && a.grabbing) return { role, mode: act.mode, left: Math.max(0, CHOKE.hold - act.holdT), max: CHOKE.hold, charge: act.charge || 0 };
    }
    return null;
  }
  // the punch's own direction: the fist's travel (dash / lunge momentum) or the hero's aim (camera pitch / homing), blended
  // with the line to the target's chest. Up, down or level, the victim flies that way; near-level punches stay level
  // so a ground punch skims along the ground instead of popping up.
  punchDir(a, to) {
    const act = a.action, fist = (act?.dashed && a.vel.lengthSq() > 400) ? t5.copy(a.vel).normalize() : t5.copy(a.aim).normalize();
    const dir = fist.multiplyScalar(0.6).addScaledVector(to, 0.4); if (dir.lengthSq() < 1e-6) dir.copy(to);
    dir.normalize(); if (Math.abs(dir.y) < 0.12) { dir.y = 0; dir.normalize(); }
    return dir.clone();
  }
  tryPunch(a, b) {
    const ca = this.chest(a, t1), cb = this.chest(b, t2), to = t3.copy(cb).sub(ca); const d = to.length();
    const reach = 3.2 + a.def.height * 0.3;
    if (b.ko || d > reach) return false;
    if (b.dodgeUntil > this.t && b.invulnT > 0) { if (!a.action?.dodgeLogged) { if (a.action) a.action.dodgeLogged = true; this.stats.hits.push({ t: this.t, kind: 'dodged', amount: 0, target: b.key, attacker: a.key }); } return false; } // dodging: whiff
    to.normalize(); if (to.dot(a.aim) < 0.25 && d > 2.2) return false;
    const rel = t4.copy(a.vel).sub(b.vel).dot(to);
    const act = a.action; // a dash punch: count ~30% of the dash plus the momentum you already had (not the full 170 m/s ram)
    const dbase = act?.dashed ? act.dashPre + DASH.speed * 0.3 : 0; // (lunge hits mid-dash would otherwise count the full 230 m/s)
    const sp = act?.dashed ? clamp(Math.max(rel, dbase - b.vel.dot(to)), 0, dbase + 20) : Math.max(0, rel);
    const L = act?.lunge ? DASH.impact : null, fire = a.def.style === 'fire';
    const dmg = this.damage(b, 9 + 0.24 * sp + (L ? L.dmgBonus : 0), a, 'punch', { speed: sp, lunge: !!L });
    this.punchSfx(L ? 1 : clamp(sp / 160, 0.2, 0.9), a, b);
    const dir = this.punchDir(a, to);
    const cw = a === this.player && this.counterWin > 0 ? DODGE.bonus : 1; // dodge counter window: a little extra knockback
    if (cw > 1) this.stats.hits.push({ t: this.t, kind: 'dodgeCounter', amount: 0, target: b.key, attacker: a.key });
    if (L) this.knockback(b, dir, (L.kb + L.kbSpeed * sp) * cw, 0, true, L.spin); else this.knockback(b, dir, (48 + 0.5 * sp) * cw, 0, true, 10);
    if (dir.y < -0.3) { b.ragdoll.punchedDown = true; this.stats.hits.push({ t: this.t, kind: 'punchDown', amount: 0, vy: b.vel.y, target: b.key, attacker: a.key }); }
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
  // melee impact sound: rotating punch clips (audio.js picks a different one each time, +-6% pitch); logged for tests
  punchSfx(power, a, b) {
    const i = punchSound(power); this.sfxLog = this.sfxLog || []; this.sfxLog.push({ t: +this.t.toFixed(3), clip: i, power: +power.toFixed(2), by: a?.key, on: b?.key });
    if (this.sfxLog.length > 60) this.sfxLog.shift();
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
    if (!act.sfx) act.sfx = (roar ? roarSound() : laserSound()) || { stop() {} }; // roar sample / laser start -> loop -> tail
    a.eyeGlow = Math.min(1, act.t / C.charge);
    const mid = this.beamOrigin(a, V());
    const lock = isP ? this.lockTarget() : null;
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
    // the first villain along the beam takes it (either villain, not only the aimed one)
    let cb = null, hv = null;
    for (const v of (isP ? this.enemies : [b])) {
      if (!v || v.ko || v === a) continue;
      const c = this.chest(v, V()), tc = clamp(t1.copy(c).sub(mid).dot(dir), 0, C.range);
      const hitR = roar ? C.r0 + C.spread * tc + C.body : C.hitR;
      if (tc < len && t3.copy(mid).addScaledVector(dir, tc).distanceTo(c) < hitR) { len = tc; hit = 'enemy'; cb = c; hv = v; }
    }
    if (hv) { if (act.hitHero && act.hitHero !== hv) act.hitT = 0; act.hitHero = hv; b = hv; }
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
    if (release || act.onT >= C.max) this.endEyeBeam(a, act.hitHero || b, act, dir, imp);
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
      if (hit.type === 'enemy') { this.damage(b, 11, a, 'ray'); this.knockback(b, dir, 34, 0, false); this.shakeNear(hit.p, 0.2); }
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
          this.knockback(h, p.vel.clone().normalize(), 36, 0, false);
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
          const hp = V(h.pos.x - n.x * r, h.pos.y + 0.9, h.pos.z - n.z * r);
          if (into > 16) { this.damage(h, 0.3 * into, null, 'wall', { speed: into }); this.fx.impact(hp, n.clone(), clamp(into / 90, 0.3, 1.1), false); }
          if (into > 6 && this.t - (rd.lastCrashT ?? -9) > 0.3) { // dust / debris / crater all scale with the momentum into the wall
            rd.lastCrashT = this.t; const cp = this.fx.crash(hp, n.clone(), mom(into, h), 'wall'); if (cp) this.shakeNear(hp, this.fx.crashShake(cp));
          }
        }
      }
      if (h.pos.y <= floor) {
        h.pos.y = floor; onGround = true;
        if (h.vel.y < -4) {
          const imp = -h.vel.y;
          // punched down into the ground: the ground soaks the hit (crater + a small bounce), it doesn't fling them back up
          h.vel.y = rd.punchedDown ? Math.min(imp * 0.32, 5) : imp * 0.32; rd.punchedDown = false;
          h.vel.x *= 0.75; h.vel.z *= 0.75; rd.av.multiplyScalar(0.6); rd.bounces++;
          // glancing ground hits kick the body into a roll along the slide direction
          const lv = t4.copy(h.vel).applyAxisAngle(t1.set(0, 1, 0), -h.yaw), hs = Math.hypot(lv.x, lv.z);
          if (hs > 3) rd.av.add(t1.set(lv.z, 0, -lv.x).multiplyScalar(0.35 / 0.45)).add(t4.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(2));
          const gs = Math.hypot(imp, Math.hypot(h.vel.x, h.vel.z) * 0.3), cp = this.fx.crash(h.pos.clone(), V(0, 1, 0), mom(gs, h), 'ground'); // continuous with momentum
          if (cp) this.shakeNear(h.pos, this.fx.crashShake(cp));
          if (imp > 30) { this.damage(h, 0.15 * imp, null, 'ground', { speed: imp }); this.fx.shockwave(h.pos, 0xd8d0c0, Math.min(40, imp * 0.3)); }
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
    if (!h.ko && rd.rest > 0.6 && rd.t > (rd.down || 1.0)) { // (face slam: stays down longer)
      if (rd.getUp <= 0) rd.q0 = rd.q.clone();
      rd.getUp += dt / 0.65;
      rd.q.copy(rd.q0).slerp(new THREE.Quaternion(), Math.min(1, rd.getUp * rd.getUp * (3 - 2 * rd.getUp)));
      if (rd.getUp >= 1) {
        h.ragdoll = null; h.state = 'ground'; h.vel.set(0, 0, 0); h.knockT = 0; h.rig.body.rotation.set(0, 0, 0);
        h.landSquash = 0.85; this.fx.dustBurst(h.pos, 15, 5);
      }
    }
  }

  // ---------- AI villains ----------
  // Coordination: only one villain may be tackling / choking / leg-grabbing at a time (and never while the player is already
  // held), attack starts are staggered by VILLAIN_AI.gap, and a 'lead' villain rushes in while the other circles wider on
  // the opposite side, swapping roles every few seconds.
  grabBusy(ai) {
    const P = this.player;
    if (P && (P.grabbedBy || P.legGrabbedBy || P.slammedBy)) return true;
    return this.enemies.some(e => e !== ai && (e.grabbing || e.legGrabbing || e.action?.type === 'tackle' || e.action?.type === 'leggrab'));
  }
  canStartAttack(ai) { return this.wt - this.coord.lastAtk >= VILLAIN_AI.gap; }
  aiStart(ai, type, dir) {
    if (!this.canStartAttack(ai)) return false;
    if (type === 'tackle' && this.grabBusy(ai)) return false;
    const ok = this.start(ai, type, dir);
    if (ok) { this.coord.lastAtk = this.wt; this.coord.starts.push({ t: +this.t.toFixed(3), key: ai.key, type }); if (this.coord.starts.length > 80) this.coord.starts.shift(); }
    return ok;
  }
  // the target is flying / running away from `a` (its velocity points away from a): used for the pursuit tweaks (PURSUIT)
  fleeing(a, v) {
    const sp = v.vel.length(); if (sp < PURSUIT.fleeMin || this.pursuitOff || v.ragdoll || v.knockT > 0 || v.grabbedBy || v.legGrabbedBy || v.slammedBy) return false; // (thrown / knocked back isn't fleeing) // (pursuitOff: tests compare with the old chase)
    const dx = v.pos.x - a.pos.x, dy = v.pos.y - a.pos.y, dz = v.pos.z - a.pos.z, dl = Math.hypot(dx, dy, dz) || 1;
    return (v.vel.x * dx + v.vel.y * dy + v.vel.z * dz) / (sp * dl) > PURSUIT.fleeDot;
  }
  aiInput(dt, ai, player) {
    const B = this.brainOf(ai); B.t += dt;
    const inp = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, jumpReleased: false, boost: 0, descend: 0, cancelPressed: false };
    B.legCd -= dt;
    // roles: one villain leads (rushes), the other supports (circles wide); swap every few seconds or when one is down
    const C = this.coord, alive = this.alive();
    if (ai === this.enemies[0]) { C.leadT -= dt; if (C.leadT <= 0) { C.lead = (C.lead + 1) % Math.max(1, this.enemies.length); C.leadT = VILLAIN_AI.lead0 + Math.random() * (VILLAIN_AI.lead1 - VILLAIN_AI.lead0); } }
    const lead = alive.length < 2 || this.enemies[C.lead] === ai || this.enemies[C.lead]?.ko;
    const c = ai.aiCam;
    if (ai.grabbing || ai.legGrabbing) { c.yawFacing = ai.yaw; return inp; } // holding someone: the choke / swing logic decides
    if (ai.ko || ai.ragdoll || ai.grabbedBy || ai.legGrabbedBy || this.aiOff) return inp;
    const me = this.chest(ai, V()), tgt = this.chest(player, V());
    const to = tgt.clone().sub(me); const d = to.length(); const dir = to.clone().divideScalar(d || 1);
    // pursuit: the player is getting away -> cruise bonus (ramped, not while they super-speed) + steer at the intercept point
    const flee = !player.ko && this.fleeing(ai, player) && !this.aiOff; B.flee = flee;
    ai.chaseMul = (ai.chaseMul || 1) + ((flee && !player.superSpeed ? PURSUIT.bonus : 1) - (ai.chaseMul || 1)) * Math.min(1, dt * 3);
    if (Math.abs(ai.chaseMul - 1) < 1e-3) ai.chaseMul = 1;
    let chase = tgt; // intercept point (where the fleeing player will be when we close the gap)
    if (flee) { const close = Math.max(8, ai.vel.length() - player.vel.dot(dir) * 0.5);
      chase = tgt.clone().addScaledVector(player.vel, Math.min(PURSUIT.leadMax, PURSUIT.lead * d / close)); }
    const flat = V(to.x, 0, to.z); const fd = flat.length(); if (fd > 1e-3) flat.divideScalar(fd); else flat.set(Math.sin(ai.yaw), 0, Math.cos(ai.yaw));
    c.flatForward.copy(flat); c.right.set(-flat.z, 0, flat.x); c.yawFacing = Math.atan2(flat.x, flat.z);
    if (player.ko) { // idle: back off a little and hover/stand
      c.forward.copy(flat); inp.moveY = d < 25 ? -0.5 : 0; return inp;
    }
    // flight decisions: follow the player into the air, land when they land
    const playerAir = player.state !== 'ground' || player.pos.y > 4;
    if (playerAir || fd > 70 || (this.city.heightAt(ai.pos.x + flat.x * 8, ai.pos.z + flat.z * 8) > ai.pos.y + 1 && fd > 12)) B.flyHold = 2.5; else B.flyHold -= dt;
    if (B.flyHold > 0 && ai.state === 'ground' && !ai.action) ai.forceFly();
    if (B.flyHold <= 0 && ai.state === 'fly') { inp.descend = 1; }
    // keep fighting distance: the lead approaches / rushes, the support circles wider on its own side
    B.strafeT -= dt; if (B.strafeT < 0) { B.strafe = (Math.random() < 0.7 ? 1 : -1) * (B.i ? -1 : 1); B.strafeT = 1.5 + Math.random() * 2; }
    B.think -= dt;
    const busy = this.grabBusy(ai);
    const ideal = !lead || busy ? VILLAIN_AI.supportDist : B.mode === 'rush' || flee ? 2.2 : 16; // a fleeing player: the lead closes right in
    let fwd = d > ideal + 4 ? 1 : d < ideal - 4 ? -0.7 : 0;
    let side = (B.mode === 'rush' || flee) && lead ? 0 : B.strafe * (d < 40 ? 0.8 : 0.2);
    // keep apart from the other villain (no stacking on the same spot)
    for (const o of this.enemies) { if (o === ai || o.ko) continue; const sep = t1.copy(ai.pos).sub(o.pos); const sd = sep.length();
      if (sd < VILLAIN_AI.sep && sd > 1e-3) side += clamp(sep.dot(c.right) / sd, -1, 1) * (1 - sd / VILLAIN_AI.sep) * 1.5; }
    side = clamp(side, -1, 1);
    if (ai.state === 'fly') { // 3D steering toward an offset point near the player
      const off = t2.copy(c.right).multiplyScalar(lead ? 0 : (B.i ? -1 : 1) * ideal * 0.6);
      const goal = chase.clone().addScaledVector(dir, -ideal).add(off); goal.y = Math.max(goal.y, playerAir ? tgt.y : 1.5);
      const g = goal.sub(me); const gl = g.length(); c.forward.copy(gl > 1e-3 ? g.divideScalar(gl) : dir);
      fwd = clamp(gl / 6, 0, 1); inp.boost = (flee ? d : gl) > 90 ? 1 : 0; // (the intercept point runs far ahead: boost on the real gap)
      if (B.flyHold <= 0) { inp.descend = 1; fwd *= 0.5; }
    } else { if (flee) { const cf = t2.set(chase.x - me.x, 0, chase.z - me.z); if (cf.lengthSq() > 1e-4) c.forward.copy(cf.normalize()); else c.forward.copy(flat); } else c.forward.copy(flat); inp.boost = d > 30 ? 1 : 0; if (!ai.superSprint && fd > 60 && !ai.action && Math.random() < dt * 0.8) inp.superPressed = true; } // villains super-sprint too
    inp.moveY = fwd; inp.moveX = side;
    // dodge when the player attacks nearby
    const pa = player.action;
    if (pa && pa.t < 0.12 && !B.dodged && d < 35 && ai.cd.dodge <= 0 && Math.random() < 0.45) {
      B.dodged = true; ai.cd.dodge = 2.5; B.dodgeT = B.t;
      const sd = c.right.clone().multiplyScalar(B.strafe * (ai.state === 'fly' ? 45 : 28)); ai.vel.add(sd); if (ai.state === 'ground') { ai.vel.y = 9; ai.state = 'air'; }
      this.fx.dustBurst(ai.pos, 12, 6);
    }
    if (!pa) B.dodged = false;
    // leg grab: close in, the player streaking past, or straight after a dodge (one grabber at a time)
    const pFree = !player.ko && !player.ragdoll && !player.grabbedBy && !player.legGrabbedBy && !player.grabbing && player.action?.type !== 'counter' && !(player.invulnT > 0);
    if (B.legCd <= 0 && pFree && this.canAct(ai) && !this.legOff && !busy && this.canStartAttack(ai)) {
      const pv = player.vel.length(), passing = d < LEG.passRange && pv > LEG.passSpeed && !flee, close = d < LEG.range, afterDodge = B.t - B.dodgeT < 0.8 && d < LEG.passRange;
      const behind = flee && d < PURSUIT.behindR; // catching up from behind: longer reach, better odds
      if (close || passing || afterDodge || behind) {
        const ch = afterDodge ? LEG.dodgeChance : passing ? LEG.passChance : behind ? PURSUIT.behindChance : LEG.chance;
        if (this.forceLegGrab || Math.random() < ch) { this.legGrab(ai, player); C.lastAtk = this.wt; C.starts.push({ t: +this.t.toFixed(3), key: ai.key, type: 'leggrab' }); return inp; }
        B.legCd = 1.2; // missed the roll: try again a bit later
      }
    }
    if (B.think <= 0 && this.canAct(ai) && !player.ragdoll && !(busy && !lead)) {
      B.think = 0.35 + Math.random() * 0.5;
      const r = Math.random();
      if (d < (lead ? 9 : 4.2) && ai.cd.punch <= 0 && !player.grabbedBy && !player.legGrabbedBy) { if (this.aiStart(ai, 'punch', dir)) B.mode = 'circle'; } // (dash punch closes up to 14 m)
      else if (d < 45 && d > 6 && ai.cd.tackle <= 0 && r < (lead ? (flee ? PURSUIT.tackleChance : 0.22) : 0.1)) this.aiStart(ai, 'tackle', dir);
      // (no ranged blast / beams / roar: villains only move, fly, punch and grab)
      else if (r > 0.82) B.mode = B.mode === 'rush' ? 'circle' : 'rush';
    }
    if (B.mode === 'rush' && lead && d < 3.5 && ai.cd.punch <= 0 && this.canAct(ai) && !player.ragdoll && !player.grabbedBy && !player.legGrabbedBy) { if (this.aiStart(ai, 'punch', dir)) B.mode = 'circle'; }
    return inp;
  }

  // respawn helpers
  respawnNear(h, other) {
    const a = Math.random() * Math.PI * 2; const p = other.pos.clone().add(V(Math.cos(a) * 45, 0, Math.sin(a) * 45));
    p.y = Math.max(other.pos.y, this.city.heightAt(p.x, p.z, 2)) + 12;
    this.reset(h, p); h.state = 'fly'; h.vel.set(0, 0, 0);
  }
  reset(h, p) {
    if (h.legGrabbing) this.releaseLeg(h); if (h.legGrabbedBy) this.releaseLeg(h.legGrabbedBy);
    h.endSuper?.(); h.endSprint?.(); h.ko = false; h.hp = h.maxHp; h.ragdoll = null; h.grabbedBy = null; h.grabbing = null; h.action = null; h.knockT = 0; h.landT = 0; h.legAlpha = undefined;
    if (p) h.pos.copy(p); h.vel.set(0, 0, 0); h.rig.body.rotation.set(0, 0, 0); h.state = h.pos.y > 0.5 ? 'air' : 'ground';
  }
  inCombat(player, enemies) {
    if (!Array.isArray(enemies)) enemies = [enemies];
    return this.t - this.lastCombat < 6 || enemies.some(e => !e.ko && player.pos.distanceTo(e.pos) < 90) || player.hp < player.maxHp && this.t - this.lastCombat < 12;
  }
}
