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
    addEventListener('contextmenu', e => e.preventDefault());
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
    const boostKey = (k('ShiftLeft') || k('ShiftRight')) ? 1 : 0;
    const descendKey = (k('KeyC') || k('ControlLeft')) ? 1 : 0;
    const s = {
      moveX: mx, moveY: my,
      lookX: this.mouseDX * 0.0025 + ax(2) * 3.2 * dt,
      lookY: this.mouseDY * 0.0025 + ax(3) * 2.4 * dt,
      rsX: gp ? (gp.axes[2] || 0) : 0, // raw right-stick X (flick left / right = switch hero)
      rsY: gp ? (gp.axes[3] || 0) : 0, // raw right-stick Y (locked on: flick up / down = switch villain)
      swX: (k('BracketRight') ? 1 : 0) - (k('BracketLeft') ? 1 : 0), // keyboard [ / ]: switch villain
      dodgeL: (k('ShiftLeft') || k('ShiftRight')) && k('KeyA'), dodgeR: (k('ShiftLeft') || k('ShiftRight')) && k('KeyD'), // keyboard dodge (locked on)
      jump: k('Space') || b(0),
      boostKey, descendKey,
      lb: b(4), rb: b(5), // bumpers: tap while locked on = dodge L / R; hold (and always when not locked on) = descend / boost
      boost: Math.max(boostKey, b(5) ? 1 : 0),
      descend: Math.max(descendKey, b(4) ? 1 : 0),
      blast: k('KeyF') || bv(7) > 0.5 || (this.mouseBtn.has(0) && !!document.pointerLockElement),
      tackle: k('KeyR') || bv(6) > 0.5 || (this.mouseBtn.has(2) && !!document.pointerLockElement),
      punch: k('KeyX') || k('KeyV') || b(2),
      super: k('KeyB') || b(10), // LS click: sonic boom / super speed while flying
      lock: k('KeyT') || b(11) || this.mouseBtn.has(1), // RS click / T / middle mouse: lock on
      cancel: k('KeyE') || b(1),
      swap: k('Tab') || k('KeyQ') || b(14) || b(15), // D-pad left / right (and a right-stick flick, applied in combat.prepareInput): switch hero
      y: k('KeyZ') || b(3), // Y: slow motion toggle (while grabbed: counter)
      any: b(0) || b(9),
      hud: k('KeyH') || b(8),
      quality: k('KeyG'),
      hasPad: !!gp,
    };
    this.mouseDX = this.mouseDY = 0;
    for (const n of ['jump', 'cancel', 'swap', 'y', 'any', 'hud', 'quality', 'blast', 'tackle', 'punch', 'super', 'lock', 'dodgeL', 'dodgeR', 'lb', 'rb']) { s[n + 'Pressed'] = s[n] && !this.prev[n]; s[n + 'Released'] = !s[n] && this.prev[n]; }
    this.prev = s; this.state = s; return s;
  }
}
