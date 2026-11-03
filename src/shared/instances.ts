import { smoothstep } from './rng';
import { REGIONS, type RegionDef, type GenZone, type ZoneId } from './regions';
import type { Collider, ZoneData } from './world';

/** Phase 4 · M6: instanced arenas. 'arena' is the PvP ring (shared, one match at a time per side
 *  pair is enough for this build); 'raid1'…'raid8' are private copies of the Eclipse raid arena, one per
 *  raiding party. Circular floating platforms ringed by a parapet (a dense ring of cylinder colliders,
 *  so the wall has no gaps and needs no rotated boxes). */
export type ArenaKind = 'arena' | 'raid';
export interface ArenaPlan { kind: ArenaKind; radius: number; wallR: number; pillars: { x: number; z: number; r: number; h: number }[]; entry: { x: number; z: number; yaw: number }[]; exitAt: { x: number; z: number }; wall: number; floor: [number, number, number, number]; accent: number }
export const RAID_INSTANCES = 8;
export const raidId = (k: number) => 'raid' + k;
export const isRaidZone = (z: string | undefined | null) => /^raid\d$/.test(z ?? '');
export const RAID_BOSS = 'rb_kaelthar';
export const RAID_MIN = 4, RAID_MAX = 8;

const PLANS: Record<ArenaKind, ArenaPlan> = {
  arena: { kind: 'arena', radius: 24, wallR: 22, pillars: [0, 1, 2, 3].map((k) => ({ x: Math.cos(k * Math.PI / 2 + Math.PI / 4) * 11, z: Math.sin(k * Math.PI / 2 + Math.PI / 4) * 11, r: 1.2, h: 4 })),
    entry: [{ x: 0, z: 15, yaw: 0 }, { x: 0, z: -15, yaw: Math.PI }], exitAt: { x: 0, z: 9999 }, wall: 0xe8e0d0, floor: [0xe8e0d0, 0xd8d0c0, 0xc8c0b0, 0xf0e8d8], accent: 0xffe08a },
  raid: { kind: 'raid', radius: 40, wallR: 38, pillars: Array.from({ length: 8 }, (_, k) => ({ x: Math.cos(k * Math.PI / 4) * 26, z: Math.sin(k * Math.PI / 4) * 26, r: 1.6, h: 9 })),
    entry: [{ x: 0, z: 31, yaw: 0 }], exitAt: { x: 0, z: 35 }, wall: 0xf0e2d0, floor: [0xb0a090, 0xa09080, 0x908070, 0xc0b0a0], accent: 0xff9a5a },
};
export const arenaPlan = (k: ArenaKind) => PLANS[k];

export function makeArenaZone(kind: ArenaKind): GenZone {
  const P = PLANS[kind];
  const height = (x: number, z: number) => { const d = Math.hypot(x, z) - P.radius; return d <= 0 ? 0 : -smoothstep(0, 14, d) * 60; };
  let cache: ZoneData | null = null;
  const build = (): ZoneData => {
    if (cache) return cache;
    const colliders: Collider[] = [];
    const n = Math.ceil((2 * Math.PI * P.wallR) / 1.6);
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; colliders.push({ kind: 'cyl', x: Math.cos(a) * P.wallR, z: Math.sin(a) * P.wallR, r: 1.1, y0: -2, y1: 3, tag: 'wall' }); }
    for (const p of P.pillars) colliders.push({ kind: 'cyl', x: p.x, z: p.z, r: p.r, y0: -2, y1: p.h, tag: 'pillar' });
    const torches: ZoneData['torches'] = P.pillars.map((p) => ({ x: p.x, y: p.h + 0.6, z: p.z }));
    cache = { colliders, trees: [], rocks: [], bushes: [], buildings: [], ruins: [], torches };
    return cache;
  };
  return { rawHeight: height, height, roads: [], distToRoad: () => 1e9, townMask: () => 0, build };
}

