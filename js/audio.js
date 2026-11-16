// Tiny WebAudio synth + one sample (Tiger's roar, assets/audio/tiger_roar.ogg/.m4a). The context is created/resumed on a user gesture.
let ctx = null, master = null, noiseBuf = null;
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC(); const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 6;
      master = ctx.createGain(); master.gain.value = 0.8; master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    loadRoar();
  } catch (e) { /* audio is optional */ }
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
export function sonicBoomSound(fire = false) {
  unlockAudio(); if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01;
  noise(t, 0.45, 'lowpass', 6000, 180, 1.0, 0.003);
  noise(t + 0.11, 0.55, 'lowpass', 4500, 120, 0.85, 0.003);
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.4);
  noise(t + 0.05, 2.2, 'lowpass', 260, 60, 0.5, 0.08);
  if (fire) noise(t, 1.1, 'bandpass', 500, 2400, 0.45, 0.05);
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
