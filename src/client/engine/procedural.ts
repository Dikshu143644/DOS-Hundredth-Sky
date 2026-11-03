import * as THREE from 'three';

/** Small deterministic noise + procedural texture toolkit shared by the login sky-castle,
 *  the armory and the weapon models. Everything here is generated in code (no image assets). */

export function hash3(x: number, y: number, z: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = (t: number) => t * t * (3 - 2 * t);
export function vnoise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf), zf) * 2 - 1;
}
export function fbm(x: number, y: number, z: number, oct = 4) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}
/** Ridged/billowy noise: rounded lumps, good for boulder-like rock silhouettes. */
export function billow(x: number, y: number, z: number, oct = 4) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(vnoise(x * f, y * f, z * f))); f *= 2.1; a *= 0.5; }
  return s;
}
export function mulberry(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Crisp 4-point star glint with a tight core (no fuzzy blob). */
let _spark: THREE.Texture | null = null;
export function sparkTex() {
  return (_spark ??= canvasTex(128, 128, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.16);
    core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.35, 'rgba(255,255,255,0.55)'); core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for (const [len, wid, rot] of [[0.5, 0.035, 0], [0.5, 0.035, Math.PI / 2], [0.26, 0.02, Math.PI / 4], [0.26, 0.02, -Math.PI / 4]]) {
      g.save(); g.translate(cx, cy); g.rotate(rot);
      const lg = g.createLinearGradient(-w * len, 0, w * len, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.beginPath(); g.ellipse(0, 0, w * len, w * wid, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }, false));
}
/** Small hard-edged round mote (bright centre, quick falloff). */
let _dot: THREE.Texture | null = null;
export function dotTex() {
  return (_dot ??= canvasTex(64, 64, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.18, 'rgba(255,255,255,0.95)'); r.addColorStop(0.32, 'rgba(255,255,255,0.25)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  }, false));
}
/** Soft wide glow (for halos/flares only, never as a particle body). */
let _glow: THREE.Texture | null = null;
export function glowTex() {
  return (_glow ??= canvasTex(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,255,255,0.45)'); r.addColorStop(0.5, 'rgba(255,255,255,0.1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  }, false));
}

/** A strip of angular runes (white on black) — used as an emissive mask on blades and halo rings. */
export function runeStripTex(seed = 7, cells = 24, w = 1024, h = 64): THREE.CanvasTexture {
  const rnd = mulberry(seed);
  const t = canvasTex(w, h, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const cw = w / cells;
    g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < cells; i++) {
      const x0 = i * cw + cw * 0.22, x1 = (i + 1) * cw - cw * 0.22, y0 = h * 0.2, y1 = h * 0.8, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      g.lineWidth = Math.max(2, h * 0.07);
      g.beginPath();
      g.moveTo(xm, y0); g.lineTo(xm, y1); // stave
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const ya = y0 + (y1 - y0) * rnd(), side = rnd() < 0.5 ? x0 : x1, yb = ya + (rnd() - 0.5) * (y1 - y0) * 0.8;
        g.moveTo(xm, ya); g.lineTo(side, Math.min(y1, Math.max(y0, yb)));
      }
      if (rnd() < 0.35) { g.moveTo(x0, ym); g.lineTo(x1, ym - (y1 - y0) * 0.2); }
      g.stroke();
      if (rnd() < 0.3) { g.beginPath(); g.arc(xm, y0 - h * 0.05, h * 0.05, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); }
    }
  }, false);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Shared atmosphere uniforms: aerial perspective with height falloff and a sun-facing tint
 *  (Mie forward scattering approximation), applied to every lit material of a scene. */
