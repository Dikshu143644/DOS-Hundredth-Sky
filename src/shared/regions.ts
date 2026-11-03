import { fbm, ridged, mulberry32, noise2, clamp, smoothstep, lerp } from './rng';
import type { Collider, BoxCollider, ZoneData, TreeInst, PropInst, Building, POI, Vec2 } from './world';

/** Phase 4 · M2: the seven regions. The Capital keeps its hand-built map (world.ts); the other six are
 *  generated deterministically from the configs below, so server and client agree on every metre. */
export type ZoneId = 'capital' | 'forest' | 'mountain' | 'desert' | 'frozen' | 'forbidden' | 'tower';
export const ZONE_IDS: ZoneId[] = ['capital', 'forest', 'mountain', 'desert', 'frozen', 'forbidden', 'tower'];
export interface Shrine { id: string; name: string; x: number; z: number }
export interface Exit { to: ZoneId; x: number; z: number; name: string; yaw: number }
export interface Camp { kinds: string[]; x: number; z: number; n: number }
export type TownStyle = 'camp' | 'stone' | 'adobe' | 'ice' | 'ruin' | 'plaza';
export interface RegionDef {
  id: ZoneId; name: string; faction: string; levels: [number, number]; seed: number;
  /** look: terrain layers (texture names) + multiplicative tints, fog colour/density, grass */
  layers: [string, string, string, string]; tints: [number, number, number, number];
  fog: number; fogDensity: number; grass: number; grassTint: number; leafTint?: number; skyTint?: number;
  terrain: { base: number; amp: number; freq: number; rough: number; ridge: number; dunes?: number };
  trees: { types: number[]; density: number; scale: number }; rocks: number; bushes: number; bushKinds?: string[];
  weather: [string, number][];
  spawn: { x: number; z: number; yaw: number };
  town: { name: string; x: number; z: number; r: number; style: TownStyle };
  shrines: Shrine[]; exits: Exit[]; pois: POI[]; camps: Camp[]; boss: { kind: string; x: number; z: number };
  tower: { x: number; z: number }; water: number;
}
const N = 0, E = -Math.PI / 2, S_ = Math.PI, W = Math.PI / 2; // yaw facing north/east/south/west
const ex = (to: ZoneId, side: 'n' | 's' | 'e' | 'w', name: string, off = 0): Exit => {
  const d = 176;
  return side === 'n' ? { to, x: off, z: -d, name, yaw: S_ } : side === 's' ? { to, x: off, z: d, name, yaw: N } : side === 'e' ? { to, x: d, z: off, name, yaw: W } : { to, x: -d, z: off, name, yaw: E };
};
const FAR_TOWER = { x: 520, z: -2300 };

