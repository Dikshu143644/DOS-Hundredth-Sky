import * as THREE from 'three';
import type { AnimName, CharacterRig } from './assets';

/** POLISH-1 · procedural, semi-realistic boss rigs (no external assets): the ten Tower guardians, the
 *  three world bosses and the raid boss. Each is a node hierarchy (rigid parts on named joints) built
 *  from tapered, noise-displaced tubes and ellipsoids, with dark PBR materials whose normal/roughness
 *  detail comes from small canvas textures generated once (scales, plates, rock, bone, veins). Motion is
 *  baked into ordinary AnimationClips on those joints (idle breathing, walk/run, bite/claw/slam
 *  attacks, breath, roar, hit, death), so the existing AnimationMixer path drives them. */

// ------------------------------------------------------------------------------------------------ textures
type TexKind = 'scales' | 'plates' | 'rock' | 'bone' | 'crystal' | 'brass' | 'flesh' | 'bark';
const texCache = new Map<string, THREE.Texture>();
function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const sm01 = (x: number) => { const t = Math.max(0, Math.min(1, (x - 0.35) / 0.3)); return t * t * (3 - 2 * t); };
function fbm(x: number, y: number, o = 4) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { v += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return v; }
/** A height field per surface kind (0..1), 128 px. */
function heightField(kind: TexKind, N = 128): Float32Array {
  const h = new Float32Array(N * N);
  const per = (fx: (u: number, v: number) => number) => { for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = fx(i / N, j / N); };
  if (kind === 'scales' || kind === 'bark') {
    const cols = kind === 'scales' ? 8 : 5, rows = kind === 'scales' ? 10 : 14;
    per((u, v) => {
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const r = Math.floor(v * rows) + dj, off = (r & 1) * 0.5, c = Math.floor(u * cols - off) + di;
        const cx = (c + 0.5 + off) / cols, cy = (r + 0.15) / rows;
        let dx = u - cx, dy = v - cy; dx -= Math.round(dx); dy -= Math.round(dy);
        if (dy * rows < -0.2) continue;
        const e = Math.hypot(dx * cols * (kind === 'bark' ? 2.6 : 1.05), dy * rows * 0.75);
        best = Math.max(best, Math.max(0, 1 - e) * (0.65 + 0.35 * hash(c, r)));
      }
      return Math.pow(best, 0.6) * 0.85 + fbm(u * 16, v * 16, 2) * 0.15;
    });
  } else if (kind === 'plates' || kind === 'brass') {
    per((u, v) => { const gu = (u * 4) % 1, gv = (v * 3 + Math.floor(u * 4) * 0.5) % 1; const seam = Math.min(gu, 1 - gu, gv, 1 - gv); const rivet = Math.hypot(gu - 0.12, gv - 0.12) < 0.05 ? 0.35 : 0; return Math.min(1, seam * 8) * 0.7 + fbm(u * 24, v * 24, 3) * 0.22 + rivet; });
  } else if (kind === 'rock') {
    per((u, v) => { const n = fbm(u * 6, v * 6, 5); const cr = Math.abs(fbm(u * 5 + 7, v * 5 + 3, 3) - 0.5); return n * 0.8 + Math.min(1, cr * 9) * 0.2; });
  } else if (kind === 'bone') {
    per((u, v) => fbm(u * 3, v * 20, 4) * 0.7 + fbm(u * 30, v * 30, 2) * 0.3);
  } else if (kind === 'crystal') {
    per((u, v) => { const a = Math.abs(Math.sin(u * 23 + v * 7)), b = Math.abs(Math.sin(u * 9 - v * 19)); return Math.max(a, b) * 0.6 + fbm(u * 10, v * 10, 2) * 0.4; });
  } else {
    per((u, v) => fbm(u * 8, v * 8, 4) * 0.75 + Math.abs(Math.sin(v * 40 + fbm(u * 4, v * 4) * 6)) * 0.25);
  }
  return h;
}
function canvasTex(N: number, fill: (img: ImageData) => void, srgb: boolean, repeat: [number, number]) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!; const img = g.createImageData(N, N); fill(img); g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; return t;
}
export function surface(kind: TexKind) {
  const k = 'n:' + kind;
  if (texCache.has(k)) return { normal: texCache.get(k)!, rough: texCache.get('r:' + kind)!, ao: texCache.get('a:' + kind)! };
  const N = 128, h = heightField(kind, N), str = kind === 'plates' || kind === 'brass' ? 2.2 : kind === 'crystal' ? 1.6 : 3.2;
  const at = (i: number, j: number) => h[((j + N) % N) * N + ((i + N) % N)];
  const rep: [number, number] = kind === 'scales' ? [7, 6] : kind === 'bark' ? [3, 4] : [3, 3];
  const normal = canvasTex(N, (img) => { for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) * str, dy = (at(i, j + 1) - at(i, j - 1)) * str, l = Math.hypot(dx, dy, 1), o = (j * N + i) * 4;
    img.data[o] = (-dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255; } }, false, rep);
  const rough = canvasTex(N, (img) => { for (let p = 0; p < N * N; p++) { const v = 255 * (0.55 + (1 - h[p]) * 0.45); img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = v; img.data[p * 4 + 3] = 255; } }, false, rep);
  const ao = canvasTex(N, (img) => { for (let p = 0; p < N * N; p++) { const v = 255 * (0.62 + h[p] * 0.38); img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = v; img.data[p * 4 + 3] = 255; } }, true, rep);
  texCache.set(k, normal); texCache.set('r:' + kind, rough); texCache.set('a:' + kind, ao);
  return { normal, rough, ao };
}
/** Glowing crack network (lava, lightning seams, abyss veins) used as an emissive map. */
export function veinTex(seed = 1) {
  const k = 'v:' + seed; if (texCache.has(k)) return texCache.get(k)!;
  const N = 128;
  const t = canvasTex(N, (img) => { for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = i / N, v = j / N, n = Math.abs(fbm(u * 5 + seed, v * 5 - seed, 4) - 0.5), m = Math.abs(fbm(u * 11 - seed, v * 11 + seed, 3) - 0.5);
    const c = Math.max(Math.pow(Math.max(0, 1 - n * 30), 2.5), Math.pow(Math.max(0, 1 - m * 40), 3) * 0.35) * (0.4 + 0.6 * sm01(fbm(u * 3 + seed * 2, v * 3, 2))), o = (j * N + i) * 4;
    img.data[o] = 255 * c; img.data[o + 1] = 255 * c; img.data[o + 2] = 255 * c; img.data[o + 3] = 255; } }, true, [2, 2]);
  t.repeat.set(1, 1); texCache.set(k, t); return t;
}
let glowTexC: THREE.Texture | null = null;
export function glowTex() {
  if (glowTexC) return glowTexC;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); glowTexC = new THREE.CanvasTexture(c); return glowTexC;
}

interface MatSpec { color: number; kind: TexKind; rough?: number; metal?: number; emissive?: number; veins?: number; vein?: number; ns?: number }
function pbr(s: MatSpec): THREE.MeshStandardMaterial {
  const t = surface(s.kind);
  const m = new THREE.MeshStandardMaterial({ color: s.color, roughness: s.rough ?? 0.78, metalness: s.metal ?? 0.05, normalMap: t.normal, roughnessMap: t.rough, map: t.ao, normalScale: new THREE.Vector2(s.ns ?? 1, s.ns ?? 1) });
  if (s.veins !== undefined) { m.emissive = new THREE.Color(s.veins); m.emissiveMap = veinTex(s.vein ?? 1); m.emissiveIntensity = 1.25; }
  else if (s.emissive !== undefined) { m.emissive = new THREE.Color(s.emissive); m.emissiveIntensity = 0.25; }
  return m;
}

// ------------------------------------------------------------------------------------------------ geometry
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** A tube along a smooth curve with a radius profile, elliptical cross-section and organic bumps. */
function tube(pts: THREE.Vector3[], rad: (t: number) => number, o: { radial?: number; segs?: number; sx?: number; sy?: number; ref?: THREE.Vector3; bump?: number; seed?: number; flat?: number } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const radial = o.radial ?? 14, segs = o.segs ?? Math.max(8, pts.length * 6), sx = o.sx ?? 1, sy = o.sy ?? 1, bump = o.bump ?? 0.05, seed = o.seed ?? 0;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const ref = o.ref ?? V(0, 1, 0), len = curve.getLength();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, P = curve.getPointAt(t), T = curve.getTangentAt(t).normalize();
    let up = ref.clone().sub(T.clone().multiplyScalar(ref.dot(T))); if (up.lengthSq() < 1e-4) up = V(0, 0, 1).sub(T.clone().multiplyScalar(T.z)); up.normalize();
    const side = new THREE.Vector3().crossVectors(T, up).normalize();
    const r = Math.max(0.0005, rad(t));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const bb = 1 + bump * (Math.sin(t * 23 + a * 3 + seed) * 0.5 + Math.sin(t * 57 - a * 5 + seed * 2) * 0.3 + Math.sin(a * 9 + t * 11) * 0.2);
      const fy = sa < 0 && o.flat ? 1 - o.flat * -sa : 1;
      const d = side.clone().multiplyScalar(ca * sx * r * bb).add(up.clone().multiplyScalar(sa * sy * r * bb * fy));
      pos.push(P.x + d.x, P.y + d.y, P.z + d.z); uv.push(j / radial, (t * len) / Math.max(0.2, r * 4));
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  for (const end of [0, segs]) {
    const P = curve.getPointAt(end / segs), c = pos.length / 3; pos.push(P.x, P.y, P.z); uv.push(0.5, 0.5);
    for (let j = 0; j < radial; j++) { const a = end * (radial + 1) + j; if (end === 0) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals(); return g;
}
/** A lumpy ellipsoid (muscle masses, skulls, rocks). */
function blob(rx: number, ry: number, rz: number, bump = 0.06, seed = 0, seg = 20) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75)); const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 1 + bump * (Math.sin(x * 5 + seed) * Math.cos(y * 4 - seed) + Math.sin(z * 7 + y * 3 + seed) * 0.6); p.setXYZ(i, x * rx * n, y * ry * n, z * rz * n); }
  g.computeVertexNormals(); return g;
}
/** A curved horn / claw / spike: a tube tapering to a point along a bent path (+Y, bending by `bend`). */
function horn(len: number, r0: number, bend: THREE.Vector3, twist = 0, radial = 8) {
  const pts: THREE.Vector3[] = []; for (let i = 0; i <= 5; i++) { const t = i / 5; pts.push(V(bend.x * t * t * len + Math.sin(t * Math.PI) * twist, t * len + bend.y * t * t * len, bend.z * t * t * len)); }
  return tube(pts, (t) => r0 * Math.pow(1 - t, 0.85) + 0.004, { radial, segs: 14, bump: 0.08, ref: V(0, 0, 1) });
}
function plate(w: number, h: number, d: number) { const g = new THREE.ConeGeometry(1, 1, 4, 1); g.rotateY(Math.PI / 4); g.scale(w, h, d); g.translate(0, h / 2, 0); return g; }

