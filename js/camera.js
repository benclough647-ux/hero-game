import * as THREE from 'three';
// Smooth third-person orbit camera with speed-based FOV/distance and building avoidance.
export class ThirdPersonCamera {
  constructor(cam) {
    this.cam = cam; this.yaw = Math.PI; this.pitch = 0.12; this.dist = 7; this.fov = 70;
    this.forward = new THREE.Vector3(); this.flatForward = new THREE.Vector3(); this.right = new THREE.Vector3();
    this.target = new THREE.Vector3(); this.inited = false; this.computeAxes();
  }
  get yawFacing() { return this.yaw; }
  computeAxes() {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.flatForward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }
  update(dt, inp, hero, city) {
    this.yaw -= inp.lookX; this.pitch = THREE.MathUtils.clamp(this.pitch + inp.lookY, -1.25, 1.35);
    this.computeAxes();
    const sp = hero.speed, scale = hero.def.height / 1.83;
    const tgt = hero.pos.clone(); tgt.y += 1.7 * scale;
    if (!this.inited) { this.target.copy(tgt); this.inited = true; }
    // follow tightly (no lag at 300+ m/s) but smooth small jitter
    this.target.lerp(tgt, 1 - Math.exp(-dt * 25)); this.target.addScaledVector(tgt.clone().sub(this.target), 0.5);
    const wantDist = (5.5 * scale + Math.min(10, sp * 0.045)) * (hero.charge ? 1 - hero.charge * 0.2 : 1);
    this.dist += (wantDist - this.dist) * Math.min(1, dt * 3);
    const wantFov = 68 + Math.min(32, sp * 0.13);
    this.fov += (wantFov - this.fov) * Math.min(1, dt * 3);
    this.cam.fov = this.fov; this.cam.updateProjectionMatrix();
    const shoulder = this.right.clone().multiplyScalar(-0.6 * scale);
    // pull camera in if a building is in the way
    let d = this.dist; const p = new THREE.Vector3();
    for (let i = 1; i <= 10; i++) { const t = this.dist * i / 10; p.copy(this.target).addScaledVector(this.forward, -t).add(shoulder);
      if (city.heightAt(p.x, p.z, 0.5) > p.y - 0.5) { d = Math.max(1.2, t - this.dist / 10); break; } }
    p.copy(this.target).addScaledVector(this.forward, -d).add(shoulder);
    p.y = Math.max(p.y, 0.6);
    this.cam.position.copy(p); this.cam.lookAt(p.clone().add(this.forward));
  }
}
