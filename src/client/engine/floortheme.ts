import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FloorPlan } from '../../shared/tower';
import { tex } from './assets';
import { worldUV } from './city';

/** POLISH-1 · Tower interiors. Each band of ten floors gets its own stone, floor, overlay (moss, snow,
 *  lava cracks, abyss veins, stars…), props, particles and light, plus a vaulted ceiling, ribs, upper
 *  walls and clerestory windows so a floor reads as a room inside the Tower instead of an open brick
 *  box. Everything here is visual only: no colliders are added (props sit against walls, hang above head
 *  height, or are flat floor details), so the shared floor plan and its flood-fill test are unchanged. */

export const CEIL = 10.5, RISE = 3.4;
type Overlay = 'moss' | 'damp' | 'lava' | 'snow' | 'slate' | 'polish' | 'veins' | 'brass' | 'stars' | 'marble';
interface Look {
  wall: [string, number, number, number]; floor: [string, number, number, number]; trim: number; // [tex, tint, roughness, metalness]
  ov: Overlay; ovCol: number; light: number; lightI: number; amb: number; sun: number; win: number;
  parts: 'fireflies' | 'dust' | 'embers' | 'snow' | 'sparks' | 'glitter' | 'mist' | 'steam' | 'stars' | 'motes'; pCol: number;
}
export const LOOKS: Look[] = [
  { wall: ['rock', 0xa09e90, 0.92, 0], floor: ['cobble', 0x8e8c78, 0.9, 0], trim: 0x8a8a7c, ov: 'moss', ovCol: 0x4d6b2c, light: 0xd8ffb0, lightI: 7, amb: 0x9ab886, sun: 0.55, win: 0xd8f4c0, parts: 'fireflies', pCol: 0xd8ff8a },
  { wall: ['brick', 0xbcb2a2, 0.9, 0], floor: ['cobble', 0x9e978a, 0.55, 0], trim: 0xa89e8e, ov: 'damp', ovCol: 0x3a3a34, light: 0xffc078, lightI: 7, amb: 0x9aa8a8, sun: 0.4, win: 0xc8d8d8, parts: 'dust', pCol: 0xe8e0d0 },
  { wall: ['rock', 0x3a3230, 0.85, 0], floor: ['ash', 0x3e3430, 0.8, 0], trim: 0x2e2826, ov: 'lava', ovCol: 0xff5a14, light: 0xff7a2a, lightI: 11, amb: 0x8a5a44, sun: 0.35, win: 0xff9a50, parts: 'embers', pCol: 0xff9a3a },
  { wall: ['rock', 0xa8c0d2, 0.3, 0.05], floor: ['snow', 0xd4dee8, 0.6, 0], trim: 0xc8dcea, ov: 'snow', ovCol: 0xf4f8ff, light: 0xa8dcff, lightI: 8, amb: 0xb8d0e4, sun: 0.6, win: 0xe0f4ff, parts: 'snow', pCol: 0xffffff },
  { wall: ['rock', 0x4c5056, 0.7, 0.05], floor: ['cobble', 0x55585c, 0.35, 0.05], trim: 0x3e4246, ov: 'slate', ovCol: 0x9fd8ff, light: 0xbfe4ff, lightI: 8, amb: 0x8a929a, sun: 0.4, win: 0xc8dcff, parts: 'sparks', pCol: 0xd8f0ff },
  { wall: ['brick', 0xe6eaec, 0.22, 0.15], floor: ['cobble', 0xdfe4e6, 0.12, 0.1], trim: 0xf4f6f8, ov: 'polish', ovCol: 0xffffff, light: 0xffffff, lightI: 6, amb: 0xdde4e8, sun: 0.7, win: 0xffffff, parts: 'glitter', pCol: 0xffffff },
  { wall: ['rock', 0x2a2224, 0.35, 0.1], floor: ['ash', 0x261e20, 0.3, 0.1], trim: 0x1e1818, ov: 'veins', ovCol: 0xff2a1a, light: 0xff4a32, lightI: 10, amb: 0x7a4a46, sun: 0.3, win: 0xff6a50, parts: 'mist', pCol: 0xff5a4a },
  { wall: ['brick', 0xae8a62, 0.75, 0], floor: ['cobble', 0x8a7458, 0.6, 0.2], trim: 0xc89a48, ov: 'brass', ovCol: 0xc8963c, light: 0xffc870, lightI: 8, amb: 0xb8a080, sun: 0.5, win: 0xffe0a8, parts: 'steam', pCol: 0xf0ece4 },
  { wall: ['rock', 0x5a5c64, 0.6, 0.05], floor: ['cobble', 0x66686e, 0.35, 0.05], trim: 0x8a8c94, ov: 'stars', ovCol: 0x9ae8ff, light: 0x9ae8ff, lightI: 7, amb: 0x8a90a0, sun: 0.3, win: 0xc8f0ff, parts: 'stars', pCol: 0xc8f4ff },
  { wall: ['brick', 0xf0ebe0, 0.45, 0], floor: ['cobble', 0xf2ece0, 0.3, 0], trim: 0xd8b060, ov: 'marble', ovCol: 0xd8b060, light: 0xffe8b0, lightI: 7, amb: 0xf0e8d8, sun: 0.85, win: 0xfff4d8, parts: 'motes', pCol: 0xfff0c0 },
];