// ------------------------------------------------------------------------------------------------ looks
type Arche = 'drake' | 'biped' | 'serpent' | 'eye';
interface Look {
  arche: Arche; skin: MatSpec; armor: MatSpec; horn: MatSpec; eye: number; membrane?: number; wings?: 0 | 2 | 4;
  spikes?: 'thorn' | 'ice' | 'plate' | 'crystal' | 'none'; head?: 'drake' | 'skull' | 'demon' | 'helm' | 'cap' | 'crystal' | 'angel' | 'rock';
  weapon?: 'sword' | 'hammer' | 'spear' | 'blades' | 'claws'; extras?: string[]; bulk?: number; hunch?: number; float?: number;
}
export const BOSS_LOOKS: Record<string, Look> = {
  tb_thornmaw: { arche: 'drake', wings: 0, spikes: 'thorn', head: 'drake', skin: { color: 0x3c4a2a, kind: 'scales', rough: 0.82 }, armor: { color: 0x4a3a26, kind: 'bark', rough: 0.9 }, horn: { color: 0x2a2418, kind: 'bone', rough: 0.7 }, eye: 0xb8ff5a, extras: ['moss', 'vines'], bulk: 1.15 },
  tb_velthar: { arche: 'biped', head: 'skull', weapon: 'sword', skin: { color: 0xb8ac94, kind: 'bone', rough: 0.85 }, armor: { color: 0x4a4640, kind: 'plates', rough: 0.45, metal: 0.75 }, horn: { color: 0xb09048, kind: 'brass', rough: 0.35, metal: 0.9 }, eye: 0x7af0ff, extras: ['crown', 'ribs', 'cape'], bulk: 0.9 },
  tb_cindrax: { arche: 'biped', head: 'demon', weapon: 'hammer', skin: { color: 0x2a2320, kind: 'rock', rough: 0.9, veins: 0xff5a12, vein: 3 }, armor: { color: 0x3a3430, kind: 'plates', rough: 0.5, metal: 0.7 }, horn: { color: 0x1c1816, kind: 'bone', rough: 0.6 }, eye: 0xffa020, extras: ['embers'], bulk: 1.35, hunch: 0.2 },
  tb_glaciel: { arche: 'drake', wings: 2, spikes: 'ice', head: 'drake', skin: { color: 0x5e7a90, kind: 'scales', rough: 0.35, metal: 0.15 }, armor: { color: 0xc8e4f4, kind: 'crystal', rough: 0.12, metal: 0.1 }, horn: { color: 0xd8f0ff, kind: 'crystal', rough: 0.1 }, eye: 0x6ae4ff, membrane: 0x9ab8cc, extras: ['frost'], bulk: 0.95 },
  tb_voltaros: { arche: 'biped', head: 'helm', weapon: 'spear', skin: { color: 0x2c3036, kind: 'rock', rough: 0.8, veins: 0x9fd8ff, vein: 5 }, armor: { color: 0x3a3e44, kind: 'plates', rough: 0.35, metal: 0.85 }, horn: { color: 0x22262a, kind: 'plates', metal: 0.8, rough: 0.4 }, eye: 0xbfe8ff, extras: ['arcs', 'orb'], bulk: 1.25 },
  tb_twin: { arche: 'biped', head: 'crystal', weapon: 'blades', skin: { color: 0xc8d2d8, kind: 'crystal', rough: 0.08, metal: 0.95 }, armor: { color: 0x9aa4ac, kind: 'plates', rough: 0.12, metal: 1 }, horn: { color: 0xe8f0f4, kind: 'crystal', rough: 0.05, metal: 0.6 }, eye: 0xffffff, extras: ['shards', 'cape'], bulk: 0.85 },
  tb_nyxaroth: { arche: 'eye', skin: { color: 0x2a1a1c, kind: 'flesh', rough: 0.55, veins: 0xff2a1a, vein: 7 }, armor: { color: 0x1a1414, kind: 'bone', rough: 0.4, metal: 0.2 }, horn: { color: 0x120e0e, kind: 'bone', rough: 0.5 }, eye: 0xff3a24, float: 2.6 },
  tb_chronarch: { arche: 'biped', head: 'helm', weapon: 'hammer', skin: { color: 0x3a3028, kind: 'brass', rough: 0.4, metal: 0.85 }, armor: { color: 0x8a6a34, kind: 'brass', rough: 0.3, metal: 1 }, horn: { color: 0x5a4a30, kind: 'brass', metal: 0.9, rough: 0.35 }, eye: 0x7affd8, extras: ['gears', 'pipes'], bulk: 1.3 },
  tb_seraphine: { arche: 'biped', head: 'angel', weapon: 'spear', wings: 4, skin: { color: 0xd8d4cc, kind: 'flesh', rough: 0.5 }, armor: { color: 0xc8ccd4, kind: 'plates', rough: 0.25, metal: 0.9 }, horn: { color: 0xe8d8a8, kind: 'brass', metal: 1, rough: 0.25 }, eye: 0xbfe4ff, membrane: 0xe8eef4, extras: ['halo', 'cape'], bulk: 0.85 },
  tb_ascalon: { arche: 'drake', wings: 4, spikes: 'plate', head: 'drake', skin: { color: 0xc8b890, kind: 'scales', rough: 0.35, metal: 0.55 }, armor: { color: 0xe0c070, kind: 'plates', rough: 0.25, metal: 1 }, horn: { color: 0xf4ecd8, kind: 'bone', rough: 0.3 }, eye: 0xfff0a0, membrane: 0xf0e4c0, extras: ['halo'], bulk: 1.05 },
  wb_gorrath: { arche: 'biped', head: 'rock', weapon: 'claws', skin: { color: 0x4a463e, kind: 'rock', rough: 0.95, veins: 0x8affc0, vein: 9 }, armor: { color: 0x5a564c, kind: 'rock', rough: 0.95 }, horn: { color: 0x3a3830, kind: 'rock', rough: 0.9 }, eye: 0x8affc0, extras: ['moss'], bulk: 1.6, hunch: 0.35 },
  wb_vyrnax: { arche: 'serpent', wings: 2, spikes: 'plate', head: 'drake', skin: { color: 0x2e4a52, kind: 'scales', rough: 0.4, metal: 0.3 }, armor: { color: 0xc8d4d0, kind: 'plates', rough: 0.3, metal: 0.6 }, horn: { color: 0xe8e4d8, kind: 'bone', rough: 0.4 }, eye: 0x9affff, membrane: 0x6a8a8e, float: 3.2 },
  wb_mother: { arche: 'biped', head: 'cap', weapon: 'claws', skin: { color: 0x3e3428, kind: 'bark', rough: 0.9 }, armor: { color: 0x4a3a2a, kind: 'bark', rough: 0.85 }, horn: { color: 0x3a3024, kind: 'bark', rough: 0.9 }, eye: 0xd8ff7a, extras: ['tendrils', 'spores'], bulk: 1.3, hunch: 0.45 },
  rb_kaelthar: { arche: 'drake', wings: 2, spikes: 'plate', head: 'drake', skin: { color: 0x1a1618, kind: 'scales', rough: 0.45, metal: 0.35, veins: 0xff7a2a, vein: 13 }, armor: { color: 0x2a2224, kind: 'plates', rough: 0.3, metal: 0.8 }, horn: { color: 0x0e0c0c, kind: 'bone', rough: 0.4 }, eye: 0xffa040, membrane: 0x3a1e1a, extras: ['eclipse'], bulk: 1.15 },
};
export const hasBossLook = (kind: string) => !!BOSS_LOOKS[kind];

// ------------------------------------------------------------------------------------------------ builder
class Kit {
  root = new THREE.Group(); mats: THREE.MeshStandardMaterial[] = []; nodes = new Map<string, THREE.Object3D>(); fx: ((t: number) => void)[] = [];
  skin: THREE.MeshStandardMaterial; armor: THREE.MeshStandardMaterial; hornM: THREE.MeshStandardMaterial; eyeM: THREE.MeshStandardMaterial; memM: THREE.MeshStandardMaterial | null = null;
  constructor(public L: Look) {
    this.skin = pbr(L.skin); this.armor = pbr(L.armor); this.hornM = pbr(L.horn);
    this.eyeM = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: L.eye, emissiveIntensity: 3.2, roughness: 0.2 });
    if (L.membrane !== undefined) this.memM = new THREE.MeshStandardMaterial({ color: L.membrane, roughness: 0.65, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: 0.93, normalMap: surface('flesh').normal });
    this.mats.push(this.skin, this.armor, this.hornM); if (this.memM) this.mats.push(this.memM);
  }
  get(n: string | THREE.Object3D) { return typeof n === 'string' ? this.nodes.get(n)! : n; }
  node(name: string, parent: THREE.Object3D | string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const n = new THREE.Object3D(); n.name = 'B_' + name; n.position.set(x, y, z); n.rotation.set(rx, ry, rz);
    this.get(parent).add(n); this.nodes.set(name, n); return n;
  }
  mesh(parent: string | THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const me = new THREE.Mesh(g, m); me.position.set(x, y, z); me.rotation.set(rx, ry, rz); me.castShadow = true; me.receiveShadow = true; me.frustumCulled = false;
    this.get(parent).add(me); return me;
  }
  eye(parent: string, x: number, y: number, z: number, r: number) {
    this.mesh(parent, new THREE.SphereGeometry(r, 12, 10), this.eyeM, x, y, z);
    this.glow(parent, x, y, z, r * 3.6, this.L.eye, 0.9);
  }
  glow(parent: string | THREE.Object3D, x: number, y: number, z: number, size: number, color: number, op = 0.6) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op }));
    s.scale.setScalar(size); s.position.set(x, y, z); this.get(parent).add(s); return s;
  }
}

/** Dragon skull + jaw on node `head` (facing +Z). */
function drakeHead(k: Kit, s = 1) {
  const L = k.L;
  k.mesh('head', tube([V(0, 0.05, -0.35), V(0, 0.08, 0.1), V(0, 0.02, 0.55), V(0, -0.04, 0.95)].map((v) => v.multiplyScalar(s)), (t) => s * (0.36 - t * 0.2 + Math.sin(t * Math.PI) * 0.04), { sx: 1.05, sy: 0.72, bump: 0.05, flat: 0.4 }), k.skin);
  for (const sd of [-1, 1]) {
    k.mesh('head', blob(0.12 * s, 0.07 * s, 0.32 * s, 0.1, sd), k.armor, sd * 0.2 * s, 0.17 * s, 0.12 * s, 0.15, sd * 0.2, 0);
    k.mesh('head', blob(0.1 * s, 0.14 * s, 0.22 * s, 0.1, sd * 3), k.armor, sd * 0.3 * s, -0.04 * s, -0.12 * s);
    k.eye('head', sd * 0.235 * s, 0.1 * s, 0.34 * s, 0.04 * s);
    k.mesh('head', blob(0.035 * s, 0.025 * s, 0.05 * s, 0.05), new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 1 }), sd * 0.07 * s, 0.0, 0.93 * s); // nostril
    k.mesh('head', horn(0.95 * s, 0.09 * s, V(sd * 0.25, -0.3, -1.2), 0.04), k.hornM, sd * 0.17 * s, 0.2 * s, -0.22 * s, -1.05, 0, -sd * 0.25);
    k.mesh('head', horn(0.5 * s, 0.05 * s, V(sd * 0.3, -0.2, -0.9)), k.hornM, sd * 0.3 * s, 0.02 * s, -0.3 * s, -1.3, 0, -sd * 0.7);
    for (let i = 0; i < 6; i++) k.mesh('head', new THREE.ConeGeometry(0.022 * s, 0.11 * s, 5).rotateX(Math.PI), k.hornM, sd * (0.16 - i * 0.012) * s, -0.2 * s, (0.25 + i * 0.12) * s);
  }
  if (L.skin.veins !== undefined) k.glow('head', 0, -0.02 * s, 0.98 * s, 0.35 * s, L.skin.veins, 0.5);
  k.node('jaw', 'head', 0, -0.12 * s, -0.22 * s);
  k.mesh('jaw', tube([V(0, 0, 0), V(0, -0.08, 0.45), V(0, -0.06, 0.95)].map((v) => v.multiplyScalar(s)), (t) => s * (0.22 - t * 0.12), { sx: 1.1, sy: 0.45, bump: 0.05 }), k.skin);
  for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) k.mesh('jaw', new THREE.ConeGeometry(0.02 * s, 0.1 * s, 5), k.hornM, sd * (0.15 - i * 0.015) * s, -0.02 * s, (0.4 + i * 0.12) * s);
  k.mesh('jaw', blob(0.1 * s, 0.03 * s, 0.35 * s, 0.05), new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.4, emissive: L.skin.veins ?? 0x200808, emissiveIntensity: 0.5 }), 0, 0.0, 0.45 * s);
}

