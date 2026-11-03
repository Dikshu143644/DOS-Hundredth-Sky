/** Items, rarities and equipment (GDD v0.2 §9). Pure data + rules, shared by client and the
 *  authoritative server (the server is the only one that changes inventories). */
import type { ClassId } from './combat';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythical' | 'divine' | 'unique';
export const RARITIES: { id: Rarity; name: string; color: string }[] = [
  { id: 'common', name: 'Common', color: '#c9cdd3' }, { id: 'uncommon', name: 'Uncommon', color: '#6fdc7a' }, { id: 'rare', name: 'Rare', color: '#4fa8ff' },
  { id: 'epic', name: 'Epic', color: '#b36bff' }, { id: 'legendary', name: 'Legendary', color: '#ffb340' }, { id: 'mythical', name: 'Mythical', color: '#ff5640' },
  { id: 'divine', name: 'Divine', color: '#fff2b0' }, { id: 'unique', name: 'Unique', color: '#40e8d0' },
];
export const rarityOf = (r: string) => RARITIES.find((x) => x.id === r.toLowerCase()) ?? RARITIES[0];

export type Slot = 'weapon' | 'armor' | 'helmet' | 'gloves' | 'boots' | 'ring' | 'necklace' | 'accessory';
export const SLOTS: Slot[] = ['weapon', 'armor', 'helmet', 'gloves', 'boots', 'ring', 'necklace', 'accessory'];
export type WeaponFamily = 'sword' | 'greatsword' | 'daggers' | 'bow' | 'spear' | 'dual' | 'staff' | 'axe';

export interface ItemDef {
  id: string; name: string; slot: Slot | null; family?: WeaponFamily; rarity: Rarity;
  atk?: number; mag?: number; def?: number; hp?: number; mp?: number;
  model?: string; element?: string; title?: string; lore: string; classes?: ClassId[]; value: number;
}

const MELEE: ClassId[] = ['warrior', 'knight', 'assassin'];
const CASTER: ClassId[] = ['mage', 'summoner', 'healer'];
export const ITEMS: Record<string, ItemDef> = {
  // starter weapons (one per class family)
  iron_sword: { id: 'iron_sword', name: 'Gate Guard Sword', slot: 'weapon', family: 'sword', rarity: 'common', atk: 3, model: 'iron_sword', lore: 'Standard issue at the Gate of Dawn. Dull, honest steel.', classes: MELEE, value: 12 },
  war_axe: { id: 'war_axe', name: 'Forester\'s Axe', slot: 'weapon', family: 'axe', rarity: 'common', atk: 4, model: 'war_axe', lore: 'It has felled more pines than monsters. So far.', classes: ['warrior'], value: 12 },
  oak_staff: { id: 'oak_staff', name: 'Novice Oak Staff', slot: 'weapon', family: 'staff', rarity: 'common', mag: 3, model: 'oak_staff', lore: 'Carved from a branch of the Ancient Forest. It hums when it rains.', classes: CASTER, value: 12 },
  hunter_bow: { id: 'hunter_bow', name: 'Hunter\'s Bow', slot: 'weapon', family: 'bow', rarity: 'common', atk: 3, model: 'hunter_bow', lore: 'Yew and sinew. Every forest hunter strings one before they can walk.', classes: ['archer'], value: 12 },
  steel_daggers: { id: 'steel_daggers', name: 'Twin Steel Daggers', slot: 'weapon', family: 'daggers', rarity: 'common', atk: 3, model: 'steel_daggers', lore: 'Balanced for throwing. Rarely thrown.', classes: ['assassin'], value: 12 },
  // legendary set (from Omkar's reference shots)
  frostfang: { id: 'frostfang', name: 'Frostfang', title: 'Blade of the Silent Glacier', slot: 'weapon', family: 'sword', rarity: 'legendary', atk: 18, mag: 6, model: 'frost', element: 'water', lore: 'Forged from ice that fell from the 40th floor and never melted. Its edge sings at absolute zero.', classes: MELEE, value: 5200 },
  ignis_edge: { id: 'ignis_edge', name: 'Ignis', title: 'Edge of the Apocalyptic Flame', slot: 'weapon', family: 'sword', rarity: 'mythical', atk: 24, mag: 8, model: 'ignis', element: 'fire', lore: 'A blade of obsidian that never cooled. The cracks are not damage: they are the fire looking out.', classes: MELEE, value: 9800 },
  umbra_twins: { id: 'umbra_twins', name: 'Umbra Twins', title: 'Crescents of the Ninth Night', slot: 'weapon', family: 'dual', rarity: 'epic', atk: 15, model: 'umbra', element: 'darkness', lore: 'Two crescent blades cut from the same moon. Where one strikes, the other has already arrived.', classes: ['assassin', 'warrior'], value: 3600 },
  aether_staff: { id: 'aether_staff', name: 'Aether Orb Staff', title: 'Keeper of the Ninefold Sky', slot: 'weapon', family: 'staff', rarity: 'legendary', mag: 20, mp: 40, model: 'aether', element: 'space', lore: 'The orb holds a fragment of open sky. On quiet nights you can hear wind inside it.', classes: CASTER, value: 6100 },
  sol_aurelia: { id: 'sol_aurelia', name: 'Sol Aurelia', title: 'Sword of the First Dawn', slot: 'weapon', family: 'sword', rarity: 'divine', atk: 21, mag: 12, hp: 30, model: 'sol', element: 'light', lore: 'Said to be the blade the first climber carried. Its runes still spell a name nobody can read.', classes: ['knight', 'warrior', 'healer'], value: 12000 },
  skyreach: { id: 'skyreach', name: 'Skyreach', title: 'Bow of the Wind Wardens', slot: 'weapon', family: 'bow', rarity: 'legendary', atk: 19, model: 'skyreach', element: 'wind', lore: 'Its string is spun from a cloud. Arrows loosed from it remember the way home.', classes: ['archer'], value: 5600 },
  // materials (existing loot; no slot)
  'Bone Shard': { id: 'Bone Shard', name: 'Bone Shard', slot: null, rarity: 'common', lore: 'Brittle, old, still faintly cold.', value: 2 },
  'Faded Copper Coin': { id: 'Faded Copper Coin', name: 'Faded Copper Coin', slot: null, rarity: 'common', lore: 'Minted under a king nobody remembers.', value: 1 },
  'Hollow Ember': { id: 'Hollow Ember', name: 'Hollow Ember', slot: null, rarity: 'uncommon', lore: 'A spark that forgot how to die.', value: 15 },
  'Grave-Iron Fragment': { id: 'Grave-Iron Fragment', name: 'Grave-Iron Fragment', slot: null, rarity: 'uncommon', lore: 'Smiths pay well for metal that has been buried and returned.', value: 14 },
  'Knight\'s Broken Crest': { id: 'Knight\'s Broken Crest', name: 'Knight\'s Broken Crest', slot: null, rarity: 'rare', lore: 'The house is gone. The oath, apparently, is not.', value: 60 },
  'Silver Coin': { id: 'Silver Coin', name: 'Silver Coin', slot: null, rarity: 'common', lore: 'Good anywhere in the Capital.', value: 5 },
  'Whispering Ash': { id: 'Whispering Ash', name: 'Whispering Ash', slot: null, rarity: 'uncommon', lore: 'Hold it to your ear. Don\'t.', value: 16 },
  'Cracked Mana Crystal': { id: 'Cracked Mana Crystal', name: 'Cracked Mana Crystal', slot: null, rarity: 'rare', lore: 'Still leaks a little light.', value: 55 },
  'Page of the Ninth Sky': { id: 'Page of the Ninth Sky', name: 'Page of the Ninth Sky', slot: null, rarity: 'epic', lore: 'A torn page in a script that rearranges itself when unobserved.', value: 220 },
};
export const LEGENDARY_IDS = ['frostfang', 'ignis_edge', 'umbra_twins', 'aether_staff', 'sol_aurelia', 'skyreach'];
export const itemDef = (id: string): ItemDef | undefined => ITEMS[id];