const shared = { uTime: { value: 0 } };
const NOISE = `
float tH3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float tN3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(tH3(i),tH3(i+vec3(1,0,0)),f.x),mix(tH3(i+vec3(0,1,0)),tH3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(tH3(i+vec3(0,0,1)),tH3(i+vec3(1,0,1)),f.x),mix(tH3(i+vec3(0,1,1)),tH3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float tFb(vec3 p){ return tN3(p)*.5+tN3(p*2.03)*.25+tN3(p*4.1)*.125+tN3(p*8.3)*.0625; }`;
/** World-space surface overlay (moss on tops and wall feet, snow, lava cracks, veins, damp, stars…). */
function overlay(m: THREE.MeshStandardMaterial, ov: Overlay, col: number, ceiling = false) {
  const c = new THREE.Color(col);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime; sh.uniforms.uOv = { value: c };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTWP; varying vec3 vTWN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vTWN = normalize(mat3(modelMatrix) * objectNormal);');
    let colF = '', roughF = '', emF = '';
    switch (ov) {
      case 'moss': colF = 'float mo = smoothstep(.5,.75,tFb(vTWP*.45)) * (.2+.8*clamp(vTWN.y,0.,1.)) + smoothstep(2.0,0.,vTWP.y)*.6*smoothstep(.4,.7,tFb(vTWP*1.1+3.));\n diffuseColor.rgb = mix(diffuseColor.rgb, uOv*(.65+.7*tFb(vTWP*4.)), clamp(mo,0.,.92));'; roughF = 'roughnessFactor = mix(roughnessFactor, 1.0, .3);'; break;
      case 'damp': colF = 'float dm = smoothstep(2.6,0.,vTWP.y)*(.5+.5*tFb(vTWP*.8)); diffuseColor.rgb *= 1. - dm*.45; diffuseColor.rgb = mix(diffuseColor.rgb, uOv, smoothstep(.62,.8,tFb(vTWP*.35))*.35);'; roughF = 'roughnessFactor *= 1. - smoothstep(2.6,0.,vTWP.y)*.55;'; break;
      case 'lava': colF = 'float lc = (1.-smoothstep(.0,.03,abs(tFb(vTWP*.32)-.5))) * smoothstep(.45,.65,tN3(vTWP*.09+vec3(3.))); diffuseColor.rgb *= 1. - lc*.5;'; emF = 'float le = (1.-smoothstep(.0,.011,abs(tFb(vTWP*.32)-.5))) * smoothstep(.45,.65,tN3(vTWP*.09+vec3(3.))); totalEmissiveRadiance += uOv * le * (.8 + .3*sin(uTime*1.7 + vTWP.x*.3)) * (.15 + .85*smoothstep(3.5,0.,vTWP.y));'; break;
      case 'veins': colF = 'diffuseColor.rgb *= .9 + .2*tFb(vTWP*2.);'; emF = 'float ve = (1.-smoothstep(.0,.007,abs(tFb(vTWP*.45+vec3(4.))-.5))) * smoothstep(.4,.62,tN3(vTWP*.11)); totalEmissiveRadiance += uOv * ve * (.55 + .25*sin(uTime*2.3 + vTWP.y));'; break;
      case 'snow': colF = 'float sn = smoothstep(.25,.65,vTWN.y)*.95 + smoothstep(1.4,0.,vTWP.y)*.55*smoothstep(.35,.65,tFb(vTWP*.9));\n diffuseColor.rgb = mix(diffuseColor.rgb*vec3(.86,.94,1.06), uOv, clamp(sn,0.,1.));'; roughF = 'roughnessFactor = mix(roughnessFactor, .75, clamp(smoothstep(.25,.65,vTWN.y),0.,1.));'; emF = 'totalEmissiveRadiance += vec3(.04,.08,.12) * (1. - clamp(vTWN.y,0.,1.));'; break;
      case 'slate': colF = 'diffuseColor.rgb *= .8 + .35*tFb(vTWP*.7);'; emF = 'float sl = (1.-smoothstep(.0,.005,abs(tFb(vTWP*.6+vec3(9.))-.5))) * smoothstep(.45,.65,tN3(vTWP*.1+vec3(5.))); float fl = step(.93, fract(sin(floor(uTime*7.)*43.7)*917.3)); totalEmissiveRadiance += uOv * sl * (.06 + 1.1*fl);'; break;
      case 'polish': colF = 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.), .25) * (.92 + .1*tFb(vTWP*3.));'; roughF = 'roughnessFactor *= .8;'; break;
      case 'brass': colF = 'float br = smoothstep(.9,.92,fract(vTWP.y*.28 + .1)) * (1.-smoothstep(.95,.97,fract(vTWP.y*.28+.1))); diffuseColor.rgb = mix(diffuseColor.rgb, uOv, br*.9);'; roughF = ''; break;
      case 'stars': colF = 'diffuseColor.rgb *= .85 + .3*tFb(vTWP*.5);'; emF = ceiling ? 'vec3 sc = floor(vTWP*2.2); float st = step(.985, tH3(sc)); float tw = .6+.4*sin(uTime*3.+tH3(sc+1.)*40.); totalEmissiveRadiance += uOv * st * tw * 2.5 + uOv*.04*tFb(vTWP*.1);' : 'float sv = (1.-smoothstep(.0,.004,abs(tFb(vTWP*.5+vec3(2.))-.5))) * smoothstep(.5,.7,tN3(vTWP*.12)); totalEmissiveRadiance += uOv * sv * .3;'; break;
      case 'marble': colF = 'float mv = 1.-smoothstep(.0,.03,abs(tFb(vTWP*.4)-.5)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.62,.6,.58), mv*.35);'; roughF = ''; break;
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uOv; varying vec3 vTWP; varying vec3 vTWN;' + NOISE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + colF)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + roughF)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + emF);
  };
  m.customProgramCacheKey = () => 'tov:' + ov + (ceiling ? ':c' : '');
  return m;
}
function texMat(name: string, tint: number, rough: number, metal: number, rep = 1) {
  const m = new THREE.MeshStandardMaterial({ map: tex(`tex/${name}_col.jpg`), normalMap: tex(`tex/${name}_nor.jpg`, { srgb: false }), color: tint, roughness: rough, metalness: metal });
  void rep; return m;
}
function merge(geos: THREE.BufferGeometry[]) {
  return mergeGeometries(geos.map((x) => { const y = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(y.attributes)) if (!['position', 'normal', 'uv'].includes(k)) y.deleteAttribute(k); if (!y.attributes.uv) y.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(y.attributes.position.count * 2), 2)); if (!y.attributes.normal) y.computeVertexNormals(); return y; }))!;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1) => g.clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s)));
