const THREE_clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// HUD is hidden by default for a clean cinematic screen. Toggle with H (keyboard) or View/Back (controller).
export class HUD {
  constructor() { this.root = document.getElementById('hud'); this.hero = document.getElementById('hero'); this.stats = document.getElementById('stats'); this.mode = document.getElementById('mode');
    this.charge = document.getElementById('charge'); this.bar = this.charge.firstElementChild; this.hint = document.getElementById('hint'); this.toast = document.getElementById('toast'); this.lastPad = null; this.visible = false; this.toastT = 0; }
  // minimal combat health bars, only shown while a fight is on: you on the left, both villains stacked on the right
  // (the locked-on villain's bar is marked)
  bars(player, enemies, show, dt, lock = null) {
    if (!Array.isArray(enemies)) enemies = [enemies];
    if (!this.barEl) { const $ = id => document.getElementById(id); this.barEl = $('bars'); this.pBar = $('pBar'); this.pName = $('pName'); this.pHp = $('pHp'); this.op = 0;
      this.eRows = [['eBox', 'eBar', 'eName', 'eHp'], ['eBox2', 'eBar2', 'eName2', 'eHp2']].map(([b, r, n, h]) => ({ box: $(b), bar: $(r), name: $(n), hp: $(h) })).filter(r => r.bar); }
    if (!this.barEl) return;
    this.op += ((show ? 1 : 0) - this.op) * Math.min(1, dt * 4);
    this.barEl.style.opacity = this.op.toFixed(3); this.barEl.style.display = this.op < 0.01 ? 'none' : 'flex';
    if (this.op < 0.01) return;
    const col = h => h.def.color || (h.def.style === 'fire' ? '#ff7a30' : '#ffe6a0');
    this.pBar.style.width = Math.max(0, 100 * player.hp / player.maxHp) + '%'; this.pBar.style.background = col(player); this.pName.textContent = player.def.name;
    if (this.pHp) this.pHp.textContent = `${Math.max(0, Math.ceil(player.hp))} / ${player.maxHp}`;
    this.eRows.forEach((r, i) => {
      const e = enemies[i]; if (r.box) r.box.style.display = e ? '' : 'none'; if (!e) return;
      r.bar.style.width = Math.max(0, 100 * e.hp / e.maxHp) + '%'; r.bar.style.background = col(e); r.name.textContent = e.def.name;
      if (r.hp) r.hp.textContent = `${Math.max(0, Math.ceil(e.hp))} / ${e.maxHp}`;
      if (r.box) { r.box.classList.toggle('lk', e === lock); r.box.classList.toggle('ko', !!e.ko); }
    });
  }
  // choke-grab timer bar + prompts (always shown, even with the HUD hidden)
  grab(st, pad, fire) {
    if (!this.gEl) { this.gEl = document.getElementById('grabUI'); this.gBar = document.getElementById('grabBar'); this.gTitle = document.getElementById('grabTitle'); this.gHint = document.getElementById('grabHint'); this.gCh = document.getElementById('grabCharge'); }
    if (!this.gEl) return;
    if (!st) { if (this.gEl.style.display !== 'none') this.gEl.style.display = 'none'; return; }
    this.gEl.style.display = 'block';
    this.gBar.style.width = (100 * st.left / st.max).toFixed(1) + '%'; this.gBar.style.background = st.left < 1.5 ? '#ff5a3a' : (fire ? '#ff9a40' : '#ffe6a0');
    const ch = st.mode === 'punch'; this.gCh.style.display = ch ? 'block' : 'none'; if (ch) { this.gCh.firstElementChild.style.width = (100 * st.charge).toFixed(0) + '%'; this.gCh.firstElementChild.style.background = fire ? '#ff6a20' : '#fff4c8'; }
    if (st.role === 'victim') { this.gTitle.textContent = 'GRABBED!'; this.gHint.innerHTML = pad ? '<b class="yb">Y</b> counter' : '<b>Z</b> counter'; return; }
    this.gTitle.textContent = { hold: `CHOKE HOLD  ${st.left.toFixed(1)}s`, punch: 'CHARGING…', spin: 'SPINNING…', slam: 'FACE SLAM!' }[st.mode] || '';
    this.gHint.innerHTML = st.mode !== 'hold' ? (st.mode === 'punch' ? 'release to punch' : '') : pad ? '<b>A</b> face slam · <b>X</b> charged punch · <b>B</b> spin throw · <b>LS</b> ↑ forward drive' : '<b>Space</b> face slam · <b>X</b> charged punch · <b>E</b> spin throw · <b>W</b> forward drive';
  }
  // world-anchored Y prompt above the grabber's head (only while they are holding you)
  counter(show, enemy, camera, dt) {
    if (!this.cEl) { this.cEl = document.getElementById('counterY'); this.cv = null; }
    if (!this.cEl) return;
    let vis = false;
    if (show) {
      const head = enemy.anim?.B?.('head'), p = this.cv || (this.cv = enemy.pos.clone());
      if (head) { enemy.rig.root.updateMatrixWorld(true); head.getWorldPosition(p); } else p.copy(enemy.pos).setY(enemy.pos.y + enemy.def.height);
      p.y += 0.55 * enemy.def.height / 1.83;
      p.project(camera);
      if (p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2) {
        const x = THREE_clamp((p.x * 0.5 + 0.5) * innerWidth, 40, innerWidth - 40), y = THREE_clamp((-p.y * 0.5 + 0.5) * innerHeight, 70, innerHeight - 20);
        this.cEl.style.left = x.toFixed(1) + 'px'; this.cEl.style.top = y.toFixed(1) + 'px'; vis = true;
      }
    }
    const d = vis ? 'block' : 'none'; if (this.cEl.style.display !== d) this.cEl.style.display = d;
    this.counterVisible = vis;
  }
  toggle() { this.visible = !this.visible; this.root.style.display = this.hint.style.display = this.visible ? 'block' : 'none'; }
  // slow-motion screen cue (CSS overlay, so it works with post-processing off too): cool blue vignette (no backdrop-filter: too costly on Xbox),
  // strength k = 0..1 follows the time ramp
  slowmo(k) {
    if (!this.smEl) { const d = document.createElement('div'); d.id = 'slowmo';
      d.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;display:none;background:radial-gradient(ellipse at center,rgba(40,70,110,.06) 45%,rgba(15,30,60,.55) 100%)';
      const cv = document.querySelector('canvas'); document.body.insertBefore(d, cv ? cv.nextSibling : document.body.firstChild); this.smEl = d; this.smK = -1; } // (inserted right above the 3D view, under the HUD)
    k = Math.round(THREE_clamp(k, 0, 1) * 100) / 100; if (k === this.smK) return; this.smK = k;
    this.smEl.style.display = k > 0 ? 'block' : 'none'; this.smEl.style.opacity = k.toFixed(2);
  }
  // faint yellow damage telegraph (Ben): a soft screen-edge tint toward the attacking villain. CSS overlay so it
  // works with the Xbox-safe profile (no post-processing). Keep it low-opacity and small — not a full-screen flash.
  telegraph(st) {
    if (!this.tgEl) { const d = document.createElement('div'); d.id = 'atkWarn';
      d.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;display:none;z-index:4';
      const cv = document.querySelector('canvas'); document.body.insertBefore(d, cv ? cv.nextSibling : document.body.firstChild); this.tgEl = d; this.tgSig = ''; }
    if (!st || !st.on) { if (this.tgSig !== 'off') { this.tgEl.style.display = 'none'; this.tgEl.style.opacity = '0'; this.tgSig = 'off'; } return; }
    const px = (50 + st.sx * 42).toFixed(1), py = (50 - st.sy * 42).toFixed(1);
    const sig = `${st.on}|${px}|${py}|${st.k.toFixed(2)}`;
    if (sig === this.tgSig) return; this.tgSig = sig;
    this.tgEl.style.background = `radial-gradient(ellipse 70% 70% at ${px}% ${py}%, rgba(255,220,90,0) 40%, rgba(255,205,60,${(0.28 * st.k).toFixed(3)}) 100%)`;
    this.tgEl.style.display = 'block'; this.tgEl.style.opacity = (0.9).toFixed(2);
  }
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
        ? 'L-stick move · R-stick camera · <b>A</b> jump/fly (Tiger: hold &amp; release = mega leap · Centurion: hold = take off) · <b>RT</b> (hold) roar blast / eye beams · <b>LT</b> tackle · <b>X</b> dash punch · <b>RB</b> boost/sprint · <b>LS</b> (click) sonic boom → super speed while flying · <b>RS</b> (click) lock on · flick <b>RS</b> ←/→ = switch hero · locked on: tap <b>LB</b> / <b>RB</b> dodge left / right (slow-mo only if you evade an attack; hold still descends / boosts), flick <b>RS</b> ↑/↓ = switch villain · <b>A A</b> (double-tap while tumbling) recover · <b>LT</b> hit → choke grab · <b>LB</b> descend · <b>B</b> stop flying · <b>D-pad ←/→</b> switch hero · <b>Y</b> slow motion (while grabbed: counter) · <b>View</b> HUD'
        : 'WASD move · Mouse camera · <b>Space</b> jump/fly · <b>Left click/F</b> (hold) roar blast / eye beams · <b>Right click/R</b> tackle · <b>X/V</b> dash punch · <b>Shift</b> boost · <b>B</b> sonic boom (while flying) · <b>T/middle click</b> lock on · locked on: <b>Shift+A / Shift+D</b> dodge (slow-mo only if you evade an attack), <b>[ / ]</b> switch villain · <b>Space Space</b> (tumbling) recover · <b>C</b> descend · <b>E</b> stop flying · <b>Tab/Q</b> switch hero · <b>Z</b> slow motion (while grabbed: counter) · <b>H</b> HUD · <b>G</b> graphics'; }
  }
}
