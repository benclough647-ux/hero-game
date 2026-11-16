import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { sonicBoomSound } from './audio.js';
// Hero definitions: game-ready GLB models (with primitive fallback), procedural whole-body poses,
// and traversal physics. Capes are part of the GLBs; the old verlet capes stay on the fallback only.
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
  tiger: { name: 'TEMPER TIGER', height: 2.13, build: tigerModel, run: 15, sprint: 26, fly: 90, flyBoost: 320, flyAccel: 3.5, turn: 3, tackleSpeed: 85, mass: 1.3,
    capeColor: 0xb01010, style: 'fire' },
  centurion: { name: 'CENTURION', height: 1.83, build: centurionModel, run: 16, sprint: 34, fly: 90, flyBoost: 320, flyAccel: 3.5, turn: 7, style: 'clean', tackleSpeed: 110, mass: 1.0 },
};

// Super speed (LS / B while flying): top speed = boost top speed x SUPER_MULT
const SUPER_MULT = 2.5;
const JET_GEO = (() => { const g = new THREE.ConeGeometry(0.1, 1, 14, 4, true); g.translate(0, 0.5, 0); return g; })(); // base at origin, tip at +Y
const NO_INP = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, jumpReleased: false, boost: 0, descend: 0, cancelPressed: false };
const _v = new THREE.Vector3();
const lerpAng = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };


// ---------- game-ready GLB models ----------
// Rigged + animated heroes (skeleton, skinned body/cape LOD0+LOD1, mohawk on the head bone, 12 clips).
const SKINNED_FILES = { tiger: './assets/tiger_skinned.glb', centurion: './assets/cent_skinned.glb' };
// Older unrigged LOD models: only loaded if the rigged file fails (or with ?legacy in the URL).
const MODEL_FILES = {
  tiger: [0, 1, 2].map(i => `./assets/tiger_game_lod${i}_meshopt.glb`),
  centurion: [0, 1, 2].map(i => `./assets/cent_game_lod${i}_meshopt.glb`),
};

function prepareMeshes(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        if (m[k]) { m[k].anisotropy = 8; m[k].needsUpdate = true; }
      }
      // Keep baked emissive punchy so bloom can pick up fists, eyes and the mohawk.
      if (m.emissiveMap && m.emissiveIntensity < 1.5) m.emissiveIntensity = 2.5;
    }
  });
}

function collectMohawks(root) {
  const named = [];
  root.traverse(o => { if (/mohawk/i.test(o.name || '')) named.push(o); });
  // Prefer the top-most "Mohawk" node so we scale the already-transformed meshopt pivot.
  const nodes = named.filter(o => !named.includes(o.parent));
  const mats = [];
  for (const n of nodes) {
    n.userData.baseScale = n.scale.clone();
    n.traverse(o => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) if (m && !mats.includes(m)) { m.userData.baseEmissive = m.emissiveIntensity || 3; mats.push(m); }
    });
  }
  return { nodes, mats };
}

function attachPointsFromModel(source, parent) {
  parent.updateMatrixWorld(true);
  const inv = parent.matrixWorld.clone().invert();
  const xs = [], ys = [], zs = [];
  const v = new THREE.Vector3();
  source.traverse(o => {
    if (!o.isMesh || /mohawk/i.test(o.name || '')) return;
    const attr = o.geometry?.attributes?.position; if (!attr) return;
    o.updateMatrixWorld(true);
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      xs.push(v.x); ys.push(v.y); zs.push(v.z);
    }
  });
  const mk = (x, y, z, name) => { const p = new THREE.Object3D(); p.name = name; p.position.set(x, y, z); parent.add(p); return p; };
  if (!ys.length) {
    const h = 1.8;
    return { hands: [mk(-0.35, h * 0.55, 0.05, 'handL'), mk(0.35, h * 0.55, 0.05, 'handR')], feet: [mk(-0.15, 0.05, 0.05, 'footL'), mk(0.15, 0.05, 0.05, 'footR')] };
  }
  const n = ys.length;
  const minY = Math.min(...ys), maxY = Math.max(...ys), h = Math.max(0.1, maxY - minY);
  const footCut = minY + Math.min(0.14, h * 0.08);
  const foot = { L: [], R: [] };
  for (let i = 0; i < n; i++) if (ys[i] <= footCut) (xs[i] < 0 ? foot.L : foot.R).push(i);
  const lowestMean = (idx, fallback) => {
    if (!idx.length) return fallback;
    const cut = minY + 0.05;
    const low = idx.filter(i => ys[i] <= cut);
    const use = low.length ? low : idx;
    let x = 0, y = 0, z = 0;
    for (const i of use) { x += xs[i]; y += ys[i]; z += zs[i]; }
    return [x / use.length, y / use.length, z / use.length];
  };
  const y0 = 0.4 * h, y1 = 0.72 * h;
  const mid = { L: [], R: [] };
  for (let i = 0; i < n; i++) if (ys[i] >= y0 && ys[i] <= y1) (xs[i] < 0 ? mid.L : mid.R).push(i);
  const extremeMean = (idx, sign, fallback) => {
    if (!idx.length) return fallback;
    let maxA = 0;
    for (const i of idx) maxA = Math.max(maxA, Math.abs(xs[i]));
    const thr = maxA * 0.92;
    const ext = idx.filter(i => Math.abs(xs[i]) >= thr);
    const use = ext.length ? ext : idx;
    let x = 0, y = 0, z = 0;
    for (const i of use) { x += xs[i]; y += ys[i]; z += zs[i]; }
    return [x / use.length, y / use.length, z / use.length];
  };
  const fL = lowestMean(foot.L, [-0.18, 0.04, 0.04]), fR = lowestMean(foot.R, [0.18, 0.04, 0.04]);
  const hL = extremeMean(mid.L, -1, [-0.4, minY + h * 0.55, 0]), hR = extremeMean(mid.R, 1, [0.4, minY + h * 0.55, 0]);
  return {
    hands: [mk(hL[0], hL[1], hL[2], 'handL'), mk(hR[0], hR[1], hR[2], 'handR')],
    feet: [mk(fL[0], fL[1], fL[2], 'footL'), mk(fR[0], fR[1], fR[2], 'footR')],
  };
}