export const REGIONS: Record<ZoneId, RegionDef> = {
  capital: {
    id: 'capital', name: 'The Capital', faction: 'capital', levels: [1, 10], seed: 100,
    layers: ['grass', 'forest', 'rock', 'cobble'], tints: [0xffffff, 0xffffff, 0xffffff, 0xffffff], fog: 0x9fb4c8, fogDensity: 1, grass: 1, grassTint: 0xffffff,
    terrain: { base: 0, amp: 0, freq: 1, rough: 0, ridge: 0 }, trees: { types: [], density: 0, scale: 1 }, rocks: 0, bushes: 0,
    weather: [['clear', 5], ['rain', 3], ['storm', 1], ['fog', 1]],
    spawn: { x: 0, z: -72, yaw: 0 }, town: { name: 'Capital City', x: 0, z: -122, r: 40, style: 'stone' },
    shrines: [{ id: 'dawn', name: 'Shrine of Dawn', x: 10, z: -66 }, { id: 'whisper', name: 'Whispering Shrine', x: -96, z: 128 }],
    exits: [ex('forest', 's', 'Road to the Ancient Forest', 20), ex('desert', 'e', 'Sunward Road', 30), ex('mountain', 'w', 'Highland Pass', -40)],
    pois: [], camps: [], boss: { kind: 'gravelord', x: 70, z: 84 }, tower: { x: 520, z: -2300 }, water: 0.6,
  },
  forest: {
    id: 'forest', name: 'Ancient Forest', faction: 'forest', levels: [8, 16], seed: 211,
    layers: ['grass', 'forest', 'rock', 'forest'], tints: [0x9fc890, 0xb0a888, 0xa8b8a0, 0x806850], fog: 0x6f8c72, fogDensity: 2.2, grass: 1.3, grassTint: 0xa8e090, leafTint: 0xb8ffa8,
    terrain: { base: 6, amp: 9, freq: 80, rough: 2.2, ridge: 4 }, trees: { types: [0, 1, 2, 3, 6, 0, 1], density: 1.25, scale: 1.65 }, rocks: 0.05, bushes: 0.24,
    weather: [['clear', 3], ['rain', 3], ['fog', 3], ['storm', 1]],
    spawn: { x: 0, z: -160, yaw: S_ }, town: { name: 'Elderwood Haven', x: 46, z: -70, r: 26, style: 'camp' },
    shrines: [{ id: 'elderwood', name: 'Elderwood Shrine', x: 30, z: -52 }, { id: 'heartroot', name: 'Heartroot Shrine', x: -70, z: 70 }],
    exits: [ex('capital', 'n', 'Road to the Capital', 20), ex('forbidden', 's', 'The Withering Path', -30)],
    pois: [{ id: 'hollow', name: 'Heartroot Hollow', x: -110, z: 104, r: 24 }, { id: 'webs', name: 'Weeping Webs', x: 110, z: 60, r: 18 }, { id: 'moss', name: 'Mossmere', x: -90, z: -60, r: 18 }],
    camps: [{ kinds: ['wolf'], x: -40, z: -90, n: 4 }, { kinds: ['mushnub', 'blob'], x: -90, z: -60, n: 5 }, { kinds: ['wolf', 'blob'], x: 10, z: 40, n: 4 }, { kinds: ['spider'], x: 110, z: 60, n: 4 }, { kinds: ['mushnub', 'blob'], x: -60, z: 120, n: 4 }, { kinds: ['spider', 'wolf'], x: 90, z: 130, n: 3 }],
    boss: { kind: 'mushking', x: -110, z: 104 }, tower: FAR_TOWER, water: -50,
  },
  mountain: {
    id: 'mountain', name: 'Mountain Kingdom', faction: 'mountain', levels: [14, 24], seed: 377,
    layers: ['grass', 'rock', 'rock', 'cobble'], tints: [0xa8b890, 0xb0aaa0, 0x9a9890, 0xc0b8b0], fog: 0xa8b4c4, fogDensity: 1.2, grass: 0.6, grassTint: 0xc8d8a0,
    terrain: { base: 14, amp: 26, freq: 110, rough: 3, ridge: 30 }, trees: { types: [4, 5], density: 0.5, scale: 1.7 }, rocks: 0.16, bushes: 0.08,
    weather: [['clear', 4], ['fog', 2], ['rain', 2], ['storm', 2]],
    spawn: { x: 160, z: -40, yaw: W }, town: { name: 'Kharaz Hold', x: 40, z: 30, r: 32, style: 'stone' },
    shrines: [{ id: 'kharaz', name: 'Kharaz Shrine', x: 64, z: 48 }, { id: 'skyforge', name: 'Skyforge Shrine', x: -100, z: -90 }],
    exits: [ex('capital', 'e', 'Highland Pass', -40), ex('frozen', 'n', 'The Frostgate', 30)],
    pois: [{ id: 'quarry', name: 'Old Quarry', x: -80, z: 90, r: 22 }, { id: 'anvil', name: "Giant's Anvil", x: -110, z: -20, r: 26 }, { id: 'skyforge_ruin', name: 'Skyforge Ruins', x: -100, z: -100, r: 18 }],
    camps: [{ kinds: ['rockling'], x: 110, z: 40, n: 4 }, { kinds: ['caveorc', 'rockling'], x: -80, z: 90, n: 5 }, { kinds: ['cragbat'], x: 0, z: -80, n: 4 }, { kinds: ['raider', 'caveorc'], x: -60, z: -120, n: 4 }, { kinds: ['raider', 'cragbat'], x: 100, z: 120, n: 4 }],
    boss: { kind: 'colossus', x: -110, z: -20 }, tower: FAR_TOWER, water: -50,
  },
  desert: {
    id: 'desert', name: 'Sunscorch Desert', faction: 'desert', levels: [20, 30], seed: 433,
    layers: ['sand', 'sand', 'rock', 'cobble'], tints: [0xffe0b0, 0xe8c090, 0xd8b090, 0xe8d0b0], fog: 0xe0c8a0, fogDensity: 1.1, grass: 0, grassTint: 0xd0c080,
    terrain: { base: 5, amp: 6, freq: 120, rough: 0.6, ridge: 3, dunes: 5 }, trees: { types: [7, 8], density: 0.05, scale: 1.4 }, rocks: 0.05, bushes: 0.02, bushKinds: ['Plant_1'],
    weather: [['clear', 6], ['sandstorm', 3]],
    spawn: { x: -160, z: 30, yaw: E }, town: { name: 'Sunspire Oasis', x: -40, z: 30, r: 30, style: 'adobe' },
    shrines: [{ id: 'sunspire', name: 'Sunspire Shrine', x: -18, z: 50 }, { id: 'bonefield', name: 'Bonefield Shrine', x: 100, z: -90 }],
    exits: [ex('capital', 'w', 'Sunward Road', 30), ex('tower', 'n', 'Pilgrim Road to the Tower', 60)],
    pois: [{ id: 'bonefield', name: 'The Bonefield', x: 110, z: -100, r: 24 }, { id: 'sunken', name: 'Sunken Temple', x: 90, z: 100, r: 28 }, { id: 'glass', name: 'Glass Flats', x: -100, z: -90, r: 24 }],
    camps: [{ kinds: ['viper'], x: -100, z: 100, n: 4 }, { kinds: ['sandwasp', 'viper'], x: 20, z: -60, n: 4 }, { kinds: ['scarab'], x: -100, z: -90, n: 4 }, { kinds: ['mummy', 'scarab'], x: 110, z: -100, n: 5 }, { kinds: ['mummy', 'sandwasp'], x: 60, z: 40, n: 4 }],
    boss: { kind: 'sandmaw', x: 90, z: 100 }, tower: { x: 330, z: -1500 }, water: -50,
  },
  frozen: {
    id: 'frozen', name: 'Frozen Lands', faction: 'frozen', levels: [26, 36], seed: 541,
    layers: ['snow', 'snow', 'rock', 'cobble'], tints: [0xffffff, 0xd8e4f0, 0xb8c4d4, 0xc8d4e0], fog: 0xd8e4f0, fogDensity: 1.8, grass: 0.15, grassTint: 0xe0f0ff, leafTint: 0xe8f4ff,
    terrain: { base: 8, amp: 14, freq: 90, rough: 1.4, ridge: 12 }, trees: { types: [4, 5, 7], density: 0.38, scale: 1.6 }, rocks: 0.1, bushes: 0.02,
    weather: [['snow', 5], ['clear', 2], ['blizzard', 2]],
    spawn: { x: 30, z: 160, yaw: N }, town: { name: 'Frosthold', x: -30, z: 60, r: 28, style: 'ice' },
    shrines: [{ id: 'frosthold', name: 'Frosthold Shrine', x: -8, z: 80 }, { id: 'aurora', name: 'Aurora Shrine', x: 80, z: -110 }],
    exits: [ex('mountain', 's', 'The Frostgate', 30)],
    pois: [{ id: 'glacier', name: 'Glacier Maw', x: -100, z: -100, r: 30 }, { id: 'aurora', name: 'Aurora Ridge', x: 90, z: -110, r: 20 }, { id: 'frozenlake', name: 'Mirror of Ice', x: 100, z: 60, r: 26 }],
    camps: [{ kinds: ['frostwolf'], x: 80, z: 100, n: 4 }, { kinds: ['yeti'], x: -110, z: 0, n: 3 }, { kinds: ['wraith', 'glub'], x: 100, z: 60, n: 4 }, { kinds: ['yeti', 'frostwolf'], x: 20, z: -80, n: 4 }, { kinds: ['wraith'], x: 90, z: -110, n: 3 }],
    boss: { kind: 'hrimfang', x: -100, z: -100 }, tower: { x: 900, z: -2200 }, water: -50,
  },
  forbidden: {
    id: 'forbidden', name: 'Forbidden Territory', faction: 'forbidden', levels: [34, 45], seed: 659,
    layers: ['ash', 'forest', 'rock', 'cobble'], tints: [0x8a7088, 0x584860, 0x6a5870, 0x786880], fog: 0x3a2848, fogDensity: 2.4, grass: 0.12, grassTint: 0x806890, leafTint: 0x9060a0, skyTint: 0xa070c0,
    terrain: { base: 4, amp: 12, freq: 70, rough: 3, ridge: 16 }, trees: { types: [7, 8], density: 0.22, scale: 1.8 }, rocks: 0.12, bushes: 0.03,
    weather: [['ash', 4], ['fog', 3], ['storm', 2]],
    spawn: { x: -30, z: -160, yaw: S_ }, town: { name: 'Last Light Outpost', x: 40, z: -100, r: 22, style: 'ruin' },
    shrines: [{ id: 'lastlight', name: 'Last Light Shrine', x: 20, z: -84 }, { id: 'riftedge', name: 'Rift Edge Shrine', x: -60, z: 90 }],
    exits: [ex('forest', 'n', 'The Withering Path', -30)],
    pois: [{ id: 'rift', name: 'The Rift', x: 0, z: 120, r: 30 }, { id: 'obelisks', name: 'Black Obelisks', x: -110, z: -20, r: 24 }, { id: 'citadel', name: 'Fallen Citadel', x: 110, z: 40, r: 26 }],
    camps: [{ kinds: ['imp'], x: -40, z: -40, n: 4 }, { kinds: ['skullghost', 'imp'], x: -110, z: -20, n: 5 }, { kinds: ['squidle'], x: 110, z: 40, n: 4 }, { kinds: ['hywirl', 'squidle'], x: 60, z: 90, n: 4 }, { kinds: ['hywirl', 'skullghost'], x: -80, z: 110, n: 4 }],
    boss: { kind: 'malakar', x: 0, z: 120 }, tower: { x: -600, z: -2600 }, water: -50,
  },
  tower: {
    id: 'tower', name: 'Foot of the Tower', faction: 'tower', levels: [40, 60], seed: 787,
    layers: ['grass', 'cobble', 'rock', 'cobble'], tints: [0xc8d0a8, 0xd8d0c8, 0xc0c0c8, 0xe0d8d0], fog: 0xb8c0e0, fogDensity: 1, grass: 0.7, grassTint: 0xd0e0b0, skyTint: 0xc0c8ff,
    terrain: { base: 8, amp: 8, freq: 100, rough: 1.2, ridge: 6 }, trees: { types: [6, 0], density: 0.2, scale: 1.5 }, rocks: 0.06, bushes: 0.1,
    weather: [['clear', 5], ['storm', 1], ['fog', 1]],
    spawn: { x: 60, z: 160, yaw: N }, town: { name: "Climbers' Rest", x: 0, z: -60, r: 34, style: 'plaza' },
    shrines: [{ id: 'climbers', name: "Climbers' Shrine", x: 24, z: -40 }, { id: 'sky', name: 'Shrine of the Hundredth Sky', x: 0, z: -150 }],
    exits: [ex('desert', 's', 'Pilgrim Road', 60)],
    pois: [{ id: 'gate', name: 'Gate of the Tower', x: 0, z: -170, r: 18 }, { id: 'starfall', name: 'Starfall Crater', x: -110, z: 60, r: 28 }, { id: 'pillars', name: 'Pillars of Ascent', x: 110, z: 20, r: 22 }],
    camps: [{ kinds: ['sentinel'], x: 110, z: 20, n: 4 }, { kinds: ['starspawn', 'construct'], x: -60, z: 0, n: 4 }, { kinds: ['construct'], x: 80, z: -110, n: 3 }, { kinds: ['sentinel', 'starspawn'], x: -40, z: 110, n: 4 }],
    boss: { kind: 'skyfang', x: -110, z: 60 }, tower: { x: 0, z: -330 }, water: -50,
  },
};
/** Where you appear when you walk through `from`'s exit into `to`. */
export function arrivalFor(to: ZoneId, from: ZoneId): { x: number; z: number; yaw: number } {
  const e = REGIONS[to].exits.find((x) => x.to === from);
  if (!e) return REGIONS[to].spawn;
  const l = Math.hypot(e.x, e.z) || 1;
  return { x: e.x - (e.x / l) * 14, z: e.z - (e.z / l) * 14, yaw: e.yaw };
}
export const regionPois = (r: RegionDef): POI[] => [
  { id: 'town', name: r.town.name, x: r.town.x, z: r.town.z, r: r.town.r },
  ...r.pois,
  ...r.shrines.map((s) => ({ id: 'shrine_' + s.id, name: s.name, x: s.x, z: s.z, r: 7 })),
  ...r.exits.map((e) => ({ id: 'exit_' + e.to, name: e.name, x: e.x, z: e.z, r: 12 })),
];

