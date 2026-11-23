import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { sonicBoomSound, jetSound, fireBoomSound, whooshSound, windSound } from './audio.js';
import { Particles } from './effects.js';
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
  tiger: { name: 'TEMPER TIGER', height: 2.13, build: tigerModel, run: 15, sprint: 26, fly: 90, flyBoost: 320, flyAccel: 3.5, turn: 3, tackleSpeed: 210, mass: 1.3,
    capeColor: 0xb01010, style: 'fire' },
  centurion: { name: 'CENTURION', height: 1.83, build: centurionModel, run: 16, sprint: 34, fly: 90, flyBoost: 320, flyAccel: 3.5, turn: 7, style: 'clean', tackleSpeed: 240, mass: 1.0 },
  // the two villains (computer-controlled only, never playable): Centurion's rig + moves, no beams / roar / specials,
  // 700 HP each, flying in Ben's reference pose (chest leading, body ~46 deg from vertical, arms swept back)
  villainA: { name: 'VILLAIN A', height: 1.83, build: centurionModel, run: 16, sprint: 34, fly: 90, flyBoost: 320, flyAccel: 3.5, turn: 7, style: 'clean', tackleSpeed: 240, mass: 1.0,
    villain: true, hp: 700, flyPitch: 0.8, flyHand: 'spread', color: '#d8dce4', thumbTuck: [0.5, 0.3, 0, 0] },
  villainB: { name: 'VILLAIN B', height: 1.83, build: centurionModel, run: 16, sprint: 34, fly: 90, flyBoost: 320, flyAccel: 3.5, turn: 7, style: 'clean', tackleSpeed: 240, mass: 1.0,
    villain: true, hp: 700, flyPitch: 0.8, flyHand: 'spread', color: '#e8c070', thumbTuck: [0.5, 0.3, 0, 0] },
};
export const PLAYABLE = ['tiger', 'centurion'];
export const VILLAINS = ['villainA', 'villainB'];

// Super speed (LS / B while flying): top speed = boost top speed x SUPER_MULT
// Flight banking (rad): max roll ~20 deg cruising, ~27 deg at boost speed
// cape flutter (rad): amplitude a0 hovering -> a0+a1 at boost speed (+a2 beyond), frequency f0 -> f0+f1 Hz
export const CAPE = { a0: 0.05, a1: 0.2, a2: 0.08, f0: 1.1, f1: 4.2 };
// finger layer presets (radians): prox/dist = knuckle / finger curl toward the palm, spread = fan, thumb = thumb curl,
// wrist = hand flex (negative = bent back, palm facing away like a thruster)
export const HAND_POSES = {
  fist:    { prox: 1.5, dist: 1.6, spread: 0, thumb: 0.95, wrist: 0 },
  open:    { prox: -0.12, dist: -0.06, spread: 0.24, thumb: -0.3, wrist: -0.85 }, // Tiger flying: fingers splayed, palms pushed back (Endeavor)
  knife:   { prox: 0.02, dist: 0, spread: -0.03, thumb: 0.3, wrist: 0 },         // Centurion flying: flat blade hands, fingers together
  relaxed: { prox: 0.4, dist: 0.5, spread: 0.04, thumb: 0.3, wrist: 0 },
  claw:    { prox: 0.55, dist: 0.95, spread: 0.28, thumb: 0.45, wrist: -0.25 },
  spread:  { prox: 0.06, dist: 0.05, spread: 0.2, thumb: 0.05, wrist: -0.3 },          // villains flying: open hands trailing behind (pose ref)
};
export const BANK = { gain: 0.32, max: 0.35, boostExtra: 0.12, dead: 0.04, rate: 4 };
const SUPER_MULT = 1.45; // 2.5 (800 m/s) -> 1.9 (608) -> 1.45: Ben "slow it by half" = half the bonus over boost -> 464 m/s (boost 320)
// Tiger's flight jets: an open flaring plume (narrow nozzle at the fist/boot, widening behind), base at origin, tail at +Y
const PLUME_GEO = (() => { const g = new THREE.CylinderGeometry(0.3, 0.075, 1, 18, 10, true); g.translate(0, 0.5, 0); return g; })();
// heat: 0 = idle flicker ... 1 = full boost ... ~2.5 = sonic-boom afterburner. Colour runs orange -> yellow -> white-hot with a
// blue core at high heat; the plume swells and roils harder as heat rises. core = 1 for the inner white/blue cone.
const jetMat = (core) => new THREE.ShaderMaterial({ uniforms: { t: { value: 0 }, heat: { value: 0 }, core: { value: core } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  vertexShader: `varying vec2 vUv; varying float vFac; uniform float t, heat, core; void main(){ vUv = uv; vec3 p = position; float k = uv.y;
    float sw = 1.0 + (0.55 + 0.35 * core) * heat * k * (1.0 - 0.5 * k) + 0.12 * sin(t * 27.0 + k * 13.0 + p.x * 40.0) * k * (0.6 + heat);
    p.xz *= sw; p.x += sin(t * 17.0 + k * 9.0) * 0.035 * k * (1.0 + heat); p.z += cos(t * 13.0 + k * 7.0) * 0.03 * k * (1.0 + heat);
    vec4 mv = modelViewMatrix * vec4(p, 1.0); vec3 n = normalize(normalMatrix * normal); vFac = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec2 vUv; varying float vFac; uniform float t, heat, core; void main(){ float y = vUv.y;
    float n = sin(y * 18.0 - t * (24.0 + 14.0 * heat) + vUv.x * 31.4) * 0.5 + 0.5, n2 = sin(y * 7.0 - t * 15.0 - vUv.x * 12.566) * 0.5 + 0.5;
    float a = pow(1.0 - y, 1.1 + core) * (0.5 + 0.5 * n * n2) * pow(vFac, 1.4) * smoothstep(0.0, 0.06, y + 0.02);
    float h = clamp(heat, 0.0, 2.5);
    vec3 hot = mix(vec3(6.0, 3.6, 1.1), vec3(6.5, 5.6, 4.2), smoothstep(0.5, 1.4, h)); hot = mix(hot, vec3(3.6, 4.6, 8.0), smoothstep(1.2, 2.2, h) * core);
    vec3 c = mix(hot, vec3(4.5, 1.2, 0.18), smoothstep(0.05 + 0.2 * h, 0.55 + 0.25 * h, y)); c = mix(c, vec3(2.2, 0.25, 0.04), smoothstep(0.6, 1.0, y));
    a *= (0.75 + 0.4 * min(h, 1.6)) * (core > 0.5 ? 1.3 : 1.0); gl_FragColor = vec4(c * a, a); }` });
const NO_INP = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, jumpReleased: false, boost: 0, descend: 0, cancelPressed: false };
const _v = new THREE.Vector3();
const lerpAng = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };


// ---------- game-ready GLB models ----------
// Rigged + animated heroes (skeleton, skinned body/cape LOD0+LOD1, mohawk on the head bone, 12 clips).
const SKINNED_FILES = { tiger: './assets/tiger_skinned.glb', centurion: './assets/cent_skinned.glb', villainA: './assets/villain_a_skinned.glb', villainB: './assets/villain_b_skinned.glb' };
// Older unrigged LOD models: only loaded if the rigged file fails (or with ?legacy in the URL).
const MODEL_FILES = {
  tiger: [0, 1, 2].map(i => `./assets/tiger_game_lod${i}_meshopt.glb`),
  centurion: [0, 1, 2].map(i => `./assets/cent_game_lod${i}_meshopt.glb`),
  villainA: [0, 1, 2].map(i => `./assets/cent_game_lod${i}_meshopt.glb`), // (no static fallback of their own: Centurion's)
  villainB: [0, 1, 2].map(i => `./assets/cent_game_lod${i}_meshopt.glb`),
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

const SKIN_LOOPS = new Set(['idle', 'run', 'air', 'fly_hover', 'fly_fast', 'fly_boost', 'tackle', 'fall', 'down', 'sprint_super', 'leg_grabbed_hang']);
// clips whose playhead is driven from game state (attack timers, knockback, get-up progress)
const SKIN_DRIVEN = new Set(['blast', 'punch', 'hit', 'getup', 'crouch', 'counter_kick', 'counter_slam', 'land_boom', 'leg_grab_spin', 'leg_counter_curl_punch']);
// rival AI moves a little faster than the player on the same hero (run / sprint / flight / boost / tackle)
export const AI_SPEED = 1.09;
// grounded super sprint (LS click on the ground): multiple of run speed
// villain sonic boom on boost: cooldown (s), audio reference distance (m: half volume at ~ref)
export const VBOOM = { cd: 4, ref: 60 };
export const SPRINT = { mult: 3.5, accel: 3.2, stopT: 0.22, boomR: 14 };
// superhero 'boom' landing: stop dead, then a short recovery before control returns
export const LANDING = { min: 0.3, max: 0.5, full: 70, softMax: 16 };
// impact speed -> 'momentum' speed fed to the crater/dust scaling (heavier heroes hit harder)
export const momentumSpeed = (speed, mass = 1) => speed * (0.6 + 0.4 * mass);
const AI_KEYS = ['run', 'sprint', 'fly', 'flyBoost', 'tackleSpeed'];
const CHASE_KEYS = ['run', 'sprint', 'fly']; // the chase bonus leaves flyBoost / tackle alone so boosting away still escapes
export const MAX_HP = 1000; // each hero's health (bars and HP numbers show /1000)
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _ax = new THREE.Vector3(), _qI = new THREE.Quaternion();
const _cq = new THREE.Quaternion(), _cp = new THREE.Quaternion(), _cd = new THREE.Quaternion(), _cv = new THREE.Vector3(), _cv2 = new THREE.Vector3(), _cf = new THREE.Vector3(), _cr = new THREE.Vector3(), _cu = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3(), _c4 = new THREE.Vector3();
// ---------- ragdoll joint layer ----------
// Each driven bone gets a 3-DOF offset rotation (bone-local rotation vector) on top of the clip pose, integrated as a
// damped pendulum: gravity, the body's linear/angular acceleration and spin (centrifugal) swing it, a weak spring pulls
// it back toward the pose, and per-joint limits keep it human (elbows/knees are one-way hinges, spine stays modest).
// lim = [xMin, xMax, yMin, yMax, zMin, zMax] in radians; k = spring, c = damping, len = bone reach (m)
const RAG_JOINTS = [
  ['spine', [-0.4, 0.4, -0.3, 0.3, -0.3, 0.3], 30, 5, 0.25],
  ['chest', [-0.3, 0.3, -0.25, 0.25, -0.25, 0.25], 30, 5, 0.2],
  ['upper_chest', [-0.25, 0.25, -0.2, 0.2, -0.2, 0.2], 30, 5, 0.2],
  ['neck', [-0.5, 0.5, -0.6, 0.6, -0.4, 0.4], 14, 4, 0.15],
  ['head', [-0.45, 0.45, -0.5, 0.5, -0.35, 0.35], 14, 4, 0.2],
  ['upper_arm.L', [-1.5, 1.5, -0.7, 0.7, -1.4, 1.4], 3, 2.2, 0.3],
  ['upper_arm.R', [-1.5, 1.5, -0.7, 0.7, -1.4, 1.4], 3, 2.2, 0.3],
  ['forearm.L', 'elbow', 4, 2.4, 0.28],
  ['forearm.R', 'elbow', 4, 2.4, 0.28],
  ['thigh.L', [-1.0, 1.0, -0.35, 0.35, -0.6, 0.6], 6, 3, 0.42],
  ['thigh.R', [-1.0, 1.0, -0.35, 0.35, -0.6, 0.6], 6, 3, 0.42],
  ['shin.L', 'knee', 6, 3, 0.42],
  ['shin.R', 'knee', 6, 3, 0.42],
];
const RAG_CLOTH = ['cape_L1', 'cape_L2', 'cape_L3', 'cape_L4', 'cape_M1', 'cape_M2', 'cape_M3', 'cape_M4', 'cape_R1', 'cape_R2', 'cape_R3', 'cape_R4', 'tail1', 'tail2', 'tail3'];
const _rq = new THREE.Quaternion(), _rqi = new THREE.Quaternion(), _rd = new THREE.Vector3(), _rp = new THREE.Vector3(), _rr = new THREE.Vector3(), _ra = new THREE.Vector3(), _rt = new THREE.Vector3(), _rg = new THREE.Vector3(), _rw = new THREE.Vector3(), _rdw = new THREE.Vector3(), _rhip = new THREE.Vector3();
function buildRagdoll(B, root, clips) {
  const animated = new Set(); for (const c of Object.values(clips)) for (const t of c.tracks) animated.add(t.name.split('.').slice(0, -1).join('.').replace(/[.\s]/g, ''));
  root.updateMatrixWorld(true);
  const toRoot = (bone, local) => root.worldToLocal(bone.localToWorld(local.clone()));
  const joints = [];
  const add = (name, lim, k, c, len, cloth) => {
    const bone = B(name); if (!bone) return;
    let L = lim;
    if (lim === 'elbow' || lim === 'knee') { // find the hinge axis/sign from the rest pose: knees fold the foot back (-Z), elbows bring the hand forward (+Z)
      const want = lim === 'knee' ? -1 : 1, q0 = bone.quaternion.clone(), tip = new THREE.Vector3(0, len, 0);
      let best = null;
      for (const ax of ['x', 'z']) for (const sg of [1, -1]) {
        const e = new THREE.Vector3(); e[ax] = 1; bone.quaternion.copy(q0).multiply(new THREE.Quaternion().setFromAxisAngle(e, 0.5 * sg)); bone.updateMatrixWorld(true);
        const z = toRoot(bone, tip).z; if (!best || z * want > best.z * want) best = { ax, sg, z };
      }
      bone.quaternion.copy(q0); bone.updateMatrixWorld(true);
      const max = lim === 'knee' ? 2.1 : 2.3, s = 0.12;
      L = best.ax === 'x' ? (best.sg > 0 ? [0, max, -s, s, -s, s] : [-max, 0, -s, s, -s, s]) : (best.sg > 0 ? [-s, s, -s, s, 0, max] : [-s, s, -s, s, -max, 0]);
      L.hinge = best.ax + (best.sg > 0 ? '+' : '-');
    }
    joints.push({ name, bone, lim: L, k, c, len, cloth: !!cloth, th: new THREE.Vector3(), w: new THREE.Vector3(), rest: animated.has(name.replace(/[.\s]/g, '')) ? null : bone.quaternion.clone() });
  };
  for (const [n, l, k, c, len] of RAG_JOINTS) add(n, l, k, c, len);
  for (const n of RAG_CLOTH) add(n, n.startsWith('tail') ? [-1.0, 1.0, -0.8, 0.8, -1.0, 1.0] : [-1.4, 1.2, -0.25, 0.25, -0.5, 0.5], 3, 1.6, n.startsWith('tail') ? 0.14 : 0.34, true);
  return { joints, hips: B('hips'), prevVel: new THREE.Vector3(), prevW: new THREE.Vector3(), active: false, w: 0 };
}

// ---------- player beam moves: Centurion eye beam / Tiger roar blast ----------
// Emitters come from the skinned body itself: head-weighted vertices in the bind pose give the face front/height.
function headPoints(scene, headBone, root) {
  root.updateMatrixWorld(true);
  let body = null; scene.traverse(o => { if (o.isSkinnedMesh && !/lod1|cape/i.test(o.name) && (!body || o.geometry.attributes.position.count > body.geometry.attributes.position.count)) body = o; });
  const pts = [];
  if (body) {
    const hi = body.skeleton.bones.indexOf(headBone), g = body.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === hi) w += sw.getComponent(i, k);
      if (w < 0.6) continue;
      v.fromBufferAttribute(pos, i); body.applyBoneTransform(i, v); body.localToWorld(v); root.worldToLocal(v); pts.push(v.clone());
    }
  }
  let y0 = Infinity, y1 = -Infinity, x1 = 0; for (const p of pts) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); x1 = Math.max(x1, Math.abs(p.x)); }
  return { pts, y0, y1, x1, ok: pts.length > 30 };
}
const frontAt = (pts, x, y, dy, dx) => { let best = null; for (const p of pts) if (Math.abs(p.y - y) < dy && Math.abs(p.x - x) < dx && (!best || p.z > best.z)) best = p; return best; };
function emitterOn(headBone, root, p, name) { const o = new THREE.Object3D(); o.name = name; headBone.add(o); o.position.copy(headBone.worldToLocal(root.localToWorld(p.clone()))); return o; }
function findEyes(scene, headBone, root) {
  // authored emitters (eye_emit_L/R empties on the head bone, placed in the sculpted eye sockets) win over the vertex heuristic
  const named = ['eye_emit_R', 'eye_emit_L'].map(n => scene.getObjectByName(n));
  if (named.every(Boolean)) {
    root.updateMatrixWorld(true);
    return named.map(o => root.worldToLocal(o.getWorldPosition(new THREE.Vector3()))).sort((a, b) => a.x - b.x).map(p => emitterOn(headBone, root, p, 'eye'));
  }
  const H = headPoints(scene, headBone, root), out = [];
  if (H.ok) {
    const ey = H.y0 + 0.5 * (H.y1 - H.y0), ex = H.x1 * 0.36;
    for (const sx of [-1, 1]) { const best = frontAt(H.pts, sx * ex, ey, 0.025, 0.02); if (best) out.push(new THREE.Vector3(best.x, best.y, best.z + 0.004)); }
  }
  if (out.length !== 2) { // fallback: offsets from the head bone
    const hp = headBone.getWorldPosition(new THREE.Vector3()); root.worldToLocal(hp);
    out.length = 0; for (const sx of [-1, 1]) out.push(new THREE.Vector3(hp.x + sx * 0.033, hp.y + 0.08, hp.z + 0.1));
  }
  return out.map(p => emitterOn(headBone, root, p, 'eye'));
}
function findMouth(scene, headBone, root) {
  const H = headPoints(scene, headBone, root); let p = null;
  if (H.ok) { const best = frontAt(H.pts, 0, H.y0 + 0.27 * (H.y1 - H.y0), 0.03, 0.025); if (best) p = new THREE.Vector3(best.x, best.y, best.z + 0.01); }
  if (!p) { p = headBone.getWorldPosition(new THREE.Vector3()); root.worldToLocal(p); p.y += 0.03; p.z += 0.12; }
  return emitterOn(headBone, root, p, 'mouth');
}
// Pose specs are model-space offsets from the reference (idle) pose, applied parent-first:
//   rot: pitch about model X (+ = forward) · axis+ang: any model-space axis · dir: aim the bone's +Y along a model-space direction · twist: about the bone's own axis
const EYE_BEAM_POSE = [
  ['spine', { rot: -0.1 }], ['chest', { rot: -0.05 }], ['upper_chest', { rot: -0.04 }],
  ['shoulder.L', { rot: -0.08 }], ['shoulder.R', { rot: -0.08 }],
  ['neck', { rot: 0.24 }], ['head', { rot: -0.14 }],
  ['upper_arm.L', { dir: [0.2, -1, -0.24] }], ['upper_arm.R', { dir: [-0.2, -1, -0.24] }],
  ['forearm.L', { dir: [0.12, -1, -0.34] }], ['forearm.R', { dir: [-0.12, -1, -0.34] }],
  ['hand.L', { dir: [0.06, -1, -0.15] }], ['hand.R', { dir: [-0.06, -1, -0.15] }],
];
// Tiger roar: wind-up (head rears back, chest pulls up, arms drawn back) ...
const ROAR_WINDUP_POSE = [
  ['spine', { rot: -0.16 }], ['chest', { rot: -0.1 }], ['upper_chest', { rot: -0.08 }],
  ['shoulder.L', { axis: [0.2, 0, 1], ang: 0.12 }], ['shoulder.R', { axis: [0.2, 0, -1], ang: 0.12 }],
  ['neck', { rot: -0.18 }], ['head', { rot: -0.38 }],
  ['upper_arm.L', { dir: [0.75, -0.55, -0.38] }], ['upper_arm.R', { dir: [-0.75, -0.55, -0.38] }],
  ['forearm.L', { dir: [0.7, -0.4, 0.2], twist: -0.4 }], ['forearm.R', { dir: [-0.7, -0.4, 0.2], twist: 0.4 }],
  ['hand.L', { dir: [0.45, -0.75, 0.45] }], ['hand.R', { dir: [-0.45, -0.75, 0.45] }],
];
// ... then the roar: chest out, head snapped forward, shoulders hunched, arms out to the sides / slightly forward,
// claws tensed (no finger bones: wrists curled down/in + forearms twisted), legs braced wide with bent knees
const ROAR_POSE = [
  ['spine', { rot: -0.1 }], ['chest', { rot: -0.09 }], ['upper_chest', { rot: -0.09 }],
  ['shoulder.L', { axis: [0.5, 0, 1], ang: 0.24 }], ['shoulder.R', { axis: [0.5, 0, -1], ang: 0.24 }],
  ['neck', { rot: 0.36 }], ['head', { rot: -0.06 }],
  ['upper_arm.L', { dir: [0.86, -0.3, 0.42] }], ['upper_arm.R', { dir: [-0.86, -0.3, 0.42] }],
  ['forearm.L', { dir: [0.5, -0.12, 0.86], twist: -0.55 }], ['forearm.R', { dir: [-0.5, -0.12, 0.86], twist: 0.55 }],
  ['hand.L', { dir: [0.15, -0.8, 0.6], twist: -0.3 }], ['hand.R', { dir: [-0.15, -0.8, 0.6], twist: 0.3 }],
  ['thigh.L', { dir: [0.3, -1, 0.16] }], ['thigh.R', { dir: [-0.3, -1, 0.16] }],
  ['shin.L', { dir: [0.22, -1, -0.12] }], ['shin.R', { dir: [-0.22, -1, -0.12] }],
];
// Build an additive clip: keyframe 0 = reference pose; frames = [poseIndex (-1 = reference), weight] at times[]
function buildPoseClip(B, root, name, poses, times, frames) {
  root.updateMatrixWorld(true);
  const rootQi = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const modelQ = b => rootQi.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  const bones = new Map(); // bone -> { q0, targets[] }
  for (const spec of poses) for (const [n] of spec) { const b = B(n); if (b && !bones.has(b)) bones.set(b, { q0: b.quaternion.clone(), T: [] }); }
  poses.forEach((spec, pi) => {
    for (const [n, s] of spec) {
      const b = B(n); if (!b) continue;
      const qm = modelQ(b); let offM;
      if (s.rot !== undefined) offM = new THREE.Quaternion().setFromAxisAngle(X, s.rot);
      else if (s.axis) offM = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...s.axis).normalize(), s.ang);
      else offM = new THREE.Quaternion().setFromUnitVectors(Y.clone().applyQuaternion(qm), new THREE.Vector3(...s.dir).normalize());
      const offL = qm.clone().invert().multiply(offM).multiply(qm); // model-space rotation expressed in the bone's frame
      if (s.twist) offL.multiply(new THREE.Quaternion().setFromAxisAngle(Y, s.twist));
      const T = b.quaternion.clone().multiply(offL);
      b.quaternion.copy(T); b.updateMatrixWorld(true); bones.get(b).T[pi] = T; // children are posed relative to the new parent pose
    }
    for (const [b, e] of bones) { b.quaternion.copy(e.q0); } root.updateMatrixWorld(true);
  });
  const tracks = [];
  for (const [b, e] of bones) {
    const vals = [];
    for (const [pi, k] of frames) { const T = pi >= 0 && e.T[pi] ? e.T[pi] : e.q0; const q = e.q0.clone().slerp(T, k); vals.push(q.x, q.y, q.z, q.w); }
    tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, vals));
  }
  const clip = new THREE.AnimationClip(name, times[times.length - 1], tracks);
  THREE.AnimationUtils.makeClipAdditive(clip, 0);
  return clip;
}
// per hero: emitter-glow colour, clip, and how the clip time maps to the action (intro, then loop [start, start+period))
const BEAM_MOVES = {
  clean: { clip: 'eye_beam', poses: [EYE_BEAM_POSE], times: [0, 0.12, 0.3, 0.45, 0.6], frames: [[-1, 1], [0, 1], [0, 0.9], [0, 1], [0, 0.9]], loop: [0.12, 0.48] },
  fire: { clip: 'roar_blast', poses: [ROAR_WINDUP_POSE, ROAR_POSE], times: [0, 0.13, 0.24, 0.46, 0.68], frames: [[-1, 1], [0, 1], [1, 1], [1, 0.88], [1, 1]], loop: [0.24, 0.44] },
};
const _hb = new THREE.Vector3(), _hf = new THREE.Vector3(), _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion();
const _jq = new THREE.Quaternion(), _jup = new THREE.Vector3(0, 1, 0), _jp = new THREE.Vector3(), _jv = new THREE.Vector3();
// jet particle colours: yellow, red tail, white-hot, blue core, ember start/end, heat-haze start/end
const _jc = [[3.2, 1.5, 0.3], [2.0, 0.25, 0.03], [3.6, 3.0, 2.2], [1.6, 2.4, 4.2], [1.8, 0.5, 0.07], [0.3, 0.04, 0.0], [0.3, 0.15, 0.06], [0.05, 0.035, 0.03]].map(c => new THREE.Color(...c));