export async function preloadHeroModels(onProgress) {
  try {
    if (MeshoptDecoder.ready) await MeshoptDecoder.ready;
  } catch (e) { console.warn('MeshoptDecoder.ready failed', e); }
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => { onProgress?.(loaded / Math.max(1, total), url); };
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  const loadGltf = (url) => new Promise((resolve, reject) => { loader.load(url, resolve, undefined, reject); });
  const keys = Object.keys(MODEL_FILES);
  const legacy = typeof location !== 'undefined' && /[?&]legacy\b/.test(location.search);
  const result = {};
  // 1) rigged models
  if (!legacy) {
    await Promise.all(keys.map(key => loadGltf(SKINNED_FILES[key]).then(gltf => {
      if (!gltf.animations?.length) throw new Error('no animations in ' + SKINNED_FILES[key]);
      prepareMeshes(gltf.scene);
      result[key] = { skinned: gltf };
    }).catch(e => console.warn('Rigged model failed, falling back to static LODs:', SKINNED_FILES[key], e))));
  }
  // 2) fallback: static LOD models for any hero whose rigged file did not load
  const need = keys.filter(k => !result[k]);
  const slots = Object.fromEntries(need.map(k => [k, []]));
  const jobs = [];
  for (const key of need) {
    MODEL_FILES[key].forEach((url, i) => {
      jobs.push(loadGltf(url).then(gltf => {
        prepareMeshes(gltf.scene);
        slots[key][i] = gltf.scene;
      }).catch(e => {
        console.warn('Failed to load', url, e);
        if (i === 0) slots[key].failed = true;
      }));
    });
  }
  await Promise.all(jobs);
  for (const key of need) {
    const scenes = (slots[key] || []).filter(Boolean);
    result[key] = (!slots[key].failed && scenes.length) ? scenes : null;
  }
  onProgress?.(1, 'done');
  return result;
}

const SKIN_LOOPS = new Set(['idle', 'run', 'air', 'fly_hover', 'fly_fast', 'tackle', 'fall', 'down']);
// clips whose playhead is driven from game state (attack timers, knockback, get-up progress)
const SKIN_DRIVEN = new Set(['blast', 'punch', 'hit', 'getup', 'crouch']);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _ax = new THREE.Vector3();

