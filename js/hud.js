// HUD is hidden by default for a clean cinematic screen. Toggle with H (keyboard) or View/Back (controller).
export class HUD {
  constructor() { this.root = document.getElementById('hud'); this.hero = document.getElementById('hero'); this.stats = document.getElementById('stats'); this.mode = document.getElementById('mode');
    this.charge = document.getElementById('charge'); this.bar = this.charge.firstElementChild; this.hint = document.getElementById('hint'); this.toast = document.getElementById('toast'); this.lastPad = null; this.visible = false; this.toastT = 0; }
  // minimal combat health bars, only shown while a fight is on
  bars(player, enemy, show, dt) {
    if (!this.barEl) { this.barEl = document.getElementById('bars'); this.pBar = document.getElementById('pBar'); this.eBar = document.getElementById('eBar'); this.pName = document.getElementById('pName'); this.eName = document.getElementById('eName'); this.op = 0; }
    if (!this.barEl) return;
    this.op += ((show ? 1 : 0) - this.op) * Math.min(1, dt * 4);
    this.barEl.style.opacity = this.op.toFixed(3); this.barEl.style.display = this.op < 0.01 ? 'none' : 'flex';
    if (this.op < 0.01) return;
    const col = h => h.def.style === 'fire' ? '#ff7a30' : '#ffe6a0';
    this.pBar.style.width = Math.max(0, 100 * player.hp / player.maxHp) + '%'; this.eBar.style.width = Math.max(0, 100 * enemy.hp / enemy.maxHp) + '%';
    this.pBar.style.background = col(player); this.eBar.style.background = col(enemy);
    this.pName.textContent = player.def.name; this.eName.textContent = enemy.def.name;
  }
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
        ? 'L-stick move · R-stick camera · <b>A</b> jump/fly (Tiger: hold &amp; release = mega leap · Centurion: hold = take off) · <b>RT</b> blast · <b>LT</b> tackle · <b>X</b> super punch · <b>RB</b> boost/sprint · <b>LS</b> (click) sonic boom → super speed while flying · <b>LB</b> descend · <b>B</b> stop flying · <b>Y</b> switch hero · <b>View</b> HUD'
        : 'WASD move · Mouse camera · <b>Space</b> jump/fly · <b>Left click/F</b> blast · <b>Right click/R</b> tackle · <b>X/V</b> super punch · <b>Shift</b> boost · <b>B</b> sonic boom (while flying) · <b>C</b> descend · <b>E</b> stop flying · <b>Tab/Q</b> switch hero · <b>H</b> HUD · <b>G</b> graphics'; }
  }
}
