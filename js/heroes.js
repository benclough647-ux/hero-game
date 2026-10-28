import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
// Hero definitions, sculpted PBR models (bevelled armour, fur-shell Temper Tiger), verlet cloth capes,
// shader flames, and traversal physics.
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GRAV = 32;
const phys = (o) => new THREE.MeshPhysicalMaterial(o);
function mk(geo, mat, x, y, z, parent, sx = 1, sy = 1, sz = 1) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; }
const SPH = new THREE.SphereGeometry(1, 32, 20);
const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 16);
const rbox = (w, h, d, rad = 0.03) => new RoundedBoxGeometry(w, h, d, 3, Math.min(rad, w / 2.2, h / 2.2, d / 2.2));

// ---------- procedural textures ----------
function canvasTex(w, h, draw, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function furTextures() {
  const map = canvasTex(512, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#d9701c'); gr.addColorStop(0.5, '#ec8424'); gr.addColorStop(1, '#c45e16'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const x = Math.random() * w, y = Math.random() * h, l = 4 + Math.random() * 8, v = Math.random();
      g.strokeStyle = v < 0.5 ? 'rgba(120,45,5,.35)' : 'rgba(255,190,110,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 2, y + l); g.stroke(); }
    g.fillStyle = '#120c08';
    for (let k = 0; k < 14; k++) { const x0 = (k / 14) * w + Math.random() * 10; g.beginPath(); g.moveTo(x0, 0);
      for (let y = 0; y <= h; y += 16) g.lineTo(x0 + Math.sin(y * 0.03 + k) * 14 + 8 * (1 - Math.abs(y / h - 0.5) * 2), y);
      for (let y = h; y >= 0; y -= 16) g.lineTo(x0 + Math.sin(y * 0.03 + k) * 14 - 2, y); g.fill(); }
  });
  const bump = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7000; i++) { const v = Math.random() * 255 | 0; g.strokeStyle = `rgb(${v},${v},${v})`; const x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 3 + Math.random() * 5); g.stroke(); } }, false);
  const strands = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = 60 + Math.random() * 195 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6); } }, false);
  strands.repeat.set(6, 6); bump.repeat.set(3, 3);
  return { map, bump, strands };
}
function carbonTex() { return canvasTex(128, 128, (g, w, h) => { for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { const v = ((x + y) / 8) % 2 ? 24 : 34; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(x, y, 8, 8); } }); }

