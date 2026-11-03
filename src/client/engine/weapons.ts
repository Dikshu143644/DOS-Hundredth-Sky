import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTex, mulberry, sparkleField, sparkTex, dotTex, glowTex, runeStripTex } from './procedural';

/** Legendary weapons, modelled in code as PBR meshes: faceted blades with emissive rune / crack
 *  masks, metal guards, wrapped grips, gems, plus a GPU particle aura and a light per weapon.
 *  Every weapon is built pointing +Y with the grip centre at the origin (so a hand socket can hold
 *  it directly) and measures about 1.1–1.6 m like a real weapon. */

export type WeaponModel = 'frost' | 'ignis' | 'umbra' | 'aether' | 'sol' | 'skyreach' | 'iron_sword' | 'oak_staff' | 'hunter_bow' | 'steel_daggers' | 'war_axe';
export interface WeaponFX { group: THREE.Group; update(t: number, dt: number): void; light: THREE.PointLight | null; aura: THREE.Points[]; glow: THREE.Color; length: number; setAura(on: boolean): void }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Faceted blade: an 8-point lozenge cross-section (edge bevels + central ridge) swept along +Y,
 *  flat-shaded so every facet catches light. u runs across the blade, v along it. */
export function bladeGeometry(o: { len: number; width: number; thick: number; tip: number; widthFn?: (v: number) => number; curve?: (v: number) => number; rows?: number }) {
  const rows = o.rows ?? 40;
  const sec = [[-1, 0], [-0.7, 0.55], [0, 1], [0.7, 0.55], [1, 0], [0.7, -0.55], [0, -1], [-0.7, -0.55]];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const tipK = v > 1 - o.tip ? Math.pow((1 - v) / o.tip, 0.85) : 1;
    const w = o.width * (o.widthFn ? o.widthFn(v) : 1) * tipK, t = o.thick * (0.35 + 0.65 * tipK) * (o.widthFn ? Math.min(1, o.widthFn(v) * 1.1) : 1);
    const off = o.curve ? o.curve(v) : 0;
    for (const [sx, sz] of sec) { pos.push(sx * w + off, v * o.len, sz * t); uv.push((sx + 1) / 2, v); }
  }
  const n = sec.length;
  for (let r = 0; r < rows; r++) for (let k = 0; k < n; k++) {
    const a = r * n + k, b = r * n + ((k + 1) % n), c = (r + 1) * n + k, d = (r + 1) * n + ((k + 1) % n);
    idx.push(a, b, d, a, d, c);
  }
  const base = pos.length / 3; pos.push(0, 0, 0); uv.push(0.5, 0);
  for (let k = 0; k < n; k++) idx.push(base, (k + 1) % n, k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const ni = g.toNonIndexed();
  ni.computeVertexNormals();
  return ni;
}

function grip(len: number, r: number, _mat?: THREE.Material) {
  const pts: THREE.Vector2[] = [];
  const rings = 14;
  for (let i = 0; i <= rings * 4; i++) { const y = (i / (rings * 4)) * len; const k = (i % 4) / 4; pts.push(new THREE.Vector2(r * (0.94 + 0.06 * Math.sin(k * Math.PI)), y - len / 2)); }
  return new THREE.LatheGeometry(pts, 16);
}

const M = {
  steel: () => new THREE.MeshPhysicalMaterial({ color: 0xc7ccd4, metalness: 1, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
  silver: () => new THREE.MeshPhysicalMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.16, clearcoat: 0.8 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x24262c, metalness: 1, roughness: 0.32 }),
  gold: () => new THREE.MeshPhysicalMaterial({ color: 0xf0c060, metalness: 1, roughness: 0.18, clearcoat: 0.5 }),
  leather: (c = 0x3b2417) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.78, metalness: 0, map: wrapTex() }),
  gem: (c: number, e: number, k = 2.5) => new THREE.MeshPhysicalMaterial({ color: c, emissive: e, emissiveIntensity: k, roughness: 0.04, metalness: 0, clearcoat: 1, iridescence: 0.4 }),
};

