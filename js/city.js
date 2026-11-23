import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roadTexture, pavingTexture, grassTexture, worldDetail } from './citytex.js';
import { facadeMaterial } from './facade.js';
// Procedural coastal city, GTA-style street detail: textured asphalt with markings/crossings/manholes/drains, raised
// kerbed pavements with paving slabs, buildings with per-face window layouts (glass / concrete / brick / stucco),
// shopfronts + awnings, cornices, parapet walls, rooftop plant rooms / AC units / water tanks / masts, street lamps,
// traffic lights, benches, bins, hydrants and trees. Plain beige sand dunes all around the city and in the old river
// channel (under the bridges). Exposes heightAt(), collide() (both include the dunes) and groundAt() for hero physics. Every collision box top matches the visible surface
// (roof deck, parapet, kerb), so heroes stand exactly on what they see.
export const BLOCK = 80, ROAD = 18, GRID = 40; // 40x40 blocks = 3.2km square
export const HALF = GRID * BLOCK / 2;
export const RIVER_I = 30;
export const RIVER_X0 = -HALF + RIVER_I * BLOCK + ROAD, RIVER_X1 = -HALF + (RIVER_I + 1) * BLOCK;
export const SW = 2.2, KERB = 0.15; // pavement strip inside the road band, kerb height
const SAND_E = 15000; // the dunes reach the horizon (fog hides the far edge)

// Sand dunes: one flat-colour low-poly height grid over everything outside the city square + the river channel.
// Ticks are 40 m near the city, growing geometrically towards the horizon; the dunes start flat at street level at the
// city edge and rise gently (<= ~6 m) further out. groundAt() interpolates the SAME triangles, so feet match the mesh.
function duneFn(x, z) {
  const d = Math.max(Math.abs(x), Math.abs(z)) - HALF; if (d <= 40) return 0;
  const t = Math.min(1, (d - 40) / 560), a = 6.5 * t * t * (3 - 2 * t);
  const n = 0.5 + 0.5 * (0.55 * Math.sin(x * 0.0061 + z * 0.0023 + 1.3) + 0.3 * Math.sin(-x * 0.0029 + z * 0.0074 + 0.4) + 0.15 * Math.sin((x + z) * 0.0131 + 2.1));
  return a * Math.pow(Math.max(0, n), 1.4);
}
function sandTicks() {
  const t = new Set([RIVER_X0, RIVER_X1]);
  for (let v = -HALF - 1200; v <= HALF + 1200; v += 40) t.add(v);
  for (let v = HALF + 1200, st = 40; v < SAND_E; st *= 1.3, v += st) { t.add(Math.min(v, SAND_E)); t.add(-Math.min(v, SAND_E)); }
  t.add(SAND_E); t.add(-SAND_E); return [...t].sort((a, b) => a - b);
}
const inCity = (x, z) => x > -HALF + 1e-3 && x < HALF - 1e-3 && z > -HALF + 1e-3 && z < HALF - 1e-3;
const isRiver = x => x > RIVER_X0 - 1e-3 && x < RIVER_X1 + 1e-3;

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// quad on y with world-space UVs (u = x/BLOCK) so the street grid lines up anywhere
function landQuad(x0, x1, z0, z1, mat, y = 0) {
  const g = new THREE.BufferGeometry();
  const P = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1];
  const U = [(x0 + HALF) / BLOCK, (z0 + HALF) / BLOCK, (x1 + HALF) / BLOCK, (z0 + HALF) / BLOCK, (x1 + HALF) / BLOCK, (z1 + HALF) / BLOCK, (x0 + HALF) / BLOCK, (z1 + HALF) / BLOCK];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3)); g.setIndex([0, 2, 1, 0, 3, 2]);
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}

// tiny geometry builder for the merged pavement / kerb / grass surfaces (world-space UVs)
class GB {
  constructor(uvScale) { this.p = []; this.n = []; this.u = []; this.i = []; this.s = uvScale; }
  top(x0, x1, z0, z1, y) { if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return; const b = this.p.length / 3, s = this.s;
    this.p.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1); this.n.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    this.u.push(x0 / s, z0 / s, x1 / s, z0 / s, x1 / s, z1 / s, x0 / s, z1 / s); this.i.push(b, b + 2, b + 1, b, b + 3, b + 2); }
  // vertical face along x (nz = +-1) or along z (nx = +-1)
  side(x0, z0, x1, z1, y0, y1, nx, nz) { const b = this.p.length / 3, s = this.s, L = Math.hypot(x1 - x0, z1 - z0) / s;
    this.p.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0); for (let k = 0; k < 4; k++) this.n.push(nx, 0, nz);
    this.u.push(0, y0 / s, L, y0 / s, L, y1 / s, 0, y1 / s);
    const flip = (nx * (z1 - z0) - nz * (x1 - x0)) < 0; // keep the face pointing outwards
    if (flip) this.i.push(b, b + 1, b + 2, b, b + 2, b + 3); else this.i.push(b, b + 2, b + 1, b, b + 3, b + 2); }
  ring(ox0, ox1, oz0, oz1, ix0, ix1, iz0, iz1, y) { this.top(ox0, ox1, oz0, iz0, y); this.top(ox0, ox1, iz1, oz1, y); this.top(ox0, ix0, iz0, iz1, y); this.top(ix1, ox1, iz0, iz1, y); }
  mesh(mat) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setIndex(this.i); g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m; }
}

