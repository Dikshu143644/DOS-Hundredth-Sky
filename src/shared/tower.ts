import { mulberry32, smoothstep } from './rng';
import { REGIONS, type RegionDef, type GenZone, type ZoneId } from './regions';
import type { Collider, BoxCollider, ZoneData, Vec2, POI } from './world';

/** Phase 4 · M5: the Hundredth Tower. 100 floors generated from room templates (monster halls, trap
 *  halls, puzzle chambers, treasure vaults, a boss arena every tenth floor). Each floor is its own
 *  streamed zone ('f1'…'f100'), deterministic from its number, so server and client build the same
 *  walls, plates and seals. A sealed door guards the stairs: solve the floor's puzzle (or defeat its
 *  boss) to open it. */
export const FLOORS = 100;
export const floorId = (n: number) => 'f' + n;
export function floorOf(zone: string | undefined | null): number { const m = /^f(\d{1,3})$/.exec(zone ?? ''); return m ? Number(m[1]) : 0; }
export const floorLevel = (n: number) => Math.round(38 + n * 0.8);
export const isBossFloor = (n: number) => n % 10 === 0;

export interface Theme { name: string; tints: [number, number, number, number]; fog: number; fogDensity: number; sky: number; wall: number; accent: number; mobs: [string, string, string] }
/** One theme per band of ten floors. Monster kinds are registered in the bestiary (TOWER_SPECS). */
export const THEMES: Theme[] = [
  { name: 'Verdant Halls', tints: [0xb8d0a0, 0xa8c090, 0xb0b0a0, 0xc8c8b0], fog: 0xc8dcc0, fogDensity: 0.9, sky: 0xd8f0d0, wall: 0x9aa888, accent: 0x8cff9a, mobs: ['t1_crawler', 't1_golem', 't1_sprite'] },
  { name: 'Sunken Ossuary', tints: [0xc8c0b0, 0xb8b0a0, 0xa8a49c, 0xd0c8b8], fog: 0xc8c4b8, fogDensity: 1.3, sky: 0xd8d4c8, wall: 0xb0a898, accent: 0xfff0c0, mobs: ['t2_sentinel', 't2_bat', 't2_slime'] },
  { name: 'Ember Forge', tints: [0xd0a080, 0xb88a70, 0x9a8070, 0xc8a088], fog: 0xe0b090, fogDensity: 1.2, sky: 0xffd0a8, wall: 0x9a7a66, accent: 0xff8a40, mobs: ['t3_imp', 't3_golem', 't3_wisp'] },
  { name: 'Rime Vault', tints: [0xf0f6ff, 0xd8e6f0, 0xc0ccd8, 0xe0e8f0], fog: 0xe0ecf4, fogDensity: 1.4, sky: 0xeaf6ff, wall: 0xc8d6e0, accent: 0xa8e8ff, mobs: ['t4_sentinel', 't4_wolf', 't4_wraith'] },
  { name: 'Storm Bastion', tints: [0xc8c8b8, 0xb0b0a4, 0xa0a098, 0xc0c0b4], fog: 0xb8bcb4, fogDensity: 1.3, sky: 0xc8ccc4, wall: 0xa4a49a, accent: 0xffe060, mobs: ['t5_wasp', 't5_construct', 't5_wisp'] },
  { name: 'Mirror Labyrinth', tints: [0xe8ecec, 0xd8dede, 0xc4cccc, 0xf0f4f4], fog: 0xe8f0f0, fogDensity: 1.0, sky: 0xf4fafa, wall: 0xdce4e4, accent: 0xffffff, mobs: ['t6_knight', 't6_spider', 't6_ghost'] },
  { name: 'Abyssal Sanctum', tints: [0xa08070, 0x8a6a60, 0x7a6460, 0x987870], fog: 0x8a5a50, fogDensity: 1.8, sky: 0xc08070, wall: 0x7a5e56, accent: 0xff5a4a, mobs: ['t7_imp', 't7_squid', 't7_skull'] },
  { name: 'Clockwork Spire', tints: [0xd0b890, 0xc0a47c, 0xa89070, 0xd8c0a0], fog: 0xd8c4a0, fogDensity: 1.1, sky: 0xf0dcb8, wall: 0xb09878, accent: 0xffc860, mobs: ['t8_scarab', 't8_orc', 't8_bat'] },
  { name: 'Starlit Gallery', tints: [0xd8dce0, 0xc4c8cc, 0xb0b4b8, 0xe0e4e8], fog: 0xd0d8dc, fogDensity: 0.9, sky: 0xe8f0f4, wall: 0xc8ccd0, accent: 0x9ae8ff, mobs: ['t9_sentinel', 't9_wisp', 't9_drake'] },
  { name: 'The Hundredth Sky', tints: [0xf8f0d8, 0xe8dcc0, 0xd8ccb0, 0xfff8e8], fog: 0xfff4dc, fogDensity: 0.7, sky: 0xfff8e8, wall: 0xf0e4c8, accent: 0xffe08a, mobs: ['t10_warden', 't10_construct', 't10_wyrmling'] },
];
export const themeOf = (n: number) => THEMES[Math.min(9, Math.floor((n - 1) / 10))];

