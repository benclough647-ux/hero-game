import * as THREE from 'three';
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

export const HAZE = 0xc4e0f4; // pale blue aerial-perspective haze (matches the sky horizon)
function skyMaterial(sunDir, noClouds = false) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir.clone() }, uT: { value: 0 } },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 uSun; uniform float uT; varying vec3 vDir;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n2(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir); float el = d.y;
        vec3 zen = vec3(0.07, 0.30, 0.95), mid = vec3(0.25, 0.58, 1.0), hor = vec3(0.62, 0.84, 0.98);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.25, el)); col = mix(col, zen, smoothstep(0.25, 0.85, el));
        if (el < 0.0) col = hor * 0.92;
        float sd = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.9, 0.7) * pow(sd, 18.0) * 0.35 + vec3(1.0, 0.95, 0.8) * smoothstep(0.9993, 0.9996, sd) * 6.0; // halo + crisp disc
        ${noClouds ? '' : `if (el > 0.015) {
          vec2 uv = d.xz / (el + 0.12) * 1.6 + vec2(uT * 0.006, uT * 0.002);
          float c = fbm(uv) + 0.35 * fbm(uv * 2.7 + 3.0) - 0.55;
          float cs = fbm(uv - normalize(uSun.xz) * 0.08) + 0.35 * fbm((uv - normalize(uSun.xz) * 0.08) * 2.7 + 3.0) - 0.55; // toward the sun
          float fw = fwidth(c) * 1.5 + 0.004;
          float m = smoothstep(0.08 - fw, 0.08 + fw, c) * smoothstep(0.015, 0.12, el);
          float lit = smoothstep(0.02, 0.05, c - cs + 0.03); // cel split: sunlit tops vs shaded bellies
          vec3 cc = mix(vec3(0.70, 0.80, 0.95), vec3(1.08, 1.08, 1.06), lit);
          col = mix(col, cc, m);
        }`}
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
}

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    // stylised anime sky: saturated blue gradient, soft sun halo, cel-shaded drifting clouds (own shader)
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 40), THREE.MathUtils.degToRad(160));
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMaterial(this.sunDir)); sky.scale.setScalar(6000); sky.frustumCulled = false; sky.renderOrder = -10;
    scene.add(sky); this.sky = sky;
    // IBL from the same sky (for the few remaining PBR surfaces, e.g. the water)
    const pm = new THREE.PMREMGenerator(renderer); const envScene = new THREE.Scene(); const sky2 = new THREE.Mesh(sky.geometry, skyMaterial(this.sunDir, true)); sky2.scale.setScalar(1000);
    envScene.add(sky2); const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 16), new THREE.MeshBasicMaterial({ color: 0x6d7480 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -20; envScene.add(ground);
    scene.environment = pm.fromScene(envScene, 0.02).texture; pm.dispose();
    scene.fog = new THREE.FogExp2(HAZE, 0.00042); scene.background = new THREE.Color(HAZE);
    // lights: bright sky fill (keeps toon shadows colourful, not black) + warm sun
    this.hemi = new THREE.HemisphereLight(0xdde8ff, 0xd0c2aa, 2.3); scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff2de, 2.6); sun.position.copy(this.sunDir).multiplyScalar(400);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6; sun.shadow.camera.near = 10; sun.shadow.camera.far = 1400;
    scene.add(sun, sun.target); this.sun = sun;
    // ocean
    this.normals = waterNormals();
    const geo = new THREE.PlaneGeometry(30000, 30000, 60, 60); this.waters = {}; // tiled: one huge triangle pair gets clipped with bad depth on some rasterisers and showed through the streets
    for (const res of [512, 256]) {
      const w = new Water(geo, { textureWidth: res, textureHeight: res, waterNormals: this.normals, sunDirection: this.sunDir.clone(), sunColor: 0xfff4e0,
        waterColor: 0x05202e, distortionScale: 1.4, fog: true, alpha: 1.0 });
      w.material.uniforms.size.value = 4.0; w.renderOrder = -5; /* drawn first: its mirror pass must not disturb the land drawn over it */ w.rotation.x = -Math.PI / 2; w.position.y = WATER_Y; w.visible = false; scene.add(w); this.waters[res] = w;
    }
    const n2 = this.normals.clone(); n2.repeat.set(1200, 1200); n2.needsUpdate = true;
    this.cheapWater = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0b2c3c, roughness: 0.06, metalness: 0.3, normalMap: n2, normalScale: new THREE.Vector2(0.35, 0.35) }));
    this.cheapWater.rotation.x = -Math.PI / 2; this.cheapWater.position.y = WATER_Y; scene.add(this.cheapWater);
    this.t = 0;
  }
  setQuality(q) {
    this.waterRes = q.water; this.applyWater(true);
    const s = this.sun; s.castShadow = q.shadow > 0;
    if (q.shadow) { if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; } s.shadow.mapSize.set(q.shadow, q.shadow);
      const e = q.shadowExtent, c = s.shadow.camera; c.left = c.bottom = -e; c.right = c.top = e; c.updateProjectionMatrix(); this.shadowExtent = e; }
  }
  // the reflective water costs a full extra scene render (mirror pass), so it is only used when water is actually near the
  // camera; elsewhere the cheap water plane stands in (it is hidden under the streets anyway)
  applyWater(near) {
    const r = near ? this.waterRes : 0;
    this.waters[512].visible = r === 512; this.waters[256].visible = r === 256; this.cheapWater.visible = !r;
  }
  update(dt, camera, focus) {
    { const c = camera.position, d = Math.min(HALF - c.z, HALF - c.x, Math.abs(c.x - (RIVER_X0 + RIVER_X1) / 2));
      const near = d < 420 || c.y > 220; if (near !== this.nearWater) { this.nearWater = near; this.applyWater(near); } }
    this.t += dt; this.sky.position.copy(camera.position); this.sky.material.uniforms.uT.value = this.t;
    for (const w of Object.values(this.waters)) w.material.uniforms.time.value = this.t * 0.6;
    this.cheapWater.material.normalMap.offset.set(this.t * 0.004, this.t * 0.0025);
    // shadow frustum follows the hero, snapped to texels to avoid shimmer
    const s = this.sun; if (s.castShadow) {
      const texel = (this.shadowExtent * 2) / s.shadow.mapSize.x; const f = focus.clone(); f.x = Math.round(f.x / texel) * texel; f.z = Math.round(f.z / texel) * texel;
      s.target.position.copy(f); s.position.copy(f).addScaledVector(this.sunDir, 700); s.target.updateMatrixWorld();
    }
  }
}
