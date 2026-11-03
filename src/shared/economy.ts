/** Phase 4 · M4: the item economy. Generated gear (7 tiers × 4 drop rarities), region materials,
 *  boss mythicals, divine recipes and one Unique; loot tables; crafting, enchanting, salvage; town
 *  shops; and the validation rules for player trading. Pure + deterministic given the rolls, shared by
 *  the authoritative server, the client UI and the tests. */
import { ITEMS, type ItemDef, type Rarity, type Slot, type WeaponFamily, type InvEntry, type Equipment, addItem } from './items';
import type { ClassId } from './combat';

// ------------------------------------------------------------------ materials
export const REGION_MATS: Record<string, [string, string, string]> = {
  capital: ['Bone Shard', 'Grave-Iron Fragment', "Knight's Broken Crest"],
  forest: ['Wolf Pelt', 'Spore Cap', 'Spider Silk'],
  mountain: ['Iron Ore', 'Orc Tusk', 'Heart-Stone'],
  desert: ['Scarab Shell', 'Mummy Linen', 'Sun Glass'],
  frozen: ['Yeti Fur', 'Frost Fang', 'Rime Crystal'],
  forbidden: ['Void Ash', 'Abyss Ink', 'Warp Mote'],
  tower: ['Star Dust', 'Construct Core', 'Sky Shard'],
};
const MAT_LORE: Record<string, string> = {
  'Wolf Pelt': 'Thick, warm, smells of pine.', 'Spore Cap': 'Glows faintly. Do not eat.', 'Spider Silk': 'Stronger than steel wire, lighter than breath.',
  'Iron Ore': 'Dwarves can tell the mine by the taste.', 'Orc Tusk': 'Yellowed and chipped from a hundred fights.', 'Heart-Stone': 'Warm to the touch, like something alive.',
  'Scarab Shell': 'Brass-hard and iridescent.', 'Mummy Linen': 'Covered in sun-script that moves.', 'Sun Glass': 'Sand that remembers being lightning.',
  'Yeti Fur': 'Never quite dry, never quite cold.', 'Frost Fang': 'It frosts the air around it.', 'Rime Crystal': 'A snowflake the size of a fist that never melts.',
  'Void Ash': 'It falls upward if you let go.', 'Abyss Ink': 'Writes in colours that do not exist.', 'Warp Mote': 'A speck of somewhere else.',
  'Star Dust': 'Swept from the Tower steps at dawn.', 'Construct Core': 'Still ticking.', 'Sky Shard': 'A piece of the hundredth sky. Probably.',
};
const MAT_VALUE = [3, 14, 55];
Object.entries(REGION_MATS).forEach(([, mats]) => mats.forEach((m, i) => {
  if (!ITEMS[m]) ITEMS[m] = { id: m, name: m, slot: null, rarity: (['common', 'uncommon', 'rare'] as Rarity[])[i], lore: MAT_LORE[m] ?? 'A crafting material.', value: MAT_VALUE[i] };
}));
const reg = (d: ItemDef) => { ITEMS[d.id] = d; return d; };
reg({ id: 'Mana Dust', name: 'Mana Dust', slot: null, rarity: 'common', lore: 'What is left when magic is taken apart.', value: 4 });
reg({ id: 'Enchant Stone', name: 'Enchant Stone', slot: null, rarity: 'uncommon', lore: 'Press it to steel and whisper a number.', value: 40 });
// consumables
export interface Consumable { hp?: number; mp?: number; cd: number }
export const CONSUMABLES: Record<string, Consumable> = { hp_potion: { hp: 0.35, cd: 8 }, mp_potion: { mp: 0.35, cd: 8 }, elixir: { hp: 0.6, mp: 0.6, cd: 30 } };
reg({ id: 'hp_potion', name: 'Healing Draught', slot: null, rarity: 'common', lore: 'Restores 35% HP. Tastes of mint and copper.', value: 18 });
reg({ id: 'mp_potion', name: 'Mana Draught', slot: null, rarity: 'common', lore: 'Restores 35% MP. Fizzes.', value: 18 });
reg({ id: 'elixir', name: 'Sky Elixir', slot: null, rarity: 'rare', lore: 'Restores 60% HP and MP. Bottled at the Tower\'s foot.', value: 120 });