function spikesAlong(k: Kit, parent: string, kind: Look['spikes'], z0: number, z1: number, n: number, h: number, y = 0, scale = 1) {
  if (!kind || kind === 'none') return;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1), z = z0 + (z1 - z0) * t, hh = h * (0.6 + Math.sin(t * Math.PI) * 0.6) * scale;
    if (kind === 'plate') k.mesh(parent, plate(0.05 * scale, hh, hh * 0.9), k.armor, 0, y, z, -0.35, 0, 0);
    else if (kind === 'ice' || kind === 'crystal') { const g = new THREE.OctahedronGeometry(1, 0); g.scale(0.07 * scale, hh, 0.1 * scale); k.mesh(parent, g, k.armor, 0, y + hh * 0.5, z, -0.3, i * 0.7, 0); }
    else k.mesh(parent, horn(hh, 0.05 * scale, V(0, 0, -0.6)), k.hornM, 0, y, z, -0.25, 0, 0);
  }
}

function tri(pts: THREE.Vector3[]) {
  const pos: number[] = []; for (let i = 1; i < pts.length - 1; i++) { const a = pts[0], b = pts[i], c = pts[i + 1]; pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.filter((_, i) => i % 3 !== 1).map((v) => v * 0.5), 2)); g.computeVertexNormals(); return g;
}
/** Bat-like wing: arm + forearm joints (names `name`, `name`F), three fingers, membrane panels. */
function wing(k: Kit, base: string, sd: number, name: string, x: number, y: number, z: number, span: number, rz0 = 0.25) {
  const arm = k.node(name, base, x, y, z, 0, 0, sd * rz0), m = k.memM ?? k.skin, w = span / 3;
  const a = span * 0.4, f = span * 0.5;
  k.mesh(arm, tube([V(0, 0, 0), V(sd * a * 0.5, 0.06, 0.05), V(sd * a, 0, -0.05)], (t) => 0.07 * (1 - t * 0.4) * w, { radial: 8, ref: V(0, 0, 1) }), k.skin);
  const fore = k.node(name + 'F', arm, sd * a, 0, -0.05, 0, sd * 0.35, 0);
  k.mesh(fore, tube([V(0, 0, 0), V(sd * f * 0.5, 0.05, -0.05), V(sd * f, 0.02, -0.1)], (t) => 0.05 * (1 - t * 0.5) * w, { radial: 8, ref: V(0, 0, 1) }), k.skin);
  k.mesh(fore, horn(0.25 * w, 0.035 * w, V(0, -0.3, 0.6)), k.hornM, sd * f, 0.02, -0.1, 0, 0, sd * -1.2);
  const tips = [V(sd * f * 0.95, -0.2 * span, -0.75 * span), V(sd * f * 0.55, -0.35 * span, -0.85 * span), V(sd * f * 0.2, -0.4 * span, -0.7 * span)];
  for (const tp of tips) k.mesh(fore, tube([V(sd * f, 0, -0.1), V((sd * f + tp.x) / 2, tp.y * 0.45, (tp.z - 0.1) / 2), tp], (t) => 0.035 * (1 - t * 0.7) * w, { radial: 6, ref: V(0, 0, 1) }), k.skin);
  // membrane panels with a sagging (scalloped) trailing edge between finger tips
  const edge: THREE.Vector3[] = [];
  const ring = [V(sd * f, 0, -0.1), ...tips, V(0, -0.05, -0.2)];
  for (let i = 1; i < ring.length - 1; i++) { edge.push(ring[i]); const mid = ring[i].clone().lerp(ring[i + 1], 0.5); mid.lerp(ring[0], 0.18); edge.push(mid); }
  edge.push(ring[ring.length - 1]);
  k.mesh(fore, tri([ring[0], ...edge]), m);
  k.mesh(arm, tri([V(0, 0, 0), V(sd * a, 0, -0.05), V(sd * a * 0.96, -0.08, -0.25), V(sd * a * 0.45, -0.25 * w, -0.45 * w), V(0, -0.3 * w, -0.4 * w)]), m);
}

/** Quadruped dragon/wyrm (+Z forward), feet at y=0. */
function buildDrake(k: Kit) {
  const L = k.L, b = L.bulk ?? 1, hip = 1.55;
  k.node('body', k.root, 0, hip, 0);
  k.node('chest', 'body', 0, 0.15, 0.9);
  k.node('torso', 'body', 0, 0, 0);
  k.mesh('torso', tube([V(0, 0.05, -1.5), V(0, 0.1, -0.6), V(0, 0.05, 0.4), V(0, 0.2, 1.25), V(0, 0.42, 1.75)], (t) => b * (0.55 + Math.sin(t * Math.PI) * 0.33 - t * 0.12), { sx: 0.92, sy: 1.0, bump: 0.05, flat: 0.15, segs: 28, radial: 18 }), k.skin);
  for (let i = 0; i < 9; i++) k.mesh('torso', blob(0.4 * b, 0.06, 0.2, 0.05, i), k.armor, 0, -0.62 * b + Math.sin((i / 8) * Math.PI) * -0.18 * b, -1.1 + i * 0.3, 0.12, 0, 0);
  for (const sd of [-1, 1]) { k.mesh('torso', blob(0.42 * b, 0.55 * b, 0.55 * b, 0.07, sd), k.skin, sd * 0.48 * b, -0.05, 1.0); k.mesh('torso', blob(0.46 * b, 0.6 * b, 0.62 * b, 0.07, sd * 2), k.skin, sd * 0.5 * b, -0.05, -1.05); }
  spikesAlong(k, 'torso', L.spikes, -1.4, 1.6, 9, 0.32, 0.6 * b + 0.25, b);
  let prev = 'chest';
  for (let i = 0; i < 4; i++) {
    const nm = 'neck' + i; k.node(nm, prev, 0, i === 0 ? 0.3 : 0.2, i === 0 ? 0.85 : 0.44, i === 0 ? -0.3 : 0.07, 0, 0);
    k.mesh(nm, tube([V(0, 0, -0.2), V(0, 0.1, 0.15), V(0, 0.2, 0.48)], (t) => b * (0.42 - i * 0.05 - t * 0.04), { sx: 0.9, bump: 0.06, seed: i }), k.skin);
    spikesAlong(k, nm, L.spikes, 0.05, 0.05, 1, 0.22, 0.25 * b, b * 0.8);
    prev = nm;
  }
  k.node('head', prev, 0, 0.22, 0.5, 0.3, 0, 0);
  drakeHead(k, 1.5 * b);
  const leg = (nm: string, x: number, z: number, front: boolean) => {
    k.node(nm, 'body', x, -0.05, z);
    const up = front ? 0.82 : 0.95;
    k.mesh(nm, tube([V(0, 0.1, 0), V(Math.sign(x) * 0.05, -up * 0.5, front ? 0.08 : -0.12), V(0, -up, front ? -0.05 : 0.1)], (t) => b * (0.36 - t * 0.13), { bump: 0.07, ref: V(0, 0, 1) }), k.skin);
    k.node(nm + 'L', nm, 0, -up, front ? -0.05 : 0.1, front ? 0.25 : -0.35, 0, 0);
    k.mesh(nm + 'L', tube([V(0, 0, 0), V(0, -0.35, 0.05), V(0, -0.62, 0.02)], (t) => b * (0.21 - t * 0.06), { bump: 0.06, ref: V(0, 0, 1) }), k.skin);
    k.node(nm + 'P', nm + 'L', 0, -0.62, 0.02, front ? -0.25 : 0.35, 0, 0);
    k.mesh(nm + 'P', blob(0.2 * b, 0.1, 0.26 * b, 0.08), k.skin, 0, -0.02, 0.1);
    for (let c = -1; c <= 1; c++) k.mesh(nm + 'P', horn(0.3 * b, 0.05 * b, V(0, -0.9, 0.8)), k.hornM, c * 0.11 * b, 0.02, 0.28 * b, 1.35, c * 0.25, 0);
  };
  leg('legFL', 0.55 * b, 0.95, true); leg('legFR', -0.55 * b, 0.95, true); leg('legBL', 0.58 * b, -1.05, false); leg('legBR', -0.58 * b, -1.05, false);
  prev = 'body';
  for (let i = 0; i < 7; i++) {
    const nm = 'tail' + i; k.node(nm, prev, 0, i === 0 ? 0.05 : 0, i === 0 ? -1.45 : -0.55, i === 0 ? 0.12 : 0.05, 0, 0);
    const r0 = b * (0.42 - i * 0.055), r1 = b * (0.42 - (i + 1) * 0.055);
    k.mesh(nm, tube([V(0, 0, 0.12), V(0, -0.01, -0.3), V(0, 0, -0.62)], (t) => Math.max(0.03, r0 + (r1 - r0) * t), { bump: 0.05, seed: i, flat: 0.1 }), k.skin);
    spikesAlong(k, nm, L.spikes, -0.25, -0.25, 1, 0.22 - i * 0.02, r0 * 0.85, b * (1 - i * 0.08));
    prev = nm;
  }
  k.mesh(prev, horn(0.45 * b, 0.08 * b, V(0, 0.2, -0.3)), k.hornM, 0, 0, -0.6, -1.5, 0, 0);
  if (L.wings) {
    const span = 3.6 * b;
    wing(k, 'chest', 1, 'wingL', 0.42 * b, 0.55 * b, 0.1, span); wing(k, 'chest', -1, 'wingR', -0.42 * b, 0.55 * b, 0.1, span);
    if (L.wings === 4) { wing(k, 'body', 1, 'wingL2', 0.4 * b, 0.55 * b, -0.6, span * 0.7, 0.05); wing(k, 'body', -1, 'wingR2', -0.4 * b, 0.55 * b, -0.6, span * 0.7, 0.05); }
  }
  extras(k, 'chest', 'head');
}

