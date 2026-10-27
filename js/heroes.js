import * as THREE from 'three';
// Hero definitions, primitive placeholder models, and traversal physics.
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lam = (c, e) => new THREE.MeshPhongMaterial({ color: c, emissive: e || 0, shininess: 40 });
const GRAV = 32;

function mk(geo, mat, x, y, z, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; }

function buildRig(o) {
  const b = o.bulk; const root = new THREE.Group(); const body = new THREE.Group(); body.position.y = 0.95; root.add(body);
  const r = { root, body, arms: [], legs: [], cape: [], hands: [], feet: [] };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // torso & hips
  mk(box(0.34 * b, 0.22, 0.24 * b), o.mats.hips, 0, 0.05, 0, body);
  r.torso = mk(box(0.46 * b, 0.55, 0.28 * b), o.mats.torso, 0, 0.42, 0, body);
  mk(box(0.3 * b, 0.25, 0.05), o.mats.chest, 0, 0.5, 0.15 * b, body); // chest emblem / plate
  mk(box(0.48 * b, 0.07, 0.3 * b), o.mats.trim, 0, 0.16, 0, body); // belt
  // head
  const head = new THREE.Group(); head.position.y = 0.82; body.add(head); r.head = head;
  mk(new THREE.SphereGeometry(0.13 * Math.sqrt(b), 16, 12), o.mats.head, 0, 0, 0, head);
  mk(new THREE.CylinderGeometry(0.06 * b, 0.08 * b, 0.12, 8), o.mats.head, 0, -0.12, 0, head);
  // shoulders + arms
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * (0.29 * b), 0.62, 0); body.add(sh);
    mk(new THREE.SphereGeometry(0.1 * b, 10, 8), o.mats.shoulder, 0, 0, 0, sh);
    mk(box(0.13 * b, 0.32, 0.13 * b), o.mats.arm, 0, -0.18, 0, sh);
    mk(box(0.14 * b, 0.3, 0.14 * b), o.mats.glove, 0, -0.47, 0, sh);
    mk(box(0.13 * b, 0.12, 0.15 * b), o.mats.glove, 0, -0.66, 0.01, sh);
    const hand = new THREE.Object3D(); hand.position.y = -0.7; sh.add(hand); r.hands.push(hand);
    r.arms.push(sh);
  }
  // legs
  for (const sx of [-1, 1]) {
    const hp = new THREE.Group(); hp.position.set(sx * 0.11 * b, 0, 0); body.add(hp);
    mk(box(0.16 * b, 0.46, 0.18 * b), o.mats.leg, 0, -0.24, 0, hp);
    mk(box(0.15 * b, 0.4, 0.16 * b), o.mats.boot, 0, -0.66, 0, hp);
    mk(box(0.15 * b, 0.08, 0.26 * b), o.mats.boot, 0, -0.9, 0.04, hp);
    const foot = new THREE.Object3D(); foot.position.y = -0.94; hp.add(foot); r.feet.push(foot);
    r.legs.push(hp);
  }
  // cape: chain of segments
  let parent = new THREE.Group(); parent.position.set(0, 0.66, -0.16 * b); body.add(parent); r.capeRoot = parent;
  const segs = 5, segLen = 0.26;
  for (let i = 0; i < segs; i++) {
    const piv = new THREE.Group(); if (i) piv.position.y = -segLen; parent.add(piv);
    const w = (0.5 + i * 0.05) * b;
    mk(box(w, segLen, 0.025), o.mats.cape, 0, -segLen / 2, 0, piv);
    if (o.mats.capeEdge) mk(box(w + 0.02, 0.03, 0.03), o.mats.capeEdge, 0, -segLen, 0, piv);
    r.cape.push(piv); parent = piv;
  }
  return r;
}