// fur shells: stacked, slightly inflated copies with alpha-tested strand noise
function addShells(mesh, tex, layers = 5, len = 0.035) {
  for (let i = 1; i <= layers; i++) {
    const m = new THREE.MeshStandardMaterial({ map: tex.map, alphaMap: tex.strands, alphaTest: 0.25 + 0.6 * i / layers, roughness: 0.95, color: new THREE.Color().setScalar(0.85 + 0.15 * i / layers) });
    const s = new THREE.Mesh(mesh.geometry, m); const k = 1 + len * i / layers / Math.max(mesh.scale.x, 0.05); s.scale.setScalar(k); s.castShadow = false; mesh.add(s);
  }
}
const flameMat = () => new THREE.ShaderMaterial({ uniforms: { t: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; uniform float t; void main(){ vUv = uv; vec3 p = position; float k = uv.y * uv.y; p.x += sin(t * 13.0 + position.y * 30.0) * 0.03 * k; p.z += cos(t * 9.0 + position.y * 22.0) * 0.025 * k; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
  fragmentShader: `varying vec2 vUv; uniform float t; void main(){ float n = sin(vUv.y * 16.0 - t * 22.0 + vUv.x * 31.4) * 0.5 + 0.5; float n2 = sin(vUv.y * 7.0 - t * 15.0 - vUv.x * 12.6) * 0.5 + 0.5;
    float a = pow(1.0 - vUv.y, 1.2) * (0.55 + 0.45 * n * n2); vec3 c = mix(vec3(6.0, 4.2, 1.6), vec3(4.0, 0.6, 0.08), smoothstep(0.0, 0.8, vUv.y)); gl_FragColor = vec4(c * a, a); }` });

// ---------- verlet cloth cape, simulated in the hero's body space ----------
class Cloth {
  constructor(parent, { w, h, nx, ny, top, z, mat, bulk }) {
    this.nx = nx; this.ny = ny; this.bulk = bulk; this.geo = new THREE.PlaneGeometry(w, h, nx - 1, ny - 1);
    const N = nx * ny; this.p = new Float32Array(N * 3); this.o = new Float32Array(N * 3); this.pin = new Uint8Array(N); this.rest = [];
    const dx = w / (nx - 1), dy = h / (ny - 1);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i, x = -w / 2 + i * dx, xn = x / (w / 2);
      const topW = 0.55 + 0.45 * j / (ny - 1); // narrower at the shoulders
      this.p.set([x * topW, top - j * dy, z - 0.02 * j - 0.03 * (1 - xn * xn)], k * 3); if (j === 0) this.pin[k] = 1; }
    this.o.set(this.p); this.pins = this.p.slice(0, nx * 3);
    const E = (a, b) => this.rest.push([a, b, Math.hypot(this.p[a * 3] - this.p[b * 3], this.p[a * 3 + 1] - this.p[b * 3 + 1], this.p[a * 3 + 2] - this.p[b * 3 + 2])]);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (i < nx - 1) E(k, k + 1); if (j < ny - 1) E(k, k + nx); if (j < ny - 2) E(k, k + 2 * nx); if (i < nx - 1 && j < ny - 1) E(k, k + nx + 1); }
    this.mesh = new THREE.Mesh(this.geo, mat); this.mesh.frustumCulled = false; this.mesh.castShadow = true; parent.add(this.mesh); this.t = 0; this.write();
  }
  update(dt, g, wind, flutter) {
    const p = this.p, o = this.o, nx = this.nx, b = this.bulk; this.t += dt;
    const SUB = 3, h = dt / SUB;
    for (let s = 0; s < SUB; s++) {
      for (let k = 0; k < p.length / 3; k++) { if (this.pin[k]) continue; const a = k * 3, i = k % nx, j = (k / nx) | 0;
        const vx = (p[a] - o[a]) * 0.985, vy = (p[a + 1] - o[a + 1]) * 0.985, vz = (p[a + 2] - o[a + 2]) * 0.985;
        o[a] = p[a]; o[a + 1] = p[a + 1]; o[a + 2] = p[a + 2];
        const drag = 3.5, fl = Math.sin(this.t * 17 + j * 0.85 - i * 0.35) * flutter * (j / this.ny), fl2 = Math.cos(this.t * 11 + j * 0.6 + i * 0.9) * flutter * 0.35;
        const ax = g.x + drag * (wind.x - vx / h) + fl2, ay = g.y + drag * (wind.y - vy / h), az = g.z + drag * (wind.z - vz / h) + fl;
        p[a] += vx + ax * h * h; p[a + 1] += vy + ay * h * h; p[a + 2] += vz + az * h * h; }
      for (let it = 0; it < 4; it++) for (const [A, B, r] of this.rest) { const a = A * 3, c = B * 3;
        const dx = p[c] - p[a], dy = p[c + 1] - p[a + 1], dz = p[c + 2] - p[a + 2], d = Math.hypot(dx, dy, dz) || 1e-6, f = (d - r) / d;
        if (this.pin[A]) { p[c] -= dx * f; p[c + 1] -= dy * f; p[c + 2] -= dz * f; } else { p[a] += dx * f * 0.5; p[a + 1] += dy * f * 0.5; p[a + 2] += dz * f * 0.5; p[c] -= dx * f * 0.5; p[c + 1] -= dy * f * 0.5; p[c + 2] -= dz * f * 0.5; } }
      // keep the cape behind the back / legs
      for (let k = nx; k < p.length / 3; k++) { const a = k * 3, y = p[a + 1]; const back = y > 0 ? -0.17 * b : -0.11 * b; if (y > -1 && p[a + 2] > back) p[a + 2] = back; }
    }
    this.write();
  }
  write() { this.geo.attributes.position.array.set(this.p); this.geo.attributes.position.needsUpdate = true; this.geo.computeVertexNormals(); }
}

