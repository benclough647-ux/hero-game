export class HUD {
  constructor() { this.hero = document.getElementById('hero'); this.stats = document.getElementById('stats'); this.mode = document.getElementById('mode');
    this.charge = document.getElementById('charge'); this.bar = this.charge.firstElementChild; this.hint = document.getElementById('hint'); this.lastPad = null; }
  update(h, pad) {
    this.hero.textContent = h.def.name; this.hero.style.color = h.def.style === 'fire' ? '#ff7a30' : '#ffe6a0';
    this.stats.textContent = `${Math.round(h.speed * 2.237)} mph   ·   ALT ${Math.round(h.pos.y)} m`;
    this.mode.textContent = h.modeLabel;
    this.charge.style.display = h.charge > 0 ? 'block' : 'none'; this.bar.style.width = (h.charge * 100) + '%';
    if (pad !== this.lastPad) { this.lastPad = pad;
      this.hint.innerHTML = pad
        ? 'L-stick move · R-stick camera · <b>A</b> jump (Tiger: hold &amp; release = mega leap · Centurion: hold = take off) · <b>A</b> in air = fly / climb · <b>RT</b> boost/sprint · <b>LT</b> descend · <b>B/X</b> stop flying · <b>Y</b> switch hero'
        : 'WASD move · Mouse camera (click to lock) · <b>Space</b> jump (Tiger: hold &amp; release = mega leap · Centurion: hold = take off) · <b>Space</b> in air = fly / climb · <b>Shift</b>/LMB boost · <b>C</b>/Ctrl descend · <b>E</b> stop flying · <b>Tab/Q</b> switch hero'; }
  }
}