function tigerModel() {
  const m = { torso: lam(0x18181a), chest: lam(0xb01818, 0x300000), trim: lam(0xd4a020), hips: lam(0x18181a), head: lam(0xe87a20),
    shoulder: lam(0xd4a020), arm: lam(0xe87a20), glove: lam(0x1a1a1a, 0x401000), leg: lam(0x18181a), boot: lam(0x8a1010),
    cape: lam(0xb01010), capeEdge: lam(0xd4a020) };
  m.cape.side = THREE.DoubleSide;
  const r = buildRig({ bulk: 1.4, mats: m });
  const h = r.head; const white = lam(0xf2e8d8), black = lam(0x111111);
  mk(new THREE.BoxGeometry(0.12, 0.08, 0.1), white, 0, -0.04, 0.14, h); // muzzle
  mk(new THREE.BoxGeometry(0.04, 0.03, 0.03), black, 0, -0.01, 0.2, h); // nose
  for (const sx of [-1, 1]) {
    const ear = mk(new THREE.ConeGeometry(0.05, 0.1, 4), lam(0xe87a20), sx * 0.11, 0.12, -0.02, h); ear.rotation.z = -sx * 0.4;
    mk(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd040 }), sx * 0.055, 0.03, 0.135, h);
    for (let k = 0; k < 3; k++) { const st = mk(new THREE.BoxGeometry(0.012, 0.09, 0.02), black, sx * (0.13 - k * 0.012), 0.04 - k * 0.05, 0.03, h); st.rotation.z = sx * 0.5; }
  }
  // flaming mohawk
  r.flames = [];
  const fm = new THREE.MeshBasicMaterial({ color: 0xff4010 }), fm2 = new THREE.MeshBasicMaterial({ color: 0xffb020 });
  for (let k = 0; k < 6; k++) {
    const f = mk(new THREE.ConeGeometry(0.035, 0.16, 5), k % 2 ? fm2 : fm, 0, 0.14 - Math.abs(k - 2.5) * 0.01, 0.1 - k * 0.045, h);
    f.rotation.x = -0.4; r.flames.push(f);
  }
  // claws
  for (const hand of r.hands) for (let k = -1; k <= 1; k++) { const c = mk(new THREE.ConeGeometry(0.015, 0.08, 4), white, k * 0.045, -0.04, 0.06, hand); c.rotation.x = Math.PI * 0.85; }
  // gold gauntlet bands + red knuckle glow
  for (const a of r.arms) mk(new THREE.BoxGeometry(0.2, 0.05, 0.2), m.trim, 0, -0.34, 0, a);
  return r;
}
function centurionModel() {
  const white = lam(0xf4f4f0), gold = new THREE.MeshPhongMaterial({ color: 0xd8a830, shininess: 90, specular: 0xffe090 });
  const m = { torso: white, chest: gold, trim: gold, hips: white, head: lam(0xe0b090), shoulder: white, arm: white, glove: gold, leg: white, boot: gold,
    cape: lam(0xfafafa), capeEdge: gold };
  m.cape.side = THREE.DoubleSide;
  const r = buildRig({ bulk: 1.05, mats: m });
  const eye = new THREE.MeshBasicMaterial({ color: 0xbfefff });
  for (const sx of [-1, 1]) mk(new THREE.BoxGeometry(0.04, 0.018, 0.02), eye, sx * 0.045, 0.02, 0.122, r.head);
  mk(new THREE.SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), lam(0x3a2a1a), 0, 0.01, -0.01, r.head); // hair
  r.eyeLight = new THREE.PointLight(0x9fe8ff, 0.6, 3); r.eyeLight.position.set(0, 0.02, 0.3); r.head.add(r.eyeLight);
  return r;
}

export const HERO_DEFS = {
  tiger: { name: 'TEMPER TIGER', height: 2.13, build: tigerModel, run: 15, sprint: 26, fly: 55, flyBoost: 125, flyAccel: 1.6, turn: 3,
    capeColor: 0xb01010, style: 'fire' },
  centurion: { name: 'CENTURION', height: 1.83, build: centurionModel, run: 16, sprint: 34, fly: 90, flyBoost: 320, flyAccel: 3.5, turn: 7, style: 'clean' },
};

const lerpAng = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };

export class Hero {
  constructor(key, scene, effects) {
    this.key = key; this.def = HERO_DEFS[key]; this.fx = effects;
    this.rig = this.def.build(); this.rig.root.scale.setScalar(this.def.height / 1.83);
    this.rig.root.rotation.order = 'YXZ'; this.rig.body.rotation.order = 'YXZ';
    scene.add(this.rig.root);
    this.pos = V(0, 0, 0); this.vel = V(); this.state = 'ground'; this.yaw = 0; this.bank = 0; this.flyBlend = 0; this.charge = 0; this.phase = 0; this.t = 0;
    this.heldJump = 0;
    if (this.def.style === 'fire') { this.glow = new THREE.PointLight(0xff6020, 0, 30, 1.5); this.rig.body.add(this.glow); this.glow.position.y = 0.4; }
  }
  setVisible(v) { this.rig.root.visible = v; }
  get speed() { return this.vel.length(); }
  get modeLabel() { return { ground: 'On foot', air: 'Airborne', fly: this.def.style === 'fire' ? 'Fire flight' : 'Flying' }[this.state] + (this.charge > 0 ? ' – charging leap' : ''); }

  update(dt, inp, cam, city) {
    const d = this.def, fire = d.style === 'fire'; this.t += dt;
    const fwd = cam.flatForward, right = cam.right;
    const wish = V().addScaledVector(fwd, inp.moveY).addScaledVector(right, inp.moveX);
    const prevYaw = this.yaw;

    if (this.state === 'ground') {
      const tgt = wish.clone().multiplyScalar(inp.boost > 0.3 ? d.sprint : d.run);
      if (this.charge > 0) tgt.multiplyScalar(0.15);
      this.vel.x += (tgt.x - this.vel.x) * Math.min(1, dt * 10); this.vel.z += (tgt.z - this.vel.z) * Math.min(1, dt * 10);
      this.vel.y = 0;
      if (fire) { // Temper Tiger: hold to charge a huge leap, release to launch
        if (inp.jump) this.charge = Math.min(1, this.charge + dt / 1.1);
        if (inp.jumpReleased && this.charge > 0) this.leap();
      } else if (inp.jumpPressed) { // Centurion: jump; keep holding to take off with force
        this.vel.y = 13; this.state = 'air'; this.heldJump = 0; this.fromJump = true;
      }
    } else {
      if (this.state === 'air') {
        this.vel.y -= GRAV * dt;
        this.vel.x += wish.x * dt * 12; this.vel.z += wish.z * dt * 12; // slight air control
        if (inp.jump && this.fromJump) this.heldJump += dt; else this.fromJump = false;
        if (!fire && this.fromJump && this.heldJump > 0.18) this.takeOff();
        else if (inp.jumpPressed || (fire && inp.jump && !this.fromJump && this.vel.y < 5)) this.startFly();
      } else this.flyUpdate(dt, inp, cam);
      if (inp.cancelPressed && this.state === 'fly') this.state = 'air';
    }

    // integrate with substeps for robust collisions
    const steps = Math.max(1, Math.ceil(this.vel.length() * dt / 0.8));
    let floor = 0;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, dt / steps);
      floor = city.collide(this.pos, this.vel, 0.35 * (fire ? 1.3 : 1));
      if (this.pos.y <= floor) {
        this.pos.y = floor;
        if (this.vel.y < 0) {
          if (this.state === 'air' || (this.state === 'fly' && inp.descend > 0.2)) this.land();
          this.vel.y = 0;
        }
      }
    }
    if (this.state === 'ground' && this.pos.y > floor + 0.4) { this.state = 'air'; this.fromJump = false; }
    if (this.state === 'ground') this.pos.y = floor;

    // facing
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'fly') { if (this.vel.length() > 3) this.yaw = lerpAng(this.yaw, Math.atan2(this.vel.x, this.vel.z), Math.min(1, dt * d.turn)); else this.yaw = lerpAng(this.yaw, cam.yawFacing, dt * 3); }
    else if (hs > 1) this.yaw = lerpAng(this.yaw, Math.atan2(this.vel.x, this.vel.z), Math.min(1, dt * 10));
    const yawRate = (((this.yaw - prevYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) / Math.max(dt, 1e-4);
    this.bank += (THREE.MathUtils.clamp(-yawRate * 0.35, -1.1, 1.1) * (this.state === 'fly' ? 1 : 0) - this.bank) * Math.min(1, dt * 5);
    this.animate(dt, hs);
  }
  leap() {
    const c = this.charge; this.charge = 0;
    const dir = Math.hypot(this.vel.x, this.vel.z) > 0.5 ? V(this.vel.x, 0, this.vel.z).normalize() : V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.vel.y = 14 + 62 * c; this.vel.x = dir.x * (10 + 70 * c); this.vel.z = dir.z * (10 + 70 * c);
    this.state = 'air'; this.fromJump = true; this.heldJump = 0;
    if (c > 0.4) { this.fx.shockwave(this.pos, 0xff7020, 10 + 25 * c); this.fireBurst(this.pos, 80 * c, 14); this.fx.dustBurst(this.pos, 40, 20); }
  }
  takeOff() { // Centurion: forceful launch, dust + shockwave on the ground only, then clean flight
    this.state = 'fly'; this.fromJump = false;
    const nearGround = this.pos.y < 20;
    this.vel.y = 70; this.vel.x *= 0.5; this.vel.z *= 0.5;
    if (nearGround) { const g = this.pos.clone(); g.y -= Math.min(this.pos.y, 3); this.fx.shockwave(g, 0xe8e2d0, 30); this.fx.dustBurst(g, 120, 35); }
  }
  startFly() { this.state = 'fly'; this.fromJump = false; if (this.def.style === 'fire') this.fireBurst(this.pos, 40, 10); }
  land() {
    const impact = -this.vel.y; this.state = 'ground';
    if (impact > 35) { this.fx.shockwave(this.pos, this.def.style === 'fire' ? 0xff7020 : 0xe8e2d0, Math.min(40, impact * 0.5)); this.fx.dustBurst(this.pos, 70, impact * 0.5); }
  }
  fireBurst(p, n, s) {
    const v = V(), c0 = new THREE.Color(0xffd060), c1 = new THREE.Color(0xff2000);
    for (let i = 0; i < n; i++) { v.set((Math.random() - 0.5) * s * 2, Math.random() * s * 0.5, (Math.random() - 0.5) * s * 2); this.fx.fire.emit(p, v, 0.4 + Math.random() * 0.5, c0, c1); }
  }
  flyUpdate(dt, inp, cam) {
    const d = this.def;
    const dir = V().addScaledVector(cam.forward, inp.moveY).addScaledVector(cam.right, inp.moveX);
    dir.y += (inp.jump ? 1 : 0) - inp.descend;
    const len = Math.min(1, dir.length()); if (len > 0) dir.normalize();
    const spd = (d.fly + (d.flyBoost - d.fly) * inp.boost) * len;
    const tgt = dir.multiplyScalar(spd);
    // Centurion: precise, snappy; Tiger: heavier fire propulsion with slight sag
    const a = Math.min(1, dt * d.flyAccel * (len > 0 ? 1 : 0.8));
    this.vel.lerp(tgt, a);
    if (d.style === 'fire' && len === 0) this.vel.y -= 2 * dt;
  }
  animate(dt, hs) {
    const r = this.rig, fly = this.state === 'fly', fire = this.def.style === 'fire', sp = this.vel.length();
    this.flyBlend += ((fly ? Math.min(1, sp / 25) : 0) - this.flyBlend) * Math.min(1, dt * 4);
    const fb = this.flyBlend;
    const climb = fly && sp > 1 ? Math.asin(THREE.MathUtils.clamp(this.vel.y / sp, -1, 1)) : 0;
    r.root.position.copy(this.pos); r.root.rotation.y = this.yaw;
    r.body.rotation.x = fb * (Math.PI / 2 - climb) + (this.charge * 0.5);
    r.body.rotation.z = this.bank;
    r.body.position.y = 0.95 - this.charge * 0.25;
    // limb animation
    this.phase += dt * (hs * 0.9 + 1);
    const run = this.state === 'ground' ? Math.min(1, hs / 8) : 0, sw = Math.sin(this.phase) * run;
    const airPose = this.state === 'air' ? 1 : 0;
    let aL, aR, lL, lR, aZ = 0;
    if (fire) { // tiger flight: arms swept back, palms jetting fire; legs straight jetting
      aL = sw * 1.1 - airPose * 0.6 + fb * 0.35; aR = -sw * 1.1 - airPose * 0.6 + fb * 0.35; aZ = fb * 0.35 + airPose * 0.5;
    } else { // centurion: Man-of-Steel pose – right fist forward, left arm along body
      aL = sw * 0.9 - airPose * 0.3 + fb * 0.1; aR = -sw * 0.9 - airPose * 0.3 - fb * (Math.PI - 0.15); aZ = airPose * 0.2;
    }
    lL = -sw * 1.0 + airPose * 0.5 - this.charge * 0.9; lR = sw * 1.0 - airPose * 0.3 - this.charge * 0.9;
    const L = (o, v) => o.rotation.x += (v - o.rotation.x) * Math.min(1, dt * 12);
    L(r.arms[0], aL); L(r.arms[1], aR); L(r.legs[0], lL * (1 - fb) + fb * 0.05); L(r.legs[1], lR * (1 - fb) - fb * (fire ? 0.05 : 0.25));
    r.arms[0].rotation.z = -aZ; r.arms[1].rotation.z = fire ? aZ : aZ * (1 - fb);
    // cape: trail angle grows with speed relative to body, plus flutter
    const relSpeed = fly ? sp : Math.hypot(hs, this.vel.y);
    const base = fb > 0.5 ? 0.08 + 0.1 / (1 + sp / 30) : Math.min(1.3, 0.15 + relSpeed * 0.05) + Math.max(0, -this.vel.y) * 0.02;
    r.cape.forEach((s, i) => { const fl = Math.sin(this.t * (8 + sp * 0.15) - i * 1.1) * (0.08 + Math.min(0.25, sp * 0.004)) * (i ? 1 : 0.4);
      s.rotation.x += ((i === 0 ? base : (fb > 0.5 ? 0.02 : 0.05 * i)) + fl - s.rotation.x) * Math.min(1, dt * 10); });
    r.head.rotation.x = -fb * 1.1;
    if (fire) this.fireFx(dt, fly);
  }
  fireFx(dt, fly) {
    const r = this.rig, fx = this.fx.fire, w = V(), v = V();
    // mohawk flames flicker + embers
    r.flames.forEach((f, i) => { const s = 0.8 + Math.sin(this.t * 20 + i * 2) * 0.3 + Math.random() * 0.2; f.scale.set(1, s, 1); });
    const yel = new THREE.Color(0xffd060), red = new THREE.Color(0xff2000), wht = new THREE.Color(0xfff0c0);
    if (Math.random() < 0.5) { r.head.localToWorld(w.set(0, 0.2, 0)); fx.emit(w, v.set(0, 3, 0).add(this.vel), 0.25, yel, red); }
    if (this.charge > 0) for (const h of [...r.hands, ...r.feet]) { h.getWorldPosition(w); fx.emit(w, v.set((Math.random() - .5) * 3, 2 + Math.random() * 3, (Math.random() - .5) * 3), 0.35, yel, red); }
    const jet = fly || (this.state === 'air' && this.vel.y > 10);
    this.glow.intensity += ((fly ? 60 : this.charge * 30) - this.glow.intensity) * Math.min(1, dt * 6);
    if (!jet) return;
    // jets from hands and feet, pushed opposite to travel + trail
    const back = this.vel.clone(); const sp = back.length(); if (sp > 1) back.multiplyScalar(-1 / sp); else back.set(0, -1, 0);
    const n = Math.ceil(dt * 260);
    for (const h of [...r.hands, ...r.feet]) for (let i = 0; i < n / 2; i++) {
      h.getWorldPosition(w); w.addScaledVector(this.vel, -Math.random() * dt);
      v.copy(back).multiplyScalar(18 + Math.random() * 12).add(V((Math.random() - .5) * 4, (Math.random() - .5) * 4, (Math.random() - .5) * 4)).addScaledVector(this.vel, 0.6);
      fx.emit(w, v, 0.25 + Math.random() * 0.35, Math.random() < 0.3 ? wht : yel, red);
    }
  }
}