function buildRig(o) {
  const b = o.bulk, M = o.mats; const root = new THREE.Group(); const body = new THREE.Group(); body.position.y = 0.95; root.add(body);
  const r = { root, body, arms: [], legs: [], hands: [], feet: [], furMeshes: [] };
  mk(cap(0.13 * b, 0.1), M.hips, 0, 0.04, 0, body).rotation.z = Math.PI / 2;
  mk(SPH, M.torso, 0, 0.22, 0, body, 0.17 * b, 0.2, 0.13 * b); // abdomen
  r.torso = mk(SPH, M.torso, 0, 0.5, -0.01, body, 0.25 * b, 0.27, 0.16 * b); // chest/lats
  const plate = mk(rbox(0.36 * b, 0.27, 0.1 * b, 0.05), M.chest, 0, 0.52, 0.1 * b, body); plate.rotation.x = -0.12;
  for (const sx of [-1, 1]) { const ab = mk(rbox(0.09 * b, 0.07, 0.05 * b, 0.02), M.chest, sx * 0.05 * b, 0.27, 0.12 * b, body); mk(ab.geometry, M.chest, sx * 0.05 * b, 0.18, 0.115 * b, body); }
  const belt = mk(new THREE.CylinderGeometry(0.19 * b, 0.19 * b, 0.07, 28), M.trim, 0, 0.1, 0, body); belt.scale.z = 0.72;
  mk(rbox(0.1, 0.08, 0.04, 0.015), M.trim, 0, 0.1, 0.14 * b, body); // buckle
  mk(new THREE.CylinderGeometry(0.06 * b, 0.085 * b, 0.16, 16), M.neck || M.head, 0, 0.76, -0.01, body);
  const head = new THREE.Group(); head.position.y = 0.86; body.add(head); r.head = head;
  r.skull = mk(SPH, M.head, 0, 0, 0, head, 0.12 * Math.sqrt(b), 0.135 * Math.sqrt(b), 0.13 * Math.sqrt(b));
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.3 * b, 0.64, 0); body.add(sh);
    mk(SPH, M.shoulder, 0, 0.01, 0, sh, 0.12 * b, 0.1 * b, 0.12 * b);
    mk(rbox(0.2 * b, 0.05, 0.2 * b, 0.02), M.trim, 0, -0.06, 0, sh);
    r.furMeshes.push(mk(cap(0.068 * b, 0.18), M.arm, 0, -0.2, 0, sh));
    r.furMeshes.push(mk(cap(0.06 * b, 0.16), M.fore || M.arm, 0, -0.42, 0.005, sh));
    mk(rbox(0.15 * b, 0.17, 0.15 * b, 0.04), M.glove, 0, -0.5, 0.005, sh);
    mk(SPH, M.glove, 0, -0.64, 0.015, sh, 0.075 * b, 0.07, 0.08 * b);
    const hand = new THREE.Object3D(); hand.position.y = -0.7; sh.add(hand); r.hands.push(hand); r.arms.push(sh);
  }
  for (const sx of [-1, 1]) {
    const hp = new THREE.Group(); hp.position.set(sx * 0.11 * b, 0, 0); body.add(hp);
    mk(cap(0.088 * b, 0.26), M.leg, 0, -0.25, 0, hp);
    mk(rbox(0.12 * b, 0.12, 0.06, 0.03), M.trim, 0, -0.46, 0.07 * b, hp);
    mk(cap(0.07 * b, 0.22), M.leg, 0, -0.62, 0, hp);
    mk(rbox(0.16 * b, 0.28, 0.17 * b, 0.05), M.boot, 0, -0.74, 0.005, hp);
    mk(rbox(0.15 * b, 0.09, 0.27 * b, 0.04), M.boot, 0, -0.9, 0.045, hp);
    const foot = new THREE.Object3D(); foot.position.y = -0.94; hp.add(foot); r.feet.push(foot); r.legs.push(hp);
  }
  r.cape = new Cloth(body, { w: 0.62 * b, h: 1.15, nx: 11, ny: 15, top: 0.7, z: -0.18 * b, mat: M.cape, bulk: b });
  if (M.capeClasp) for (const sx of [-1, 1]) mk(SPH, M.capeClasp, sx * 0.17 * b, 0.68, 0.02, body, 0.045, 0.045, 0.03);
  root.traverse(x => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } });
  return r;
}