/** The ten floor guardians (one every tenth floor), all original. */
export const TOWER_BOSSES = ['tb_thornmaw', 'tb_velthar', 'tb_cindrax', 'tb_glaciel', 'tb_voltaros', 'tb_twin', 'tb_nyxaroth', 'tb_chronarch', 'tb_seraphine', 'tb_ascalon'];
export const TOWER_BOSS_ITEM: Record<string, string> = {
  tb_thornmaw: 'thornmaw_fang', tb_velthar: 'velthar_crown', tb_cindrax: 'cindrax_core', tb_glaciel: 'glaciel_veil', tb_voltaros: 'voltaros_coil',
  tb_twin: 'twin_mirror', tb_nyxaroth: 'nyxaroth_eye', tb_chronarch: 'chronarch_gear', tb_seraphine: 'seraphine_feather', tb_ascalon: 'ascalon_heart',
};

type Spec = [kind: string, name: string, model: string, level: number, o?: Record<string, unknown>];
const bandL = (b: number) => floorLevel(b * 10 - 5);
/** Bestiary specs for the Tower (consumed by bestiary.ts). */
export const TOWER_SPECS: Spec[] = [
  ['t1_crawler', 'Vine Crawler', 'q:spider', bandL(1), { tint: 0x9ad890, height: 1.1, weakTo: 'fire', element: 'earth' }],
  ['t1_golem', 'Moss Golem', 'q:goleling', bandL(1), { tint: 0xa8d890, height: 1.7, weakTo: 'fire', element: 'earth', speed: 2.3 }],
  ['t1_sprite', 'Thorn Sprite', 'q:hywirl', bandL(1), { tint: 0xb8ffa0, height: 1.3, ranged: true, attackRange: 12, weakTo: 'fire', element: 'wind', mult: 0.85 }],
  ['t2_sentinel', 'Bone Sentinel', 'Skeleton_Warrior', bandL(2), { tint: 0xf0e8d0, scale: 1.25, weakTo: 'light', element: 'darkness' }],
  ['t2_bat', 'Crypt Bat', 'q:bat', bandL(2), { tint: 0xd8d0c0, height: 1.1, speed: 3.8, weakTo: 'light', mult: 0.8 }],
  ['t2_slime', 'Grave Slime', 'q:glub_evolved', bandL(2), { tint: 0xe0e8c8, height: 1.4, weakTo: 'fire', element: 'water' }],
  ['t3_imp', 'Cinder Imp', 'q:blue_demon', bandL(3), { tint: 0xffa070, height: 1.7, weakTo: 'water', element: 'fire' }],
  ['t3_golem', 'Slag Golem', 'q:goleling', bandL(3), { tint: 0xff9a60, height: 1.9, weakTo: 'water', element: 'fire', speed: 2.2 }],
  ['t3_wisp', 'Flame Wisp', 'q:hywirl', bandL(3), { tint: 0xffb070, height: 1.3, ranged: true, attackRange: 13, weakTo: 'water', element: 'fire', mult: 0.85 }],
  ['t4_sentinel', 'Frost Sentinel', 'q:ninja', bandL(4), { tint: 0xd8f0ff, height: 1.9, weakTo: 'fire', element: 'water', speed: 3.1 }],
  ['t4_wolf', 'Vault Wolf', 'q:wolf', bandL(4), { tint: 0xe8f4ff, height: 1.2, speed: 3.8, weakTo: 'fire' }],
  ['t4_wraith', 'Rime Wraith', 'q:ghost', bandL(4), { tint: 0xc8ecff, height: 1.6, ranged: true, attackRange: 14, weakTo: 'fire', element: 'water' }],
  ['t5_wasp', 'Volt Wasp', 'q:wasp', bandL(5), { tint: 0xfff090, height: 1.2, speed: 3.7, weakTo: 'earth', element: 'lightning', mult: 0.85 }],
  ['t5_construct', 'Thunder Construct', 'q:goleling', bandL(5), { tint: 0xffe880, height: 1.9, weakTo: 'earth', element: 'lightning', speed: 2.3 }],
  ['t5_wisp', 'Spark Wisp', 'q:hywirl', bandL(5), { tint: 0xfff4b0, height: 1.3, ranged: true, attackRange: 13, weakTo: 'earth', element: 'lightning', mult: 0.85 }],
  ['t6_knight', 'Mirror Knight', 'q:ninja', bandL(6), { tint: 0xf4f8f8, height: 2.0, weakTo: 'darkness', element: 'light', speed: 3.2 }],
  ['t6_spider', 'Glass Spider', 'q:spider', bandL(6), { tint: 0xf0f8ff, height: 1.2, weakTo: 'earth', element: 'light' }],
  ['t6_ghost', 'Echo Ghost', 'q:ghost', bandL(6), { tint: 0xffffff, height: 1.6, ranged: true, attackRange: 14, weakTo: 'darkness', element: 'light' }],
  ['t7_imp', 'Abyss Imp', 'q:blue_demon', bandL(7), { tint: 0xff8a80, height: 1.8, weakTo: 'light', element: 'darkness' }],
  ['t7_squid', 'Deep Squid', 'q:squidle', bandL(7), { tint: 0xff9a8a, height: 1.7, weakTo: 'lightning', element: 'water' }],
  ['t7_skull', 'Howling Skull', 'q:ghost_skull', bandL(7), { tint: 0xffd0c0, height: 1.5, ranged: true, attackRange: 15, weakTo: 'light', element: 'darkness' }],
  ['t8_scarab', 'Gear Scarab', 'q:armabee', bandL(8), { tint: 0xe8c080, height: 1.3, weakTo: 'lightning' }],
  ['t8_orc', 'Clockwork Brute', 'q:orc_enemy', bandL(8), { tint: 0xd8b078, height: 1.8, weakTo: 'lightning' }],
  ['t8_bat', 'Tick Bat', 'q:bat', bandL(8), { tint: 0xe8c890, height: 1.1, speed: 3.9, weakTo: 'wind', mult: 0.8 }],
  ['t9_sentinel', 'Star Sentinel', 'q:alien', bandL(9), { tint: 0xe8f8ff, height: 1.6, weakTo: 'darkness', element: 'space' }],
  ['t9_wisp', 'Astral Wisp', 'q:hywirl', bandL(9), { tint: 0xc8f0ff, height: 1.4, ranged: true, attackRange: 14, weakTo: 'darkness', element: 'space', mult: 0.85 }],
  ['t9_drake', 'Comet Drake', 'q:dragon', bandL(9), { tint: 0xd0e8f0, height: 2.4, weakTo: 'water', element: 'fire' }],
  ['t10_warden', 'Sky Warden', 'q:ninja', bandL(10), { tint: 0xfff0c0, height: 2.0, weakTo: 'darkness', element: 'light', speed: 3.3 }],
  ['t10_construct', 'Seraph Construct', 'q:goleling_evolved', bandL(10), { tint: 0xfff8e8, height: 2.4, weakTo: 'lightning', element: 'light', speed: 2.4 }],
  ['t10_wyrmling', 'Dawn Wyrmling', 'q:dragon_evolved', bandL(10), { tint: 0xffe0a0, height: 2.4, weakTo: 'water', element: 'fire' }],
  // the ten floor guardians
  ['tb_thornmaw', 'Thornmaw, Warden of the First Gate', 'q:dragon_evolved', floorLevel(10), { boss: true, height: 5, tint: 0xc8f0a8, weakTo: 'fire', element: 'earth', specials: ['charge', 'slam', 'summon', 'enrage'], adds: 't1_crawler' }],
  ['tb_velthar', "Vel'thar, the Ossuary King", 'Skeleton_Warrior', floorLevel(20), { boss: true, scale: 2.3, tint: 0xfff4d8, weakTo: 'light', element: 'darkness', specials: ['slam', 'summon', 'volley', 'enrage'], adds: 't2_sentinel' }],
  ['tb_cindrax', 'Cindrax the Forge Tyrant', 'q:demon_b', floorLevel(30), { boss: true, height: 6, tint: 0xffa060, weakTo: 'water', element: 'fire', specials: ['breath', 'slam', 'charge', 'enrage'], adds: 't3_imp' }],
  ['tb_glaciel', 'Glaciel, Queen of the Rime Vault', 'q:dragon_evolved', floorLevel(40), { boss: true, height: 5.5, tint: 0xe0f4ff, weakTo: 'fire', element: 'water', specials: ['breath', 'volley', 'summon', 'enrage'], adds: 't4_wolf' }],
  ['tb_voltaros', 'Voltaros the Storm Herald', 'q:goleling_evolved', floorLevel(50), { boss: true, height: 5.5, tint: 0xffe878, weakTo: 'earth', element: 'lightning', specials: ['slam', 'volley', 'charge', 'enrage'], adds: 't5_wasp' }],
  ['tb_twin', 'The Mirrored Twin', 'q:ninja', floorLevel(60), { boss: true, height: 4.6, tint: 0xf8ffff, weakTo: 'darkness', element: 'light', specials: ['charge', 'summon', 'volley', 'enrage'], adds: 't6_knight' }],
  ['tb_nyxaroth', 'Nyxaroth, the Abyss Eye', 'q:squidle', floorLevel(70), { boss: true, height: 5.5, tint: 0xff7a6a, weakTo: 'light', element: 'darkness', specials: ['volley', 'breath', 'summon', 'enrage'], adds: 't7_skull' }],
  ['tb_chronarch', 'Chronarch, Keeper of Gears', 'q:goleling_evolved', floorLevel(80), { boss: true, height: 6, tint: 0xe0b070, weakTo: 'lightning', element: 'time', specials: ['slam', 'charge', 'summon', 'enrage'], adds: 't8_scarab' }],
  ['tb_seraphine', 'Seraphine, the Fallen Star', 'q:alien', floorLevel(90), { boss: true, height: 5, tint: 0xf0faff, weakTo: 'darkness', element: 'space', specials: ['volley', 'breath', 'charge', 'enrage'], adds: 't9_wisp' }],
  ['tb_ascalon', 'Ascalon, the Hundredth Sky', 'q:dragon', floorLevel(100), { boss: true, height: 7.5, tint: 0xffe8a0, weakTo: 'space', element: 'light', specials: ['breath', 'volley', 'charge', 'slam', 'summon', 'enrage'], adds: 't10_warden' }],
];

