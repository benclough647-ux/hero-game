import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Input } from './input.js';
import { City, BLOCK, HALF } from './city.js';
import { World } from './world.js';
import { Traffic } from './traffic.js';
import { Hero, preloadHeroModels } from './heroes.js';
import { unlockAudio, setWorldRate, setWorldSfx, slowmoSound } from './audio.js';
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, unlockAudio, { passive: true });
import { Effects } from './effects.js';
import { ThirdPersonCamera } from './camera.js';
import { HUD } from './hud.js';
import { QualityManager } from './quality.js';
import { Combat, DODGE } from './combat.js';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: /shot/.test(location.search) });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.75;
renderer.shadowMap.enabled = false; // no shadow maps at all (Xbox performance); lighting is sun + hemisphere + sky IBL
document.body.prepend(renderer.domElement);

// GPU profile. Xbox Edge (and weak-GPU Edge) runs out of GPU memory with the full hero texture set + HDR targets: the WebGL
// context is lost (white / blank screen, typically on a hero swap when the other hero's 2048 maps upload) and comes back
// with no IBL (everything dark). Safe profile: textures capped at 1024, pixel ratio <= 1, lighter targets, same tone mapping.
const gpuProfile = (() => {
  const gl = renderer.getContext(), ua = navigator.userAgent, qs = new URLSearchParams(location.search);
  const dbg = gl.getExtension('WEBGL_debug_renderer_info'), gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  const halfFloatRT = renderer.capabilities.isWebGL2 ? !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) : !!gl.getExtension('EXT_color_buffer_half_float');
  const xbox = /Xbox/i.test(ua), edge = /\bEdg(e|A|iOS)?\//.test(ua);
  const weak = maxTex < 8192 || !halfFloatRT || /llvmpipe|Basic Render/i.test(gpu);
  const safe = qs.has('nosafe') ? false : qs.has('safe') || xbox || (edge && weak);
  return { safe, xbox, edge, gpu, maxTex, halfFloatRT, texCap: safe ? 1024 : Math.min(4096, maxTex) };
})();
const _capped = new WeakMap(); // texture -> cap it was last checked against
function capTexture(t, cap) { // downscale an image texture to <= cap px (keeps aspect); safe before or after upload
  if (!t || _capped.get(t) <= cap || t.isRenderTargetTexture || t.isDataTexture || t.isCompressedTexture || t.isCubeTexture) return;
  const im = t.image, w = im?.width, h = im?.height; _capped.set(t, cap);
  if (!w || !h || (w <= cap && h <= cap)) return;
  try {
    const s = cap / Math.max(w, h), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d', { willReadFrequently: true }).drawImage(im, 0, 0, c.width, c.height); t.dispose(); t.image = c; t.needsUpdate = true; im.close?.();
  } catch (e) { console.warn('texture cap failed', e); }
}
const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap'];
function eachTexture(root, fn) { root.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) { for (const k of TEX_KEYS) if (m[k]) fn(m[k], m); if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u?.value?.isTexture) fn(u.value, m); } }); }

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.25, 9000);
const world = new World(scene, renderer);
const city = new City(scene);
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
// a single NaN / Inf pixel (some GPUs: degenerate normal-map tangent frames, huge emissive in half float) is blurred by bloom
// over the whole screen -> white-out. Drop non-finite texels and clamp HDR before the bloom chain.
if (renderer.capabilities.isWebGL2) bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );',
  'vec4 texel = texture2D( tDiffuse, vUv ); if ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 ); texel = clamp( texel, 0.0, 64.0 );');
