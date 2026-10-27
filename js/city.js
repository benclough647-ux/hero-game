import * as THREE from 'three';
// Procedural city: grid of blocks, instanced buildings per chunk, parks, a lake, river, landmarks.
// Exposes heightAt() and collide() for hero physics.
export const BLOCK = 80, ROAD = 18, GRID = 40; // 40x40 blocks = 3.2km square
const HALF = GRID * BLOCK / 2;

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function windowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
    const v = 60 + Math.random() * 60; g.fillStyle = `rgb(${v},${v + 10},${v + 25})`; g.fillRect(x * 8 + 1, y * 8 + 2, 6, 5);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 8);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class City {
  constructor(scene) {
    this.scene = scene; this.blocks = []; this.chunks = [];
    const r = rng(1337);
    const tex = windowTexture();
    const bMat = new THREE.MeshLambertMaterial({ map: tex });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x555a60 });
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);

    // ground / roads
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRID * BLOCK * 3, GRID * BLOCK * 3), new THREE.MeshLambertMaterial({ color: 0x2b2d31 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    // road markings via a tiled texture on a slightly raised plane
    const rc = document.createElement('canvas'); rc.width = rc.height = 256; const rg = rc.getContext('2d');
    rg.fillStyle = '#8b8d90'; rg.fillRect(0, 0, 256, 256); // sidewalk/lot base
    const rp = 256 * ROAD / BLOCK; rg.fillStyle = '#2b2d31'; rg.fillRect(0, 0, 256, rp); rg.fillRect(0, 0, rp, 256);
    rg.fillStyle = '#d8c25a'; for (let i = 0; i < 256; i += 16) { rg.fillRect(i, rp / 2 - 1, 8, 2); rg.fillRect(rp / 2 - 1, i, 2, 8); }
    const rtex = new THREE.CanvasTexture(rc); rtex.wrapS = rtex.wrapT = THREE.RepeatWrapping; rtex.repeat.set(GRID, GRID); rtex.anisotropy = 8; rtex.colorSpace = THREE.SRGBColorSpace;
    const streets = new THREE.Mesh(new THREE.PlaneGeometry(GRID * BLOCK, GRID * BLOCK), new THREE.MeshLambertMaterial({ map: rtex }));
    streets.rotation.x = -Math.PI / 2; streets.position.y = 0.05; scene.add(streets);

    // block types
    const lake = { cx: 10, cz: 26, r: 4.2 };
    const riverX = 30;
    const parkMat = new THREE.MeshLambertMaterial({ color: 0x3f8a3a });
    const waterMat = new THREE.MeshPhongMaterial({ color: 0x1d5f8c, shininess: 90, specular: 0x88aacc, transparent: true, opacity: 0.92 });
    const treeTrunk = [], treeTop = [];
    const CH = 8; // chunk = 8x8 blocks
    const chunkData = new Map();
    const getChunk = (i, j) => { const key = (i / CH | 0) + ',' + (j / CH | 0); if (!chunkData.has(key)) chunkData.set(key, { list: [], ci: i / CH | 0, cj: j / CH | 0 }); return chunkData.get(key); };
    this.landmarkSpots = [];

    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const x0 = -HALF + i * BLOCK + ROAD, z0 = -HALF + j * BLOCK + ROAD, size = BLOCK - ROAD;
      const blk = { b: [] }; this.blocks.push(blk);
      const cx = x0 + size / 2, cz = z0 + size / 2;
      if (Math.hypot(i - lake.cx, j - lake.cz) < lake.r || i === riverX) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(i === riverX ? BLOCK : BLOCK, BLOCK), waterMat);
        w.rotation.x = -Math.PI / 2; w.position.set(cx - ROAD / 2, 0.15, cz - ROAD / 2); scene.add(w); blk.water = true; continue;
      }
      const d = Math.hypot(i - GRID / 2, j - GRID / 2) / (GRID / 2);
      if ((i === 20 && j === 20) || (i === 8 && j === 8) || (i === 32 && j === 12) || (i === 14 && j === 33)) { this.landmarkSpots.push({ i, j, cx, cz, size, blk }); continue; }
      if (r() < 0.07 || (i >= 22 && i <= 24 && j >= 6 && j <= 9)) { // park
        const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), parkMat); p.rotation.x = -Math.PI / 2; p.position.set(cx, 0.1, cz); scene.add(p);
        for (let t = 0; t < 14; t++) { const tx = x0 + 3 + r() * (size - 6), tz = z0 + 3 + r() * (size - 6), s = 0.7 + r() * 0.8; treeTrunk.push([tx, tz, s]); }
        continue;
      }
      // buildings: 1, 2x2 or 3x3 subdivisions; downtown tall
      const div = d < 0.35 ? (r() < 0.5 ? 1 : 2) : (r() < 0.3 ? 2 : 3);
      const sub = size / div;
      for (let a = 0; a < div; a++) for (let c = 0; c < div; c++) {
        if (div === 3 && r() < 0.12) continue;
        const inset = 1 + r() * 3;
        const w = sub - inset * 2, dd = sub - inset * 2;
        const base = d < 0.3 ? 90 + r() * 260 : d < 0.6 ? 25 + r() * 90 * (1 - d) * 2 : 8 + r() * 30;
        const h = Math.max(6, base * (0.6 + r() * 0.6));
        const bx = x0 + a * sub + sub / 2, bz = z0 + c * sub + sub / 2;
        const tint = 0.55 + r() * 0.45; const hue = r();
        const col = new THREE.Color().setHSL(0.55 + hue * 0.12, 0.08 + r() * 0.15, 0.35 + tint * 0.35);
        if (r() < 0.15) col.setHSL(0.08, 0.3, 0.45 + r() * 0.2); // brick-ish
        const bd = { minX: bx - w / 2, maxX: bx + w / 2, minZ: bz - dd / 2, maxZ: bz + dd / 2, top: h };
        blk.b.push(bd); getChunk(i, j).list.push({ bx, bz, w, dd, h, col });
        if (h > 120 && r() < 0.5) { // setback tier
          const h2 = h * (0.15 + r() * 0.25), w2 = w * 0.6, d2 = dd * 0.6;
          blk.b.push({ minX: bx - w2 / 2, maxX: bx + w2 / 2, minZ: bz - d2 / 2, maxZ: bz + d2 / 2, top: h + h2 });
          getChunk(i, j).list.push({ bx, bz, w: w2, dd: d2, h: h2, y: h, col: col.clone().multiplyScalar(0.9) });
        }
      }
    }
    // build instanced chunks
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const ch of chunkData.values()) {
      const n = ch.list.length; if (!n) continue;
      const im = new THREE.InstancedMesh(box, bMat, n), roof = new THREE.InstancedMesh(box, roofMat, n);
      ch.list.forEach((o, k) => {
        p.set(o.bx, o.y || 0, o.bz); s.set(o.w, o.h, o.dd); m.compose(p, q, s); im.setMatrixAt(k, m); im.setColorAt(k, o.col);
        p.set(o.bx, (o.y || 0) + o.h, o.bz); s.set(o.w + 0.6, 0.8, o.dd + 0.6); m.compose(p, q, s); roof.setMatrixAt(k, m);
      });
      im.computeBoundingSphere(); roof.computeBoundingSphere();
      const g = new THREE.Group(); g.add(im, roof); scene.add(g);
      this.chunks.push({ group: g, cx: -HALF + (ch.ci + 0.5) * CH * BLOCK, cz: -HALF + (ch.cj + 0.5) * CH * BLOCK });
    }
    // trees
    if (treeTrunk.length) {
      const tg = new THREE.CylinderGeometry(0.3, 0.4, 3, 6); tg.translate(0, 1.5, 0);
      const cg = new THREE.ConeGeometry(2.2, 6, 7); cg.translate(0, 5.5, 0);
      const ti = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({ color: 0x5a3b22 }), treeTrunk.length);
      const ci = new THREE.InstancedMesh(cg, new THREE.MeshLambertMaterial({ color: 0x2c6b2a }), treeTrunk.length);
      treeTrunk.forEach(([x, z, sc], k) => { m.compose(p.set(x, 0, z), q, s.set(sc, sc, sc)); ti.setMatrixAt(k, m); ci.setMatrixAt(k, m); });
      scene.add(ti, ci);
    }
    this.buildLandmarks();
  }
  buildLandmarks() {
    const S = this.landmarkSpots, sc = this.scene;
    const add = (mesh, spot, coll) => { sc.add(mesh); if (coll) spot.blk.b.push(coll); };
    // 1. Central spire tower (tallest)
    { const o = S[0], g = new THREE.Group();
      const mat = new THREE.MeshPhongMaterial({ color: 0x9fb8cc, shininess: 80, specular: 0xffffff });
      const t1 = new THREE.Mesh(new THREE.CylinderGeometry(14, 22, 420, 8), mat); t1.position.y = 210;
      const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 4, 120, 6), new THREE.MeshPhongMaterial({ color: 0xdddddd })); t2.position.y = 480;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3020 })); beacon.position.y = 542;
      g.add(t1, t2, beacon); g.position.set(o.cx, 0, o.cz);
      add(g, o, { minX: o.cx - 15, maxX: o.cx + 15, minZ: o.cz - 15, maxZ: o.cz + 15, top: 420 }); }
    // 2. Stadium
    { const o = S[1]; const st = new THREE.Mesh(new THREE.CylinderGeometry(30, 26, 22, 32, 1, true), new THREE.MeshLambertMaterial({ color: 0xcfcfcf, side: THREE.DoubleSide }));
      st.position.set(o.cx, 11, o.cz); sc.add(st);
      const field = new THREE.Mesh(new THREE.CircleGeometry(26, 32), new THREE.MeshLambertMaterial({ color: 0x3a9a3a })); field.rotation.x = -Math.PI / 2; field.position.set(o.cx, 0.2, o.cz); sc.add(field); }
    // 3. Dome hall
    { const o = S[2]; const d = new THREE.Mesh(new THREE.SphereGeometry(28, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0xc9a24a, shininess: 60 }));
      d.position.set(o.cx, 0, o.cz); add(d, o, { minX: o.cx - 20, maxX: o.cx + 20, minZ: o.cz - 20, maxZ: o.cz + 20, top: 26 }); }
    // 4. Twin towers with skybridge
    { const o = S[3]; const mat = new THREE.MeshPhongMaterial({ color: 0x334455, shininess: 100, specular: 0x99bbdd });
      for (const dx of [-15, 15]) { const t = new THREE.Mesh(new THREE.BoxGeometry(18, 300, 18), mat); t.position.set(o.cx + dx, 150, o.cz); add(t, o, { minX: o.cx + dx - 9, maxX: o.cx + dx + 9, minZ: o.cz - 9, maxZ: o.cz + 9, top: 300 }); }
      const br = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 6), mat); br.position.set(o.cx, 200, o.cz); sc.add(br); }
  }
  blockAt(x, z) { const i = Math.floor((x + HALF) / BLOCK), j = Math.floor((z + HALF) / BLOCK); if (i < 0 || j < 0 || i >= GRID || j >= GRID) return null; return this.blocks[i * GRID + j]; }
  // highest surface under point (ground = 0)
  heightAt(x, z, r = 0) {
    const blk = this.blockAt(x, z); let h = 0; if (!blk) return 0;
    for (const b of blk.b) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) h = Math.max(h, b.top);
    return h;
  }
  // resolve hero position against building walls; returns surface height to stand on
  collide(pos, vel, r) {
    let floor = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const blk = this.blockAt(pos.x + dx * BLOCK * 0.5, pos.z + dz * BLOCK * 0.5); if (!blk) continue;
      for (const b of blk.b) {
        if (pos.x < b.minX - r || pos.x > b.maxX + r || pos.z < b.minZ - r || pos.z > b.maxZ + r) continue;
        if (pos.y >= b.top - 1.2) { floor = Math.max(floor, b.top); continue; }
        // push out along smallest penetration
        const px1 = pos.x - (b.minX - r), px2 = (b.maxX + r) - pos.x, pz1 = pos.z - (b.minZ - r), pz2 = (b.maxZ + r) - pos.z;
        const mn = Math.min(px1, px2, pz1, pz2);
        if (mn === px1) { pos.x = b.minX - r; if (vel.x > 0) vel.x = 0; }
        else if (mn === px2) { pos.x = b.maxX + r; if (vel.x < 0) vel.x = 0; }
        else if (mn === pz1) { pos.z = b.minZ - r; if (vel.z > 0) vel.z = 0; }
        else { pos.z = b.maxZ + r; if (vel.z < 0) vel.z = 0; }
      }
    }
    const lim = HALF + 600; pos.x = Math.max(-lim, Math.min(lim, pos.x)); pos.z = Math.max(-lim, Math.min(lim, pos.z));
    return floor;
  }
  update(camPos, viewDist) { // chunk distance culling
    for (const c of this.chunks) c.group.visible = Math.hypot(c.cx - camPos.x, c.cz - camPos.z) < viewDist + 460;
  }
}
