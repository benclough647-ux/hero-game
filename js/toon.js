import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
// Anime / cel look (original implementation): stepped toon ramps, rim light, ink outlines
// (screen-space depth edges + inverted-hull outlines on the skinned heroes) and a colour-grade pass.

// 3-tone light ramp (shadow / mid / lit) sampled with nearest filtering -> hard cel bands
function ramp(vals) {
  const d = new Uint8Array(vals.length * 4);
  vals.forEach((v, i) => { d.set([v, v, v, 255], i * 4); });
  const t = new THREE.DataTexture(d, vals.length, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
}
export const RAMP_WORLD = ramp([150, 150, 210, 255, 255]);   // buildings / ground: 3 tones
export const RAMP_HERO = ramp([120, 120, 200, 255, 255, 255]); // heroes: softer shadow band

// rim light: thin bright band on the silhouette (view-space), added after lighting
export function addRim(mat, color = 0xfff2dc, strength = 0.35, width = 0.62) {
  mat.userData.rim = { value: new THREE.Color(color).multiplyScalar(strength) };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uRim = mat.userData.rim;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <opaque_fragment>', `{ float nv = 1.0 - max(dot(normalize(normal), normalize(vViewPosition)), 0.0);
        float rimK = smoothstep(${width.toFixed(2)}, ${(width + 0.06).toFixed(2)}, nv) * (0.55 + 0.45 * max(normalize(normal).y, 0.0));
        outgoingLight += uRim * rimK * (0.4 + 0.6 * diffuseColor.rgb); }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'rim' + width;
  return mat;
}

// Convert a PBR material to a toon one, keeping colour / textures / emissive / flags
export function toToon(m, gradientMap = RAMP_WORLD) {
  if (!m || m.isMeshToonMaterial || m.isShaderMaterial || m.isMeshBasicMaterial || m.userData.keepPBR) return m;
  const t = new THREE.MeshToonMaterial({ gradientMap });
  for (const k of ['color', 'map', 'normalMap', 'normalScale', 'emissive', 'emissiveMap', 'emissiveIntensity', 'alphaMap', 'aoMap', 'transparent', 'opacity', 'side', 'alphaTest', 'vertexColors', 'depthWrite', 'flatShading', 'name']) {
    if (m[k] === undefined) continue;
    if (m[k] && m[k].isColor) t[k].copy(m[k]); else if (m[k] && m[k].isVector2) t[k].copy(m[k]); else t[k] = m[k];
  }
  t.userData = { ...m.userData, fromPBR: true };
  // metals read as brighter flat colour in a toon look
  if (m.metalness > 0.5) t.color.multiplyScalar(1.15);
  return t;
}
export function toonifyObject(obj, gradientMap = RAMP_WORLD, filter = () => true) {
  const cache = new Map();
  obj.traverse(o => {
    if (!o.isMesh || !filter(o)) return;
    const conv = m => { if (!cache.has(m)) cache.set(m, toToon(m, gradientMap)); return cache.get(m); };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

// Inverted-hull ink outline for skinned meshes: back faces pushed out along the normal by a ~constant pixel width
export function outlineMaterial(color = 0x1a1220, px = 2.2) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.userData.px = { value: px }; m.userData.res = OUTLINE_RES;
  m.onBeforeCompile = sh => {
    sh.uniforms.uPx = m.userData.px; sh.uniforms.uRes = OUTLINE_RES;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uPx; uniform vec2 uRes;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          #ifdef USE_SKINNING
            vec3 nO = objectNormal;
          #else
            vec3 nO = normal;
          #endif
          vec3 nV = normalize(normalMatrix * nO);
          vec2 dir = nV.xy; float l = length(dir); dir = l > 1e-4 ? dir / l : vec2(0.0);
          float w = gl_Position.w;
          float shrink = clamp(14.0 / max(w, 1.0), 0.35, 1.0); // thinner when far away
          gl_Position.xy += dir * uPx * shrink * 2.0 / uRes * w;
        }`);
  };
  m.customProgramCacheKey = () => 'inkhull';
  return m;
}
export const OUTLINE_RES = { value: new THREE.Vector2(1280, 720) };
export function addHullOutlines(meshes, color, px) {
  const mat = outlineMaterial(color, px), out = [];
  for (const o of meshes) {
    if (!o.isSkinnedMesh) continue;
    const h = new THREE.SkinnedMesh(o.geometry, mat);
    h.bind(o.skeleton, o.bindMatrix); h.frustumCulled = false; h.castShadow = false; h.receiveShadow = false; h.name = o.name + '_ink';
    h.renderOrder = -1; o.add(h); out.push(h); // child of the source mesh: follows its visibility (LOD switch)
  }
  return { mat, meshes: out };
}

// Screen-space ink: depth discontinuities (silhouettes) + depth creases (2nd derivative) -> dark ink lines,
// faded with distance; then an anime colour grade (saturation / contrast / slight warm-cool split).
export class InkGradePass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera; this.ink = true;
    this.uniforms = { tDiffuse: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.25 }, uFar: { value: 9000 },
      uInk: { value: 1 }, uInkCol: { value: new THREE.Color(0.10, 0.08, 0.16) }, uSat: { value: 1.12 }, uContrast: { value: 1.03 }, uFade: { value: 650 } };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse, tDepth; uniform vec2 uRes; uniform float uNear, uFar, uInk, uSat, uContrast, uFade; uniform vec3 uInkCol; varying vec2 vUv;
        float lin(vec2 uv) { float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          if (uInk > 0.5) {
            vec2 px = 1.0 / uRes;
            float d = lin(vUv);
            float dl = lin(vUv - vec2(px.x, 0.0)), dr = lin(vUv + vec2(px.x, 0.0)), dd = lin(vUv - vec2(0.0, px.y)), du = lin(vUv + vec2(0.0, px.y));
            // silhouettes: nearest neighbour much closer than this pixel (draw on the far side only -> 1px crisp lines)
            float jump = max(max(d - dl, d - dr), max(d - dd, d - du)) / d;
            float sil = smoothstep(0.06, 0.12, jump);
            // creases: second derivative of depth relative to depth (box edges, steps, props)
            // (inverse depth is linear across any plane in screen space, so flat walls/roads give no false lines)
            float w0 = 1.0 / d, lap = (abs(1.0 / dl + 1.0 / dr - 2.0 * w0) + abs(1.0 / dd + 1.0 / du - 2.0 * w0)) / w0;
            float crease = smoothstep(0.012, 0.03, lap) * (1.0 - sil);
            float fade = 1.0 - smoothstep(uFade * 0.55, uFade, d);
            float sky = step(uFar * 0.9, d);
            float e = max(sil, crease * 0.75) * fade * (1.0 - sky);
            c.rgb = mix(c.rgb, c.rgb * uInkCol * 2.2, e);
          }
          // grade (scene is linear HDR here; tone mapping happens in the output pass)
          float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          c.rgb = max(mix(vec3(l), c.rgb, uSat), 0.0);
          c.rgb = pow(c.rgb, vec3(uContrast));
          gl_FragColor = c;
        }` });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  setSize(w, h) { this.uniforms.uRes.value.set(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture; this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.uNear.value = this.camera.near; this.uniforms.uFar.value = this.camera.far; this.uniforms.uInk.value = this.ink && readBuffer.depthTexture ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.fsQuad.render(renderer);
  }
  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}
