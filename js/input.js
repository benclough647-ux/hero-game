// Unified keyboard/mouse + Gamepad (Xbox standard mapping) input.
export class Input {
  constructor(dom) {
    this.keys = new Set(); this.mouseDX = 0; this.mouseDY = 0; this.mouseBtn = new Set();
    this.prev = {}; this.state = {};
    if ('gamepadInputEmulation' in navigator) { try { navigator.gamepadInputEmulation = 'gamepad'; } catch (e) {} }
    addEventListener('keydown', e => { this.keys.add(e.code); if (['Tab','Space','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', e => { if (document.pointerLockElement) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    addEventListener('mousedown', e => this.mouseBtn.add(e.button));
    addEventListener('mouseup', e => this.mouseBtn.delete(e.button));
    this.dom = dom;
  }
  dz(v, d = 0.15) { return Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d); }
  update(dt) {
    const k = c => this.keys.has(c);
    let gp = null;
    for (const p of (navigator.getGamepads ? navigator.getGamepads() : [])) if (p && p.connected) { gp = p; break; }
    const b = i => !!(gp && gp.buttons[i] && gp.buttons[i].pressed);
    const bv = i => (gp && gp.buttons[i]) ? gp.buttons[i].value : 0;
    const ax = i => gp ? this.dz(gp.axes[i] || 0) : 0;
    let mx = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + ax(0);
    let my = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0) - ax(1);
    const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
    const s = {
      moveX: mx, moveY: my,
      lookX: this.mouseDX * 0.0025 + ax(2) * 3.2 * dt,
      lookY: this.mouseDY * 0.0025 + ax(3) * 2.4 * dt,
      jump: k('Space') || b(0),
      boost: Math.max(k('ShiftLeft') || k('ShiftRight') ? 1 : 0, bv(7), this.mouseBtn.has(0) && document.pointerLockElement ? 1 : 0),
      descend: Math.max(k('KeyC') || k('ControlLeft') ? 1 : 0, bv(6)),
      cancel: k('KeyE') || b(1) || b(2),
      switch: k('Tab') || k('KeyQ') || b(3),
      any: b(0) || b(9),
      hud: k('KeyH') || b(8),
      quality: k('KeyG'),
      hasPad: !!gp,
    };
    this.mouseDX = this.mouseDY = 0;
    for (const n of ['jump', 'cancel', 'switch', 'any', 'hud', 'quality']) { s[n + 'Pressed'] = s[n] && !this.prev[n]; s[n + 'Released'] = !s[n] && this.prev[n]; }
    this.prev = s; this.state = s; return s;
  }
}