// merged, vertex-coloured street furniture models (original, built from primitives). Arm / face points +z.
function colored(geo, hex) { const g = geo.index ? geo.toNonIndexed() : geo; const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let k = 0; k < n; k++) c.toArray(a, k * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g; }
function at(geo, x, y, z, rx = 0, ry = 0, rz = 0) { geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x, y, z); return geo; }
function furnitureModels() {
  const POLE = 0x2f3437, M = {};
  const cyl = (r0, r1, h, seg = 6) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, true);
  const lens = (w, d) => { const g = new THREE.PlaneGeometry(w, d); return g; };
  M.lamp = mergeGeometries([
    colored(at(cyl(0.07, 0.11, 8), 0, 4, 0), POLE),
    colored(at(cyl(0.16, 0.2, 0.5), 0, 0.25, 0), POLE),
    colored(at(cyl(0.045, 0.045, 2.4, 4), 0, 7.85, 1.15, Math.PI / 2 + 0.12), POLE),
    colored(at(new THREE.BoxGeometry(0.34, 0.14, 0.75), 0, 7.95, 2.35), 0x3a3f43),
    colored(at(lens(0.26, 0.6), 0, 7.875, 2.35, Math.PI / 2), 0xfff4d8),
  ]);
  M.signal = mergeGeometries([
    colored(at(cyl(0.09, 0.12, 6.2), 0, 3.1, 0), 0x2b2e30),
    colored(at(cyl(0.06, 0.07, 5.5, 4), 0, 5.9, 2.75, Math.PI / 2), 0x2b2e30),
    colored(at(new THREE.BoxGeometry(0.38, 1.05, 0.3), 0, 5.35, 4.9), 0x111214),
    colored(at(lens(0.2, 0.2), 0, 5.7, 5.06), 0x5a0c08), colored(at(lens(0.2, 0.2), 0, 5.37, 5.06), 0x4a3405), colored(at(lens(0.2, 0.2), 0, 5.04, 5.06), 0x2bd46a),
    colored(at(new THREE.BoxGeometry(0.34, 0.95, 0.28), 0, 3.0, 0.22), 0x111214),
    colored(at(lens(0.22, 0.22), 0, 2.85, 0.37), 0xd9d6c8),
    colored(at(new THREE.BoxGeometry(0.22, 0.32, 0.18), 0.18, 1.1, 0), 0xd2b23a), // crossing button box
  ]);
  M.bench = mergeGeometries([
    colored(at(new THREE.BoxGeometry(1.8, 0.06, 0.45), 0, 0.45, 0), 0x6d4c33), colored(at(new THREE.BoxGeometry(1.8, 0.4, 0.05), 0, 0.72, -0.22, -0.15), 0x6d4c33),
    ...[-0.8, 0.8].map(x => colored(at(new THREE.BoxGeometry(0.06, 0.45, 0.45), x, 0.225, 0), 0x222426)),
  ]);
  M.bin = mergeGeometries([colored(at(cyl(0.28, 0.25, 0.95, 7), 0, 0.475, 0), 0x1f3a2c), colored(at(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 7, 1), 0, 0.98, 0), 0x1a1c1d)]);
  M.hydrant = mergeGeometries([colored(at(new THREE.CylinderGeometry(0.13, 0.15, 0.7, 8), 0, 0.35, 0), 0xb3241b), colored(at(new THREE.SphereGeometry(0.14, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.7, 0), 0xb3241b), colored(at(new THREE.CylinderGeometry(0.05, 0.05, 0.38, 6), 0, 0.48, 0, 0, 0, Math.PI / 2), 0xc9c4b8)]);
  M.tank = mergeGeometries([ // NYC-style timber water tank on a steel stand
    ...[[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]].map(([x, z]) => colored(at(new THREE.BoxGeometry(0.2, 2, 0.2), x, 1, z), 0x2c2a28)),
    colored(at(new THREE.BoxGeometry(2.6, 0.15, 2.6), 0, 2.05, 0), 0x2c2a28),
    colored(at(cyl(1.65, 1.65, 3.0, 10), 0, 3.6, 0), 0x6a5240), colored(at(cyl(1.68, 1.68, 0.1, 10), 0, 2.6, 0), 0x2c2a28),
    colored(at(cyl(1.68, 1.68, 0.1, 10), 0, 4.6, 0), 0x2c2a28),
    colored(at(new THREE.ConeGeometry(1.85, 1.0, 10, 1, true), 0, 5.6, 0), 0x4a3d33),
  ]);
  M.mast = mergeGeometries([colored(at(cyl(0.06, 0.18, 1, 5), 0, 0.5, 0), 0x9a9da0), colored(at(cyl(0.4, 0.4, 0.04, 6), 0, 0.7, 0), 0x9a9da0)]);
  M.vent = mergeGeometries([colored(at(cyl(0.22, 0.22, 0.8, 6), 0, 0.4, 0), 0x8b8d8f), colored(at(new THREE.ConeGeometry(0.34, 0.25, 6, 1, true), 0, 0.92, 0), 0x6e7072)]);
  return M;
}

