import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { WATER_Y } from './city.js';
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

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    const sky = new Sky(); sky.scale.setScalar(6000);
    const u = sky.material.uniforms; u.turbidity.value = 9; u.rayleigh.value = 1.1; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.82;
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 40), THREE.MathUtils.degToRad(160));
    u.sunPosition.value.copy(this.sunDir);
    scene.add(sky); this.sky = sky;
    // IBL from the sky
    const pm = new THREE.PMREMGenerator(renderer); const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000);
    sky2.material.uniforms.turbidity.value = 9; sky2.material.uniforms.rayleigh.value = 1.1; sky2.material.uniforms.mieCoefficient.value = 0.006; sky2.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(sky2); const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16), new THREE.MeshBasicMaterial({ color: 0x3c3f42 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -20; envScene.add(ground);
    scene.environment = pm.fromScene(envScene, 0.02).texture; pm.dispose();
    scene.fog = new THREE.FogExp2(0xbccbd6, 0.00042); scene.background = new THREE.Color(0xbccbd6);
    // lights: soft sky fill + sun
    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x5a5650, 0.6); scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 3.2); sun.position.copy(this.sunDir).multiplyScalar(400);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; sun.shadow.camera.near = 10; sun.shadow.camera.far = 1400;
    scene.add(sun, sun.target); this.sun = sun;
    // ocean
    this.normals = waterNormals();
    const geo = new THREE.PlaneGeometry(30000, 30000); this.waters = {};
    for (const res of [512, 256]) {
      const w = new Water(geo, { textureWidth: res, textureHeight: res, waterNormals: this.normals, sunDirection: this.sunDir.clone(), sunColor: 0xfff4e0,
        waterColor: 0x05202e, distortionScale: 1.4, fog: true, alpha: 1.0 });
      w.material.uniforms.size.value = 4.0; w.rotation.x = -Math.PI / 2; w.position.y = WATER_Y; w.visible = false; scene.add(w); this.waters[res] = w;
    }
    const n2 = this.normals.clone(); n2.repeat.set(1200, 1200); n2.needsUpdate = true;
    this.cheapWater = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0b2c3c, roughness: 0.06, metalness: 0.3, normalMap: n2, normalScale: new THREE.Vector2(0.35, 0.35) }));
    this.cheapWater.rotation.x = -Math.PI / 2; this.cheapWater.position.y = WATER_Y; scene.add(this.cheapWater);
    this.t = 0;
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