/** Giant humanoid (+Z forward), feet at y=0. */
function buildBiped(k: Kit) {
  const L = k.L, b = L.bulk ?? 1, leg = 1.9;
  k.node('pelvis', k.root, 0, leg, 0);
  k.mesh('pelvis', blob(0.42 * b, 0.3, 0.3 * b, 0.06), k.armor, 0, 0.02, 0);
  k.node('spine', 'pelvis', 0, 0.12, 0, L.hunch ?? 0, 0, 0);
  const ribs = L.extras?.includes('ribs');
  if (ribs) {
    k.mesh('spine', tube([V(0, 0, -0.12), V(0, 0.5, -0.18), V(0, 1.05, -0.12)], () => 0.08, { radial: 8 }), k.skin);
    for (let i = 0; i < 6; i++) { const tg = new THREE.TorusGeometry(0.38 * b * (0.8 + Math.sin((i / 5) * Math.PI) * 0.3), 0.035, 6, 20, Math.PI * 1.55); tg.rotateX(Math.PI / 2); tg.rotateY(Math.PI * 0.725); k.mesh('spine', tg, k.skin, 0, 0.35 + i * 0.12, 0.02); }
    k.glow('spine', 0, 0.62, 0.02, 0.9, L.eye, 0.5);
  } else k.mesh('spine', tube([V(0, -0.05, 0), V(0, 0.4, 0.04), V(0, 0.85, 0.02), V(0, 1.05, -0.02)], (t) => b * (0.34 + t * 0.2 + Math.sin(t * Math.PI) * 0.04), { sx: 1.25, sy: 0.85, bump: 0.06, ref: V(0, 0, 1), radial: 16 }), k.skin);
  k.node('chest', 'spine', 0, 1.0, 0);
  if (!ribs) k.mesh('chest', blob(0.58 * b, 0.36, 0.38 * b, 0.04), k.armor, 0, -0.08, 0.06);
  else k.mesh('chest', blob(0.5 * b, 0.12, 0.3 * b, 0.04), k.armor, 0, 0.12, 0); // collar / gorget over bare ribs
  for (const sd of [-1, 1]) {
    k.mesh('chest', blob(0.32 * b, 0.24 * b, 0.34 * b, 0.06, sd), k.armor, sd * 0.62 * b, 0.12, 0, 0, 0, sd * -0.35);
    if (L.head !== 'cap' && L.head !== 'angel') k.mesh('chest', horn(0.45 * b, 0.07 * b, V(sd * 0.4, 0, -0.5)), k.hornM, sd * 0.72 * b, 0.28, -0.05, -0.2, 0, -sd * 0.6);
  }
  k.node('neck', 'chest', 0, 0.28, 0.04, L.hunch ? -L.hunch * 0.8 : 0, 0, 0);
  k.mesh('neck', tube([V(0, -0.1, 0), V(0, 0.18, 0.03)], () => 0.15 * b, { radial: 10 }), k.skin);
  k.node('head', 'neck', 0, 0.3, 0.04);
  bipedHead(k, b);
  for (const sd of [-1, 1]) {
    const s = sd > 0 ? 'L' : 'R';
    k.node('arm' + s, 'chest', sd * 0.68 * b, 0.0, 0, 0, 0, sd * 0.22);
    k.mesh('arm' + s, tube([V(0, 0.05, 0), V(sd * 0.03, -0.4, 0), V(0, -0.8, 0)], (t) => b * (ribs ? 0.1 : 0.24 - t * 0.06), { bump: 0.07, ref: V(0, 0, 1) }), k.skin);
    k.mesh('arm' + s, blob(0.2 * b, 0.22, 0.2 * b, 0.06), k.armor, 0, -0.45, 0);
    k.node('fore' + s, 'arm' + s, 0, -0.8, 0, -0.35, 0, -sd * 0.08);
    k.mesh('fore' + s, tube([V(0, 0, 0), V(0, -0.38, 0.02), V(0, -0.74, 0)], (t) => b * (0.16 - t * 0.04), { bump: 0.06, ref: V(0, 0, 1) }), k.skin);
    k.mesh('fore' + s, tube([V(0, -0.1, 0), V(0, -0.7, 0)], (t) => b * (0.19 - t * 0.03), { bump: 0.03, ref: V(0, 0, 1), radial: 10 }), k.armor);
    k.node('hand' + s, 'fore' + s, 0, -0.78, 0);
    k.mesh('hand' + s, blob(0.13 * b, 0.15, 0.1 * b, 0.08), k.skin, 0, -0.08, 0.02);
    const wpn = !L.weapon || L.weapon === 'claws' ? 'claws' : sd > 0 && L.weapon !== 'blades' ? 'claws' : L.weapon;
    if (wpn === 'claws') for (let c = -1; c <= 1; c++) k.mesh('hand' + s, horn(0.28 * b, 0.035 * b, V(0, -0.2, 0.7)), k.hornM, c * 0.06 * b, -0.18, 0.06, Math.PI * 0.92, c * 0.2, 0);
    else weaponMesh(k, 'hand' + s, wpn, b);
  }
  for (const sd of [-1, 1]) {
    const s = sd > 0 ? 'L' : 'R';
    k.node('thigh' + s, 'pelvis', sd * 0.27 * b, -0.05, 0);
    k.mesh('thigh' + s, tube([V(0, 0.1, 0), V(sd * 0.02, -0.45, 0.04), V(0, -0.95, 0)], (t) => b * (ribs ? 0.11 : 0.3 - t * 0.1), { bump: 0.06, ref: V(0, 0, 1) }), k.skin);
    k.mesh('thigh' + s, blob(0.22 * b, 0.36, 0.22 * b, 0.05), k.armor, 0, -0.35, 0.02);
    k.node('shin' + s, 'thigh' + s, 0, -0.95, 0);
    k.mesh('shin' + s, tube([V(0, 0, 0), V(0, -0.45, -0.03), V(0, -0.86, 0)], (t) => b * (0.17 - t * 0.04), { bump: 0.05, ref: V(0, 0, 1) }), k.skin);
    k.mesh('shin' + s, plate(0.16 * b, 0.6, 0.1), k.armor, 0, -0.75, 0.12, 0, 0, Math.PI);
    k.node('foot' + s, 'shin' + s, 0, -0.86, 0);
    k.mesh('foot' + s, blob(0.16 * b, 0.09, 0.3 * b, 0.06), k.armor, 0, 0, 0.1);
  }
  if (L.wings) {
    const span = 2.9 * b;
    wing(k, 'chest', 1, 'wingL', 0.25 * b, 0.1, -0.3, span, 0.5); wing(k, 'chest', -1, 'wingR', -0.25 * b, 0.1, -0.3, span, 0.5);
    if (L.wings === 4) { wing(k, 'chest', 1, 'wingL2', 0.2 * b, -0.35, -0.3, span * 0.7, -0.1); wing(k, 'chest', -1, 'wingR2', -0.2 * b, -0.35, -0.3, span * 0.7, -0.1); }
  }
  extras(k, 'chest', 'head');
}

function bipedHead(k: Kit, b: number) {
  const L = k.L, h = L.head;
  const hole = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
  if (h === 'skull') {
    k.mesh('head', blob(0.22 * b, 0.25, 0.25 * b, 0.05), k.skin, 0, 0.12, 0);
    k.node('jaw', 'head', 0, -0.02, 0.05);
    k.mesh('jaw', blob(0.17 * b, 0.07, 0.17 * b, 0.05), k.skin, 0, -0.06, 0.08);
    for (const sd of [-1, 1]) { k.mesh('head', new THREE.SphereGeometry(0.06 * b, 8, 6), hole, sd * 0.09 * b, 0.15, 0.2 * b); k.eye('head', sd * 0.09 * b, 0.15, 0.22 * b, 0.028 * b); }
  } else if (h === 'demon') {
    k.mesh('head', blob(0.22 * b, 0.24, 0.26 * b, 0.07), k.skin, 0, 0.1, 0.02);
    k.mesh('head', blob(0.24 * b, 0.06, 0.1, 0.1), k.armor, 0, 0.19, 0.18 * b);
    k.node('jaw', 'head', 0, -0.03, 0.0);
    k.mesh('jaw', blob(0.19 * b, 0.09, 0.2 * b, 0.06), k.skin, 0, -0.06, 0.1);
    for (const sd of [-1, 1]) {
      k.eye('head', sd * 0.09 * b, 0.14, 0.23 * b, 0.032 * b);
      k.mesh('head', horn(0.75 * b, 0.08 * b, V(sd * 0.8, 0.3, -0.9), 0.05), k.hornM, sd * 0.17 * b, 0.25, 0.0, -0.3, 0, -sd * 0.9);
      for (let i = 0; i < 3; i++) k.mesh('jaw', new THREE.ConeGeometry(0.018 * b, 0.08, 5), k.hornM, sd * (0.05 + i * 0.04) * b, 0.0, 0.24 * b - i * 0.02);
    }
  } else if (h === 'helm') {
    k.mesh('head', blob(0.24 * b, 0.27, 0.26 * b, 0.02), k.armor, 0, 0.12, 0);
    k.mesh('head', new THREE.BoxGeometry(0.3 * b, 0.05, 0.05), k.eyeM, 0, 0.13, 0.25 * b);
    k.glow('head', 0, 0.13, 0.28 * b, 0.6 * b, L.eye, 0.7);
    k.node('jaw', 'head', 0, 0, 0);
    for (const sd of [-1, 1]) k.mesh('head', horn(0.6 * b, 0.06 * b, V(sd * 0.3, 0.2, -0.8)), k.hornM, sd * 0.2 * b, 0.25, 0, -0.5, 0, -sd * 0.4);
    k.mesh('head', plate(0.05, 0.4 * b, 0.35 * b), k.hornM, 0, 0.36, -0.05, -0.3, 0, 0);
  } else if (h === 'crystal') {
    const g = new THREE.OctahedronGeometry(0.26 * b, 1); g.scale(0.85, 1.25, 0.95); k.mesh('head', g, k.skin, 0, 0.15, 0);
    k.node('jaw', 'head', 0, 0, 0);
    for (const sd of [-1, 1]) k.eye('head', sd * 0.08 * b, 0.17, 0.2 * b, 0.025 * b);
    for (let i = 0; i < 5; i++) { const s = new THREE.OctahedronGeometry(0.06 * b, 0); s.scale(0.6, 3, 0.6); k.mesh('head', s, k.hornM, (i - 2) * 0.08 * b, 0.45, -0.05, -0.2, 0, (i - 2) * -0.25); }
  } else if (h === 'angel') {
    k.mesh('head', blob(0.19 * b, 0.23, 0.21 * b, 0.02), k.skin, 0, 0.12, 0);
    k.mesh('head', blob(0.21 * b, 0.12, 0.23 * b, 0.03), k.armor, 0, 0.24, -0.02);
    k.node('jaw', 'head', 0, 0, 0);
    for (const sd of [-1, 1]) k.eye('head', sd * 0.07 * b, 0.14, 0.18 * b, 0.022 * b);
  } else if (h === 'cap') {
    k.mesh('head', blob(0.2 * b, 0.22, 0.22 * b, 0.08), k.skin, 0, 0.05, 0.05);
    const cap = new THREE.SphereGeometry(1.05 * b, 26, 12, 0, Math.PI * 2, 0, Math.PI * 0.42); const p = cap.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) * 0.55 + Math.sin(Math.atan2(z, x) * 7) * 0.03); }
    cap.computeVertexNormals(); const capM = pbr({ color: 0x5a2418, kind: 'flesh', rough: 0.55 }); k.mats.push(capM); k.mesh('head', cap, capM, 0, 0.05, 0);
    const gills = new THREE.CircleGeometry(1.0 * b, 26); gills.rotateX(Math.PI / 2); k.mesh('head', gills, new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9, emissive: L.eye, emissiveIntensity: 0.25, side: THREE.DoubleSide }), 0, 0.05 + 1.05 * b * 0.55 * Math.cos(Math.PI * 0.42), 0);
    for (let i = 0; i < 9; i++) { const a = i * 2.39, r = 0.6 * b * Math.sqrt(i / 9 + 0.1); k.mesh('head', blob(0.09 * b, 0.035, 0.09 * b, 0.1, i), new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.8 }), Math.cos(a) * r, 0.05 + 0.56 * b - r * r * 0.35, Math.sin(a) * r); }
    k.node('jaw', 'head', 0, -0.05, 0.05);
    for (const sd of [-1, 1]) k.eye('head', sd * 0.08 * b, 0.07, 0.2 * b, 0.03 * b);
  } else {
    k.mesh('head', blob(0.3 * b, 0.26, 0.3 * b, 0.18, 4), k.skin, 0, 0.1, 0.05);
    k.node('jaw', 'head', 0, -0.05, 0.05);
    k.mesh('jaw', blob(0.24 * b, 0.1, 0.22 * b, 0.15, 7), k.skin, 0, -0.06, 0.1);
    for (const sd of [-1, 1]) k.eye('head', sd * 0.12 * b, 0.12, 0.3 * b, 0.04 * b);
  }
}

