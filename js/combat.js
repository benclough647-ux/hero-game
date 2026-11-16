import * as THREE from 'three';
import { whooshSound } from './audio.js';
// Combat: player vs computer-controlled rival (Tiger <-> Centurion), ranged blasts (fire / light ray),
// tackle-grab that can smash the target into buildings, super punch with ragdoll, momentum-based damage,
// procedural ragdoll with building/ground collisions, KO + respawn, and the AI opponent.
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GRAV = 32, CHEST = 1.15;
const t1 = V(), t2 = V(), t3 = V(), t4 = V();
const clamp = THREE.MathUtils.clamp;
// lock-on: range to acquire, distance / KO time that breaks it
export const LOCK = { range: 520, lose: 800, loseT: 1.0, koT: 1.5 };
// punch dash: very fast lunge over a short distance, then the strike lands
export const DASH = { speed: 170, max: 34, free: 14, stop: 2.0, maxT: 0.32, assist: 32 };

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
    h.aim.copy(aim).normalize(); h.action = { type, t: 0, dur: MOVES[type].dur, done: false, target };
    h.cd[type] = MOVES[type].cd;
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
    act.dash = { left: dist, t: 0, speed: DASH.speed, cap: DASH.speed, used: 0, skip: true, pre: Math.max(0, h.vel.dot(h.aim)) }; act.dashed = true; act.dashPre = act.dash.pre;
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
    if (ds.skip) ds.skip = false; else ds.left -= a.vel.length() * dt; // (the start frame hasn't moved yet)
    if (tgt) { // home in; the last step is capped so we arrive exactly at striking distance
      const to = this.chest(tgt, t1).sub(this.chest(a, t2)); const d = to.length(); if (d > 1e-3) a.aim.copy(to.divideScalar(d));
      if (d < DASH.stop + 0.3) ds.left = 0; else ds.cap = (d - DASH.stop) / dt;
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
    player.isPlayer = true; enemy.isPlayer = false;
    for (const h of [player, enemy]) {
      for (const k in h.cd) h.cd[k] = Math.max(0, h.cd[k] - dt);
      // the punch wind-up holds while the dash is still closing the gap, so the fist lands on arrival
      if (h.action) { if (!(h.action.dash && h.action.t >= 0.08)) h.action.t += dt; }
    }
    // player commands (locked on: always aim at / track the enemy)
    if (inp && !player.ko) {
      const fwd = camFwd.clone(), lock = this.lockTarget(enemy);
      const toE = () => this.chest(enemy, V()).sub(this.chest(player, V())).normalize();
      if (inp.blastPressed) this.start(player, 'blast', lock ? toE() : this.aimAt(player, enemy, fwd, 0.8));
      else if (inp.punchPressed) {
        if (lock) this.start(player, 'punch', toE(), enemy);
        else { const a = this.aimAt(player, enemy, fwd, 0.8, DASH.assist); const assist = !enemy.ko && (a.dot(fwd) < 0.9999 || this.chest(enemy, V()).distanceTo(this.chest(player, V())) < 5); this.start(player, 'punch', a, assist ? enemy : null); }
      }
      else if (inp.tacklePressed) this.start(player, 'tackle', lock ? toE() : this.aimAt(player, enemy, fwd, 0.75, 160), lock ? enemy : null);
    }
    for (const [a, b] of [[player, enemy], [enemy, player]]) this.actionStep(dt, a, b);
    this.updateProjectiles(dt, [player, enemy]);
    this.updateBeam(dt);
    for (const h of [player, enemy]) {
      if (h.ragdoll) this.ragdollStep(dt, h);
      if (h.grabbedBy) this.carryStep(h.grabbedBy, h);
    }
  }
  actionStep(dt, a, b) {
    const act = a.action; if (!act) return;
    const m = MOVES[act.type];
    if (act.type === 'blast' && !act.done && act.t >= m.fireAt) { act.done = true; this.fireBlast(a, b); }
    if (act.dash) this.dashStep(dt, a, act);
    if (act.type === 'punch' && !act.done && act.t >= (a.vel.length() > 20 || act.dashed ? 0.05 : m.hitAt)) { // active strike window: a fast flyer can't pass through the target
      if (!act.swung) { act.swung = true; this.burst(this.handPos(a, V()), a, 14, 6); }
      if (this.tryPunch(a, b)) { act.done = true; this.endDash(a, act); if (act.dash === null) a.vel.multiplyScalar(0.3); }
      else if (act.t > 0.34) act.done = true;
    }
    if (act.type === 'tackle') {
      // homing: steer the drive toward a locked target in 3D
      if (!a.grabbing && act.target && !act.target.ko) {
        const to = this.chest(act.target, t1).sub(this.chest(a, t2)).normalize();
        a.aim.lerp(to, 1 - Math.exp(-dt * 9)).normalize();
      }
      if (!a.grabbing && !b.ko && !b.ragdoll) {
        // swept test (at 250+ m/s the attacker moves several metres per frame)
        const cb = this.chest(b, t2), c1 = this.chest(a, t1), rel = t3.copy(a.vel).sub(b.vel).multiplyScalar(dt), L = rel.length();
        const c0 = t4.copy(c1).sub(rel); let d;
        if (L > 1e-4) { const s = clamp(t1.copy(cb).sub(c0).dot(rel) / (L * L), 0, 1); d = c0.addScaledVector(rel, s).distanceTo(cb); } else d = c1.distanceTo(cb);
        if (d < 2.6) this.grab(a, b);
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
    const rel = t1.copy(a.vel).sub(b.vel).length();
    a.grabbing = b; b.grabbedBy = a; b.action = null; b.knockT = 0; b.state = 'air';
    const act = a.action; act.grabT = 0; act.carryDir = a.aim.clone(); if (act.carryDir.y < -0.3) act.carryDir.y = -0.3; act.carryDir.normalize();
    act.carrySpeed = Math.max(a.def.tackleSpeed * 1.25, a.vel.length() * 1.15);
    this.damage(b, 4 + 0.1 * rel, a, 'tackle', { speed: rel });
    this.shakeNear(a.pos, 0.3 + rel / 400); this.fx.flash(this.chest(b, t2), a.def.style === 'fire' ? 0xff7020 : 0xfff0c0, 30, 0.2);
    this.burst(this.chest(b, V()), a, 30, 10);
  }
  carryStep(att, victim) {
    const act = att.action; if (!act) { this.releaseGrab(att); return; }
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
  tryPunch(a, b) {
    const ca = this.chest(a, t1), cb = this.chest(b, t2), to = t3.copy(cb).sub(ca); const d = to.length();
    const reach = 3.2 + a.def.height * 0.3;
    if (b.ko || d > reach) return false;
    to.normalize(); if (to.dot(a.aim) < 0.25 && d > 2.2) return false;
    const rel = t4.copy(a.vel).sub(b.vel).dot(to);
    const act = a.action; // a dash punch: count ~30% of the dash plus the momentum you already had (not the full 170 m/s ram)
    const sp = act?.dashed ? Math.max(0, rel, act.dashPre + DASH.speed * 0.3 - b.vel.dot(to)) : Math.max(0, rel);
    const dmg = this.damage(b, 9 + 0.24 * sp, a, 'punch', { speed: sp });
    const dir = to.clone(); dir.y = Math.max(dir.y, 0);
    this.knockback(b, dir, 48 + 0.5 * sp, 0.3, true, 10);
    const hp = cb.clone().addScaledVector(to, -0.4);
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
      else if (d > 6 && d < 120 && ai.cd.blast <= 0 && r < 0.6) { const jitter = dir.clone().add(V((Math.random() - .5) * 0.06, (Math.random() - .5) * 0.04, (Math.random() - .5) * 0.06)).normalize(); this.start(ai, 'blast', jitter); }
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
