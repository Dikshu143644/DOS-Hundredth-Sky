/** Combat & progression rules (pure, unit-tested, used by the authoritative server). */

export type ClassId = 'warrior' | 'mage' | 'archer' | 'assassin' | 'knight' | 'summoner' | 'healer';
export type Element = 'fire' | 'water' | 'wind' | 'earth' | 'lightning' | 'light' | 'darkness' | 'space' | 'time' | 'physical';

export interface ClassDef {
  id: ClassId; name: string; model: string; role: string; desc: string;
  hp: number; mp: number; atk: number; mag: number; def: number; spd: number;
  weapon: 'sword' | 'staff' | 'bow' | 'dagger' | 'axe';
  hide: string[];
}

export const CLASSES: ClassDef[] = [
  { id: 'warrior', name: 'Warrior', model: 'Barbarian', role: 'Frontline · Strength', desc: 'Raw strength and an unbreakable will. Warriors carve the path the others follow.', hp: 160, mp: 70, atk: 16, mag: 6, def: 9, spd: 1.0, weapon: 'axe', hide: ['1H_Axe_Offhand', 'Mug', '2H_Axe'] },
  { id: 'mage', name: 'Mage', model: 'Mage', role: 'Elemental · Ranged', desc: 'Scholars of the nine elements. A mage speaks, and the world answers in flame and thunder.', hp: 105, mp: 160, atk: 7, mag: 19, def: 5, spd: 1.0, weapon: 'staff', hide: ['Spellbook', 'Spellbook_open', '1H_Wand'] },
  { id: 'archer', name: 'Archer', model: 'Rogue', role: 'Ranged · Precision', desc: 'Patient hunters of the Ancient Forest who never miss twice.', hp: 120, mp: 100, atk: 14, mag: 9, def: 6, spd: 1.05, weapon: 'bow', hide: ['Knife_Offhand', 'Knife', 'Throwable', '1H_Crossbow'] },
  { id: 'assassin', name: 'Assassin', model: 'Rogue_Hooded', role: 'Burst · Shadows', desc: 'Silent blades that strike from darkness and vanish before the echo.', hp: 115, mp: 95, atk: 17, mag: 8, def: 5, spd: 1.12, weapon: 'dagger', hide: ['1H_Crossbow', '2H_Crossbow', 'Throwable'] },
  { id: 'knight', name: 'Knight', model: 'Knight', role: 'Guardian · Defense', desc: 'Sworn shields of the Capital. Where a knight stands, the line holds.', hp: 175, mp: 80, atk: 13, mag: 7, def: 12, spd: 0.96, weapon: 'sword', hide: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', '2H_Sword'] },
  { id: 'summoner', name: 'Summoner', model: 'Mage', role: 'Pact-binder · Control', desc: 'They bargain with spirits older than the Tower itself — and the spirits answer.', hp: 110, mp: 150, atk: 7, mag: 17, def: 6, spd: 1.0, weapon: 'staff', hide: ['Spellbook', '1H_Wand', '2H_Staff'] },
  { id: 'healer', name: 'Healer', model: 'Mage', role: 'Support · Light', desc: 'Keepers of the Light. No party in the Tower survives long without one.', hp: 115, mp: 150, atk: 6, mag: 16, def: 7, spd: 1.0, weapon: 'staff', hide: ['Spellbook', 'Spellbook_open', '2H_Staff'] },
];
export const classById = (id: string) => CLASSES.find((c) => c.id === id) ?? CLASSES[1];

export interface SpellDef {
  id: string; key: number; name: string; title: string; element: Element;
  incantation: string; castTime: number; cooldown: number; mana: number;
  range: number; radius: number; power: number; kind: 'projectile' | 'strike' | 'nova';
  color: number; light: number;
}

export const SPELLS: SpellDef[] = [
  {
    id: 'ignis', key: 1, name: 'IGNIS', title: 'Apocalyptic Flame', element: 'fire',
    incantation: 'From the ashes of the ancient flame, awaken and consume all that stands before me.',
    castTime: 1.6, cooldown: 6, mana: 28, range: 38, radius: 5.5, power: 2.6, kind: 'projectile', color: 0xff6a1f, light: 9,
  },
  {
    id: 'fulgur', key: 2, name: 'FULGUR', title: 'Spear of the Ninth Storm', element: 'lightning',
    incantation: 'Heaven, split open. Let the ninth storm descend as a spear and judge my enemy.',
    castTime: 0.9, cooldown: 4, mana: 18, range: 30, radius: 2.2, power: 1.9, kind: 'strike', color: 0x8fd4ff, light: 14,
  },
  {
    id: 'lux', key: 3, name: 'LUX', title: 'Sanctuary of the First Dawn', element: 'light',
    incantation: 'Light that was before the Tower, bloom within me. Mend the faithful, blind the wicked.',
    castTime: 1.2, cooldown: 12, mana: 30, range: 0, radius: 8, power: 1.2, kind: 'nova', color: 0xffe9a8, light: 7,
  },
];
export const spellById = (id: string) => SPELLS.find((s) => s.id === id);

export const BASIC_ATTACK = { range: 2.8, cooldown: 0.85, arc: Math.PI * 0.6, power: 1.0, rangedRange: 26 };

export type MonsterKind = 'minion' | 'warrior' | 'magus';
export interface MonsterDef { kind: MonsterKind; name: string; model: string; hp: number; atk: number; def: number; xp: number; speed: number; aggro: number; attackRange: number; attackCd: number; ranged: boolean; level: number; weakTo: Element }
export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  minion: { kind: 'minion', name: 'Hollow Skeleton', model: 'Skeleton_Minion', hp: 70, atk: 9, def: 3, xp: 28, speed: 3.6, aggro: 15, attackRange: 2.1, attackCd: 1.6, ranged: false, level: 2, weakTo: 'light' },
  warrior: { kind: 'warrior', name: 'Grave Knight', model: 'Skeleton_Warrior', hp: 150, atk: 15, def: 7, xp: 70, speed: 3.2, aggro: 17, attackRange: 2.4, attackCd: 2.0, ranged: false, level: 4, weakTo: 'fire' },
  magus: { kind: 'magus', name: 'Bone Magus', model: 'Skeleton_Mage', hp: 95, atk: 13, def: 4, xp: 60, speed: 3.0, aggro: 22, attackRange: 16, attackCd: 2.6, ranged: true, level: 4, weakTo: 'lightning' },
};