function weaponMesh(k: Kit, handName: string, w: string, b: number) {
  const hand = new THREE.Group(); hand.rotation.x = Math.PI / 2 - 0.45; hand.position.set(0, -0.1, 0.05); k.get(handName).add(hand);
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8e94, metalness: 0.95, roughness: 0.28, normalMap: surface('plates').normal });
  k.mats.push(metal);
  if (w === 'sword') {
    k.mesh(hand, new THREE.CylinderGeometry(0.035 * b, 0.035 * b, 0.4 * b, 8), k.hornM, 0, -0.1, 0.1, Math.PI / 2, 0, 0);
    const bl = new THREE.BoxGeometry(0.16 * b, 0.03 * b, 1.9 * b); bl.translate(0, 0, 1.15 * b); k.mesh(hand, bl, metal, 0, -0.1, 0.1);
    k.mesh(hand, new THREE.BoxGeometry(0.5 * b, 0.07 * b, 0.07 * b), k.hornM, 0, -0.1, 0.2 * b);
  } else if (w === 'hammer') {
    k.mesh(hand, new THREE.CylinderGeometry(0.04 * b, 0.05 * b, 1.6 * b, 8), k.hornM, 0, -0.1, 0.55 * b, Math.PI / 2, 0, 0);
    const head = k.mesh(hand, new THREE.BoxGeometry(0.5 * b, 0.42 * b, 0.62 * b), k.armor, 0, -0.1, 1.35 * b);
    if (k.L.skin.veins !== undefined) k.glow(head, 0, 0, 0, 0.9 * b, k.L.skin.veins, 0.55);
  } else if (w === 'spear') {
    k.mesh(hand, new THREE.CylinderGeometry(0.03 * b, 0.03 * b, 3.0 * b, 8), k.hornM, 0, -0.1, 0.6 * b, Math.PI / 2, 0, 0);
    const tip = new THREE.ConeGeometry(0.1 * b, 0.6 * b, 4); tip.rotateX(Math.PI / 2); k.mesh(hand, tip, metal, 0, -0.1, 2.35 * b);
    k.glow(hand, 0, -0.1, 2.3 * b, 0.8 * b, k.L.eye, 0.6);
  } else if (w === 'blades') {
    const bl = new THREE.BoxGeometry(0.1 * b, 0.02 * b, 1.3 * b); bl.translate(0, 0, 0.75 * b); k.mesh(hand, bl, k.skin, 0, -0.1, 0.05);
  }
}

/** Serpent / sky wyrm: a long floating body chain with a dragon head and wings. */
function buildSerpent(k: Kit) {
  const L = k.L, b = L.bulk ?? 1;
  k.node('body', k.root, 0, L.float ?? 3, 0);
  k.node('chest', 'body', 0, 0, 0);
  let prev = 'chest';
  for (let i = 0; i < 12; i++) {
    const nm = 'seg' + i; k.node(nm, prev, 0, 0, i === 0 ? -0.3 : -0.72);
    const r0 = b * (0.5 - i * 0.034), r1 = b * (0.5 - (i + 1) * 0.034);
    k.mesh(nm, tube([V(0, 0, 0.12), V(0, 0, -0.35), V(0, 0, -0.8)], (t) => Math.max(0.05, r0 + (r1 - r0) * t), { bump: 0.04, seed: i, flat: 0.2 }), k.skin);
    k.mesh(nm, blob(r0 * 0.75, 0.05, 0.3, 0.05, i), k.armor, 0, -r0 * 0.92, -0.35);
    spikesAlong(k, nm, L.spikes, -0.35, -0.35, 1, 0.3 - i * 0.015, r0 * 0.8, b);
    prev = nm;
  }
  k.mesh(prev, horn(0.8 * b, 0.12 * b, V(0, 0.3, -0.4)), k.armor, 0, 0, -0.75, -1.5, 0, 0);
  k.node('neck0', 'chest', 0, 0.1, 0.3, -0.25, 0, 0);
  k.mesh('neck0', tube([V(0, 0, -0.2), V(0, 0.25, 0.3), V(0, 0.4, 0.7)], (t) => b * (0.48 - t * 0.12), { bump: 0.05, flat: 0.2 }), k.skin);
  k.node('head', 'neck0', 0, 0.45, 0.8, 0.4, 0, 0);
  drakeHead(k, 1.2 * b);
  if (L.wings) { wing(k, 'chest', 1, 'wingL', 0.4 * b, 0.3, -0.3, 3.6 * b); wing(k, 'chest', -1, 'wingR', -0.4 * b, 0.3, -0.3, 3.6 * b); }
  for (const sd of [-1, 1]) k.mesh('head', tube([V(0, 0, 0), V(sd * 0.3, -0.1, 0.1), V(sd * 0.8, -0.4, -0.3), V(sd * 1.1, -0.9, -0.6)], (t) => 0.03 * (1 - t) + 0.004, { radial: 5 }), k.hornM, sd * 0.25, -0.1, 0.85);
}

/** The Abyss Eye: a great floating eye in a bone carapace, tentacles below. */
function buildEye(k: Kit) {
  const L = k.L;
  k.node('body', k.root, 0, L.float ?? 2.6, 0);
  k.node('chest', 'body', 0, 0, 0);
  k.node('head', 'chest', 0, 0, 0);
  const sclera = new THREE.MeshStandardMaterial({ color: 0xb8a898, roughness: 0.25, normalMap: surface('flesh').normal, emissive: 0x501010, emissiveIntensity: 0.6, emissiveMap: veinTex(21) });
  k.mats.push(sclera);
  k.mesh('head', new THREE.SphereGeometry(1, 32, 24), sclera);
  k.mesh('head', new THREE.CircleGeometry(0.48, 32), new THREE.MeshStandardMaterial({ color: 0x220806, emissive: L.eye, emissiveIntensity: 2.4, emissiveMap: veinTex(4), roughness: 0.2 }), 0, 0, 0.995);
  k.mesh('head', new THREE.CircleGeometry(0.17, 24).scale(0.45, 1, 1), new THREE.MeshBasicMaterial({ color: 0x000000 }), 0, 0, 1.0);
  k.glow('head', 0, 0, 1.3, 2.6, L.eye, 0.5);
  k.node('lidT', 'head', 0, 0, 0); k.node('jaw', 'head', 0, 0, 0);
  const shell = (up: number) => { const g = new THREE.SphereGeometry(1.12, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.44); if (up < 0) g.rotateX(Math.PI); g.rotateX(up > 0 ? -0.35 : 0.35); return g; };
  k.mesh('lidT', shell(1), k.skin); k.mesh('jaw', shell(-1), k.skin);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; k.mesh('chest', horn(1.1 + (i % 3) * 0.3, 0.12, V(0, 0.2, -0.5)), k.hornM, Math.cos(a) * 0.9, Math.sin(a) * 0.9, -0.4, -Math.PI / 2 + Math.sin(a) * 0.6, 0, -a + Math.PI / 2); }
  for (let t = 0; t < 8; t++) {
    const a = (t / 8) * Math.PI * 2; let prev = 'chest';
    for (let i = 0; i < 5; i++) {
      const nm = `ten${t}_${i}`; k.node(nm, prev, i === 0 ? Math.cos(a) * 0.6 : 0, i === 0 ? -0.6 : -0.55, i === 0 ? Math.sin(a) * 0.6 - 0.2 : 0, i === 0 ? Math.sin(a) * 0.35 : 0, 0, i === 0 ? -Math.cos(a) * 0.35 : 0);
      const r0 = 0.24 - i * 0.04;
      k.mesh(nm, tube([V(0, 0.05, 0), V(0, -0.3, 0), V(0, -0.6, 0)], (q) => Math.max(0.02, r0 - q * 0.04), { radial: 8, ref: V(0, 0, 1), bump: 0.12, seed: t + i }), k.skin);
      prev = nm;
    }
  }
}

const live = (o: THREE.Object3D, fn: (t: number, o: THREE.Object3D) => void) => { o.onBeforeRender = () => fn(performance.now() / 1000, o); };

