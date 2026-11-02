import { fbm, ridged, mulberry32, noise2, clamp, smoothstep, lerp } from './rng';

/** The starter zone: edge of the Capital City (north) and the Ancient Forest (south).
 *  Everything here is deterministic and pure so the server validates movement against
 *  exactly the same geometry the client renders. */

export const WORLD_SEED = 100;
export const ZONE_HALF = 200;          // playable half-extent (m)
export const BOUND = 192;              // invisible boundary
export const WATER_LEVEL = 0.6;
export const CITY_Y = 5;
export const CITY = { x0: -150, x1: 150, z0: -160, z1: -92 }; // plateau inside walls
export const WALL_Z = -90;
export const GATE_HALF = 6;
export const LAKE = { x: -78, z: 22, r: 34 };
export const TOWER = { x: 520, z: -2300, height: 1900, radius: 120 };
export const SPAWN = { x: 0, z: -72, yaw: 0 };

export type Vec2 = { x: number; z: number };
export interface POI { id: string; name: string; x: number; z: number; r: number }
export const POIS: POI[] = [
  { id: 'gate', name: 'Gate of Dawn', x: 0, z: -84, r: 14 },
  { id: 'plaza', name: 'Plaza of the First Sky', x: 0, z: -122, r: 18 },
  { id: 'lake', name: 'Lake Mirrorveil', x: LAKE.x, z: LAKE.z, r: LAKE.r + 8 },
  { id: 'ruins', name: 'Hollow Ruins', x: 70, z: 84, r: 24 },
  { id: 'shrine', name: 'Whispering Shrine', x: -104, z: 122, r: 14 },
  { id: 'glade', name: 'Ember Glade', x: 118, z: 4, r: 18 },
  { id: 'camp', name: "Wanderer's Camp", x: -30, z: 52, r: 12 },
];

/** Road polyline from the gate into the forest. */
export const ROAD: Vec2[] = [
  { x: 0, z: -160 }, { x: 0, z: -84 }, { x: 2, z: -50 }, { x: 14, z: -10 }, { x: 34, z: 30 }, { x: 58, z: 64 }, { x: 70, z: 84 },
];
export const ROAD2: Vec2[] = [
  { x: 14, z: -10 }, { x: -12, z: 30 }, { x: -30, z: 52 }, { x: -62, z: 88 }, { x: -104, z: 122 },
];
export const ROAD3: Vec2[] = [ { x: 14, z: -10 }, { x: 60, z: -6 }, { x: 118, z: 4 } ];

function distSeg(px: number, pz: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
  const qx = a.x + dx * t - px, qz = a.z + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}
export function distToRoad(x: number, z: number): number {
  let d = 1e9;
  for (const r of [ROAD, ROAD2, ROAD3]) for (let i = 0; i < r.length - 1; i++) d = Math.min(d, distSeg(x, z, r[i], r[i + 1]));
  return d;
}

/** 0 = outside city plateau, 1 = fully inside. */
export function cityMask(x: number, z: number): number {
  const dx = Math.max(CITY.x0 - x, 0, x - CITY.x1);
  const dz = Math.max(CITY.z0 - z, 0, z - CITY.z1 - 6);
  return 1 - smoothstep(0, 22, Math.sqrt(dx * dx + dz * dz));
}

function rawHeight(x: number, z: number): number {
  let h = 5.5 * fbm(x / 95, z / 95, 5, WORLD_SEED) + 1.6 * fbm(x / 23, z / 23, 3, WORLD_SEED + 9) + 4.2;
  // gentle bowl toward the lake
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  const lakeT = 1 - smoothstep(LAKE.r * 0.35, LAKE.r * 1.35, ld);
  h = lerp(h, WATER_LEVEL - 3.2, lakeT);
  // outer mountains ring (natural world border)
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const m = smoothstep(165, 290, edge);
  h += m * (12 + 42 * ridged(x / 110, z / 110, 3, WORLD_SEED + 3)) + smoothstep(420, 1500, edge) * 140 * ridged(x / 320, z / 320, 3, WORLD_SEED + 5);
  return h;
}