let rs = 1; const rnd = () => { rs = (rs * 16807) % 2147483647; return (rs - 1) / 2147483646; };
function canvasT(draw: (g: CanvasRenderingContext2D, n: number) => void, n = 128) { const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d')!, n); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }

export class FloorTheme {
  L: Look; band: number;
  wallMat: THREE.MeshStandardMaterial; trimMat: THREE.MeshStandardMaterial; floorMat: THREE.MeshStandardMaterial;
  private spin: { o: THREE.Object3D; s: number; bob?: number; y0?: number; z?: boolean }[] = [];
  private flick: { m: THREE.Material & { opacity: number }; ph: number }[] = [];
  private arcs: { geo: THREE.BufferGeometry; a: THREE.Vector3; b: THREE.Vector3; mat: THREE.LineBasicMaterial; last: number }[] = [];
  private pts: THREE.Points | null = null;
  lightsAt: THREE.Vector3[] = [];
  constructor(public group: THREE.Group, public P: FloorPlan, n: number) {
    this.band = Math.min(9, Math.floor((n - 1) / 10)); const L = (this.L = LOOKS[this.band]); rs = 7 + n * 13;
    this.wallMat = overlay(texMat(L.wall[0], L.wall[1], L.wall[2], L.wall[3]), L.ov, L.ovCol);
    this.trimMat = overlay(texMat(L.wall[0] === 'brick' ? 'rock' : 'brick', L.trim, Math.min(0.9, L.wall[2] + 0.05), L.ov === 'brass' || L.ov === 'marble' ? 0.6 : L.wall[3]), L.ov === 'brass' || L.ov === 'marble' ? 'polish' : L.ov, L.ovCol);
    if (L.ov === 'brass' || L.ov === 'marble') { this.trimMat.map = null; this.trimMat.color.set(L.trim); this.trimMat.metalness = 0.85; this.trimMat.roughness = 0.32; }
    this.floorMat = overlay(texMat(L.floor[0], L.floor[1], L.floor[2], L.floor[3]), L.ov === 'stars' ? 'polish' : L.ov, L.ovCol);
    this.build();
  }
  private add(geos: THREE.BufferGeometry[], m: THREE.Material, cast = false, receive = true) {
    if (!geos.length) return null; const me = new THREE.Mesh(merge(geos), m); me.castShadow = cast; me.receiveShadow = receive; this.group.add(me); return me;
  }
  private build() {
    const P = this.P, L = this.L, W = P.cols * P.R, D = P.rows * P.R, x0 = -W / 2, z0 = -D / 2, R = P.R, T = 0.7, H = P.walls[0]?.h ?? 7;
    // floor slab
    const fg = new THREE.PlaneGeometry(W, D, 1, 1).rotateX(-Math.PI / 2); const uv = fg.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 5, uv.getY(i) * D / 5);
    const slab = new THREE.Mesh(fg, this.floorMat); slab.position.y = 0.012; slab.receiveShadow = true; this.group.add(slab);
    // upper walls on every room boundary (7 m → ceiling), lintels over doorways, pillar shafts to the vault
    const upper: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [];
    const isWall = (x: number, z: number) => P.walls.some((w) => Math.abs(w.x - x) <= w.hx + 0.01 && Math.abs(w.z - z) <= w.hz + 0.01);
    const doors: { x: number; z: number; alongZ: boolean }[] = [];
    for (let i = 0; i <= P.cols; i++) {
      const x = x0 + i * R; upper.push(at(worldUV(new THREE.BoxGeometry(T * 2, CEIL + 0.4 - H, D), 4), x, (H + CEIL + 0.4) / 2, 0));
      if (i > 0 && i < P.cols) for (let j = 0; j < P.rows; j++) { const z = z0 + R * (j + 0.5); if (!isWall(x, z)) doors.push({ x, z, alongZ: true }); }
    }
    for (let j = 0; j <= P.rows; j++) {
      const z = z0 + j * R; upper.push(at(worldUV(new THREE.BoxGeometry(W, CEIL + 0.4 - H, T * 2), 4), 0, (H + CEIL + 0.4) / 2, z));
      if (j > 0 && j < P.rows) for (let i = 0; i < P.cols; i++) { const x = x0 + R * (i + 0.5); if (!isWall(x, z)) doors.push({ x, z, alongZ: false }); }
    }
    const DH = 5.6;
    for (const d of doors) {
      // a round-arched lintel over each doorway (visual; the opening below stays 5.6 m clear)
      const s = new THREE.Shape(); s.moveTo(-3.3, DH - 1.5); s.lineTo(-3.3, H + 0.01); s.lineTo(3.3, H + 0.01); s.lineTo(3.3, DH - 1.5); s.absarc(0, DH - 1.5, 3.3, 0, Math.PI, false);
      const lg = new THREE.ExtrudeGeometry(s, { depth: T * 2, bevelEnabled: false }); lg.translate(0, 0, -T); if (d.alongZ) lg.rotateY(Math.PI / 2);
      upper.push(worldUV(at(lg, d.x, 0, d.z), 4));
      const rib = new THREE.TorusGeometry(3.35, 0.22, 6, 24, Math.PI); if (d.alongZ) rib.rotateY(Math.PI / 2);
      for (const sd of [-1, 1]) trim.push(at(rib, d.x + (d.alongZ ? sd * (T + 0.05) : 0), DH - 1.5, d.z + (d.alongZ ? 0 : sd * (T + 0.05))));
    }
    for (let i = 0; i <= P.cols; i++) for (let j = 0; j <= P.rows; j++) {
      const x = x0 + i * R, z = z0 + j * R;
      upper.push(at(worldUV(new THREE.BoxGeometry(2.0, CEIL - H, 2.0), 3), x, (H + CEIL) / 2, z));
      trim.push(at(worldUV(new THREE.BoxGeometry(2.7, 0.55, 2.7), 3), x, CEIL - 0.1, z), at(worldUV(new THREE.BoxGeometry(2.5, 0.35, 2.5), 3), x, 0.18, z));
    }
    // string course under the vault springing
    for (let i = 0; i <= P.cols; i++) trim.push(at(worldUV(new THREE.BoxGeometry(T * 2 + 0.36, 0.3, D), 3), x0 + i * R, CEIL - 0.35, 0));
    for (let j = 0; j <= P.rows; j++) trim.push(at(worldUV(new THREE.BoxGeometry(W, 0.3, T * 2 + 0.36), 3), 0, CEIL - 0.35, z0 + j * R));
    this.add(upper, this.wallMat, false);
    // vaulted ceilings (cloister vaults, visible from below only) with diagonal + edge ribs
    const vault: THREE.BufferGeometry[] = [];
    const vf = (u: number, v: number) => CEIL + RISE * (1 - Math.max(u * u, v * v));
    for (const r of P.rooms) {
      const g = new THREE.PlaneGeometry(R, R, 14, 14).rotateX(Math.PI / 2); const p = g.attributes.position as THREE.BufferAttribute; const guv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const u = p.getX(i) / (R / 2), v = p.getZ(i) / (R / 2); p.setY(i, vf(u, v)); guv.setXY(i, p.getX(i) / 4, p.getZ(i) / 4); }
      g.computeVertexNormals(); vault.push(at(g, r.x, 0, r.z));
      for (const [a, b] of [[1, 1], [1, -1]]) {
        const pts: THREE.Vector3[] = []; for (let k = 0; k <= 10; k++) { const t = -1 + (2 * k) / 10; pts.push(new THREE.Vector3(r.x + (t * a * R) / 2, vf(t, t) - 0.12, r.z + (t * b * R) / 2)); }
        trim.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.2, 6));
      }
      const boss = new THREE.SphereGeometry(0.55, 10, 8); trim.push(at(boss, r.x, CEIL + RISE - 0.2, r.z));
    }
    const ceilMat = L.ov === 'stars' ? overlay(texMat(L.wall[0], 0x3a3c44, 0.9, 0), 'stars', L.ovCol, true) : overlay(texMat(L.wall[0], L.wall[1], L.wall[2], L.wall[3]), L.ov === 'moss' || L.ov === 'snow' ? 'damp' : L.ov, L.ovCol);
    ceilMat.emissive = new THREE.Color(L.amb).multiplyScalar(L.ov === 'stars' ? 0.04 : 0.16); // bounce light under the vault
    const vm = this.add(vault, ceilMat, false); if (vm) vm.receiveShadow = false;
    this.add(trim, this.trimMat, false);
    // clerestory windows on the outer walls: arched panes glowing with the light outside
    const winG: THREE.BufferGeometry[] = [];
    const ws = new THREE.Shape(); ws.moveTo(-1.5, 0); ws.lineTo(1.5, 0); ws.lineTo(1.5, 1.9); ws.absarc(0, 1.9, 1.5, 0, Math.PI, false); ws.lineTo(-1.5, 0);
    const wgeo = new THREE.ShapeGeometry(ws, 8);
    for (let i = 0; i < P.cols; i++) for (const [z, ry] of [[z0 + T + 0.02, 0], [z0 + D - T - 0.02, Math.PI]] as [number, number][]) winG.push(at(wgeo, x0 + R * (i + 0.5), H + 0.45, z, ry));
    for (let j = 0; j < P.rows; j++) for (const [x, ry] of [[x0 + T + 0.02, Math.PI / 2], [x0 + W - T - 0.02, -Math.PI / 2]] as [number, number][]) winG.push(at(wgeo, x, H + 0.45, z0 + R * (j + 0.5), ry));
    const winM = new THREE.MeshBasicMaterial({ color: new THREE.Color(L.win).multiplyScalar(1.15), transparent: true, opacity: 0.92 }); this.add(winG, winM);
    if (L.ov === 'slate') this.flick.push({ m: winM, ph: 0 });
    // window light shafts on bright bands
    if (['moss', 'marble', 'polish', 'snow'].includes(L.ov)) {
      const sg: THREE.BufferGeometry[] = [];
      const shaft = new THREE.CylinderGeometry(1.4, 2.6, 9, 12, 1, true).translate(0, -4.5, 0);
      for (let i = 0; i < P.cols; i++) sg.push(at(shaft, x0 + R * (i + 0.5), H + 2.2, z0 + 2.2, 0, -0.55, 0));
      for (let i = 0; i < P.cols; i++) sg.push(at(shaft, x0 + R * (i + 0.5), H + 2.2, z0 + D - 2.2, 0, 0.55, 0));
      const sm = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uC: { value: new THREE.Color(L.win) } },
        vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform vec3 uC; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(vN,vV)),2.); float a = .1*e*smoothstep(-9.,-1.,vY)*smoothstep(0.,-1.5,vY); gl_FragColor = vec4(uC*a, a); }' });
      this.add(sg, sm);
    }
    this.props();
    this.particles();
    for (const r of P.rooms) this.lightsAt.push(new THREE.Vector3(r.x, 6.2, r.z));
  }

  /** Theme props: against the walls, hanging above head height, or flat on the floor. */
  private props() {
    const P = this.P, L = this.L, R = P.R, b = this.band;
    const sides: { x: number; z: number; nx: number; nz: number; door: boolean }[] = [];
    const isWall = (x: number, z: number) => P.walls.some((w) => Math.abs(w.x - x) <= w.hx + 0.01 && Math.abs(w.z - z) <= w.hz + 0.01);
    for (const r of P.rooms) for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const bx = r.x - nx * R / 2, bz = r.z - nz * R / 2; sides.push({ x: r.x - nx * (R / 2 - 0.72), z: r.z - nz * (R / 2 - 0.72), nx, nz, door: !isWall(bx, bz) }); }
    // spots along each inner wall face (skipping the doorway), with the inward normal
    const along = (count: number, fn: (x: number, z: number, nx: number, nz: number, k: number) => void) => {
      for (const s of sides) for (let k = 0; k < count; k++) {
        let t = (rnd() - 0.5) * (R - 4); if (s.door && Math.abs(t) < 4.2) t = Math.sign(t || 1) * (4.2 + rnd() * (R / 2 - 6.2));
        const x = s.x + (s.nz !== 0 ? t : 0), z = s.z + (s.nx !== 0 ? t : 0); fn(x, z, s.nx, s.nz, k);
      }
    };
    const inRoom = (count: number, fn: (x: number, z: number, k: number) => void) => { for (const r of P.rooms) for (let k = 0; k < count; k++) fn(r.x + (rnd() - 0.5) * (R - 5), r.z + (rnd() - 0.5) * (R - 5), k); };
    const vault = (x: number, z: number, r: { x: number; z: number }) => { const u = (x - r.x) / (R / 2), v = (z - r.z) / (R / 2); return CEIL + RISE * (1 - Math.max(u * u, v * v)); };
    const roomOf = (x: number, z: number) => P.rooms.reduce((a, r) => (Math.hypot(r.x - x, r.z - z) < Math.hypot(a.x - x, a.z - z) ? r : a), P.rooms[0]);
    const G: Record<string, THREE.BufferGeometry[]> = {};
    const push = (k: string, g: THREE.BufferGeometry) => { (G[k] ??= []).push(g); };
    const M: Record<string, THREE.Material> = {};
    const leafT = () => canvasT((g, n) => { g.clearRect(0, 0, n, n); for (let i = 0; i < 9; i++) { g.save(); g.translate(n / 2, n * 0.95); g.rotate(-1.2 + i * 0.3); g.fillStyle = `hsl(${95 + i * 4},${40 + i * 3}%,${22 + (i % 3) * 6}%)`; g.beginPath(); g.ellipse(0, -n * 0.32, n * 0.07, n * 0.3, 0, 0, Math.PI * 2); g.fill(); g.restore(); } });
    if (b === 0) { // Verdant: vines from the vault, roots up the walls, ferns at wall feet, fireflies
      M.vine = new THREE.MeshStandardMaterial({ color: 0x3a5226, roughness: 0.9 });
      M.leaf = new THREE.MeshStandardMaterial({ map: leafT(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
      inRoom(9, (x, z) => { const r = roomOf(x, z), top = vault(x, z, r), len = 2.5 + rnd() * 3.2; const pts = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(x + Math.sin(t * 5 + x) * 0.3, top - t * len, z + Math.cos(t * 4 + z) * 0.3)); push('vine', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.05, 5)); for (let i = 0; i < 6; i++) { const p = pts[0].clone().lerp(pts[3], i / 6 + 0.08); push('leaf', at(new THREE.PlaneGeometry(0.7, 0.7), p.x, p.y, p.z, rnd() * 6, 0.3, 0)); } });
      along(3, (x, z, nx, nz) => { const pts = [0, 0.3, 0.6, 1].map((t) => new THREE.Vector3(x - nx * 0.05 + (nz ? Math.sin(t * 6) * 0.6 : 0), t * 6.5, z - nz * 0.05 + (nx ? Math.sin(t * 6) * 0.6 : 0))); push('vine', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.07, 5)); for (let i = 0; i < 5; i++) push('leaf', at(new THREE.PlaneGeometry(0.9, 0.9), x + nx * 0.15, 0.45 + i * 1.3, z + nz * 0.15, Math.atan2(nx, nz) + (rnd() - 0.5), 0, 0)); });
      along(4, (x, z, nx, nz) => { for (let i = 0; i < 3; i++) push('leaf', at(new THREE.PlaneGeometry(1.3, 1.1).translate(0, 0.5, 0), x + nx * 0.3, 0, z + nz * 0.3, rnd() * Math.PI, -0.25, 0)); });
    } else if (b === 1) { // Ossuary: bone piles + skulls at wall feet, candles on ledges, cobwebs in vault corners
      M.bone = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.85 });
      M.wax = new THREE.MeshStandardMaterial({ color: 0xf0e8d0, roughness: 0.6, emissive: 0x402a10, emissiveIntensity: 0.4 });
      M.web = new THREE.MeshBasicMaterial({ map: canvasT((g, n) => { g.strokeStyle = 'rgba(235,235,230,.55)'; g.lineWidth = 1; for (let i = 0; i < 9; i++) { const a = (i / 8) * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * n, Math.sin(a) * n); g.stroke(); } for (let r = 12; r < n; r += 12) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI / 2); g.stroke(); } }), transparent: true, side: THREE.DoubleSide, depthWrite: false });
      along(3, (x, z, nx, nz) => { for (let i = 0; i < 7; i++) push('bone', at(new THREE.CapsuleGeometry(0.05, 0.5, 2, 6), x + nx * (0.1 + rnd() * 0.3) + (rnd() - 0.5) * 0.8, 0.07, z + nz * (0.1 + rnd() * 0.3) + (rnd() - 0.5) * 0.8, rnd() * 6, Math.PI / 2, rnd())); push('bone', at(new THREE.SphereGeometry(0.17, 10, 8).scale(1, 0.9, 1.15), x + nx * 0.25, 0.15, z + nz * 0.25, Math.atan2(nx, nz))); });
      along(2, (x, z, nx, nz) => { push('bone', at(new THREE.BoxGeometry(nz ? 1.4 : 0.35, 0.1, nx ? 1.4 : 0.35), x - nx * 0.5, 2.2, z - nz * 0.5)); for (let i = 0; i < 3; i++) { const cx = x - nx * 0.45 + (nz ? (i - 1) * 0.4 : 0), cz = z - nz * 0.45 + (nx ? (i - 1) * 0.4 : 0), h = 0.2 + rnd() * 0.25; push('wax', at(new THREE.CylinderGeometry(0.05, 0.05, h, 8), cx, 2.25 + h / 2, cz)); this.flame(cx, 2.3 + h, cz, 0xffb060, 0.35); } });
      for (const r of P.rooms) for (const [a, c] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) if (rnd() < 0.6) push('web', at(new THREE.PlaneGeometry(2.6, 2.6).translate(1.3, -1.3, 0), r.x + a * (R / 2 - 0.75), CEIL - 0.1, r.z + c * (R / 2 - 0.75), Math.atan2(-a, -c) + Math.PI / 4 * 0, 0, 0));
    } else if (b === 2) { // Ember: lava channels along the wall feet, hanging chains, slag heaps
      M.lava = new THREE.MeshStandardMaterial({ color: 0x200a04, emissive: 0xff5a14, emissiveIntensity: 2.2, roughness: 0.6 }); this.flick.push({ m: M.lava as any, ph: 1 });
      M.iron = new THREE.MeshStandardMaterial({ color: 0x2a2624, metalness: 0.85, roughness: 0.45 });
      for (const s of sides) { const len = R - (s.door ? 0 : 0) - 3; const lg = new THREE.BoxGeometry(s.nz ? len : 0.55, 0.04, s.nx ? len : 0.55); if (!s.door) push('lava', at(lg, s.x + s.nx * 0.3, 0.03, s.z + s.nz * 0.3)); else for (const sg of [-1, 1]) push('lava', at(new THREE.BoxGeometry(s.nz ? (R - 9) / 2 : 0.55, 0.04, s.nx ? (R - 9) / 2 : 0.55), s.x + s.nx * 0.3 + (s.nz ? sg * (R / 4 + 1.6) : 0), 0.03, s.z + s.nz * 0.3 + (s.nx ? sg * (R / 4 + 1.6) : 0))); }
      inRoom(4, (x, z) => { const r = roomOf(x, z), top = vault(x, z, r), n = 10 + Math.floor(rnd() * 8); for (let i = 0; i < n; i++) push('iron', at(new THREE.TorusGeometry(0.12, 0.035, 5, 10), x, top - 0.2 - i * 0.2, z, i % 2 ? Math.PI / 2 : 0)); });
      along(2, (x, z, nx, nz) => { for (let i = 0; i < 4; i++) push('iron', at(new THREE.DodecahedronGeometry(0.25 + rnd() * 0.25, 0), x + nx * 0.2 + (rnd() - 0.5), 0.12, z + nz * 0.2 + (rnd() - 0.5), rnd() * 3, rnd() * 3, 0)); });
    } else if (b === 3) { // Rime: icicles from the vault and wall tops, ice crystal clusters, snow drifts
      M.ice = new THREE.MeshStandardMaterial({ color: 0xcfe8f8, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x2a5a7a, emissiveIntensity: 0.35 });
      M.snow = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.8 });
      inRoom(22, (x, z) => { const r = roomOf(x, z), top = vault(x, z, r), l = 0.5 + rnd() * 1.4; push('ice', at(new THREE.ConeGeometry(0.09 + l * 0.05, l, 6).rotateX(Math.PI), x, top - l / 2, z)); });
      along(6, (x, z, nx, nz) => { const l = 0.4 + rnd() * 1.0; push('ice', at(new THREE.ConeGeometry(0.08, l, 5).rotateX(Math.PI), x - nx * 0.05, 7 - l / 2, z - nz * 0.05)); });
      along(2, (x, z, nx, nz) => { for (let i = 0; i < 5; i++) { const g = new THREE.OctahedronGeometry(1, 0).scale(0.12, 0.5 + rnd() * 0.6, 0.12); push('ice', at(g, x + nx * 0.25 + (rnd() - 0.5) * 0.7, 0.35, z + nz * 0.25 + (rnd() - 0.5) * 0.7, rnd() * 3, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6)); } push('snow', at(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(nz ? 2.4 : 0.8, 0.35, nx ? 2.4 : 0.8), x + nx * 0.1, 0, z + nz * 0.1)); });
    } else if (b === 4) { // Storm: lightning rods on the pillars with live arcs, puddles
      M.iron = new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.9, roughness: 0.35 });
      M.coil = new THREE.MeshStandardMaterial({ color: 0x6a5030, metalness: 0.9, roughness: 0.3, emissive: 0x9fd8ff, emissiveIntensity: 0.4 });
      M.wet = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.75 });
      const X0 = -(P.cols * R) / 2, Z0 = -(P.rows * R) / 2;
      for (let i = 0; i <= P.cols; i++) for (let j = 0; j <= P.rows; j++) { const x = X0 + i * R, z = Z0 + j * R; if (rnd() < 0.45) continue; push('iron', at(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), x, CEIL - 1.6, z + 1.15)); for (let c = 0; c < 6; c++) push('coil', at(new THREE.TorusGeometry(0.18, 0.04, 5, 12), x, CEIL - 2.4 + c * 0.22, z + 1.15, 0, Math.PI / 2)); this.arc(new THREE.Vector3(x, CEIL - 0.4, z + 1.15), new THREE.Vector3(x + (rnd() - 0.5) * 3, CEIL + RISE * 0.6, z + 1.15 + rnd() * 3)); }
      along(1, (x, z, nx, nz) => push('wet', at(new THREE.CircleGeometry(1.2 + rnd(), 18).rotateX(-Math.PI / 2).scale(1.4, 1, 0.9), x + nx * 2, 0.02, z + nz * 2)));
    } else if (b === 5) { // Mirror: mirror panels set into the walls, floating prisms
      M.mirror = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.03 });
      M.prism = new THREE.MeshStandardMaterial({ color: 0xf0f8ff, metalness: 0.3, roughness: 0.02, transparent: true, opacity: 0.65, emissive: 0xffffff, emissiveIntensity: 0.25 });
      along(2, (x, z, nx, nz) => { const s = new THREE.Shape(); s.moveTo(-0.9, 0); s.lineTo(0.9, 0); s.lineTo(0.9, 2.6); s.absarc(0, 2.6, 0.9, 0, Math.PI, false); push('mirror', at(new THREE.ShapeGeometry(s, 8), x - nx * 0.7 + nx * 0.02, 1.2, z - nz * 0.7 + nz * 0.02, Math.atan2(nx, nz))); });
      inRoom(3, (x, z) => { const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0).scale(0.6, 1.4, 0.6), M.prism); o.position.set(x, 6.5 + rnd() * 2, z); this.group.add(o); this.spin.push({ o, s: 0.4 + rnd() * 0.4, bob: rnd() * 6, y0: o.position.y }); });
    } else if (b === 6) { // Abyss: bone spikes over the wall tops, floating red orbs
      M.spike = new THREE.MeshStandardMaterial({ color: 0x120c0c, roughness: 0.35, metalness: 0.2 });
      along(4, (x, z, nx, nz) => { const g = new THREE.ConeGeometry(0.18, 1.6 + rnd(), 6); g.translate(0, 0.8, 0); push('spike', at(g, x - nx * 0.4, 7.6, z - nz * 0.4, 0, nz * 1.0, -nx * 1.0)); });
      along(2, (x, z, nx, nz) => { for (let i = 0; i < 3; i++) { const g = new THREE.ConeGeometry(0.12, 0.9 + rnd() * 0.6, 5); g.translate(0, 0.45, 0); push('spike', at(g, x + nx * 0.2 + (rnd() - 0.5), 0, z + nz * 0.2 + (rnd() - 0.5), 0, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5)); } });
      inRoom(2, (x, z) => { const o = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 10), new THREE.MeshStandardMaterial({ color: 0x200404, emissive: 0xff3a24, emissiveIntensity: 2.2 })); o.position.set(x, 5.5 + rnd() * 2, z); this.group.add(o); this.spin.push({ o, s: 0.2, bob: rnd() * 6, y0: o.position.y }); this.glow(o, 3.2, 0xff3a24, 0.5); });
    } else if (b === 7) { // Clockwork: big gears turning on the walls, pipes along the wall feet
      M.brass = new THREE.MeshStandardMaterial({ color: 0xb8893c, metalness: 0.95, roughness: 0.3 });
      M.pipe = new THREE.MeshStandardMaterial({ color: 0x7a5a34, metalness: 0.9, roughness: 0.38 });
      along(1, (x, z, nx, nz) => { for (const [dy, r, sp] of [[4.2, 1.6, 0.25], [6.4, 0.9, -0.45]] as [number, number, number][]) { const o = new THREE.Mesh(gearGeo(r, 14, 0.18), M.brass); const pivot = new THREE.Group(); pivot.position.set(x - nx * 0.62, dy, z - nz * 0.62); pivot.rotation.y = Math.atan2(nx, nz); pivot.add(o); this.group.add(pivot); this.spin.push({ o, s: sp, z: true }); } });
      for (const s of sides) { if (s.door) continue; const len = R - 3; push('pipe', at(new THREE.CylinderGeometry(0.16, 0.16, len, 10).rotateZ(Math.PI / 2), s.x - s.nx * 0.45, 0.45, s.z - s.nz * 0.45, s.nx ? Math.PI / 2 : 0)); push('pipe', at(new THREE.CylinderGeometry(0.1, 0.1, len, 8).rotateZ(Math.PI / 2), s.x - s.nx * 0.5, 6.4, s.z - s.nz * 0.5, s.nx ? Math.PI / 2 : 0)); }
    } else if (b === 8) { // Starlit: constellation inlays on the floor, floating crystal lanterns
      M.line = new THREE.MeshBasicMaterial({ color: 0x9ae8ff, transparent: true, opacity: 0.55 });
      M.prism = new THREE.MeshStandardMaterial({ color: 0xc8f0ff, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.8, emissive: 0x9ae8ff, emissiveIntensity: 0.9 });
      for (const r of P.rooms) { let px = r.x + (rnd() - 0.5) * 12, pz = r.z + (rnd() - 0.5) * 12; for (let i = 0; i < 6; i++) { const nx2 = r.x + (rnd() - 0.5) * 15, nz2 = r.z + (rnd() - 0.5) * 15; const len = Math.hypot(nx2 - px, nz2 - pz); push('line', at(new THREE.PlaneGeometry(0.06, len).rotateX(-Math.PI / 2), (px + nx2) / 2, 0.025, (pz + nz2) / 2, Math.atan2(nx2 - px, nz2 - pz))); push('line', at(new THREE.CircleGeometry(0.16, 10).rotateX(-Math.PI / 2), nx2, 0.026, nz2)); px = nx2; pz = nz2; } }
      inRoom(3, (x, z) => { const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0).scale(0.6, 1.5, 0.6), M.prism); o.position.set(x, 6 + rnd() * 2.5, z); this.group.add(o); this.spin.push({ o, s: 0.5, bob: rnd() * 6, y0: o.position.y }); this.glow(o, 2.4, 0x9ae8ff, 0.4); });
    } else { // Hundredth Sky: gold banners from the upper walls, cloud wisps under the vault
      M.cloth = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.85, side: THREE.DoubleSide });
      M.gold = new THREE.MeshStandardMaterial({ color: 0xd8b060, metalness: 1, roughness: 0.25 });
      along(1, (x, z, nx, nz) => { const g = new THREE.PlaneGeometry(1.6, 4.4, 2, 8); const p = g.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -2.1) p.setY(i, y - Math.abs(p.getX(i)) * 0.6); p.setZ(i, Math.sin(y * 1.5) * 0.06); } g.computeVertexNormals(); push('cloth', at(g, x - nx * 0.66, 7.6, z - nz * 0.66, Math.atan2(nx, nz))); push('gold', at(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 8).rotateZ(Math.PI / 2), x - nx * 0.6, 9.85, z - nz * 0.6, nx ? Math.PI / 2 : 0)); push('gold', at(new THREE.BoxGeometry(nz ? 1.62 : 0.05, 0.12, nx ? 1.62 : 0.05), x - nx * 0.64, 7.0, z - nz * 0.64)); });
    }
    for (const k of Object.keys(G)) { const me = this.add(G[k], M[k], k !== 'web' && k !== 'line' && k !== 'wet'); if (me && (k === 'lava' || k === 'line' || k === 'wet')) me.castShadow = false; }
  }
  private glow(o: THREE.Object3D, size: number, col: number, op: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op })); s.scale.setScalar(size); o.add(s); return s;
  }
  private flame(x: number, y: number, z: number, col: number, size: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 })); s.scale.set(size * 0.6, size, 1); s.position.set(x, y, z); this.group.add(s);
    this.flick.push({ m: s.material as any, ph: x * 3 + z });
  }
  private arc(a: THREE.Vector3, b: THREE.Vector3) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat); line.frustumCulled = false; this.group.add(line); this.arcs.push({ geo, a, b, mat, last: 0 });
  }
  private particles() {
    const P = this.P, L = this.L, W = P.cols * P.R, D = P.rows * P.R, N = 700;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (rnd() - 0.5) * (W - 2); pos[i * 3 + 1] = rnd() * CEIL; pos[i * 3 + 2] = (rnd() - 0.5) * (D - 2); seed[i] = rnd(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const kind = ['fireflies', 'dust', 'embers', 'snow', 'sparks', 'glitter', 'mist', 'steam', 'stars', 'motes'].indexOf(L.parts);
    const add = !['snow', 'dust', 'steam'].includes(L.parts);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTime: shared.uTime, uC: { value: new THREE.Color(L.pCol) }, uK: { value: kind }, uCeil: { value: CEIL } },
      vertexShader: `uniform float uTime; uniform float uK; uniform float uCeil; attribute float aSeed; varying float vA;
        void main(){ vec3 p = position; float t = uTime*(.4+aSeed*.6) + aSeed*50.;
          float sp = uK==2.? .8 : uK==3.? -.55 : uK==7.? .5 : uK==1.||uK==9.? .06 : uK==6.? .1 : 0.;
          p.y = mod(p.y + t*sp*3., uCeil); p.x += sin(t*.7+aSeed*9.)*(uK==0.?1.2:.5); p.z += cos(t*.6+aSeed*7.)*(uK==0.?1.2:.5);
          vA = uK==0.? .5+.5*sin(t*3.) : uK==4.? step(.92, fract(sin(floor(uTime*9.)+aSeed*91.)*43.7)) : uK==8.||uK==5.? .4+.6*sin(t*4.) : 1.;
          vA *= smoothstep(0., 1.2, p.y) * smoothstep(uCeil, uCeil-1.5, p.y);
          vec4 mv = modelViewMatrix*vec4(p,1.); gl_Position = projectionMatrix*mv;
          float sz = uK==3.? 7. : uK==6.? 60. : uK==7.? 70. : uK==1.? 4. : 5.;
          gl_PointSize = sz * (8. / max(1., -mv.z)) * (.6+aSeed*.8); }`,
      fragmentShader: `uniform vec3 uC; uniform float uK; varying float vA; void main(){ vec2 d = gl_PointCoord-.5; float r = length(d); float a = smoothstep(.5,.0,r);
          if (uK==6.||uK==7.) a *= .12; else if (uK==1.) a *= .35; gl_FragColor = vec4(uC, a*vA); }` });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; this.group.add(pts); this.pts = pts;
  }
  update(t: number) {
    shared.uTime.value = t;
    for (const s of this.spin) { if (s.z) { s.o.rotation.z = t * s.s; continue; } s.o.rotation.y = t * s.s; if (s.bob !== undefined) s.o.position.y = (s.y0 ?? 6) + Math.sin(t * 0.8 + s.bob) * 0.25; }
    for (const f of this.flick) f.m.opacity = this.L.ov === 'slate' ? (Math.sin(t * 37 + f.ph) > 0.97 ? 1 : 0.7) : 0.75 + Math.sin(t * 13 + f.ph) * 0.12 + Math.sin(t * 7.1 + f.ph) * 0.1;
    for (const a of this.arcs) { if (t - a.last < 0.06) continue; a.last = t; const p = a.geo.attributes.position as THREE.BufferAttribute; for (let i = 0; i < 12; i++) { const q = i / 11; p.setXYZ(i, a.a.x + (a.b.x - a.a.x) * q + (Math.random() - 0.5) * 0.5 * Math.sin(q * Math.PI), a.a.y + (a.b.y - a.a.y) * q + (Math.random() - 0.5) * 0.4, a.a.z + (a.b.z - a.a.z) * q + (Math.random() - 0.5) * 0.5 * Math.sin(q * Math.PI)); } p.needsUpdate = true; a.mat.opacity = Math.random() < 0.3 ? 0 : 0.9; }
  }
  /** Interior light for the engine's light pool: the nearest rooms' lights in the theme colour. */
  lights(focus: THREE.Vector3, push: (r: { pos: THREE.Vector3; color: number; intensity: number; distance: number; priority: number }) => void, t: number) {
    const L = this.L;
    const near = this.lightsAt.map((p) => ({ p, d: p.distanceTo(focus) })).sort((a, b) => a.d - b.d).slice(0, 3);
    for (const { p, d } of near) push({ pos: p, color: L.light, intensity: L.lightI * (L.ov === 'slate' ? (Math.sin(t * 29) > 0.96 ? 2.2 : 0.8) : 0.95 + Math.sin(t * 3 + p.x) * 0.05), distance: 26, priority: 0.9 - d / 200 });
  }
}
let glowC: THREE.Texture | null = null;
function glowT() { return (glowC ??= canvasT((g, n) => { const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n); }, 64)); }
function gearGeo(r: number, teeth: number, depth: number) {
  const s = new THREE.Shape(); for (let i = 0; i < teeth * 2; i++) { const a = (i / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? r : r * 1.14, a2 = a + Math.PI / (teeth * 2); if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); s.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr); }
  for (let k = 0; k < 5; k++) { const h = new THREE.Path(); const a = (k / 5) * Math.PI * 2; h.absarc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.2, 0, Math.PI * 2, true); s.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 }); g.translate(0, 0, -depth / 2); return g;
}
