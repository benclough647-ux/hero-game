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
  // choke-grab timer bar + prompts (always shown, even with the HUD hidden)
  grab(st, pad, fire) {
    if (!this.gEl) { this.gEl = document.getElementById('grabUI'); this.gBar = document.getElementById('grabBar'); this.gTitle = document.getElementById('grabTitle'); this.gHint = document.getElementById('grabHint'); this.gCh = document.getElementById('grabCharge'); }
    if (!this.gEl) return;
    if (!st) { if (this.gEl.style.display !== 'none') this.gEl.style.display = 'none'; return; }
    this.gEl.style.display = 'block';
    this.gBar.style.width = (100 * st.left / st.max).toFixed(1) + '%'; this.gBar.style.background = st.left < 1.5 ? '#ff5a3a' : (fire ? '#ff9a40' : '#ffe6a0');
    const ch = st.mode === 'punch'; this.gCh.style.display = ch ? 'block' : 'none'; if (ch) { this.gCh.firstElementChild.style.width = (100 * st.charge).toFixed(0) + '%'; this.gCh.firstElementChild.style.background = fire ? '#ff6a20' : '#fff4c8'; }
    if (st.role === 'victim') { this.gTitle.textContent = 'GRABBED!'; this.gHint.textContent = ''; return; }
    this.gTitle.textContent = { hold: `CHOKE HOLD  ${st.left.toFixed(1)}s`, punch: 'CHARGING…', spin: 'SPINNING…' }[st.mode] || '';
    this.gHint.innerHTML = st.mode !== 'hold' ? (st.mode === 'punch' ? 'release to punch' : '') : pad ? '<b>X</b> charged punch · <b>B</b> spin throw · <b>LS</b> ↑ forward drive' : '<b>X</b> charged punch · <b>E</b> spin throw · <b>W</b> forward drive';
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
        ? 'L-stick move · R-stick camera · <b>A</b> jump/fly (Tiger: hold &amp; release = mega leap · Centurion: hold = take off) · <b>RT</b> (hold) roar blast / eye beams · <b>LT</b> tackle · <b>X</b> dash punch · <b>RB</b> boost/sprint · <b>LS</b> (click) sonic boom → super speed while flying · <b>RS</b> (click) lock on · <b>A A</b> (double-tap while tumbling) recover · <b>LT</b> hit → choke grab · <b>LB</b> descend · <b>B</b> stop flying · <b>Y</b> switch hero · <b>View</b> HUD'
        : 'WASD move · Mouse camera · <b>Space</b> jump/fly · <b>Left click/F</b> (hold) roar blast / eye beams · <b>Right click/R</b> tackle · <b>X/V</b> dash punch · <b>Shift</b> boost · <b>B</b> sonic boom (while flying) · <b>T/middle click</b> lock on · <b>Space Space</b> (tumbling) recover · <b>C</b> descend · <b>E</b> stop flying · <b>Tab/Q</b> switch hero · <b>H</b> HUD · <b>G</b> graphics'; }
  }
}
