import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Input } from './input.js';
import { City, BLOCK, HALF, WATER_Y } from './city.js';
import { World } from './world.js';
import { Traffic } from './traffic.js';
import { Hero, preloadHeroModels } from './heroes.js';
import { unlockAudio } from './audio.js';
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlockAudio, { passive: true });
import { Effects } from './effects.js';
import { ThirdPersonCamera } from './camera.js';
import { HUD } from './hud.js';
import { QualityManager } from './quality.js';
import { Combat } from './combat.js';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: /shot/.test(location.search) });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.75;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.25, 9000);
const world = new World(scene, renderer);
const city = new City(scene);
world.reflectionHide = [...city.detail.map(c => c.group), ...city.treeChunks.map(c => c.group), ...city.propMeshes];
const traffic = new Traffic(scene);
const fx = new Effects(scene);
// the player's two heroes (Y swaps; the one you're not using is off-stage) + the two computer-controlled villains
const heroes = [new Hero('tiger', scene, fx), new Hero('centurion', scene, fx)];
const villains = [new Hero('villainA', scene, fx), new Hero('villainB', scene, fx)];
const everyone = [...heroes, ...villains];
Hero.viewer = camera; // used for the rigged models' LOD switch
fx.viewer = camera; fx.destruction.cityRef = city; // sonic-boom vapour cone fades when the camera is inside it
let idx = 0; for (const h of everyone) h.setVisible(false);
heroes[0].pos.set(-HALF + 20 * BLOCK + 9, 0, -HALF + 22 * BLOCK + 9); heroes[1].pos.copy(heroes[0].pos);
villains[0].pos.set(-HALF + 20 * BLOCK + 9 + 40, 0, -HALF + 22 * BLOCK + 9 - 8); villains[0].yaw = -Math.PI / 2;
villains[1].pos.set(-HALF + 20 * BLOCK + 9 + 40, 0, -HALF + 22 * BLOCK + 9 + 8); villains[1].yaw = -Math.PI / 2;
for (const v of villains) v.isPlayer = false;
const input = new Input(renderer.domElement), cam = new ThirdPersonCamera(camera), hud = new HUD();
const combat = new Combat(scene, fx, city, cam, hud);
Hero.onCrash = (p, a) => combat.shakeNear(p, a);
combat.enemies = villains; combat.player = heroes[idx]; for (const v of villains) combat.brainOf(v); // one AI brain each (A leads first)
const NOINP = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, boost: 0, descend: 0 };

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
  usePost = q.post; view = q.view; world.setQuality(q); city.detailDist = q.detail ?? 600;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { if (rt.samples !== q.msaa) { rt.samples = q.msaa; rt.dispose(); } }
  city.treeMesh.castShadow = q.shadow >= 2048; traffic.body.castShadow = q.shadow >= 1024;
  scene.fog.density = 0.00042 * 1700 / q.view;
  for (const h of everyone) h.setQuality?.(q);
  fx.destruction.setQuality(q);
  if (quality) resize();
});
resize(); addEventListener('resize', resize);

const start = document.getElementById('start'); let started = false, assetsReady = false;
const loadStatus = document.getElementById('loadStatus');
const loadBar = document.getElementById('loadBar')?.firstElementChild;
const startHint = document.getElementById('startHint');
function setLoad(p, msg) {
  if (loadBar) loadBar.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
  if (msg && loadStatus) loadStatus.textContent = msg;
}
const begin = () => { if (!assetsReady || started) return; started = true; start.style.display = 'none'; };
start.addEventListener('click', () => { begin(); if (started) renderer.domElement.requestPointerLock?.(); });
renderer.domElement.addEventListener('click', () => { if (started && !document.pointerLockElement) renderer.domElement.requestPointerLock?.(); });

function markReady(usedFallback) {
  assetsReady = true;
  setLoad(1, usedFallback ? 'Ready (using backup models)' : 'Ready');
  if (startHint) startHint.style.display = 'block';
  if (loadStatus) loadStatus.style.opacity = '0.7';
  heroes[idx].setVisible(true); for (const v of villains) v.setVisible(true);
}

preloadHeroModels((p, url) => {
  const name = typeof url === 'string' ? url.split('/').pop() : '';
  const pretty = name && name.includes('_meshopt') ? `Loading ${name}` : 'Loading heroes…';
  setLoad(p, pretty);
}).then(models => {
  let fallback = false;
  for (const h of everyone) {
    const levels = models?.[h.key];
    if (levels && h.adoptModels(levels)) h.setQuality(quality.preset);
    else { fallback = true; console.warn('Using primitive fallback for', h.key); }
  }
  markReady(fallback);
}).catch(err => {
  console.warn('Hero model preload failed, using primitives', err);
  markReady(true);
});

