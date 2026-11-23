import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { WATER_Y, HALF, RIVER_X0, RIVER_X1 } from './city.js';
// Sky (physical Rayleigh/Mie sky shader), image-based lighting from it, sun with hero-following
// soft shadow frustum, haze, and an ocean with planar reflections (Water shader) + cheap fallback.
function waterNormals() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); const img = g.createImageData(S, S);
  const waves = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 28; k++) { const kx = Math.round((rnd() - 0.5) * 24), ky = Math.round((rnd() - 0.5) * 24); if (!kx && !ky) continue; waves.push([kx, ky, rnd() * 6.28, 1 / Math.hypot(kx, ky)]); }
  const H = (x, y) => { let h = 0; for (const [kx, ky, ph, a] of waves) h += Math.sin((kx * x + ky * y) / S * 6.2832 + ph) * a; return h; };
  const hs = new Float32Array(S * S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hs[y * S + x] = H(x, y);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (hs[y * S + (x + 1) % S] - hs[y * S + (x + S - 1) % S]) * 6, dy = (hs[((y + 1) % S) * S + x] - hs[((y + S - 1) % S) * S + x]) * 6;
    const l = Math.hypot(dx, dy, 1), o = (y * S + x) * 4;
    img.data[o] = (-dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// Water only where there is water: the ocean (south + east of the city) and the river channel. A single 30 km plane
// under the whole map used to z-fight / show through the streets at a distance (only 0.6 m below the ground).
function waterGeometry(E = 15000) {
  const rects = [[-E, E, HALF, E], [HALF, E, -E, HALF], [RIVER_X0 - 0.5, RIVER_X1 + 0.5, -E, HALF]]; // [x0,x1,z0,z1] in world xz
  const P = [], U = [], I = [];
  for (const [x0, x1, z0, z1] of rects) { const b = P.length / 3; // local plane is XY; the mesh is rotated -90deg about X (local y = -world z)
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) { P.push(x, -z, 0); U.push(x / 30000 + 0.5, -z / 30000 + 0.5); }
    I.push(b, b + 2, b + 1, b, b + 3, b + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(P.length / 3).fill([0, 0, 1]).flat(), 3)); g.setIndex(I); g.computeBoundingSphere(); return g;
}

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    const sky = new Sky(); sky.scale.setScalar(6000);
    const u = sky.material.uniforms; u.turbidity.value = 9; u.rayleigh.value = 1.1; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.82;
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 40), THREE.MathUtils.degToRad(160));
    u.sunPosition.value.copy(this.sunDir);
    scene.add(sky); this.sky = sky;
    // IBL from the sky (kept so it can be rebuilt after a WebGL context loss: a PMREM render target has no CPU copy)
    const envScene = new THREE.Scene(); this.envScene = envScene; const sky2 = new Sky(); sky2.scale.setScalar(1000);
    sky2.material.uniforms.turbidity.value = 9; sky2.material.uniforms.rayleigh.value = 1.1; sky2.material.uniforms.mieCoefficient.value = 0.006; sky2.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(sky2); const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16), new THREE.MeshBasicMaterial({ color: 0x4a4641 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -20; envScene.add(ground);
    // a ring of warm-grey "city" around the horizon: in a street canyon most of what you see is buildings, not blue sky,
    // so shadowed surfaces get a neutral bounce instead of a strong blue cast
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(800, 800, 300, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x77716a, side: THREE.BackSide })); ring.position.y = 130; envScene.add(ring);
    // and a thin warm-grey veil over the whole sky: shadows read neutral grey-blue (GTA-like) instead of saturated blue
    const veil = new THREE.Mesh(new THREE.SphereGeometry(850, 24, 12), new THREE.MeshBasicMaterial({ color: 0x8c8780, side: THREE.BackSide, transparent: true, opacity: 0.42, depthWrite: false })); envScene.add(veil);
    this.buildEnv(renderer);
    scene.fog = new THREE.FogExp2(0xbccbd6, 0.00042); scene.background = new THREE.Color(0xbccbd6);
    // lights: soft sky fill + sun
    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x6a5f50, 0.4); scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffe9cf, 3.8); sun.position.copy(this.sunDir).multiplyScalar(400);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; sun.shadow.camera.near = 10; sun.shadow.camera.far = 1400;
    scene.add(sun, sun.target); this.sun = sun;
    // ocean
    this.normals = waterNormals();
    const geo = waterGeometry(); this.waters = {};
    for (const res of [512, 256]) {
      const w = new Water(geo, { textureWidth: res, textureHeight: res, waterNormals: this.normals, sunDirection: this.sunDir.clone(), sunColor: 0xfff4e0,
        waterColor: 0x05202e, distortionScale: 1.4, fog: true, alpha: 1.0 });
      w.material.uniforms.size.value = 4.0;
      // the planar reflection re-renders the scene: skip street furniture / trees / rooftop clutter there (they are tiny in
      // the reflection but would double their cost)
      const orig = w.onBeforeRender.bind(w); w.onBeforeRender = (...args) => { const hide = this.reflectionHide || [], was = hide.map(o => o.visible); hide.forEach(o => o.visible = false); orig(...args); hide.forEach((o, k) => o.visible = was[k]); }; w.rotation.x = -Math.PI / 2; w.position.y = WATER_Y; w.visible = false; scene.add(w); this.waters[res] = w;
    }
    const n2 = this.normals.clone(); n2.repeat.set(1200, 1200); n2.needsUpdate = true;
    this.cheapWater = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0b2c3c, roughness: 0.06, metalness: 0.3, normalMap: n2, normalScale: new THREE.Vector2(0.35, 0.35) }));
    this.cheapWater.rotation.x = -Math.PI / 2; this.cheapWater.position.y = WATER_Y; scene.add(this.cheapWater);
    this.t = 0;
  }
  buildEnv(renderer) { // (re)bake the sky/city IBL; without it every PBR surface goes dark
    const pm = new THREE.PMREMGenerator(renderer), old = this.envRT;
    this.envRT = pm.fromScene(this.envScene, 0.02); this.scene.environment = this.envRT.texture; pm.dispose(); old?.dispose();
  }
  setQuality(q) {
    this.waters[512].visible = q.water === 512; this.waters[256].visible = q.water === 256; this.cheapWater.visible = !q.water;
    const s = this.sun; s.castShadow = q.shadow > 0;
    if (q.shadow) { if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; } s.shadow.mapSize.set(q.shadow, q.shadow);
      const e = q.shadowExtent, c = s.shadow.camera; c.left = c.bottom = -e; c.right = c.top = e; c.updateProjectionMatrix(); this.shadowExtent = e; }
  }
  update(dt, camera, focus) {
    this.t += dt; this.sky.position.copy(camera.position);
    for (const w of Object.values(this.waters)) w.material.uniforms.time.value = this.t * 0.6;
    this.cheapWater.material.normalMap.offset.set(this.t * 0.004, this.t * 0.0025);
    // shadow frustum follows the hero, snapped to texels to avoid shimmer
    const s = this.sun; if (s.castShadow) {
      const texel = (this.shadowExtent * 2) / s.shadow.mapSize.x; const f = focus.clone(); f.x = Math.round(f.x / texel) * texel; f.z = Math.round(f.z / texel) * texel;
      s.target.position.copy(f); s.position.copy(f).addScaledVector(this.sunDir, 700); s.target.updateMatrixWorld();
    }
  }
}
