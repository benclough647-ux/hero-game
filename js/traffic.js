import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BLOCK, ROAD, GRID, HALF } from './city.js';
// Instanced animated traffic: bevelled car bodies, tinted glass cabins, HDR head/tail lights (feed the bloom).
const COLORS = [0xf2f2ee, 0x101114, 0x9da3a8, 0xe8b818, 0xe8b818, 0xe8b818, 0x7a1414, 0x1e3a6a, 0x3a3d40, 0x5d6a58];
export class Traffic {
  constructor(scene, count = 520) {
    this.n = count; this.cars = [];
    const body = new RoundedBoxGeometry(4.5, 1.0, 1.95, 2, 0.32); body.translate(0, 0.75, 0);
    const cab = new RoundedBoxGeometry(2.5, 0.75, 1.75, 2, 0.3); cab.translate(-0.25, 1.55, 0);
    const lamp = new THREE.BoxGeometry(0.1, 0.18, 0.4);
    this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.28 }), count);
    this.cab = new THREE.InstancedMesh(cab, new THREE.MeshStandardMaterial({ color: 0x0c0f12, metalness: 0.9, roughness: 0.08 }), count);
    this.head = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.6, 3.8) }), count * 2);
    this.tail = new THREE.InstancedMesh(lamp, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 0.15, 0.1) }), count * 2);
    this.body.castShadow = true; this.body.receiveShadow = true;
    for (const m of [this.body, this.cab, this.head, this.tail]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
    let seed = 99; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const alongX = r() < 0.5, line = Math.floor(r() * GRID), dir = r() < 0.5 ? 1 : -1, lane = (r() < 0.5 ? 2.3 : 5.6) * dir;
      const fixed = -HALF + line * BLOCK + ROAD / 2 + lane;
      this.cars.push({ alongX, fixed, dir, s: -HALF + r() * GRID * BLOCK, v: 11 + r() * 8 });
      this.body.setColorAt(k, c.set(COLORS[Math.floor(r() * COLORS.length)]));
    }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1); this.up = new THREE.Vector3(0, 1, 0);
    this.update(0);
  }
  update(dt) {
    const { m, q, p, one } = this; const L = GRID * BLOCK, off = new THREE.Vector3();
    this.cars.forEach((car, k) => {
      car.s += car.v * car.dir * dt; if (car.s > HALF) car.s -= L; if (car.s < -HALF) car.s += L;
      // slow near intersections a little for a more natural flow
      const local = ((car.s + HALF) % BLOCK + BLOCK) % BLOCK; const slow = local < ROAD + 4 ? 0.75 : 1;
      car.s += car.v * car.dir * dt * (slow - 1);
      const x = car.alongX ? car.s : car.fixed, z = car.alongX ? car.fixed : car.s;
      const yaw = car.alongX ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      q.setFromAxisAngle(this.up, yaw); m.compose(p.set(x, 0.05, z), q, one); this.body.setMatrixAt(k, m); this.cab.setMatrixAt(k, m);
      for (const side of [0, 1]) {
        off.set(2.26, 0.85, side ? 0.65 : -0.65).applyQuaternion(q); m.compose(p.set(x + off.x, off.y, z + off.z), q, one); this.head.setMatrixAt(k * 2 + side, m);
        off.set(-2.26, 0.9, side ? 0.7 : -0.7).applyQuaternion(q); m.compose(p.set(x + off.x, off.y, z + off.z), q, one); this.tail.setMatrixAt(k * 2 + side, m);
      }
    });
    for (const x of [this.body, this.cab, this.head, this.tail]) x.instanceMatrix.needsUpdate = true;
  }
}