// Y swaps heroes: you become the other hero in the same spot (same state / health); the villains stay the enemies
function switchHero() {
  const a = heroes[idx], b = heroes[idx ^ 1];
  if (a.grabbing) combat.releaseGrab(a); if (a.legGrabbing) combat.releaseLeg(a);
  for (const h of [a, b]) { h.action = null; h.endSuper(); h.endSprint(); h.landT = 0; h.flip = null; }
  b.pos.copy(a.pos); b.vel.copy(a.vel); b.yaw = a.yaw; b.state = a.state; b.charge = 0; b.flyBlend = a.flyBlend; b.hp = a.hp; b.ko = a.ko; b.koT = a.koT;
  b.ragdoll = a.ragdoll; if (!b.ragdoll) b.rig.body.rotation.set(0, 0, 0);
  a.ragdoll = null; a.rig.body.rotation.set(0, 0, 0); a.silence?.(); a.setVisible(false); b.setVisible(true);
  idx ^= 1; b.isPlayer = true; a.isPlayer = true;
  hud.say(`You: ${heroes[idx].def.name}`);
}
const lockPt = new THREE.Vector3();
const free = h => !h.ragdoll && !h.grabbedBy && !h.slammedBy && !h.legGrabbedBy;
function combatFrame(dt, inp) {
  const P = heroes[idx];
  if (free(P)) P.update(dt, P.ko ? NOINP : inp, cam, city);
  for (const v of villains) { const ai = v.parked ? NOINP : combat.aiInput(dt, v, P); if (free(v)) v.update(dt, ai, v.aiCam, city); }
  const live = villains.some(v => v.parked) ? villains.filter(v => !v.parked) : villains; // tests can park villain B out of the fight
  combat.update(dt, P, live, P.ko ? null : inp, cam.forward);
  combat.updateLock(dt, P, live, inp);
  const L = combat.lockTarget(); cam.lockTarget = L ? combat.chest(L, lockPt) : null;
  for (const h of [P, ...villains]) if (!free(h)) h.animate(dt, 0);
  for (const v of villains) if (v.legGrabbing) combat.attachLeg(v); // leg grab: ankle pinned to the palm after both poses are evaluated
  // KO -> respawn (villains come back at full 700 HP a short way off)
  if (P.ko && (P.koT += dt) > 3.2) { combat.reset(P, P.pos.clone().setY(city.heightAt(P.pos.x, P.pos.z))); hud.say('Back on your feet'); }
  for (const v of villains) if (v.ko && (v.koT += dt) > 4) combat.respawnNear(v, P);
  hud.bars(P, villains, combat.inCombat(P, villains), dt, combat.lockTarget());
  hud.grab(combat.grabState(P, villains), input.state.hasPad, P.def.style === 'fire');
  const G = villains.find(v => v.grabbing === P || v.legGrabbing === P);
  hud.counter(!!G && combat.canCounter(P), G || villains[0], camera, dt); // Y prompt over the grabber's head, only while they hold you (choke or leg grab: 1.5 s)
}
const clock = new THREE.Clock();
let paused = false;
function render() { if (usePost) composer.render(); else renderer.render(scene, camera); }
function frame() {
  requestAnimationFrame(frame);
  if (paused) return;
  const raw = clock.getDelta(), dt = Math.min(raw, 1 / 20);
  const inp = input.update(dt);
  if (inp.anyPressed || inp.superPressed) unlockAudio(); // controller presses (may not count as a gesture everywhere)
  if (inp.hudPressed) hud.toggle();
  if (inp.qualityPressed) hud.say('Graphics: ' + quality.cycle());
  const h = heroes[idx];
  if (!started) { if (assetsReady && inp.anyPressed) begin(); cam.update(dt, { lookX: dt * 0.1, lookY: 0 }, h, city); h.animate(dt, 0); for (const v of villains) v.animate(dt, 0); }
  else {
    if (inp.switchPressed && !heroes[idx].grabbedBy && !heroes[idx].legGrabbedBy && heroes[idx].action?.type !== 'counter') switchHero(); // Y while grabbed = counter instead
    combatFrame(dt, inp); cam.update(dt, inp, heroes[idx], city);
  }
  step(dt, raw);
}
function step(dt, raw, noRender) {
  const h = heroes[idx]; Hero.audioHero = h; // only the hero you control plays its looping flight sounds
  if (city.isWater(h.pos.x, h.pos.z)) fx.waterSpray(h.pos, h.vel, h.pos.y - WATER_Y, WATER_Y, dt);
  fx.speedLines(dt, h.pos, h.vel, (h.superSpeed && h.state === 'fly') || !!h.action?.dash || (h.action?.type === 'tackle' && h.speed > 120) || (h.superSprint && h.state === 'ground' && Math.hypot(h.vel.x, h.vel.z) > 30), h.def.style === 'fire');
  fx.update(dt); traffic.update(dt);
  world.update(dt, camera, h.pos);
  city.update(camera.position, view);
  const msg = quality.sample(raw); if (msg) hud.say(msg);
  hud.update(h, input.state.hasPad, dt, ` · ${quality.preset.name}`);
  if (!noRender) render();
}
frame();
// debug/screenshot hook
window.__game = { heroes, villains, everyone, city, cam, combat, combatFrame, get enemy() { return villains[0]; }, get focus() { return combat.focus(heroes[idx], cam.forward); },
  solo(on = true) { const B = villains[1]; if (on) { combat.reset(B, heroes[idx].pos.clone().add(new THREE.Vector3(2500, 0, 2500)).setY(0)); B.parked = true; } else { B.parked = false; combat.respawnNear(B, heroes[idx]); } }, // tests: park villain B far away
  get other() { return heroes[idx ^ 1]; }, hud, camera, get active() { return heroes[idx]; }, switchHero, input, renderer, quality, begin, step, render,
  setPaused(v) { paused = v; }, scene, THREE, get ready() { return assetsReady; }, markReady };