composer.addPass(new OutputPass());
let usePost = true, view = 1700;
function resize() {
  const p = quality ? quality.preset.pixel : 1; let pr = Math.min(devicePixelRatio, gpuProfile.safe ? 1 : 1.25) * p;
  if (gpuProfile.safe) pr = Math.min(pr, 1920 / innerWidth, 1080 / innerHeight); // safe profile: internal resolution <= 1920x1080
  // the same colour pipeline on every device (post on or off): ACES tone mapping, fixed exposure, sRGB output
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.75;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth * pr / 2, innerHeight * pr / 2);
}
let quality = null;
quality = new QualityManager(q => {
  usePost = q.post; view = q.view; world.setQuality(q); city.detailDist = q.detail ?? 600;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { if (rt.samples !== q.msaa) { rt.samples = q.msaa; rt.dispose(); } }
  scene.fog.density = 0.00042 * 1700 / q.view;
  for (const h of everyone) h.setQuality?.(q);
  fx.destruction.setQuality(q);
  if (quality) resize();
}, { safe: gpuProfile.safe, postOk: gpuProfile.halfFloatRT });
if (gpuProfile.safe) console.info('Graphics: safe GPU profile', JSON.stringify({ xbox: gpuProfile.xbox, edge: gpuProfile.edge, gpu: gpuProfile.gpu, maxTex: gpuProfile.maxTex, halfFloatRT: gpuProfile.halfFloatRT }));
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
  noShadows(scene); prewarm();
}
function noShadows(root) { root.traverse(o => { if (o.castShadow || o.receiveShadow) o.castShadow = o.receiveShadow = false; }); }
// Upload every texture and compile every shader for BOTH heroes (all LOD meshes, glows, jets) up front, so a hero swap never
// triggers a burst of 2048 texture uploads + shader compiles mid-game (the GPU-memory / stall spike that lost the context on Xbox).
function prewarm() {
  try {
    if (gpuProfile.safe) eachTexture(scene, t => capTexture(t, gpuProfile.texCap));
    const shown = []; for (const h of everyone) h.rig.root.traverse(o => { shown.push([o, o.visible]); o.visible = true; });
    renderer.compile(scene, camera);
    const seen = new Set(); eachTexture(scene, t => { if (!seen.has(t)) { seen.add(t); renderer.initTexture(t); } });
    for (const [o, v] of shown) o.visible = v;
  } catch (e) { console.warn('prewarm failed', e); }
}
// WebGL context loss (GPU reset / out of memory on consoles): keep the page alive, then rebuild what has no CPU-side copy
let contextLost = false, contextLosses = 0;
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; contextLosses++; console.warn('WebGL context lost'); }, false);
renderer.domElement.addEventListener('webglcontextrestored', () => {
  // (three.js has already re-created its GL state; image textures re-upload from their sources on first use)
  contextLost = false; world.buildEnv(renderer); // the sky IBL lives only on the GPU: without it every surface renders dark
  const fixed = city.repairTextures(); if (fixed) console.warn('redrew ' + fixed + ' wiped ground texture(s)'); // (grass went black on Xbox)
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) rt.dispose();
  if (contextLosses >= 2 && quality.level > 0) { quality.auto = false; quality.level = 0; } // keeps losing it: drop to Low
  if (!quality.safe && contextLosses >= 1) { quality.safe = true; gpuProfile.safe = true; gpuProfile.texCap = 1024; } // first loss: switch to the safe profile
  quality.apply(quality.preset); prewarm();
  hud.say(`Graphics restored (${quality.preset.name})`); console.warn('WebGL context restored');
}, false);

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