const _fq = new THREE.Quaternion();
// finger bones added by tools/rig/fingers.py: index/middle/ring/pinky/thumb 1-2 per hand + palm_L/R marker empties.
// Axes are derived per bone from the palm marker so the layer doesn't depend on Blender bone roll.
function buildHands(B, scene, A, k) {
  const sides = {}; let v2 = false;
  for (const sd of ['L', 'R']) {
    const hand = B('hand.' + sd), palm = scene.getObjectByName('palm_' + sd);
    if (!hand || !palm || !B('index1.' + sd)) return null;
    const pl = palm.position.clone();                                  // palm marker in hand-bone space
    const palmN = pl.clone().setY(0).normalize();                       // out of the palm, perpendicular to the hand axis
    const fingers = [];
    const idx = B('index1.' + sd).position, mid = B('middle1.' + sd).position, side = idx.clone().sub(mid);
    ['index', 'middle', 'ring', 'pinky', 'thumb'].forEach((nm, j) => {
      let pq = new THREE.Quaternion(); // hand-space rotation of the parent chain
      for (const seg of [1, 2]) {
        const b = B(nm + seg + '.' + sd); if (!b) continue;
        const rest = b.quaternion.clone(); pq = pq.clone().multiply(rest);
        const inv = pq.clone().invert(), p = palmN.clone().applyQuaternion(inv), y = new THREE.Vector3(0, 1, 0);
        p.addScaledVector(y, -p.dot(y)).normalize();
        const curl = y.clone().cross(p).normalize();                    // +angle curls the finger toward the palm
        const sideL = side.clone().applyQuaternion(inv), sgn = Math.sign(p.clone().cross(y).dot(sideL)) || 1;
        const fan = nm === 'thumb' ? 0 : sgn * (1.5 - j) / 1.5;         // index toward the thumb, pinky away
        const ws = Math.sign(p.clone().cross(y).dot(sideL)) || 1;
        const wrap = p.clone().multiplyScalar(-ws);                     // +angle swings the thumb across the fingers (toward the pinky)
        fingers.push({ bone: b, rest, seg, curl, palm: p, fan, wrap, thumb: nm === 'thumb' });
      }
    });
    const wristAx = new THREE.Vector3(0, 1, 0).cross(palmN).normalize();  // +flex toward the palm, - bends the hand back
    const jet = new THREE.Object3D(); jet.name = 'jet' + sd; hand.add(jet);
    const fistPos = new THREE.Vector3(0, 0.07 * k, 0), palmPos = pl.clone(); jet.position.copy(fistPos);
    sides[sd] = { hand, palm, palmN, palmPos, fistPos, fingers, wristAx, jet };
    if (pl.length() < 0.15 * k) v2 = true; // a real palm-centre marker (tools/rig/cent_hands): realistic hands v2
  }
  return { sides, v2, w: { fist: 0, open: 0, knife: 0, relaxed: 1, claw: 0, spread: 0 }, q: { prox: 0, dist: 0, spread: 0, thumb: 0, wrist: 0 } };
}

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
    this.hp = this.def.hp ?? MAX_HP; this.maxHp = this.def.hp ?? MAX_HP; this.invulnT = 0; this.slammedBy = null; this.knockT = 0; this.action = null; this.cd = { blast: 0, tackle: 0, punch: 0, dodge: 0, recover: 0 };
    this.ragdoll = null; this.grabbedBy = null; this.grabbing = null; this.ko = false; this.aim = V(0, 0, 1); this.shoulders = null;
    this.arm = { rx: 0, rz: 0, lx: 0, lz: 0 }; this.upright = 0; this.lastHitT = -99;
    this.superSpeed = false; this.superT = 0; this.superIdle = 0; this.boomKick = 0; this.visibleFlag = true;
    if (this.def.style === 'fire') { // world-space flame jets that follow the hand/foot anchors
      this.jetMat = jetMat(0); this.jetCoreMat = jetMat(1); this.jets = []; this.jetCores = []; this.jetI = 0; this.jetLen = 0; this.jetRate = 0; this.boostBlend = 0;
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(PLUME_GEO, this.jetMat), c = new THREE.Mesh(PLUME_GEO, this.jetCoreMat);
        for (const x of [m, c]) { x.frustumCulled = false; x.castShadow = false; x.visible = false; scene.add(x); }
        m.renderOrder = 3; c.renderOrder = 4; this.jets.push(m); this.jetCores.push(c);
      }
      // hand-attached flame: particles simulated in the hero's own frame (a group that follows this.pos every frame), so the
      // plume stays glued to the palms at any flight speed; a lighter world-space trail is shed behind it
      this.jetGroup = new THREE.Group(); this.jetGroup.name = 'jetGroup'; scene.add(this.jetGroup);
      this.jetPts = new Particles(this.jetGroup, 1600, { additive: true, size: 0.42, drag: 1.2 });
      this.jetDbg = { palm: [0, 0], mesh: [0, 0], spawn: [0, 0], n: 0 };
    }
    if (this.def.style === 'fire') { this.glow = new THREE.PointLight(0xff6020, 0, 30, 1.5); this.rig.body.add(this.glow); this.glow.position.y = 0.4; }
  }
  forceFly() { // used by the AI to get airborne without button sequences
    if (this.state === 'fly') return;
    if (this.def.style === 'fire') { if (this.state === 'ground') { this.vel.y = 30; this.fireBurst(this.pos, 40, 12); } this.startFly(); }
    else { if (this.state === 'ground') this.takeOff(); else this.state = 'fly'; }
  }
  setVisible(v) { this.rig.root.visible = v; this.visibleFlag = v; if (this.glow) this.glow.visible = v; if (this.jetGroup) this.jetGroup.visible = v; if (!v && this.jets) for (const j of [...this.jets, ...this.jetCores]) j.visible = false; }
  // LS while flying: sonic boom, then super speed until you stop flying, let go of the stick, slow down, or press LS again
  get mv() { // movement stats: the rival AI gets AI_SPEED x the player's numbers
    if (this.isPlayer !== false) return this.def;
    const cm = this.chaseMul || 1; // pursuit bonus while chasing a fleeing player (combat.aiInput, PURSUIT): cruise speeds only, never boost
    if (!this._aiDef || this._aiDef.base !== this.def || this._aiDef.cm !== cm) { const m = { ...this.def, base: this.def, cm }; for (const k of AI_KEYS) m[k] = this.def[k] * AI_SPEED * (CHASE_KEYS.includes(k) ? cm : 1); this._aiDef = m; }
    return this._aiDef;
  }
  startSprint() { // grounded super sprint: a small boom on activation
    this.superSprint = true; this.sprintIdle = 0; this.sprintTrailT = 0; this.sprintFoot = 0;
    const fire = this.def.style === 'fire', f = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.vel.x += f.x * this.mv.run * 1.2; this.vel.z += f.z * this.mv.run * 1.2;
    this.fx.shockwave(this.pos, fire ? 0xff7020 : 0xe8e2d0, SPRINT.boomR); this.fx.dustBurst(this.pos, 45, 16);
    if (fire) this.fireBurst(this.pos, 40, 10);
    this.boomKick = 0.6; Hero.onCrash?.(this.pos, 0.22); whooshSound(fire);
  }
  endSprint() { this.superSprint = false; }
  sprintTrail(dt, hs) { // dust trail (+ Tiger's burning footprints)
    if (hs < 12) return;
    this.sprintTrailT -= dt;
    if (this.sprintTrailT <= 0) {
      this.sprintTrailT = 0.035; const b = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.fx.dustBurst(this.pos.clone().addScaledVector(b, 0.8), 3, 2.5 + hs * 0.05);
    }
    if (this.def.style === 'fire') {
      this.sprintFoot += dt * hs / 2.6;
      if (this.sprintFoot >= 1) {
        this.sprintFoot -= 1; this.footSide = -(this.footSide || 1);
        const r = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), fp = this.pos.clone().addScaledVector(r, 0.22 * this.footSide); fp.y += 0.05;
        const v = V(), c0 = new THREE.Color(5, 3, 0.9), c1 = new THREE.Color(3, 0.35, 0.04);
        for (let i = 0; i < 7; i++) { v.set((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2); this.fx.fire.emit(fp, v, 0.7 + Math.random() * 0.6, c0, c1); }
        this.footprints = (this.footprints || 0) + 1;
      }
    }
  }
  sonicBoom(cam) {
    const fire = this.def.style === 'fire';
    const dir = this.vel.lengthSq() > 25 ? this.vel.clone().normalize() : (cam?.forward ? cam.forward.clone() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)));
    this.superSpeed = true; this.superT = 0; this.superIdle = 0; this.boomKick = 1; this.jetKick = 1;
    this.vel.addScaledVector(dir, this.def.flyBoost * 0.6);
    this.fx.sonicBoom(this.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), dir, { fire, follow: this.pos });
    if (fire) { // Temper Tiger: the jets ignite into a huge fireball on top of the sonic boom
      this.fireBurst(this.pos, 120, 30);
      this.fx.fireExplosion?.(this.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), dir, this.pos);
      Hero.onCrash?.(this.pos, this.isPlayer ? 0.9 : 0.6); fireBoomSound();
    }
    sonicBoomSound(fire);
  }
  endSuper() { this.superSpeed = false; this.superIdle = 0; }
  // villains: the same shockwave ring + vapour cone + boom when they kick into boost flight (no super speed: gameplay unchanged);
  // the sound is attenuated by the distance to the camera
  villainBoom() {
    const dir = this.vel.lengthSq() > 25 ? this.vel.clone().normalize() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.fx.sonicBoom(this.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), dir, { fire: false, follow: this.pos });
    const cam = this.fx.viewer, d = cam ? cam.position.distanceTo(this.pos) : 0, vol = 1 / (1 + Math.pow(d / VBOOM.ref, 1.5));
    this.boomCount = (this.boomCount || 0) + 1; this.lastBoom = { d, vol };
    sonicBoomSound(false, vol);
  }

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
    this.anim = { mixer, actions, w, B, bones: [...new Set(Object.values(bones))], lod0, lod1, upperArmR: B('upper_arm.R'), lowNow: null };
    if (this.def.style === 'fire') { // flight thrusters: fists (aimed along the forearms) + boot soles (aimed along the shins)
      const sole = s => attach(B('foot.' + s) || B('toe.' + s), 0, 0.02 * k, 0, 'sole' + s);
      this.jetSrc = [[fists[0], B('forearm.R')], [fists[1], B('forearm.L')], [sole('L'), B('shin.L')], [sole('R'), B('shin.R')]];
    }
    this.anim.hand = buildHands(B, scene, this.anim, k);
    if (this.jetSrc && this.anim.hand) { this.jetSrc[0][0] = this.anim.hand.sides.R.jet; this.jetSrc[1][0] = this.anim.hand.sides.L.jet; }
    mixer.update(0); this.anim.rag = buildRagdoll(B, root, clips);
    const BM = this.def.villain ? null : BEAM_MOVES[this.def.style]; // villains have no beams
    if (BM && B('head')) {
      const head = B('head'), fire = this.def.style === 'fire';
      if (fire) this.mouth = findMouth(scene, head, root); else this.eyes = findEyes(scene, head, root);
      const glowMat = new THREE.MeshBasicMaterial({ color: fire ? new THREE.Color(8, 3, 0.6) : new THREE.Color(4, 5, 6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const sph = new THREE.SphereGeometry(1, 10, 8);
      this.eyeGlows = (fire ? [this.mouth] : this.eyes).map(e => { const m = new THREE.Mesh(sph, glowMat); m.scale.setScalar(0.012); m.renderOrder = 5; m.frustumCulled = false; e.add(m); return m; });
      this.eyeGlowMat = glowMat; this.eyeGlow = 0; this.glowSize = fire ? 0.04 : 0.03;
      const clip = buildPoseClip(B, root, BM.clip, BM.poses, BM.times, BM.frames), act = mixer.clipAction(clip);
      act.blendMode = THREE.AdditiveAnimationBlendMode; act.setLoop(THREE.LoopRepeat, Infinity); act.play(); act.setEffectiveTimeScale(0); act.setEffectiveWeight(0);
      this.anim.beamAct = act; this.anim.beamW = 0; this.anim.beamLoop = BM.loop; this.anim.beamClip = BM.clip;
      root.updateMatrixWorld(true); // face direction in the head bone's frame (model faces +Z)
      this.anim.faceLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    }
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
      else { const fl = Math.min(1, rd.flail) * 0.35; tgt.fall = fl; tgt.down = 1 - fl; } // mostly the limp pose: the joint layer does the flailing
    } else {
      if (this.state === 'ground') {
        const run = Math.min(1, hs / 6); tgt.idle = 1 - run; tgt.run = run;
        if (has('run')) acts.run.setEffectiveTimeScale(THREE.MathUtils.clamp(hs / (this.def.style === 'fire' ? 13 : 15), 0.7, 1.7));
        if (this.superSprint && has('sprint_super')) { // super sprint: forward lean + pumping arms, cadence follows speed
          const sr = THREE.MathUtils.clamp((hs - 8) / 18, 0, 1); tgt.idle *= 1 - sr; tgt.run *= 1 - sr; tgt.sprint_super = sr;
          acts.sprint_super.setEffectiveTimeScale(THREE.MathUtils.clamp(hs / 34, 0.8, 1.9));
        }
        if (this.charge > 0 && has('crouch')) { const c = Math.min(1, this.charge * 2); tgt.idle *= 1 - c; tgt.run *= 1 - c; tgt.crouch = c; drive('crouch', 0.42); }
      } else if (this.state === 'air') tgt.air = 1;
      else if (act && act.beam) { tgt.fly_hover = 1; } // beam in flight: the body stands upright, so drop the cruise pose (Centurion's raised fist) and brace in the hover stance
      else if (has('fly_boost')) { const bz = this.boostBlend; tgt.fly_hover = 1 - fb; tgt.fly_fast = fb * (1 - bz); tgt.fly_boost = fb * bz; } // Tiger: hover -> cruise -> full burn
      else { tgt.fly_hover = 1 - fb; tgt.fly_fast = fb; }
      const hold = act && act.type === 'tackle' && act.mode && act.mode !== 'drive';
      if (act && act.type === 'counter' && has(act.clip)) { over = act.clip; overW = 1; drive(act.clip, act.t); } // grab counter (kick / slam / leg-grab curl punch), flip included
      else if (act && act.type === 'leggrab' && has('leg_grab_spin')) { over = 'leg_grab_spin'; overW = 1; drive('leg_grab_spin', act.t); } // rival: seize the leg, giant swing, fling
      else if (this.legGrabbedBy && has('leg_grabbed_hang')) { over = 'leg_grabbed_hang'; overW = 1; }
      else if (this.state === 'ground' && this.landT > 0 && has('land_boom')) { over = 'land_boom'; overW = 1; drive('land_boom', (1 - this.landT / (this.landDur || 0.4)) * acts.land_boom.getClip().duration); } // superhero landing
      else if (this.flip && has('crouch')) { over = 'crouch'; overW = 0.85; drive('crouch', 0.42); } // tucked during the backflip
      else if (this.grabbedBy && has('fall')) { over = 'fall'; overW = 0.35; }
      else if (hold) { over = null; }
      else if (act && act.beam) { over = null; } // eye beam: locomotion/flight base + additive upper-body clip
      else if (act && has(act.type)) {
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
    if (A.beamAct) { // eye_beam additive layer
      const on = !rd && act && act.beam ? 1 : 0; A.beamW += (on - A.beamW) * Math.min(1, dt * 12);
      A.beamAct.setEffectiveWeight(A.beamW < 1e-3 ? 0 : A.beamW);
      const [l0, lp] = A.beamLoop, bt = act && act.beam ? act.t : l0 + lp; A.beamAct.time = bt < l0 ? bt : l0 + ((bt - l0) % lp);
    }
    A.mixer.update(dt);
    // three's PropertyMixer only writes a bone when the blended clip value CHANGES, so a held pose (driven clip at a fixed
    // time, end of a clamped clip) leaves last frame's procedural edits (wrist flex, arm aim, choke, ragdoll offsets) in the
    // bone and they compound every frame -> spinning hands / twisting arms. Restore the clip pose for bones the mixer skipped.
    const BQ = A.boneBase || (A.boneBase = A.bones.map(b => ({ b, base: b.quaternion.clone(), last: new THREE.Quaternion(NaN, NaN, NaN, NaN) })));
    if (!Hero.debugOld) for (const e of BQ) { if (e.b.quaternion.equals(e.last)) e.b.quaternion.copy(e.base); else e.base.copy(e.b.quaternion); } // Hero.debugOld: tests reproduce the old bugs
    if (A.rag) this.ragdollJoints(dt, A.rag);
    this.capeFlutter(dt, rd);
    if (A.beamAct && A.beamW > 0.01) this.trackHead(A.beamW * (act?.beam && act.t < A.beamLoop[0] ? 0.2 : 1)); // light tracking during the wind-up so the head can rear back
    if (this.eyeGlowMat) { const gl = this.eyeGlow || 0; this.eyeGlowMat.opacity = Math.min(1, gl * 1.2); for (const m of this.eyeGlows) m.scale.setScalar(0.01 + this.glowSize * gl * (0.85 + 0.15 * Math.sin(this.t * 40))); }
    this.chokePose(dt);
    // aim the striking arm at the target (pitch), compensating for whole-body lean
    if (!rd && act && !act.beam && (act.type === 'blast' || act.type === 'punch') && A.upperArmR) {
      const k = A.w[act.type] / Math.max(sum, 1e-3);
      const pitch = Math.asin(THREE.MathUtils.clamp(this.aim.y, -1, 1)) + this.rig.body.rotation.x;
      const bone = A.upperArmR; this.rig.root.updateMatrixWorld(true);
      this.rig.body.getWorldQuaternion(_q1); _ax.set(1, 0, 0).applyQuaternion(_q1);
      bone.parent.getWorldQuaternion(_q2);
      const qw = new THREE.Quaternion().setFromAxisAngle(_ax, -THREE.MathUtils.clamp(pitch, -1.3, 1.3) * k);
      bone.quaternion.premultiply(_q2.clone().invert().multiply(qw).multiply(_q2));
    }
    if (!rd && this.lungeW > 0.01) this.supermanPose(this.lungeW);
    if (A.hand) this.handLayer(dt, rd, act, tgt, sum);
    for (const e of BQ) e.last.copy(e.b.quaternion); // what we left in each bone (compared after the next mixer update)
    // LOD: swap to the decimated meshes (same skeleton) when the camera is far
    if (A.lod1.length) {
      const cam = Hero.viewer; const d = cam ? cam.position.distanceTo(this.pos) : 0;
      const low = this.qualityName === 'Low' ? d > 7 : d > 16;
      if (low !== A.lowNow) { A.lowNow = low; for (const m of A.lod0) m.visible = !low; for (const m of A.lod1) m.visible = low; }
    }
  }
  // Superman punch pose (world-space aims, so it works at any body pitch): punching fist driven forward along the aim,
  // other arm swept back by the hip, legs together trailing behind, head up toward the target
  supermanPose(w) {
    const B = this.anim.B, a = _c1.copy(this.aim).normalize(); this.rig.root.updateMatrixWorld(true);
    const Rt = _cr.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)), U = _cu.set(0, 1, 0);
    const back = _c2.copy(a).multiplyScalar(-1);
    this.aimBone(B('upper_arm.R'), _c3.copy(a).addScaledVector(U, 0.08), w); this.aimBone(B('forearm.R'), a, w); this.aimBone(B('hand.R'), a, w);
    const arm = _c3.copy(back).multiplyScalar(0.8).addScaledVector(Rt, -0.35).addScaledVector(U, -0.25);
    this.aimBone(B('upper_arm.L'), arm, w); this.aimBone(B('forearm.L'), arm, w);
    for (const [sd, k] of [['L', -1], ['R', 1]]) {
      const leg = _c3.copy(back).addScaledVector(Rt, 0.04 * k).addScaledVector(U, -0.12);
      this.aimBone(B('thigh.' + sd), leg, w); this.aimBone(B('shin.' + sd), _c4.copy(back).addScaledVector(U, -0.05 + (k < 0 ? 0.12 : 0)), w);
    }
  }
  // finger layer (after the clips, choke and arm aim): blends hand presets by state.
  // Tiger: open thruster palms in flight, fists for punches / tackles / grabs / counters / on the ground.
  // Centurion: flat knife hands in cruise / fast flight, relaxed when hovering or standing, fists for strikes and grabs.
  handLayer(dt, rd, act, tgt, sum) {
    const H = this.anim.hand, fire = this.def.style === 'fire', P = HAND_POSES, W = H.w;
    const strike = act && !act.beam && (act.type === 'punch' || act.type === 'tackle' || act.type === 'counter' || act.type === 'blast');
    const fast = this.anim.w.fly_fast + (this.anim.w.fly_boost || 0);
    let want;
    if (rd || this.ko) want = 'relaxed';
    else if (this.grabbedBy) want = 'claw';               // clawing at the choking arm
    else if (strike || this.grabbing || this.holdW > 0.3) want = 'fist';
    else if (act && act.beam) want = fire ? 'claw' : 'fist';
    else if (this.state === 'fly') want = fire ? 'open' : (fast > 0.35 ? (this.def.flyHand || 'knife') : H.v2 ? 'fist' : 'relaxed'); // v2 hands: blade in flight, fist when hovering
    else if (this.state === 'air') want = fire || H.v2 ? 'fist' : 'relaxed'; // jumping / falling: Tiger keeps his fists (open palms only while flying); v2 hands (Centurion, villains) clench
    else want = fire || H.v2 ? 'fist' : 'relaxed';
    const k = Math.min(1, dt * (want === 'fist' ? 18 : 9));
    for (const n in W) W[n] += ((n === want ? 1 : 0) - W[n]) * k;
    const q = H.q; for (const f in q) { let v = 0; for (const n in W) v += W[n] * P[n][f]; q[f] = v; }
    this.handOpen = W.open; this.handFist = W.fist; this.handKnife = W.knife; this.handPose = want;
    const TT = H.v2 && this.def.thumbTuck; // villains with the v2 fist GLBs only (Centurion's approved tuck and Tiger don't set it)
    for (const sd of ['L', 'R']) {
      const S = H.sides[sd];
      for (const F of S.fingers) {
        const c = F.thumb ? (q.thumb - (H.v2 ? 0.3 * W.knife : 0)) * (F.seg === 1 ? 0.6 : 1) : (F.seg === 1 ? q.prox : q.dist); // v2 hands: blade thumb stays flat along the index
        F.bone.quaternion.copy(F.rest).multiply(_fq.setFromAxisAngle(F.curl, c));
        if (F.seg === 1) F.bone.quaternion.multiply(_fq.setFromAxisAngle(F.palm, F.fan * q.spread));
        if (F.thumb && TT && W.fist > 0.001) { // thumbTuck [wrap1, wrap2, curl1, curl2] (rad at a full fist): thumb folds across the curled fingers
          F.bone.quaternion.multiply(_fq.setFromAxisAngle(F.curl, TT[F.seg + 1] * W.fist)).multiply(_fq.setFromAxisAngle(F.wrap, TT[F.seg - 1] * W.fist));
        }
      }
      if (q.wrist) S.hand.quaternion.multiply(_fq.setFromAxisAngle(S.wristAx, q.wrist));
      S.jet.position.lerpVectors(S.fistPos, S.palmPos, W.open); // thruster: palm centre when open, past the knuckles when fisted
    }
  }
  // procedural cape flutter layered over the clips while flying: amplitude and frequency grow with speed, gentle when
  // hovering, settles on the ground; skipped while the ragdoll / cloth layer owns the cape bones
  capeFlutter(dt, rd) {
    const A = this.anim;
    if (!A.capes) { A.capes = []; for (const n of RAG_CLOTH) { if (!n.startsWith('cape')) continue; const b = A.B(n); if (b) A.capes.push({ b, ch: n[5], i: +n[6] - 1 }); } A.capeW = 0; A.capePh = 0; }
    if (!A.capes.length) return;
    const sp = this.vel.length(), fly = this.state === 'fly', k = fly ? sp / this.def.flyBoost : this.state === 'air' ? 0.4 * Math.min(1, sp / 60) : 0;
    const want = rd || (A.rag && A.rag.active) ? 0 : fly || this.state === 'air' ? 1 : 0;
    A.capeW += (want - A.capeW) * Math.min(1, dt * 3);
    const kk = Math.min(1.5, k), freq = CAPE.f0 + CAPE.f1 * Math.min(1.2, kk);
    A.capePh += dt * Math.PI * 2 * freq; A.capeAmp = (CAPE.a0 + CAPE.a1 * Math.min(1, kk) + CAPE.a2 * Math.max(0, kk - 1)) * A.capeW;
    if (A.capeW < 0.01 || rd || (A.rag && A.rag.active)) return;
    const off = { L: 0, M: 0.45, R: 0.9 };
    for (const c of A.capes) {
      const a = A.capeAmp * (0.45 + 0.3 * c.i) * (Math.sin(A.capePh - c.i * 1.15 + off[c.ch]) + 0.35 * Math.sin(2.3 * A.capePh - c.i * 1.7 + off[c.ch] * 2));
      c.b.quaternion.multiply(_rq.setFromAxisAngle(_rt.set(1, 0, 0), a));
    }
  }
  ragdollJoints(dt, R) {
    const rd = this.ragdoll, root = this.rig.root;
    const clothOnly = !rd && this.action?.type === 'tackle' && !!this.action.mode && this.action.mode !== 'drive';
    const target = rd ? (rd.getUp > 0 ? Math.pow(1 - Math.min(1, rd.getUp), 2) : 1) : clothOnly ? 1 : 0;
    R.w += (target - R.w) * Math.min(1, dt * (rd ? 12 : 6));
    if (!rd && R.w < 0.01) { if (R.active) { for (const j of R.joints) { j.th.set(0, 0, 0); j.w.set(0, 0, 0); if (j.rest) j.bone.quaternion.copy(j.rest); } R.active = false; } return; }
    if (!R.active) { R.active = true; R.prevVel.copy(this.vel); R.prevW.set(0, 0, 0); for (const j of R.joints) { j.th.set(0, 0, 0); j.w.set(0, 0, 0); } }
    root.updateMatrixWorld(true);
    // body motion in world space: linear acceleration, spin and spin-up (all felt by the limbs as inertial forces)
    const h = Math.max(dt, 1e-3);
    const acc = _ra.copy(this.vel).sub(R.prevVel).divideScalar(h); R.prevVel.copy(this.vel);
    if (acc.length() > 900) acc.setLength(900);
    root.getWorldQuaternion(_rq);
    const wB = _rw.copy(rd ? rd.av : _rt.set(0, 0, 0)).applyQuaternion(_rq);
    const dW = _rdw.copy(wB).sub(R.prevW).divideScalar(h); R.prevW.copy(wB); if (dW.length() > 400) dW.setLength(400);
    const resting = rd && rd.rest > 0.1, floorY = rd?.floor ?? this.pos.y;
    R.hips.getWorldPosition(_rhip);
    const n = dt > 1 / 45 ? 2 : 1, sdt = dt / n;
    const yawF = _rhip.clone(); yawF.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    for (const j of R.joints) {
      if (clothOnly && !j.cloth) { if (j.th.lengthSq() > 0) { j.th.multiplyScalar(Math.exp(-dt * 8)); const a = j.th.length() * R.w; if (a > 1e-4) j.bone.quaternion.multiply(_rq.setFromAxisAngle(_rt.copy(j.th).normalize(), a)); } continue; }
      if (j.rest) j.bone.quaternion.copy(j.rest); // un-animated (cloth) bones: start from their bind pose
      j.bone.getWorldQuaternion(_rq); _rqi.copy(_rq).invert();
      const d = _rd.set(0, 1, 0).applyQuaternion(_rq);
      j.bone.getWorldPosition(_rp);
      const r = _rr.copy(_rp).sub(_rhip).addScaledVector(d, j.len * 0.5);
      // effective acceleration at the limb's centre (inertial frame of the tumbling body)
      const g = _rg.set(0, -32, 0).sub(acc);
      _rt.crossVectors(wB, r); g.sub(_rt.crossVectors(wB, _rt.clone())); g.sub(_rt.crossVectors(dW, r));
      if (j.cloth) g.addScaledVector(this.vel, -1.5).add(_rt.set(0, -10, 0)); // cloth also feels the air rushing past
      if (j.cloth && clothOnly) g.addScaledVector(yawF, -38 - 14 * Math.sin(this.t * 5.3 + j.len * 9)).add(_rt.set(Math.sin(this.t * 3.1) * 8, 10 + 6 * Math.sin(this.t * 4.7 + j.th.x), 0)); // dramatic billow while holding
      const alphaW = _rt.crossVectors(d, g).multiplyScalar(1.5 / j.len);
      // limbs can't sink into the floor: push the tip back up and damp
      const tipY = _rp.y + d.y * j.len; let cdamp = 0;
      if (tipY < floorY + 0.06) { alphaW.add(_rg.crossVectors(d, _rp.set(0, (floorY + 0.06 - tipY) * 900, 0)).multiplyScalar(1 / j.len)); cdamp = 10; }
      const aL = alphaW.applyQuaternion(_rqi);
      const c = j.c + cdamp + (resting ? 9 : 0), k = j.k * (resting ? 1.5 : 1);
      for (let s = 0; s < n; s++) {
        j.w.x += (aL.x - k * j.th.x - c * j.w.x) * sdt; j.w.y += (aL.y - k * j.th.y - c * j.w.y) * sdt; j.w.z += (aL.z - k * j.th.z - c * j.w.z) * sdt;
        if (j.w.length() > 30) j.w.setLength(30);
        j.th.addScaledVector(j.w, sdt);
        const L = j.lim; // joint limits: inelastic stop with a little bounce
        if (j.th.x < L[0]) { j.th.x = L[0]; if (j.w.x < 0) j.w.x *= -0.15; } else if (j.th.x > L[1]) { j.th.x = L[1]; if (j.w.x > 0) j.w.x *= -0.15; }
        if (j.th.y < L[2]) { j.th.y = L[2]; if (j.w.y < 0) j.w.y *= -0.15; } else if (j.th.y > L[3]) { j.th.y = L[3]; if (j.w.y > 0) j.w.y *= -0.15; }
        if (j.th.z < L[4]) { j.th.z = L[4]; if (j.w.z < 0) j.w.z *= -0.15; } else if (j.th.z > L[5]) { j.th.z = L[5]; if (j.w.z > 0) j.w.z *= -0.15; }
      }
      const ang = j.th.length() * R.w;
      if (ang > 1e-5) j.bone.quaternion.multiply(_rq.setFromAxisAngle(_rt.copy(j.th).divideScalar(j.th.length()), ang));
    }
  }
  // eye beam: neck + head turn the face toward the beam's aim point (clamped)
  trackHead(w) {
    const A = this.anim, head = A.B('head'), neck = A.B('neck'); if (!head || !A.faceLocal) return;
    const tgt = this.beamTarget; if (!tgt) return;
    this.rig.root.updateMatrixWorld(true);
    for (const [bone, k] of [[neck, 0.4], [head, 0.6]]) {
      if (!bone) continue;
      head.getWorldPosition(_hb); head.getWorldQuaternion(_hq);
      const face = _hf.copy(A.faceLocal).applyQuaternion(_hq), to = _hb.subVectors(tgt, _hb).normalize();
      let ang = face.angleTo(to); if (ang < 1e-3) continue;
      const lim = Math.min(ang, 0.9) / ang;
      _hq2.setFromUnitVectors(face, to).slerp(_qI, 1 - lim * k * w);
      bone.getWorldQuaternion(_hq); _hq.premultiply(_hq2); bone.parent.getWorldQuaternion(_cp); bone.quaternion.copy(_cp.invert().multiply(_hq)); bone.updateMatrixWorld(true);
    }
  }
  mouthPosition(out) { if (!this.mouth) return null; this.rig.root.updateMatrixWorld(true); return this.mouth.getWorldPosition(out); }
  eyePositions(out) { if (!this.eyes) return null; this.rig.root.updateMatrixWorld(true); return this.eyes.map((e, i) => e.getWorldPosition(out[i])); }
  // ---- choke hold posing on the skinned rig (attacker: arm up gripping the throat, other fist cocked; victim: dangling, clawing) ----
  aimBone(bone, dir, w = 1) {
    if (!bone || w <= 0) return;
    bone.getWorldQuaternion(_cq); const cur = _cv.set(0, 1, 0).applyQuaternion(_cq);
    _cd.setFromUnitVectors(cur, _cv2.copy(dir).normalize()); if (w < 1) _cd.slerp(_qI, 1 - w);
    _cq.premultiply(_cd); bone.parent.getWorldQuaternion(_cp); bone.quaternion.copy(_cp.invert().multiply(_cq)); bone.updateMatrixWorld(true);
  }
  chokePose(dt) {
    const A = this.anim; if (!A) return;
    const B = A.B, act = this.action, t = this.t;
    const F = _cf.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), Rt = _cr.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)), U = _cu.set(0, 1, 0);
    const hold = act && act.type === 'tackle' && act.mode && act.mode !== 'drive' && this.grabbing;
    this.holdW = THREE.MathUtils.clamp((this.holdW || 0) + (hold || (act && act.mode === 'punch' && act.strikeT !== undefined) ? dt * 7 : (Hero.debugOld ? -dt * 5 : -dt * 2.5)), 0, 1);
    const att = Hero.debugOld ? this.holdW : this.holdW * this.holdW * (3 - 2 * this.holdW); // smoothstep: no lurch at either end of the blend
    const live = hold || (act && act.type === 'tackle' && act.mode === 'punch');
    if (att > 0 && !live && this._chokeLast && !Hero.debugOld) { // fading out after the hold / charged punch ends: ease out of the LAST pose,
      const L = this._chokeLast; this.rig.root.updateMatrixWorld(true); // not the default grip (that snapped the arms ~145 deg)
      this.aimBone(B('upper_arm.R'), L.grip, att); this.aimBone(B('forearm.R'), L.grip, att); this.aimBone(B('hand.R'), L.grip, att * 0.8);
      this.aimBone(B('upper_arm.L'), L.up, att); this.aimBone(B('forearm.L'), L.fo, att);
    } else if (att > 0) {
      this.rig.root.updateMatrixWorld(true);
      const spin = act?.mode === 'spin';
      // gripping arm (right): extended up and forward at the victim's throat
      const grip = _c1.copy(F).multiplyScalar(spin ? 0.95 : 0.9).addScaledVector(U, spin ? 0.22 : 0.55).addScaledVector(Rt, 0.04);
      this.aimBone(B('upper_arm.R'), grip, att); this.aimBone(B('forearm.R'), grip, att); this.aimBone(B('hand.R'), grip, att * 0.8);
      // free arm (left): elbow back, fist cocked by the shoulder; charges further back; then the strike
      const c = act?.charge || 0, s = act?.strikeT !== undefined ? Math.min(1, act.strikeT / 0.09) : 0;
      const up = _c2.copy(F).multiplyScalar(-0.55 - 0.45 * c).addScaledVector(U, -0.55 + 0.15 * c).addScaledVector(Rt, -0.45);
      const fo = _c3.copy(F).multiplyScalar(0.45).addScaledVector(U, 0.85).addScaledVector(Rt, 0.12);
      if (s > 0) { const st = _c4.copy(F).addScaledVector(U, 0.3).addScaledVector(Rt, 0.18).normalize(); up.normalize().lerp(st, s); fo.normalize().lerp(st, s); }
      this.aimBone(B('upper_arm.L'), up, att); this.aimBone(B('forearm.L'), fo, att);
      const L = this._chokeLast || (this._chokeLast = { grip: new THREE.Vector3(), up: new THREE.Vector3(), fo: new THREE.Vector3() });
      L.grip.copy(grip); L.up.copy(up); L.fo.copy(fo);
      const sp = B('spine'); if (sp && c > 0) sp.quaternion.multiply(_cd.setFromAxisAngle(_cv.set(0, 1, 0), -0.35 * c * (1 - s) + 0.25 * s)); // twist into the punch
    }
    // victim dangling by the throat
    const g = this.grabbedBy, gm = g?.action?.mode, dangle = g && gm && gm !== 'drive';
    this.dangleW = THREE.MathUtils.clamp((this.dangleW || 0) + (dangle ? dt * 7 : -dt * 6), 0, 1);
    const w = this.dangleW; if (w <= 0) return;
    this.rig.root.updateMatrixWorld(true);
    const spinOut = gm === 'spin' ? Math.min(1.2, Math.abs(g.action.spinRate || 0) * 0.08) : 0;
    const Fv = F, out = _c4.copy(Fv).multiplyScalar(-spinOut); // legs fly outward while being spun
    const sw = Math.sin(t * 2.4) * 0.12, sw2 = Math.sin(t * 2.4 + 1.3) * 0.12, cl = Math.sin(t * 9) * 0.12;
    for (const [side, k] of [['L', -1], ['R', 1]]) {
      const so = _c1.copy(Rt).multiplyScalar(k); // outward on this side
      this.aimBone(B('upper_arm.' + side), _c2.copy(Fv).multiplyScalar(0.6).addScaledVector(U, 0.45 + cl * k).addScaledVector(so, 0.35), w);
      this.aimBone(B('forearm.' + side), _c2.copy(U).multiplyScalar(0.55).addScaledVector(Fv, 0.15).addScaledVector(so, -0.85), w); // hands claw at the arm under the chin
      this.aimBone(B('thigh.' + side), _c2.set(0, -1, 0).addScaledVector(Fv, 0.1 + (k < 0 ? sw : sw2)).add(out).addScaledVector(so, 0.05), w);
      this.aimBone(B('shin.' + side), _c2.set(0, -1, 0).addScaledVector(Fv, -0.08 + (k < 0 ? sw2 : sw) * 0.6).add(out), w);
    }
    this.aimBone(B('neck'), _c2.copy(U).addScaledVector(Fv, -0.35), w * 0.8); // head forced back
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
    const d = this.mv, fire = d.style === 'fire'; this.t += dt;
    const stun = this.knockT > 0; if (stun) { this.knockT -= dt; inp = NO_INP; }
    else if (this.grabbing || this.action?.type === 'counter') inp = NO_INP; // counter: scripted; choke hold / drive: the stick and B pick grab options instead (combat.chokeStep)
    const fwd = cam.flatForward, right = cam.right;
    const wish = V().addScaledVector(fwd, inp.moveY).addScaledVector(right, inp.moveX);
    const prevYaw = this.yaw;

    if (this.landT > 0 && this.state !== 'ground') this.landT = 0; // took off again (forced flight, knockback): recovery over
    if (this.state === 'ground' && this.landT > 0) { // boom landing: planted, no steps or slide until the recovery ends
      this.landT -= dt; this.vel.set(0, 0, 0); this.charge = 0;
    } else if (this.state === 'ground') {
      if (this.superSprint) { // stops on releasing the stick, jumping or attacking
        if (wish.lengthSq() < 0.04) this.sprintIdle += dt; else this.sprintIdle = 0;
        if (this.sprintIdle > SPRINT.stopT || this.action || inp.jumpPressed || this.charge > 0) this.endSprint();
      }
      const tgt = wish.clone().multiplyScalar(this.superSprint ? d.run * SPRINT.mult : inp.boost > 0.3 ? d.sprint : d.run);
      if (this.charge > 0) tgt.multiplyScalar(0.15);
      const k = Math.min(1, dt * (this.superSprint ? SPRINT.accel : 10));
      this.vel.x += (tgt.x - this.vel.x) * k; this.vel.z += (tgt.z - this.vel.z) * k;
      this.vel.y = 0;
      if (this.superSprint) this.sprintTrail(dt, Math.hypot(this.vel.x, this.vel.z));
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
    if (inp.superPressed && !stun) {
      if (this.superSpeed) this.endSuper(); else if (this.state === 'fly') this.sonicBoom(cam);
      else if (this.state === 'ground' && !(this.landT > 0)) { if (this.superSprint) this.endSprint(); else if (!this.action) this.startSprint(); }
    }
    if (this.superSprint && this.state !== 'ground') this.endSprint();
    if (this.superSpeed) {
      this.superT += dt;
      if (this.state !== 'fly' || this.grabbedBy || (this.superT > 0.8 && this.vel.length() < d.flyBoost * 0.5)) this.endSuper();
    }

    // combat movement overrides: tackle dash / carrying a grabbed enemy, punch lunge
    const act = this.action;
    const holding = act && act.type === 'tackle' && act.mode && act.mode !== 'drive';
    if (holding && !stun) { // choke hold: hover in place (a little lift so the victim dangles clear of the ground)
      if (this.state !== 'fly') this.state = 'fly';
      this.vel.multiplyScalar(Math.exp(-dt * 7));
      const fl = city.heightAt(this.pos.x, this.pos.z, 0.5); if (this.pos.y < fl + 1.0) this.vel.y = Math.max(this.vel.y, (fl + 1.0 - this.pos.y) * 4);
    } else if (act && act.type === 'tackle' && !stun) {
      if (this.state !== 'fly') { this.state = 'fly'; if (this.vel.y < 4) this.vel.y = 4; }
      const spd = this.grabbing ? act.carrySpeed : d.tackleSpeed;
      const dir = this.grabbing ? act.carryDir : this.aim;
      this.vel.lerp(_v.copy(dir).multiplyScalar(spd), Math.min(1, dt * (this.grabbing ? 12 : act.homing ? 15 : 9))); // homing tackles follow the re-aimed direction tightly
    }
    // punch dash: drive straight at the target at dash speed (combat.dashStep re-aims and ends it)
    if (act && act.type === 'punch' && act.dash && !stun) {
      if (this.state === 'ground' && this.aim.y > 0.3) { this.state = 'air'; this.fromJump = false; this.pos.y += 0.05; }
      act.dash.used = Math.min(act.dash.speed, act.dash.cap); this.vel.copy(this.aim).multiplyScalar(act.dash.used);
      if (this.state === 'ground') this.vel.y = 0;
    }
    // integrate with substeps for robust collisions
    const steps = Math.max(1, Math.ceil(this.vel.length() * dt / 0.8));
    let floor = 0;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(this.vel, dt / steps);
      const px = this.pos.x, pz = this.pos.z, pvx = this.vel.x, pvz = this.vel.z;
      floor = city.collide(this.pos, this.vel, 0.35 * (fire ? 1.3 : 1));
      const cdx = this.pos.x - px, cdz = this.pos.z - pz, cd = Math.hypot(cdx, cdz);
      if (cd > 1e-4) { // slammed into a building face at speed: dust plume, debris, crater
        const nx = cdx / cd, nz = cdz / cd, into = -(pvx * nx + pvz * nz);
        if (into > 60 && this.t - (this.lastCrashT ?? -9) > 0.35) {
          this.lastCrashT = this.t; const r = 0.35 * (fire ? 1.3 : 1);
          const hp = V(this.pos.x - nx * r, this.pos.y + 1.0, this.pos.z - nz * r), n = V(nx, 0, nz);
          const pw = this.fx.crash(hp, n, momentumSpeed(into, d.mass), 'wall'); this.fx.impact(hp, n, Math.min(2, into / 100), false); Hero.onCrash?.(hp, this.fx.crashShake(pw));
        }
      }
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
    if (holding && act.mode === 'spin') this.yaw += act.spinRate * dt;
    else if (holding) this.yaw = lerpAng(this.yaw, cam.yawFacing, Math.min(1, dt * 6)); // aim the hold (and the throw / punch) with the camera
    else if (act && act.type !== 'tackle' && Math.hypot(this.aim.x, this.aim.z) > 0.1) this.yaw = lerpAng(this.yaw, Math.atan2(this.aim.x, this.aim.z), Math.min(1, dt * 18));
    else if (this.state === 'fly') { if (this.vel.length() > 3) this.yaw = lerpAng(this.yaw, Math.atan2(this.vel.x, this.vel.z), Math.min(1, dt * d.turn)); else this.yaw = lerpAng(this.yaw, cam.yawFacing, dt * 3); }
    else if (hs > 1) this.yaw = lerpAng(this.yaw, Math.atan2(this.vel.x, this.vel.z), Math.min(1, dt * 10));
    const yawRate = (((this.yaw - prevYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) / Math.max(dt, 1e-4);
    // flight banking: roll into turns (left turn = roll left), proportional to the smoothed yaw rate, more at boost speed;
    // none when hovering still, on the ground, or while a move/grab holds the body upright
    this.yawRateF = (this.yawRateF || 0) + (THREE.MathUtils.clamp(yawRate, -6, 6) - (this.yawRateF || 0)) * Math.min(1, dt * 7);
    const bsp = this.vel.length(), bMove = THREE.MathUtils.clamp((bsp - 4) / 16, 0, 1), bFast = THREE.MathUtils.clamp((bsp - d.fly) / (d.flyBoost - d.fly), 0, 1);
    const bMax = BANK.max + BANK.boostExtra * bFast, yr = Math.abs(this.yawRateF) < BANK.dead ? 0 : this.yawRateF - Math.sign(this.yawRateF) * BANK.dead;
    const bankT = this.state === 'fly' && !this.ragdoll ? THREE.MathUtils.clamp(-yr * BANK.gain * (1 + 1.5 * bFast), -bMax, bMax) * bMove : 0;
    this.bank += (bankT - this.bank) * Math.min(1, dt * BANK.rate);
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
  land() { // superhero 'boom' landing: plant on the spot (no slide / run-out steps), impact scaled by momentum
    const impact = Math.max(0, -this.vel.y), hs = Math.hypot(this.vel.x, this.vel.z), wasFly = this.state === 'fly'; this.state = 'ground';
    const sp = Math.hypot(impact, hs * 0.5), mom = momentumSpeed(sp, this.def.mass);
    this.landSquash = Math.max(0.72, 1 - Math.min(0.28, impact / 90)); this.leapStretch = 1;
    this.sprintT = 0; this.charge = 0;
    const boom = wasFly || impact > LANDING.softMax; // from flight or a real fall: boom landing. A hop / stepping off a ledge: soft landing, keep walking
    if (boom) {
      this.vel.set(0, 0, 0); this.endSprint();
      const f = THREE.MathUtils.clamp(sp / LANDING.full, 0, 1);
      this.landDur = this.landT = LANDING.min + (LANDING.max - LANDING.min) * f;
    } else { this.vel.y = 0; const c = Math.min(1, (this.superSprint ? this.mv.run * SPRINT.mult : this.mv.sprint) / Math.max(hs, 1e-3)); this.vel.x *= c; this.vel.z *= c; }
    this.lastLanding = { impact, hs, mom, boom, dur: boom ? this.landDur : 0, t: this.t };
    const g = this.pos.clone();
    if (mom > 14) this.fx.shockwave(g, this.def.style === 'fire' ? 0xff7020 : 0xe8e2d0, Math.min(46, 4 + mom * 0.32)); // impact ring
    const pw = this.fx.crash(g, V(0, 1, 0), mom, 'ground'); // dust + debris + crater, all scaled continuously
    if (pw) Hero.onCrash?.(g, this.fx.crashShake(pw));
  }
  fireBurst(p, n, s) {
    const v = V(), c0 = new THREE.Color(5, 3, 0.9), c1 = new THREE.Color(3, 0.35, 0.04);
    for (let i = 0; i < n; i++) { v.set((Math.random() - 0.5) * s * 2, Math.random() * s * 0.5, (Math.random() - 0.5) * s * 2); this.fx.fire.emit(p, v, 0.4 + Math.random() * 0.5, c0, c1); }
  }
  flyUpdate(dt, inp, cam) {
    const d = this.mv;
    const dir = V().addScaledVector(cam.forward, inp.moveY).addScaledVector(cam.right, inp.moveX);
    dir.y += (inp.jump ? 1 : 0) - inp.descend;
    const len = Math.min(1, dir.length()); if (len > 0) dir.normalize();
    if (this.superSpeed) { if (len < 0.2) { if ((this.superIdle += dt) > 0.35) this.endSuper(); } else this.superIdle = 0; }
    if (this.def.villain) { // boost kicked in (rising edge, moving, cooldown): sonic boom
      this.boomCd = Math.max(0, (this.boomCd || 0) - dt);
      if (inp.boost > 0.5 && !(this.prevBoost > 0.5) && len > 0.2 && this.boomCd <= 0 && this.visibleFlag !== false) { this.villainBoom(); this.boomCd = VBOOM.cd; }
      this.prevBoost = inp.boost;
    }
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
    if (fire) { // 0 = cruising ... 1 = full burn (boost speed and above, or the sonic boom); drives the fly_boost clip + body pitch
      const bt = fly ? (this.superSpeed ? 1 : THREE.MathUtils.clamp((sp - 120) / (this.def.flyBoost - 160), 0, 1)) : 0;
      this.boostBlend += (bt - this.boostBlend) * Math.min(1, dt * 3);
    }
    this.jetKick = Math.max(0, (this.jetKick || 0) - dt * 1.1); // sonic-boom afterburner spike (boomKick is consumed by the camera)
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
      const flyPitch = fire ? 0.45 + 0.15 * this.boostBlend : (this.def.flyPitch ?? 1.48); // Tiger: near-upright jet stance (~26 deg lean cruising, ~34 deg at full burn)
      const runLean = this.useSkin ? 0 : run * 0.2; // the run clip already leans into the sprint
      const chargeLean = this.charge * 0.5;
      const act = this.action;
      const hold = act && act.type === 'tackle' && act.mode && act.mode !== 'drive', grabbed = !!this.grabbedBy && this.grabbedBy.action?.mode && this.grabbedBy.action.mode !== 'drive';
      this.upright += (((act && (act.type !== 'tackle' || hold)) || grabbed || this.flip ? 1 : 0) - this.upright) * Math.min(1, dt * 10);
      const tackleLean = act && act.type === 'tackle' && !hold ? (this.state === 'fly' ? 0.25 : 0.6) : 0;
      r.body.rotation.x = fb * (fire ? Math.max(0.05, flyPitch - climb * 0.35) : flyPitch - climb * 0.7) * (1 - 0.75 * this.upright) + chargeLean + runLean + tackleLean;
      r.body.rotation.z = this.bank * (1 - this.upright);
      if (this.dangleW > 0) r.body.rotation.x = r.body.rotation.x * (1 - this.dangleW) - 0.12 * this.dangleW; // dangling: slight lean back from the throat
      if (this.slammedBy && this.slamPitch) { r.body.rotation.x = this.slamPitch; r.body.rotation.z = 0; } // swung over Tiger's head by the wrists (combat.slamCarry)
      if (this.legGrabbedBy && this.legAlpha !== undefined) { r.body.rotation.x = this.legAlpha; r.body.rotation.z = 0; } // held by the ankle: laid out along the giant swing (combat.legSwingStep)
      if (this.faceSlamPitch !== undefined && this.grabbedBy) { r.body.rotation.x = this.faceSlamPitch; r.body.rotation.z = 0; } // face slam: driven face-first at the ground
      if (this.slamLean) r.body.rotation.x += this.slamLean; // ...by the attacker diving over them
      r.body.rotation.y = 0;
      // Superman punch lunge: stretch out along the dash (pitch the body toward the aim), eased in/out
      const lng = act && act.type === 'punch' && act.lunge && !act.done ? 1 : 0;
      this.lungeW = (this.lungeW || 0) + (lng - (this.lungeW || 0)) * Math.min(1, dt * (lng ? 14 : 7));
      if (this.lungeW > 0.001) { const lp = THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(this.aim.y, -1, 1)), 0.3, this.state === 'ground' ? 1.2 : 1.5);
        r.body.rotation.x += (lp - r.body.rotation.x) * this.lungeW; r.body.rotation.z *= 1 - this.lungeW; }
      const bz = r.body.rotation.z, bx = r.body.rotation.x; // bank: roll about the travel axis AFTER the pitch (Rz * Rx), so a near-horizontal Centurion rolls instead of swivelling
      if (Math.abs(bz) > 1e-4 && !this.flip) r.body.quaternion.setFromAxisAngle(_ax.set(0, 0, 1), bz).multiply(_q2.setFromAxisAngle(_ax.set(1, 0, 0), bx));
      r.body.position.y = this.hipH;
      if (this.flip) { // recovery backflip: unwind the tumble, full backwards rotation, end upright
        const f = this.flip; f.t += dt; const u = Math.min(1, f.t / f.dur), e = u * u * (3 - 2 * u);
        _q1.copy(f.q0).slerp(_qI, Math.min(1, f.t / 0.16));
        r.body.quaternion.copy(_q1).multiply(_q2.setFromAxisAngle(_ax.set(1, 0, 0), -Math.PI * 2 * e));
        if (u >= 1) { this.flip = null; r.body.rotation.set(0, 0, 0); }
      }
      if (this.ragBlend) { // grabbed out of a ragdoll tumble (combat.grab): ease from the tumble pose into the held pose
        const b = this.ragBlend; b.t += dt; const u = Math.min(1, b.t / b.dur), e = u * u * (3 - 2 * u);
        r.body.quaternion.copy(_q1.copy(b.q).slerp(r.body.quaternion, e)); r.body.position.y = b.y + (this.hipH - b.y) * e;
        if (u >= 1 || this.ragdoll) this.ragBlend = null;
      }
      if (this.useSkin) this.animateSkin(dt, hs, fb); else this.animateArms(dt, run, fb, r.body.rotation.x);
      if (fire) this.fireFx(dt, fly); else this.windAudio(fly);
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
      if (a.type === 'blast' && a.beam) { rx = lx = -0.25; ro = 0.2; lo = 0.2; }
      else if (a.type === 'blast') { const up = Math.min(1, a.t / 0.12) * (k > 0.8 ? (1 - k) / 0.2 : 1); rx = rx + (forward - rx) * up; ro = -0.08 * up; lx = 0.25; lo = 0.15; }
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
      const wave = 0.14 * Math.sin(t * 22 + i * 2) + 0.04 * Math.sin(t * 7.5), flare = this.eyeGlow || 0; // roar: mohawk flares up
      n.scale.set(b.x * (1 + flicker) * (1 + 0.25 * flare), b.y * (1 + wave) * (1 + 0.8 * flare), b.z * (1 + flicker * 0.8) * (1 + 0.25 * flare));
      n.rotation.z = Math.sin(t * 11 + i) * 0.06;
      n.rotation.x = Math.sin(t * 8.5 + i * 0.6) * 0.04;
    }
    for (const m of mh.mats) {
      const base = m.userData.baseEmissive || 3;
      m.emissiveIntensity = base * (0.82 + 0.28 * Math.sin(t * 14) + 0.1 * Math.sin(t * 31)) * (1 + 2.2 * (this.eyeGlow || 0));
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
    // jet intensity: rises continuously with speed, peaks hard on the sonic boom / super speed, gentle flicker when hovering
    const sp = this.vel.length(), spN = sp / this.def.flyBoost;
    const want = jet ? 0.22 + 0.78 * Math.min(1, spN) + 0.5 * THREE.MathUtils.clamp(spN - 1, 0, 1.5) + (this.superSpeed ? 0.6 : 0) + 1.2 * (this.jetKick || 0) : 0;
    this.jetI += (want - this.jetI) * Math.min(1, dt * (want > this.jetI ? 10 + 25 * (this.jetKick || 0) : 4)); // the boom slams the jets open instantly
    const I = this.jetI, flick = 1 + (0.1 + 0.12 * Math.max(0, 0.6 - I)) * Math.sin(this.t * 23) + 0.06 * Math.sin(this.t * 41.7) + 0.05 * Math.random();
    if (this.glow) {
      this.glow.intensity += ((jet ? (22 + 55 * I) * flick : this.charge * 30) - this.glow.intensity) * Math.min(1, dt * 8);
      this.glow.distance = 30 + 18 * Math.min(2, I); this.glow.color.setRGB(1, 0.38 + 0.3 * Math.min(1, I / 2), 0.12 + 0.45 * THREE.MathUtils.clamp(I - 1, 0, 1));
    }
    this.jetAudio(I * (jet ? 1 : 0));
    // jet direction: opposite to travel (straight down when hovering), steered by the limb it comes out of
    const back = this.vel.clone(); if (sp > 3) back.multiplyScalar(-1 / sp); else back.set(0, -1, 0);
    const anchors = [...r.hands, ...r.feet], src = this.useSkin && this.jetSrc, dirs = this._jd || (this._jd = [V(), V(), V(), V()]);
    for (let i = 0; i < 4; i++) {
      const d = dirs[i];
      if (src && src[i][1]) {
        src[i][1].getWorldQuaternion(_jq); d.set(0, 1, 0).applyQuaternion(_jq);
        const S = i < 2 && this.anim?.hand?.sides[i ? 'L' : 'R'], o = S ? this.handOpen || 0 : 0;
        if (o > 0.01) { S.hand.getWorldQuaternion(_jq); _jv.copy(S.palmN).applyQuaternion(_jq); d.multiplyScalar(1 - o).addScaledVector(_jv, o); } // open hand: fire out of the palm
        d.addScaledVector(back, 0.3 + 0.9 * Math.min(1, sp / 220)).normalize();
      }
      else d.copy(back);
    }
    // hand thrusters come out of the palm marker when the hand is open (fist position when clenched), updated every frame
    // after the mixer + procedural layers (fireFx runs after animateSkin)
    if (src && this.anim?.hand) for (const sd of ['R', 'L']) { const S = this.anim.hand.sides[sd]; S.jet.position.lerpVectors(S.fistPos, S.palmPos, Math.min(1, (this.handOpen || 0) * 1.25)); }
    if (this.jetGroup) { this.jetGroup.position.copy(this.pos); this.jetGroup.visible = this.visibleFlag; this.jetGroup.updateMatrixWorld(true); this.jetPts.update(dt, 3); }
    if (this.jets) {
      const show = this.visibleFlag && (jet || this.charge > 0.05);
      for (const M of [this.jetMat, this.jetCoreMat]) { M.uniforms.t.value = this.t; M.uniforms.heat.value = jet ? I : 0.1; }
      this.jetLen = 0;
      for (let i = 0; i < this.jets.length; i++) {
        const m = this.jets[i], c = this.jetCores[i], a = src ? src[i][0] : anchors[i];
        if (!show || !a) { m.visible = c.visible = false; continue; }
        a.getWorldPosition(m.position); c.position.copy(m.position); m.visible = c.visible = true;
        m.quaternion.setFromUnitVectors(_jup, jet ? dirs[i] : _jup); c.quaternion.copy(m.quaternion);
        const fl = flick * (0.92 + 0.12 * Math.sin(this.t * 31 + i * 1.7) + 0.06 * Math.random()), foot = i < 2 ? 1 : 0.75;
        const len = jet ? (0.7 + 3.4 * I) * foot : 0.35 + this.charge * 0.4, rad = jet ? (0.8 + 0.35 * Math.min(2, I)) * foot : 0.6;
        m.scale.set(rad * fl, len * fl, rad * fl); c.scale.set(rad * 0.42 * fl, len * (0.45 + 0.08 * Math.min(2, I)) * fl, rad * 0.42 * fl);
        this.jetLen = Math.max(this.jetLen, len);
      }
    }
    if (!jet) { this.jetRate = 0; return; }
    // particle jets, pushed out along each thruster + trail; denser, faster and hotter with intensity
    const low = this.qualityName === 'Low' ? 0.5 : 1, rate = Math.min(700, 50 + 250 * I) * low; this.jetRate = rate * 4;
    this._jAcc = (this._jAcc || 0) + rate * dt; const n = Math.floor(this._jAcc); this._jAcc -= n;
    const blu = _jc[3], hotP = THREE.MathUtils.clamp(0.15 + 0.3 * I, 0, 0.8);
    const JD = this.jetDbg; if (JD) JD.n = 0;
    for (let k = 0; k < 4; k++) {
      const h = src ? src[k][0] : anchors[k]; if (!h) continue; h.getWorldPosition(_jp); const d = dirs[k], foot = k < 2 ? 1 : 0.7;
      if (JD && k < 2 && src) { const S = this.anim?.hand?.sides[k ? 'L' : 'R']; if (S) { S.palm.getWorldPosition(_jv); JD.palm[k] = _jp.distanceTo(_jv); JD.mesh[k] = this.jets[k].visible ? this.jets[k].position.distanceTo(_jv) : -1; } }
      for (let i = 0; i < n * foot; i++) {
        const s = (12 + 24 * I) * (0.7 + 0.6 * Math.random()), sprd = 1.5 + 1.8 * I, r0 = Math.random(), life = (0.12 + Math.random() * 0.22) * (0.8 + 0.25 * Math.min(2, I));
        const c0 = r0 < hotP * 0.35 && I > 1.2 ? blu : r0 < hotP ? _jc[2] : _jc[0];
        v.copy(d).multiplyScalar(s).add(_jv.set((Math.random() - .5) * sprd, (Math.random() - .5) * sprd, (Math.random() - .5) * sprd));
        if (this.jetPts && i % 4 !== 3) { // attached core: spawned exactly at the thruster in the hero frame, no velocity lag
          w.copy(_jp).sub(this.pos); this.jetPts.emit(w, v, life * 0.8, c0, _jc[1]);
          if (JD && k < 2) { JD.spawn[k] = w.add(this.jetGroup.position).distanceTo(_jp); JD.n++; }
        } else fx.emit(w.copy(_jp), v.addScaledVector(this.vel, 1), life * 0.6, c0, _jc[1]); // world trail shed behind, starting at the hand
      }
      // embers: a few long-lived sparks shed from the plume
      if (Math.random() < dt * (3 + 14 * I) * foot) {
        w.copy(_jp).addScaledVector(d, Math.random() * 0.6 * (0.55 + 3.1 * I));
        v.copy(d).multiplyScalar(4 + 6 * Math.random()).add(_jv.set((Math.random() - .5) * 6, 1 + Math.random() * 4, (Math.random() - .5) * 6)).addScaledVector(this.vel, 0.9);
        this.fx.spark.emit(w, v, 0.5 + Math.random() * 0.6, _jc[4], _jc[5]);
      }
      // heat shimmer: faint dim haze rising off the plume (no smoke)
      if (low > 0.5 && Math.random() < dt * (2 + 10 * I)) {
        w.copy(_jp).addScaledVector(d, (0.3 + Math.random()) * (0.55 + 3.1 * I) * 0.6);
        fx.emit(w, v.set((Math.random() - .5) * 2, 2 + Math.random() * 3, (Math.random() - .5) * 2).addScaledVector(this.vel, 0.7), 0.4 + Math.random() * 0.4, _jc[6], _jc[7]);
      }
    }
  }
  // Centurion's flight wind (the hero you control only, only while flying): volume + pitch follow flight speed
  windAudio(fly) {
    const mine = Hero.audioHero === this && this.visibleFlag && !this.def.villain && this.def.style !== 'fire';
    const k = mine && fly && !this.ragdoll && !this.ko ? this.vel.length() / this.def.flyBoost : 0;
    this.windLevel = k;
    if (k < 0.004) { if (this.windSnd) this.windSnd.set(0); return; }
    if (!this.windSnd) { this.windSnd = windSound(); if (!this.windSnd) return; }
    this.windSnd.set(k);
  }
  silence() { this.jetSnd?.set(0); this.windSnd?.set(0); this.windLevel = 0; }
  // looping flame roar for the hero you control; volume/brightness follow the jet intensity
  jetAudio(level) {
    const mine = Hero.audioHero === this && this.visibleFlag;
    if (!mine || level < 0.01) { if (this.jetSnd) this.jetSnd.set(0); return; }
    if (!this.jetSnd) { this.jetSnd = jetSound(); if (!this.jetSnd) return; }
    this.jetSnd.set(level);
  }
}
