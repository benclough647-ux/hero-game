import * as THREE from 'three';
import { Destruction } from './destruction.js';
// Pooled particle systems (HDR fire for bloom, dust puffs, water spray) + expanding shockwave rings.
function softTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (kind === 'fire') { gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  if (kind !== 'fire') for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(0,0,0,.06)'; g.beginPath(); g.arc(16 + Math.random() * 32, 16 + Math.random() * 32, 4 + Math.random() * 6, 0, 7); g.fill(); }
  return new THREE.CanvasTexture(c);
}
export class Particles {
  constructor(scene, max, opts) {
    this.max = max; this.i = 0; this.drag = opts.drag ?? 2.5; this.fadeColor = opts.additive;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({ size: opts.size, map: softTexture(opts.additive ? 'fire' : 'smoke'), vertexColors: true, transparent: true, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: opts.opacity ?? 1 });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; scene.add(this.points);
    for (let k = 0; k < max; k++) this.pos[k * 3 + 1] = -9999;
  }
  emit(p, v, life, c0, c1) {
    const k = this.i; this.i = (this.i + 1) % this.max; const o = k * 3;
    this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z; this.vel[o] = v.x; this.vel[o + 1] = v.y; this.vel[o + 2] = v.z;
    this.life[k] = this.maxLife[k] = life; this.c0.set([c0.r, c0.g, c0.b], o); this.c1.set([c1.r, c1.g, c1.b], o);
  }
  update(dt, accY = 0) {
    const dr = 1 - this.drag * dt;
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue; const o = k * 3;
      this.life[k] -= dt; const t = 1 - Math.max(0, this.life[k]) / this.maxLife[k];
      this.vel[o] *= dr; this.vel[o + 1] = this.vel[o + 1] * dr + accY * dt; this.vel[o + 2] *= dr;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const f = this.fadeColor ? (1 - t) * (1 - t) : Math.min(1, (1 - t) * 1.6);
      for (let a = 0; a < 3; a++) this.col[o + a] = (this.c0[o + a] * (1 - t) + this.c1[o + a] * t) * f;
      if (this.life[k] <= 0) this.pos[o + 1] = -9999;
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
  }
}
function crackTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(0.45, 'rgba(10,8,6,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(0,0,0,.95)'; g.lineCap = 'round';
  for (let k = 0; k < 11; k++) { let x = 64, y = 64, a = k / 11 * Math.PI * 2 + Math.random() * 0.4; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { a += (Math.random() - 0.5) * 0.9; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); g.lineWidth = Math.max(0.6, 3 - s * 0.5); } g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const V = new THREE.Vector3(), P = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
// vapour-cone texture: bright, streaky rim fading towards the apex (cone uv.y: 0 = rim, 1 = apex)
function vaporTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  for (let x = 0; x < 256; x++) { const n = 0.55 + 0.45 * Math.random();
    const gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, `rgba(255,255,255,${0.95 * n})`); gr.addColorStop(0.25, `rgba(255,255,255,${0.55 * n})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, 0, 1, 128); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
}
// speed streaks: thin additive lines flowing past the hero while in super speed
class Streaks {
  constructor(scene, n = 110) {
    this.n = n; this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 6); this.s = []; this.k = 0;
    for (let i = 0; i < n; i++) this.s.push(this.spawn({}, true));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lines.frustumCulled = false; this.lines.visible = false; scene.add(this.lines);
    this.u = new THREE.Vector3(); this.w = new THREE.Vector3(); this.d = new THREE.Vector3(); this.a = new THREE.Vector3(); this.c = new THREE.Color();
  }
  spawn(o, any) { o.th = Math.random() * Math.PI * 2; o.r = 2.2 + Math.random() * 9; o.z = any ? (Math.random() * 2 - 1) * 45 : 45; o.b = 0.4 + Math.random() * 0.6; return o; }
  update(dt, center, vel, target, tint) {
    this.k += (target - this.k) * Math.min(1, dt * 4);
    if (this.k < 0.01) { this.lines.visible = false; return; }
    this.lines.visible = true;
    const sp = vel.length(); this.d.copy(vel).divideScalar(sp || 1); if (sp < 1) this.d.set(0, 0, 1);
    this.u.crossVectors(this.d, Math.abs(this.d.y) > 0.9 ? V.set(1, 0, 0) : UP).normalize(); this.w.crossVectors(this.d, this.u);
    const len = 4 + Math.min(14, sp * 0.015), flow = 120 + sp * 0.25;
    for (let i = 0; i < this.n; i++) {
      const s = this.s[i]; s.z -= flow * dt; if (s.z < -45) this.spawn(s, false);
      this.a.copy(center).addScaledVector(this.d, s.z).addScaledVector(this.u, Math.cos(s.th) * s.r).addScaledVector(this.w, Math.sin(s.th) * s.r);
      const o = i * 6; this.pos[o] = this.a.x; this.pos[o + 1] = this.a.y; this.pos[o + 2] = this.a.z;
      this.pos[o + 3] = this.a.x - this.d.x * len; this.pos[o + 4] = this.a.y - this.d.y * len; this.pos[o + 5] = this.a.z - this.d.z * len;
      const fade = this.k * s.b * 0.55 * Math.min(1, (45 - Math.abs(s.z)) / 12);
      this.col[o] = tint.r * fade; this.col[o + 1] = tint.g * fade; this.col[o + 2] = tint.b * fade; this.col[o + 3] = this.col[o + 4] = this.col[o + 5] = 0;
    }
    this.lines.geometry.attributes.position.needsUpdate = true; this.lines.geometry.attributes.color.needsUpdate = true;
  }
}
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.fire = new Particles(scene, 3500, { additive: true, size: 0.45 });
    this.dust = new Particles(scene, 900, { size: 3.2, opacity: 0.6, drag: 2.2 });
    this.spray = new Particles(scene, 2500, { size: 1.5, opacity: 0.75, drag: 0.9 });
    this.debris = new Particles(scene, 700, { size: 0.9, opacity: 1, drag: 0.4 });
    this.spark = new Particles(scene, 900, { additive: true, size: 0.7, drag: 3 });
    // one shared combat light (pre-created so no shader recompiles mid-fight)
    this.light = new THREE.PointLight(0xffc070, 0, 60, 1.6); scene.add(this.light); this.lightT = 0;
    // pooled crack/scorch decals for cosmetic building damage
    this.decalTex = crackTexture(); this.decals = []; this.decalI = 0;
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 18; i++) { const m = new THREE.Mesh(this.decalGeo, new THREE.MeshStandardMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1, color: 0x222222 }));
      m.visible = false; m.renderOrder = 2; scene.add(m); this.decals.push(m); }
    this.rings = []; this.ringGeo = new THREE.RingGeometry(0.8, 1, 64); this.ringGeo.rotateX(-Math.PI / 2);
    this.booms = []; this.vaporTex = vaporTexture();
    this.coneGeo = new THREE.ConeGeometry(1, 1, 48, 1, true); this.coneGeo.translate(0, -0.5, 0); // apex at origin, opening towards -Y
    this.streaks = new Streaks(scene); this.streakTint = new THREE.Color(1.4, 1.5, 1.7);
    this.destruction = new Destruction(scene);
    this.cSpray0 = new THREE.Color(1.6, 1.7, 1.8); this.cSpray1 = new THREE.Color(0.75, 0.82, 0.88);
  }
  shockwave(p, color = 0xffffff, maxR = 25) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(p); m.position.y += 0.3; this.scene.add(m); this.rings.push({ m, t: 0, maxR });
  }
  // ring expanding in the plane perpendicular to dir
  shockwaveOriented(p, dir, color = 0xffffff, maxR = 40, dur = 0.6, opacity = 0.75) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(p); m.quaternion.setFromUnitVectors(UP, dir); this.scene.add(m); this.rings.push({ m, t: 0, maxR, dur, op: opacity });
  }
  // Sonic boom: vapour cone around the hero, perpendicular shock rings, radial vapour (and fire for Tiger), flash
  sonicBoom(pos, dir, { fire = false, follow = null } = {}) {
    const d = dir.clone().normalize();
    const mat = new THREE.MeshBasicMaterial({ map: this.vaporTex, color: fire ? 0xff9a58 : 0xffffff, transparent: true, opacity: fire ? 0.7 : 0.85, side: THREE.DoubleSide, depthWrite: false });
    const cone = new THREE.Mesh(this.coneGeo, mat); cone.frustumCulled = false;
    cone.quaternion.setFromUnitVectors(V.set(0, -1, 0), d.clone().negate()); // apex leads, rim trails behind
    cone.position.copy(pos); this.scene.add(cone);
    this.booms.push({ m: cone, t: 0, dur: 0.75, d, follow, off: 2.2 });
    if (fire) { const fm = new THREE.MeshBasicMaterial({ map: this.vaporTex, color: new THREE.Color(2.6, 0.75, 0.1), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const fc = new THREE.Mesh(this.coneGeo, fm); fc.frustumCulled = false; fc.quaternion.copy(cone.quaternion); fc.position.copy(pos); this.scene.add(fc);
      this.booms.push({ m: fc, t: 0, dur: 0.6, d, follow, off: 1.4, k: 0.8 }); }
    this.shockwaveOriented(pos, d, fire ? 0xffb070 : 0xffffff, 70, 0.7, 0.8);
    this.shockwaveOriented(P.copy(pos).addScaledVector(d, -6), d, 0xdfe8f0, 40, 0.9, 0.45);
    const u = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize(), w = new THREE.Vector3().crossVectors(d, u);
    const c0 = new THREE.Color(0xf4f8ff), c1 = new THREE.Color(0xaab4c0), f0 = new THREE.Color(5, 2.6, 0.6), f1 = new THREE.Color(2.2, 0.3, 0.03);
    for (let i = 0; i < 160; i++) { const a = Math.random() * Math.PI * 2, s = 35 + Math.random() * 55;
      V.copy(u).multiplyScalar(Math.cos(a) * s).addScaledVector(w, Math.sin(a) * s).addScaledVector(d, -Math.random() * 25);
      P.copy(pos).addScaledVector(u, Math.cos(a) * 2).addScaledVector(w, Math.sin(a) * 2);
      this.dust.emit(P, V, 0.5 + Math.random() * 0.6, c0, c1);
      if (fire) this.fire.emit(P, V.multiplyScalar(0.8), 0.35 + Math.random() * 0.4, f0, f1);
      else if (i % 2) this.spark.emit(P, V.multiplyScalar(0.7), 0.2 + Math.random() * 0.2, c0, c1); }
    this.flash(pos, fire ? 0xff8030 : 0xdde8ff, 90, 0.4);
  }
  // Tiger's super-speed ignition: expanding fireball, fire rings, flying embers, smoke and a big flash
  fireExplosion(pos, dir, follow = null) {
    const d = dir.clone().normalize();
    if (!this.fbGeo) this.fbGeo = new THREE.SphereGeometry(1, 24, 16);
    for (const [col, dur, R, op] of [[new THREE.Color(2.4, 0.62, 0.07), 0.55, 9, 0.85], [new THREE.Color(1.5, 0.22, 0.02), 0.85, 14, 0.55]]) {
      const m = new THREE.Mesh(this.fbGeo, new THREE.MeshBasicMaterial({ map: this.vaporTex, color: col, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.position.copy(pos); m.frustumCulled = false; this.scene.add(m); this.fireballs = this.fireballs || []; this.fireballs.push({ m, t: 0, dur, R, op, follow, off: pos.clone().sub(follow || pos) });
    }
    this.shockwaveOriented(pos, d, 0xff7a20, 85, 0.8, 0.9);
    this.shockwaveOriented(P.copy(pos).addScaledVector(d, -3), d, 0xffc040, 55, 0.6, 0.8);
    this.shockwave(P.copy(pos).setY(pos.y - 1.1), 0xff6010, 45);
    const f0 = new THREE.Color(3.2, 1.1, 0.15), f1 = new THREE.Color(1.6, 0.16, 0.02), e0 = new THREE.Color(4, 1.3, 0.2), e1 = new THREE.Color(1.2, 0.12, 0.01), s0 = new THREE.Color(0x4a3a30), s1 = new THREE.Color(0x201a16);
    for (let i = 0; i < 700; i++) { // fireball body
      V.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(20 + Math.random() * 45);
      this.fire.emit(pos, V, 0.35 + Math.random() * 0.5, f0, f1); }
    for (let i = 0; i < 260; i++) { // embers flung far, with long life
      V.set(Math.random() * 2 - 1, Math.random() * 1.6 - 0.4, Math.random() * 2 - 1).normalize().multiplyScalar(60 + Math.random() * 90).addScaledVector(d, -20);
      this.spark.emit(pos, V, 0.6 + Math.random() * 0.9, e0, e1); }
    for (let i = 0; i < 70; i++) { V.set(Math.random() * 2 - 1, Math.random() * 1.2, Math.random() * 2 - 1).normalize().multiplyScalar(10 + Math.random() * 18); this.dust.emit(pos, V, 1.2 + Math.random() * 1.2, s0, s1); }
    this.flash(pos, 0xff5a10, 140, 0.6);
  }
  speedLines(dt, center, vel, on, fire) { this.streakTint.setRGB(fire ? 1.8 : 1.4, fire ? 1.1 : 1.5, fire ? 0.6 : 1.7); this.streaks.update(dt, center, vel, on ? 1 : 0, this.streakTint); }
  dustBurst(p, n = 60, speed = 25) {
    const c0 = new THREE.Color(0xc8bfae), c1 = new THREE.Color(0x77706a);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      V.set(Math.cos(a) * s, 0.5 + Math.random() * 3, Math.sin(a) * s); P.copy(p); P.y += 0.3; this.dust.emit(P, V, 0.9 + Math.random() * 1.1, c0, c1); }
  }
  // rooster-tail spray behind a hero skimming the water surface
  waterSpray(pos, vel, alt, waterY, dt) {
    const hs = Math.hypot(vel.x, vel.z); if (hs < 20 || alt > 14) return;
    const k = (1 - alt / 14) * Math.min(1, hs / 120); const n = Math.ceil(dt * 900 * k);
    const bx = -vel.x / hs, bz = -vel.z / hs;
    for (let i = 0; i < n; i++) {
      P.set(pos.x + bx * (1 + Math.random() * 3) + (Math.random() - 0.5) * 1.5, waterY + 0.2, pos.z + bz * (1 + Math.random() * 3) + (Math.random() - 0.5) * 1.5);
      const up = (6 + Math.random() * 16) * (0.4 + k), side = (Math.random() - 0.5) * 10 * k;
      V.set(vel.x * 0.25 + bz * side, up, vel.z * 0.25 - bx * side);
      this.spray.emit(P, V, 0.7 + Math.random() * 0.9, this.cSpray0, this.cSpray1);
    }
  }
  // building hit: crack decal on the wall face, chunks of concrete, dust and sparks
  impact(p, normal, power = 1, scorch = false) {
    const m = this.decals[this.decalI]; this.decalI = (this.decalI + 1) % this.decals.length;
    m.visible = true; m.position.copy(p).addScaledVector(normal, 0.06); m.lookAt(P.copy(m.position).add(normal));
    m.rotateZ(Math.random() * 6.28); const sc = (scorch ? 3 : 4) + 6 * Math.min(1, power); m.scale.set(sc, sc, 1);
    m.material.color.setHex(scorch ? 0x111111 : 0x2a2a2a);
    const c0 = new THREE.Color(0x9a958c), c1 = new THREE.Color(0x5a5650), n = Math.round(30 + 90 * Math.min(1, power));
    for (let i = 0; i < n; i++) { V.copy(normal).multiplyScalar(6 + Math.random() * 22 * power).add(P.set((Math.random() - 0.5) * 16, Math.random() * 12, (Math.random() - 0.5) * 16));
      this.debris.emit(p, V, 1.2 + Math.random() * 1.2, c0, c1); }
    const s0 = new THREE.Color(5, 3.6, 1.4), s1 = new THREE.Color(2, 0.5, 0.1);
    for (let i = 0; i < n * 0.6; i++) { V.copy(normal).multiplyScalar(5 + Math.random() * 25).add(P.set((Math.random() - 0.5) * 30, (Math.random() - 0.3) * 20, (Math.random() - 0.5) * 30)); this.spark.emit(p, V, 0.25 + Math.random() * 0.35, s0, s1); }
    const d = new THREE.Color(0xc8bfae), d1 = new THREE.Color(0x77706a);
    for (let i = 0; i < 8 + 18 * power; i++) { V.copy(normal).multiplyScalar(3 + Math.random() * 10).add(P.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12)); this.dust.emit(p, V, 1 + Math.random() * 1.5, d, d1); }
    this.flash(p, 0xffb060, 40 * power + 20, 0.35);
  }
  // crash into a wall/ground at speed: lingering dust plume, debris chunks, persistent crater
  crash(p, normal, speed, kind = 'wall') { return this.destruction.crash(p, normal, speed, kind); } // -> impact power (0 = nothing)
  crashShake(pw) { return this.destruction.crashShake(pw); }
  flash(p, color, intensity, dur = 0.25) { this.light.position.copy(p); this.light.color.setHex(color); this.light.intensity = Math.max(this.light.intensity, intensity * 8); this.lightT = dur; this.lightDur = dur; }
  update(dt) {
    this.debris.update(dt, -30); this.spark.update(dt, -12); this.destruction.update(dt);
    if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; else this.light.intensity *= Math.exp(-dt * 5 / this.lightDur); }
    this.fire.update(dt, 6); this.dust.update(dt, 0.8); this.spray.update(dt, -26);
    this.booms = this.booms.filter(b => { b.t += dt / b.dur; const e = 1 - Math.pow(1 - Math.min(1, b.t), 3), k = b.k || 1;
      if (b.follow && b.t < 0.45) b.m.position.copy(b.follow).addScaledVector(b.d, b.off);
      const r = (1.2 + 5.5 * e) * k, l = (3 + 18 * e) * k; b.m.scale.set(r, l, r); let op = 0.6 * Math.pow(1 - Math.min(1, b.t), 1.5);
      if (this.viewer) { // camera inside the cone (chase view): thin it out so it doesn't white out the screen
        const rel = P.subVectors(this.viewer.position, b.m.position), along = -rel.dot(b.d), radial = rel.addScaledVector(b.d, along).length();
        if (along > 0 && along < l && radial < r * along / l + 1) op *= 0.3; }
      b.m.material.opacity = op;
      if (b.t >= 1) { this.scene.remove(b.m); b.m.material.dispose(); return false; } return true; });
    if (this.fireballs) this.fireballs = this.fireballs.filter(b => { b.t += dt / b.dur; const e = 1 - Math.pow(1 - Math.min(1, b.t), 3);
      if (b.follow && b.t < 0.3) b.m.position.copy(b.follow).add(b.off);
      b.m.scale.setScalar(1 + b.R * e); b.m.material.opacity = b.op * Math.pow(1 - Math.min(1, b.t), 1.6);
      if (b.t >= 1) { this.scene.remove(b.m); b.m.material.dispose(); return false; } return true; });
    this.rings = this.rings.filter(r => { r.t += dt / (r.dur || 0.6); const s = 1 + r.t * r.maxR; r.m.scale.set(s, 1, s); r.m.material.opacity = (r.op || 0.6) * (1 - r.t);
      if (r.t >= 1) { this.scene.remove(r.m); r.m.material.dispose(); return false; } return true; });
  }
}