// ------------------------------------------------------------------ generated gear
export const TIERS = [
  { t: 1, mat: 'Copper', lvl: 1, region: 'capital' }, { t: 2, mat: 'Iron', lvl: 8, region: 'forest' }, { t: 3, mat: 'Steel', lvl: 15, region: 'mountain' },
  { t: 4, mat: 'Mithril', lvl: 22, region: 'desert' }, { t: 5, mat: 'Adamant', lvl: 29, region: 'frozen' }, { t: 6, mat: 'Starmetal', lvl: 36, region: 'forbidden' }, { t: 7, mat: 'Skyforged', lvl: 43, region: 'tower' },
];
export const DROP_RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic'];
const RAR_MULT: Record<string, number> = { common: 1, uncommon: 1.2, rare: 1.45, epic: 1.75, legendary: 2.1, mythical: 2.4, divine: 2.7, unique: 3 };
const RAR_ADJ: Record<string, string> = { common: '', uncommon: 'Fine ', rare: 'Masterwork ', epic: 'Heroic ' };
type Kind = { key: string; slot: Slot; family?: WeaponFamily; noun: string; classes?: ClassId[]; base: Partial<Record<'atk' | 'mag' | 'def' | 'hp' | 'mp', number>>; model?: string };
export const GEAR_KINDS: Kind[] = [
  { key: 'sword', slot: 'weapon', family: 'sword', noun: 'Sword', classes: ['warrior', 'knight'], base: { atk: 4 }, model: 'iron_sword' },
  { key: 'axe', slot: 'weapon', family: 'axe', noun: 'Axe', classes: ['warrior'], base: { atk: 4.6 }, model: 'war_axe' },
  { key: 'daggers', slot: 'weapon', family: 'daggers', noun: 'Daggers', classes: ['assassin'], base: { atk: 4 }, model: 'steel_daggers' },
  { key: 'bow', slot: 'weapon', family: 'bow', noun: 'Bow', classes: ['archer'], base: { atk: 4 }, model: 'hunter_bow' },
  { key: 'staff', slot: 'weapon', family: 'staff', noun: 'Staff', classes: ['mage', 'summoner', 'healer'], base: { mag: 4.2 }, model: 'oak_staff' },
  { key: 'armor', slot: 'armor', noun: 'Cuirass', base: { def: 4, hp: 10 } },
  { key: 'helmet', slot: 'helmet', noun: 'Helm', base: { def: 2, hp: 5 } },
  { key: 'gloves', slot: 'gloves', noun: 'Gauntlets', base: { atk: 1, def: 1 } },
  { key: 'boots', slot: 'boots', noun: 'Greaves', base: { def: 1.5, hp: 4 } },
  { key: 'ring', slot: 'ring', noun: 'Ring', base: { atk: 1, mag: 2 } },
  { key: 'necklace', slot: 'necklace', noun: 'Amulet', base: { hp: 15, mp: 10 } },
];
export const gearId = (kind: string, t: number, r: Rarity) => `g_${kind}_${t}_${r}`;
for (const T of TIERS) for (const K of GEAR_KINDS) for (const r of DROP_RARITIES) {
  const m = (1 + (T.t - 1) * 0.9) * RAR_MULT[r];
  const st: Partial<ItemDef> = {};
  for (const [k, v] of Object.entries(K.base)) (st as any)[k] = Math.max(1, Math.round(v! * m));
  reg({ id: gearId(K.key, T.t, r), name: `${RAR_ADJ[r]}${T.mat} ${K.noun}`, slot: K.slot, family: K.family, rarity: r, ...st, model: K.model, classes: K.classes,
    lore: `${T.mat}-tier ${K.noun.toLowerCase()} (tier ${T.t}, level ${T.lvl}+).`, value: Math.round(10 * T.t * T.t * RAR_MULT[r] * (K.slot === 'weapon' ? 1.4 : 1)) });
}
export const tierFor = (level: number) => Math.max(1, Math.min(7, 1 + Math.floor((level - 1) / 7)));

