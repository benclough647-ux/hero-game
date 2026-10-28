import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
// Procedural coastal city: PBR glass/stone towers (procedural facade shader with emissive window variation),
// river with bridges, ocean coastline with seawall + piers, tree lines and parks.
// Exposes heightAt(), collide(), isWater() for hero physics.
export const BLOCK = 80, ROAD = 18, GRID = 40; // 40x40 blocks = 3.2km square
export const HALF = GRID * BLOCK / 2;
export const RIVER_I = 30;
export const RIVER_X0 = -HALF + RIVER_I * BLOCK + ROAD, RIVER_X1 = -HALF + (RIVER_I + 1) * BLOCK;
export const WATER_Y = -0.6;

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function streetTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const rp = S * ROAD / BLOCK, sw = S * 3.5 / BLOCK;
  g.fillStyle = '#9a9790'; g.fillRect(0, 0, S, S); // sidewalk / plaza
  for (let i = 0; i < 4000; i++) { const v = 130 + Math.random() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v - 6},.25)`; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
  g.strokeStyle = 'rgba(80,80,80,.35)'; g.lineWidth = 1; for (let i = 0; i < S; i += 12) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
  g.fillStyle = '#2a2b2e'; g.fillRect(0, sw, S, rp - 2 * sw); g.fillRect(sw, 0, rp - 2 * sw, S); // asphalt
  for (let i = 0; i < 9000; i++) { const v = 30 + Math.random() * 30 | 0; g.fillStyle = `rgba(${v},${v},${v + 3},.5)`; const x = Math.random() * S, y = Math.random() * S; if (y < rp || x < rp) g.fillRect(x, y, 2, 2); }
  g.fillStyle = '#e9e6dc'; // lane dashes
  for (let i = rp; i < S; i += 22) { g.fillRect(i, rp / 2 - 1.5, 11, 3); g.fillRect(rp / 2 - 1.5, i, 3, 11); }
  g.fillStyle = '#d8b84a'; g.fillRect(rp, rp / 2 - 5, S, 2); g.fillRect(rp / 2 - 5, rp, 2, S);
  g.fillStyle = 'rgba(235,232,222,.9)'; // crosswalks
  for (let k = sw + 2; k < rp - sw - 2; k += 7) { g.fillRect(rp + 2, k, 14, 4); g.fillRect(k, rp + 2, 4, 14); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return t;
}

// quad on y with world-space UVs (u = x/BLOCK) so the street grid lines up anywhere
function landQuad(x0, x1, z0, z1, mat, y = 0) {
  const g = new THREE.BufferGeometry();
  const P = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1];
  const U = P.length && [ (x0 + HALF) / BLOCK, (z0 + HALF) / BLOCK, (x1 + HALF) / BLOCK, (z0 + HALF) / BLOCK, (x1 + HALF) / BLOCK, (z1 + HALF) / BLOCK, (x0 + HALF) / BLOCK, (z1 + HALF) / BLOCK ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3)); g.setIndex([0, 2, 1, 0, 3, 2]);
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}

// Facade shader: curtain-wall glass or punched windows from world position; per-building seed from instance matrix.
function facadeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.0 });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWN; varying float vSeed;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 fM = modelMatrix; 
        #ifdef USE_INSTANCING
          fM = modelMatrix * instanceMatrix; vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        #else
          vSeed = 0.37;
        #endif
        vWPos = (fM * vec4(position, 1.0)).xyz; vWN = normalize(mat3(fM) * normal);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPos; varying vec3 vWN; varying float vSeed;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 n = normalize(vWN);
        float isRoof = step(0.6, n.y);
        float u = abs(n.x) > 0.5 ? vWPos.z : vWPos.x;
        float style = fract(vSeed * 13.17);
        bool curtain = style > 0.45;
        float fh = curtain ? 3.8 : 3.4 + 0.5 * fract(vSeed * 7.13);
        float ww = curtain ? 1.6 + 0.6 * fract(vSeed * 3.7) : 2.2 + 1.2 * fract(vSeed * 3.7);
        vec2 cell = vec2(u / ww, (vWPos.y - 1.0) / fh);
        vec2 f = fract(cell); vec2 id = floor(cell);
        float mx = curtain ? 0.05 : 0.2, myb = curtain ? 0.1 : 0.28;
        float win = step(mx, f.x) * step(f.x, 1.0 - mx) * step(myb, f.y) * step(f.y, 0.94);
        if (vWPos.y < 5.0) win = curtain ? 1.0 : win * step(0.5, fract(u / 9.0)); // lobby glazing
        win *= 1.0 - isRoof;
        float r = h21(id + vSeed * 91.0);
        vec3 frameCol = diffuseColor.rgb;
        vec3 glassTint = mix(vec3(0.05, 0.08, 0.10), vec3(0.11, 0.14, 0.16), fract(vSeed * 5.3)) * (0.75 + 0.5 * r);
        vec3 c = mix(frameCol, glassTint, win);
        float rough = mix(curtain ? 0.35 : 0.85, 0.04 + 0.1 * r * r, win);
        float metal = mix(curtain ? 0.6 : 0.0, 0.85, win);
        // cheap ambient occlusion: darken toward street level and at the floor line
        float ao = mix(0.45, 1.0, smoothstep(0.0, 16.0, vWPos.y)) * mix(0.85, 1.0, smoothstep(0.0, 0.12, f.y));
        c *= ao;
        if (isRoof > 0.5) { c = vec3(0.24, 0.24, 0.23) * (0.8 + 0.4 * h21(floor(vWPos.xz * 0.5))); rough = 0.9; metal = 0.0; }
        diffuseColor.rgb = c; roughnessFactor = rough; metalnessFactor = metal;
        // a few interiors lit even in daylight (warm / cool office light), subtle
        float lit = step(0.86, r) * win;
        totalEmissiveRadiance += lit * mix(vec3(1.0, 0.75, 0.45), vec3(0.75, 0.85, 1.0), step(0.5, fract(r * 7.0))) * 0.35;
      }`);
  };
  return mat;
}