/** XP needed to go from `level` to `level+1`. */
export function xpToNext(level: number): number {
  return Math.round(80 * Math.pow(level, 1.55) + 20 * level);
}

export interface Stats { maxHp: number; maxMp: number; atk: number; mag: number; def: number }
export function statsFor(cls: ClassId, level: number): Stats {
  const c = classById(cls);
  const g = level - 1;
  return {
    maxHp: Math.round(c.hp * (1 + 0.12 * g)),
    maxMp: Math.round(c.mp * (1 + 0.08 * g)),
    atk: Math.round(c.atk * (1 + 0.1 * g)),
    mag: Math.round(c.mag * (1 + 0.1 * g)),
    def: Math.round(c.def * (1 + 0.08 * g)),
  };
}

/** Grant XP; returns the new level/xp and how many levels were gained. */
export function grantXp(level: number, xp: number, gain: number, cap = 60): { level: number; xp: number; gained: number } {
  let l = level, x = xp + Math.max(0, Math.floor(gain)), gained = 0;
  while (l < cap && x >= xpToNext(l)) { x -= xpToNext(l); l++; gained++; }
  if (l >= cap) x = 0;
  return { level: l, xp: x, gained };
}

/** Deterministic damage: attack power scaled, reduced by defense with diminishing returns,
 *  element weakness ×1.5, crit ×1.75, variance from a provided roll in [0,1). */
export function computeDamage(o: { atk: number; power: number; def: number; element: Element; weakTo?: Element; roll: number; critRoll: number; critChance?: number }): { dmg: number; crit: boolean; weak: boolean } {
  const base = o.atk * o.power * 2.2;
  const mitigation = 100 / (100 + o.def * 6);
  const variance = 0.9 + o.roll * 0.2;
  const weak = !!o.weakTo && o.weakTo === o.element;
  const crit = o.critRoll < (o.critChance ?? 0.12);
  let dmg = base * mitigation * variance * (weak ? 1.5 : 1) * (crit ? 1.75 : 1);
  dmg = Math.max(1, Math.round(dmg));
  return { dmg, crit, weak };
}

export interface CooldownState { [id: string]: number } // ready-at time (s)
export function canCast(now: number, mp: number, spell: SpellDef, cds: CooldownState): { ok: boolean; reason?: string } {
  if ((cds[spell.id] ?? 0) > now) return { ok: false, reason: 'cooldown' };
  if (mp < spell.mana) return { ok: false, reason: 'mana' };
  return { ok: true };
}

export const LOOT_TABLE: Record<MonsterKind, { item: string; rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic'; chance: number }[]> = {
  minion: [ { item: 'Bone Shard', rarity: 'Common', chance: 0.7 }, { item: 'Faded Copper Coin', rarity: 'Common', chance: 0.5 }, { item: 'Hollow Ember', rarity: 'Uncommon', chance: 0.12 } ],
  warrior: [ { item: 'Grave-Iron Fragment', rarity: 'Uncommon', chance: 0.6 }, { item: 'Knight\'s Broken Crest', rarity: 'Rare', chance: 0.15 }, { item: 'Silver Coin', rarity: 'Common', chance: 0.8 } ],
  magus: [ { item: 'Whispering Ash', rarity: 'Uncommon', chance: 0.55 }, { item: 'Cracked Mana Crystal', rarity: 'Rare', chance: 0.2 }, { item: 'Page of the Ninth Sky', rarity: 'Epic', chance: 0.04 } ],
};
export function rollLoot(kind: MonsterKind, rolls: number[]): { item: string; rarity: string }[] {
  const out: { item: string; rarity: string }[] = [];
  LOOT_TABLE[kind].forEach((e, i) => { if ((rolls[i] ?? 1) < e.chance) out.push({ item: e.item, rarity: e.rarity }); });
  return out;
}