function extras(k: Kit, chest: string, head: string) {
  const L = k.L, ex = L.extras ?? [], b = L.bulk ?? 1, trunk = k.nodes.has('body') ? 'body' : 'spine';
  if (ex.includes('moss')) {
    const moss = new THREE.MeshStandardMaterial({ color: 0x3e5a24, roughness: 1, normalMap: surface('rock').normal });
    for (let i = 0; i < 8; i++) k.mesh(i % 2 ? chest : trunk, blob(0.2 * b, 0.05, 0.17 * b, 0.25, i), moss, Math.sin(i * 2.1) * 0.35 * b, (L.arche === 'drake' ? 0.55 : 0.4) * b + (i % 3) * 0.05, L.arche === 'drake' ? -0.9 + i * 0.3 : 0.1 + (i % 4) * 0.2);
  }
  if (ex.includes('vines')) {
    const vin = new THREE.MeshStandardMaterial({ color: 0x2f4a22, roughness: 0.85, normalMap: surface('bark').normal });
    for (let i = 0; i < 7; i++) { const x = Math.sin(i * 1.7) * 0.5 * b, z = -1 + i * 0.4; k.mesh(trunk, tube([V(x, 0.6, z), V(x * 1.4, 0.1, z + 0.1), V(x * 1.5, -0.4, z - 0.05), V(x * 1.3, -0.85, z)], (t) => 0.035 * (1 - t * 0.6), { radial: 5, bump: 0.2, seed: i }), vin); }
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3a5a22, roughness: 0.7, side: THREE.DoubleSide });
    for (let i = 0; i < 12; i++) { const g = new THREE.CircleGeometry(0.16, 6); g.scale(0.5, 1, 1); k.mesh(trunk, g, leaf, Math.sin(i * 2.3) * 0.6 * b, 0.55 * b, -1.2 + i * 0.25, -1.2, i, 0); }
  }
  if (ex.includes('crown')) {
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; k.mesh(head, new THREE.ConeGeometry(0.03 * b, 0.22 * b, 4), k.hornM, Math.cos(a) * 0.2 * b, 0.4, Math.sin(a) * 0.2 * b); }
    k.mesh(head, new THREE.TorusGeometry(0.21 * b, 0.03 * b, 6, 24).rotateX(Math.PI / 2), k.hornM, 0, 0.32, 0);
  }
  if (ex.includes('cape')) {
    const cloth = new THREE.MeshStandardMaterial({ color: L.head === 'angel' ? 0xe4e0d8 : L.head === 'crystal' ? 0x9aa0a8 : 0x3a2622, roughness: 0.9, side: THREE.DoubleSide, normalMap: surface('flesh').normal });
    const g = new THREE.PlaneGeometry(1.2 * b, 2.6, 6, 12); const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -Math.sin((x / (1.2 * b) + 0.5) * Math.PI) * 0.15 + Math.sin(y * 3 + x * 4) * 0.05 - (1.3 - y) * 0.08); if (y < -1.1) p.setY(i, y + Math.sin(x * 13) * 0.08); }
    g.translate(0, -1.3, -0.3); g.computeVertexNormals(); k.node('cape', chest, 0, 0.15, -0.15); k.mesh('cape', g, cloth);
  }
  if (ex.includes('halo')) {
    const hm = new THREE.MeshStandardMaterial({ color: 0xffe8a8, emissive: 0xffd878, emissiveIntensity: 1.6, metalness: 1, roughness: 0.2 });
    const dr = L.arche === 'drake', r = dr ? 0.75 * b : 0.45 * b;
    const h = k.mesh(head, new THREE.TorusGeometry(r, 0.03 * b, 8, 48, Math.PI * 1.75), hm, 0, dr ? 0.6 : 0.5, dr ? -0.4 : -0.25, dr ? -0.3 : 0.2, 0, 0.6);
    live(h, (t, o) => { o.rotation.z = 0.6 + t * 0.2; });
  }
  if (ex.includes('eclipse')) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.3 * b, 1.55 * b, 64), new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.3 * b, 48), new THREE.MeshBasicMaterial({ color: 0x050303, side: THREE.DoubleSide }));
    const g = new THREE.Group(); g.add(disc, ring); g.scale.setScalar(0.7); g.position.set(0, 1.5 * b, -1.1); k.get(chest).add(g);
    live(ring, (t, o) => { ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(t * 2.1) * 0.2; });
    k.glow(g, 0, 0, -0.05, 4.6 * b, 0xff7a2a, 0.35);
  }
  if (ex.includes('embers') || ex.includes('spores') || ex.includes('frost') || ex.includes('shards')) {
    const col = ex.includes('embers') ? 0xff8a3a : ex.includes('spores') ? 0xd8ff8a : ex.includes('frost') ? 0xd8f4ff : 0xffffff;
    const g = new THREE.Group(); k.get(chest).add(g);
    const n = ex.includes('shards') ? 9 : 14;
    for (let i = 0; i < n; i++) {
      const o = ex.includes('shards') ? new THREE.Mesh(new THREE.OctahedronGeometry(0.12 * b, 0).scale(0.6, 2, 0.6), k.hornM) : k.glow(g, 0, 0, 0, 0.22 * b, col, 0.9);
      if (ex.includes('shards')) g.add(o);
      const ph = i * 2.399, rad = (ex.includes('shards') ? 1.4 : 1.1) * b;
      live(o, (t, q) => { const a = ph + t * (ex.includes('shards') ? 0.6 : 0.35); const y = ex.includes('shards') ? Math.sin(t + ph) * 0.4 : ((t * 0.35 + ph * 0.13) % 1) * 2.6 - 0.8; q.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad); q.rotation.y = t + ph; });
    }
  }
  if (ex.includes('arcs') || ex.includes('orb')) {
    const orbM = new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: L.eye, emissiveIntensity: 3, roughness: 0.1 });
    k.mesh(chest, new THREE.SphereGeometry(0.16 * b, 16, 12), orbM, 0, 0.0, 0.42 * b);
    const gl = k.glow(chest, 0, 0, 0.45 * b, 1.1 * b, L.eye, 0.7);
    live(gl, (t, o) => { const f = 0.7 + Math.abs(Math.sin(t * 13)) * 0.3 * (Math.sin(t * 3.1) > 0.6 ? 1.6 : 1); o.scale.setScalar(1.1 * b * f); });
    // crackling arcs between the shoulders and the head (jagged lines re-rolled every few frames)
    const arcM = new THREE.LineBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    for (const sd of [-1, 1]) {
      const pts = new Float32Array(10 * 3); const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const line = new THREE.Line(geo, arcM); line.frustumCulled = false; k.get(chest).add(line);
      let last = 0;
      live(line, (t) => { if (t - last < 0.07) return; last = t; for (let i = 0; i < 10; i++) { const q = i / 9; pts[i * 3] = sd * 0.72 * b * (1 - q) + (Math.random() - 0.5) * 0.18 * b * Math.sin(q * Math.PI); pts[i * 3 + 1] = 0.3 + q * 0.55 + (Math.random() - 0.5) * 0.18; pts[i * 3 + 2] = (Math.random() - 0.5) * 0.18; } geo.attributes.position.needsUpdate = true; arcM.opacity = Math.random() < 0.25 ? 0.15 : 0.9; });
    }
  }
  if (ex.includes('gears')) {
    const brass = k.armor;
    const gear = (r: number, teeth: number) => { const s = new THREE.Shape(); for (let i = 0; i < teeth * 2; i++) { const a = (i / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? r : r * 1.16; const a2 = a + Math.PI / (teeth * 2); if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); s.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr); } const h = new THREE.Path(); h.absarc(0, 0, r * 0.35, 0, Math.PI * 2, true); s.holes.push(h); return new THREE.ExtrudeGeometry(s, { depth: 0.06 * b, bevelEnabled: false }); };
    const spots: [number, number, number, number, number][] = [[0, 0.1, -0.42, 0.42, 1], [0.32, -0.25, -0.38, 0.26, -1.6], [-0.3, 0.38, -0.38, 0.22, 2], [0, -0.05, 0.44, 0.2, -2.4]];
    for (const [x, y, z, r, sp] of spots) { const m = k.mesh(chest, gear(r * b, 12), brass, x * b, y, z * b); if (z > 0) m.rotation.y = Math.PI; live(m, (t, o) => { o.rotation.z = t * sp * 0.6; }); }
    const hg = k.mesh(head, gear(0.16 * b, 10), brass, 0, 0.4, -0.12, Math.PI / 2, 0, 0); live(hg, (t, o) => { o.rotation.z = -t; });
  }
  if (ex.includes('pipes')) for (const sd of [-1, 1]) k.mesh(chest, tube([V(sd * 0.2, -0.3, -0.35), V(sd * 0.35, 0.3, -0.5), V(sd * 0.25, 0.9, -0.45)], () => 0.05 * b, { radial: 8, bump: 0 }), k.hornM);
  if (ex.includes('tendrils')) {
    const tm = k.skin;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const tt = k.mesh('head', tube([V(0, 0, 0), V(Math.cos(a) * 0.3, -0.4, Math.sin(a) * 0.3), V(Math.cos(a) * 0.45, -0.95, Math.sin(a) * 0.45), V(Math.cos(a) * 0.4, -1.5, Math.sin(a) * 0.4)], (t) => 0.035 * (1 - t * 0.7) * b, { radial: 6, bump: 0.15, seed: i }), tm, Math.cos(a) * 0.62 * b, 0.0, Math.sin(a) * 0.62 * b); live(tt, (t, o) => { o.rotation.x = Math.sin(t * 1.3 + i) * 0.12; o.rotation.z = Math.cos(t * 1.1 + i) * 0.12; }); }
  }
}

// ------------------------------------------------------------------------------------------------ animation
type Pose = Map<string, { r?: [number, number, number]; p?: [number, number, number]; s?: [number, number, number] }>;
type PoseFn = (t: number, P: Pose, k: Kit) => void;
const S = Math.sin, TAU = Math.PI * 2;
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bell = (a: number, m: number, b: number, x: number) => (x < m ? sm(a, m, x) : 1 - sm(m, b, x));
function R(P: Pose, n: string, x = 0, y = 0, z = 0) { const e = P.get(n) ?? {}; const r = e.r ?? [0, 0, 0]; e.r = [r[0] + x, r[1] + y, r[2] + z]; P.set(n, e); }
function Pp(P: Pose, n: string, x = 0, y = 0, z = 0) { const e = P.get(n) ?? {}; const p = e.p ?? [0, 0, 0]; e.p = [p[0] + x, p[1] + y, p[2] + z]; P.set(n, e); }
function Sc(P: Pose, n: string, x = 1, y = 1, z = 1) { const e = P.get(n) ?? {}; e.s = [x, y, z]; P.set(n, e); }
const has = (k: Kit, n: string) => k.nodes.has(n);

function wings(k: Kit, P: Pose, open: number, flap: number) {
  for (const [nm, sd] of [['wingL', 1], ['wingR', -1], ['wingL2', 1], ['wingR2', -1]] as [string, number][]) {
    if (!has(k, nm)) continue;
    const fold = 1 - open;
    R(P, nm, 0.15 * fold, sd * 1.05 * fold, sd * (0.35 * fold + flap));
    R(P, nm + 'F', 0, -sd * 1.7 * fold, sd * flap * 0.6);
  }
}
function breathe(k: Kit, P: Pose, t: number, amt = 1) {
  const br = S(t * TAU);
  const trunk = has(k, 'torso') ? 'torso' : k.L.arche === 'biped' ? 'chest' : 'head';
  Sc(P, trunk, 1 + 0.025 * br * amt, 1 + 0.03 * br * amt, 1 + 0.015 * br * amt);
  return br;
}