// ------------------------------------------------------------------------------------ layout
export type RoomKind = 'landing' | 'stairs' | 'monsters' | 'traps' | 'puzzle' | 'treasure' | 'boss';
export type PuzzleKind = 'runes' | 'braziers' | 'trial';
export interface Room { i: number; j: number; x: number; z: number; kind: RoomKind; name: string }
export interface Plate { id: number; x: number; z: number; r: number; kind: 'spike' | 'rune' | 'brazier' | 'chest' | 'fountain'; sym?: string; phase?: number }
export interface FloorPlan {
  n: number; cols: number; rows: number; R: number; rooms: Room[]; start: Room; stairs: Room; gate: Room;
  walls: { x: number; z: number; hx: number; hz: number; h: number }[];
  seal: { x: number; z: number; hx: number; hz: number };
  puzzle: { kind: PuzzleKind; room: Room; order?: number[] } | null;
  plates: Plate[]; monsters: { kind: string; x: number; z: number; guardian?: boolean }[];
  boss: { kind: string; x: number; z: number } | null;
  stairsAt: Vec2; descentAt: Vec2;
}
export const SYMBOLS = ['☀', '☾', '★', '≈'];
export const SYMBOL_NAMES = ['Sun', 'Moon', 'Star', 'Wave'];
export const TRAP = { period: 3.2, active: 1.15, damage: 0.12 };
export const TOWER_GATE = { x: 0, z: -168, r: 7 }; // at the Gate of the Tower in the 'tower' region

