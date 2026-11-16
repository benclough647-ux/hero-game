import * as THREE from 'three';
// Smooth third-person orbit camera with speed-based FOV/distance and building avoidance.
export class ThirdPersonCamera {
  constructor(cam) {
    this.cam = cam; this.yaw = Math.PI; this.pitch = 0.06; this.dist = 5; this.fov = 62; this.t = 0;
    this.forward = new THREE.Vector3(); this.flatForward = new THREE.Vector3(); this.right = new THREE.Vector3();
    this.target = new THREE.Vector3(); this.inited = false; this.shakeAmt = 0; this.kick = 0; this.computeAxes();
  }
  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }
  get yawFacing() { return this.yaw; }
  computeAxes() {
    const cp = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.flatForward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }
  update(dt, inp, hero, city) {
    const lt = this.lockTarget; // world point to keep framed (lock-on), or null
    if (lt) {
      // right stick still nudges the view; the nudge eases back so the enemy stays framed
      const ease = Math.exp(-dt * 1.6);
      this.lockYaw = THREE.MathUtils.clamp((this.lockYaw || 0) - inp.lookX, -0.6, 0.6) * ease;
      this.lockPitch = THREE.MathUtils.clamp((this.lockPitch || 0) + inp.lookY, -0.4, 0.4) * ease;
      const sc = hero.def.height / 1.83, dx = lt.x - hero.pos.x, dy = lt.y - (hero.pos.y + 1.2 * sc), dz = lt.z - hero.pos.z, hd = Math.hypot(dx, dz);
      const wantYaw = Math.atan2(dx, dz) + this.lockYaw;
      const wantPitch = THREE.MathUtils.clamp(-Math.atan2(dy, Math.max(hd, 0.5)) + 0.12 + this.lockPitch, -1.1, 1.2);
      const close = THREE.MathUtils.clamp((hd - 1.5) / 6, 0.15, 1); // don't whip around when right on top of them
      const k = 1 - Math.exp(-dt * 6 * close);
      let dyaw = (wantYaw - this.yaw) % (Math.PI * 2); if (dyaw > Math.PI) dyaw -= Math.PI * 2; if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this.yaw += dyaw * k; this.pitch += (wantPitch - this.pitch) * k;
    } else {
      this.lockYaw = this.lockPitch = 0;
      this.yaw -= inp.lookX; this.pitch = THREE.MathUtils.clamp(this.pitch + inp.lookY, -1.25, 1.35);
    }
    this.computeAxes();
    const sp = hero.speed, scale = hero.def.height / 1.83;
    const tgt = hero.pos.clone(); tgt.y += (hero.state === 'fly' ? 0.75 : 1.45) * scale; this.t += dt;
    if (!this.inited) { this.target.copy(tgt); this.inited = true; }
    // follow tightly (no lag at 300+ m/s) but smooth small jitter
    this.target.lerp(tgt, 1 - Math.exp(-dt * 40)); this.target.addScaledVector(tgt.clone().sub(this.target), 0.85);
    const wantDist = (2.7 * scale + Math.min(1.4, sp * 0.005)) * (hero.charge ? 1 - hero.charge * 0.2 : 1);
    this.dist += (wantDist - this.dist) * Math.min(1, dt * 3);
    if (hero.boomKick) { this.kick += 24 * hero.boomKick; this.shake(1.0); hero.boomKick = 0; } // sonic boom punch
    if (hero.fovKick) { this.kick += hero.fovKick; this.shake(0.15); hero.fovKick = 0; } // punch dash
    this.kick *= Math.exp(-dt * 2.2);
    const wantFov = 60 + Math.min(14, Math.pow(sp, 0.8) * 0.16) + (hero.superSpeed ? 8 : 0); // speed-based FOV
    this.fov += (wantFov - this.fov) * Math.min(1, dt * 3);
    this.cam.fov = Math.min(110, this.fov + this.kick); this.cam.updateProjectionMatrix();
    const shoulder = this.right.clone().multiplyScalar(-0.35 * scale);
    // pull camera in if a building is in the way
    let d = this.dist; const p = new THREE.Vector3();
    for (let i = 1; i <= 10; i++) { const t = this.dist * i / 10; p.copy(this.target).addScaledVector(this.forward, -t).add(shoulder);
      if (city.heightAt(p.x, p.z, 0.5) > p.y - 0.5) { d = Math.max(1.2, t - this.dist / 10); break; } }
    p.copy(this.target).addScaledVector(this.forward, -d).add(shoulder);
    p.y = Math.max(p.y, 0.6);
    this.cam.position.copy(p); this.cam.lookAt(p.clone().add(this.forward));
    // subtle speed shake (layered sines, no randomness so it stays smooth)
    const sh = Math.min(1, Math.max(0, (sp - 40) / 260)) * 0.006, t = this.t;
    this.cam.rotation.x += (Math.sin(t * 31) + Math.sin(t * 17.3) * 0.6) * sh; this.cam.rotation.y += (Math.sin(t * 27.1) + Math.sin(t * 13.7) * 0.5) * sh;
    if (this.shakeAmt > 0.001) { const k = this.shakeAmt * 0.035; this.cam.rotation.x += (Math.random() - 0.5) * k; this.cam.rotation.y += (Math.random() - 0.5) * k; this.cam.position.y += (Math.random() - 0.5) * k * 4; this.shakeAmt *= Math.exp(-dt * 6); }
  }
}