// D-pad left / right swaps heroes: you become the other hero in the same spot (same state / health); the villains stay the enemies
function switchHero() {
  const a = heroes[idx], b = heroes[idx ^ 1];
  if (a.grabbing) combat.releaseGrab(a); if (a.legGrabbing) combat.releaseLeg(a);
  for (const h of [a, b]) { h.action = null; h.endSuper(); h.endSprint(); h.landT = 0; h.flip = null; }
  b.pos.copy(a.pos); b.vel.copy(a.vel); b.yaw = a.yaw; b.state = a.state; b.charge = 0; b.flyBlend = a.flyBlend; b.hp = a.hp; b.ko = a.ko; b.koT = a.koT;
  b.ragdoll = a.ragdoll; if (!b.ragdoll) b.rig.body.rotation.set(0, 0, 0);
  a.ragdoll = null; a.dodge = null; a.rig.body.rotation.set(0, 0, 0); a.silence?.(); a.setVisible(false); b.setVisible(true);
  idx ^= 1; b.isPlayer = true; a.isPlayer = true;
  hud.say(`You: ${heroes[idx].def.name}`);
}
const lockPt = new THREE.Vector3();
const free = h => !h.ragdoll && !h.grabbedBy && !h.slammedBy && !h.legGrabbedBy;
// Y: extreme slow motion for the world (villains, their attacks, projectiles, particles, debris, traffic); the hero
// you play and the camera keep real time. Eased in/out over ~0.3 s. While a villain holds you, Y is the counter instead.
const SLOWMO = { rate: 0.1, ease: 9 };
const slow = { on: false, rate: 1, toggles: 0, heldT: 0, byDodge: false, dodgeT: 0 };
// lock-on dodge: world slow motion for a short counter window (Y slow-mo already on: it just stays on)
combat.onDodge = () => { if (slow.on && !slow.byDodge) return; slow.byDodge = true; slow.dodgeT = DODGE.slowT; if (!slow.on) { slow.on = true; slow.toggles++; slowmoSound(true); hud.say('Dodge! Counter'); } };
function setSlowmo(on) { if (slow.on === on) return; slow.on = on; slow.toggles++; slowmoSound(on); hud.say(on ? 'Slow motion' : 'Normal speed'); }
function canToggleSlowmo(P, dt) { // not while held / thrown, nor for 0.6 s after a hold ends (a late counter press shouldn't flip time)
  if (P.grabbedBy || P.legGrabbedBy || P.slammedBy || P.ragdoll || P.action?.type === 'counter') { slow.heldT = 0.6; return false; }
  return (slow.heldT = Math.max(0, slow.heldT - dt)) <= 0;
}
function stepSlowmo(dt) { // ease the world clock in log space so 1 -> 0.1 feels even
  if (slow.byDodge) { slow.dodgeT -= dt; if (slow.dodgeT <= 0) { slow.byDodge = false; if (slow.on) { slow.on = false; slow.toggles++; slowmoSound(false); } } }
  const target = slow.on ? SLOWMO.rate : 1, k = 1 - Math.exp(-dt * SLOWMO.ease);
  slow.rate = Math.exp(Math.log(slow.rate) + (Math.log(target) - Math.log(slow.rate)) * k);
  if (Math.abs(slow.rate - target) < 0.002) slow.rate = target;
  setWorldRate(slow.rate); hud.slowmo((1 - slow.rate) / (1 - SLOWMO.rate));
}
function combatFrame(dt, inp) {
  const P = heroes[idx];
  if (canToggleSlowmo(P, dt) && inp?.yPressed) { if (slow.byDodge) slow.byDodge = false; else setSlowmo(!slow.on); } // Y during a dodge window: keep the slow motion on // (grabbed: combat.update turns Y into the counter)
  stepSlowmo(dt); const wdt = dt * slow.rate; // world time
  if (free(P)) P.update(dt, P.ko ? NOINP : inp, cam, city);
  setWorldSfx(true);
  for (const v of villains) { const ai = v.parked ? NOINP : combat.aiInput(wdt, v, P); if (free(v)) v.update(wdt, ai, v.aiCam, city); }
  setWorldSfx(false);
  const live = villains.some(v => v.parked) ? villains.filter(v => !v.parked) : villains; // tests can park villain B out of the fight
  combat.update(dt, P, live, P.ko ? null : inp, cam.forward, wdt);
  combat.updateLock(dt, P, live, inp);
  const L = combat.lockTarget(); cam.lockTarget = L ? combat.chest(L, lockPt) : null;
  for (const h of [P, ...villains]) if (!free(h)) h.animate(h === P ? dt : wdt, 0);
  for (const v of villains) if (v.legGrabbing) combat.attachLeg(v); // leg grab: ankle pinned to the palm after both poses are evaluated
  // KO -> respawn (villains come back at full 700 HP a short way off)
  if (P.ko && (P.koT += dt) > 3.2) { combat.reset(P, P.pos.clone().setY(city.heightAt(P.pos.x, P.pos.z))); hud.say('Back on your feet'); }
  for (const v of villains) if (v.ko && (v.koT += wdt) > 4) combat.respawnNear(v, P);
  hud.bars(P, villains, combat.inCombat(P, villains), dt, combat.lockTarget());
  hud.grab(combat.grabState(P, villains), input.state.hasPad, P.def.style === 'fire');
  const G = villains.find(v => v.grabbing === P || v.legGrabbing === P);
  hud.counter(!!G && combat.canCounter(P), G || villains[0], camera, dt); // Y prompt over the grabber's head, only while they hold you (choke or leg grab: 1.5 s)
}
const clock = new THREE.Clock();
let paused = false;
function render() { if (contextLost) return; if (usePost) composer.render(); else renderer.render(scene, camera); }
function frame() {
  requestAnimationFrame(frame);
  if (paused) return;
  tick(clock.getDelta());
}
function tick(raw) { // one full game frame (tests drive it directly with a fixed raw dt)
  const dt = Math.min(raw, 1 / 20);
  const inp = input.update(dt);
  if (inp.anyPressed || inp.superPressed) unlockAudio(); // controller presses (may not count as a gesture everywhere)
  if (inp.hudPressed) hud.toggle();
  if (inp.qualityPressed) hud.say('Graphics: ' + quality.cycle());
  const h = heroes[idx];
  if (!started) { if (assetsReady && inp.anyPressed) begin(); cam.update(dt, { lookX: dt * 0.1, lookY: 0 }, h, city); h.animate(dt, 0); for (const v of villains) v.animate(dt, 0); }
  else {
    if (inp.swapPressed && !heroes[idx].grabbedBy && !heroes[idx].legGrabbedBy && !heroes[idx].slammedBy && heroes[idx].action?.type !== 'counter') switchHero(); // D-pad left / right
    combatFrame(dt, inp); cam.update(dt, inp, heroes[idx], city);
  }
  step(dt, raw);
}
function step(dt, raw, noRender) {
  const h = heroes[idx]; Hero.audioHero = h; // only the hero you control plays its looping flight sounds
  const wdt = dt * slow.rate; // world time (slow motion); the player's own speed lines stay real time
  fx.speedLines(dt, h.pos, h.vel, (h.superSpeed && h.state === 'fly') || !!h.action?.dash || (h.action?.type === 'tackle' && h.speed > 120) || (h.superSprint && h.state === 'ground' && Math.hypot(h.vel.x, h.vel.z) > 30) || !!h.dodge, h.def.style === 'fire');
  fx.update(wdt); traffic.update(wdt);
  world.update(wdt, camera, h.pos);
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
  setPaused(v) { paused = v; }, scene, THREE, gpuProfile, slow, setSlowmo, SLOWMO, traffic, fx, tick, get contextLosses() { return contextLosses; }, prewarm, get ready() { return assetsReady; }, markReady };
