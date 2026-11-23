// Graphics presets + automatic downgrade when the frame rate is poor.
export const PRESETS = [
  { name: 'Low', pixel: 0.6, post: false, msaa: 0, view: 1100, detail: 200 },
  { name: 'Medium', pixel: 0.8, post: true, msaa: 0, view: 1400, detail: 320 },
  { name: 'High', pixel: 1.0, post: true, msaa: 4, view: 1700, detail: 450 },
];
export class QualityManager {
  // opts.safe: Xbox / weak-GPU Edge profile (see gpuProfile in main.js): same look and tone mapping, lighter GPU memory use
  constructor(apply, opts = {}) {
    this.safe = !!opts.safe; this.postOk = opts.postOk !== false;
    this.apply = apply; const qs = new URLSearchParams(location.search).get('q');
    this.auto = qs === null; const xbox = /Xbox/i.test(navigator.userAgent);
    this.level = qs !== null ? Math.max(0, Math.min(2, +qs)) : (xbox ? 1 : 2);
    this.acc = 0; this.frames = 0; this.warm = 3; this.apply(this.preset);
  }
  get preset() {
    const P = PRESETS[this.level];
    if (!this.safe && this.postOk) return P;
    if (!this.safe) return { ...P, post: false };
    // safe: pixel ratio <= 1, no MSAA and no
    // half-float HDR render targets at all (post off): the renderer then tone-maps (ACES, same exposure) + sRGB-encodes straight
    // to the canvas, which is exactly what the OutputPass does, so the picture keeps the same brightness
    return { ...P, safe: true, pixel: Math.min(P.pixel, 1), msaa: 0, post: false };
  }
  cycle() { this.auto = false; this.level = (this.level + 2) % 3; this.apply(this.preset); return this.preset.name; }
  // returns a message when quality changed
  sample(rawDt) {
    if (!this.auto) return null;
    if ((this.warm -= rawDt) > 0) return null;
    this.acc += rawDt; this.frames++;
    if (this.acc < 2.5) return null;
    const fps = this.frames / this.acc; this.acc = 0; this.frames = 0;
    if (fps < 42 && this.level > 0) { this.level--; this.apply(this.preset); this.warm = 2; return `Graphics: ${this.preset.name} (auto, ${fps.toFixed(0)} fps)`; }
    return null;
  }
}
