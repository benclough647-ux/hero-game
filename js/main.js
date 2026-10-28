import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Input } from './input.js';
import { City, BLOCK, HALF, WATER_Y } from './city.js';
import { World } from './world.js';
import { Traffic } from './traffic.js';
import { Hero } from './heroes.js';
import { Effects } from './effects.js';
import { ThirdPersonCamera } from './camera.js';
import { HUD } from './hud.js';
import { QualityManager } from './quality.js';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: /shot/.test(location.search) });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.75;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.25, 9000);
const world = new World(scene, renderer);
const city = new City(scene);
const traffic = new Traffic(scene);
const fx = new Effects(scene);
const heroes = [new Hero('tiger', scene, fx), new Hero('centurion', scene, fx)];
let idx = 0; heroes[1].setVisible(false);
heroes[0].pos.set(-HALF + 20 * BLOCK + 9, 0, -HALF + 22 * BLOCK + 9);
const input = new Input(renderer.domElement), cam = new ThirdPersonCamera(camera), hud = new HUD();

// post-processing: HDR render -> subtle bloom -> ACES tone map + sRGB
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.22, 0.5, 1.0); composer.addPass(bloom);
composer.addPass(new OutputPass());
let usePost = true, view = 1700;
function resize() {
  const p = quality ? quality.preset.pixel : 1, pr = Math.min(devicePixelRatio, 1.25) * p;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth * pr / 2, innerHeight * pr / 2);
}
let quality = null;
quality = new QualityManager(q => {
  usePost = q.post; view = q.view; world.setQuality(q);
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { if (rt.samples !== q.msaa) { rt.samples = q.msaa; rt.dispose(); } }
  city.treeMesh.castShadow = q.shadow >= 2048; traffic.body.castShadow = q.shadow >= 1024;
  scene.fog.density = 0.00042 * 1700 / q.view;
  if (quality) resize();
});
resize(); addEventListener('resize', resize);

const start = document.getElementById('start'); let started = false;
const begin = () => { started = true; start.style.display = 'none'; };
start.addEventListener('click', () => { begin(); renderer.domElement.requestPointerLock?.(); });
renderer.domElement.addEventListener('click', () => { if (started && !document.pointerLockElement) renderer.domElement.requestPointerLock?.(); });

function switchHero() {
  const a = heroes[idx], b = heroes[idx ^ 1];
  b.pos.copy(a.pos); b.vel.copy(a.vel); b.yaw = a.yaw; b.state = a.state === 'fly' ? 'fly' : a.state; b.charge = 0; b.flyBlend = a.flyBlend;
  a.setVisible(false); b.setVisible(true); idx ^= 1; if (a.glow) a.glow.intensity = 0;
}

const clock = new THREE.Clock();
let paused = false;
function render() { if (usePost) composer.render(); else renderer.render(scene, camera); }
function frame() {
  requestAnimationFrame(frame);
  if (paused) return;
  const raw = clock.getDelta(), dt = Math.min(raw, 1 / 20);
  const inp = input.update(dt);
  if (inp.hudPressed) hud.toggle();
  if (inp.qualityPressed) hud.say('Graphics: ' + quality.cycle());
  const h = heroes[idx];
  if (!started) { if (inp.anyPressed) begin(); else { cam.update(dt, { lookX: dt * 0.1, lookY: 0 }, h, city); h.animate(dt, 0); } }
  else {
    if (inp.switchPressed) switchHero();
    heroes[idx].update(dt, inp, cam, city); cam.update(dt, inp, heroes[idx], city);
  }
  step(dt, raw);
}
function step(dt, raw, noRender) {
  const h = heroes[idx];
  if (city.isWater(h.pos.x, h.pos.z)) fx.waterSpray(h.pos, h.vel, h.pos.y - WATER_Y, WATER_Y, dt);
  fx.update(dt); traffic.update(dt);
  world.update(dt, camera, h.pos);
  city.update(camera.position, view);
  const msg = quality.sample(raw); if (msg) hud.say(msg);
  hud.update(h, input.state.hasPad, dt, ` · ${quality.preset.name}`);
  if (!noRender) render();
}
frame();
// debug/screenshot hook
window.__game = { heroes, city, cam, camera, get active() { return heroes[idx]; }, switchHero, input, renderer, quality, begin, step, render,
  setPaused(v) { paused = v; }, scene, THREE };
