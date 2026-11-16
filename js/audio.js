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