/** Terrain height, the single source of truth for ground. */
export function heightAt(x: number, z: number): number {
  let h = rawHeight(x, z);
  const c = cityMask(x, z);
  if (c > 0) h = lerp(h, CITY_Y, c);
  const rd = distToRoad(x, z);
  if (rd < 9) {
    const t = 1 - smoothstep(3.5, 9, rd);
    const target = lerp(rawHeight(x, z) * 0.6 + 2.0, CITY_Y, c);
    h = lerp(h, Math.max(target, WATER_LEVEL + 0.8), t * 0.85);
  }
  return h;
}

export function normalAt(x: number, z: number): { x: number; y: number; z: number } {
  const e = 0.5;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return { x: nx / l, y: ny / l, z: nz / l };
}

// ---------------------------------------------------------------------------------
// Colliders
export interface BoxCollider { kind: 'box'; x: number; z: number; hx: number; hz: number; y0: number; y1: number; yaw: number; tag?: string }
export interface CylCollider { kind: 'cyl'; x: number; z: number; r: number; y0: number; y1: number; tag?: string }
export type Collider = BoxCollider | CylCollider;

export interface TreeInst { type: number; x: number; z: number; s: number; rot: number }
export interface PropInst { model: string; x: number; y: number; z: number; s: number; rot: number }
export interface Building { x: number; z: number; w: number; d: number; h: number; yaw: number; roof: 'gable' | 'cone' | 'flat'; name: string }

export const TREE_TYPES = ['NormalTree_1', 'NormalTree_2', 'NormalTree_3', 'NormalTree_4', 'PineTree_1', 'PineTree_2', 'BirchTree_1', 'DeadTree_1', 'DeadTree_3'];

export interface ZoneData {
  colliders: Collider[];
  trees: TreeInst[];
  rocks: PropInst[];
  bushes: PropInst[];
  buildings: Building[];
  ruins: { x: number; z: number; h: number; r: number; broken: boolean }[];
  torches: { x: number; y: number; z: number }[];
}

function box(x: number, z: number, hx: number, hz: number, y0: number, y1: number, yaw = 0, tag?: string): BoxCollider {
  return { kind: 'box', x, z, hx, hz, y0, y1, yaw, tag };
}

