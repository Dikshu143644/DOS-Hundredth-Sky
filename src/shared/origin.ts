import type { SkillDef } from './skills';
import type { Element, Stats } from './combat';

/** Phase 4 · Reincarnation: cheat skills, elemental affinity (incl. the Forbidden path), skill fusion,
 *  adventurer rank F→SSS, lasting injuries and the power score. Pure data + rules, shared by both sides. */

export interface CheatDef { id: string; name: string; jp: string; desc: string; effect: string }
export const CHEATS: CheatDef[] = [
  { id: 'great_sage', name: 'Great Sage', jp: '大賢者', desc: 'A voice in your mind that analyses everything.', effect: '+10% critical chance · weaknesses hit for ×1.8 instead of ×1.5' },
  { id: 'predator', name: 'Predator', jp: '捕食者', desc: 'You grow by devouring the strength of what you defeat.', effect: '5% of all damage dealt heals you · +15% XP' },
  { id: 'mana_overflow', name: 'Mana Overflow', jp: '魔力無限', desc: 'Your soul is a well that never runs dry.', effect: '+40% max MP · +60% mana regeneration' },
  { id: 'return_by_death', name: 'Return by Death', jp: '死に戻り', desc: 'Death cannot keep you. Not the first time.', effect: 'Once every 10 minutes a killing blow leaves you at 30% HP instead' },
  { id: 'shadow_monarch', name: 'Shadow Monarch', jp: '影の君主', desc: 'The fallen rise again, and they kneel to you.', effect: '15% chance to raise a defeated monster as your shadow for 30 s' },
  { id: 'sword_saint', name: 'Sword Saint', jp: '剣聖', desc: 'Your body remembers ten thousand battles you never fought.', effect: '+20% attack · basic-attack finishers hit twice as hard' },
  { id: 'dragon_heart', name: 'Dragon Heart', jp: '竜の心臓', desc: 'A dragon’s heart beats in your chest.', effect: '+25% max HP · regenerate 1.5% HP/s out of combat' },
  { id: 'lucky_star', name: 'Lucky Star', jp: '幸運の星', desc: 'Fate itself leans your way.', effect: '+30% gold · double chance for rare drops · +5% crit' },
];
export const cheatById = (id?: string | null) => CHEATS.find((c) => c.id === id);
/** The three gifts the Goddess offers this soul (seeded, so a reload offers the same three). */
export function cheatOffer(seed: string): string[] {
  let h = 2166136261; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const ids = CHEATS.map((c) => c.id), out: string[] = [];
  while (out.length < 3) { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; const k = ids[h % ids.length]; if (!out.includes(k)) out.push(k); }
  return out;
}

export type Affinity = Exclude<Element, 'physical'> | 'forbidden';
export const AFFINITIES: { id: Affinity; name: string; kanji: string; color: number; desc: string }[] = [
  { id: 'fire', name: 'Fire', kanji: '火', color: 0xff6a2a, desc: 'Passion and ruin.' },
  { id: 'water', name: 'Water', kanji: '水', color: 0x3aa8ff, desc: 'Patience that wears down mountains.' },
  { id: 'wind', name: 'Wind', kanji: '風', color: 0x8ff0c0, desc: 'Freedom; nothing holds you.' },
  { id: 'earth', name: 'Earth', kanji: '土', color: 0xc89a5a, desc: 'Endurance, the bones of the world.' },
  { id: 'lightning', name: 'Lightning', kanji: '雷', color: 0xfff27a, desc: 'Speed and judgement.' },
  { id: 'light', name: 'Light', kanji: '光', color: 0xfff6d0, desc: 'Healing and truth.' },
  { id: 'darkness', name: 'Darkness', kanji: '闇', color: 0x8a5cff, desc: 'What hides, what waits.' },
  { id: 'space', name: 'Space', kanji: '空', color: 0x9fb8ff, desc: 'Distance means nothing.' },
  { id: 'time', name: 'Time', kanji: '時', color: 0xffd08a, desc: 'The rarest gift: seconds bend for you.' },
  { id: 'forbidden', name: 'FORBIDDEN', kanji: '禁', color: 0xff2a5a, desc: 'Chaos magic. +25% magic and Chaos fusions, at a cost: −15% max HP forever, the Capital distrusts you.' },
];
export const AFFINITY_BONUS = 0.15;

