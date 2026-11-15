import * as THREE from 'three';
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
const V = new THREE.Vector3(), P = new THREE.Vector3();
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
    this.cSpray0 = new THREE.Color(1.6, 1.7, 1.8); this.cSpray1 = new THREE.Color(0.75, 0.82, 0.88);
  }
  shockwave(p, color = 0xffffff, maxR = 25) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(p); m.position.y += 0.3; this.scene.add(m); this.rings.push({ m, t: 0, maxR });
  }
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
  flash(p, color, intensity, dur = 0.25) { this.light.position.copy(p); this.light.color.setHex(color); this.light.intensity = Math.max(this.light.intensity, intensity * 8); this.lightT = dur; this.lightDur = dur; }
  update(dt) {
    this.debris.update(dt, -30); this.spark.update(dt, -12);
    if (this.lightT > 0) { this.lightT -= dt; if (this.lightT <= 0) this.light.intensity = 0; else this.light.intensity *= Math.exp(-dt * 5 / this.lightDur); }
    this.fire.update(dt, 6); this.dust.update(dt, 0.8); this.spray.update(dt, -26);
    this.rings = this.rings.filter(r => { r.t += dt / 0.6; const s = 1 + r.t * r.maxR; r.m.scale.set(s, 1, s); r.m.material.opacity = 0.6 * (1 - r.t);
      if (r.t >= 1) { this.scene.remove(r.m); r.m.material.dispose(); return false; } return true; });
  }
}
