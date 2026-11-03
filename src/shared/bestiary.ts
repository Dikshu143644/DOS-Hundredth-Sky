import type { MonsterDef, Element } from './combat';

/** Phase 4 · M2 bestiary: every region's monsters and its field boss. Models are Quaternius CC0
 *  monsters (q:<file>) or the KayKit skeletons, re-tinted. Stats scale from the level. */
type Spec = [kind: string, name: string, model: string, level: number, o?: Partial<MonsterDef> & { mult?: number; height?: number }];
const S = (r: string, list: Spec[]) => list.map(([kind, name, model, level, o]) => ({ kind, name, model, level, region: r, ...o }));

const SPECS = [
  ...S('capital', [
    ['gravelord', 'Varkas the Grave Lord', 'Skeleton_Warrior', 8, { boss: true, tint: 0x8a7cff, scale: 1.9, weakTo: 'light', element: 'darkness', specials: ['slam', 'summon', 'charge', 'enrage'], adds: 'minion', faction: 'capital' }],
  ]),
  ...S('forest', [
    ['wolf', 'Timber Wolf', 'q:wolf', 9, { speed: 3.6, weakTo: 'fire', height: 1.1, aggro: 20 }],
    ['mushnub', 'Sporeling', 'q:mushnub', 9, { weakTo: 'fire', height: 1.0, element: 'earth', mult: 0.8 }],
    ['blob', 'Thorn Blob', 'q:green_spiky_blob', 11, { weakTo: 'fire', height: 1.2, element: 'earth' }],
    ['spider', 'Webweaver', 'q:spider', 13, { weakTo: 'fire', height: 1.1, ranged: true, attackRange: 12, element: 'darkness' }],
    ['mushking', 'Ylva, the Mushroom Queen', 'q:mushroom_king', 16, { boss: true, height: 4.2, weakTo: 'fire', element: 'earth', specials: ['slam', 'summon', 'volley', 'enrage'], adds: 'mushnub', faction: 'forest' }],
  ]),
  ...S('mountain', [
    ['rockling', 'Rockling', 'q:goleling', 15, { weakTo: 'water', height: 1.3, element: 'earth', speed: 2.4 }],
    ['caveorc', 'Cave Orc', 'q:orc_enemy', 16, { weakTo: 'lightning', height: 1.6, tint: 0xb8c8a0 }],
    ['cragbat', 'Crag Bat', 'q:bat', 17, { weakTo: 'wind', height: 1.0, speed: 3.8, mult: 0.8 }],
    ['raider', 'Highland Raider', 'q:tribal', 19, { weakTo: 'fire', height: 1.6, ranged: true, attackRange: 14 }],
    ['colossus', 'The Iron Colossus', 'q:goleling_evolved', 24, { boss: true, height: 5, tint: 0xb0b8c8, weakTo: 'lightning', element: 'earth', specials: ['slam', 'charge', 'enrage'], faction: 'mountain' }],
  ]),
  ...S('desert', [
    ['viper', 'Dune Viper', 'q:snake', 21, { weakTo: 'water', height: 0.9, speed: 3.2, element: 'earth' }],
    ['sandwasp', 'Sand Wasp', 'q:wasp', 22, { weakTo: 'wind', height: 1.2, speed: 3.6, mult: 0.85 }],
    ['scarab', 'Brass Scarab', 'q:armabee', 24, { weakTo: 'lightning', height: 1.3, tint: 0xe8c070 }],
    ['mummy', 'Sand Mummy', 'Skeleton_Minion', 25, { weakTo: 'fire', tint: 0xe8c890, scale: 1.15 }],
    ['sandmaw', 'Sandmaw Tyrant', 'q:dino', 30, { boss: true, height: 5.5, tint: 0xe0b878, weakTo: 'water', element: 'earth', specials: ['charge', 'breath', 'summon', 'enrage'], adds: 'viper', faction: 'desert' }],
  ]),
  ...S('frozen', [
    ['yeti', 'Snow Yeti', 'q:yeti', 27, { weakTo: 'fire', height: 2.1 }],
    ['frostwolf', 'Frost Wolf', 'q:wolf', 28, { weakTo: 'fire', height: 1.15, tint: 0xdde8ff, speed: 3.7 }],
    ['wraith', 'Ice Wraith', 'q:ghost', 30, { weakTo: 'fire', height: 1.6, tint: 0xb8e0ff, ranged: true, attackRange: 14, element: 'water' }],
    ['glub', 'Rime Glub', 'q:glub_evolved', 31, { weakTo: 'fire', height: 1.4, tint: 0xc0d8ff }],
    ['hrimfang', 'Hrimfang the Frost Wyrm', 'q:dragon_evolved', 36, { boss: true, height: 5.5, tint: 0xa8d8ff, weakTo: 'fire', element: 'water', specials: ['breath', 'volley', 'slam', 'enrage'], faction: 'frozen' }],
  ]),
  ...S('forbidden', [
    ['imp', 'Void Imp', 'q:blue_demon', 35, { weakTo: 'light', height: 1.7, element: 'darkness' }],
    ['skullghost', 'Screaming Skull', 'q:ghost_skull', 36, { weakTo: 'light', height: 1.5, ranged: true, attackRange: 15, element: 'darkness' }],
    ['squidle', 'Abyss Squid', 'q:squidle', 38, { weakTo: 'lightning', height: 1.6, tint: 0xc090ff, element: 'space' }],
    ['hywirl', 'Warp Wisp', 'q:hywirl', 40, { weakTo: 'light', height: 1.4, speed: 3.6, element: 'time' }],
    ['malakar', 'Archfiend Malakar', 'q:demon_b', 45, { boss: true, height: 6, tint: 0xd090a0, weakTo: 'light', element: 'darkness', specials: ['slam', 'volley', 'summon', 'charge', 'enrage'], adds: 'imp', faction: 'forbidden' }],
  ]),
  ...S('tower', [
    ['sentinel', 'Tower Sentinel', 'q:ninja', 41, { weakTo: 'lightning', height: 1.9, tint: 0xd8d0ff, speed: 3.2 }],
    ['starspawn', 'Starspawn', 'q:alien', 42, { weakTo: 'darkness', height: 1.3, element: 'space' }],
    ['construct', 'Guardian Construct', 'q:goleling', 44, { weakTo: 'lightning', height: 1.8, tint: 0xffe08a, ranged: true, attackRange: 13 }],
    ['skyfang', 'Skyfang, Gatekeeper of the Tower', 'q:dragon', 50, { boss: true, height: 6, tint: 0xffd0a0, weakTo: 'space', element: 'fire', specials: ['breath', 'volley', 'charge', 'summon', 'enrage'], adds: 'starspawn', faction: 'tower' }],
  ]),
];

export interface BeastDef extends MonsterDef { height?: number }
export const BESTIARY: Record<string, BeastDef> = {};
for (const s of SPECS) {
  const mult = (s as any).mult ?? 1, L = s.level, boss = !!(s as any).boss;
  const ranged = !!(s as any).ranged;
  const d: BeastDef = {
    kind: s.kind, name: s.name, model: s.model, level: L, region: s.region,
    hp: Math.round((45 + L * 30 + L * L * 0.9) * mult * (boss ? 14 : 1)),
    atk: Math.round((7 + L * 2.3) * mult * (boss ? 1.5 : 1)),
    def: Math.round((3 + L * 1.15) * (boss ? 1.3 : 1)),
    xp: Math.round((20 + Math.pow(L, 1.45) * 9) * mult * (boss ? 12 : 1)),
    speed: 2.5, aggro: boss ? 26 : 18, attackRange: ranged ? 14 : boss ? 4.2 : 2.3, attackCd: ranged ? 2.5 : boss ? 1.6 : 1.8, ranged,
    weakTo: 'fire' as Element, gold: Math.round((4 + L * 1.6) * (boss ? 25 : 1)),
    ...(s as any),
  };
  delete (d as any).mult;
  BESTIARY[s.kind] = d;
}
