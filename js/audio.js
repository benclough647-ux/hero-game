// Tiny WebAudio synth + one sample (Tiger's roar, assets/audio/tiger_roar.ogg/.m4a). The context is created/resumed on a user gesture.
let ctx = null, master = null, noiseBuf = null;
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC(); pitchWorld(ctx); const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 6;
      master = ctx.createGain(); master.gain.value = 0.8; muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000; muffle.Q.value = 0.5; master.connect(muffle); muffle.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    loadRoar(); loadSfx();
  } catch (e) { /* audio is optional */ }
}
// Slow motion: sounds started by the world (villains, their hits, projectiles, ragdoll crashes) drop in pitch with
// world time; the player's own sounds stay normal. setWorldSfx(true) marks the code that follows as world-owned.
// Pitch follows rate^0.45 (0.1x time -> ~0.35x pitch, about 1.5 octaves down) so hits stay audible; one-shot
// sources are pitched when they start (already-playing sounds keep their pitch).
let worldRate = 1, worldSfx = false, muffle = null;
export function setWorldRate(r) { // also a gentle low-pass on the whole mix while time is slowed (subtle slow-mo cue)
  if (Math.abs(r - worldRate) < 1e-4) return; worldRate = r;
  if (muffle && ctx) { const k = Math.min(1, Math.max(0, (1 - r) / 0.9)); muffle.frequency.setTargetAtTime(20000 * Math.pow(3200 / 20000, k), ctx.currentTime, 0.05); }
}
export const getWorldRate = () => worldRate;
// slow-motion toggle cue: a deep "whoomp" down-sweep going in, a rising sweep coming out
export function slowmoSound(on) {
  unlockAudio(); if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(on ? 220 : 60, t); o.frequency.exponentialRampToValueAtTime(on ? 45 : 240, t + 0.45);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.45, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.6);
  noise(t, 0.5, 'bandpass', on ? 2400 : 300, on ? 250 : 2600, 0.22, 0.04);
  slowmoSound.last = { t: ctx.currentTime, on };
}
export function setWorldSfx(on) { worldSfx = on; }
export const sfxPitch = () => worldSfx && worldRate < 0.999 ? Math.pow(worldRate, 0.45) : 1;
if (typeof window !== 'undefined') window.__sfxPitch = { get rate() { return worldRate; }, get world() { return worldSfx; }, pitch: sfxPitch, log: [] };
function pitchWorld(c) {
  const cents = () => 1200 * Math.log2(sfxPitch());
  for (const fn of ['createBufferSource', 'createOscillator']) { const orig = c[fn].bind(c);
    c[fn] = () => { const n = orig(), d = cents(); if (d < -1) { n.detune.value = d; const L = window.__sfxPitch.log; L.push(+d.toFixed(0)); if (L.length > 40) L.shift(); } return n; }; }
}
// Temper Tiger's roar: a real tiger roar sample supplied by Ben (see assets/CREDITS.md); Ogg Vorbis, AAC fallback
const roarState = { buf: null, loading: false, error: null, url: null };
if (typeof window !== 'undefined') window.__roarSample = roarState;
function loadRoar() {
  if (roarState.buf || roarState.loading || !ctx) return; roarState.loading = true;
  const a = document.createElement('audio'), ogg = a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"');
  const url = new URL('../assets/audio/tiger_roar.' + (ogg ? 'ogg' : 'm4a'), import.meta.url).href; roarState.url = url;
  fetch(url).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(ab => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
    .then(b => { roarState.buf = b; roarState.duration = b.duration; }, e => { roarState.error = String(e?.message || e); })
    .finally(() => { roarState.loading = false; });
}
function noise(t0, dur, type, f0, f1, gain, attack = 0.004) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t0); src.stop(t0 + dur + 0.05);
}
// Sonic boom: the classic double crack (N-wave) + a deep thump + rolling rumble; Tiger adds a fiery roar.
export function sonicBoomSound(fire = false, vol = 1) { // vol: distance attenuation for other fliers' booms (villains)
  unlockAudio(); if (!ctx || ctx.state !== 'running' || vol < 0.02) return;
  const t = ctx.currentTime + 0.01;
  noise(t, 0.45, 'lowpass', 6000, 180, 1.0 * vol, 0.003);
  noise(t + 0.11, 0.55, 'lowpass', 4500, 120, 0.85 * vol, 0.003);
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.9 * vol), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.4);
  noise(t + 0.05, 2.2, 'lowpass', 260, 60, 0.5 * vol, 0.08);
  if (fire) noise(t, 1.1, 'bandpass', 500, 2400, 0.45 * vol, 0.05);
  sonicBoomSound.last = { t: ctx.currentTime, vol };
}

