import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
// Sky (physical Rayleigh/Mie sky shader), image-based lighting from it, a sun and
// haze. No shadow maps and no water (performance on Xbox): the old ocean / river are sand dunes now (city.js).
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
    sun.castShadow = false;
    scene.add(sun, sun.target); this.sun = sun;
    this.t = 0;
  }
  buildEnv(renderer) { // (re)bake the sky/city IBL; without it every PBR surface goes dark
    const pm = new THREE.PMREMGenerator(renderer), old = this.envRT;
    this.envRT = pm.fromScene(this.envScene, 0.02); this.scene.environment = this.envRT.texture; pm.dispose(); old?.dispose();
  }
  setQuality(q) { this.sun.castShadow = false; } // (no shadow maps / water in any preset)
  update(dt, camera, focus) {
    this.t += dt; this.sky.position.copy(camera.position);
  }
}