const plans: Record<number, FloorPlan> = {};
export function floorPlan(n: number): FloorPlan {
  if (plans[n]) return plans[n];
  const rnd = mulberry32(9000 + n * 131);
  const cols = n <= 30 ? 3 : 4, rows = n <= 60 ? 3 : 4, R = 24, H = 7, T = 0.7, DOOR = 3.2;
  const x0 = -(cols * R) / 2, z0 = -(rows * R) / 2;
  const idx = (i: number, j: number) => j * cols + i;
  const rooms: Room[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) rooms.push({ i, j, x: x0 + R * (i + 0.5), z: z0 + R * (j + 0.5), kind: 'monsters', name: '' });
  // spanning tree (randomised DFS) from the landing (south-west corner)
  const startI = idx(0, rows - 1);
  const parent = new Array(rooms.length).fill(-1), seen = new Array(rooms.length).fill(false), depth = new Array(rooms.length).fill(0);
  const edges = new Set<string>(); const ek = (a: number, b: number) => (a < b ? a + ':' + b : b + ':' + a);
  const stack = [startI]; seen[startI] = true;
  while (stack.length) {
    const c = stack[stack.length - 1], ci = rooms[c].i, cj = rooms[c].j;
    const nb = [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows).map(([a, b]) => idx(a, b)).filter((k) => !seen[k]);
    if (!nb.length) { stack.pop(); continue; }
    const k = nb[Math.floor(rnd() * nb.length)];
    seen[k] = true; parent[k] = c; depth[k] = depth[c] + 1; edges.add(ek(c, k)); stack.push(k);
  }
  let stairsI = startI; for (let k = 0; k < rooms.length; k++) if (depth[k] > depth[stairsI]) stairsI = k;
  const gateI = parent[stairsI];
  // a few extra doorways make loops (never into the stairs room)
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) for (const [a, b] of [[i + 1, j], [i, j + 1]]) {
    if (a >= cols || b >= rows) continue;
    const p = idx(i, j), q = idx(a, b);
    if (p === stairsI || q === stairsI || edges.has(ek(p, q))) continue;
    if (rnd() < 0.22) edges.add(ek(p, q));
  }
  // walls
  const walls: FloorPlan['walls'] = [];
  const wallX = (x: number, za: number, zb: number) => { if (zb - za > 0.05) walls.push({ x, z: (za + zb) / 2, hx: T, hz: (zb - za) / 2, h: H }); };
  const wallZ = (z: number, xa: number, xb: number) => { if (xb - xa > 0.05) walls.push({ x: (xa + xb) / 2, z, hx: (xb - xa) / 2, hz: T, h: H }); };
  let seal = { x: 0, z: 0, hx: 0, hz: 0 };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const r = rooms[idx(i, j)];
    if (i + 1 < cols) { // east wall of this room
      const x = x0 + R * (i + 1), q = idx(i + 1, j), door = edges.has(ek(idx(i, j), q));
      if (door) { wallX(x, r.z - R / 2, r.z - DOOR); wallX(x, r.z + DOOR, r.z + R / 2); if ((idx(i, j) === stairsI || q === stairsI)) seal = { x, z: r.z, hx: T, hz: DOOR }; }
      else wallX(x, r.z - R / 2, r.z + R / 2);
    }
    if (j + 1 < rows) { // south wall of this room
      const z = z0 + R * (j + 1), q = idx(i, j + 1), door = edges.has(ek(idx(i, j), q));
      if (door) { wallZ(z, r.x - R / 2, r.x - DOOR); wallZ(z, r.x + DOOR, r.x + R / 2); if ((idx(i, j) === stairsI || q === stairsI)) seal = { x: r.x, z, hx: DOOR, hz: T }; }
      else wallZ(z, r.x - R / 2, r.x + R / 2);
    }
  }
  const W = cols * R, D = rows * R;
  wallZ(z0, x0 - T, x0 + W + T); wallZ(z0 + D, x0 - T, x0 + W + T); wallX(x0, z0, z0 + D); wallX(x0 + W, z0, z0 + D);
  // room roles
  const start = rooms[startI], stairs = rooms[stairsI], gate = rooms[gateI];
  start.kind = 'landing'; start.name = 'The Landing';
  stairs.kind = 'stairs'; stairs.name = 'Stairway';
  const boss = isBossFloor(n);
  const th = themeOf(n);
  const plates: Plate[] = []; let pid = 1;
  const monsters: FloorPlan['monsters'] = [];
  let puzzle: FloorPlan['puzzle'] = null;
  let bossSpot: FloorPlan['boss'] = null;
  const others = rooms.filter((r) => r !== start && r !== stairs && r !== gate);
  for (let k = others.length - 1; k > 0; k--) { const m = Math.floor(rnd() * (k + 1)); [others[k], others[m]] = [others[m], others[k]]; }
  if (boss) {
    gate.kind = 'boss'; gate.name = 'Guardian\'s Arena';
    bossSpot = { kind: TOWER_BOSSES[n / 10 - 1], x: gate.x, z: gate.z };
  } else {
    gate.kind = 'puzzle';
    const kinds: PuzzleKind[] = ['runes', 'braziers', 'trial'];
    const pk = kinds[(n + Math.floor(rnd() * 3)) % 3];
    gate.name = pk === 'runes' ? 'Chamber of Runes' : pk === 'braziers' ? 'Hall of Braziers' : 'Trial Hall';
    if (pk === 'runes') {
      const order = [0, 1, 2, 3]; for (let k = 3; k > 0; k--) { const m = Math.floor(rnd() * (k + 1)); [order[k], order[m]] = [order[m], order[k]]; }
      const spots = [[-6, -6], [6, -6], [6, 6], [-6, 6]];
      for (let s = 0; s < 4; s++) plates.push({ id: pid++, x: gate.x + spots[s][0], z: gate.z + spots[s][1], r: 1.6, kind: 'rune', sym: SYMBOLS[s] });
      puzzle = { kind: 'runes', room: gate, order };
    } else if (pk === 'braziers') {
      for (let s = 0; s < 3; s++) { const a = (s / 3) * Math.PI * 2 + 0.5; plates.push({ id: pid++, x: gate.x + Math.cos(a) * 7, z: gate.z + Math.sin(a) * 7, r: 2.3, kind: 'brazier' }); }
      puzzle = { kind: 'braziers', room: gate };
    } else {
      const ng = 3 + Math.floor(n / 25);
      for (let s = 0; s < ng; s++) monsters.push({ kind: th.mobs[s % 3], x: gate.x + (rnd() - 0.5) * 12, z: gate.z + (rnd() - 0.5) * 12, guardian: true });
      puzzle = { kind: 'trial', room: gate };
    }
  }
  const nTrap = Math.min(others.length, 1 + Math.floor(n / 30));
  others.forEach((r, k) => {
    if (k < nTrap) {
      r.kind = 'traps'; r.name = 'Spike Hall';
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) plates.push({ id: pid++, x: r.x + a * 6.5, z: r.z + b * 6.5, r: 2.1, kind: 'spike', phase: ((a + 1) * 3 + (b + 1)) * 0.35 + rnd() * 0.3 });
      if (rnd() < 0.5) monsters.push({ kind: th.mobs[Math.floor(rnd() * 3)], x: r.x + 8, z: r.z - 8 });
    } else if (k === nTrap && rnd() < 0.75) {
      r.kind = 'treasure'; r.name = 'Treasure Vault';
      plates.push({ id: pid++, x: r.x, z: r.z, r: 1.8, kind: 'chest' });
      monsters.push({ kind: th.mobs[2], x: r.x - 6, z: r.z + 6 }, { kind: th.mobs[0], x: r.x + 6, z: r.z + 6 });
    } else {
      r.kind = 'monsters'; r.name = 'Hall';
      const c = 2 + Math.floor(n / 20) + (rnd() < 0.5 ? 1 : 0);
      for (let s = 0; s < c; s++) monsters.push({ kind: th.mobs[Math.floor(rnd() * 3)], x: r.x + (rnd() - 0.5) * 14, z: r.z + (rnd() - 0.5) * 14 });
    }
  });
  plates.push({ id: pid++, x: start.x + 6, z: start.z - 6, r: 2.2, kind: 'fountain' });
  const p: FloorPlan = { n, cols, rows, R, rooms, start, stairs, gate, walls, seal, puzzle, plates, monsters, boss: bossSpot,
    stairsAt: { x: stairs.x, z: stairs.z }, descentAt: { x: start.x, z: start.z + R / 2 - 4.5 } };
  plans[n] = p;
  return p;
}