const DRAKE: Record<string, [number, boolean, PoseFn]> = {
  idle: [3.4, true, (t, P, k) => { const br = breathe(k, P, t); Pp(P, 'body', 0, 0.03 * br, 0); R(P, 'neck0', 0.04 * br); R(P, 'neck2', 0, 0.07 * S(t * TAU + 1)); R(P, 'head', -0.05 * br, 0.05 * S(t * TAU * 0.5)); R(P, 'jaw', 0.05 + 0.04 * Math.max(0, br)); for (let i = 0; i < 7; i++) R(P, 'tail' + i, 0, 0.1 * S(t * TAU - i * 0.6)); wings(k, P, 0.05, 0.04 * br); }],
  walk: [1.6, true, (t, P, k) => { const a = S(t * TAU), c = Math.cos(t * TAU); Pp(P, 'body', 0, 0.05 * Math.abs(a), 0); R(P, 'body', 0, 0, 0.03 * a);
    R(P, 'legFL', 0.4 * a); R(P, 'legBR', 0.4 * a); R(P, 'legFR', -0.4 * a); R(P, 'legBL', -0.4 * a);
    R(P, 'legFLL', 0.35 * Math.max(0, -c)); R(P, 'legBRL', -0.35 * Math.max(0, -c)); R(P, 'legFRL', 0.35 * Math.max(0, c)); R(P, 'legBLL', -0.35 * Math.max(0, c));
    R(P, 'neck1', 0, 0.05 * a); R(P, 'head', 0.04 * c); for (let i = 0; i < 7; i++) R(P, 'tail' + i, 0, 0.14 * S(t * TAU - i * 0.7)); wings(k, P, 0.05, 0.03 * a); }],
  run: [0.85, true, (t, P, k) => { const a = S(t * TAU), c = Math.cos(t * TAU); Pp(P, 'body', 0, 0.12 * Math.abs(a), 0); R(P, 'body', 0.04 * c);
    R(P, 'legFL', 0.7 * a); R(P, 'legFR', 0.7 * a); R(P, 'legBL', -0.7 * a); R(P, 'legBR', -0.7 * a); R(P, 'legFLL', 0.5 * Math.max(0, -c)); R(P, 'legFRL', 0.5 * Math.max(0, -c)); R(P, 'legBLL', -0.5 * Math.max(0, c)); R(P, 'legBRL', -0.5 * Math.max(0, c));
    R(P, 'neck0', 0.12); R(P, 'head', 0.1 * c); for (let i = 0; i < 7; i++) R(P, 'tail' + i, 0.04, 0.08 * S(t * TAU - i * 0.7)); wings(k, P, 0.2, 0.15 * a); }],
  attack: [1.2, false, (t, P, k) => { const up = bell(0, 0.35, 0.5, t), hit = bell(0.38, 0.52, 0.95, t); R(P, 'neck0', -0.35 * up + 0.4 * hit); R(P, 'neck1', -0.15 * up + 0.2 * hit); R(P, 'head', -0.25 * up + 0.25 * hit); R(P, 'jaw', 0.75 * bell(0.05, 0.4, 0.55, t)); Pp(P, 'body', 0, 0.08 * up, 0.35 * hit); R(P, 'legFL', -0.2 * up + 0.2 * hit); R(P, 'legFR', -0.2 * up + 0.2 * hit); breathe(k, P, 0.25, 0.5); wings(k, P, 0.4 * up, 0.2 * up); }],
  attack2: [1.3, false, (t, P, k) => { const lift = bell(0, 0.3, 0.55, t), sw = bell(0.3, 0.5, 0.9, t); R(P, 'legFR', -1.1 * lift - 0.2 * sw, 0, -0.5 * sw); R(P, 'legFRL', 0.5 * lift); R(P, 'body', 0, -0.25 * sw + 0.1 * lift, 0.06 * lift); R(P, 'neck0', -0.1 * lift); R(P, 'jaw', 0.4 * lift); for (let i = 0; i < 7; i++) R(P, 'tail' + i, 0, 0.3 * sw * S(i * 0.5 + 1)); wings(k, P, 0.3 * lift, 0); }],
  breath: [1.7, false, (t, P, k) => { const ch = bell(0, 0.25, 0.4, t), bl = bell(0.25, 0.4, 0.9, t); R(P, 'neck0', -0.3 * ch + 0.25 * bl); R(P, 'head', -0.2 * ch + 0.15 * bl, 0.15 * S(t * 9) * bl); R(P, 'jaw', 0.2 * ch + 0.85 * bl); Pp(P, 'body', 0, 0.06 * ch, -0.2 * bl); breathe(k, P, 0.25, 2 * ch); wings(k, P, 0.6 * (ch + bl), 0.1 * ch); }],
  roar: [2.0, false, (t, P, k) => { const r = bell(0, 0.3, 1, t); R(P, 'neck0', -0.45 * r); R(P, 'neck1', -0.15 * r); R(P, 'head', -0.5 * r, 0.12 * S(t * 18) * r); R(P, 'jaw', 0.85 * r); Pp(P, 'body', 0, 0.12 * r, 0); R(P, 'legFL', -0.3 * r); R(P, 'legFR', -0.3 * r); wings(k, P, r, 0.25 * r * S(t * 12)); }],
  hit: [0.45, false, (t, P, k) => { const h = bell(0, 0.15, 1, t); R(P, 'body', 0, 0, 0.08 * h); R(P, 'neck0', -0.2 * h); R(P, 'head', -0.25 * h); R(P, 'jaw', 0.4 * h); wings(k, P, 0.1, 0); }],
  death: [2.2, false, (t, P, k) => { const d = sm(0.05, 0.75, t), slump = sm(0.4, 1, t); Pp(P, 'body', 0, -0.85 * d, 0); R(P, 'body', 0, 0, 1.25 * d); R(P, 'neck0', 0.5 * slump); R(P, 'neck1', 0.3 * slump); R(P, 'head', 0.5 * slump); R(P, 'jaw', 0.4 * slump); for (const l of ['legFL', 'legFR', 'legBL', 'legBR']) R(P, l, 0.3 * d, 0, l.endsWith('L') ? -0.3 * d : 0.3 * d); for (let i = 0; i < 7; i++) R(P, 'tail' + i, 0.06 * d, 0.08 * d); wings(k, P, 0.4 * d, -0.4 * d); }],
};
const BIPED: Record<string, [number, boolean, PoseFn]> = {
  idle: [3.2, true, (t, P, k) => { const br = breathe(k, P, t); R(P, 'spine', 0.02 * br); R(P, 'head', -0.03 * br, 0.08 * S(t * TAU * 0.5)); R(P, 'jaw', 0.03 + 0.03 * Math.max(0, br)); R(P, 'armL', 0, 0, 0.04 * br); R(P, 'armR', -0.25, 0, -0.04 * br); R(P, 'foreR', -0.55); R(P, 'foreL', -0.15); R(P, 'cape', 0.04 + 0.04 * S(t * TAU * 2)); wings(k, P, 0.35, 0.05 * br); }],
  walk: [1.5, true, (t, P, k) => { const a = S(t * TAU), c = Math.cos(t * TAU); Pp(P, 'pelvis', 0, 0.06 * Math.abs(c), 0); R(P, 'pelvis', 0, 0.06 * a); R(P, 'spine', 0.05, -0.08 * a);
    R(P, 'thighL', -0.45 * a); R(P, 'thighR', 0.45 * a); R(P, 'shinL', 0.55 * Math.max(0, a)); R(P, 'shinR', 0.55 * Math.max(0, -a)); R(P, 'footL', -0.2 * a); R(P, 'footR', 0.2 * a);
    R(P, 'armL', 0.35 * a); R(P, 'armR', -0.25 - 0.2 * a); R(P, 'foreR', -0.55); R(P, 'foreL', -0.3); R(P, 'head', 0, 0.05 * a); R(P, 'cape', 0.15 + 0.05 * c); wings(k, P, 0.3, 0.05 * a); }],
  run: [0.85, true, (t, P, k) => { const a = S(t * TAU), c = Math.cos(t * TAU); Pp(P, 'pelvis', 0, 0.12 * Math.abs(c), 0); R(P, 'spine', 0.22, -0.12 * a);
    R(P, 'thighL', -0.8 * a); R(P, 'thighR', 0.8 * a); R(P, 'shinL', 0.9 * Math.max(0, a)); R(P, 'shinR', 0.9 * Math.max(0, -a));
    R(P, 'armL', 0.6 * a); R(P, 'armR', -0.3 - 0.4 * a); R(P, 'foreR', -0.8); R(P, 'foreL', -0.8); R(P, 'cape', 0.5 + 0.1 * c); wings(k, P, 0.4, 0.15 * a); }],
  attack: [1.25, false, (t, P, k) => { const up = bell(0, 0.38, 0.52, t), sl = bell(0.42, 0.55, 1, t); R(P, 'armR', -2.5 * up - 0.9 * sl, 0, -0.3 * up); R(P, 'foreR', -0.5 * up - 0.3 * sl); R(P, 'spine', -0.18 * up + 0.4 * sl, 0.2 * up); R(P, 'thighL', -0.4 * sl); R(P, 'shinL', 0.4 * sl); R(P, 'thighR', 0.2 * sl); Pp(P, 'pelvis', 0, -0.2 * sl, 0.2 * sl); R(P, 'head', -0.2 * up + 0.15 * sl); R(P, 'jaw', 0.4 * up); R(P, 'armL', -0.4 * up); wings(k, P, 0.4 + 0.4 * up, 0.2 * up); }],
  attack2: [1.0, false, (t, P, k) => { const w = bell(0, 0.35, 0.5, t), s = bell(0.35, 0.5, 0.95, t); R(P, 'armL', -1.2 * w - 1.0 * s, 0, 0.9 * w - 0.7 * s); R(P, 'foreL', -0.4 * w); R(P, 'spine', 0, 0.35 * w - 0.45 * s); R(P, 'pelvis', 0, 0.1 * w - 0.15 * s); R(P, 'armR', -0.25); R(P, 'foreR', -0.55); R(P, 'jaw', 0.3 * w); wings(k, P, 0.4, 0); }],
  breath: [1.6, false, (t, P, k) => { const c = bell(0, 0.3, 0.45, t), b = bell(0.3, 0.45, 0.95, t); R(P, 'armL', -1.4 * (c + b) * 0.8, 0, 0.2 * c); R(P, 'armR', -1.4 * (c + b) * 0.8, 0, -0.2 * c); R(P, 'foreL', -0.3 * b); R(P, 'foreR', -0.3 * b); R(P, 'spine', -0.2 * c + 0.15 * b); R(P, 'head', -0.25 * c + 0.1 * b); R(P, 'jaw', 0.5 * b); breathe(k, P, 0.25, 2 * c); wings(k, P, 0.4 + 0.6 * (c + b), 0.15 * c); }],
  roar: [2.0, false, (t, P, k) => { const r = bell(0, 0.3, 1, t); R(P, 'armL', -0.4 * r, 0, 1.0 * r); R(P, 'armR', -0.4 * r, 0, -1.0 * r); R(P, 'foreL', -0.6 * r); R(P, 'foreR', -0.6 * r); R(P, 'spine', -0.3 * r); R(P, 'head', -0.45 * r, 0.1 * S(t * 20) * r); R(P, 'jaw', 0.6 * r); wings(k, P, 0.4 + 0.6 * r, 0.25 * r * S(t * 10)); }],
  hit: [0.45, false, (t, P, k) => { const h = bell(0, 0.15, 1, t); R(P, 'spine', -0.18 * h, 0, 0.06 * h); R(P, 'head', -0.25 * h); R(P, 'armL', 0.2 * h, 0, 0.2 * h); R(P, 'armR', -0.25 + 0.2 * h); R(P, 'foreR', -0.55); wings(k, P, 0.35, 0); }],
  death: [2.4, false, (t, P, k) => { const kn = sm(0, 0.35, t), fall = sm(0.3, 0.85, t); Pp(P, 'pelvis', 0, -1.45 * kn - 0.25 * fall, -0.3 * fall); R(P, 'pelvis', -1.35 * fall); R(P, 'thighL', -1.3 * kn + 1.0 * fall); R(P, 'thighR', -1.0 * kn + 0.9 * fall); R(P, 'shinL', 1.6 * kn - 1.2 * fall); R(P, 'shinR', 1.6 * kn - 1.2 * fall); R(P, 'spine', 0.35 * kn - 0.2 * fall); R(P, 'armL', -0.3, 0, 0.9 * fall); R(P, 'armR', -0.3, 0, -0.9 * fall); R(P, 'head', 0.3 * kn - 0.5 * fall, 0.3 * fall); R(P, 'jaw', 0.35 * fall); wings(k, P, 0.6 * fall, -0.3 * fall); }],
};
const SERPENT: Record<string, [number, boolean, PoseFn]> = {
  idle: [4, true, (t, P, k) => { const br = breathe(k, P, t); Pp(P, 'body', 0, 0.25 * S(t * TAU), 0); for (let i = 0; i < 12; i++) R(P, 'seg' + i, 0.04 * S(t * TAU * 2 - i * 0.5), 0.13 * S(t * TAU - i * 0.65)); R(P, 'neck0', 0.05 * br); R(P, 'head', -0.06 * br, 0.08 * S(t * TAU * 0.5)); R(P, 'jaw', 0.06); wings(k, P, 1, 0.35 * S(t * TAU * 2)); }],
  walk: [2.2, true, (t, P, k) => { Pp(P, 'body', 0, 0.35 * S(t * TAU), 0); for (let i = 0; i < 12; i++) R(P, 'seg' + i, 0.05 * S(t * TAU - i * 0.5), 0.2 * S(t * TAU - i * 0.65)); R(P, 'head', 0.05 * S(t * TAU)); wings(k, P, 1, 0.55 * S(t * TAU * 2)); }],
  run: [1.3, true, (t, P, k) => { Pp(P, 'body', 0, 0.4 * S(t * TAU), 0); for (let i = 0; i < 12; i++) R(P, 'seg' + i, 0.05 * S(t * TAU - i * 0.5), 0.26 * S(t * TAU - i * 0.65)); R(P, 'neck0', 0.15); wings(k, P, 1, 0.7 * S(t * TAU * 2)); }],
  attack: [1.2, false, (t, P, k) => { const up = bell(0, 0.35, 0.5, t), hit = bell(0.38, 0.52, 0.95, t); R(P, 'neck0', -0.45 * up + 0.5 * hit); R(P, 'head', -0.3 * up + 0.3 * hit); R(P, 'jaw', 0.8 * bell(0.05, 0.4, 0.55, t)); Pp(P, 'body', 0, 0.2 * up, 0.6 * hit); for (let i = 0; i < 12; i++) R(P, 'seg' + i, -0.05 * up, 0.1 * S(i)); wings(k, P, 1, 0.5 * up); }],
  attack2: [1.3, false, (t, P, k) => { const s = bell(0.1, 0.5, 0.95, t); for (let i = 4; i < 12; i++) R(P, 'seg' + i, 0, 0.45 * s * S(t * 8 - i * 0.4)); R(P, 'chest', 0, 0.3 * s); wings(k, P, 1, 0.3 * S(t * TAU * 2)); }],
  breath: [1.7, false, (t, P, k) => { const c = bell(0, 0.25, 0.4, t), b = bell(0.25, 0.4, 0.9, t); R(P, 'neck0', -0.3 * c + 0.3 * b); R(P, 'head', -0.2 * c + 0.2 * b, 0.15 * S(t * 9) * b); R(P, 'jaw', 0.2 * c + 0.85 * b); breathe(k, P, 0.25, 2 * c); wings(k, P, 1, 0.4 * c); }],
  roar: [2.0, false, (t, P, k) => { const r = bell(0, 0.3, 1, t); R(P, 'neck0', -0.5 * r); R(P, 'head', -0.5 * r); R(P, 'jaw', 0.85 * r); Pp(P, 'body', 0, 0.5 * r, 0); wings(k, P, 1, 0.6 * r * S(t * 12)); }],
  hit: [0.45, false, (t, P, k) => { const h = bell(0, 0.15, 1, t); R(P, 'chest', 0, 0, 0.12 * h); R(P, 'head', -0.3 * h); R(P, 'jaw', 0.5 * h); wings(k, P, 1, 0.2 * h); }],
  death: [2.4, false, (t, P, k) => { const d = sm(0.05, 0.85, t); Pp(P, 'body', 0, -((k.L.float ?? 3) - 0.45) * d, 0); R(P, 'body', 0, 0, 1.3 * d); for (let i = 0; i < 12; i++) R(P, 'seg' + i, 0, 0.15 * d * S(i * 0.9)); R(P, 'head', 0.4 * d); R(P, 'jaw', 0.4 * d); wings(k, P, 1 - 0.6 * d, -0.6 * d); }],
};
const EYE: Record<string, [number, boolean, PoseFn]> = {
  idle: [4, true, (t, P, k) => { void k; Pp(P, 'body', 0, 0.18 * S(t * TAU), 0); R(P, 'head', 0.05 * S(t * TAU * 0.5), 0.12 * S(t * TAU * 0.25)); const bl = bell(0.86, 0.9, 0.94, t); R(P, 'lidT', 0.55 * bl); R(P, 'jaw', -0.5 * bl); for (let q = 0; q < 8; q++) for (let i = 0; i < 5; i++) R(P, `ten${q}_${i}`, 0.22 * S(t * TAU + q + i * 0.8), 0, 0.18 * S(t * TAU * 2 + q * 1.3 + i)); }],
  walk: [2.4, true, (t, P) => { Pp(P, 'body', 0, 0.25 * S(t * TAU), 0); R(P, 'chest', 0.15); for (let q = 0; q < 8; q++) for (let i = 0; i < 5; i++) R(P, `ten${q}_${i}`, -0.25 + 0.3 * S(t * TAU * 2 + q + i * 0.8), 0, 0.15 * S(t * TAU + q)); }],
  run: [1.4, true, (t, P) => { Pp(P, 'body', 0, 0.3 * S(t * TAU), 0); R(P, 'chest', 0.25); for (let q = 0; q < 8; q++) for (let i = 0; i < 5; i++) R(P, `ten${q}_${i}`, -0.4 + 0.3 * S(t * TAU * 2 + q + i * 0.8)); }],
  attack: [1.2, false, (t, P) => { const c = bell(0, 0.35, 0.5, t), h = bell(0.38, 0.5, 0.95, t); R(P, 'lidT', -0.3 * (c + h)); R(P, 'jaw', 0.3 * (c + h)); Sc(P, 'head', 1 + 0.12 * c, 1 + 0.12 * c, 1 + 0.12 * c); Pp(P, 'body', 0, 0.2 * c, 0.8 * h); for (let q = 0; q < 8; q++) R(P, `ten${q}_0`, -0.6 * h); }],
  attack2: [1.3, false, (t, P) => { const s = bell(0.1, 0.45, 0.95, t); for (let q = 0; q < 8; q++) for (let i = 0; i < 5; i++) R(P, `ten${q}_${i}`, -0.5 * s * S(q * 0.8 + 1), 0, 0.5 * s * Math.cos(q * 0.8)); R(P, 'chest', 0, 0.8 * s); }],
  breath: [1.7, false, (t, P) => { const c = bell(0, 0.25, 0.4, t), b = bell(0.25, 0.4, 0.9, t); R(P, 'lidT', -0.35 * (c + b)); R(P, 'jaw', 0.35 * (c + b)); Sc(P, 'head', 1 + 0.1 * b, 1 + 0.1 * b, 1 + 0.1 * b); R(P, 'head', 0.1 * S(t * 11) * b, 0.2 * S(t * 7) * b); }],
  roar: [2.0, false, (t, P) => { const r = bell(0, 0.3, 1, t); R(P, 'lidT', -0.4 * r); R(P, 'jaw', 0.4 * r); Sc(P, 'head', 1 + 0.15 * r, 1 + 0.15 * r, 1 + 0.15 * r); for (let q = 0; q < 8; q++) R(P, `ten${q}_0`, -0.9 * r * S(q + 1), 0, 0.9 * r * Math.cos(q + 1)); }],
  hit: [0.45, false, (t, P) => { const h = bell(0, 0.12, 1, t); R(P, 'lidT', 0.4 * h); R(P, 'jaw', -0.4 * h); Pp(P, 'body', 0, 0, -0.3 * h); }],
  death: [2.4, false, (t, P, k) => { const d = sm(0.05, 0.85, t); Pp(P, 'body', 0, -((k.L.float ?? 2.6) - 1.0) * d, 0); R(P, 'body', 0.9 * d); R(P, 'lidT', 0.6 * d); R(P, 'jaw', -0.6 * d); for (let q = 0; q < 8; q++) for (let i = 0; i < 5; i++) R(P, `ten${q}_${i}`, 0.25 * d, 0, 0.25 * d * S(q)); }],
};