// --------------------------------------------------------------------------------------------
// Generated regions
export interface GenZone { rawHeight(x: number, z: number): number; height(x: number, z: number): number; roads: Vec2[][]; distToRoad(x: number, z: number): number; townMask(x: number, z: number): number; build(): ZoneData }

function distSeg(px: number, pz: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(a.x + dx * t - px, a.z + dz * t - pz);
}
function box(x: number, z: number, hx: number, hz: number, y0: number, y1: number, yaw = 0, tag?: string): BoxCollider { return { kind: 'box', x, z, hx, hz, y0, y1, yaw, tag }; }

export function makeGenZone(r: RegionDef): GenZone {
  const t = r.terrain, seed = r.seed;
  const raw = (x: number, z: number) => {
    let h = t.base + t.amp * fbm(x / t.freq, z / t.freq, 5, seed) + t.rough * fbm(x / 23, z / 23, 3, seed + 9) + t.ridge * ridged(x / 120, z / 120, 3, seed + 3);
    if (t.dunes) h += t.dunes * (0.5 + 0.5 * Math.sin(x / 13 + z / 31 + fbm(x / 90, z / 90, 2, seed + 4) * 7)) * (0.4 + 0.6 * fbm(x / 60, z / 60, 2, seed + 5));
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(165, 290, edge) * (14 + 46 * ridged(x / 110, z / 110, 3, seed + 6)) + smoothstep(420, 1500, edge) * 150 * ridged(x / 320, z / 320, 3, seed + 7);
    return h;
  };
  // flat pads: town, shrines, exits, POIs, boss arena (deterministic order)
  const pads: { x: number; z: number; r: number; y: number }[] = [];
  const pad = (x: number, z: number, rr: number) => pads.push({ x, z, r: rr, y: Math.max(raw(x, z), 1.5) });
  pad(r.town.x, r.town.z, r.town.r + 6);
  for (const s of r.shrines) pad(s.x, s.z, 8);
  for (const e of r.exits) pad(e.x, e.z, 14);
  for (const p of r.pois) pad(p.x, p.z, p.r * 0.7);
  pad(r.spawn.x, r.spawn.z, 8);
  const padded = (x: number, z: number) => {
    let h = raw(x, z);
    for (const p of pads) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r * 1.6) h = lerp(h, p.y, 1 - smoothstep(p.r * 0.75, p.r * 1.6, d)); }
    return h;
  };
  // roads: town → every exit, town → shrines, town → boss
  const roads: Vec2[][] = [];
  const bend = (a: Vec2, b: Vec2): Vec2[] => { const m = { x: (a.x + b.x) / 2 + (noise2(a.x / 50, b.z / 50, seed) - 0.5) * 40, z: (a.z + b.z) / 2 + (noise2(b.x / 50, a.z / 50, seed + 1) - 0.5) * 40 }; return [a, m, b]; };
  const T0 = { x: r.town.x, z: r.town.z };
  for (const e of r.exits) roads.push(bend(T0, { x: e.x, z: e.z }));
  roads.push(bend(T0, { x: r.spawn.x, z: r.spawn.z }));
  for (const s of r.shrines) roads.push(bend(T0, s));
  const distToRoad = (x: number, z: number) => { let d = 1e9; for (const rd of roads) for (let i = 0; i < rd.length - 1; i++) d = Math.min(d, distSeg(x, z, rd[i], rd[i + 1])); return d; };
  const townMask = (x: number, z: number) => 1 - smoothstep(r.town.r * 0.8, r.town.r * 1.1, Math.hypot(x - r.town.x, z - r.town.z));
  const height = (x: number, z: number) => {
    let h = padded(x, z);
    const rd = distToRoad(x, z);
    if (rd < 9) h = lerp(h, padded(x, z) * 0.7 + Math.max(1.5, t.base * 0.3), (1 - smoothstep(3.5, 9, rd)) * 0.5);
    return h;
  };
  let cache: ZoneData | null = null;
  const build = (): ZoneData => {
    if (cache) return cache;
    const colliders: Collider[] = [], buildings: Building[] = [], torches: ZoneData['torches'] = [], ruins: ZoneData['ruins'] = [];
    const rnd = mulberry32(seed + 77);
    const B = 192, TT = 6;
    colliders.push(box(0, -B - TT, B + TT * 2, TT, -100, 400, 0, 'bound'), box(0, B + TT, B + TT * 2, TT, -100, 400, 0, 'bound'), box(-B - TT, 0, TT, B + TT * 2, -100, 400, 0, 'bound'), box(B + TT, 0, TT, B + TT * 2, -100, 400, 0, 'bound'));
    // town
    const tw = r.town, ty = height(tw.x, tw.z);
    const nB = tw.style === 'camp' ? 7 : tw.style === 'ruin' ? 5 : 8;
    for (let i = 0; i < nB; i++) {
      const a = (i / nB) * Math.PI * 2 + 0.4, rr = tw.r * (0.55 + 0.2 * ((i * 37) % 3) / 2);
      const x = tw.x + Math.cos(a) * rr, z = tw.z + Math.sin(a) * rr;
      if (r.exits.some((e) => distSeg(x, z, { x: tw.x, z: tw.z }, e) < 7) || distToRoad(x, z) < 5) continue;
      const big = i === 0;
      const roof: Building['roof'] = tw.style === 'camp' ? 'tent' : tw.style === 'adobe' ? (big ? 'dome' : 'flat') : tw.style === 'ice' ? 'dome' : tw.style === 'stone' ? (big ? 'cone' : 'gable') : tw.style === 'plaza' ? (big ? 'cone' : 'gable') : 'flat';
      const w = roof === 'tent' ? 6 : big ? 11 : 8 + rnd() * 3, d = roof === 'tent' ? 6 : big ? 10 : 7 + rnd() * 2, h = roof === 'tent' ? 3.6 : roof === 'cone' ? 16 : 5 + rnd() * 2;
      const yaw = Math.atan2(tw.x - x, tw.z - z);
      const b: Building = { x, z, w, d, h, yaw, roof, name: big ? (tw.style === 'camp' ? 'Lodge' : tw.style === 'adobe' ? 'Bazaar' : 'Hall') : 'House', y: ty, style: tw.style, broken: tw.style === 'ruin' && i % 2 === 1 };
      buildings.push(b);
      colliders.push(box(x, z, w / 2, d / 2, ty - 2, ty + h + (roof === 'cone' ? 8 : 3), yaw, 'building'));
      torches.push({ x: x + Math.sin(yaw) * (d / 2 + 0.5), y: ty + 2.4, z: z + Math.cos(yaw) * (d / 2 + 0.5) });
    }
    // centrepiece: well / bonfire / obelisk
    colliders.push({ kind: 'cyl', x: tw.x, z: tw.z, r: 2.2, y0: ty - 1, y1: ty + 1.1, tag: 'centre' });
    torches.push({ x: tw.x, y: ty + 1.6, z: tw.z });
    // shrines (fast-travel crystals)
    for (const s of r.shrines) { const g = height(s.x, s.z); colliders.push({ kind: 'cyl', x: s.x, z: s.z, r: 1.1, y0: g - 1, y1: g + 4.5, tag: 'shrine' }); }
    // exit gates: two pillars and a lintel across the road
    for (const e of r.exits) {
      const g = height(e.x, e.z), tx = Math.abs(e.x) > Math.abs(e.z) ? 0 : 1, tz = 1 - tx;
      for (const sgn of [-1, 1]) colliders.push({ kind: 'cyl', x: e.x + tx * sgn * 5, z: e.z + tz * sgn * 5, r: 0.9, y0: g - 2, y1: g + 9, tag: 'gate' });
    }
    // Phase 4 · M5: the Gate of the Tower (two pillars; walking between them opens the floor picker)
    if (r.id === 'tower') for (const sgn of [-1, 1]) { const g = height(sgn * 5, -168); colliders.push({ kind: 'cyl', x: sgn * 5, z: -168, r: 0.9, y0: g - 2, y1: g + 9, tag: 'gate' }); }
    // POI ruins: pillar rings
    for (const p of r.pois) {
      const n = 8 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        if (rnd() < 0.35) continue;
        const a = (i / n) * Math.PI * 2, x = p.x + Math.cos(a) * p.r * 0.75, z = p.z + Math.sin(a) * p.r * 0.75, g = height(x, z);
        if (r.shrines.some((s) => Math.hypot(s.x - x, s.z - z) < 8) || r.exits.some((e) => Math.hypot(e.x - x, e.z - z) < 16) || distToRoad(x, z) < 3.5) continue;
        const broken = rnd() < 0.5, h = broken ? 2 + rnd() * 3 : 6 + rnd() * 4;
        ruins.push({ x, z, h, r: 0.9, broken });
        colliders.push({ kind: 'cyl', x, z, r: 0.95, y0: g - 2, y1: g + h, tag: 'pillar' });
      }
    }
    // scatter
    const trees: TreeInst[] = [], rocks: PropInst[] = [], bushes: PropInst[] = [];
    const cell = 6.5, kinds = r.bushKinds ?? ['Bush', 'Bush_Large', 'Bush_Flowers', 'Plant_1', 'Flower_1_Clump', 'Flower_3_Clump'];
    const clearR = [...regionPois(r), { x: r.spawn.x, z: r.spawn.z, r: 14 }];
    for (let gx = -240; gx < 240; gx += cell) for (let gz = -240; gz < 240; gz += cell) {
      const x = gx + rnd() * cell, z = gz + rnd() * cell;
      const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
      if (distToRoad(x, z) < 6.5 || townMask(x, z) > 0.01) continue;
      if (clearR.some((p) => Math.hypot(x - p.x, z - p.z) < p.r)) continue;
      const edge = Math.max(Math.abs(x), Math.abs(z)), h = height(x, z);
      const dens = r.trees.density * (0.45 + 0.75 * fbm(x / 55, z / 55, 3, seed + 21)) + smoothstep(170, 200, edge) * 0.3 * r.trees.density;
      if (r1 < dens * 0.62) {
        const type = r.trees.types[Math.floor(r2 * r.trees.types.length)];
        const s = r.trees.scale * (0.8 + r4 * 0.6);
        trees.push({ type, x, z, s, rot: r3 * Math.PI * 2 });
        if (edge < B + 4) colliders.push({ kind: 'cyl', x, z, r: 0.32 * s, y0: h - 2, y1: h + 8 * s, tag: 'tree' });
      } else if (r1 < dens * 0.62 + r.rocks) {
        const s = 0.8 + r4 * 2.2;
        rocks.push({ model: 'Rock_' + (1 + Math.floor(r2 * 5)), x, y: h - 0.2 * s, z, s, rot: r3 * 6.28 });
        if (s > 1.1 && edge < B + 4) colliders.push({ kind: 'cyl', x, z, r: 0.42 * s, y0: h - 2, y1: h + 0.9 * s, tag: 'rock' });
      } else if (r1 < dens * 0.62 + r.rocks + r.bushes) {
        bushes.push({ model: kinds[Math.floor(r2 * kinds.length)], x, y: h, z, s: 0.9 + r4 * 0.8, rot: r3 * 6.28 });
      }
    }
    cache = { colliders, trees, rocks, bushes, buildings, ruins, torches };
    return cache;
  };
  return { rawHeight: raw, height, roads, distToRoad, townMask, build };
}