/** The floor as a zone: a flat platform high in the Tower, open to the sky, walls and doors. */
export function makeFloorZone(n: number): GenZone {
  const P = floorPlan(n), W = P.cols * P.R, D = P.rows * P.R;
  const height = (x: number, z: number) => {
    const dx = Math.max(0, Math.abs(x) - W / 2 - 2), dz = Math.max(0, Math.abs(z) - D / 2 - 2);
    const d = Math.hypot(dx, dz);
    return d <= 0 ? 0 : -smoothstep(0, 16, d) * 70;
  };
  let cache: ZoneData | null = null;
  const build = (): ZoneData => {
    if (cache) return cache;
    const colliders: Collider[] = [];
    const box = (x: number, z: number, hx: number, hz: number, y0: number, y1: number, tag: string): BoxCollider => ({ kind: 'box', x, z, hx, hz, y0, y1, yaw: 0, tag });
    for (const w of P.walls) colliders.push(box(w.x, w.z, w.hx, w.hz, -2, w.h, 'wall'));
    colliders.push(box(P.seal.x, P.seal.z, P.seal.hx, P.seal.hz, -2, 7, 'seal'));
    for (const e of [P.stairsAt, P.descentAt]) for (const s of [-1, 1]) colliders.push({ kind: 'cyl', x: e.x + s * 5, z: e.z, r: 0.9, y0: -2, y1: 9, tag: 'gate' });
    for (const pl of P.plates) {
      if (pl.kind === 'brazier') colliders.push({ kind: 'cyl', x: pl.x, z: pl.z, r: 0.6, y0: -1, y1: 1.6, tag: 'brazier' });
      if (pl.kind === 'chest') colliders.push(box(pl.x, pl.z, 0.9, 0.6, -1, 1.0, 'chest'));
      if (pl.kind === 'fountain') colliders.push({ kind: 'cyl', x: pl.x, z: pl.z, r: 1.5, y0: -1, y1: 0.8, tag: 'fountain' });
    }
    if (P.puzzle?.kind === 'runes') colliders.push({ kind: 'cyl', x: P.gate.x, z: P.gate.z, r: 0.8, y0: -1, y1: 3.2, tag: 'stele' });
    const torches: ZoneData['torches'] = [];
    for (const r of P.rooms) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) torches.push({ x: r.x + a * (P.R / 2 - 1.3), y: 3.2, z: r.z + b * (P.R / 2 - 1.3) });
    cache = { colliders, trees: [], rocks: [], bushes: [], buildings: [], ruins: [], torches };
    return cache;
  };
  return { rawHeight: height, height, roads: [], distToRoad: () => 1e9, townMask: () => 0, build };
}

