import * as THREE from 'three';
// Lightweight pooled particle system (fire, dust) + expanding shockwave rings.
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
export class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({ size: additive ? 0.75 : 2.5, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: additive ? 1 : 0.55 });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; scene.add(this.points);
    for (let k = 0; k < max; k++) this.pos[k * 3 + 1] = -9999;
  }
  emit(p, v, life, c0, c1) {
    const k = this.i; this.i = (this.i + 1) % this.max; const o = k * 3;
    this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z; this.vel[o] = v.x; this.vel[o + 1] = v.y; this.vel[o + 2] = v.z;
    this.life[k] = this.maxLife[k] = life; this.c0.set([c0.r, c0.g, c0.b], o); this.c1.set([c1.r, c1.g, c1.b], o);
  }
  update(dt, buoy = 0) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue; const o = k * 3;
      this.life[k] -= dt; const t = 1 - Math.max(0, this.life[k]) / this.maxLife[k];
      this.vel[o] *= 1 - 2.5 * dt; this.vel[o + 1] = this.vel[o + 1] * (1 - 2.5 * dt) + buoy * dt; this.vel[o + 2] *= 1 - 2.5 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const f = (1 - t) * (1 - t);
      for (let a = 0; a < 3; a++) this.col[o + a] = (this.c0[o + a] * (1 - t) + this.c1[o + a] * t) * f;
      if (this.life[k] <= 0) this.pos[o + 1] = -9999;
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
  }
}
export class Effects {
  constructor(scene) {
    this.scene = scene; this.fire = new Particles(scene, 3000, true); this.dust = new Particles(scene, 600, false);
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 48); this.ringGeo.rotateX(-Math.PI / 2);
  }
  shockwave(p, color = 0xffffff, maxR = 25) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(p); m.position.y += 0.3; this.scene.add(m); this.rings.push({ m, t: 0, maxR });
  }
  dustBurst(p, n = 60, speed = 25) {
    const v = new THREE.Vector3(), c0 = new THREE.Color(0xb8b0a0), c1 = new THREE.Color(0x605a50);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      v.set(Math.cos(a) * s, Math.random() * 4, Math.sin(a) * s); this.dust.emit(p, v, 0.8 + Math.random() * 0.8, c0, c1); }
  }
  update(dt) {
    this.fire.update(dt, 6); this.dust.update(dt, 1);
    this.rings = this.rings.filter(r => { r.t += dt / 0.6; const s = 1 + r.t * r.maxR; r.m.scale.set(s, 1, s); r.m.material.opacity = 0.8 * (1 - r.t);
      if (r.t >= 1) { this.scene.remove(r.m); r.m.material.dispose(); return false; } return true; });
  }
}