export interface Atmos {
  uFogColor: { value: THREE.Color }; uSunFogColor: { value: THREE.Color }; uSunDir: { value: THREE.Vector3 };
  uFogDensity: { value: number }; uFogHeight: { value: number }; uFogFalloff: { value: number };
}
export function makeAtmos(): Atmos {
  return {
    uFogColor: { value: new THREE.Color(0.62, 0.7, 0.8) }, uSunFogColor: { value: new THREE.Color(1.6, 1.45, 1.2) }, uSunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
    uFogDensity: { value: 0.0016 }, uFogHeight: { value: 0 }, uFogFalloff: { value: 0.004 },
  };
}
export function applyAtmos(mat: THREE.Material, A: Atmos) {
  if ((mat as any).__atmos) return;
  (mat as any).__atmos = true;
  (mat as any).fog = false;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, A);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAtmW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 aw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            aw = instanceMatrix * aw;
          #endif
          vAtmW = (modelMatrix * aw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vAtmW; uniform vec3 uFogColor; uniform vec3 uSunFogColor; uniform vec3 uSunDir; uniform float uFogDensity; uniform float uFogHeight; uniform float uFogFalloff;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        { vec3 dv = vAtmW - cameraPosition; float d = length(dv); vec3 v = dv / max(d, 1e-3);
          float hf = exp(-max(vAtmW.y - uFogHeight, 0.0) * uFogFalloff);
          float fa = 1.0 - exp(-d * uFogDensity * (0.3 + 0.7 * hf));
          float s = pow(max(dot(v, uSunDir), 0.0), 9.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(uFogColor, uSunFogColor, s), fa); }`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + '|atmos';
  mat.needsUpdate = true;
}

/** Animated GPU particle field: positions/phases live in attributes, motion is computed in the
 *  vertex shader (no per-frame CPU work), sprites are crisp sparkles with additive blending. */
export function sparkleField(o: { count: number; box: THREE.Box3; color: THREE.Color | number; size: number; rise?: number; swirl?: number; tex?: THREE.Texture; twinkle?: number; colorJitter?: number; seed?: number; opacity?: number }) {
  const rnd = mulberry(o.seed ?? 3);
  const n = o.count, pos = new Float32Array(n * 3), ph = new Float32Array(n * 4);
  const s = new THREE.Vector3(); o.box.getSize(s);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = o.box.min.x + rnd() * s.x; pos[i * 3 + 1] = o.box.min.y + rnd() * s.y; pos[i * 3 + 2] = o.box.min.z + rnd() * s.z;
    ph[i * 4] = rnd() * 100; ph[i * 4 + 1] = 0.35 + rnd() * 0.9; ph[i * 4 + 2] = rnd(); ph[i * 4 + 3] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPh', new THREE.BufferAttribute(ph, 4));
  g.boundingSphere = new THREE.Sphere(o.box.getCenter(new THREE.Vector3()), s.length());
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uTex: { value: o.tex ?? sparkTex() }, uColor: { value: new THREE.Color(o.color as any) }, uSize: { value: o.size },
      uMin: { value: o.box.min.clone() }, uSz: { value: s.clone() }, uRise: { value: o.rise ?? 0.2 }, uSwirl: { value: o.swirl ?? 0.4 },
      uTw: { value: o.twinkle ?? 1 }, uJit: { value: o.colorJitter ?? 0.15 }, uOpacity: { value: o.opacity ?? 1 }, uPx: { value: 1 },
    },
    vertexShader: `
      attribute vec4 aPh; uniform float uTime, uSize, uRise, uSwirl, uTw, uPx; uniform vec3 uMin, uSz;
      varying float vA; varying float vJ;
      void main(){
        vec3 p = position;
        float t = uTime * aPh.y + aPh.x;
        p.y = uMin.y + mod(p.y - uMin.y + uTime * uRise * aPh.y, uSz.y);
        p.x += sin(t * 0.7) * uSwirl; p.z += cos(t * 0.53) * uSwirl;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = mix(1.0, 0.5 + 0.5 * sin(t * 3.1), uTw);
        float edge = smoothstep(0.0, 0.12, (p.y - uMin.y) / uSz.y) * smoothstep(1.0, 0.82, (p.y - uMin.y) / uSz.y);
        vA = tw * edge; vJ = aPh.z;
        gl_PointSize = uSize * uPx * (0.55 + aPh.w * 0.9) * (300.0 / -mv.z) * (0.75 + 0.25 * tw);
      }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform vec3 uColor; uniform float uJit, uOpacity; varying float vA; varying float vJ;
      void main(){
        vec4 tx = texture2D(uTex, gl_PointCoord);
        vec3 c = uColor * (1.0 + (vJ - 0.5) * uJit * 2.0);
        gl_FragColor = vec4(c * tx.rgb * tx.a * vA * uOpacity, 1.0);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}
