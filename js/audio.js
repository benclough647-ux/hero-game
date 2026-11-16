// Tiny WebAudio synth (the game ships no sound files). The context is created/resumed on a user gesture.
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
  } catch (e) { /* audio is optional */ }
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

// punch dash: short rising air whoosh
export function whooshSound(fire) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  noise(t, 0.28, 'bandpass', 600, 3200, 0.55, 0.03);
  noise(t, 0.22, 'highpass', 2500, 6000, 0.18, 0.02);
  if (fire) noise(t + 0.02, 0.3, 'lowpass', 1800, 400, 0.35, 0.02);
}

// Tiger roar blast: a deep growl (detuned saws + sub, fluttered by an LFO, driven through a waveshaper) layered with a
// looping fire roar (band-passed noise + low rumble). Returns a handle; stop() fades it out when the blast ends.
export function roarSound() {
  unlockAudio(); if (!ctx || ctx.state !== 'running') return null;
  const t = ctx.currentTime + 0.01, out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.85, t + 0.1); out.connect(master);
  const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(3 * x); } shaper.curve = curve;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5; lp.frequency.setValueAtTime(380, t); lp.frequency.exponentialRampToValueAtTime(1100, t + 0.26);
  const gG = ctx.createGain(); gG.gain.value = 0.5; shaper.connect(lp); lp.connect(gG); gG.connect(out);
  const srcs = [];
  const flutter = ctx.createOscillator(), fG = ctx.createGain(); flutter.frequency.value = 24; fG.gain.value = 7; flutter.connect(fG); srcs.push(flutter);
  const wob = ctx.createOscillator(), wG = ctx.createGain(); wob.frequency.value = 5.5; wG.gain.value = 260; wob.connect(wG); wG.connect(lp.frequency); srcs.push(wob);
  for (const [type, f, d] of [['sawtooth', 56, 0], ['sawtooth', 84, 9], ['square', 28, 0]]) {
    const o = ctx.createOscillator(); o.type = type; o.detune.value = d;
    o.frequency.setValueAtTime(f * 0.8, t); o.frequency.exponentialRampToValueAtTime(f * 1.15, t + 0.24); o.frequency.exponentialRampToValueAtTime(f, t + 1.2); // wind-up then the snap
    fG.connect(o.frequency); o.connect(shaper); srcs.push(o);
  }
  const nz = ctx.createBufferSource(); nz.buffer = noiseBuf; nz.loop = true; srcs.push(nz);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.6; bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(1300, t + 0.3);
  const rum = ctx.createBiquadFilter(); rum.type = 'lowpass'; rum.frequency.value = 220;
  const nG = ctx.createGain(); nG.gain.setValueAtTime(0.0001, t); nG.gain.exponentialRampToValueAtTime(0.7, t + 0.28);
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