// ------------------------------------------------------------------ skill fusion
export interface FusionDef { id: string; a: Affinity; b: Affinity; name: string; title: string; desc: string }
const F = (a: Affinity, b: Affinity, id: string, name: string, title: string, desc: string): FusionDef => ({ id, a, b, name, title, desc });
export const FUSIONS: FusionDef[] = [
  F('water', 'lightning', 'f_storm', 'TEMPESTAS', 'Storm Sovereign', 'Rain and thunder as one: a storm that soaks and electrocutes everything around you.'),
  F('fire', 'wind', 'f_firestorm', 'INFERNO CYCLONE', 'Firestorm', 'A whirling column of flame that pulls foes in and burns them.'),
  F('fire', 'earth', 'f_magma', 'MAGMA', 'Molten Earth', 'The ground splits into lava under your enemies.'),
  F('water', 'wind', 'f_blizzard', 'GLACIES VORTEX', 'Blizzard', 'A freezing gale that slows everything to a crawl.'),
  F('fire', 'lightning', 'f_plasma', 'PLASMA', 'Star Lance', 'A lance of plasma, hot enough to pierce armour.'),
  F('earth', 'water', 'f_quag', 'PALUS', 'Quagmire', 'The earth turns to swallowing mud: roots and drowns.'),
  F('wind', 'lightning', 'f_thunder', 'TONITRUS', 'Thunderclap', 'A shockwave of wind and lightning that hurls foes away.'),
  F('light', 'darkness', 'f_twilight', 'CREPUSCULUM', 'Twilight', 'Light and dark annihilate: pure damage that ignores weakness.'),
  F('space', 'time', 'f_singularity', 'SINGULARITAS', 'Singularity', 'A point where space and time collapse. Everything stops.'),
  F('light', 'fire', 'f_solar', 'SOL INVICTUS', 'Solar Flare', 'A miniature sun. Heals allies, burns the wicked.'),
  F('darkness', 'space', 'f_void', 'ABYSSUS MAGNUS', 'Event Horizon', 'Opens a hole in the world that drags enemies in.'),
  F('earth', 'lightning', 'f_magnet', 'MAGNETAR', 'Iron Tempest', 'Magnetised stone shards that shred everything nearby.'),
  F('time', 'light', 'f_dawn', 'AURORA AETERNA', 'Eternal Dawn', 'Rewinds your wounds and your allies’.'),
];
/** Forbidden fuses with any element into a Chaos spell. */
export function chaosFusion(el: Affinity): FusionDef { return F('forbidden', el, 'f_chaos_' + el, 'CHAOS ' + el.toUpperCase(), 'Forbidden Chaos', `Forbidden magic twisted through ${el}: enormous damage, and it costs you blood.`); }
export function findFusion(a: Affinity, b: Affinity): FusionDef | null {
  if (a === b) return null;
  if (a === 'forbidden' || b === 'forbidden') return chaosFusion(a === 'forbidden' ? b : a);
  return FUSIONS.find((f) => (f.a === a && f.b === b) || (f.a === b && f.b === a)) ?? null;
}
/** Fusion slots unlock with level: 1 at 5, 2 at 15, 3 at 30. */
export const fusionSlots = (level: number) => (level >= 30 ? 3 : level >= 15 ? 2 : level >= 5 ? 1 : 0);

const ELEMENT_OF: Partial<Record<Affinity, Element>> = { forbidden: 'darkness' };
const FX: Record<string, { kind: SkillDef['kind']; fx: SkillDef['fx']; color: number; e: SkillDef['fx2'] }> = {
  f_storm: { kind: 'nova', fx: 'fulgur', color: 0x7fd4ff, e: { soak: 5, stun: 0.6 } },
  f_firestorm: { kind: 'nova', fx: 'meteor', color: 0xff7a2a, e: { burn: true, dot: 0.35, dotDur: 4 } },
  f_magma: { kind: 'projectile', fx: 'ignis', color: 0xff4a10, e: { burn: true, dot: 0.45, dotDur: 4, slow: 0.4, slowDur: 3 } },
  f_blizzard: { kind: 'nova', fx: 'frost', color: 0xbfeaff, e: { chill: 4, slow: 0.6, slowDur: 4 } },
  f_plasma: { kind: 'projectile', fx: 'fulgur', color: 0xff9aff, e: { mark: 0.2, markDur: 6 } },
  f_quag: { kind: 'nova', fx: 'quake', color: 0x7a6a3a, e: { root: 2.5, soak: 5 } },
  f_thunder: { kind: 'nova', fx: 'gale', color: 0xd8ffb0, e: { knock: 6, stun: 0.4 } },
  f_twilight: { kind: 'projectile', fx: 'shadow', color: 0xd8b0ff, e: {} },
  f_singularity: { kind: 'nova', fx: 'ring', color: 0x9fb8ff, e: { stun: 2 } },
  f_solar: { kind: 'nova', fx: 'lux', color: 0xfff0a0, e: { burn: true, heal: 0.8, party: true } },
  f_void: { kind: 'nova', fx: 'shadow', color: 0x6a3aff, e: { slow: 0.7, slowDur: 3, mark: 0.15, markDur: 5 } },
  f_magnet: { kind: 'nova', fx: 'quake', color: 0xc0c8d8, e: { dot: 0.3, dotDur: 3 } },
  f_dawn: { kind: 'heal', fx: 'heal', color: 0xffe8a0, e: { heal: 1.6, hot: 0.2, hotDur: 6, party: true } },
};
/** A fusion as a castable skill (slot 7, key G). Class-agnostic; scales with your better stat. */
export function fusionSkill(f: FusionDef): SkillDef {
  const chaos = f.id.startsWith('f_chaos_');
  const base = chaos ? { kind: 'nova' as const, fx: 'shadow' as const, color: 0xff2a5a, e: { dot: 0.4, dotDur: 4 } } : FX[f.id] ?? FX.f_storm;
  const el: Element = chaos ? (f.b === 'forbidden' ? 'darkness' : (f.b as Element)) : ((ELEMENT_OF[f.b] ?? f.b) as Element);
  return {
    id: f.id, cls: 'fusion' as any, slot: 7 as any, unlock: 5, name: f.name, title: f.title, element: el,
    incantation: `${f.a.toUpperCase()} and ${f.b.toUpperCase()}, become one.`,
    castTime: 1.1, cooldown: chaos ? 14 : 16, mana: 40, range: base.kind === 'projectile' ? 34 : 0, radius: base.kind === 'projectile' ? 4.5 : 7.5,
    power: chaos ? 4.2 : 3.4, kind: base.kind, fx: base.fx, color: base.color, light: 10, scale: 'mag', desc: f.desc, fx2: base.e, key: 7,
    fusion: true, chaos,
  } as SkillDef;
}
export const FUSION_SKILLS: SkillDef[] = [...FUSIONS, ...AFFINITIES.filter((a) => a.id !== 'forbidden').map((a) => chaosFusion(a.id))].map(fusionSkill);

