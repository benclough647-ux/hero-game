import * as THREE from 'three';
import { Input } from './input.js';
import { City } from './city.js';
import { Hero } from './heroes.js';
import { Effects } from './effects.js';
import { ThirdPersonCamera } from './camera.js';
import { HUD } from './hud.js';

const VIEW = 1500;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const skyCol = new THREE.Color(0x9cc8ec); scene.background = skyCol; scene.fog = new THREE.Fog(0xb4d2ea, 250, VIEW);
// sky dome gradient
{ const g = new THREE.SphereGeometry(4000, 24, 12); const c = []; const p = g.attributes.position;
  const top = new THREE.Color(0x3d7cc9), hor = new THREE.Color(0xc8def0);
  for (let i = 0; i < p.count; i++) { const t = Math.max(0, p.getY(i) / 4000); const col = hor.clone().lerp(top, Math.pow(t, 0.6)); c.push(col.r, col.g, col.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(sky); scene.userData.sky = sky;
  const sun = new THREE.Mesh(new THREE.SphereGeometry(80, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff4d0, fog: false })); sun.position.set(1500, 1800, -2500); sky.add(sun); }
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x4a4438, 1.1));
const dl = new THREE.DirectionalLight(0xfff0d8, 1.6); dl.position.set(0.5, 1, -0.7); scene.add(dl);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 5000);
const city = new City(scene);
const fx = new Effects(scene);
const heroes = [new Hero('tiger', scene, fx), new Hero('centurion', scene, fx)];
let idx = 0; heroes[1].setVisible(false);
const spawn = new THREE.Vector3(-BLOCKOFF(), 0, -BLOCKOFF()); function BLOCKOFF() { return 311; }
heroes[0].pos.copy(spawn);
const input = new Input(renderer.domElement), cam = new ThirdPersonCamera(camera), hud = new HUD();
// blob shadow
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

const start = document.getElementById('start'); let started = false;
const begin = () => { started = true; start.style.display = 'none'; };
start.addEventListener('click', () => { begin(); renderer.domElement.requestPointerLock?.(); });
renderer.domElement.addEventListener('click', () => { if (started && !document.pointerLockElement) renderer.domElement.requestPointerLock?.(); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

function switchHero() {
  const a = heroes[idx], b = heroes[idx ^ 1];
  b.pos.copy(a.pos); b.vel.copy(a.vel); b.yaw = a.yaw; b.state = a.state === 'fly' ? 'fly' : a.state; b.charge = 0; b.flyBlend = a.flyBlend;
  a.setVisible(false); b.setVisible(true); idx ^= 1; if (a.glow) a.glow.intensity = 0;
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const inp = input.update(dt);
  if (!started) { if (inp.anyPressed) begin(); else { renderer.render(scene, camera); cam.update(dt, { lookX: dt * 0.1, lookY: 0 }, heroes[idx], city); return; } }
  if (inp.switchPressed) switchHero();
  const h = heroes[idx];
  h.update(dt, inp, cam, city);
  cam.update(dt, inp, h, city);
  fx.update(dt);
  const fh = city.heightAt(h.pos.x, h.pos.z);
  shadow.position.set(h.pos.x, fh + 0.08, h.pos.z); const hgt = h.pos.y - fh; shadow.material.opacity = 0.35 * Math.max(0, 1 - hgt / 40); shadow.scale.setScalar(h.def.height / 1.83 * (1 + hgt * 0.01));
  scene.userData.sky.position.copy(camera.position);
  city.update(camera.position, VIEW);
  hud.update(h, inp.hasPad);
  renderer.render(scene, camera);
}
frame();
window.__game = { heroes, city, cam, get active() { return heroes[idx]; }, switchHero, input, renderer };
