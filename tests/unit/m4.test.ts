import { describe, it, expect } from 'vitest';
import { makeGame, joinAs } from './helpers';
import { ITEMS, RARITIES, addItem } from '../../src/shared/items';
import { rollDrops, craft, RECIPES, enchant, enchantChance, salvageYield, shopStock, gearId, validOffer, settleTrade, BOSS_MYTHIC, REGION_MATS, count } from '../../src/shared/economy';

const seq = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const npcEnt = (game: any, key: string) => [...game.ents.values()].find((e: any) => e.type === 'n' && e.def.key === key);
const standBy = (p: any, n: any) => { p.zone = n.zone; p.s.x = n.s.x + 1; p.s.z = n.s.z + 1; };

describe('M4 items', () => {
  it('eight rarities, Common → Unique, every one has items (incl. the legendaries)', () => {
    expect(RARITIES.map((r) => r.name)).toEqual(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythical', 'Divine', 'Unique']);
    for (const r of RARITIES) expect(Object.values(ITEMS).some((d) => d.rarity === r.id), r.id).toBe(true);
    for (const id of ['frostfang', 'ignis_edge', 'umbra_twins', 'aether_staff', 'sol_aurelia', 'skyreach']) expect(ITEMS[id]).toBeTruthy();
    expect(Object.values(ITEMS).filter((d) => d.rarity === 'unique').length).toBe(1);
    const t1 = ITEMS[gearId('sword', 1, 'common')]!, t7 = ITEMS[gearId('sword', 7, 'epic')]!;
    expect(t7.atk!).toBeGreaterThan(t1.atk! * 8);
  });
  it('loot tables: region materials, tiered gear, bosses always pay and sometimes drop their mythical', () => {
    const r = seq(1);
    let mats = 0, gear = 0;
    for (let i = 0; i < 400; i++) for (const d of rollDrops({ kind: 'wolf', level: 9, region: 'forest' }, r)) { if (REGION_MATS.forest.includes(d.item)) mats++; if (d.item.startsWith('g_') && d.item.includes('_2_')) gear++; }
    expect(mats).toBeGreaterThan(150); expect(gear).toBeGreaterThan(15);
    let mythic = 0;
    for (let i = 0; i < 200; i++) { const ds = rollDrops({ kind: 'hrimfang', level: 36, boss: true, region: 'frozen' }, r); expect(ds.filter((d) => d.item.startsWith('g_')).length).toBe(2); if (ds.some((d) => d.item === BOSS_MYTHIC.hrimfang)) mythic++; }
    expect(mythic).toBeGreaterThan(20); expect(mythic).toBeLessThan(90);
  });
  it('crafting consumes inputs and makes rare (sometimes heroic) gear', () => {
    const rc = RECIPES.find((x) => x.id === 'craft_sword_2')!;
    expect('error' in craft(rc, [], 1000, 0.9)).toBe(true);
    let inv = addItem(addItem([], 'Wolf Pelt', 5), 'Spore Cap', 2);
    const ok = craft(rc, inv, 100, 0.9) as any;
    expect(ok.out).toBe(gearId('sword', 2, 'rare')); expect(ok.gold).toBe(50); expect(count(ok.inv, 'Wolf Pelt')).toBe(1); expect(count(ok.inv, 'Spore Cap')).toBe(0);
    expect((craft(rc, inv, 100, 0.1) as any).out).toBe(gearId('sword', 2, 'epic'));
  });
  it('enchanting: safe to +3, riskier after, failures from +7 drop a level', () => {
    expect(enchant(0, 0.99)).toEqual({ lvl: 1, ok: true }); expect(enchantChance(5)).toBeCloseTo(0.7);
    expect(enchant(5, 0.99)).toEqual({ lvl: 5, ok: false }); expect(enchant(8, 0.99)).toEqual({ lvl: 7, ok: false }); expect(enchant(10, 0).ok).toBe(false);
    expect(salvageYield(gearId('ring', 3, 'epic')).find((x) => x.item === 'Enchant Stone')?.n).toBe(2);
  });
  it('shops stock potions, stones and their region tier', () => {
    const s = shopStock('omar', 100);
    expect(s.some((x) => x.item === 'hp_potion')).toBe(true); expect(s.filter((x) => x.item.startsWith('g_') && x.item.includes('_4_')).length).toBe(8);
    expect(shopStock('omar', 100)).toEqual(s);
  });
  it('trade validation refuses equipped items, phantom gold and duplicates', () => {
    const inv = addItem(addItem([], 'iron_sword', 1), 'Bone Shard', 3);
    expect(validOffer({ items: [{ item: 'iron_sword', n: 1 }], gold: 0 }, inv, { weapon: 'iron_sword' }, 10).ok).toBe(false);
    expect(validOffer({ items: [], gold: 50 }, inv, {}, 10).ok).toBe(false);
    expect(validOffer({ items: [{ item: 'Bone Shard', n: 1 }, { item: 'Bone Shard', n: 1 }], gold: 0 }, inv, {}, 10).ok).toBe(false);
    const r = settleTrade({ inv, eq: {}, gold: 10, offer: { items: [{ item: 'Bone Shard', n: 2 }], gold: 5 } }, { inv: [], eq: {}, gold: 0, offer: { items: [], gold: 0 } }) as any;
    expect(count(r.a.inv, 'Bone Shard')).toBe(1); expect(count(r.b.inv, 'Bone Shard')).toBe(2); expect(r.a.gold).toBe(5); expect(r.b.gold).toBe(5);
  });
});

describe('M4 on the server', () => {
  it('shop buy/sell at a merchant, potions heal, crafting + enchanting in town raise stats', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'knight');
    const g = game as any;
    p.char.gold = 5000;
    standBy(p, npcEnt(game, 'sela'));
    await c.send({ type: 'shop', npc: 'sela' });
    const shop = await c.wait('shop');
    expect(shop.stock.length).toBeGreaterThan(8);
    await c.send({ type: 'buy', npc: 'sela', item: 'hp_potion', n: 2 });
    expect(count(p.char.inventory, 'hp_potion')).toBe(2);
    await c.send({ type: 'sell', npc: 'sela', item: 'hp_potion', n: 1 });
    expect(count(p.char.inventory, 'hp_potion')).toBe(1);
    p.hp = 10; await c.send({ type: 'use', item: 'hp_potion' }); expect(p.hp).toBeGreaterThan(30); expect(count(p.char.inventory, 'hp_potion')).toBe(0);
    // craft in the Capital
    p.char.inventory = addItem(addItem(p.char.inventory, 'Bone Shard', 8), 'Grave-Iron Fragment', 4);
    await c.send({ type: 'craft', recipe: 'craft_sword_1' });
    const made = p.char.inventory.find((e: any) => e.item.startsWith('g_sword_1_'));
    expect(made).toBeTruthy();
    // equip + enchant raises attack
    await c.send({ type: 'equip', item: made.item });
    const atk0 = p.stats.atk;
    p.char.inventory = addItem(p.char.inventory, 'Enchant Stone', 10);
    for (let i = 0; i < 3; i++) await c.send({ type: 'enchant', item: made.item });
    expect(p.char.enchant[made.item]).toBe(3); expect(p.stats.atk).toBeGreaterThanOrEqual(atk0);
    // salvage refuses the equipped copy
    await c.send({ type: 'salvage', item: made.item }); expect(count(p.char.inventory, made.item)).toBe(1);
    adv(1);
  });
  it('monsters drop from the loot tables', async () => {
    const { game } = makeGame();
    const { p } = await joinAs(game, 'mage');
    const g = game as any;
    const before = p.char.inventory.length;
    for (let i = 0; i < 30; i++) { const m = g.spawnMonster('hrimfang', 0, 0, 'frozen'); g.onKill(p, m, 0); }
    expect(p.char.inventory.length).toBeGreaterThan(before + 3);
    expect(p.char.inventory.some((e: any) => REGION_MATS.frozen.includes(e.item))).toBe(true);
  });
  it('player trading: request, accept, offer, lock, confirm — atomic swap with enchant levels', async () => {
    const { game } = makeGame();
    const A = await joinAs(game, 'warrior', 'Alpha'), B = await joinAs(game, 'archer', 'Bravo');
    A.p.s.x = B.p.s.x + 2; A.p.s.z = B.p.s.z; A.p.zone = B.p.zone;
    A.p.char.inventory = addItem(A.p.char.inventory, 'Spider Silk', 3); A.p.char.enchant = { 'Spider Silk': 0 };
    A.p.char.inventory = addItem(A.p.char.inventory, 'g_ring_2_rare', 1); A.p.char.enchant['g_ring_2_rare'] = 4;
    B.p.char.gold = 300;
    await A.c.send({ type: 'chat', text: '/trade Bravo' });
    await B.c.wait('tradeInvite');
    await B.c.send({ type: 'trade', op: 'accept' });
    await A.c.send({ type: 'trade', op: 'offer', offer: { items: [{ item: 'Spider Silk', n: 2 }, { item: 'g_ring_2_rare', n: 1 }], gold: 0 } });
    await B.c.send({ type: 'trade', op: 'offer', offer: { items: [], gold: 250 } });
    // an equipped weapon cannot be slipped in
    await A.c.send({ type: 'trade', op: 'offer', offer: { items: [{ item: A.p.char.equipment.weapon, n: 1 }], gold: 0 } });
    await A.c.send({ type: 'trade', op: 'lock' }); await B.c.send({ type: 'trade', op: 'lock' });
    await A.c.send({ type: 'trade', op: 'confirm' }); await B.c.send({ type: 'trade', op: 'confirm' });
    expect(count(B.p.char.inventory, 'Spider Silk')).toBe(2); expect(count(A.p.char.inventory, 'Spider Silk')).toBe(1);
    expect(count(B.p.char.inventory, 'g_ring_2_rare')).toBe(1); expect(B.p.char.enchant['g_ring_2_rare']).toBe(4);
    expect(A.p.char.gold).toBeGreaterThanOrEqual(250); expect(B.p.char.gold).toBe(50);
  });
});