// ------------------------------------------------------------------ boss mythicals, divine, unique
export const BOSS_MYTHIC: Record<string, string> = { gravelord: 'gravelords_cleaver', mushking: 'sporecrown', colossus: 'colossus_heart', sandmaw: 'tyrants_fang', hrimfang: 'wyrmscale_mantle', malakar: 'archfiend_sigil', skyfang: 'gatekeepers_wing' };
reg({ id: 'gravelords_cleaver', name: "Grave Lord's Cleaver", title: 'It remembers every neck', slot: 'weapon', family: 'sword', rarity: 'mythical', atk: 20, hp: 20, model: 'iron_sword', element: 'darkness', classes: ['warrior', 'knight'], lore: 'Varkas carried it out of a war nobody won.', value: 900 });
reg({ id: 'sporecrown', name: 'Sporecrown', title: 'Diadem of the Mushroom Queen', slot: 'helmet', rarity: 'mythical', def: 10, mp: 40, mag: 6, lore: 'It grows a little each night.', value: 900 });
reg({ id: 'colossus_heart', name: 'Colossus Heart', title: 'Engine of the Iron Peaks', slot: 'necklace', rarity: 'mythical', hp: 90, def: 6, lore: 'Still beating, slowly.', value: 1000 });
reg({ id: 'tyrants_fang', name: "Tyrant's Fang", title: 'Dagger of the Deep Dunes', slot: 'weapon', family: 'daggers', rarity: 'mythical', atk: 26, model: 'steel_daggers', classes: ['assassin'], lore: 'Pulled from the Sandmaw\'s jaw. It wants to go back.', value: 1100 });
reg({ id: 'wyrmscale_mantle', name: 'Wyrmscale Mantle', title: 'Cloak of Hrimfang', slot: 'armor', rarity: 'mythical', def: 26, hp: 70, lore: 'Frost never touches the one who wears it.', value: 1200 });
reg({ id: 'archfiend_sigil', name: 'Archfiend Sigil', title: 'Ring of Malakar', slot: 'ring', rarity: 'mythical', mag: 22, atk: 10, lore: 'It whispers offers. Decline them.', value: 1300 });
reg({ id: 'gatekeepers_wing', name: "Gatekeeper's Wing", title: 'Bow of Skyfang', slot: 'weapon', family: 'bow', rarity: 'mythical', atk: 30, model: 'hunter_bow', classes: ['archer'], lore: 'A wing-bone strung with lightning.', value: 1500 });
reg({ id: 'aurelias_tear', name: "Aurelia's Tear", title: 'The Goddess\'s Farewell', slot: 'necklace', rarity: 'divine', hp: 120, mp: 80, mag: 12, lore: 'She cried once, for you. Someone caught it.', value: 4000 });
reg({ id: 'halo_first_climber', name: 'Halo of the First Climber', title: 'Light of Floor One Hundred', slot: 'helmet', rarity: 'divine', def: 22, atk: 12, mag: 12, hp: 60, lore: 'Forged from every region\'s rarest stone.', value: 4200 });
reg({ id: 'crown_hundredth_sky', name: 'Crown of the Hundredth Sky', title: 'There is only one', slot: 'helmet', rarity: 'unique', def: 30, atk: 18, mag: 18, hp: 100, mp: 60, lore: 'Given by the Keeper to the climber who learned his name.', value: 9999 });
export const UNIQUE_REWARD: Record<string, string> = { hid_twr: 'crown_hundredth_sky' };