function tigerModel() {
  const fur = furTextures();
  const furMat = new THREE.MeshPhysicalMaterial({ map: fur.map, bumpMap: fur.bump, bumpScale: 2, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0xffa050), sheenRoughness: 0.45 });
  const suit = phys({ color: 0x1a1a1d, map: carbonTex(), roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.4 });
  const armour = phys({ color: 0x8e1210, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15 });
  const gold = phys({ color: 0xd8a028, metalness: 1, roughness: 0.28 });
  const black = phys({ color: 0x141416, metalness: 0.6, roughness: 0.35, clearcoat: 1 });
  const m = { torso: suit, chest: armour, trim: gold, hips: suit, head: furMat, neck: furMat, shoulder: armour, arm: furMat, fore: furMat, glove: black, leg: suit, boot: armour,
    cape: phys({ color: 0x8a0c0c, roughness: 0.75, sheen: 1, sheenColor: new THREE.Color(0xff6a50), sheenRoughness: 0.5, side: THREE.DoubleSide }), capeClasp: gold };
  const r = buildRig({ bulk: 1.4, mats: m });
  addShells(r.skull, fur, 5, 0.03); for (const f of r.furMeshes) addShells(f, fur, 4, 0.02);
  const h = r.head; const white = phys({ color: 0xf2ece0, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0xffffff) }), nose = phys({ color: 0x1a1210, roughness: 0.4, clearcoat: 1 });
  mk(SPH, white, 0, -0.045, 0.12, h, 0.08, 0.06, 0.07); mk(SPH, white, 0, -0.09, 0.1, h, 0.06, 0.035, 0.05);
  mk(SPH, nose, 0, -0.01, 0.19, h, 0.03, 0.02, 0.02);
  const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 2.6, 0.3) });
  for (const sx of [-1, 1]) {
    const ear = mk(new THREE.ConeGeometry(0.05, 0.11, 12), furMat, sx * 0.105, 0.13, -0.02, h); ear.rotation.z = -sx * 0.45; ear.scale.z = 0.5;
    mk(SPH, eye, sx * 0.055, 0.025, 0.125, h, 0.022, 0.012, 0.01);
    mk(SPH, furMat, sx * 0.095, -0.06, 0.06, h, 0.06, 0.06, 0.05); // cheek ruff
  }
  r.flames = []; r.flameMat = flameMat();
  for (let k = 0; k < 8; k++) { const f = mk(new THREE.ConeGeometry(0.045, 0.24, 10, 4, true), r.flameMat, 0, 0.15 + 0.03 * Math.sin(k / 7 * Math.PI), 0.11 - k * 0.035, h); f.rotation.x = -0.5 - k * 0.04; f.castShadow = false; r.flames.push(f); }
  for (const hand of r.hands) for (let k = -1; k <= 1; k++) { const c = mk(new THREE.ConeGeometry(0.014, 0.09, 8), white, k * 0.045, -0.02, 0.07, hand); c.rotation.x = Math.PI * 0.8; }
  // glowing knuckle seams
  const ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.2, 0.2) });
  for (const a of r.arms) mk(rbox(0.16, 0.012, 0.012, 0.005), ember, 0, -0.6, 0.12, a);
  return r;
}
function centurionModel() {
  const white = phys({ color: 0xf0f0ec, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });
  const gold = phys({ color: 0xe2b040, metalness: 1, roughness: 0.22, clearcoat: 0.6 });
  const skin = phys({ color: 0xd9a07a, roughness: 0.6, sheen: 0.3, sheenColor: new THREE.Color(0xffd0b0) });
  const m = { torso: white, chest: gold, trim: gold, hips: white, head: skin, neck: skin, shoulder: white, arm: white, fore: white, glove: gold, leg: white, boot: gold,
    cape: phys({ color: 0xf6f4ee, roughness: 0.7, sheen: 1, sheenColor: new THREE.Color(0xfff2d0), sheenRoughness: 0.4, side: THREE.DoubleSide }), capeClasp: gold };
  const r = buildRig({ bulk: 1.05, mats: m });
  const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.6, 3.2) });
  for (const sx of [-1, 1]) mk(SPH, eye, sx * 0.04, 0.02, 0.112, r.head, 0.02, 0.009, 0.01);
  mk(new THREE.SphereGeometry(0.128, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2.1), phys({ color: 0x2c1e14, roughness: 0.55, sheen: 1, sheenColor: new THREE.Color(0x8a6040) }), 0, 0.015, -0.012, r.head, 1, 1.05, 1.05);
  mk(SPH, skin, 0, -0.07, 0.07, r.head, 0.07, 0.05, 0.06); // jaw
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
    this.heldJump = 0; this.sprintT = 0;
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
      // after a dive landing, carry momentum straight into a sprint
      if (this.sprintT > 0) { this.sprintT -= dt; if (wish.lengthSq() < 0.01) wish.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
      const tgt = wish.clone().multiplyScalar(inp.boost > 0.3 || this.sprintT > 0 ? d.sprint : d.run);
      if (this.charge > 0) tgt.multiplyScalar(0.15);
      const k = Math.min(1, dt * (this.sprintT > 0 ? 3 : 10));
      this.vel.x += (tgt.x - this.vel.x) * k; this.vel.z += (tgt.z - this.vel.z) * k;
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
          if (this.state === 'air' || (this.state === 'fly' && (inp.descend > 0.2 || this.vel.y < -8))) this.land();
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
    const impact = -this.vel.y, hs = Math.hypot(this.vel.x, this.vel.z); this.state = 'ground';
    if (hs > 6) { const c = Math.min(1, this.def.sprint * 1.6 / hs); this.vel.x *= c; this.vel.z *= c; this.sprintT = 1.4; } // dive -> sprint
    if (impact > 6 || hs > 20) this.fx.dustBurst(this.pos, 25 + Math.min(80, impact + hs * 0.3), 5 + Math.min(25, impact * 0.3 + hs * 0.08));
    if (impact > 35) this.fx.shockwave(this.pos, this.def.style === 'fire' ? 0xff7020 : 0xe8e2d0, Math.min(40, impact * 0.5));
  }
  fireBurst(p, n, s) {
    const v = V(), c0 = new THREE.Color(5, 3, 0.9), c1 = new THREE.Color(3, 0.35, 0.04);
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
    // cloth cape: gravity + relative wind in body space, flutter grows with speed
    r.body.updateMatrixWorld(); const sc = r.root.scale.x; r.body.getWorldQuaternion(this._q || (this._q = new THREE.Quaternion())).invert();
    const g = V(0, -9.8 / sc, 0).applyQuaternion(this._q);
    const wind = this.vel.clone().multiplyScalar(-1 / sc); const wl = wind.length(); if (wl > 30) wind.multiplyScalar(30 / wl); wind.applyQuaternion(this._q);
    r.cape.update(Math.min(dt, 1 / 30), g, wind, Math.min(60, 4 + sp * 0.5));
    r.head.rotation.x = -fb * 1.1;
    if (fire) this.fireFx(dt, fly);
  }
  fireFx(dt, fly) {
    const r = this.rig, fx = this.fx.fire, w = V(), v = V();
    // mohawk flames flicker + embers
    r.flameMat.uniforms.t.value = this.t; r.flames.forEach((f, i) => { const s = 0.8 + Math.sin(this.t * 20 + i * 2) * 0.3 + Math.random() * 0.2; f.scale.set(1, s, 1); });
    const yel = new THREE.Color(2.6, 1.4, 0.35), red = new THREE.Color(1.6, 0.18, 0.02), wht = new THREE.Color(3, 2.6, 1.8);
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
      v.copy(back).multiplyScalar(8 + Math.random() * 6).add(V((Math.random() - .5) * 4, (Math.random() - .5) * 4, (Math.random() - .5) * 4)).addScaledVector(this.vel, 0.9);
      fx.emit(w, v, 0.12 + Math.random() * 0.18, Math.random() < 0.3 ? wht : yel, red);
    }
  }
}
