import * as THREE from 'three';
// Destructible-environment dressing: billowing dust plumes, physical debris chunks and persistent craters
// (building-face dents and ground craters with rubble). Everything is pooled (no allocations / shader compiles
// mid-fight); counts scale down on the Low quality preset.
const V = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), M = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

// ---- big soft dust plume: per-particle size + alpha (PointsMaterial can't grow particles) ----
class Plume {
  constructor(scene, max) {
    this.max = max; this.i = 0; this.live = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.seed = new Float32Array(max);
    for (let k = 0; k < max; k++) this.pos[k * 3 + 1] = -9999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    for (let n = 0; n < 9; n++) { // lumpy cauliflower puff
      const cx = 64 + (Math.random() - 0.5) * 40, cy = 64 + (Math.random() - 0.5) * 40, r = 26 + Math.random() * 22;
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    }
    const mask = x.createRadialGradient(64, 64, 30, 64, 64, 64); mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalCompositeOperation = 'destination-in'; x.fillStyle = mask; x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying float vA; varying vec3 vC; uniform float scale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = min(900.0, size * scale / max(0.5, -mv.z)); }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); float a = t.a * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC * (0.55 + 0.6 * t.r) * (0.8 + 0.25 * gl_PointCoord.y), a); }`,
      vertexColors: true, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 4; scene.add(this.points);
  }
  emit(p, v, life, s0, s1, shade) {
    const k = this.i; this.i = (this.i + 1) % this.max; const o = k * 3;
    this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z; this.vel[o] = v.x; this.vel[o + 1] = v.y; this.vel[o + 2] = v.z;
    this.life[k] = this.maxLife[k] = life; this.s0[k] = s0; this.s1[k] = s1; this.seed[k] = Math.random() * 100;
    this.col[o] = 0.62 * shade; this.col[o + 1] = 0.57 * shade; this.col[o + 2] = 0.5 * shade;
  }
  update(dt, t) {
    let live = 0;
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue; live++;
      const o = k * 3; this.life[k] -= dt; const a = 1 - Math.max(0, this.life[k]) / this.maxLife[k];
      const dr = Math.exp(-dt * (a < 0.1 ? 3.5 : 0.9)), sd = this.seed[k];
      this.vel[o] = this.vel[o] * dr + Math.sin(t * 0.7 + sd) * 0.6 * dt;
      this.vel[o + 1] = this.vel[o + 1] * dr + (1.3 + 0.4 * Math.sin(sd)) * dt; // warm dust rises
      this.vel[o + 2] = this.vel[o + 2] * dr + Math.cos(t * 0.6 + sd) * 0.6 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[k] = this.s0[k] + (this.s1[k] - this.s0[k]) * (1 - Math.pow(1 - a, 2.2)); // billow outwards
      this.alpha[k] = Math.min(1, a * 14) * Math.pow(1 - a, 1.3) * 0.55;
      if (this.life[k] <= 0) { this.pos[o + 1] = -9999; this.alpha[k] = 0; }
    }
    this.live = live;
    const at = this.points.geometry.attributes; at.position.needsUpdate = at.size.needsUpdate = at.alpha.needsUpdate = at.color.needsUpdate = true;
  }
}

function craterTexture(ground) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const R = 128;
  // broken-in recess: dark core, shaded inner wall (lit from above-left), chipped bright rim, soot halo
  let gr = g.createRadialGradient(R, R, 10, R, R, 126); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(25,22,18,.55)'); gr.addColorStop(0.8, 'rgba(30,26,22,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.save(); g.beginPath();
  for (let i = 0; i <= 28; i++) { const a = i / 28 * Math.PI * 2, r = 66 + (Math.random() - 0.5) * 22; g.lineTo(R + Math.cos(a) * r, R + Math.sin(a) * r); }
  g.closePath(); g.clip();
  gr = g.createRadialGradient(R - 14, R - 18, 4, R, R, 72); gr.addColorStop(0, ground ? 'rgba(18,15,12,.97)' : 'rgba(10,9,8,.97)'); gr.addColorStop(0.6, 'rgba(45,40,34,.95)'); gr.addColorStop(1, 'rgba(95,88,78,.95)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) { const v = 40 + Math.random() * 90 | 0; g.fillStyle = `rgba(${v},${v - 4},${v - 10},.8)`; const a = Math.random() * 6.28, r = Math.random() * 64; g.beginPath(); g.arc(R + Math.cos(a) * r, R + Math.sin(a) * r, 2 + Math.random() * 6, 0, 7); g.fill(); }
  g.restore();
  g.strokeStyle = 'rgba(200,192,178,.6)'; g.lineWidth = 3; g.beginPath(); // chipped rim highlight
  for (let i = 0; i <= 28; i++) { const a = i / 28 * Math.PI * 2, r = 68 + (Math.random() - 0.5) * 16; g.lineTo(R + Math.cos(a) * r, R + Math.sin(a) * r); } g.stroke();
  g.strokeStyle = 'rgba(8,6,5,.95)'; g.lineCap = 'round'; // radiating cracks
  for (let k = 0; k < 14; k++) { let x = R, y = R, a = k / 14 * Math.PI * 2 + Math.random() * 0.3; g.beginPath(); g.moveTo(x + Math.cos(a) * 60, y + Math.sin(a) * 60); x += Math.cos(a) * 60; y += Math.sin(a) * 60;
    for (let s = 0; s < 7; s++) { a += (Math.random() - 0.5) * 0.8; x += Math.cos(a) * 8; y += Math.sin(a) * 8; g.lineWidth = Math.max(0.7, 3.2 - s * 0.4); g.lineTo(x, y); } g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const RUBBLE_PER = 14;
// momentum -> impact scaling (speed in m/s; pw = speed / 100, capped). Thresholds: dust from a light bump, debris from a
// real hit, a crater from a hard one; caps bound the particle / debris / crater budgets.
export const CRASH = { dustMin: 6, debrisMin: 16, craterMin: 28, pwMax: 6, dustK: 90, dustCap: 380, debrisK: 22, debrisCap: 70, craterCap: 14, lifeCap: 14 };
export class Destruction {
  constructor(scene) {
    this.scene = scene; this.t = 0; this.cityRef = null; this.lowQ = false;
    this.plume = new Plume(scene, 700);
    // flying debris chunks (instanced, physical)
    const rock = new THREE.DodecahedronGeometry(0.5, 0); rock.scale(1, 0.7, 0.85);
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x8c877e, roughness: 0.95, flatShading: true });
    this.debMax = 220; this.deb = new THREE.InstancedMesh(rock, this.rockMat, this.debMax); this.deb.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.deb.castShadow = true; this.deb.frustumCulled = false; scene.add(this.deb); this.debI = 0;
    this.d = Array.from({ length: this.debMax }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: 1, rest: false }));
    M.makeScale(0, 0, 0); for (let i = 0; i < this.debMax; i++) this.deb.setMatrixAt(i, M);
    // persistent craters
    this.cap = 24; this.craters = []; this.cI = 0;
    this.wallTex = craterTexture(false); this.groundTex = craterTexture(true);
    const plane = new THREE.PlaneGeometry(1, 1);
    const prof = [[0.45, -0.02], [0.62, 0.05], [0.78, 0.2], [0.9, 0.22], [1.05, 0.1], [1.25, 0.0]].map(([x, y]) => new THREE.Vector2(x, y));
    const rimGeo = new THREE.LatheGeometry(prof, 28); this.rimMat = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 1, flatShading: true });
    for (let i = 0; i < this.cap; i++) {
      const decal = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ map: this.wallTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, roughness: 1 }));
      decal.visible = false; decal.renderOrder = 2; scene.add(decal);
      const rim = new THREE.Mesh(rimGeo, this.rimMat); rim.visible = false; rim.receiveShadow = true; scene.add(rim);
      this.craters.push({ decal, rim, used: false, p: new THREE.Vector3(), r: 0, t: -99 });
    }
    this.rub = new THREE.InstancedMesh(rock, this.rockMat, this.cap * RUBBLE_PER); this.rub.frustumCulled = false; this.rub.receiveShadow = true;
    for (let i = 0; i < this.cap * RUBBLE_PER; i++) this.rub.setMatrixAt(i, M); scene.add(this.rub);
  }
  setQuality(preset) { this.lowQ = preset?.name === 'Low'; }
  get mult() { return this.lowQ ? 0.4 : 1; }
  get crateredCount() { return this.craters.filter(c => c.used).length; }

  // main entry: a hero slammed into a wall (normal = face normal) or the ground (normal = up) at `speed` m/s
  // Every impact (ragdoll into a wall / the ground, slams, landings, lunges) comes through here. All of it scales
  // CONTINUOUSLY with the impact momentum (speed, heavier heroes pre-scaled by the caller): a bump puffs a little dust,
  // a sonic-speed hit throws a huge, long-lived plume, a shower of debris and a deep crater. Caps keep it affordable.
  crash(p, normal, speed, kind = 'wall') {
    if (!(speed >= CRASH.dustMin)) return 0;
    const pw = Math.min(CRASH.pwMax, speed / 100), g = Math.pow(pw, 0.75), m = this.mult, ground = kind === 'ground';
    const N = Math.round(Math.min(CRASH.dustCap, 3 + CRASH.dustK * g) * m);
    const sizeK = 0.25 + 0.55 * g, lifeK = 0.35 + 0.45 * g, velK = 0.3 + 0.55 * g;
    this.dustPlume(p, normal, g, kind, N, sizeK, lifeK, velK);
    const deb = speed < CRASH.debrisMin ? 0 : Math.round(Math.min(CRASH.debrisCap, 1 + CRASH.debrisK * g) * m);
    if (deb) this.debris(p, normal, g, deb);
    let r = 0, depth = 0;
    if (speed >= CRASH.craterMin) {
      r = Math.min(ground ? CRASH.craterCap : CRASH.craterCap * 0.8, ground ? 0.35 + 2.9 * g : 0.3 + 2.4 * g);
      depth = (ground ? 0.9 : 0.55) * THREE.MathUtils.clamp(0.55 + 0.3 * g, 0.6, 1.7);
      this.crater(p, normal, r, kind, depth);
    }
    this.lastCrash = { speed, pw, kind, dust: N, dustSize: sizeK, dustLife: lifeK * 4.75, debris: deb, craterR: r, craterDepth: depth * r };
    this.crashCount = (this.crashCount || 0) + 1;
    return Math.max(pw, 1e-3);
  }
  crashShake(pw) { return pw ? Math.min(1.3, 0.05 + 0.32 * Math.pow(pw, 0.8)) : 0; }
  dustPlume(p, n, g, kind, N, sizeK, lifeK, velK) {
    const ground = kind === 'ground', spread = 0.3 + 1.2 * g;
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, s = (4 + Math.random() * 14) * velK;
      if (ground) V.set(Math.cos(a) * s, (0.5 + Math.random() * 6) * velK, Math.sin(a) * s); // low rolling ring that rises
      else { V.copy(n).multiplyScalar((3 + Math.random() * 10) * velK); V.x += Math.cos(a) * s * 0.6; V.z += Math.sin(a) * s * 0.6; V.y += (Math.random() - 0.3) * s * 0.6; }
      P.copy(p).addScaledVector(n, 0.3 + Math.random() * spread * 0.6); P.x += (Math.random() - 0.5) * 2 * spread; P.z += (Math.random() - 0.5) * 2 * spread; P.y += Math.random() * spread * 0.6;
      const life = Math.min(CRASH.lifeCap, (3 + Math.random() * 3.5) * lifeK);
      this.plume.emit(P, V, life, 1 + Math.random() * 1.5, (3 + Math.random() * 6) * sizeK, 0.6 + Math.random() * 0.6);
    }
    // a slow column drifting off the wall / out of the crater
    for (let i = 0; i < N * 0.3; i++) { P.copy(p).addScaledVector(n, 0.5 + spread * 0.5); V.copy(n).multiplyScalar((1 + Math.random() * 3) * velK).add(S.set((Math.random() - 0.5) * 2, (2 + Math.random() * 4) * velK, (Math.random() - 0.5) * 2));
      this.plume.emit(P, V, Math.min(CRASH.lifeCap, (5 + Math.random() * 3) * lifeK), 2, (5 + Math.random() * 6) * sizeK, 0.7 + Math.random() * 0.5); }
  }
  debris(p, n, pw, count) {
    for (let i = 0; i < count; i++) {
      const d = this.d[this.debI]; this.debI = (this.debI + 1) % this.debMax;
      d.life = 4 + Math.random() * 3; d.rest = false; d.s = (0.25 + Math.random() * 0.7) * (0.45 + 0.4 * Math.min(pw, 2.2));
      d.p.copy(p).addScaledVector(n, 0.6).add(V.set((Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5));
      d.v.copy(n).multiplyScalar(6 + Math.random() * 20 * (0.3 + pw)).add(V.set((Math.random() - 0.5) * 18, 4 + Math.random() * 14, (Math.random() - 0.5) * 18).multiplyScalar(0.4 + 0.4 * pw));
      d.q.setFromEuler(E.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)); d.w.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
    }
  }
  crater(p, n, r, kind, depth = 0.9) {
    // a fresh hit on top of a recent crater just grows it a little
    for (const c of this.craters) if (c.used && c.kind === kind && c.p.distanceTo(p) < c.r * 0.6) { if (r > c.r) this.placeCrater(c, c.p, c.n, Math.min(r, c.r * 1.25), kind, Math.max(depth, c.depth || 0)); c.t = this.t; return; }
    let c = this.craters.find(k => !k.used); const used = this.craters.filter(k => k.used).length;
    if (!c || used >= (this.lowQ ? 10 : this.cap)) { c = this.craters.filter(k => k.used).sort((a, b) => a.t - b.t)[0]; } // recycle the oldest
    this.placeCrater(c, p, n, r, kind, depth); c.t = this.t;
  }
  placeCrater(c, p, n, r, kind, depth = 0.9) {
    const ground = kind === 'ground', idx = this.craters.indexOf(c);
    c.used = true; c.kind = kind; c.r = r; c.depth = depth; c.p.copy(p); c.n = n.clone();
    const d = c.decal; d.visible = true; d.material.map = ground ? this.groundTex : this.wallTex; d.material.needsUpdate = true;
    d.position.copy(p).addScaledVector(n, 0.04); d.quaternion.setFromUnitVectors(Z, n); d.rotateZ(Math.random() * 6.28); d.scale.set(r * 2.3, r * 2.3, 1);
    c.rim.visible = true; c.rim.position.copy(p).addScaledVector(n, ground ? 0.0 : 0.02); c.rim.quaternion.setFromUnitVectors(UP, n);
    c.rim.scale.set(r, r * depth, r); // bowl depth grows with the momentum
    // rubble chunks heaped around the rim (and a few in the bowl)
    const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? Z : UP).normalize(), t2 = new THREE.Vector3().crossVectors(n, t1);
    for (let i = 0; i < RUBBLE_PER; i++) {
      const a = Math.random() * Math.PI * 2, rr = r * (i < 4 ? Math.random() * 0.5 : 0.8 + Math.random() * 0.6), s = r * (ground ? 0.1 + Math.random() * 0.14 : 0.05 + Math.random() * 0.08);
      P.copy(p).addScaledVector(t1, Math.cos(a) * rr).addScaledVector(t2, Math.sin(a) * rr).addScaledVector(n, ground ? s * 0.35 : s * 0.1);
      if (!ground) { // on a wall, loose rubble also piles at the foot
        if (i >= RUBBLE_PER - 5) { const s2 = r * (0.1 + Math.random() * 0.12); P.copy(p).addScaledVector(n, 0.6 + Math.random() * r); P.y = (this.cityRef ? this.groundBelow(P) : 0) + s2 * 0.3; P.addScaledVector(t1, (Math.random() - 0.5) * r * 2); Q.setFromEuler(E.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)); M.compose(P, Q, S.set(s2 * 2, s2 * 2, s2 * 2)); this.rub.setMatrixAt(idx * RUBBLE_PER + i, M); continue; }
      }
      Q.setFromEuler(E.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)); M.compose(P, Q, S.set(s * 2, s * 2, s * 2));
      this.rub.setMatrixAt(idx * RUBBLE_PER + i, M);
    }
    this.rub.instanceMatrix.needsUpdate = true;
  }
  groundBelow(p) { const c = this.cityRef; let h = 0; try { h = c.heightAt(p.x, p.z); } catch (e) {} return h > p.y ? 0 : h; }
  update(dt) {
    this.t += dt; this.plume.update(dt, this.t);
    const city = this.cityRef; let any = false;
    for (let i = 0; i < this.debMax; i++) {
      const d = this.d[i]; if (d.life <= 0) continue; any = true;
      d.life -= dt;
      if (!d.rest) {
        d.v.y -= 30 * dt; d.p.addScaledVector(d.v, dt);
        const floor = city ? this.groundBelow(d.p) : 0;
        if (city && city.heightAt(d.p.x, d.p.z) > d.p.y + 0.5) { d.p.addScaledVector(d.v, -dt); d.v.x *= -0.3; d.v.z *= -0.3; } // bounce off walls
        if (d.p.y < floor + d.s * 0.35) { d.p.y = floor + d.s * 0.35; if (d.v.y < -3) { d.v.y *= -0.35; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6); } else { d.v.set(0, 0, 0); d.rest = true; } }
        const wl = d.w.length(); if (wl > 1e-3) d.q.premultiply(Q.setFromAxisAngle(V.copy(d.w).divideScalar(wl), wl * dt));
      }
      const sc = d.s * Math.min(1, d.life / 0.8);
      M.compose(d.p, d.q, S.set(sc, sc, sc)); this.deb.setMatrixAt(i, M);
      if (d.life <= 0) { M.makeScale(0, 0, 0); this.deb.setMatrixAt(i, M); }
    }
    if (any || this._debAny) this.deb.instanceMatrix.needsUpdate = true; this._debAny = any;
  }
}