// ------------------------------------------------------------------ loot tables
export interface Drop { item: string; rarity: string; n?: number }
/** What a monster drops. `r` returns 0..1 rolls. Bosses: guaranteed gear (rare+), mythical chance. */
export function rollDrops(m: { kind: string; level: number; boss?: boolean; region?: string }, r: () => number): Drop[] {
  const out: Drop[] = [];
  const mats = REGION_MATS[m.region ?? 'capital'] ?? REGION_MATS.capital;
  if (m.region && m.region !== 'capital') {
    if (r() < 0.55) out.push({ item: mats[0], rarity: 'Common' });
    if (r() < 0.22) out.push({ item: mats[1], rarity: 'Uncommon' });
    if (r() < (m.boss ? 1 : 0.05)) out.push({ item: mats[2], rarity: 'Rare' });
  }
  if (r() < (m.boss ? 1 : 0.03)) out.push({ item: 'Enchant Stone', rarity: 'Uncommon' });
  if (!m.boss && r() < 0.06) out.push({ item: r() < 0.5 ? 'hp_potion' : 'mp_potion', rarity: 'Common' });
  const gearRolls = m.boss ? 2 : r() < 0.12 ? 1 : 0;
  for (let i = 0; i < gearRolls; i++) {
    const x = r(); const rar: Rarity = m.boss ? (x < 0.5 ? 'rare' : 'epic') : x < 0.6 ? 'common' : x < 0.88 ? 'uncommon' : x < 0.98 ? 'rare' : 'epic';
    const K = GEAR_KINDS[Math.floor(r() * GEAR_KINDS.length)];
    const id = gearId(K.key, tierFor(m.level), rar);
    out.push({ item: id, rarity: ITEMS[id] ? cap(rar) : 'Common' });
  }
  if (m.boss && BOSS_MYTHIC[m.kind] && r() < 0.25) out.push({ item: BOSS_MYTHIC[m.kind], rarity: 'Mythical' });
  return out;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ crafting
export interface Recipe { id: string; out: string; outEpic?: string; inputs: { item: string; n: number }[]; gold: number; tier: number; kind: string }
export const RECIPES: Recipe[] = [];
for (const T of TIERS) for (const K of GEAR_KINDS) {
  const [a, b] = REGION_MATS[T.region];
  RECIPES.push({ id: `craft_${K.key}_${T.t}`, out: gearId(K.key, T.t, 'rare'), outEpic: gearId(K.key, T.t, 'epic'), inputs: [{ item: a, n: 4 }, { item: b, n: 2 }], gold: 25 * T.t, tier: T.t, kind: K.key });
}
RECIPES.push({ id: 'craft_hp_potion', out: 'hp_potion', inputs: [{ item: 'Bone Shard', n: 2 }], gold: 5, tier: 0, kind: 'potion' });
RECIPES.push({ id: 'craft_mp_potion', out: 'mp_potion', inputs: [{ item: 'Mana Dust', n: 2 }], gold: 5, tier: 0, kind: 'potion' });
RECIPES.push({ id: 'craft_elixir', out: 'elixir', inputs: [{ item: 'hp_potion', n: 1 }, { item: 'mp_potion', n: 1 }, { item: 'Star Dust', n: 1 }], gold: 40, tier: 0, kind: 'potion' });
RECIPES.push({ id: 'craft_aurelias_tear', out: 'aurelias_tear', inputs: Object.values(REGION_MATS).filter((m) => m[2] !== "Knight's Broken Crest").map((m) => ({ item: m[2], n: 2 })), gold: 5000, tier: 8, kind: 'divine' });
RECIPES.push({ id: 'craft_halo', out: 'halo_first_climber', inputs: [...Object.values(REGION_MATS).map((m) => ({ item: m[2], n: 3 })), { item: 'Enchant Stone', n: 10 }], gold: 6000, tier: 8, kind: 'divine' });
export const count = (inv: InvEntry[], id: string) => inv.find((e) => e.item === id)?.n ?? 0;
export function removeItem(inv: InvEntry[], id: string, n = 1): InvEntry[] { return inv.map((e) => (e.item === id ? { ...e, n: e.n - n } : { ...e })).filter((e) => e.n > 0); }
/** Can `inv`+`gold` pay for the recipe? (equipped copies may not be consumed) */
export function canCraft(rc: Recipe, inv: InvEntry[], gold: number): { ok: boolean; reason?: string } {
  if (gold < rc.gold) return { ok: false, reason: `needs ${rc.gold} gold` };
  for (const i of rc.inputs) if (count(inv, i.item) < i.n) return { ok: false, reason: `needs ${i.n}× ${i.item}` };
  return { ok: true };
}
export function craft(rc: Recipe, inv: InvEntry[], gold: number, roll: number): { inv: InvEntry[]; gold: number; out: string } | { error: string } {
  const c = canCraft(rc, inv, gold); if (!c.ok) return { error: c.reason! };
  let next = inv; for (const i of rc.inputs) next = removeItem(next, i.item, i.n);
  const out = rc.outEpic && roll < 0.25 ? rc.outEpic : rc.out;
  return { inv: addItem(next, out), gold: gold - rc.gold, out };
}

// ------------------------------------------------------------------ enchanting & salvage
export const MAX_ENCHANT = 10;
export const enchantCost = (lvl: number) => ({ stones: 1 + Math.floor(lvl / 2), gold: 30 * (lvl + 1) * (lvl + 1) });
export const enchantChance = (lvl: number) => (lvl < 3 ? 1 : Math.max(0.25, 1 - (lvl - 2) * 0.1));
/** Try to raise +lvl → +lvl+1. Failure below +7 keeps the level; from +7 it drops one. */
export function enchant(lvl: number, roll: number): { lvl: number; ok: boolean } {
  if (lvl >= MAX_ENCHANT) return { lvl, ok: false };
  if (roll < enchantChance(lvl)) return { lvl: lvl + 1, ok: true };
  return { lvl: lvl >= 7 ? lvl - 1 : lvl, ok: false };
}
export const enchantMult = (lvl = 0) => 1 + 0.06 * lvl;
/** Breaking gear down returns dust (and stones for rare+). */
export function salvageYield(id: string): Drop[] {
  const d = ITEMS[id]; if (!d?.slot) return [];
  const i = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythical', 'divine', 'unique'].indexOf(d.rarity);
  const out: Drop[] = [{ item: 'Mana Dust', rarity: 'Common', n: 1 + i * 2 }];
  if (i >= 2) out.push({ item: 'Enchant Stone', rarity: 'Uncommon', n: i - 1 });
  return out;
}

// ------------------------------------------------------------------ shops
export const SHOPS: Record<string, { name: string; region: string }> = {
  sela: { name: "Sela's Curiosities", region: 'capital' }, tobb: { name: "Tobb's Herbs & Hides", region: 'forest' }, gunda: { name: 'Kharaz Supply', region: 'mountain' },
  omar: { name: "Omar's Caravan", region: 'desert' }, eira: { name: 'Frosthold Infirmary', region: 'frozen' }, vex: { name: "Vex's Salvage", region: 'forbidden' }, juna: { name: "Juna's Sky-Dew", region: 'tower' },
};
/** Daily stock: potions, stones, and 8 pieces of the region's tier gear (common/uncommon). */
export function shopStock(npc: string, day: number): { item: string; price: number }[] {
  const s = SHOPS[npc]; if (!s) return [];
  const t = TIERS.find((x) => x.region === s.region)!.t;
  const out = ['hp_potion', 'mp_potion', 'Enchant Stone', ...(t >= 5 ? ['elixir'] : [])].map((item) => ({ item, price: priceOf(item) }));
  let seed = (day * 9301 + npc.length * 49297 + npc.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const picks = new Set<string>();
  while (picks.size < 8) picks.add(gearId(GEAR_KINDS[Math.floor(rnd() * GEAR_KINDS.length)].key, t, rnd() < 0.7 ? 'common' : 'uncommon'));
  for (const id of picks) out.push({ item: id, price: priceOf(id) });
  return out;
}
export const priceOf = (id: string) => Math.max(1, Math.round((ITEMS[id]?.value ?? 1) * 1.0));
export const sellPrice = (id: string) => Math.max(1, Math.floor((ITEMS[id]?.value ?? 1) * 0.4));

// ------------------------------------------------------------------ trading
export interface TradeOffer { items: { item: string; n: number }[]; gold: number }
/** An offer is valid if every item is owned in that quantity, not needed for equipped slots, and gold is covered. */
export function validOffer(o: TradeOffer, inv: InvEntry[], eq: Equipment, gold: number): { ok: boolean; reason?: string } {
  if (!Number.isFinite(o.gold) || o.gold < 0 || o.gold > gold) return { ok: false, reason: 'not enough gold' };
  if (o.items.length > 12) return { ok: false, reason: 'too many items' };
  const seen = new Set<string>();
  for (const it of o.items) {
    if (seen.has(it.item)) return { ok: false, reason: 'duplicate item' }; seen.add(it.item);
    if (!Number.isInteger(it.n) || it.n <= 0) return { ok: false, reason: 'bad quantity' };
    const equipped = Object.values(eq).filter((x) => x === it.item).length;
    if (count(inv, it.item) - equipped < it.n) return { ok: false, reason: `you don't have ${it.n}× ${ITEMS[it.item]?.name ?? it.item} free` };
  }
  return { ok: true };
}
/** Apply an accepted trade atomically: returns both new inventories/gold, or an error if either side changed. */
export function settleTrade(a: { inv: InvEntry[]; eq: Equipment; gold: number; offer: TradeOffer }, b: { inv: InvEntry[]; eq: Equipment; gold: number; offer: TradeOffer }) {
  const va = validOffer(a.offer, a.inv, a.eq, a.gold), vb = validOffer(b.offer, b.inv, b.eq, b.gold);
  if (!va.ok || !vb.ok) return { error: va.reason ?? vb.reason } as const;
  let ia = a.inv, ib = b.inv;
  for (const it of a.offer.items) { ia = removeItem(ia, it.item, it.n); ib = addItem(ib, it.item, it.n); }
  for (const it of b.offer.items) { ib = removeItem(ib, it.item, it.n); ia = addItem(ia, it.item, it.n); }
  return { a: { inv: ia, gold: a.gold - a.offer.gold + b.offer.gold }, b: { inv: ib, gold: b.gold - b.offer.gold + a.offer.gold } } as const;
}