export interface InvEntry { item: string; rarity: string; n: number }
export type Equipment = Partial<Record<Slot, string>>;

export const STARTER_WEAPON: Record<ClassId, string> = { warrior: 'war_axe', knight: 'iron_sword', assassin: 'steel_daggers', archer: 'hunter_bow', mage: 'oak_staff', summoner: 'oak_staff', healer: 'oak_staff' };
/** The Tower's gift on character creation: one legendary that suits the class. */
export const CLASS_GIFT: Record<ClassId, string> = { warrior: 'ignis_edge', knight: 'sol_aurelia', assassin: 'umbra_twins', archer: 'skyreach', mage: 'aether_staff', summoner: 'aether_staff', healer: 'sol_aurelia' };

export function canEquip(cls: ClassId, inv: InvEntry[], itemId: string): { ok: boolean; reason?: string } {
  const d = ITEMS[itemId];
  if (!d) return { ok: false, reason: 'unknown item' };
  if (!d.slot) return { ok: false, reason: 'not equipment' };
  if (!inv.some((e) => e.item === itemId && e.n > 0)) return { ok: false, reason: 'not owned' };
  if (d.classes && !d.classes.includes(cls)) return { ok: false, reason: 'class cannot use it' };
  return { ok: true };
}
/** Equip (returns a new equipment map; never mutates). Throws nothing: invalid → unchanged + reason. */
export function equip(cls: ClassId, inv: InvEntry[], eq: Equipment, itemId: string): { eq: Equipment; ok: boolean; reason?: string } {
  const c = canEquip(cls, inv, itemId);
  if (!c.ok) return { eq, ok: false, reason: c.reason };
  return { eq: { ...eq, [ITEMS[itemId].slot!]: itemId }, ok: true };
}
export function unequip(eq: Equipment, slot: Slot): Equipment { const n = { ...eq }; delete n[slot]; return n; }
/** Sum of equipped stat bonuses. */
export function equipBonus(eq: Equipment, ench: Record<string, number> = {}): { atk: number; mag: number; def: number; hp: number; mp: number } {
  const b = { atk: 0, mag: 0, def: 0, hp: 0, mp: 0 };
  for (const id of Object.values(eq)) { const d = id ? ITEMS[id] : undefined; if (!d) continue; const k = 1 + 0.06 * (ench[id!] ?? 0); b.atk += Math.round((d.atk ?? 0) * k); b.mag += Math.round((d.mag ?? 0) * k); b.def += Math.round((d.def ?? 0) * k); b.hp += Math.round((d.hp ?? 0) * k); b.mp += Math.round((d.mp ?? 0) * k); }
  return b;
}
export function addItem(inv: InvEntry[], itemId: string, n = 1): InvEntry[] {
  const d = ITEMS[itemId]; const out = inv.map((e) => ({ ...e }));
  const ex = out.find((e) => e.item === itemId);
  if (ex) ex.n += n; else out.push({ item: itemId, rarity: d ? rarityOf(d.rarity).name : 'Common', n });
  return out;
}
