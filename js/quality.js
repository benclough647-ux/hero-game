// Graphics presets + automatic downgrade when the frame rate is poor.
export const PRESETS = [
  { name: 'Low', pixel: 0.6, post: false, msaa: 0, shadow: 0, shadowExtent: 0, water: 0, view: 1100 },
  { name: 'Medium', pixel: 0.8, post: true, msaa: 0, shadow: 1024, shadowExtent: 110, water: 256, view: 1400 },
  { name: 'High', pixel: 1.0, post: true, msaa: 4, shadow: 2048, shadowExtent: 170, water: 512, view: 1700 },
];
export class QualityManager {
  constructor(apply) {
    this.apply = apply; const qs = new URLSearchParams(location.search).get('q');
    this.auto = qs === null; const xbox = /Xbox/i.test(navigator.userAgent);
    this.level = qs !== null ? Math.max(0, Math.min(2, +qs)) : (xbox ? 1 : 2);
    this.acc = 0; this.frames = 0; this.warm = 3; this.apply(PRESETS[this.level]);
  }
  get preset() { return PRESETS[this.level]; }
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