export class City {
  constructor(scene) {
    this.scene = scene; this.blocks = []; this.chunks = []; this.shadowCasters = [];
    const r = rng(1337);
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const bMat = facadeMaterial();
    const parapetMat = new THREE.MeshStandardMaterial({ color: 0x8c8a86, roughness: 0.85 });
    const streetMat = new THREE.MeshStandardMaterial({ map: streetTexture(), roughness: 0.92 });
    // land (two sides of the river), ocean to the south and east
    const FAR = 5000;
    scene.add(landQuad(-HALF - FAR, RIVER_X0, -HALF - FAR, HALF, streetMat), landQuad(RIVER_X1, HALF, -HALF - FAR, HALF, streetMat));
    const concrete = new THREE.MeshStandardMaterial({ color: 0x7d7a74, roughness: 0.9 });
    const wall = (x0, x1, z0, z1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 6, z1 - z0), concrete); m.position.set((x0 + x1) / 2, -3, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m); };
    wall(-HALF - FAR, HALF + 1, HALF, HALF + 1.5); wall(HALF, HALF + 1.5, -HALF - FAR, HALF + 1.5);
    wall(RIVER_X0 - 1.5, RIVER_X0, -HALF - FAR, HALF); wall(RIVER_X1, RIVER_X1 + 1.5, -HALF - FAR, HALF);
    // bridges across the river at every street row
    this.bridges = [];
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x5a5d61, roughness: 0.6, metalness: 0.4 });
    for (let j = 0; j < GRID; j++) {
      const z0 = -HALF + j * BLOCK; this.bridges.push([z0, z0 + ROAD]);
      const deck = landQuad(RIVER_X0, RIVER_X1, z0, z0 + ROAD, streetMat, 0.02); scene.add(deck);
      const under = new THREE.Mesh(new THREE.BoxGeometry(RIVER_X1 - RIVER_X0, 1.6, ROAD), deckMat); under.position.set((RIVER_X0 + RIVER_X1) / 2, -0.8, z0 + ROAD / 2); scene.add(under);
      for (const dz of [0.3, ROAD - 0.3]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(RIVER_X1 - RIVER_X0, 1.1, 0.3), deckMat); rail.position.set((RIVER_X0 + RIVER_X1) / 2, 0.55, z0 + dz); scene.add(rail); }
    }

    const parkMat = new THREE.MeshStandardMaterial({ color: 0x3d6f2e, roughness: 0.95 });
    const trees = [];
    const CH = 8; const chunkData = new Map();
    const getChunk = (i, j) => { const key = (i / CH | 0) + ',' + (j / CH | 0); if (!chunkData.has(key)) chunkData.set(key, { list: [], ci: i / CH | 0, cj: j / CH | 0 }); return chunkData.get(key); };
    this.landmarkSpots = [];
    const palette = [0x8f8a80, 0xa39d92, 0x6f7378, 0xb7b2a6, 0x5b5e63, 0x9c7a62, 0x7e5d4a, 0xc9c4b8, 0x47505a];

    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const x0 = -HALF + i * BLOCK + ROAD, z0 = -HALF + j * BLOCK + ROAD, size = BLOCK - ROAD;
      const blk = { b: [] }; this.blocks.push(blk);
      const cx = x0 + size / 2, cz = z0 + size / 2;
      if (i === RIVER_I) { blk.water = true; continue; }
      // street trees along the north sidewalk of many blocks
      if (r() < 0.45) for (let t = 0; t < 5; t++) trees.push([x0 + 4 + t * (size - 8) / 4, z0 - 2.2, 0.8 + r() * 0.3]);
      const d = Math.hypot(i - GRID / 2, j - GRID / 2.6) / (GRID / 2);
      if ((i === 20 && j === 16) || (i === 8 && j === 8) || (i === 34 && j === 12) || (i === 14 && j === 30)) { this.landmarkSpots.push({ i, j, cx, cz, size, blk }); continue; }
      const waterfront = j === GRID - 1;
      if (waterfront || r() < 0.06 || (i >= 22 && i <= 24 && j >= 4 && j <= 7)) { // park / promenade
        const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), parkMat); p.rotation.x = -Math.PI / 2; p.position.set(cx, 0.06, cz); p.receiveShadow = true; scene.add(p);
        const n = waterfront ? 0 : 16;
        for (let t = 0; t < n; t++) trees.push([x0 + 3 + r() * (size - 6), z0 + 3 + r() * (size - 6), 0.8 + r() * 0.7]);
        if (waterfront) for (let t = 0; t < 7; t++) trees.push([x0 + 3 + t * (size - 6) / 6, z0 + size - 6, 1 + r() * 0.2], [x0 + 3 + t * (size - 6) / 6, z0 + 8, 0.9 + r() * 0.2]);
        continue;
      }
      const div = d < 0.4 ? (r() < 0.55 ? 1 : 2) : (r() < 0.35 ? 2 : 3);
      const sub = size / div;
      for (let a = 0; a < div; a++) for (let c = 0; c < div; c++) {
        if (div === 3 && r() < 0.1) continue;
        const inset = 0.5 + r() * 2;
        const w = sub - inset * 2, dd = sub - inset * 2;
        const base = d < 0.3 ? 110 + r() * 260 : d < 0.6 ? 35 + r() * 110 * (1 - d) * 2 : 14 + r() * 32;
        const h = Math.max(8, base * (0.6 + r() * 0.6));
        const bx = x0 + a * sub + sub / 2, bz = z0 + c * sub + sub / 2;
        const col = new THREE.Color(palette[r() * palette.length | 0]).multiplyScalar(0.8 + r() * 0.3);
        blk.b.push({ minX: bx - w / 2, maxX: bx + w / 2, minZ: bz - dd / 2, maxZ: bz + dd / 2, top: h }); getChunk(i, j).list.push({ bx, bz, w, dd, h, col });
        let top = h, tw = w, td = dd;
        for (let tier = 0; tier < 2 && top > 110 && r() < 0.6; tier++) { // NYC-style setbacks
          const h2 = top * (0.12 + r() * 0.22); tw *= 0.7; td *= 0.7;
          blk.b.push({ minX: bx - tw / 2, maxX: bx + tw / 2, minZ: bz - td / 2, maxZ: bz + td / 2, top: top + h2 });
          getChunk(i, j).list.push({ bx, bz, w: tw, dd: td, h: h2, y: top, col: col.clone().multiplyScalar(0.95) }); top += h2;
        }
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const ch of chunkData.values()) {
      const n = ch.list.length; if (!n) continue;
      const im = new THREE.InstancedMesh(box, bMat, n), roof = new THREE.InstancedMesh(box, parapetMat, n * 2);
      ch.list.forEach((o, k) => {
        p.set(o.bx, o.y || 0, o.bz); s.set(o.w, o.h, o.dd); m.compose(p, q, s); im.setMatrixAt(k, m); im.setColorAt(k, o.col);
        p.set(o.bx, (o.y || 0) + o.h, o.bz); s.set(o.w + 0.5, 1.1, o.dd + 0.5); m.compose(p, q, s); roof.setMatrixAt(k * 2, m); // parapet cap
        p.set(o.bx + o.w * 0.15, (o.y || 0) + o.h, o.bz - o.dd * 0.1); s.set(Math.min(8, o.w * 0.3), 3.5, Math.min(6, o.dd * 0.25)); m.compose(p, q, s); roof.setMatrixAt(k * 2 + 1, m); // rooftop plant room
      });
      for (const x of [im, roof]) { x.computeBoundingSphere(); x.castShadow = x.receiveShadow = true; }
      const g = new THREE.Group(); g.add(im, roof); scene.add(g);
      this.chunks.push({ group: g, cx: -HALF + (ch.ci + 0.5) * CH * BLOCK, cz: -HALF + (ch.cj + 0.5) * CH * BLOCK });
    }
    // trees (instanced, jittered icosphere canopies with colour variation)
    const tg = new THREE.CylinderGeometry(0.18, 0.28, 3, 5); tg.translate(0, 1.5, 0);
    const cg = new THREE.IcosahedronGeometry(2.2, 1); { const a = cg.attributes.position; for (let k = 0; k < a.count; k++) { const f = 0.85 + Math.sin(a.getX(k) * 3.1 + a.getZ(k) * 2.3) * 0.12; a.setXYZ(k, a.getX(k) * f, a.getY(k) * 0.85 * f, a.getZ(k) * f); } cg.computeVertexNormals(); cg.translate(0, 4.6, 0); }
    const ti = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 }), trees.length);
    const ci = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), trees.length);
    const tc = new THREE.Color();
    trees.forEach(([x, z, sc], k) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); m.compose(p.set(x, 0, z), q, s.set(sc, sc * (0.9 + r() * 0.3), sc)); ti.setMatrixAt(k, m); ci.setMatrixAt(k, m); ci.setColorAt(k, tc.setHSL(0.24 + r() * 0.08, 0.45 + r() * 0.2, 0.2 + r() * 0.1)); });
    ci.castShadow = true; ci.receiveShadow = true; scene.add(ti, ci); this.treeMesh = ci;
    this.buildLandmarks(); this.buildPiers();
  }
  buildPiers() {
    const sc = this.scene, wood = new THREE.MeshStandardMaterial({ color: 0x6b6158, roughness: 0.85 });
    const shed = new THREE.MeshStandardMaterial({ color: 0x8a9298, roughness: 0.5, metalness: 0.6 });
    const pileG = new THREE.CylinderGeometry(0.35, 0.35, 8, 6); const piles = [];
    this.piers = [];
    for (const px of [-1300, -1020, -700, -420, -120, 200, 520, 1180, 1450]) {
      const len = 140 + (px % 7) * 6, w = 22, z0 = HALF;
      const deck = new THREE.Mesh(new RoundedBoxGeometry(w, 1.4, len, 2, 0.3), wood); deck.position.set(px, -0.2, z0 + len / 2); deck.castShadow = deck.receiveShadow = true; sc.add(deck);
      this.piers.push({ minX: px - w / 2, maxX: px + w / 2, minZ: z0, maxZ: z0 + len, top: 0.5 });
      if (Math.abs(px) % 3 < 2) { const s = new THREE.Mesh(new THREE.BoxGeometry(w - 6, 9, len * 0.6), shed); s.position.set(px, 5, z0 + len * 0.45); s.castShadow = s.receiveShadow = true; sc.add(s);
        const rf = new THREE.Mesh(new THREE.CylinderGeometry((w - 6) / 2, (w - 6) / 2, len * 0.6, 12, 1, false, 0, Math.PI), shed); rf.rotation.set(Math.PI / 2, 0, -Math.PI / 2); rf.rotation.order = 'ZXY'; rf.position.set(px, 9.5, z0 + len * 0.45); rf.scale.set(1, 1, 0.35); sc.add(rf);
        this.piers.push({ minX: px - (w - 6) / 2, maxX: px + (w - 6) / 2, minZ: z0 + len * 0.15, maxZ: z0 + len * 0.75, top: 10 }); }
      for (let z = 4; z < len; z += 10) for (const dx of [-w / 2 + 1, w / 2 - 1]) piles.push([px + dx, z0 + z]);
    }
    const pi = new THREE.InstancedMesh(pileG, wood, piles.length), m = new THREE.Matrix4();
    piles.forEach(([x, z], k) => pi.setMatrixAt(k, m.makeTranslation(x, -3.5, z))); sc.add(pi);
  }
  buildLandmarks() {
    const S = this.landmarkSpots, sc = this.scene;
    const add = (mesh, spot, coll) => { mesh.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); sc.add(mesh); if (coll) spot.blk.b.push(coll); };
    const glass = new THREE.MeshStandardMaterial({ color: 0x8fa6b8, metalness: 0.95, roughness: 0.06 });
    // 1. Central spire tower (tallest)
    { const o = S[0], g = new THREE.Group();
      const t1 = new THREE.Mesh(new THREE.CylinderGeometry(14, 22, 420, 8), glass); t1.position.y = 210;
      const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 4, 120, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.3 })); t2.position.y = 480;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.6, 0.3) })); beacon.position.y = 542;
      g.add(t1, t2, beacon); g.position.set(o.cx, 0, o.cz);
      add(g, o, { minX: o.cx - 15, maxX: o.cx + 15, minZ: o.cz - 15, maxZ: o.cz + 15, top: 420 }); }
    { const o = S[1]; const st = new THREE.Mesh(new THREE.CylinderGeometry(30, 26, 22, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5, side: THREE.DoubleSide }));
      st.position.set(o.cx, 11, o.cz); add(st, o);
      const field = new THREE.Mesh(new THREE.CircleGeometry(26, 32), new THREE.MeshStandardMaterial({ color: 0x3a8a3a, roughness: 0.9 })); field.rotation.x = -Math.PI / 2; field.position.set(o.cx, 0.2, o.cz); field.receiveShadow = true; sc.add(field); }
    { const o = S[2]; const d = new THREE.Mesh(new THREE.SphereGeometry(28, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }));
      d.position.set(o.cx, 0, o.cz); add(d, o, { minX: o.cx - 20, maxX: o.cx + 20, minZ: o.cz - 20, maxZ: o.cz + 20, top: 26 }); }
    { const o = S[3]; const mat = new THREE.MeshStandardMaterial({ color: 0x2a3644, metalness: 0.9, roughness: 0.1 });
      for (const dx of [-15, 15]) { const t = new THREE.Mesh(new THREE.BoxGeometry(18, 300, 18), mat); t.position.set(o.cx + dx, 150, o.cz); add(t, o, { minX: o.cx + dx - 9, maxX: o.cx + dx + 9, minZ: o.cz - 9, maxZ: o.cz + 9, top: 300 }); }
      const br = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 6), mat); br.position.set(o.cx, 200, o.cz); add(br, o); }
  }
  isWater(x, z) {
    if (z > HALF || x > HALF) { for (const p of this.piers) if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) return false; return true; }
    if (x > RIVER_X0 && x < RIVER_X1) { for (const [a, b] of this.bridges) if (z > a && z < b) return false; return true; }
    return false;
  }
  blockAt(x, z) { const i = Math.floor((x + HALF) / BLOCK), j = Math.floor((z + HALF) / BLOCK); if (i < 0 || j < 0 || i >= GRID || j >= GRID) return null; return this.blocks[i * GRID + j]; }
  boxesNear(x, z) { const blk = this.blockAt(x, z); if (blk) return blk.b; return (z > HALF - 10) ? this.piers : []; }
  heightAt(x, z, r = 0) {
    let h = 0;
    for (const b of this.boxesNear(x, z)) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) h = Math.max(h, b.top);
    return h;
  }
  collide(pos, vel, r) {
    let floor = 0;
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
    const lim = HALF + 2500; pos.x = Math.max(-lim, Math.min(lim, pos.x)); pos.z = Math.max(-lim, Math.min(lim, pos.z));
    return floor;
  }
  update(camPos, viewDist) {
    for (const c of this.chunks) c.group.visible = Math.hypot(c.cx - camPos.x, c.cz - camPos.z) < viewDist + 460;
  }
}