export class Hero {
  constructor(key, scene, effects) {
    this.key = key; this.def = HERO_DEFS[key]; this.fx = effects; this.scene = scene;
    this.rig = this.def.build(); this.rig.root.scale.setScalar(this.def.height / 1.83);
    this.rig.root.rotation.order = 'YXZ'; this.rig.body.rotation.order = 'YXZ';
    this.useGLB = false; this.useSkin = false; this.anim = null; this.landSquash = 1; this.leapStretch = 1; this.qualityName = 'High';
    scene.add(this.rig.root);
    this.pos = V(0, 0, 0); this.vel = V(); this.state = 'ground'; this.yaw = 0; this.bank = 0; this.flyBlend = 0; this.charge = 0; this.phase = 0; this.t = 0;
    this.heldJump = 0; this.sprintT = 0;
    // combat state
    this.hp = 100; this.maxHp = 100; this.knockT = 0; this.action = null; this.cd = { blast: 0, tackle: 0, punch: 0, dodge: 0 };
    this.ragdoll = null; this.grabbedBy = null; this.grabbing = null; this.ko = false; this.aim = V(0, 0, 1); this.shoulders = null;
    this.arm = { rx: 0, rz: 0, lx: 0, lz: 0 }; this.upright = 0; this.lastHitT = -99;
    this.superSpeed = false; this.superT = 0; this.superIdle = 0; this.boomKick = 0; this.visibleFlag = true;
    if (this.def.style === 'fire') { // world-space flame jets that follow the hand/foot anchors
      this.jetMat = flameMat(); this.jets = [];
      for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(JET_GEO, this.jetMat); m.frustumCulled = false; m.castShadow = false; m.visible = false; m.renderOrder = 3; scene.add(m); this.jets.push(m); }
    }
    if (this.def.style === 'fire') { this.glow = new THREE.PointLight(0xff6020, 0, 30, 1.5); this.rig.body.add(this.glow); this.glow.position.y = 0.4; }
  }
  forceFly() { // used by the AI to get airborne without button sequences
    if (this.state === 'fly') return;
    if (this.def.style === 'fire') { if (this.state === 'ground') { this.vel.y = 30; this.fireBurst(this.pos, 40, 12); } this.startFly(); }
    else { if (this.state === 'ground') this.takeOff(); else this.state = 'fly'; }
  }
  setVisible(v) { this.rig.root.visible = v; this.visibleFlag = v; if (this.glow) this.glow.visible = v; if (!v && this.jets) for (const j of this.jets) j.visible = false; }
  // LS while flying: sonic boom, then super speed until you stop flying, let go of the stick, slow down, or press LS again
  sonicBoom(cam) {
    const fire = this.def.style === 'fire';
    const dir = this.vel.lengthSq() > 25 ? this.vel.clone().normalize() : (cam?.forward ? cam.forward.clone() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)));
    this.superSpeed = true; this.superT = 0; this.superIdle = 0; this.boomKick = 1;
    this.vel.addScaledVector(dir, this.def.flyBoost * 0.6);
    this.fx.sonicBoom(this.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), dir, { fire, follow: this.pos });
    if (fire) this.fireBurst(this.pos, 120, 30);
    sonicBoomSound(fire);
  }
  endSuper() { this.superSpeed = false; this.superIdle = 0; }

  // Swap the primitive fallback for loaded LOD meshes. Safe to call once; no-ops if levels are missing.
  adoptModels(levels) {
    if (levels && levels.skinned) return this.adoptSkinned(levels.skinned);
    if (!levels || !levels[0]) return false;
    const root = this.rig.root;
    if (this.glow && this.glow.parent) this.glow.parent.remove(this.glow);
    while (root.children.length) root.remove(root.children[0]);
    root.scale.set(1, 1, 1); // GLBs are already in metres, origin at the feet, facing +Z

    const hipH = this.def.height * 0.52;
    const squash = new THREE.Group(); squash.name = 'squash';
    const body = new THREE.Group(); body.name = 'body'; body.position.y = hipH; body.rotation.order = 'YXZ';
    const model = new THREE.Group(); model.name = 'model'; model.position.y = -hipH;
    const lod = new THREE.LOD(); lod.name = 'heroLod';
    const lodObjects = levels.slice();
    model.add(lod);
    body.add(model); squash.add(body); root.add(squash);
    root.rotation.order = 'YXZ';

    this.rig = { root, squash, body, model, lod, lodObjects, mohawks: { nodes: [], mats: [] }, hands: [], feet: [], arms: [], legs: [], head: model, cape: null };
    this.useGLB = true; this.hipH = hipH;
    this.applyLodLevels();
    const pts = attachPointsFromModel(lodObjects[0], model);
    this.rig.hands = pts.hands; this.rig.feet = pts.feet;
    const mohawks = { nodes: [], mats: [] };
    for (const s of lodObjects) {
      const m = collectMohawks(s);
      mohawks.nodes.push(...m.nodes); mohawks.mats.push(...m.mats);
    }
    this.rig.mohawks = mohawks;
    // split arms: shoulder pivots per LOD (R = character's right hand, on -X since models face +Z)
    const sh = { R: [], L: [] };
    for (const s of lodObjects) s.traverse(o => { if (/_shoulderL$/.test(o.name)) sh.R.push(o); else if (/_shoulderR$/.test(o.name)) sh.L.push(o); });
    if (sh.R.length && sh.L.length) {
      this.shoulders = sh;
      const fists = [];
      for (const side of [sh.R[0], sh.L[0]]) {
        const m = side.children.find(c => c.isMesh) || side.children[0];
        let pt = V(0, -0.6, 0.05);
        if (m && m.geometry) { m.geometry.computeBoundingBox(); m.updateMatrix(); const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrix); const c = b.getCenter(V()); pt = V(c.x, b.min.y + 0.1, c.z + 0.02); }
        const f = new THREE.Object3D(); f.name = 'fist'; f.position.copy(pt); side.add(f); fists.push(f);
      }
      this.rig.hands = fists; this.fists = fists;
    }
    if (this.def.style === 'fire') {
      if (!this.glow) this.glow = new THREE.PointLight(0xff6020, 0, 30, 1.5);
      body.add(this.glow); this.glow.position.set(0, 0.15, 0.12);
    }
    return true;
  }
  // Rigged model: skeleton + AnimationMixer. The body group still carries whole-body pitch/bank/ragdoll rotation.
  adoptSkinned(gltf) {
    const scene = gltf.scene, root = this.rig.root;
    if (this.glow && this.glow.parent) this.glow.parent.remove(this.glow);
    while (root.children.length) root.remove(root.children[0]);
    root.scale.set(1, 1, 1); root.rotation.order = 'YXZ';
    const hipH = this.def.height * 0.52;
    const squash = new THREE.Group(); squash.name = 'squash';
    const body = new THREE.Group(); body.name = 'body'; body.position.y = hipH; body.rotation.order = 'YXZ';
    const model = new THREE.Group(); model.name = 'model'; model.position.y = -hipH;
    model.add(scene); body.add(model); squash.add(body); root.add(squash);
    const bones = {}, lod0 = [], lod1 = [];
    scene.traverse(o => {
      if (o.isBone) bones[o.name.replace(/[.\s]/g, '')] = o;
      if (o.isMesh) {
        o.frustumCulled = false; // skinned bounds don't follow the pose (flight, ragdoll)
        if (/mohawk/i.test(o.name || '') || /mohawk/i.test(o.parent?.name || '')) return;
        (/_lod1$/i.test(o.name) ? lod1 : lod0).push(o);
      }
    });
    const B = n => bones[n.replace(/[.\s]/g, '')];
    if (!B('hips') || !B('hand.R')) { console.warn('Rigged model is missing bones, using fallback'); return false; }
    const mixer = new THREE.AnimationMixer(scene);
    const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
    if (clips.getup) { const c = clips.getup.clone(); c.name = 'crouch'; clips.crouch = c; }
    const actions = {}, w = {};
    for (const [name, clip] of Object.entries(clips)) {
      const a = mixer.clipAction(clip);
      a.setLoop(SKIN_LOOPS.has(name) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = true; a.enabled = true; a.play(); a.setEffectiveWeight(name === 'idle' ? 1 : 0);
      if (SKIN_DRIVEN.has(name)) a.setEffectiveTimeScale(0);
      actions[name] = a; w[name] = name === 'idle' ? 1 : 0;
    }
    const attach = (bone, x, y, z, name) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); bone.add(o); return o; };
    const k = this.def.height / 1.83;
    // bone local +Y runs along the bone (Blender convention), so the fist sits a little past the wrist
    const fists = [attach(B('hand.R'), 0, 0.07 * k, 0, 'fistR'), attach(B('hand.L'), 0, 0.07 * k, 0, 'fistL')];
    const feet = [attach(B('toe.L') || B('foot.L'), 0, 0, 0, 'footL'), attach(B('toe.R') || B('foot.R'), 0, 0, 0, 'footR')];
    this.rig = { root, squash, body, model, lod: null, lodObjects: [scene], mohawks: collectMohawks(scene), hands: fists, feet, arms: [], legs: [], head: B('head') || model, cape: null };
    this.fists = fists; this.shoulders = null;
    this.anim = { mixer, actions, w, B, lod0, lod1, upperArmR: B('upper_arm.R'), lowNow: null };
    this.useGLB = true; this.useSkin = true; this.hipH = hipH;
    if (this.def.style === 'fire') {
      if (!this.glow) this.glow = new THREE.PointLight(0xff6020, 0, 30, 1.5);
      body.add(this.glow); this.glow.position.set(0, 0.15, 0.12);
    }
    mixer.update(0);
    return true;
  }
  // choose clip weights from game state, crossfade, then add aim offsets on top of the pose
  animateSkin(dt, hs, fb) {
    const A = this.anim, act = this.action, rd = this.ragdoll, acts = A.actions;
    const tgt = {}; for (const n in acts) tgt[n] = 0;
    const has = n => !!acts[n];
    const drive = (n, t) => { const a = acts[n]; if (a) a.time = THREE.MathUtils.clamp(t, 0, a.getClip().duration - 1e-3); };
    let over = null, overW = 0;
    if (rd) {
      if (rd.getUp > 0 && has('getup')) { tgt.getup = 1; drive('getup', Math.min(1, rd.getUp) * acts.getup.getClip().duration); }
      else { const fl = Math.min(1, rd.flail); tgt.fall = fl; tgt.down = 1 - fl; }
    } else {
      if (this.state === 'ground') {
        const run = Math.min(1, hs / 6); tgt.idle = 1 - run; tgt.run = run;
        if (has('run')) acts.run.setEffectiveTimeScale(THREE.MathUtils.clamp(hs / (this.def.style === 'fire' ? 13 : 15), 0.7, 1.7));
        if (this.charge > 0 && has('crouch')) { const c = Math.min(1, this.charge * 2); tgt.idle *= 1 - c; tgt.run *= 1 - c; tgt.crouch = c; drive('crouch', 0.42); }
      } else if (this.state === 'air') tgt.air = 1;
      else { tgt.fly_hover = 1 - fb; tgt.fly_fast = fb; }
      if (act && has(act.type)) {
        over = act.type; overW = 1;
        if (act.type === 'punch') drive('punch', act.t * 1.6);       // fist lands ~0.16 s (game hit window)
        else if (act.type === 'blast') drive('blast', act.t);           // hand up by ~0.12 s, blast fires at 0.14 s
        else if (act.type === 'tackle' && act.t < dt * 1.5) acts.tackle.time = 0;
      } else if (this.knockT > 0 && has('hit')) { over = 'hit'; overW = 1; drive('hit', (0.45 - this.knockT) / 0.45 * acts.hit.getClip().duration); }
      if (over) { for (const n in tgt) tgt[n] *= 1 - overW; tgt[over] = overW; }
    }
    const rate = over || rd ? 16 : 8;
    let sum = 0;
    for (const n in acts) { A.w[n] += ((tgt[n] || 0) - A.w[n]) * Math.min(1, dt * rate); if (A.w[n] < 1e-3) A.w[n] = 0; sum += A.w[n]; }
    for (const n in acts) acts[n].setEffectiveWeight(sum > 0 ? A.w[n] / sum : (n === 'idle' ? 1 : 0));
    A.mixer.update(dt);
    // aim the striking arm at the target (pitch), compensating for whole-body lean
    if (!rd && act && (act.type === 'blast' || act.type === 'punch') && A.upperArmR) {
      const k = A.w[act.type] / Math.max(sum, 1e-3);
      const pitch = Math.asin(THREE.MathUtils.clamp(this.aim.y, -1, 1)) + this.rig.body.rotation.x;
      const bone = A.upperArmR; this.rig.root.updateMatrixWorld(true);
      this.rig.body.getWorldQuaternion(_q1); _ax.set(1, 0, 0).applyQuaternion(_q1);
      bone.parent.getWorldQuaternion(_q2);
      const qw = new THREE.Quaternion().setFromAxisAngle(_ax, -THREE.MathUtils.clamp(pitch, -1.3, 1.3) * k);
      bone.quaternion.premultiply(_q2.clone().invert().multiply(qw).multiply(_q2));
    }
    // LOD: swap to the decimated meshes (same skeleton) when the camera is far
    if (A.lod1.length) {
      const cam = Hero.viewer; const d = cam ? cam.position.distanceTo(this.pos) : 0;
      const low = this.qualityName === 'Low' ? d > 7 : d > 16;
      if (low !== A.lowNow) { A.lowNow = low; for (const m of A.lod0) m.visible = !low; for (const m of A.lod1) m.visible = low; }
    }
  }
  setQuality(preset) { this.qualityName = preset?.name || 'High'; this.applyLodLevels(); }
  applyLodLevels() {
    if (!this.useGLB || this.useSkin || !this.rig.lod) return;
    const lod = this.rig.lod, objs = this.rig.lodObjects;
    for (const l of lod.levels.slice()) { lod.remove(l.object); }
    lod.levels.length = 0;
    const low = this.qualityName === 'Low';
    if (low) {
      lod.addLevel(objs[1] || objs[0], 0);
      if (objs[2]) lod.addLevel(objs[2], 16);
    } else {
      lod.addLevel(objs[0], 0);
      if (objs[1]) lod.addLevel(objs[1], 12);
      if (objs[2]) lod.addLevel(objs[2], 28);
    }
  }
  get speed() { return this.vel.length(); }
  get modeLabel() { return { ground: 'On foot', air: 'Airborne', fly: this.def.style === 'fire' ? 'Fire flight' : 'Flying' }[this.state] + (this.superSpeed ? ' – SUPER SPEED' : '') + (this.charge > 0 ? ' – charging leap' : ''); }

  update(dt, inp, cam, city) {
    const d = this.def, fire = d.style === 'fire'; this.t += dt;
    const stun = this.knockT > 0; if (stun) { this.knockT -= dt; inp = NO_INP; }
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
      } else if (stun) this.vel.multiplyScalar(Math.exp(-dt * 1.2));
      else this.flyUpdate(dt, inp, cam);
      if (inp.cancelPressed && this.state === 'fly') this.state = 'air';
    }
    if (inp.superPressed && !stun) { if (this.superSpeed) this.endSuper(); else if (this.state === 'fly') this.sonicBoom(cam); }
    if (this.superSpeed) {
      this.superT += dt;
      if (this.state !== 'fly' || this.grabbedBy || (this.superT > 0.8 && this.vel.length() < d.flyBoost * 0.5)) this.endSuper();
    }

    // combat movement overrides: tackle dash / carrying a grabbed enemy, punch lunge
    const act = this.action;
    if (act && act.type === 'tackle' && !stun) {
      if (this.state !== 'fly') { this.state = 'fly'; if (this.vel.y < 4) this.vel.y = 4; }
      const spd = this.grabbing ? act.carrySpeed : d.tackleSpeed;
      const dir = this.grabbing ? act.carryDir : this.aim;
      this.vel.lerp(_v.copy(dir).multiplyScalar(spd), Math.min(1, dt * (this.grabbing ? 12 : 7)));
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
    if (act && act.type !== 'tackle' && Math.hypot(this.aim.x, this.aim.z) > 0.1) this.yaw = lerpAng(this.yaw, Math.atan2(this.aim.x, this.aim.z), Math.min(1, dt * 18));
    else if (this.state === 'fly') { if (this.vel.length() > 3) this.yaw = lerpAng(this.yaw, Math.atan2(this.vel.x, this.vel.z), Math.min(1, dt * d.turn)); else this.yaw = lerpAng(this.yaw, cam.yawFacing, dt * 3); }
    else if (hs > 1) this.yaw = lerpAng(this.yaw, Math.atan2(this.vel.x, this.vel.z), Math.min(1, dt * 10));
    const yawRate = (((this.yaw - prevYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) / Math.max(dt, 1e-4);
    this.bank += (THREE.MathUtils.clamp(-yawRate * 0.35, -1.1, 1.1) * (this.state === 'fly' ? 1 : 0) - this.bank) * Math.min(1, dt * 5);
    this.animate(dt, hs);
  }
  leap() {
    const c = this.charge; this.charge = 0;
    const dir = Math.hypot(this.vel.x, this.vel.z) > 0.5 ? V(this.vel.x, 0, this.vel.z).normalize() : V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.vel.y = 14 + 62 * c; this.vel.x = dir.x * (10 + 70 * c); this.vel.z = dir.z * (10 + 70 * c);
    this.state = 'air'; this.fromJump = true; this.heldJump = 0; this.leapStretch = 1.16 + 0.14 * c;
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
    this.landSquash = Math.max(0.72, 1 - Math.min(0.28, impact / 90)); this.leapStretch = 1;
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
    if (this.superSpeed) { if (len < 0.2) { if ((this.superIdle += dt) > 0.35) this.endSuper(); } else this.superIdle = 0; }
    const top = this.superSpeed ? d.flyBoost * SUPER_MULT : d.fly + (d.flyBoost - d.fly) * inp.boost;
    const spd = top * len;
    const tgt = dir.multiplyScalar(spd);
    const a = Math.min(1, dt * d.flyAccel * (len > 0 ? (this.superSpeed ? 0.8 : 1) : 0.8));
    this.vel.lerp(tgt, a);
    if (d.style === 'fire' && len === 0) this.vel.y -= 2 * dt;
  }
  animate(dt, hs) {
    const r = this.rig, fly = this.state === 'fly', fire = this.def.style === 'fire', sp = this.vel.length();
    this.flyBlend += ((fly ? Math.min(1, sp / 25) : 0) - this.flyBlend) * Math.min(1, dt * 4);
    const fb = this.flyBlend;
    const climb = fly && sp > 1 ? Math.asin(THREE.MathUtils.clamp(this.vel.y / sp, -1, 1)) : 0;
    this.landSquash += (1 - this.landSquash) * Math.min(1, dt * 8);
    this.leapStretch += (1 - this.leapStretch) * Math.min(1, dt * 5);
    r.root.position.copy(this.pos); r.root.rotation.y = this.yaw;
    if (this.superSpeed && (this.ragdoll || this.state !== 'fly')) this.endSuper();
    if (this.ragdoll && this.useGLB) { this.animateRagdoll(dt); if (this.useSkin) this.animateSkin(dt, 0, 0); return; }

    if (this.useGLB) {
      const run = this.state === 'ground' ? Math.min(1, hs / 8) : 0;
      const breath = this.state === 'ground' && run < 0.15 ? 1 + Math.sin(this.t * 2.4) * 0.015 : 1;
      const crouch = 1 - this.charge * 0.2;
      const sy = Math.max(0.7, this.landSquash * this.leapStretch * crouch * breath);
      const sxz = 1 / Math.sqrt(sy);
      r.squash.scale.set(sxz, sy, sxz);
      const airStretch = this.state === 'air' && this.vel.y > 8 ? THREE.MathUtils.clamp(this.vel.y / 80, 0, 0.12) : 0;
      r.squash.scale.y += airStretch;
      // Flight: Centurion nearly horizontal (80–90°), Tiger a shallower lean (60–70°). Bank with turns.
      const flyPitch = fire ? 1.13 : 1.48;
      const runLean = this.useSkin ? 0 : run * 0.2; // the run clip already leans into the sprint
      const chargeLean = this.charge * 0.5;
      const act = this.action;
      this.upright += ((act && act.type !== 'tackle' ? 1 : 0) - this.upright) * Math.min(1, dt * 10);
      const tackleLean = act && act.type === 'tackle' ? (this.state === 'fly' ? 0.25 : 0.6) : 0;
      r.body.rotation.x = fb * (flyPitch - climb * 0.7) * (1 - 0.75 * this.upright) + chargeLean + runLean + tackleLean;
      r.body.rotation.z = this.bank * (1 - this.upright);
      r.body.rotation.y = 0;
      r.body.position.y = this.hipH;
      if (this.useSkin) this.animateSkin(dt, hs, fb); else this.animateArms(dt, run, fb, r.body.rotation.x);
      if (fire) this.fireFx(dt, fly);
      this.animateMohawk();
      return;
    }

    r.body.rotation.x = fb * (Math.PI / 2 - climb) + (this.charge * 0.5);
    r.body.rotation.z = this.bank;
    r.body.position.y = 0.95 - this.charge * 0.25;
    // limb animation (primitive fallback only)
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
  animateArms(dt, run, fb, bodyPitch) {
    const sh = this.shoulders; if (!sh) return;
    this.phase += dt * (Math.hypot(this.vel.x, this.vel.z) * 0.55 + 1);
    const fire = this.def.style === 'fire', fly = this.state === 'fly', air = this.state === 'air' ? 1 : 0;
    const sw = Math.sin(this.phase) * run * 0.5;
    let rx = sw, lx = -sw, ro = 0.05 + air * 0.35, lo = 0.05 + air * 0.35;
    if (fly) {
      if (fire) { rx = lx = 0.35 * fb; ro = lo = 0.05 + 0.3 * fb; }
      else { rx = -2.95 * fb; ro = 0.02; lx = 0.12 * fb; lo = 0.06; } // Centurion: right fist forward in flight
    }
    if (this.charge > 0) { rx = lx = 0.5 * this.charge; ro = lo = 0.2 * this.charge; }
    const a = this.action;
    if (a) {
      const k = a.t / a.dur, aimPitch = Math.asin(THREE.MathUtils.clamp(this.aim.y, -1, 1));
      const forward = -(Math.PI / 2 + aimPitch + bodyPitch);
      if (a.type === 'blast') { const up = Math.min(1, a.t / 0.12) * (k > 0.8 ? (1 - k) / 0.2 : 1); rx = rx + (forward - rx) * up; ro = -0.08 * up; lx = 0.25; lo = 0.15; }
      else if (a.type === 'punch') {
        if (a.t < 0.13) { rx = 0.7 * (a.t / 0.13); ro = 0.25; } else { const e = Math.min(1, (a.t - 0.13) / 0.06) * (k > 0.75 ? (1 - k) / 0.25 : 1); rx = 0.7 + (forward - 0.7) * e; ro = -0.12 * e; }
        lx = 0.35; lo = 0.2;
      } else if (a.type === 'tackle') { const up = Math.min(1, a.t / 0.15); rx = lx = -2.85 * up; ro = lo = -0.12 * up; }
    }
    const L = (o, v, s) => o + (v - o) * Math.min(1, dt * s), A = this.arm, sp = a ? 30 : 12;
    A.rx = L(A.rx, rx, sp); A.lx = L(A.lx, lx, sp); A.rz = L(A.rz, ro, sp); A.lz = L(A.lz, lo, sp);
    this.applyArms();
  }
  applyArms() {
    const sh = this.shoulders, A = this.arm; if (!sh) return;
    for (const o of sh.R) { o.rotation.x = A.rx; o.rotation.z = -A.rz; }
    for (const o of sh.L) { o.rotation.x = A.lx; o.rotation.z = A.lz; }
  }
  animateRagdoll(dt) {
    const r = this.rig, rd = this.ragdoll;
    r.squash.scale.set(1, 1, 1);
    r.body.quaternion.copy(rd.q);
    // keep the body resting on the ground when lying down (pivot is at the hips)
    const up = _v.set(0, 1, 0).applyQuaternion(rd.q).y;
    r.body.position.y = this.hipH * (0.32 + 0.68 * Math.max(0, up));
    const fl = Math.min(1, rd.flail);
    const A = this.arm, t = this.t;
    A.rx = Math.sin(t * 13.1) * 1.6 * fl - 1.2 * fl; A.lx = Math.sin(t * 11.3 + 1.7) * 1.6 * fl - 1.0 * fl;
    A.rz = 0.6 + Math.sin(t * 9.7) * 0.8 * fl; A.lz = 0.6 + Math.sin(t * 10.9 + 0.6) * 0.8 * fl;
    if (rd.getUp > 0) { const e = Math.min(1, rd.getUp); A.rx *= 1 - e; A.lx *= 1 - e; A.rz *= 1 - e; A.lz *= 1 - e; }
    if (!this.useSkin) this.applyArms();
    if (this.def.style === 'fire') this.fireFx(dt, false);
    this.animateMohawk();
  }
  animateMohawk() {
    const mh = this.rig.mohawks; if (!mh || !mh.nodes.length) return;
    const t = this.t;
    for (let i = 0; i < mh.nodes.length; i++) {
      const n = mh.nodes[i], b = n.userData.baseScale || n.scale;
      const flicker = 0.08 * Math.sin(t * 17 + i) + 0.05 * Math.sin(t * 29 + i * 1.7);
      const wave = 0.14 * Math.sin(t * 22 + i * 2) + 0.04 * Math.sin(t * 7.5);
      n.scale.set(b.x * (1 + flicker), b.y * (1 + wave), b.z * (1 + flicker * 0.8));
      n.rotation.z = Math.sin(t * 11 + i) * 0.06;
      n.rotation.x = Math.sin(t * 8.5 + i * 0.6) * 0.04;
    }
    for (const m of mh.mats) {
      const base = m.userData.baseEmissive || 3;
      m.emissiveIntensity = base * (0.82 + 0.28 * Math.sin(t * 14) + 0.1 * Math.sin(t * 31));
    }
  }
  fireFx(dt, fly) {
    const r = this.rig, fx = this.fx.fire, w = V(), v = V();
    // primitive fallback: shader-flame mohawk flicker
    if (!this.useGLB && r.flameMat) {
      r.flameMat.uniforms.t.value = this.t; r.flames.forEach((f, i) => { const s = 0.8 + Math.sin(this.t * 20 + i * 2) * 0.3 + Math.random() * 0.2; f.scale.set(1, s, 1); });
    }
    const yel = new THREE.Color(3.2, 1.5, 0.3), red = new THREE.Color(2.0, 0.25, 0.03), wht = new THREE.Color(3.4, 2.8, 1.8);
    if (!this.useGLB && r.head && Math.random() < 0.5) { r.head.localToWorld(w.set(0, 0.2, 0)); fx.emit(w, v.set(0, 3, 0).add(this.vel), 0.25, yel, red); }
    if (this.charge > 0) for (const h of [...r.hands, ...r.feet]) { h.getWorldPosition(w); fx.emit(w, v.set((Math.random() - .5) * 3, 2 + Math.random() * 3, (Math.random() - .5) * 3), 0.35, yel, red); }
    const jet = !this.ragdoll && (fly || (this.state === 'air' && this.vel.y > 6));
    if (this.glow) this.glow.intensity += ((jet ? 60 : this.charge * 30) - this.glow.intensity) * Math.min(1, dt * 6);
    // jet direction: opposite to travel (straight down when hovering)
    const back = this.vel.clone(); const sp = back.length(); if (sp > 3) back.multiplyScalar(-1 / sp); else back.set(0, -1, 0);
    if (this.jets) {
      const anchors = [...r.hands, ...r.feet], show = this.visibleFlag && (jet || this.charge > 0.05);
      this.jetMat.uniforms.t.value = this.t;
      for (let i = 0; i < this.jets.length; i++) {
        const m = this.jets[i], a = anchors[i];
        if (!show || !a) { m.visible = false; continue; }
        a.getWorldPosition(m.position); m.visible = true;
        const dirv = jet ? back : V(0, 1, 0);
        m.quaternion.setFromUnitVectors(V(0, 1, 0), dirv);
        const fl = 0.85 + 0.25 * Math.sin(this.t * 31 + i * 1.7) + 0.1 * Math.random();
        const len = jet ? (i < 2 ? 0.9 : 0.75) * (1 + Math.min(2.4, sp / 70)) * (this.superSpeed ? 1.6 : 1) : 0.35 + this.charge * 0.4;
        const rad = (i < 2 ? 1.5 : 1.25) * (this.superSpeed ? 1.3 : 1);
        m.scale.set(rad * fl, len * fl, rad * fl);
      }
    }
    if (!jet) return;
    // particle jets from hands and feet, pushed opposite to travel + trail
    const n = Math.ceil(dt * 420);
    for (const h of [...r.hands, ...r.feet]) for (let i = 0; i < n / 2; i++) {
      h.getWorldPosition(w); w.addScaledVector(this.vel, -Math.random() * dt);
      v.copy(back).multiplyScalar(10 + Math.random() * 8).add(V((Math.random() - .5) * 4, (Math.random() - .5) * 4, (Math.random() - .5) * 4)).addScaledVector(this.vel, 0.85);
      fx.emit(w, v, 0.15 + Math.random() * 0.25, Math.random() < 0.25 ? wht : yel, red);
    }
  }
}