function bakeClips(k: Kit, set: Record<string, [number, boolean, PoseFn]>) {
  // every joint any clip touches is keyed in every clip (rest where unposed), so cross-fades are clean
  const used = new Map<string, { r: boolean; p: boolean; s: boolean }>();
  for (const [, [, , fn]] of Object.entries(set)) for (const t of [0, 0.25, 0.5, 0.75]) { const P: Pose = new Map(); fn(t, P, k); for (const [n, e] of P) { if (!k.nodes.has(n)) continue; const u = used.get(n) ?? { r: false, p: false, s: false }; u.r ||= !!e.r; u.p ||= !!e.p; u.s ||= !!e.s; used.set(n, u); } }
  const clips: THREE.AnimationClip[] = [];
  const q = new THREE.Quaternion(), eu = new THREE.Euler();
  for (const [name, [D, loop, fn]] of Object.entries(set)) {
    const frames = Math.max(3, Math.round(D * 18) + 1), times: number[] = [];
    const tr = new Map<string, { q: number[]; p: number[]; s: number[] }>();
    for (const n of used.keys()) tr.set(n, { q: [], p: [], s: [] });
    for (let f = 0; f < frames; f++) {
      const ph = f / (frames - 1); times.push(ph * D);
      const P: Pose = new Map(); fn(loop ? ph % 1 : ph, P, k);
      for (const [n, u] of used) {
        const node = k.nodes.get(n)!, e = P.get(n) ?? {}, T = tr.get(n)!;
        if (u.r) { const r = e.r ?? [0, 0, 0]; eu.set(r[0], r[1], r[2]); q.setFromEuler(eu); const out = (node.userData.rq as THREE.Quaternion).clone().multiply(q); T.q.push(out.x, out.y, out.z, out.w); }
        if (u.p) { const p = e.p ?? [0, 0, 0], rp = node.userData.rp as THREE.Vector3; T.p.push(rp.x + p[0], rp.y + p[1], rp.z + p[2]); }
        if (u.s) { const s = e.s ?? [1, 1, 1]; T.s.push(s[0], s[1], s[2]); }
      }
    }
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [n, u] of used) {
      const T = tr.get(n)!, nm = k.nodes.get(n)!.name;
      if (u.r) tracks.push(new THREE.QuaternionKeyframeTrack(nm + '.quaternion', times, T.q));
      if (u.p) tracks.push(new THREE.VectorKeyframeTrack(nm + '.position', times, T.p));
      if (u.s) tracks.push(new THREE.VectorKeyframeTrack(nm + '.scale', times, T.s));
    }
    clips.push(new THREE.AnimationClip('B_' + name, D, tracks));
  }
  return clips;
}

const SETS = { drake: DRAKE, biped: BIPED, serpent: SERPENT, eye: EYE };
/** Build the rig for a boss kind, normalised to `height` metres (top of the body). */
export async function makeBossRig(kind: string, height: number): Promise<CharacterRig & { height: number }> {
  const L = BOSS_LOOKS[kind];
  const k = new Kit(L);
  if (L.arche === 'drake') buildDrake(k); else if (L.arche === 'biped') buildBiped(k); else if (L.arche === 'serpent') buildSerpent(k); else buildEye(k);
  for (const n of k.nodes.values()) { n.userData.rq = n.quaternion.clone(); n.userData.rp = n.position.clone(); }
  // glowing veins breathe (lava, storm seams, abyss, spores)
  for (const m of k.mats) if (m.emissiveMap) { const base = m.emissiveIntensity; let mesh: THREE.Object3D | null = null; k.root.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === m) mesh = o; }); if (mesh) live(mesh, (t) => { m.emissiveIntensity = base * (0.75 + 0.25 * Math.sin(t * 2.3) + 0.1 * Math.sin(t * 7.1)); }); }
  const wrap = new THREE.Group(); wrap.add(k.root);
  k.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  k.root.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) { me.geometry.computeBoundingBox(); box.union(me.geometry.boundingBox!.clone().applyMatrix4(me.matrixWorld)); } });
  const h0 = Math.max(0.5, box.max.y - Math.min(0, box.min.y));
  k.root.scale.setScalar(height / h0);
  const mixer = new THREE.AnimationMixer(wrap);
  const clips = bakeClips(k, SETS[L.arche]);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const c of clips) actions.set(c.name, mixer.clipAction(c));
  const M = (a: string) => 'B_' + a;
  const clipsMap: Partial<Record<AnimName, string>> = {
    idle: M('idle'), combat: M('idle'), talk: M('idle'), sit: M('idle'), work: M('idle'), interact: M('idle'), swim: M('idle'), walk: M('walk'), walkback: M('walk'), run: M('run'), sprint: M('run'),
    jump: M('roar'), fall: M('idle'), land: M('hit'), attack: M('attack'), attack2: M('attack2'), shoot: M('breath'), cast: M('breath'), castshoot: M('breath'), channel: M('breath'),
    hit: M('hit'), death: M('death'), cheer: M('roar'), taunt: M('roar'), spawn: M('roar'), roll: M('hit'), parry: M('hit'),
  };
  const materials = k.mats.filter((m) => m.isMeshStandardMaterial);
  return { root: wrap, mixer, actions, clipsMap, materials, height };
}
