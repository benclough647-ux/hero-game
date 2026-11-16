import * as THREE from 'three';
// Procedural (original, canvas-generated) textures + world-space detail shaders for the realistic city:
// asphalt with lane markings, zebra crossings, stop lines, manholes, drains and patches; paving slabs; grass.
export function rngTex(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function finish(c, srgb = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.flipY = false;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
// per-pixel speckle noise over a region (fast, via ImageData)
function speckle(g, x0, y0, w, h, amp, r) {
  x0 |= 0; y0 |= 0; w |= 0; h |= 0; const img = g.getImageData(x0, y0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amp + (r() < 0.03 ? (r() - 0.5) * amp * 3 : 0); d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.95; }
  g.putImageData(img, x0, y0);
}

// One road tile per city block (BLOCK m square, world-aligned): intersection at [0,ROAD]^2, road bands along both axes.
export function roadTexture(BLOCK, ROAD, SW, S = 2048) {
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), r = rngTex(4242);
  const px = S / BLOCK, M = v => v * px;
  g.fillStyle = '#8e8b85'; g.fillRect(0, 0, S, S); // pavement colour (under the raised slabs; seen on bridges / far away)
  // asphalt bands
  g.fillStyle = '#3b3c3e'; g.fillRect(0, M(SW), S, M(ROAD - 2 * SW)); g.fillRect(M(SW), 0, M(ROAD - 2 * SW), S);
  speckle(g, 0, M(SW), S, M(ROAD - 2 * SW), 34, r); speckle(g, M(SW), 0, M(ROAD - 2 * SW), S, 34, r);
  // the rest is drawn once for the x-running road; the z-running road is the same drawing mirrored across the diagonal
  for (const swap of [false, true]) {
    g.save(); if (swap) g.setTransform(0, 1, 1, 0, 0, 0);
    const y0 = M(SW), y1 = M(ROAD - SW), x0 = M(ROAD), x1 = S; // straight road segment between intersections
    // blotchy repair patches + oil-darkened lane centres + lighter worn tyre tracks
    for (let k = 0; k < 10; k++) { const w = M(2 + r() * 8), h = M(1 + r() * 3); g.fillStyle = `rgba(${r() < 0.5 ? '20,20,22' : '78,78,80'},${0.18 + r() * 0.2})`; g.fillRect(x0 + r() * (x1 - x0 - w), y0 + r() * (y1 - y0 - h), w, h); }
    for (const lc of [ROAD / 2 - 5.6, ROAD / 2 - 2.3, ROAD / 2 + 2.3, ROAD / 2 + 5.6]) {
      const gr = g.createLinearGradient(0, M(lc - 1.1), 0, M(lc + 1.1)); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(10,10,10,.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, M(lc - 1.1), S, M(2.2));
      for (const tt of [-0.8, 0.8]) { g.fillStyle = 'rgba(90,90,92,.10)'; g.fillRect(0, M(lc + tt - 0.25), S, M(0.5)); }
    }
    // cracks
    g.strokeStyle = 'rgba(15,15,15,.55)'; g.lineWidth = 1.2;
    for (let k = 0; k < 14; k++) { let x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0); g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 8; s++) { x += (r() - 0.3) * M(1.2); y += (r() - 0.5) * M(0.8); g.lineTo(x, y); } g.stroke(); }
    // gutters: lighter concrete channel along both kerbs
    g.fillStyle = '#6d6b67'; g.fillRect(0, y0, S, M(0.45)); g.fillRect(0, y1 - M(0.45), S, M(0.45));
    g.fillStyle = 'rgba(30,28,25,.35)'; g.fillRect(0, y0 + M(0.42), S, M(0.06)); g.fillRect(0, y1 - M(0.48), S, M(0.06));
    // markings (slightly worn: painted then speckled out)
    const paint = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    const W = '#e6e3d8', Y = '#d9b23a';
    paint(Y, x0 + M(5), M(ROAD / 2 - 0.27), x1 - x0 - M(10), M(0.12)); paint(Y, x0 + M(5), M(ROAD / 2 + 0.15), x1 - x0 - M(10), M(0.12)); // double yellow
    for (const lc of [ROAD / 2 - 3.95, ROAD / 2 + 3.95]) for (let x = x0 + M(6); x < x1 - M(8); x += M(9)) paint(W, x, M(lc - 0.06), M(3), M(0.12)); // lane dashes
    paint(W, x0 + M(5), y0 + M(0.6), x1 - x0 - M(10), M(0.12)); paint(W, x0 + M(5), y1 - M(0.72), x1 - x0 - M(10), M(0.12)); // edge lines
    // zebra crossings at both ends + stop lines
    for (const cx of [x0 + M(0.8), x1 - M(4.3)]) for (let y = y0 + M(0.7); y < y1 - M(0.9); y += M(1.1)) paint(W, cx, y, M(3.4), M(0.55));
    paint(W, x0 + M(4.8), M(ROAD / 2), M(0.4), y1 - M(ROAD / 2) - M(0.5)); paint(W, x1 - M(5.2), y0 + M(0.5), M(0.4), M(ROAD / 2) - y0 - M(0.5));
    // turn arrows near the stop lines
    g.fillStyle = W; for (const [ax, ay, dir] of [[x0 + M(9), M(ROAD / 2 + 2.3), 1], [x0 + M(9), M(ROAD / 2 + 5.6), 1], [x1 - M(9), M(ROAD / 2 - 2.3), -1], [x1 - M(9), M(ROAD / 2 - 5.6), -1]]) {
      const X = v => ax + dir * M(v); g.fillRect(Math.min(X(-1.6), X(0.2)), ay - M(0.12), M(1.8), M(0.24));
      g.beginPath(); g.moveTo(X(0.2), ay - M(0.42)); g.lineTo(X(1.1), ay); g.lineTo(X(0.2), ay + M(0.42)); g.closePath(); g.fill(); }
    // manholes + drains
    for (let k = 0; k < 3; k++) { const mx = x0 + M(8 + r() * (BLOCK - ROAD - 16)), my = M(ROAD / 2 + (r() < 0.5 ? -1 : 1) * (1.5 + r() * 4)); g.fillStyle = '#26272a'; g.beginPath(); g.arc(mx, my, M(0.38), 0, 7); g.fill(); g.strokeStyle = '#4b4c4f'; g.lineWidth = M(0.05); g.stroke();
      g.strokeStyle = 'rgba(80,80,82,.8)'; g.lineWidth = M(0.03); for (let q = -2; q <= 2; q++) { g.beginPath(); g.moveTo(mx - M(0.3), my + q * M(0.12)); g.lineTo(mx + M(0.3), my + q * M(0.12)); g.stroke(); } }
    for (let x = x0 + M(10); x < x1 - M(8); x += M(22)) for (const yy of [y0 + M(0.05), y1 - M(0.45)]) { g.fillStyle = '#18191a'; g.fillRect(x, yy, M(0.9), M(0.4)); g.fillStyle = '#3e3f41'; for (let q = 0; q < 6; q++) g.fillRect(x + M(0.08 + q * 0.14), yy + M(0.05), M(0.06), M(0.3)); }
    g.restore();
  }
  // re-speckle the paint so markings look worn
  speckle(g, 0, M(SW), S, M(ROAD - 2 * SW), 22, r); speckle(g, M(SW), 0, M(ROAD - 2 * SW), S, 22, r);
  return finish(c, true, 16);
}