// Temper Tiger's super-speed ignition: a deep fireball boom + roaring flame burst (layered with the sonic boom)
export function fireBoomSound() {
  unlockAudio(); if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01;
  noise(t, 1.4, 'lowpass', 2200, 90, 1.0, 0.006);
  noise(t + 0.02, 1.6, 'bandpass', 700, 220, 0.6, 0.03);
  noise(t + 0.05, 0.9, 'highpass', 2500, 900, 0.25, 0.02); // crackle
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(22, t + 1.4);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.0, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.6);
}
// punch dash: short rising air whoosh
export function whooshSound(fire) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  noise(t, 0.28, 'bandpass', 600, 3200, 0.55, 0.03);
  noise(t, 0.22, 'highpass', 2500, 6000, 0.18, 0.02);
  if (fire) noise(t + 0.02, 0.3, 'lowpass', 1800, 400, 0.35, 0.02);
}

// Tiger roar blast: the tiger roar sample (slight random pitch each time) layered over a looping fire roar
// (band-passed noise + low rumble). Falls back to a synth growl if the sample hasn't loaded. stop() fades it all out.
export function roarSound() {
  unlockAudio(); if (!ctx || ctx.state !== 'running') return null;
  const t = ctx.currentTime + 0.01, out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.85, t + 0.1); out.connect(master);
  const srcs = [];
  let roarG = null; // the roar sample plays out in full (~2 s) even if RT is released early; only the fire loop fades
  if (roarState.buf) {
    const r = ctx.createBufferSource(); r.buffer = roarState.buf; r.playbackRate.value = 0.93 + Math.random() * 0.14; // +-7% pitch
    roarG = ctx.createGain(); roarG.gain.value = 1.15; r.connect(roarG); roarG.connect(master); r.start(t);
    roarState.plays = (roarState.plays || 0) + 1;
  } else {
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(3 * x); } shaper.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5; lp.frequency.setValueAtTime(380, t); lp.frequency.exponentialRampToValueAtTime(1100, t + 0.26);
    const gG = ctx.createGain(); gG.gain.value = 0.5; shaper.connect(lp); lp.connect(gG); gG.connect(out);
    const flutter = ctx.createOscillator(), fG = ctx.createGain(); flutter.frequency.value = 24; fG.gain.value = 7; flutter.connect(fG); srcs.push(flutter);
    for (const [type, f, d] of [['sawtooth', 56, 0], ['sawtooth', 84, 9], ['square', 28, 0]]) {
      const o = ctx.createOscillator(); o.type = type; o.detune.value = d;
      o.frequency.setValueAtTime(f * 0.8, t); o.frequency.exponentialRampToValueAtTime(f * 1.15, t + 0.24); o.frequency.exponentialRampToValueAtTime(f, t + 1.2);
      fG.connect(o.frequency); o.connect(shaper); srcs.push(o);
    }
  }
  const nz = ctx.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true; srcs.push(nz);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.6; bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(1300, t + 0.3);
  const rum = ctx.createBiquadFilter(); rum.type = 'lowpass'; rum.frequency.value = 220;
  const nG = ctx.createGain(); nG.gain.setValueAtTime(0.0001, t); nG.gain.exponentialRampToValueAtTime(roarG ? 0.45 : 0.7, t + 0.28); // fire sits under the roar
  const rG = ctx.createGain(); rG.gain.value = 0.6;
  nz.connect(bp); bp.connect(nG); nG.connect(out); nz.connect(rum); rum.connect(rG); rG.connect(out);
  for (const s of srcs) s.start(t);
  let stopped = false;
  return { stop() {
    if (stopped) return; stopped = true; const n = ctx.currentTime;
    out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), n); out.gain.exponentialRampToValueAtTime(0.0001, n + 0.4);
    for (const s of srcs) s.stop(n + 0.45);
  } };
}
// fiery explosion when the roar blast is released
export function fireBlastSound(power = 1) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01;
  noise(t, 0.7, 'lowpass', 3000, 120, 0.6 + 0.3 * power, 0.004);
  noise(t, 0.9, 'bandpass', 900, 300, 0.4, 0.02);
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.7);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.9);
}
// Temper Tiger flight jets: a continuous flame roar (looped noise through a band-pass "hiss" + a low rumble + a crackle
// layer). set(level) drives volume and brightness from the jet intensity (0 = silent ... ~2.5 = sonic-boom afterburner).
export function jetSound() {
  if (!ctx || ctx.state !== 'running') return null;
  const t = ctx.currentTime, out = ctx.createGain(); out.gain.value = 0.0001; out.connect(master);
  const nz = ctx.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7; bp.frequency.value = 500;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
  const gB = ctx.createGain(), gL = ctx.createGain(), gH = ctx.createGain(); gB.gain.value = 0.55; gL.gain.value = 0.9; gH.gain.value = 0.0;
  nz.connect(bp); bp.connect(gB); gB.connect(out); nz.connect(lp); lp.connect(gL); gL.connect(out); nz.connect(hp); hp.connect(gH); gH.connect(out);
  const flick = ctx.createOscillator(), fG = ctx.createGain(); flick.frequency.value = 9; fG.gain.value = 0.12; flick.connect(fG); fG.connect(gB.gain); // flame flutter
  nz.start(t); flick.start(t);
  let dead = false;
  return {
    set(level) {
      if (dead) return; const n = ctx.currentTime, k = Math.max(0, Math.min(2.5, level));
      out.gain.setTargetAtTime(k < 0.01 ? 0.0001 : 0.06 + 0.22 * k, n, 0.08);
      bp.frequency.setTargetAtTime(420 + 650 * k, n, 0.1); lp.frequency.setTargetAtTime(120 + 90 * k, n, 0.1);
      gH.gain.setTargetAtTime(Math.max(0, k - 0.9) * 0.12, n, 0.1); fG.gain.setTargetAtTime(0.1 + 0.06 * k, n, 0.1);
    },
    stop() { if (dead) return; dead = true; const n = ctx.currentTime; out.gain.setTargetAtTime(0.0001, n, 0.05); nz.stop(n + 0.3); flick.stop(n + 0.3); },
  };
}