let _wrap: THREE.Texture | null = null;
function wrapTex() {
  return (_wrap ??= (() => {
    const t = canvasTex(64, 256, (g, w, h) => {
      g.fillStyle = '#bbb'; g.fillRect(0, 0, w, h);
      for (let y = -w; y < h + w; y += 16) { g.strokeStyle = '#555'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + w * 0.5); g.stroke(); g.strokeStyle = '#eee'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y + 4); g.lineTo(w, y + 4 + w * 0.5); g.stroke(); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })());
}

/** Emissive masks drawn in code (white = glowing). Width = across the blade, height = along it. */
function frostMask() {
  const rnd = mulberry(41);
  return canvasTex(256, 1024, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const core = g.createLinearGradient(0, 0, w, 0);
    core.addColorStop(0, 'rgba(255,255,255,0.02)'); core.addColorStop(0.42, 'rgba(255,255,255,0.12)'); core.addColorStop(0.5, 'rgba(255,255,255,0.7)'); core.addColorStop(0.58, 'rgba(255,255,255,0.12)'); core.addColorStop(1, 'rgba(255,255,255,0.02)');
    g.fillStyle = core; g.fillRect(0, 0, w, h);
    // crystalline fracture lines branching from the core
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      let x = w / 2 + (rnd() - 0.5) * 20, y = rnd() * h; g.lineWidth = 1 + rnd() * 2.2; g.beginPath(); g.moveTo(x, y);
      const dir = rnd() < 0.5 ? -1 : 1;
      for (let k = 0; k < 4; k++) { x += dir * (10 + rnd() * 30); y += (rnd() - 0.6) * 60; g.lineTo(x, y); }
      g.stroke();
    }
    // edge frost
    const ed = g.createLinearGradient(0, 0, w, 0); ed.addColorStop(0, 'rgba(255,255,255,0.8)'); ed.addColorStop(0.06, 'rgba(255,255,255,0)'); ed.addColorStop(0.94, 'rgba(255,255,255,0)'); ed.addColorStop(1, 'rgba(255,255,255,0.8)');
    g.fillStyle = ed; g.fillRect(0, 0, w, h);
  }, false);
}
function lavaMask() {
  const rnd = mulberry(77);
  return canvasTex(256, 1024, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    // jagged molten cracks: random walks branching along the blade
    g.lineCap = 'round'; g.lineJoin = 'round';
    const walk = (x: number, y: number, len: number, width: number, depth: number) => {
      g.lineWidth = width; g.strokeStyle = `rgba(255,255,255,${0.55 + rnd() * 0.45})`; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < len; k++) {
        x += (rnd() - 0.5) * 34; y += 10 + rnd() * 26; x = Math.max(4, Math.min(w - 4, x)); g.lineTo(x, y);
        if (depth < 2 && rnd() < 0.18) { g.stroke(); walk(x, y, 4 + Math.floor(rnd() * 6), width * 0.6, depth + 1); g.beginPath(); g.moveTo(x, y); }
      }
      g.stroke();
    };
    for (let i = 0; i < 9; i++) walk(w * (0.25 + rnd() * 0.5), rnd() * h * 0.6, 14 + Math.floor(rnd() * 16), 3 + rnd() * 3.5, 0);
    g.filter = 'blur(4px)'; g.globalAlpha = 0.6; g.globalCompositeOperation = 'lighter'; g.drawImage(g.canvas, 0, 0); g.filter = 'none'; g.globalAlpha = 1;
    // glowing edge line
    const ed = g.createLinearGradient(0, 0, w, 0); ed.addColorStop(0, 'rgba(255,255,255,0.7)'); ed.addColorStop(0.05, 'rgba(255,255,255,0)'); ed.addColorStop(0.95, 'rgba(255,255,255,0)'); ed.addColorStop(1, 'rgba(255,255,255,0.7)');
    g.fillStyle = ed; g.fillRect(0, 0, w, h);
  }, false);
}
function runeFullerMask(seed: number, bright = 1) {
  const runes = runeStripTex(seed, 14, 1024, 96).image as HTMLCanvasElement;
  return canvasTex(256, 1024, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h * 0.04); g.rotate(Math.PI / 2); g.globalAlpha = bright; g.drawImage(runes, 0, -w * 0.11, h * 0.62, w * 0.22); g.restore();
    const ed = g.createLinearGradient(0, 0, w, 0); ed.addColorStop(0, 'rgba(255,255,255,0.35)'); ed.addColorStop(0.04, 'rgba(255,255,255,0)'); ed.addColorStop(0.96, 'rgba(255,255,255,0)'); ed.addColorStop(1, 'rgba(255,255,255,0.35)');
    g.fillStyle = ed; g.fillRect(0, 0, w, h);
  }, false);
}

