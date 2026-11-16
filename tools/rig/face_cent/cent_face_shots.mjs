import { chromium } from 'playwright-core';
const tag = process.argv[2] || 'x'; const azs = (process.argv[3] || '0,0.7,1.5708').split(',').map(Number);
const names = (process.argv[4] || 'front,34,side').split(',');
const OUT = '/workspace/hero-game/screenshots/cent_face';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:47420/?shot&q=1&nocache=' + Date.now(), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 120000 });
await page.evaluate((hero) => { const g = window.__game, T = g.THREE; g.begin(); g.setPaused(true); g.combat.aiOff = true;
  if (g.active.key !== hero) g.switchHero();
  const P = g.active, E = g.enemy, p = P.pos.clone(); g.combat.reset(P, p); g.combat.reset(E, p.clone().add(new T.Vector3(60, 0, 0))); P.state = 'ground'; P.yaw = Math.PI / 2;
  const base = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, jump: false, boost: 0, descend: 0 };
  for (let i = 0; i < 60; i++) { g.combatFrame(1 / 60, base); g.step(1 / 60, 1 / 60, true); }
}, process.env.HERO || 'tiger');
for (let i = 0; i < azs.length; i++) {
  await page.evaluate(([az, ty, cy, dd]) => { const g = window.__game, T = g.THREE, P = g.active; P.rig.root.updateMatrixWorld(true);
    const h = P.anim.B('head').getWorldPosition(new T.Vector3()); h.y += ty * P.def.height / 1.83;
    const a = P.yaw + az, d = dd * P.def.height / 1.83; g.camera.position.set(h.x + Math.sin(a) * d, h.y + cy, h.z + Math.cos(a) * d); g.camera.lookAt(h); g.camera.fov = 40; g.camera.updateProjectionMatrix(); g.render(); }, [azs[i], +(process.env.TY||0.15), +(process.env.CY||0.02), +(process.env.DD||0.85)]);
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: `${OUT}/${tag}_${names[i]}.png` }); console.log('shot', `${OUT}/${tag}_${names[i]}.png`);
}
console.log('ERRORS', errors.length ? errors : 'none'); await browser.close();