// paving slabs, texture covers `size` m
export function pavingTexture(size = 3, S = 512) {
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), r = rngTex(77);
  const n = 5, s = S / n; g.fillStyle = '#5f5d59'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = 150 + (r() - 0.5) * 22 | 0; g.fillStyle = `rgb(${v},${v - 2},${v - 7})`; g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
  speckle(g, 0, 0, S, S, 26, r);
  for (let k = 0; k < 18; k++) { g.fillStyle = `rgba(40,38,35,${0.12 + r() * 0.2})`; g.beginPath(); g.arc(r() * S, r() * S, 1.5 + r() * 4, 0, 7); g.fill(); } // gum / stains
  for (let k = 0; k < 3; k++) { const gr = g.createRadialGradient(0, 0, 0, 0, 0, 60), x = r() * S, y = r() * S; gr.addColorStop(0, 'rgba(60,55,50,.18)'); gr.addColorStop(1, 'rgba(60,55,50,0)'); g.save(); g.translate(x, y); g.fillStyle = gr; g.fillRect(-60, -60, 120, 120); g.restore(); }
  return finish(c);
}
export function grassTexture(S = 256) {
  const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), r = rngTex(5);
  g.fillStyle = '#4a6b2e'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) { const h = 70 + r() * 40, l = 18 + r() * 22; g.fillStyle = `hsla(${h},45%,${l}%,.6)`; g.fillRect(r() * S, r() * S, 1, 2 + r() * 3); }
  return finish(c);
}

// GLSL helpers shared by the detail shaders
export const NOISE_GLSL = `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm2(vec2 p){ return 0.6 * vnoise(p) + 0.3 * vnoise(p * 2.13 + 7.1) + 0.1 * vnoise(p * 4.7 + 3.3); }
`;
// world-space grain + large-scale tone variation + roughness variation (breaks up texture tiling up close and far away)
export function worldDetail(mat, { grain = 0.12, grainScale = 9, tone = 0.12, toneScale = 0.05, rough = 0.08 } = {}) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWD;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vWD = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
      #else
        vWD = (modelMatrix * vec4(position, 1.0)).xyz;
      #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWD;\n' + NOISE_GLSL)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      { vec2 wp = vWD.xz + vWD.y * 0.37;
        float gfade = clamp(1.0 - length(fwidth(wp * ${grainScale.toFixed(2)})) * 0.8, 0.0, 1.0);
        float gr = (vnoise(wp * ${grainScale.toFixed(2)}) - 0.5) * ${grain.toFixed(3)} * gfade;
        float tn = (fbm2(wp * ${toneScale.toFixed(3)}) - 0.5) * ${tone.toFixed(3)};
        diffuseColor.rgb *= 1.0 + gr + tn; roughnessFactor = clamp(roughnessFactor + (vnoise(wp * 0.7) - 0.5) * ${rough.toFixed(3)}, 0.04, 1.0); }`);
  };
  mat.customProgramCacheKey = () => 'wd' + grain + grainScale + tone + toneScale + rough;
  return mat;
}