// ---------- sampled SFX (Ben's clips, see assets/CREDITS.md): punch impacts (rotating) + Centurion's eye-beam laser ----------
// WAV so the laser sustain loops gaplessly (Ogg/AAC encoder padding would click at the loop point).
const SFX_FILES = { punch1: 'punch1', punch2: 'punch2', punch3: 'punch3', laserStart: 'laser_start', laserLoop: 'laser_loop', laserTail: 'laser_tail' };
const sfxState = { bufs: {}, loading: false, loaded: 0, total: Object.keys(SFX_FILES).length, errors: [], punchPlays: [], laserLog: [], lastPunch: -1, wind: null };
if (typeof window !== 'undefined') window.__sfx = sfxState;
function loadSfx() {
  if (sfxState.loading || sfxState.loaded >= sfxState.total || !ctx) return; sfxState.loading = true;
  // Ogg Vorbis where supported (Edge/Chrome/Firefox), AAC .m4a otherwise (Safari) - same scheme as the roar
  const a = document.createElement('audio'), ext = a.canPlayType && a.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a'; sfxState.ext = ext;
  Promise.all(Object.entries(SFX_FILES).map(([k, f]) => fetch(new URL(`../assets/audio/${f}.${ext}`, import.meta.url).href)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(ab => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
    .then(b => { sfxState.bufs[k] = b; sfxState.loaded++; }, e => { sfxState.errors.push(k + ': ' + String(e?.message || e)); })))
    .finally(() => { sfxState.loading = false; });
}
function play(buf, t, rate = 1, gain = 1, dest = master) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = gain; s.connect(g); g.connect(dest); s.start(t); return { s, g };
}
// melee impact: rotate through the three punch clips (never the same one twice in a row), +-6% pitch, louder for harder hits
export const PUNCH_SFX = { pitch: 0.06, gain0: 0.65, gain1: 0.45 };
export function punchSound(power = 0.5) {
  if (!ctx || ctx.state !== 'running') return -1;
  const P = ['punch1', 'punch2', 'punch3'].filter(k => sfxState.bufs[k]);
  if (!P.length) { noise(ctx.currentTime, 0.18, 'lowpass', 1800, 120, 0.7, 0.002); return -1; }
  let i = Math.floor(Math.random() * P.length); if (P.length > 1 && i === sfxState.lastPunch) i = (i + 1 + Math.floor(Math.random() * (P.length - 1))) % P.length;
  sfxState.lastPunch = i;
  const rate = 1 + (Math.random() * 2 - 1) * PUNCH_SFX.pitch, k = Math.max(0, Math.min(1, power));
  play(sfxState.bufs[P[i]], ctx.currentTime + 0.005, rate, PUNCH_SFX.gain0 + PUNCH_SFX.gain1 * k);
  sfxState.punchPlays.push({ i, rate: +rate.toFixed(3), t: +ctx.currentTime.toFixed(3) }); if (sfxState.punchPlays.length > 50) sfxState.punchPlays.shift();
  return i;
}
// Centurion's eye beam: start clip -> seamless sustain loop while RT is held -> tail on release. Returns { stop() }.
const LASER_LOOP = 2.0;
export function laserSound() {
  if (!ctx || ctx.state !== 'running') return null;
  const B = sfxState.bufs, t = ctx.currentTime + 0.005, out = ctx.createGain(); out.gain.value = 0.9; out.connect(master);
  const log = { start: t, loopAt: null, stopAt: null, sample: !!(B.laserStart && B.laserLoop) }; sfxState.laserLog.push(log); if (sfxState.laserLog.length > 20) sfxState.laserLog.shift();
  let loop = null, loopG = null, synth = null;
  if (log.sample) {
    play(B.laserStart, t, 1, 1, out);
    const at = t + Math.max(0.05, B.laserStart.duration - 0.06); log.loopAt = at; // 60 ms overlap into the loop
    loop = ctx.createBufferSource(); loop.buffer = B.laserLoop; loop.loop = true;
    // the loop was cut to exactly LASER_LOOP s; if a decoder ever leaves encoder padding on the end, loop only that window
    if (B.laserLoop.duration > LASER_LOOP + 0.002) { loop.loopStart = 0; loop.loopEnd = LASER_LOOP; } loopG = ctx.createGain();
    loopG.gain.setValueAtTime(0.0001, at); loopG.gain.exponentialRampToValueAtTime(1, at + 0.06);
    loop.connect(loopG); loopG.connect(out); loop.start(at);
  } else { // fallback: bright sine whine + hiss
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = 1440; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.08);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2900; f.Q.value = 3; o.connect(f); f.connect(g); g.connect(out); o.start(t); synth = { o, g };
  }
  let stopped = false;
  return { stop() {
    if (stopped) return; stopped = true; const n = ctx.currentTime; log.stopAt = n;
    if (loop) { loopG.gain.cancelScheduledValues(n); loopG.gain.setValueAtTime(Math.max(0.0001, loopG.gain.value), n); loopG.gain.exponentialRampToValueAtTime(0.0001, n + 0.08); loop.stop(n + 0.1); }
    if (synth) { synth.g.gain.setTargetAtTime(0.0001, n, 0.03); synth.o.stop(n + 0.2); }
    if (B.laserTail) { play(B.laserTail, n + 0.01, 1, 1, out); log.tail = true; }
  } };
}
// Centurion's flight wind (player only): no wind clip was supplied, so it is synthesised: looped noise through a band-pass
// (rush) + low-pass (roar) with a slow gust LFO. set(k) with k = flight speed / boost speed (0 ... ~1.5 at super speed):
// volume and filter pitch both rise with speed.
export const WIND = { gain0: 0.03, gain1: 0.34, bp0: 260, bp1: 1900, lp0: 500, lp1: 5200, rate0: 0.75, rate1: 1.35 };
export function windSound() {
  if (!ctx || ctx.state !== 'running') return null;
  const t = ctx.currentTime, out = ctx.createGain(); out.gain.value = 0.0001; out.connect(master);
  const nz = ctx.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.value = WIND.bp0;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = WIND.lp0; lp.Q.value = 0.4;
  const gB = ctx.createGain(), gL = ctx.createGain(); gB.gain.value = 0.7; gL.gain.value = 0.55;
  nz.connect(bp); bp.connect(gB); gB.connect(out); nz.connect(lp); lp.connect(gL); gL.connect(out);
  const gust = ctx.createOscillator(), gG = ctx.createGain(); gust.frequency.value = 0.37; gG.gain.value = 0.18; gust.connect(gG); gG.connect(gB.gain);
  nz.start(t); gust.start(t);
  const st = sfxState.wind = { level: 0, gain: 0, bp: WIND.bp0, rate: 1, alive: true };
  let dead = false;
  return {
    set(k) {
      if (dead) return; const n = ctx.currentTime, x = Math.max(0, Math.min(1.5, k)), e = Math.pow(Math.min(1, x), 0.8);
      const gain = x < 0.005 ? 0.0001 : WIND.gain0 + WIND.gain1 * e + 0.08 * Math.max(0, x - 1);
      const f = WIND.bp0 + (WIND.bp1 - WIND.bp0) * e + 500 * Math.max(0, x - 1), rate = WIND.rate0 + (WIND.rate1 - WIND.rate0) * Math.min(1, x);
      out.gain.setTargetAtTime(gain, n, 0.12); bp.frequency.setTargetAtTime(f, n, 0.15); lp.frequency.setTargetAtTime(WIND.lp0 + (WIND.lp1 - WIND.lp0) * e, n, 0.15);
      nz.playbackRate.setTargetAtTime(rate, n, 0.15);
      st.level = +x.toFixed(3); st.gain = +gain.toFixed(4); st.bp = Math.round(f); st.rate = +rate.toFixed(3);
    },
    stop() { if (dead) return; dead = true; st.alive = false; const n = ctx.currentTime; out.gain.setTargetAtTime(0.0001, n, 0.05); nz.stop(n + 0.3); gust.stop(n + 0.3); },
  };
}