/** A true crescent ("moon blade"): the outer circle (radius R) minus a circle of radius r shifted
 *  back by d. Thickest at +x, tapering to two needle tips where the circles cross. */
function crescentShape(R: number, r: number, d: number) {
  const x = (r * r - R * R - d * d) / (2 * d);
  const y = Math.sqrt(Math.max(0, R * R - x * x));
  const aOut = Math.atan2(y, x), aIn = Math.atan2(y, x + d);
  const s = new THREE.Shape();
  s.moveTo(Math.cos(-aOut) * R, Math.sin(-aOut) * R);
  s.absarc(0, 0, R, -aOut, aOut, false);
  s.absarc(-d, 0, r, aIn, -aIn, true);
  s.closePath();
  return { shape: s, tip: aOut };
}

function addAura(group: THREE.Group, o: { color: THREE.Color; count: number; box: THREE.Box3; size: number; rise: number; swirl: number; tex?: THREE.Texture; seed: number }) {
  const p = sparkleField({ count: o.count, box: o.box, color: o.color, size: o.size, rise: o.rise, swirl: o.swirl, tex: o.tex, seed: o.seed, twinkle: 1, colorJitter: 0.35 });
  group.add(p);
  return p;
}

export function buildWeapon(model: WeaponModel, o: { aura?: boolean; light?: boolean; quality?: 'low' | 'medium' | 'high' | 'ultra' } = {}): WeaponFX {
  const G = new THREE.Group(); G.name = 'weapon:' + model;
  const aura: THREE.Points[] = [];
  const auraOn = o.aura !== false;
  const lowQ = o.quality === 'low';
  const n = (k: number) => (lowQ ? Math.round(k * 0.35) : k);
  let light: THREE.PointLight | null = null;
  let glow = new THREE.Color(1, 1, 1);
  let length = 1.1;
  const updaters: ((t: number, dt: number) => void)[] = [];
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; G.add(m); return m; };

  if (model === 'frost') {
    glow = new THREE.Color(0.35, 0.8, 1.0);
    const blade = new THREE.MeshPhysicalMaterial({ color: 0x3b6e9e, metalness: 0.45, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.6, iridescenceIOR: 1.6, emissive: new THREE.Color(0.25, 0.75, 1.0), emissiveMap: frostMask(), emissiveIntensity: 1.5 });
    mk(bladeGeometry({ len: 1.02, width: 0.062, thick: 0.014, tip: 0.2, widthFn: (v) => 1 + 0.18 * Math.sin(v * Math.PI) }), blade).position.y = 0.16;
    // ice crystal crossguard: silver bar + crystal spikes sweeping toward the blade
    const silver = M.silver();
    const bar = new THREE.Shape(); bar.moveTo(-0.17, 0.0); bar.quadraticCurveTo(0, -0.03, 0.17, 0); bar.lineTo(0.2, 0.05); bar.quadraticCurveTo(0, 0.03, -0.2, 0.05); bar.closePath();
    const barG = new THREE.ExtrudeGeometry(bar, { depth: 0.04, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 }).translate(0, 0.1, -0.02);
    mk(barG, silver);
    const ice = M.gem(0xaee8ff, 0x3ab0ff, 1.8);
    const spike = new THREE.OctahedronGeometry(1, 0).scale(0.022, 0.11, 0.022);
    for (const [x, y, rz] of [[-0.21, 0.17, 0.5], [0.21, 0.17, -0.5], [-0.15, 0.2, 0.25], [0.15, 0.2, -0.25], [-0.26, 0.12, 1.0], [0.26, 0.12, -1.0]] as [number, number, number][]) { const s = mk(spike, ice); s.position.set(x, y, 0); s.rotation.z = rz; }
    const gem = mk(new THREE.IcosahedronGeometry(0.028, 0), M.gem(0x7fdcff, 0x2fa8ff, 4)); gem.position.set(0, 0.125, 0.03);
    mk(grip(0.2, 0.018, M.leather(0x1d2a3a)), M.leather(0x1d2a3a)).position.y = -0.02;
    const pom = mk(new THREE.OctahedronGeometry(0.03, 0).scale(1, 1.5, 1), ice); pom.position.y = -0.15;
    length = 1.2;
    if (auraOn) {
      aura.push(addAura(G, { color: new THREE.Color(1.2, 2.4, 3.2), count: n(160), box: new THREE.Box3(new THREE.Vector3(-0.35, -0.2, -0.35), new THREE.Vector3(0.35, 1.35, 0.35)), size: 0.18, rise: 0.08, swirl: 0.08, seed: 3 }));
      aura.push(addAura(G, { color: new THREE.Color(2.4, 3.0, 3.4), count: n(50), box: new THREE.Box3(new THREE.Vector3(-0.6, -0.1, -0.6), new THREE.Vector3(0.6, 1.5, 0.6)), size: 0.22, rise: -0.05, swirl: 0.15, seed: 4 }));
    }
    updaters.push((t) => { blade.emissiveIntensity = 1.35 + 0.25 * Math.sin(t * 1.7); });
  } else if (model === 'ignis') {
    glow = new THREE.Color(1.0, 0.3, 0.08);
    const blade = new THREE.MeshPhysicalMaterial({ color: 0x1c1512, metalness: 0.7, roughness: 0.36, clearcoat: 0.4, emissive: new THREE.Color(1.0, 0.2, 0.03), emissiveMap: lavaMask(), emissiveIntensity: 3.0 });
    mk(bladeGeometry({ len: 1.08, width: 0.078, thick: 0.015, tip: 0.16, widthFn: (v) => 1.05 - v * 0.25 + 0.12 * Math.sin(v * 9) * (1 - v) }), blade).position.y = 0.16;
    // flame-horn crossguard in dark iron with ember-orange edges
    const iron = M.dark(); iron.color.set(0x2a1d18);
    const horn = new THREE.Shape(); horn.moveTo(0, 0); horn.quadraticCurveTo(0.12, -0.02, 0.2, 0.1); horn.quadraticCurveTo(0.22, 0.17, 0.17, 0.22); horn.quadraticCurveTo(0.16, 0.12, 0.08, 0.07); horn.quadraticCurveTo(0.04, 0.05, 0, 0.06); horn.closePath();
    for (const s of [1, -1]) { const hg = new THREE.ExtrudeGeometry(horn, { depth: 0.035, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }).translate(0, 0.07, -0.017); const h = mk(hg, iron); h.scale.x = s; }
    const gem = mk(new THREE.OctahedronGeometry(0.032, 0), M.gem(0xff5a1a, 0xff3a00, 6)); gem.position.set(0, 0.12, 0.024);
    mk(grip(0.21, 0.02, M.leather(0x2a120c)), M.leather(0x2a120c)).position.y = -0.02;
    const pom = mk(new THREE.ConeGeometry(0.03, 0.07, 6).rotateX(Math.PI), iron); pom.position.y = -0.16;
    length = 1.25;
    if (auraOn) {
      aura.push(addAura(G, { color: new THREE.Color(3.4, 1.0, 0.2), count: n(220), box: new THREE.Box3(new THREE.Vector3(-0.22, 0.1, -0.22), new THREE.Vector3(0.22, 1.9, 0.22)), size: 0.1, rise: 0.55, swirl: 0.12, tex: dotTex(), seed: 9 }));
      aura.push(addAura(G, { color: new THREE.Color(3.0, 1.9, 0.6), count: n(70), box: new THREE.Box3(new THREE.Vector3(-0.5, -0.2, -0.5), new THREE.Vector3(0.5, 2.2, 0.5)), size: 0.16, rise: 0.9, swirl: 0.3, tex: sparkTex(), seed: 10 }));
    }
    updaters.push((t) => { blade.emissiveIntensity = 2.7 + 0.7 * (Math.sin(t * 7.3) * 0.5 + Math.sin(t * 13.1) * 0.3 + Math.sin(t * 2.1) * 0.6); });
  } else if (model === 'umbra') {
    glow = new THREE.Color(0.7, 0.25, 1.0);
    const metal = new THREE.MeshPhysicalMaterial({ color: 0x5a3c86, metalness: 1, roughness: 0.2, clearcoat: 0.8, iridescence: 0.6, emissive: new THREE.Color(0.18, 0.04, 0.32), emissiveIntensity: 0.5 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x110818, emissive: new THREE.Color(0.85, 0.35, 1.0), emissiveIntensity: 5.5 });
    const mkBlade = (side: number) => {
      const B = new THREE.Group();
      const { shape: sh, tip } = crescentShape(0.40, 0.385, 0.15);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 48 }).translate(0, 0, -0.006);
      const m = new THREE.Mesh(geo, metal); m.castShadow = true; B.add(m);
      // glowing cutting edge along the outer arc
      const arc = new THREE.EllipseCurve(0, 0, 0.405, 0.405, -tip * 0.97, tip * 0.97, false, 0);
      const pts = arc.getPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0));
      B.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.006, 5, false), edge));
      // rune notches
      for (let k = 0; k < 5; k++) { const a = -0.5 + k * 0.25; const r = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.026), edge); r.position.set(Math.cos(a) * 0.33, Math.sin(a) * 0.33, 0); r.rotation.z = a; B.add(r); }
      const g = new THREE.Mesh(grip(0.18, 0.017), M.leather(0x1c1424)); g.rotation.z = Math.PI / 2; g.position.set(0.1, 0, 0); B.add(g);
      B.rotation.z = Math.PI / 2 + side * 0.55; B.position.set(side * 0.08, 0.45, side * 0.05); B.rotation.x = side * 0.08;
      return B;
    };
    G.add(mkBlade(1), mkBlade(-1));
    G.traverse((m) => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
    length = 1.0;
    if (auraOn) {
      aura.push(addAura(G, { color: new THREE.Color(2.0, 0.8, 3.2), count: n(150), box: new THREE.Box3(new THREE.Vector3(-0.7, -0.1, -0.4), new THREE.Vector3(0.7, 1.1, 0.4)), size: 0.16, rise: 0.12, swirl: 0.2, seed: 13 }));
    }
    updaters.push((t) => { edge.emissiveIntensity = 4 + 1.2 * Math.sin(t * 2.4); });
  } else if (model === 'aether') {
    glow = new THREE.Color(0.55, 0.85, 1.0);
    const gold = M.gold();
    const shaft = new THREE.MeshStandardMaterial({ color: 0x2c2230, metalness: 0.6, roughness: 0.4 });
    const sp: THREE.Vector2[] = [];
    for (let i = 0; i <= 40; i++) { const y = -0.75 + i * 0.04; sp.push(new THREE.Vector2(0.017 + (i % 8 === 0 ? 0.008 : 0) + 0.004 * Math.sin(i * 0.7), y)); }
    mk(new THREE.LatheGeometry(sp, 14), shaft);
    for (const y of [-0.74, -0.3, 0.2, 0.62]) { const r = mk(new THREE.TorusGeometry(0.024, 0.007, 8, 24).rotateX(Math.PI / 2), gold); r.position.y = y; }
    // head: four gold claws cradling the orb
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.62, 0), new THREE.Vector3(Math.cos(a) * 0.06, 0.7, Math.sin(a) * 0.06), new THREE.Vector3(Math.cos(a) * 0.12, 0.84, Math.sin(a) * 0.12), new THREE.Vector3(Math.cos(a) * 0.08, 0.99, Math.sin(a) * 0.08), new THREE.Vector3(Math.cos(a) * 0.02, 1.04, Math.sin(a) * 0.02)]);
      const tg = new THREE.TubeGeometry(c, 32, 0.011, 6, false);
      const tp = tg.attributes.position as THREE.BufferAttribute;
      mk(tg, gold);
      void tp;
    }
    const orbMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }',
      fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.0);
          float sw = sin(vP.y * 60.0 + uTime * 2.0 + sin(vP.x * 50.0 + uTime)) * 0.5 + 0.5;
          vec3 core = vec3(1.6, 2.6, 3.2) * (0.7 + 0.5 * sw);
          gl_FragColor = vec4(core * (0.55 + f * 1.8), 1.0); }`,
    });
    const orb = mk(new THREE.SphereGeometry(0.085, 32, 24), orbMat); orb.position.y = 0.83; orb.castShadow = false;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(0.6, 1.0, 1.4), blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.setScalar(0.5); halo.position.y = 0.83; G.add(halo);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(0.7, 1.4, 1.8), emissiveMap: runeStripTex(19, 18, 1024, 64), emissiveIntensity: 2.4, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.035, 64, 1, true), ringMat); ring.position.y = 0.83; G.add(ring);
    length = 1.6;
    if (auraOn) aura.push(addAura(G, { color: new THREE.Color(1.4, 2.4, 3.0), count: n(120), box: new THREE.Box3(new THREE.Vector3(-0.3, 0.55, -0.3), new THREE.Vector3(0.3, 1.25, 0.3)), size: 0.14, rise: 0.15, swirl: 0.12, seed: 21 }));
    updaters.push((t) => { orbMat.uniforms.uTime.value = t; ring.rotation.y = t * 0.8; ring.rotation.x = 0.3 * Math.sin(t * 0.6); });
  } else if (model === 'sol') {
    glow = new THREE.Color(1.0, 0.8, 0.4);
    const blade = new THREE.MeshPhysicalMaterial({ color: 0xf2c46a, metalness: 1, roughness: 0.14, clearcoat: 0.8, clearcoatRoughness: 0.08, emissive: new THREE.Color(1.0, 0.86, 0.55), emissiveMap: runeFullerMask(31), emissiveIntensity: 2.2 });
    mk(bladeGeometry({ len: 1.05, width: 0.068, thick: 0.013, tip: 0.18, widthFn: (v) => 1.1 - v * 0.2 }), blade).position.y = 0.16;
    const gold = M.gold();
    // winged crossguard
    const wing = new THREE.Shape(); wing.moveTo(0, 0); wing.bezierCurveTo(0.08, -0.03, 0.2, 0.0, 0.27, 0.09); wing.bezierCurveTo(0.2, 0.06, 0.16, 0.08, 0.13, 0.06); wing.bezierCurveTo(0.09, 0.08, 0.05, 0.07, 0, 0.06); wing.closePath();
    for (const s of [1, -1]) { const wg = new THREE.ExtrudeGeometry(wing, { depth: 0.03, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }).translate(0, 0.08, -0.015); const w = mk(wg, gold); w.scale.x = s; }
    const gem = mk(new THREE.OctahedronGeometry(0.03, 0), M.gem(0xffffff, 0xfff1c0, 4)); gem.position.set(0, 0.12, 0.022);
    mk(grip(0.21, 0.019, M.leather(0xf3ecdc)), M.leather(0x6b4a2a)).position.y = -0.02;
    const pom = mk(new THREE.SphereGeometry(0.03, 16, 12), gold); pom.position.y = -0.155;
    length = 1.22;
    if (auraOn) aura.push(addAura(G, { color: new THREE.Color(3.2, 2.6, 1.4), count: n(130), box: new THREE.Box3(new THREE.Vector3(-0.4, -0.1, -0.4), new THREE.Vector3(0.4, 1.4, 0.4)), size: 0.15, rise: 0.18, swirl: 0.1, seed: 33 }));
    updaters.push((t) => { blade.emissiveIntensity = 2.0 + 0.4 * Math.sin(t * 1.3); });
  } else if (model === 'skyreach') {
    glow = new THREE.Color(0.5, 1.0, 0.9);
    const limbMat = new THREE.MeshPhysicalMaterial({ color: 0xe9e4d8, metalness: 0.3, roughness: 0.3, clearcoat: 0.8 });
    const gold = M.gold();
    const curve = new THREE.CatmullRomCurve3([[0.06, -0.7], [0.0, -0.55], [-0.08, -0.3], [-0.06, -0.08], [-0.05, 0], [-0.06, 0.08], [-0.08, 0.3], [0.0, 0.55], [0.06, 0.7]].map(([z, y]) => new THREE.Vector3(0, y, z)));
    const lg = new THREE.TubeGeometry(curve, 96, 1, 8, false);
    const lp = lg.attributes.position as THREE.BufferAttribute; const c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= 96; i++) { curve.getPointAt(i / 96, c); const u = Math.abs(i / 96 - 0.5) * 2; const r = lerp(0.026, 0.009, Math.pow(u, 0.8)); for (let j = 0; j <= 8; j++) { const k = i * 9 + j; v.fromBufferAttribute(lp, k).sub(c); v.multiplyScalar(r); v.x *= 1.5; v.add(c); lp.setXYZ(k, v.x, v.y, v.z); } }
    lg.computeVertexNormals();
    mk(lg, limbMat);
    const inlay = new THREE.TubeGeometry(curve, 96, 0.004, 4, false); mk(inlay, gold).position.x = 0.02;
    const str = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.6, 2.4) });
    mk(new THREE.CylinderGeometry(0.0022, 0.0022, 1.4, 4), str).position.z = 0.06;
    mk(grip(0.16, 0.024, M.leather(0x23402f)), M.leather(0x23402f)).position.z = -0.05;
    G.rotation.y = Math.PI / 2;
    length = 1.4;
    if (auraOn) aura.push(addAura(G, { color: new THREE.Color(1.6, 3.0, 2.6), count: n(110), box: new THREE.Box3(new THREE.Vector3(-0.25, -0.75, -0.25), new THREE.Vector3(0.25, 0.75, 0.25)), size: 0.13, rise: 0.12, swirl: 0.1, seed: 44 }));
  } else {
    // common starter weapons (no aura)
    const steel = M.steel();
    if (model === 'oak_staff') {
      const wood = new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.8 });
      mk(new THREE.CylinderGeometry(0.018, 0.022, 1.5, 8), wood).position.y = 0.1;
      const g = mk(new THREE.IcosahedronGeometry(0.05, 0), M.gem(0x88ccff, 0x2266aa, 1.2)); g.position.y = 0.9; length = 1.5;
    } else if (model === 'hunter_bow') {
      const wood = new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.7 });
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.6, 0.05), new THREE.Vector3(0, 0, -0.18), new THREE.Vector3(0, 0.6, 0.05));
      mk(new THREE.TubeGeometry(c, 32, 0.014, 6, false), wood);
      mk(new THREE.CylinderGeometry(0.0015, 0.0015, 1.2, 3), new THREE.MeshBasicMaterial({ color: 0xdddddd })).position.z = 0.05;
      G.rotation.y = Math.PI / 2; length = 1.2;
    } else if (model === 'steel_daggers') {
      mk(bladeGeometry({ len: 0.32, width: 0.03, thick: 0.007, tip: 0.35 }), steel).position.y = 0.08;
      mk(new THREE.BoxGeometry(0.1, 0.018, 0.025), M.dark()).position.y = 0.07;
      mk(grip(0.12, 0.014, M.leather()), M.leather()); length = 0.45;
    } else if (model === 'war_axe') {
      mk(new THREE.CylinderGeometry(0.02, 0.022, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.8 })).position.y = 0.25;
      const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(0.12, 0.02, 0.2, 0.14); s.quadraticCurveTo(0.24, 0, 0.2, -0.14); s.quadraticCurveTo(0.12, -0.02, 0, -0.04); s.closePath();
      mk(new THREE.ExtrudeGeometry(s, { depth: 0.015, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004 }).translate(0.01, 0.62, -0.008), steel); length = 0.9;
    } else {
      mk(bladeGeometry({ len: 0.85, width: 0.042, thick: 0.009, tip: 0.15 }), steel).position.y = 0.14;
      mk(new THREE.BoxGeometry(0.22, 0.03, 0.04), M.dark()).position.y = 0.125;
      mk(grip(0.18, 0.017, M.leather()), M.leather()).position.y = 0.02;
      length = 1.0;
    }
  }
  if (o.light !== false && model !== 'iron_sword' && model !== 'oak_staff' && model !== 'hunter_bow' && model !== 'steel_daggers' && model !== 'war_axe') {
    light = new THREE.PointLight(glow, 4.5, 5, 2);
    light.position.set(0, model === 'aether' ? 0.83 : -0.12, 0.12);
    G.add(light);
  }
  return {
    group: G, light, aura, glow, length,
    update(t: number, dt: number) { for (const u of updaters) u(t, dt); for (const a of aura) (a.material as THREE.ShaderMaterial).uniforms.uTime.value = t; if (light && model === 'ignis') light.intensity = 4 + Math.sin(t * 11) * 0.8 + Math.sin(t * 5.3) * 0.6; },
    setAura(on: boolean) { for (const a of aura) a.visible = on; },
  };
}