let cached: ZoneData | null = null;
export function buildZone(): ZoneData {
  if (cached) return cached;
  const colliders: Collider[] = [];
  const buildings: Building[] = [];
  const torches: { x: number; y: number; z: number }[] = [];
  const W = 1.6; // wall half thickness
  const WH = 11;
  // South city wall with the Gate of Dawn
  colliders.push(box((-152 - GATE_HALF) / 2, WALL_Z, (152 - GATE_HALF) / 2, W, CITY_Y - 4, CITY_Y + WH, 0, 'wall'));
  colliders.push(box((152 + GATE_HALF) / 2, WALL_Z, (152 - GATE_HALF) / 2, W, CITY_Y - 4, CITY_Y + WH, 0, 'wall'));
  // gate towers
  for (const sx of [-1, 1]) {
    colliders.push(box(sx * (GATE_HALF + 3.2), WALL_Z, 3.2, 3.6, CITY_Y - 4, CITY_Y + WH + 6, 0, 'tower'));
    torches.push({ x: sx * (GATE_HALF + 0.4), y: CITY_Y + 3.2, z: WALL_Z + 2.2 });
  }
  // gate arch lintel (blocks jumping over the gate top)
  colliders.push(box(0, WALL_Z, GATE_HALF, W, CITY_Y + 7.5, CITY_Y + WH, 0, 'arch'));
  // side + north walls (the inner city is closed in this slice)
  colliders.push(box(-152, -125, W, 36, CITY_Y - 4, CITY_Y + WH, 0, 'wall'));
  colliders.push(box(152, -125, W, 36, CITY_Y - 4, CITY_Y + WH, 0, 'wall'));
  colliders.push(box(0, -162, 152, W, CITY_Y - 4, CITY_Y + WH + 2, 0, 'wall'));
  // Buildings inside the walls
  const bdefs: Building[] = [
    { x: -30, z: -108, w: 12, d: 9, h: 7, yaw: 0, roof: 'gable', name: 'The Sleeping Wyvern (tavern)' },
    { x: 32, z: -106, w: 10, d: 8, h: 6, yaw: 0, roof: 'gable', name: "Borin's Forge" },
    { x: -52, z: -138, w: 11, d: 10, h: 8, yaw: 0.0, roof: 'gable', name: 'Guildhall' },
    { x: 52, z: -140, w: 9, d: 9, h: 7, yaw: 0, roof: 'gable', name: 'House' },
    { x: 76, z: -118, w: 8, d: 10, h: 6, yaw: 0, roof: 'gable', name: 'House' },
    { x: -80, z: -116, w: 9, d: 8, h: 6, yaw: 0, roof: 'gable', name: 'House' },
    { x: 0, z: -150, w: 9, d: 9, h: 22, yaw: 0, roof: 'cone', name: 'Archive Spire' },
    { x: -104, z: -140, w: 10, d: 12, h: 7, yaw: 0, roof: 'gable', name: 'Stables' },
    { x: 104, z: -136, w: 12, d: 10, h: 8, yaw: 0, roof: 'gable', name: 'Chapel of Dawn' },
  ];
  for (const b of bdefs) {
    buildings.push(b);
    colliders.push(box(b.x, b.z, b.w / 2, b.d / 2, CITY_Y - 2, CITY_Y + b.h + 4, b.yaw, 'building'));
    torches.push({ x: b.x, y: CITY_Y + 2.6, z: b.z + b.d / 2 + 0.35 });
  }
  // plaza fountain
  colliders.push({ kind: 'cyl', x: 0, z: -122, r: 3.4, y0: CITY_Y - 1, y1: CITY_Y + 0.9, tag: 'fountain' });
  colliders.push({ kind: 'cyl', x: 0, z: -122, r: 0.7, y0: CITY_Y - 1, y1: CITY_Y + 3.2, tag: 'fountain' });
  // market stalls
  for (const [x, z] of [[14, -126], [-14, -126], [18, -114]]) colliders.push(box(x, z, 1.6, 1.1, CITY_Y - 1, CITY_Y + 1.1, 0, 'stall'));
  // World boundary (invisible) — the mountains look like the border, this guarantees it.
  const B = BOUND, T = 6;
  colliders.push(box(0, -B - T, B + T * 2, T, -100, 400, 0, 'bound'));
  colliders.push(box(0, B + T, B + T * 2, T, -100, 400, 0, 'bound'));
  colliders.push(box(-B - T, 0, T, B + T * 2, -100, 400, 0, 'bound'));
  colliders.push(box(B + T, 0, T, B + T * 2, -100, 400, 0, 'bound'));

  // Hollow Ruins: a broken ring of pillars
  const ruins: ZoneData['ruins'] = [];
  const rnd = mulberry32(WORLD_SEED + 77);
  const R = POIS.find((p) => p.id === 'ruins')!;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = R.x + Math.cos(a) * 15, z = R.z + Math.sin(a) * 15;
    const broken = rnd() < 0.45;
    const h = broken ? 2 + rnd() * 3 : 8 + rnd() * 2;
    const g = heightAt(x, z);
    ruins.push({ x, z, h, r: 0.9, broken });
    colliders.push({ kind: 'cyl', x, z, r: 0.95, y0: g - 2, y1: g + h, tag: 'pillar' });
  }
  // ruined wall segment + altar at the shrine
  const S = POIS.find((p) => p.id === 'shrine')!;
  const sg = heightAt(S.x, S.z);
  colliders.push(box(S.x, S.z, 1.4, 0.9, sg - 1, sg + 1.1, 0.4, 'altar'));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const x = S.x + Math.cos(a) * 8, z = S.z + Math.sin(a) * 8, g = heightAt(x, z);
    colliders.push({ kind: 'cyl', x, z, r: 0.75, y0: g - 1, y1: g + 4.5, tag: 'stone' });
    ruins.push({ x, z, h: 4.5, r: 0.75, broken: false });
  }
  const rg = heightAt(R.x - 4, R.z - 22);
  colliders.push(box(R.x - 4, R.z - 22, 7, 0.8, rg - 1, rg + 3.4, 0.25, 'ruinwall'));

  // Forest scatter
  const trees: TreeInst[] = [];
  const rocks: PropInst[] = [];
  const bushes: PropInst[] = [];
  const cell = 6.5;
  for (let gx = -ZONE_HALF - 40; gx < ZONE_HALF + 40; gx += cell) {
    for (let gz = -ZONE_HALF - 40; gz < ZONE_HALF + 40; gz += cell) {
      const x = gx + rnd() * cell, z = gz + rnd() * cell;
      const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
      if (cityMask(x, z) > 0.02 || z < WALL_Z + 8) continue;
      if (distToRoad(x, z) < 6.5) continue;
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4) continue;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 16) continue;
      let clear = false;
      for (const p of POIS) if (p.id !== 'lake' && Math.hypot(x - p.x, z - p.z) < p.r) clear = true;
      if (clear) continue;
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const forest = 0.5 + 0.5 * fbm(x / 60, z / 60, 3, WORLD_SEED + 21) + smoothstep(-40, 100, z) * 0.35 + smoothstep(170, 200, edge) * 0.4;
      const h = heightAt(x, z);
      if (h < WATER_LEVEL + 0.4) continue;
      if (r1 < forest * 0.62) {
        const pine = noise2(x / 50, z / 50, 5) > 0.15 || h > 22;
        const type = pine ? 4 + (r2 < 0.5 ? 0 : 1) : r2 < 0.04 ? 7 + (r3 < 0.5 ? 0 : 1) : r2 < 0.16 ? 6 : Math.floor(r3 * 4);
        const s = (pine ? 1.6 : 1.35) + r4 * 0.9;
        const t: TreeInst = { type, x, z, s, rot: r3 * Math.PI * 2 };
        trees.push(t);
        if (edge < BOUND + 4) colliders.push({ kind: 'cyl', x, z, r: 0.32 * s, y0: h - 2, y1: h + 8 * s, tag: 'tree' });
      } else if (r1 < forest * 0.62 + 0.06) {
        const s = 0.8 + r4 * 1.8;
        rocks.push({ model: 'Rock_' + (1 + Math.floor(r2 * 5)), x, y: h - 0.2 * s, z, s, rot: r3 * 6.28 });
        if (s > 1.1 && edge < BOUND + 4) colliders.push({ kind: 'cyl', x, z, r: 0.42 * s, y0: h - 2, y1: h + 0.9 * s, tag: 'rock' });
      } else if (r1 < forest * 0.62 + 0.2) {
        const kinds = ['Bush', 'Bush_Large', 'Bush_Flowers', 'Plant_1', 'Flower_1_Clump', 'Flower_3_Clump'];
        bushes.push({ model: kinds[Math.floor(r2 * kinds.length)], x, y: h, z, s: 0.9 + r4 * 0.8, rot: r3 * 6.28 });
      }
    }
  }
  cached = { colliders, trees, rocks, bushes, buildings, ruins, torches };
  return cached;
}

export function poiAt(x: number, z: number): POI | null {
  for (const p of POIS) if (Math.hypot(x - p.x, z - p.z) < p.r) return p;
  return null;
}
