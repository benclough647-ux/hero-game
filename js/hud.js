// HUD is hidden by default for a clean cinematic screen. Toggle with H (keyboard) or View/Back (controller).
export class HUD {
  constructor() { this.root = document.getElementById('hud'); this.hero = document.getElementById('hero'); this.stats = document.getElementById('stats'); this.mode = document.getElementById('mode');
    this.charge = document.getElementById('charge'); this.bar = this.charge.firstElementChild; this.hint = document.getElementById('hint'); this.toast = document.getElementById('toast'); this.lastPad = null; this.visible = false; this.toastT = 0; }
  toggle() { this.visible = !this.visible; this.root.style.display = this.hint.style.display = this.visible ? 'block' : 'none'; }
  say(msg) { this.toast.textContent = msg; this.toast.style.opacity = 1; this.toastT = 2; }
  update(h, pad, dt, extra = '') {
    if ((this.toastT -= dt) < 0 && this.toast.style.opacity !== '0') this.toast.style.opacity = 0;
    if (!this.visible) return;
    this.hero.textContent = h.def.name; this.hero.style.color = h.def.style === 'fire' ? '#ff7a30' : '#ffe6a0';
    this.stats.textContent = `${Math.round(h.speed * 2.237)} mph   ·   ALT ${Math.round(h.pos.y)} m`;
    this.mode.textContent = h.modeLabel + extra;
    this.charge.style.display = h.charge > 0 ? 'block' : 'none'; this.bar.style.width = (h.charge * 100) + '%';
    if (pad !== this.lastPad) { this.lastPad = pad;
      this.hint.innerHTML = pad
        ? 'L-stick move · R-stick camera · <b>A</b> jump (Tiger: hold &amp; release = mega leap · Centurion: hold = take off) · <b>A</b> in air = fly / climb · <b>RT</b> boost/sprint · <b>LT</b> descend/dive · <b>B/X</b> stop flying · <b>Y</b> switch hero · <b>View</b> hide HUD'
        : 'WASD move · Mouse camera · <b>Space</b> jump/fly · <b>Shift</b> boost · <b>C</b> descend/dive · <b>E</b> stop flying · <b>Tab/Q</b> switch hero · <b>H</b> hide HUD · <b>G</b> graphics quality'; }
  }
}