/** Register floors 1…100 as zones (names, levels, look, exits). */
for (let n = 1; n <= FLOORS; n++) {
  const P = floorPlan(n), th = themeOf(n), L = floorLevel(n);
  const pois: POI[] = P.rooms.map((r, k) => ({ id: 'room' + k, name: r.name || 'Hall', x: r.x, z: r.z, r: P.R / 2 - 1 }));
  const next = n < FLOORS ? floorId(n + 1) : 'tower';
  const def: RegionDef & { floor: number } = {
    id: floorId(n) as ZoneId, name: `Floor ${n} · ${th.name}`, faction: 'tower', levels: [L, L + 2], seed: 1000 + n, floor: n,
    layers: ['cobble', 'cobble', 'rock', 'cobble'], tints: th.tints, fog: th.fog, fogDensity: th.fogDensity * 0.6, grass: 0, grassTint: th.tints[0], skyTint: th.sky,
    terrain: { base: 0, amp: 0, freq: 100, rough: 0, ridge: 0 }, trees: { types: [0], density: 0, scale: 1 }, rocks: 0, bushes: 0,
    weather: [['clear', 1]], spawn: { x: P.start.x, z: P.start.z, yaw: 0 },
    town: { name: th.name, x: 9999, z: 9999, r: 0, style: 'ruin' }, shrines: [],
    exits: [
      { to: next as ZoneId, x: P.stairsAt.x, z: P.stairsAt.z, name: n < FLOORS ? `Stairs to Floor ${n + 1}` : 'The Summit', yaw: 0 },
      { to: 'tower', x: P.descentAt.x, z: P.descentAt.z, name: 'Descend to the Foot of the Tower', yaw: Math.PI },
    ],
    pois, camps: [], boss: P.boss ?? { kind: th.mobs[0], x: P.gate.x, z: P.gate.z }, tower: { x: 0, z: -4000 }, water: -500,
  };
  (REGIONS as Record<string, RegionDef>)[def.id] = def;
}
export const isFloorRegion = (r: RegionDef) => !!(r as RegionDef & { floor?: number }).floor;
