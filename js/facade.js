import * as THREE from 'three';
import { NOISE_GLSL } from './citytex.js';
// Realistic procedural facades for the instanced building boxes (GTA-style downtown):
// style 0 glass curtain wall, 1 concrete office (ribbon windows), 2 brick walk-up (punched windows, sills, lintels),
// 3 painted stucco. Window grids are laid out per face from the building corner (so bays are centred and corners get
// pilasters), ground floors become shopfronts with sign bands, plus brick bond, panel joints, weathering streaks,
// window recess bump-shading, blinds / lit interiors and tar-membrane roofs. Per-instance attribute aBld = (style, seed).
export function facadeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec2 aBld; varying vec3 vWPos; varying vec3 vWN; varying vec3 vLoc; varying vec3 vScl; varying float vStyle; varying float vSeed; varying float vBaseY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 fM = modelMatrix;
        #ifdef USE_INSTANCING
          fM = modelMatrix * instanceMatrix;
          vScl = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #else
          vScl = vec3(1.0);
        #endif
        vLoc = position; vStyle = aBld.x; vSeed = aBld.y; vBaseY = (fM * vec4(0.0, 0.0, 0.0, 1.0)).y;
        vWPos = (fM * vec4(position, 1.0)).xyz; vWN = normalize(mat3(fM) * normal);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPos; varying vec3 vWN; varying vec3 vLoc; varying vec3 vScl; varying float vStyle; varying float vSeed; varying float vBaseY;
      ${NOISE_GLSL}
      float rectA(vec2 f, vec2 lo, vec2 hi, vec2 aa) { vec2 a = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f)); return a.x * a.y; }
      vec3 signCol(float r) { return r < 0.17 ? vec3(0.45, 0.04, 0.03) : r < 0.33 ? vec3(0.03, 0.18, 0.08) : r < 0.5 ? vec3(0.03, 0.05, 0.2) : r < 0.66 ? vec3(0.6, 0.45, 0.05) : r < 0.83 ? vec3(0.02, 0.02, 0.02) : vec3(0.7, 0.68, 0.62); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 n = normalize(vWN);
        float isRoof = step(0.6, n.y);
        bool xFace = abs(n.x) > 0.5;
        float faceW = xFace ? vScl.z : vScl.x;
        float uf = (xFace ? vLoc.z : vLoc.x) * faceW + faceW * 0.5;
        float y = vWPos.y, baseY = vBaseY, topY = vBaseY + vScl.y;
        int st = int(vStyle + 0.5); float sd = vSeed;
        vec3 wallC = diffuseColor.rgb, c = wallC;
        float margin, bw, fh, topBand; vec2 lo, hi;
        if (st == 0) { margin = 0.0; bw = 1.5 + 0.4 * fract(sd * 3.7); fh = 3.8; topBand = 1.3; lo = vec2(0.04, 0.16); hi = vec2(0.96, 0.98); }
        else if (st == 1) { margin = 0.9; bw = 1.6 + 0.3 * fract(sd * 2.3); fh = 3.6; topBand = 1.7; lo = vec2(0.0, 0.36); hi = vec2(1.0, 0.92); }
        else if (st == 2) { margin = 1.0; bw = 2.5 + 0.5 * fract(sd * 5.1); fh = 3.3; topBand = 1.6; lo = vec2(0.28, 0.24); hi = vec2(0.72, 0.82); }
        else { margin = 0.8; bw = 2.7 + 0.4 * fract(sd * 4.3); fh = 3.2; topBand = 1.5; lo = vec2(0.3, 0.22); hi = vec2(0.7, 0.8); }
        float GF = baseY < 0.5 ? 4.8 : 0.0;
        float nb = max(1.0, floor((faceW - 2.0 * margin) / bw)); float bwa = (faceW - 2.0 * margin) / nb;
        vec2 cell = vec2((uf - margin) / bwa, (y - baseY - GF) / fh);
        vec2 id = floor(cell), f = fract(cell);
        vec2 aa = fwidth(cell) * 0.8 + 1e-4;
        float fadeFar = clamp(length(fwidth(cell)) * 3.0 - 0.2, 0.0, 1.0); // 0 close up .. 1 when a window is a few pixels
        float inGrid = step(0.0, cell.x) * step(cell.x, nb) * step(0.0, cell.y) * step(y, topY - topBand);
        float win = rectA(f, lo, hi, aa) * inGrid;
        // far away: blend the window mask toward its average coverage (no moire / salt-and-pepper on distant towers)
        win = mix(win, (hi.x - lo.x) * (hi.y - lo.y) * inGrid, fadeFar * 0.85);
        float faceId = xFace ? sign(n.x) * 3.0 : sign(n.z) * 7.0;
        float r = mix(0.5, h21(id + vec2(floor(sd * 977.0) + faceId, faceId * 1.7)), 1.0 - 0.75 * fadeFar);
        float trim = 0.0, sgn = 0.0, Hh = 0.0; vec3 signC = vec3(0.0);
        // wall material
        if (st == 2) { // brick bond (fades out with distance to avoid shimmer)
          vec2 bp = vec2(uf / 0.225, y / 0.075); bp.x += 0.5 * mod(floor(bp.y), 2.0);
          vec2 baa = fwidth(bp) * 0.8 + 1e-4; float brick = rectA(fract(bp), vec2(0.05, 0.12), vec2(0.95, 0.88), baa);
          float bf = clamp(1.0 - length(fwidth(bp)) * 0.9, 0.0, 1.0);
          c *= mix(1.0, mix(1.18, 0.82 + 0.3 * h21(floor(bp)), brick), bf);
          trim = rectA(f, vec2(lo.x - 0.05, lo.y - 0.06), vec2(hi.x + 0.05, lo.y), aa) + rectA(f, vec2(lo.x - 0.03, hi.y), vec2(hi.x + 0.03, hi.y + 0.07), aa);
          trim *= inGrid;
        } else if (st == 1) { // precast panels: joints at bays and floor lines
          vec2 jaa = aa * 1.5;
          float jy = 1.0 - smoothstep(0.0, 0.015 + jaa.y, min(f.y, 1.0 - f.y));
          c *= 1.0 - 0.18 * max(jy, 0.0) * inGrid * (1.0 - fadeFar);
          c *= 0.92 + 0.16 * vnoise(vec2(uf, y) * 0.8);
        } else if (st == 3) { // painted render with window surrounds
          c *= 0.9 + 0.2 * fbm2(vec2(uf, y) * 0.6);
          trim = (rectA(f, lo - vec2(0.05, 0.05), hi + vec2(0.05, 0.05), aa) - rectA(f, lo, hi, aa)) * inGrid;
        } else { // curtain wall: spandrels / mullions in a metal frame colour
          c = mix(vec3(0.07, 0.075, 0.08), vec3(0.5, 0.52, 0.54), step(0.55, fract(sd * 9.1)));
        }
        vec3 trimC = mix(wallC, vec3(0.78, 0.76, 0.72), 0.65);
        c = mix(c, trimC, clamp(trim, 0.0, 1.0));
        Hh += trim * 0.06;
        // ground floor: shopfronts / lobby
        if (y < GF) {
          float sb0 = st == 0 ? 3.0 : 5.0;
          float ns = max(1.0, floor((faceW - 1.2) / sb0)); float sbw = (faceW - 1.2) / ns;
          vec2 sc = vec2((uf - 0.6) / sbw, y); float sid = floor(sc.x); vec2 sp = vec2(fract(sc.x), y);
          float sIn = step(0.0, sc.x) * step(sc.x, ns);
          vec2 saa = vec2(fwidth(sc.x), fwidth(y)) * 0.8 + 1e-4;
          float rs = h21(vec2(sid + faceId * 13.0, floor(sd * 311.0)));
          r = rs;
          if (st == 0) { win = rectA(sp, vec2(0.02, 0.15), vec2(0.98, GF - 0.4), saa) * sIn; c = vec3(0.12, 0.12, 0.13); }
          else {
            c = mix(wallC * 0.5 + 0.04, vec3(0.16, 0.15, 0.14), 0.5);
            win = rectA(sp, vec2(0.08, 0.5), vec2(0.92, 3.05), saa) * sIn;
            float door = rectA(sp, vec2(0.62, 0.0), vec2(0.82, 2.6), saa) * step(0.5, rs) * sIn;
            win = max(win, door);
            sgn = rectA(sp, vec2(0.04, 3.3), vec2(0.96, 4.25), saa) * sIn;
            signC = signCol(fract(rs * 7.3));
            float frame = rectA(sp, vec2(0.06, 0.46), vec2(0.94, 3.1), saa) * sIn - win;
            c = mix(c, vec3(0.05), clamp(frame, 0.0, 1.0));
          }
        }
        // weathering: soot streaks running down, darker near the pavement
        float streak = vnoise(vec2(uf * 0.9 + sd * 40.0, y * 0.06)) * vnoise(vec2(uf * 0.23, y * 0.015 + sd * 9.0));
        c *= 1.0 - 0.3 * streak * (st == 0 ? 0.3 : 1.0);
        if (baseY < 0.5) c *= mix(0.7, 1.0, smoothstep(0.0, 2.5, y));
        // glass
        vec3 glassC = st == 0 ? wallC * (0.55 + 0.35 * r) : vec3(0.16, 0.19, 0.22) * (0.7 + 0.6 * r);
        float blinds = (1.0 - fadeFar * 0.8) * step(0.7, r) * step(1.0 - (0.2 + 0.6 * fract(r * 13.0)), f.y) * (y < GF ? 0.0 : 1.0);
        vec3 blindC = mix(vec3(0.62, 0.6, 0.55), vec3(0.4, 0.38, 0.35), fract(r * 31.0));
        float shopInt = y < GF ? 1.0 : 0.0;
        glassC = mix(glassC, blindC, blinds * (st == 0 ? 0.35 : 0.8));
        glassC = mix(glassC, vec3(0.05, 0.045, 0.04), shopInt * 0.8);
        // reveal shadow at the top of each recessed window
        glassC *= mix(1.0, 0.55, smoothstep(hi.y - 0.2, hi.y, f.y) * (st == 0 ? 0.0 : 1.0) * (1.0 - shopInt));
        c = mix(c, glassC, win);
        float rough = mix(st == 0 ? 0.35 : st == 1 ? 0.8 : 0.88, mix(mix(0.05 + 0.12 * r * r, 0.7, blinds), 0.22, shopInt), win);
        float metal = mix(st == 0 ? 0.7 : 0.0, mix(st == 0 ? 0.95 : 0.85, 0.1, blinds) * (1.0 - shopInt * 0.75), win);
        // shop signs
        c = mix(c, signC, sgn); rough = mix(rough, 0.4, sgn); metal = mix(metal, 0.2, sgn);
        Hh -= win * 0.12 * (st == 0 ? 0.3 : 1.0); Hh += sgn * 0.1;
        // lit interiors (subtle in daylight)
        // shop interiors: warm lit, with shelves / displays suggested by banded noise
        float shelves = st == 0 ? 0.25 : 0.45 + 0.55 * vnoise(vec2(uf * 1.7, floor(y * 2.2) * 3.1 + sd * 50.0)) * step(0.3, fract(y * 2.2));
        float lit = step(0.9, r) * win * (1.0 - blinds) + shopInt * win * shelves * 0.55;
        vec3 em = lit * mix(vec3(1.0, 0.75, 0.45), vec3(0.75, 0.85, 1.0), step(0.5, fract(r * 7.0))) * 0.3 + signC * sgn * 0.5;
        if (isRoof > 0.5) { // tar / membrane roof with patches; glass towers get a pale concrete deck
          vec2 rp = vWPos.xz; float nn = fbm2(rp * 0.35);
          c = (st == 0 ? vec3(0.34, 0.34, 0.33) : vec3(0.16, 0.16, 0.155)) * (0.8 + 0.4 * nn);
          c *= 0.9 + 0.18 * step(0.55, vnoise(rp * 0.15 + sd * 10.0));
          rough = 0.95; metal = 0.0; em = vec3(0.0); Hh = 0.0;
        }
        diffuseColor.rgb = c; roughnessFactor = rough; metalnessFactor = metal; totalEmissiveRadiance += em;
        // bump: window recesses / sills / signs give real light-and-shadow edges (fades at distance)
        float bs = 1.0 - fadeFar;
        if (bs > 0.01) {
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx); float det = dot(sx, R1);
          vec3 grad = sign(det) * (dFdx(Hh) * R1 + dFdy(Hh) * R2) * bs;
          normal = normalize(abs(det) * normal - grad);
        }
      }`);
  };
  mat.customProgramCacheKey = () => 'facade-v2';
  return mat;
}