export class City {
  constructor(scene) {
    this.scene = scene; this.blocks = []; this.chunks = []; this.detail = []; this.shadowCasters = []; this.propMeshes = []; this.detailDist = 600;
    const r = rng(1337), r2 = rng(90210);
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0); { const ix = box.index.array; box.setIndex([...ix.slice(0, 18), ...ix.slice(24)]); box.clearGroups(); } // no bottom face (never visible)
    const bMat = facadeMaterial();
    const propMat = worldDetail(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }), { grain: 0.1, grainScale: 3, tone: 0.18, toneScale: 0.4, rough: 0.1 });
    const furnMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
    const rtex = roadTexture(BLOCK, ROAD, SW);
    const streetMat = worldDetail(new THREE.MeshStandardMaterial({ map: rtex, roughness: 0.88 }), { grain: 0.16, grainScale: 7, tone: 0.1, toneScale: 0.03, rough: 0.12 });
    const paveMat = worldDetail(new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.85 }), { grain: 0.08, grainScale: 6, tone: 0.14, toneScale: 0.08, rough: 0.1 });
    const kerbMat = worldDetail(new THREE.MeshStandardMaterial({ color: 0xa6a39c, roughness: 0.75 }), { grain: 0.12, grainScale: 8, tone: 0.12, toneScale: 0.2 });
    const gt = grassTexture(); const parkMat = worldDetail(new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95 }), { grain: 0.1, grainScale: 2, tone: 0.25, toneScale: 0.06 });
    this.mats = { bMat, propMat, furnMat, streetMat, paveMat, kerbMat, parkMat };
    // ground textures and how to redraw them (repairTextures: a GPU reset can wipe a GPU-backed canvas)
    this.texRedraw = [[streetMat, () => roadTexture(BLOCK, ROAD, SW)], [paveMat, () => pavingTexture()], [parkMat, () => grassTexture()]];
    // tame the sky IBL on matte city surfaces (it washed everything out light blue); glass keeps more for reflections
    for (const mm of [propMat, streetMat, paveMat, kerbMat, parkMat]) mm.envMapIntensity = 0.5; bMat.envMapIntensity = 0.8; furnMat.envMapIntensity = 0.6;
    // city ground (two sides of the old river channel); everything else is sand
    scene.add(landQuad(-HALF, RIVER_X0, -HALF, HALF, streetMat), landQuad(RIVER_X1, HALF, -HALF, HALF, streetMat));
    this.buildSand(scene);
    // bridges across the river at every street row
    this.bridges = [];
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x5a5d61, roughness: 0.6, metalness: 0.4 });
    for (let j = 0; j < GRID; j++) {
      const z0 = -HALF + j * BLOCK; this.bridges.push([z0, z0 + ROAD]);
      const deck = landQuad(RIVER_X0, RIVER_X1, z0, z0 + ROAD, streetMat, 0.02); scene.add(deck);
      const under = new THREE.Mesh(new THREE.BoxGeometry(RIVER_X1 - RIVER_X0, 1.6, ROAD), deckMat); under.position.set((RIVER_X0 + RIVER_X1) / 2, -0.8, z0 + ROAD / 2); scene.add(under);
      for (const dz of [0.3, ROAD - 0.3]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(RIVER_X1 - RIVER_X0, 1.1, 0.3), deckMat); rail.position.set((RIVER_X0 + RIVER_X1) / 2, 0.55, z0 + dz); scene.add(rail); }
    }

    const trees = [];
    const CH = 8, DCH = 4; const chunkData = new Map(), detailData = new Map();
    const getChunk = (i, j) => { const key = (i / CH | 0) + ',' + (j / CH | 0); if (!chunkData.has(key)) chunkData.set(key, { list: [], props: [], tanks: [], masts: [], vents: [], ci: i / CH | 0, cj: j / CH | 0 }); return chunkData.get(key); };
    const getDetail = (i, j) => { const key = (i / DCH | 0) + ',' + (j / DCH | 0); if (!detailData.has(key)) detailData.set(key, { lamp: [], signal: [], bench: [], bin: [], hydrant: [], awn: [], ci: i / DCH | 0, cj: j / DCH | 0 }); return detailData.get(key); };
    this.landmarkSpots = [];
    const PAL = [ // per style colour sets
      [0x6f8ea6, 0x5b867f, 0x8f826c, 0x9aa3ab, 0x46607a, 0x7a8f9c], // glass tints
      [0xbdb6a8, 0xa9a69f, 0xd2cab9, 0x939089, 0xc7b99d, 0xe0dbd0], // concrete
      [0x8e4c37, 0x9f5d42, 0x71402f, 0xab7a5c, 0x5e3d32, 0xb38d6c], // brick
      [0xddd1b6, 0xcdbda1, 0xe4dbc8, 0xbcab8f, 0xcbbcab, 0xaab4a9], // stucco
    ];
    const pave = new GB(3), kerb = new GB(1), grass = new GB(6);
    const cellsOf = (b, fn) => { for (let i = Math.floor((b.minX + HALF) / BLOCK); i <= Math.floor((b.maxX + HALF) / BLOCK); i++) for (let j = Math.floor((b.minZ + HALF) / BLOCK); j <= Math.floor((b.maxZ + HALF) / BLOCK); j++) if (i >= 0 && j >= 0 && i < GRID && j < GRID) fn(i, j); };
    const paveBoxes = [];
    const tc = new THREE.Color();

    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const x0 = -HALF + i * BLOCK + ROAD, z0 = -HALF + j * BLOCK + ROAD, size = BLOCK - ROAD;
      const blk = { b: [] }; this.blocks.push(blk);
      const cx = x0 + size / 2, cz = z0 + size / 2;
      if (i === RIVER_I) { blk.water = true; continue; }
      // raised pavement slab with granite kerbs around every block (top = KERB, matching its collision box)
      const ox0 = x0 - SW, ox1 = Math.min(x0 + size + SW, HALF), oz0 = z0 - SW, oz1 = Math.min(z0 + size + SW, HALF), K = 0.3;
      paveBoxes.push({ minX: ox0, maxX: ox1, minZ: oz0, maxZ: oz1, top: KERB, pave: true });
      kerb.ring(ox0, ox1, oz0, oz1, ox0 + K, ox1 - K, oz0 + K, oz1 - K, KERB);
      kerb.side(ox0, oz0, ox1, oz0, 0, KERB, 0, -1); kerb.side(ox1, oz1, ox0, oz1, 0, KERB, 0, 1); kerb.side(ox0, oz1, ox0, oz0, 0, KERB, -1, 0); kerb.side(ox1, oz0, ox1, oz1, 0, KERB, 1, 0);
      const D = getDetail(i, j);
      // street furniture along the four kerbs: lamps every ~24 m, traffic signals at the corners, benches / bins / hydrants
      const sides = [ // [start, end, fixed, axis('x' runs along x), yaw so the arm points at the road]
        [ox0, ox1, oz0 + 0.55, 'x', Math.PI], [ox0, ox1, oz1 - 0.55, 'x', 0], [oz0, oz1, ox0 + 0.55, 'z', -Math.PI / 2], [oz0, oz1, ox1 - 0.55, 'z', Math.PI / 2]];
      for (const [a0, a1, f, ax, yaw] of sides) {
        if ((ax === 'x' && f > HALF - 1) || (ax === 'z' && f > HALF - 1)) continue;
        const L = a1 - a0, n = Math.max(1, Math.round((L - 14) / 24));
        for (let k = 0; k <= n; k++) { const s = a0 + 7 + (L - 14) * k / n; D.lamp.push(ax === 'x' ? [s, f, yaw] : [f, s, yaw]); }
        for (let k = 0; k < 3; k++) { const s = a0 + 12 + r2() * (L - 24), pick = r2(), f2 = f + (yaw === Math.PI || yaw === -Math.PI / 2 ? 0.7 : -0.7);
          const list = pick < 0.35 ? D.bench : pick < 0.75 ? D.bin : D.hydrant; const ff = list === D.hydrant ? f : f2;
          list.push(ax === 'x' ? [s, ff, yaw] : [ff, s, yaw]); }
      }
      D.signal.push([ox0 + 0.6, oz0 + 0.6, Math.PI], [ox1 - 0.6, oz0 + 0.6, Math.PI / 2], [ox1 - 0.6, oz1 - 0.6, 0], [ox0 + 0.6, oz1 - 0.6, -Math.PI / 2]);
      // street trees along the north pavement of many blocks
      if (r() < 0.45) for (const tx of [11.5, 18, 37.7, 44.1, 50.5]) trees.push([x0 + tx, z0 - 1.05, 0.8 + r() * 0.3]); // between the lamps
      const d = Math.hypot(i - GRID / 2, j - GRID / 2.6) / (GRID / 2);
      if ((i === 20 && j === 16) || (i === 8 && j === 8) || (i === 34 && j === 12) || (i === 14 && j === 30)) { this.landmarkSpots.push({ i, j, cx, cz, size, blk }); pave.top(ox0 + K, ox1 - K, oz0 + K, oz1 - K, KERB); continue; }
      const waterfront = j === GRID - 1;
      if (waterfront || r() < 0.06 || (i >= 22 && i <= 24 && j >= 4 && j <= 7)) { // park / promenade
        const gx0 = x0 + 1.2, gx1 = x0 + size - 1.2, gz0 = z0 + 1.2, gz1 = Math.min(z0 + size - 1.2, oz1 - K - 0.5);
        pave.ring(ox0 + K, ox1 - K, oz0 + K, oz1 - K, gx0, gx1, gz0, gz1, KERB); grass.top(gx0, gx1, gz0, gz1, KERB);
        const n = waterfront ? 0 : 16;
        for (let t = 0; t < n; t++) trees.push([x0 + 3 + r() * (size - 6), z0 + 3 + r() * (size - 6), 0.8 + r() * 0.7]);
        if (waterfront) for (let t = 0; t < 7; t++) trees.push([x0 + 3 + t * (size - 6) / 6, z0 + size - 6, 1 + r() * 0.2], [x0 + 3 + t * (size - 6) / 6, z0 + 8, 0.9 + r() * 0.2]);
        continue;
      }
      pave.top(ox0 + K, ox1 - K, oz0 + K, oz1 - K, KERB);
      const div = d < 0.4 ? (r() < 0.55 ? 1 : 2) : (r() < 0.35 ? 2 : 3);
      const sub = size / div;
      for (let a = 0; a < div; a++) for (let c = 0; c < div; c++) {
        if (div === 3 && r() < 0.1) continue;
        const inset = 0.5 + r() * 2;
        const w = sub - inset * 2, dd = sub - inset * 2;
        const base = d < 0.3 ? 110 + r() * 260 : d < 0.6 ? 35 + r() * 110 * (1 - d) * 2 : 14 + r() * 32;
        const h = Math.max(8, base * (0.6 + r() * 0.6));
        const bx = x0 + a * sub + sub / 2, bz = z0 + c * sub + sub / 2;
        const p0 = r(), p1 = r(); // (kept so the city layout is identical to before)
        const sr = r2(), style = h > 90 ? (sr < 0.6 ? 0 : 1) : h > 40 ? (sr < 0.3 ? 0 : sr < 0.65 ? 1 : 2) : (sr < 0.5 ? 2 : sr < 0.8 ? 3 : 1);
        const seed = r2(); const col = new THREE.Color(PAL[style][p0 * PAL[style].length | 0]).multiplyScalar(0.85 + p1 * 0.25);
        const ch = getChunk(i, j);
        const tiers = [{ x: bx, z: bz, w, dd, y: 0, h }];
        let top = h, tw = w, td = dd;
        for (let tier = 0; tier < 2 && top > 110 && r() < 0.6; tier++) { // NYC-style setbacks
          const h2 = top * (0.12 + r() * 0.22); tw *= 0.7; td *= 0.7;
          tiers.push({ x: bx, z: bz, w: tw, dd: td, y: top, h: h2 }); top += h2;
        }
        tiers.forEach((t, ti) => {
          const T = t.y + t.h, mnX = t.x - t.w / 2, mxX = t.x + t.w / 2, mnZ = t.z - t.dd / 2, mxZ = t.z + t.dd / 2;
          blk.b.push({ minX: mnX, maxX: mxX, minZ: mnZ, maxZ: mxZ, top: T, bld: true });
          ch.list.push({ bx: t.x, bz: t.z, w: t.w, dd: t.dd, h: t.h, y: t.y, col: ti ? col.clone().multiplyScalar(0.95) : col, style, seed });
          // parapet walls around the roof edge (solid: you can stand on them or step over them)
          const ph = style === 0 ? 1.1 : 0.9, pt = 0.3, pc = style === 0 ? tc.setHex(0x8e959b).clone() : col.clone().lerp(tc.setHex(0xb5b0a6), 0.5).multiplyScalar(0.9);
          for (const [a0, a1, b0, b1] of [[mnX, mxX, mnZ, mnZ + pt], [mnX, mxX, mxZ - pt, mxZ], [mnX, mnX + pt, mnZ + pt, mxZ - pt], [mxX - pt, mxX, mnZ + pt, mxZ - pt]]) {
            blk.b.push({ minX: a0, maxX: a1, minZ: b0, maxZ: b1, top: T + ph }); ch.props.push([(a0 + a1) / 2, T, (b0 + b1) / 2, a1 - a0, ph, b1 - b0, pc]);
          }
          // cornice just under the roof line + a belt course over the shopfronts (masonry styles)
          if (style !== 0) {
            const cc = col.clone().lerp(tc.setHex(0xd8d4cc), 0.55);
            ch.props.push([t.x, T - 1.05, t.z, t.w + 0.5, 0.42, t.dd + 0.5, cc]);
            ch.props.push([t.x, T - 0.63, t.z, t.w + 0.3, 0.12, t.dd + 0.3, cc.clone().multiplyScalar(0.85)]);
            if (ti === 0 && style >= 2) ch.props.push([t.x, 4.75, t.z, t.w + 0.3, 0.28, t.dd + 0.3, cc]);
          } else ch.props.push([t.x, T - 0.75, t.z, t.w + 0.14, 0.6, t.dd + 0.14, tc.setHex(0x6b7278).clone()]); // metal crown band (top stays below the roof deck: no z-fight)
          if (ti !== tiers.length - 1) return;
          // rooftop kit on the top tier: plant room / stair bulkhead, AC units, vents, water tank, masts
          const inner = { x0: mnX + 1.2, x1: mxX - 1.2, z0: mnZ + 1.2, z1: mxZ - 1.2 }, used = [];
          const place = (sx, sz) => { for (let tries = 0; tries < 8; tries++) { const px = inner.x0 + sx / 2 + r2() * Math.max(0, inner.x1 - inner.x0 - sx), pz = inner.z0 + sz / 2 + r2() * Math.max(0, inner.z1 - inner.z0 - sz);
            if (inner.x1 - inner.x0 < sx || inner.z1 - inner.z0 < sz) return null;
            if (!used.some(u => Math.abs(u[0] - px) < (u[2] + sx) / 2 + 0.6 && Math.abs(u[1] - pz) < (u[3] + sz) / 2 + 0.6)) { used.push([px, pz, sx, sz]); return [px, pz]; } } return null; };
          const prc = tc.setHex(style === 0 ? 0x9aa0a4 : 0x9d978d).clone();
          { const sx = Math.min(8, t.w * 0.3), sz = Math.min(6, t.dd * 0.25), hh = 3.2, q = place(sx, sz);
            if (q) { ch.props.push([q[0], T, q[1], sx, hh, sz, prc]); ch.props.push([q[0], T + hh, q[1], sx + 0.3, 0.15, sz + 0.3, prc.clone().multiplyScalar(0.8)]);
              blk.b.push({ minX: q[0] - sx / 2, maxX: q[0] + sx / 2, minZ: q[1] - sz / 2, maxZ: q[1] + sz / 2, top: T + hh + 0.15 }); } }
          const nac = 1 + (r2() * Math.min(5, t.w * t.dd / 120) | 0);
          for (let k = 0; k < nac; k++) { const q = place(1.5, 1.1); if (!q) break; ch.props.push([q[0], T, q[1], 1.5, 0.95, 1.1, tc.setHex(0xb9bcbd).clone().multiplyScalar(0.8 + r2() * 0.25)]);
            blk.b.push({ minX: q[0] - 0.75, maxX: q[0] + 0.75, minZ: q[1] - 0.55, maxZ: q[1] + 0.55, top: T + 0.95 }); }
          for (let k = 0; k < 1 + (r2() < 0.4); k++) { const q = place(0.5, 0.5); if (q) ch.vents.push([q[0], T, q[1]]); }
          if ((style === 2 || style === 3) && T < 75 && r2() < 0.5) { const q = place(3.8, 3.8); if (q) { ch.tanks.push([q[0], T, q[1], r2() * 6.28]); blk.b.push({ minX: q[0] - 1.8, maxX: q[0] + 1.8, minZ: q[1] - 1.8, maxZ: q[1] + 1.8, top: T + 6.1 }); } }
          if (T > 100 && r2() < 0.65) { const q = place(0.6, 0.6); if (q) ch.masts.push([q[0], T, q[1], 8 + r2() * 22]); }
        });
        // awnings over the shopfronts on street-facing sides of low masonry buildings
        if (style >= 2 && h < 60 && r2() < 0.55) {
          const faces = []; if (a === 0) faces.push(['x-']); if (a === div - 1) faces.push(['x+']); if (c === 0) faces.push(['z-']); if (c === div - 1) faces.push(['z+']);
          for (const [fc] of faces) { const fw = fc[0] === 'x' ? dd : w, ns = Math.max(1, Math.floor((fw - 1.2) / 5)), sbw = (fw - 1.2) / ns, acol = new THREE.Color([0x7d1d1a, 0x1d4a2a, 0x23314f, 0x2b2b2b, 0x8a6a2a, 0x5d2440][r2() * 6 | 0]);
            for (let k = 0; k < ns; k++) { if (r2() < 0.3) continue; const u = -fw / 2 + 0.6 + (k + 0.5) * sbw;
              if (fc === 'z-') D.awn.push([bx + u, bz - dd / 2, Math.PI, sbw - 0.5, acol]); else if (fc === 'z+') D.awn.push([bx + u, bz + dd / 2, 0, sbw - 0.5, acol]);
              else if (fc === 'x-') D.awn.push([bx - w / 2, bz + u, -Math.PI / 2, sbw - 0.5, acol]); else D.awn.push([bx + w / 2, bz + u, Math.PI / 2, sbw - 0.5, acol]); } }
        }
      }
    }
    for (const b of paveBoxes) cellsOf(b, (i, j) => this.blocks[i * GRID + j].b.push(b));
    // pavement / kerb / grass surfaces (merged: 3 draw calls for the whole city)
    for (const [gb, mat] of [[pave, paveMat], [kerb, kerbMat], [grass, parkMat]]) scene.add(gb.mesh(mat));

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0);
    const M = furnitureModels(); this.models = M;
    const inst = (geo, mat, list, fn, shadow = true) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((o, k) => fn(o, k, im)); im.computeBoundingSphere(); im.castShadow = shadow; im.receiveShadow = true; return im; };
    for (const ch of chunkData.values()) {
      const n = ch.list.length; if (!n) continue;
      const geo = box.clone(); const aB = new Float32Array(n * 2); ch.list.forEach((o, k) => { aB[k * 2] = o.style; aB[k * 2 + 1] = o.seed; });
      geo.setAttribute('aBld', new THREE.InstancedBufferAttribute(aB, 2));
      const im = inst(geo, bMat, ch.list, (o, k, im) => { p.set(o.bx, o.y, o.bz); s.set(o.w, o.h, o.dd); m.compose(p, q.identity(), s); im.setMatrixAt(k, m); im.setColorAt(k, o.col); });
      const props = inst(box, propMat, ch.props, (o, k, im) => { m.compose(p.set(o[0], o[1], o[2]), q.identity(), s.set(o[3], o[4], o[5])); im.setMatrixAt(k, m); im.setColorAt(k, o[6]); });
      const g = new THREE.Group(); g.add(im, props); this.propMeshes.push(props);
      if (ch.tanks.length) g.add(this.prop(inst(M.tank, furnMat, ch.tanks, (o, k, im) => im.setMatrixAt(k, m.compose(p.set(o[0], o[1], o[2]), q.setFromAxisAngle(UP, o[3]), s.set(1, 1, 1))))));
      if (ch.masts.length) g.add(this.prop(inst(M.mast, furnMat, ch.masts, (o, k, im) => im.setMatrixAt(k, m.compose(p.set(o[0], o[1], o[2]), q.identity(), s.set(1, o[3], 1))), false)));
      if (ch.vents.length) g.add(this.prop(inst(M.vent, furnMat, ch.vents, (o, k, im) => im.setMatrixAt(k, m.compose(p.set(o[0], o[1], o[2]), q.identity(), s.set(1, 1, 1))), false)));
      scene.add(g);
      this.chunks.push({ group: g, cx: -HALF + (ch.ci + 0.5) * CH * BLOCK, cz: -HALF + (ch.cj + 0.5) * CH * BLOCK });
    }
    // street-level detail chunks (smaller, culled at a shorter distance)
    const awnGeo = new THREE.BoxGeometry(1, 0.08, 1.3); awnGeo.translate(0, 0, 0.65);
    const awnMat = worldDetail(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), { grain: 0.06, grainScale: 4, tone: 0.1, toneScale: 0.5 });
    for (const D of detailData.values()) {
      const g = new THREE.Group(), ry = (o, k, im, y = KERB) => im.setMatrixAt(k, m.compose(p.set(o[0], y, o[1]), q.setFromAxisAngle(UP, o[2]), s.set(1, 1, 1)));
      if (D.lamp.length) g.add(inst(M.lamp, furnMat, D.lamp, ry));
      if (D.signal.length) g.add(inst(M.signal, furnMat, D.signal, ry));
      if (D.bench.length) g.add(inst(M.bench, furnMat, D.bench, ry, false));
      if (D.bin.length) g.add(inst(M.bin, furnMat, D.bin, ry, false));
      if (D.hydrant.length) g.add(inst(M.hydrant, furnMat, D.hydrant, ry, false));
      if (D.awn.length) g.add(inst(awnGeo, awnMat, D.awn, (o, k, im) => { e.set(0.32, o[2], 0, 'YXZ'); q.setFromEuler(e); im.setMatrixAt(k, m.compose(p.set(o[0], 3.3, o[1]), q, s.set(o[3], 1, 1))); im.setColorAt(k, o[4]); }));
      scene.add(g); this.detail.push({ group: g, cx: -HALF + (D.ci + 0.5) * DCH * BLOCK, cz: -HALF + (D.cj + 0.5) * DCH * BLOCK });
    }
    // trees (instanced, clustered jittered canopies with colour variation, standing on the pavement / grass)
    const tg = new THREE.CylinderGeometry(0.14, 0.24, 3.2, 5, 1, true); tg.translate(0, 1.6, 0);
    const blob = (rad, x, y, z, sd, det) => { const b = new THREE.IcosahedronGeometry(rad, det); const a = b.attributes.position; for (let k = 0; k < a.count; k++) { const f = 0.86 + Math.sin(a.getX(k) * 3.1 + a.getZ(k) * 2.3 + sd) * 0.1 + Math.sin(a.getY(k) * 4.7 + sd) * 0.05; a.setXYZ(k, a.getX(k) * f, a.getY(k) * 0.85 * f, a.getZ(k) * f); } b.translate(x, y, z); return b; };
    const cg = mergeGeometries([blob(1.9, 0, 4.8, 0, 0, 1), blob(1.45, 1.1, 4.3, 0.6, 1, 0), blob(1.5, -0.9, 4.5, -0.7, 2, 0)]); cg.computeVertexNormals();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9, side: THREE.DoubleSide });
    const leafMat = worldDetail(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), { grain: 0.35, grainScale: 3, tone: 0.2, toneScale: 0.5, rough: 0 }); leafMat.envMapIntensity = 0.6;
    const treeChunks = new Map(); this.treeChunks = []; const canopies = [];
    trees.forEach(([x, z, sc]) => { const key = Math.floor((x + HALF) / (DCH * BLOCK)) + ',' + Math.floor((z + HALF) / (DCH * BLOCK)); if (!treeChunks.has(key)) treeChunks.set(key, []);
      q.setFromAxisAngle(UP, r() * 6.28); m.compose(p.set(x, KERB, z), q, s.set(sc, sc * (0.9 + r() * 0.3), sc)); treeChunks.get(key).push([m.clone(), tc.setHSL(0.24 + r() * 0.08, 0.45 + r() * 0.2, 0.2 + r() * 0.1).clone(), x, z]); });
    for (const list of treeChunks.values()) {
      const ti = new THREE.InstancedMesh(tg, trunkMat, list.length), ci = new THREE.InstancedMesh(cg, leafMat, list.length);
      list.forEach(([mm, cc], k) => { ti.setMatrixAt(k, mm); ci.setMatrixAt(k, mm); ci.setColorAt(k, cc); });
      ti.computeBoundingSphere(); ci.computeBoundingSphere(); ti.castShadow = true; ci.castShadow = true; ci.receiveShadow = true;
      const g = new THREE.Group(); g.add(ti, ci); scene.add(g); canopies.push(ci);
      const cx = list.reduce((a, t) => a + t[2], 0) / list.length, cz = list.reduce((a, t) => a + t[3], 0) / list.length;
      this.treeChunks.push({ group: g, cx, cz });
    }
    this.treeMesh = { set castShadow(v) { for (const c of canopies) c.castShadow = v; } };
    this.buildLandmarks();
  }
  prop(mesh) { this.propMeshes.push(mesh); return mesh; }
  buildSand(scene) {
    const xs = sandTicks(), zs = xs, nx = xs.length, nz = zs.length, H = new Float32Array(nx * nz);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) H[i * nz + j] = duneFn(xs[i], zs[j]);
    this.sand = { xs, zs, H, nz };
    const keep = (i, j) => { const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2; return !inCity(cx, cz) || isRiver(cx); };
    const P = new Float32Array(nx * nz * 3); for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const k = (i * nz + j) * 3; P[k] = xs[i]; P[k + 1] = H[i * nz + j] - 0.02; P[k + 2] = zs[j]; }
    const I = []; for (let i = 0; i < nx - 1; i++) for (let j = 0; j < nz - 1; j++) if (keep(i, j)) { const a = i * nz + j, b = (i + 1) * nz + j; I.push(a, a + 1, b + 1, a, b + 1, b); } // split a -> b+1 (matches groundAt)
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8c29a, roughness: 1, metalness: 0 }); mat.envMapIntensity = 0.55;
    const m = new THREE.Mesh(g, mat); m.name = 'sandDunes'; scene.add(m); this.sandMesh = m;
  }
  // sand surface height (0 inside the city / on the old river bed); same triangles as the mesh
  // after a WebGL context restore: any ground canvas that came back blank (all transparent) is redrawn before re-upload
  repairTextures() { let n = 0;
    for (const [m, make] of this.texRedraw) { const c = m.map?.image; if (!c?.getContext) continue;
      const px = c.getContext('2d', { willReadFrequently: true }).getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
      if (px[3] === 0) { const fresh = make(); m.map.image = fresh.image; m.map.needsUpdate = true; fresh.dispose(); n++; } }
    return n; }
  groundAt(x, z) {
    const S = this.sand; if (!S || (inCity(x, z) && !isRiver(x))) return 0;
    const { xs, zs, H, nz } = S, find = (a, v) => { let lo = 0, hi = a.length - 2; if (v <= a[0]) return 0; if (v >= a[hi + 1]) return hi; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= v) lo = m; else hi = m - 1; } return lo; };
    const i = find(xs, x), j = find(zs, z), u = Math.min(1, Math.max(0, (x - xs[i]) / (xs[i + 1] - xs[i]))), v = Math.min(1, Math.max(0, (z - zs[j]) / (zs[j + 1] - zs[j])));
    const h00 = H[i * nz + j], h01 = H[i * nz + j + 1], h10 = H[(i + 1) * nz + j], h11 = H[(i + 1) * nz + j + 1];
    return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h01 - h00) * v + (h11 - h01) * u; // triangles (a, b, b+1) / (a, a+1, b+1)
  }
  buildLandmarks() {
    const S = this.landmarkSpots, sc = this.scene;
    const add = (mesh, spot, coll) => { mesh.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); sc.add(mesh); if (coll) for (const c of [].concat(coll)) spot.blk.b.push(c); };
    const sq = (o, h, top) => ({ minX: o.cx - h, maxX: o.cx + h, minZ: o.cz - h, maxZ: o.cz + h, top });
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fa6b8, metalness: 0.95, roughness: 0.06 });
    // 1. Central spire tower (tallest): tapered octagon, collision follows the taper (top = visible roof)
    { const o = S[0], g = new THREE.Group();
      const t1 = new THREE.Mesh(new THREE.CylinderGeometry(14, 22, 420, 8), glass); t1.position.y = 210;
      const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 4, 120, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.3 })); t2.position.y = 480;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.6, 0.3) })); beacon.position.y = 542;
      g.add(t1, t2, beacon); g.position.set(o.cx, 0, o.cz);
      const ap = y => (22 - 8 * y / 420) * Math.cos(Math.PI / 8); // octagon apothem at height y
      add(g, o, [sq(o, ap(105), 105), sq(o, ap(210), 210), sq(o, ap(315), 315), sq(o, ap(420), 420)]); }
    { const o = S[1]; const st = new THREE.Mesh(new THREE.CylinderGeometry(30, 26, 22, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5, side: THREE.DoubleSide }));
      st.position.set(o.cx, 11, o.cz); add(st, o);
      const field = new THREE.Mesh(new THREE.CircleGeometry(26, 32), new THREE.MeshStandardMaterial({ color: 0x3a8a3a, roughness: 0.9 })); field.rotation.x = -Math.PI / 2; field.position.set(o.cx, 0.2, o.cz); field.receiveShadow = true; sc.add(field); }
    // 3. golden dome: stacked collision rings that hug the hemisphere (was one flat box 2 m below the top)
    { const o = S[2], R = 28; const d = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }));
      d.position.set(o.cx, 0, o.cz); const rings = [];
      for (let y = 2; y <= R; y += 2) rings.push(sq(o, Math.sqrt(Math.max(0, R * R - y * y)) * 0.8, Math.min(y, R)));
      add(d, o, rings); }
    { const o = S[3]; const mat = new THREE.MeshStandardMaterial({ color: 0x2a3644, metalness: 0.9, roughness: 0.1 });
      for (const dx of [-15, 15]) { const t = new THREE.Mesh(new THREE.BoxGeometry(18, 300, 18), mat); t.position.set(o.cx + dx, 150, o.cz); add(t, o, { minX: o.cx + dx - 9, maxX: o.cx + dx + 9, minZ: o.cz - 9, maxZ: o.cz + 9, top: 300 }); }
      const br = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 6), mat); br.position.set(o.cx, 200, o.cz); add(br, o); }
  }
  blockAt(x, z) { const i = Math.floor((x + HALF) / BLOCK), j = Math.floor((z + HALF) / BLOCK); if (i < 0 || j < 0 || i >= GRID || j >= GRID) return null; return this.blocks[i * GRID + j]; }
  boxesNear(x, z) { const blk = this.blockAt(x, z); if (blk) return blk.b; return []; }
  heightAt(x, z, r = 0) {
    let h = this.groundAt(x, z);
    for (const b of this.boxesNear(x, z)) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) h = Math.max(h, b.top);
    return h;
  }
  collide(pos, vel, r) {
    let floor = this.groundAt(pos.x, pos.z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const bs = this.boxesNear(pos.x + dx * BLOCK * 0.5, pos.z + dz * BLOCK * 0.5);
      for (const b of bs) {
        if (pos.x < b.minX - r || pos.x > b.maxX + r || pos.z < b.minZ - r || pos.z > b.maxZ + r) continue;
        if (pos.y >= b.top - 1.2) { floor = Math.max(floor, b.top); continue; }
        const px1 = pos.x - (b.minX - r), px2 = (b.maxX + r) - pos.x, pz1 = pos.z - (b.minZ - r), pz2 = (b.maxZ + r) - pos.z;
        const mn = Math.min(px1, px2, pz1, pz2);
        if (mn === px1) { pos.x = b.minX - r; if (vel.x > 0) vel.x = 0; }
        else if (mn === px2) { pos.x = b.maxX + r; if (vel.x < 0) vel.x = 0; }
        else if (mn === pz1) { pos.z = b.minZ - r; if (vel.z > 0) vel.z = 0; }
        else { pos.z = b.maxZ + r; if (vel.z < 0) vel.z = 0; }
      }
    }
    const lim = HALF + 2500;
    if (Math.abs(pos.x) > lim) { pos.x = Math.sign(pos.x) * lim; if (vel.x * pos.x > 0) vel.x = 0; }
    if (Math.abs(pos.z) > lim) { pos.z = Math.sign(pos.z) * lim; if (vel.z * pos.z > 0) vel.z = 0; }
    return floor;
  }
  update(camPos, viewDist) {
    for (const c of this.chunks) c.group.visible = Math.hypot(c.cx - camPos.x, c.cz - camPos.z) < viewDist + 460;
    const dd = Math.min(viewDist, this.detailDist) + 230;
    for (const c of this.detail) c.group.visible = Math.hypot(c.cx - camPos.x, c.cz - camPos.z) < dd;
    const td = viewDist * 0.7 + 230; for (const c of this.treeChunks) c.group.visible = Math.hypot(c.cx - camPos.x, c.cz - camPos.z) < td;
  }
}
