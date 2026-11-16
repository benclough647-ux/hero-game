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
const heroes = [new Hero('tiger', scene, fx), new Hero('centurion', scene, fx)];
Hero.viewer = camera; // used for the rigged models' LOD switch
fx.viewer = camera; fx.destruction.cityRef = city; // sonic-boom vapour cone fades when the camera is inside it
let idx = 0; heroes[0].setVisible(false); heroes[1].setVisible(false);
heroes[0].pos.set(-HALF + 20 * BLOCK + 9, 0, -HALF + 22 * BLOCK + 9);
heroes[1].pos.set(-HALF + 20 * BLOCK + 9 + 40, 0, -HALF + 22 * BLOCK + 9); heroes[1].yaw = -Math.PI / 2;
const input = new Input(renderer.domElement), cam = new ThirdPersonCamera(camera), hud = new HUD();
const combat = new Combat(scene, fx, city, cam, hud);
Hero.onCrash = (p, a) => combat.shakeNear(p, a);
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
  for (const h of heroes) h.setQuality?.(q);
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
  heroes[0].setVisible(true); heroes[1].setVisible(true);
}

preloadHeroModels((p, url) => {
  const name = typeof url === 'string' ? url.split('/').pop() : '';
  const pretty = name && name.includes('_meshopt') ? `Loading ${name}` : 'Loading heroes…';
  setLoad(p, pretty);
}).then(models => {
  let fallback = false;
  for (const h of heroes) {
    const levels = models?.[h.key];
    if (levels && h.adoptModels(levels)) h.setQuality(quality.preset);
    else { fallback = true; console.warn('Using primitive fallback for', h.key); }
  }
  markReady(fallback);
}).catch(err => {
  console.warn('Hero model preload failed, using primitives', err);
  markReady(true);
});

// Y swaps heroes: you take over the other character, and your old hero becomes the computer-controlled rival
function switchHero() {
  const a = heroes[idx], b = heroes[idx ^ 1];
  const save = { pos: b.pos.clone(), vel: b.vel.clone(), yaw: b.yaw, state: b.state, hp: b.hp, ko: b.ko, rag: b.ragdoll, koT: b.koT };
  for (const h of [a, b]) { if (h.grabbing) combat.releaseGrab(h); h.action = null; h.endSuper(); h.flip = null; }
  b.pos.copy(a.pos); b.vel.copy(a.vel); b.yaw = a.yaw; b.state = a.state; b.charge = 0; b.flyBlend = a.flyBlend; b.hp = a.hp; b.ko = a.ko; b.koT = a.koT;
  b.ragdoll = a.ragdoll; if (!b.ragdoll) b.rig.body.rotation.set(0, 0, 0);
  a.pos.copy(save.pos); a.vel.copy(save.vel); a.yaw = save.yaw; a.state = save.state; a.charge = 0; a.hp = save.hp; a.ko = save.ko; a.koT = save.koT;
  a.ragdoll = save.rag; if (!a.ragdoll) a.rig.body.rotation.set(0, 0, 0);
  idx ^= 1;
  hud.say(`You: ${heroes[idx].def.name}  ·  Rival: ${heroes[idx ^ 1].def.name}`);
}
const lockPt = new THREE.Vector3();
function combatFrame(dt, inp) {
  const P = heroes[idx], E = heroes[idx ^ 1];
  const pFree = !P.ragdoll && !P.grabbedBy, eFree = !E.ragdoll && !E.grabbedBy;
  if (pFree) P.update(dt, P.ko ? NOINP : inp, cam, city);
  const aiInp = combat.aiInput(dt, E, P);
  if (eFree) E.update(dt, aiInp, combat.aiCam, city);
  combat.update(dt, P, E, P.ko ? null : inp, cam.forward);
  combat.updateLock(dt, P, E, inp);
  cam.lockTarget = combat.lockOn && !E.ko ? combat.chest(E, lockPt) : null;
  if (P.ragdoll || P.grabbedBy) P.animate(dt, 0);
  if (E.ragdoll || E.grabbedBy) E.animate(dt, 0);
  // KO -> respawn
  if (P.ko && (P.koT += dt) > 3.2) { combat.reset(P, P.pos.clone().setY(city.heightAt(P.pos.x, P.pos.z))); hud.say('Back on your feet'); }
  if (E.ko && (E.koT += dt) > 4) combat.respawnNear(E, P);
  hud.bars(P, E, combat.inCombat(P, E), dt);
  hud.grab(combat.grabState(P, E), input.state.hasPad, P.def.style === 'fire');
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
  if (!started) { if (assetsReady && inp.anyPressed) begin(); cam.update(dt, { lookX: dt * 0.1, lookY: 0 }, h, city); h.animate(dt, 0); heroes[idx ^ 1].animate(dt, 0); }
  else {
    if (inp.switchPressed) switchHero();
    combatFrame(dt, inp); cam.update(dt, inp, heroes[idx], city);
  }
  step(dt, raw);
}
function step(dt, raw, noRender) {
  const h = heroes[idx]; Hero.audioHero = h; // only the hero you control plays its looping flight sounds
  if (city.isWater(h.pos.x, h.pos.z)) fx.waterSpray(h.pos, h.vel, h.pos.y - WATER_Y, WATER_Y, dt);
  fx.speedLines(dt, h.pos, h.vel, (h.superSpeed && h.state === 'fly') || !!h.action?.dash || (h.action?.type === 'tackle' && h.speed > 120), h.def.style === 'fire');
  fx.update(dt); traffic.update(dt);
  world.update(dt, camera, h.pos);
  city.update(camera.position, view);
  const msg = quality.sample(raw); if (msg) hud.say(msg);
  hud.update(h, input.state.hasPad, dt, ` · ${quality.preset.name}`);
  if (!noRender) render();
}
frame();
// debug/screenshot hook
window.__game = { heroes, city, cam, combat, combatFrame, get enemy() { return heroes[idx ^ 1]; }, hud, camera, get active() { return heroes[idx]; }, switchHero, input, renderer, quality, begin, step, render,
  setPaused(v) { paused = v; }, scene, THREE, get ready() { return assetsReady; }, markReady };