const base = (id: string, name: string, kind: ArenaKind, levels: [number, number]): RegionDef & { arena: ArenaKind } => {
  const P = PLANS[kind];
  return {
    id: id as ZoneId, name, faction: 'capital', levels, seed: 5000, arena: kind,
    layers: ['cobble', 'cobble', 'rock', 'cobble'], tints: P.floor, fog: kind === 'raid' ? 0xd8b8a0 : 0xf0e8dc, fogDensity: 0.5, grass: 0, grassTint: P.floor[0], skyTint: kind === 'raid' ? 0xffd0b0 : 0xfff4e0,
    terrain: { base: 0, amp: 0, freq: 100, rough: 0, ridge: 0 }, trees: { types: [0], density: 0, scale: 1 }, rocks: 0, bushes: 0,
    weather: [['clear', 1]], spawn: P.entry[0], town: { name, x: 9999, z: 9999, r: 0, style: 'ruin' }, shrines: [], exits: [],
    pois: [{ id: 'ring', name, x: 0, z: 0, r: P.radius }], camps: [], boss: { kind: kind === 'raid' ? RAID_BOSS : 'minion', x: 0, z: 0 }, tower: { x: 0, z: -4000 }, water: -500,
  };
};
(REGIONS as Record<string, RegionDef>).arena = base('arena', 'The Crimson Ring', 'arena', [1, 200]);
for (let k = 1; k <= RAID_INSTANCES; k++) (REGIONS as Record<string, RegionDef>)[raidId(k)] = base(raidId(k), 'The Eclipse Throne (Raid)', 'raid', [45, 60]);
export const arenaOf = (r: RegionDef) => (r as RegionDef & { arena?: ArenaKind }).arena ?? null;

/** Bestiary specs for M6 (world bosses, the raid boss and its adds), consumed by bestiary.ts. */
export const SOCIAL_SPECS: [string, string, string, number, Record<string, unknown>][] = [
  ['wb_gorrath', 'Gorrath the Ruin Titan', 'q:goleling_evolved', 42, { boss: true, height: 9, tint: 0xe0d0b0, weakTo: 'lightning', element: 'earth', specials: ['slam', 'charge', 'summon', 'enrage'], adds: 'rockling', mult: 1.6 }],
  ['wb_vyrnax', 'Vyrnax the Sky Serpent', 'q:dragon', 44, { boss: true, height: 8.5, tint: 0xfff0c8, weakTo: 'earth', element: 'wind', specials: ['breath', 'volley', 'charge', 'enrage'], mult: 1.6 }],
  ['wb_mother', 'The Hollow Mother', 'q:mushroom_king', 40, { boss: true, height: 8, tint: 0xf0f8d8, weakTo: 'fire', element: 'earth', specials: ['summon', 'slam', 'volley', 'enrage'], adds: 'mushnub', mult: 1.6 }],
  ['rb_kaelthar', 'Kaelthar, the Eclipse Dragon', 'q:dragon_evolved', 55, { boss: true, height: 9, tint: 0xffb890, weakTo: 'light', element: 'darkness', specials: ['breath', 'volley', 'slam', 'charge', 'summon', 'enrage'], adds: 'rb_shade', mult: 2.2 }],
  ['rb_shade', 'Eclipse Shade', 'q:ghost', 52, { tint: 0xffd8c0, height: 1.8, ranged: true, attackRange: 14, weakTo: 'light', element: 'darkness', mult: 0.9 }],
];
export const WORLD_BOSSES: { kind: string; zone: ZoneId; x: number; z: number; where: string }[] = [
  { kind: 'wb_gorrath', zone: 'desert', x: -100, z: -90, where: 'the Glass Flats' },
  { kind: 'wb_vyrnax', zone: 'mountain', x: -80, z: 90, where: 'the Old Quarry' },
  { kind: 'wb_mother', zone: 'forest', x: -90, z: -60, where: 'Mossmere in the Ancient Forest' },
];