// ------------------------------------------------------------------ adventurer rank
export const ADV_RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'] as const;
export type AdvRank = typeof ADV_RANKS[number];
export const RANK_PTS = [0, 100, 300, 700, 1500, 3000, 6000, 12000, 25000];
export function rankFor(pts: number): AdvRank { let r = 0; for (let i = 0; i < RANK_PTS.length; i++) if (pts >= RANK_PTS[i]) r = i; return ADV_RANKS[r]; }

// ------------------------------------------------------------------ injuries (real time, they last)
export interface InjuryDef { id: string; name: string; desc: string; mins: number; atk?: number; hp?: number; mp?: number; spd?: number; all?: number }
export const INJURIES: InjuryDef[] = [
  { id: 'arm', name: 'Broken Arm', desc: '−15% attack', mins: 15, atk: -0.15 },
  { id: 'ribs', name: 'Cracked Ribs', desc: '−15% max HP', mins: 15, hp: -0.15 },
  { id: 'concussion', name: 'Concussion', desc: '−30% mana regeneration, −10% magic', mins: 10, mp: -0.3 },
  { id: 'ankle', name: 'Twisted Ankle', desc: '−10% move speed', mins: 10, spd: -0.1 },
  { id: 'haunted', name: 'Haunted', desc: '−10% to everything (died in the Forbidden Territory)', mins: 20, all: -0.1 },
];
export interface Injury { id: string; until: number }

/** Apply cheat skill, affinity cost and active injuries to base stats (server + client agree). */
export function applyOrigin(st: Stats, o: { cheat?: string | null; affinity?: string | null; injuries?: Injury[] } | undefined, nowMs: number): Stats {
  if (!o) return st;
  const s = { ...st };
  switch (o.cheat) {
    case 'great_sage': s.crit = Math.min(0.7, s.crit + 0.1); break;
    case 'mana_overflow': s.maxMp = Math.round(s.maxMp * 1.4); s.mpRegen *= 1.6; break;
    case 'sword_saint': s.atk = Math.round(s.atk * 1.2); break;
    case 'dragon_heart': s.maxHp = Math.round(s.maxHp * 1.25); break;
    case 'lucky_star': s.crit = Math.min(0.7, s.crit + 0.05); break;
  }
  if (o.affinity === 'forbidden') { s.maxHp = Math.round(s.maxHp * 0.85); s.mag = Math.round(s.mag * 1.25); }
  for (const j of o.injuries ?? []) {
    if (j.until < nowMs) continue;
    const d = INJURIES.find((x) => x.id === j.id); if (!d) continue;
    const all = d.all ?? 0;
    s.atk = Math.round(s.atk * (1 + (d.atk ?? 0) + all)); s.maxHp = Math.round(s.maxHp * (1 + (d.hp ?? 0) + all));
    s.mag = Math.round(s.mag * (1 + (d.id === 'concussion' ? -0.1 : 0) + all)); s.mpRegen *= 1 + (d.mp ?? 0); s.spd *= 1 + (d.spd ?? 0) + all; s.def = Math.round(s.def * (1 + all));
  }
  return s;
}
/** One number for the leaderboard. */
export function powerScore(level: number, st: Stats, rankIdx: number, gear = 0): number {
  return Math.round(level * 120 + (st.atk + st.mag) * 6 + st.def * 8 + st.maxHp * 0.6 + st.maxMp * 0.3 + st.crit * 900 + rankIdx * 350 + gear);
}
