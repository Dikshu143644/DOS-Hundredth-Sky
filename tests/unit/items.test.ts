import { describe, it, expect } from 'vitest';
import { ITEMS, LEGENDARY_IDS, STARTER_WEAPON, CLASS_GIFT, canEquip, equip, unequip, equipBonus, addItem, rarityOf } from '../../src/shared/items';
import { CLASSES, statsFor } from '../../src/shared/combat';
import { Game, ensureKit } from '../../src/server/core/game';
import type { S2C } from '../../src/shared/protocol';

describe('item catalogue', () => {
  it('has the six legendaries from the reference shots, each with a 3D model and lore', () => {
    expect(LEGENDARY_IDS.length).toBe(6);
    for (const id of LEGENDARY_IDS) { const d = ITEMS[id]; expect(d.slot).toBe('weapon'); expect(d.model).toBeTruthy(); expect(d.lore.length).toBeGreaterThan(20); expect(['epic', 'legendary', 'mythical', 'divine', 'unique']).toContain(d.rarity); }
  });
  it('every class has a starter weapon and a gift it can actually wield', () => {
    for (const c of CLASSES) {
      const inv = addItem(addItem([], STARTER_WEAPON[c.id]), CLASS_GIFT[c.id]);
      expect(canEquip(c.id, inv, STARTER_WEAPON[c.id]).ok).toBe(true);
      expect(canEquip(c.id, inv, CLASS_GIFT[c.id]).ok).toBe(true);
    }
  });
  it('rarity lookup is case-insensitive and falls back to common', () => {
    expect(rarityOf('Legendary').id).toBe('legendary');
    expect(rarityOf('nonsense').id).toBe('common');
  });
});

describe('equipment rules', () => {
  const inv = addItem(addItem(addItem([], 'frostfang'), 'aether_staff'), 'Bone Shard', 3);
  it('stacks items', () => { expect(inv.find((e) => e.item === 'Bone Shard')!.n).toBe(3); expect(addItem(inv, 'Bone Shard').find((e) => e.item === 'Bone Shard')!.n).toBe(4); });
  it('refuses items you do not own', () => { expect(canEquip('knight', inv, 'ignis_edge').ok).toBe(false); });
  it('refuses items your class cannot wield', () => { expect(canEquip('knight', inv, 'aether_staff').ok).toBe(false); expect(canEquip('mage', inv, 'aether_staff').ok).toBe(true); });
  it('refuses materials (no slot)', () => { expect(canEquip('knight', inv, 'Bone Shard').ok).toBe(false); });
  it('equip replaces the slot, unequip clears it, and neither mutates the input', () => {
    const e0 = {};
    const r = equip('knight', inv, e0, 'frostfang');
    expect(r.ok).toBe(true); expect(r.eq.weapon).toBe('frostfang'); expect(e0).toEqual({});
    const bad = equip('knight', inv, r.eq, 'aether_staff');
    expect(bad.ok).toBe(false); expect(bad.eq.weapon).toBe('frostfang');
    expect(unequip(r.eq, 'weapon').weapon).toBeUndefined();
  });
  it('bonus sums equipped item stats', () => {
    expect(equipBonus({})).toEqual({ atk: 0, mag: 0, def: 0, hp: 0, mp: 0 });
    const b = equipBonus({ weapon: 'aether_staff' });
    expect(b.mag).toBe(ITEMS.aether_staff.mag); expect(b.mp).toBe(ITEMS.aether_staff.mp);
  });
});

function makeGame() {
  let t = 1000;
  const mem = { data: null as any };
  const game = new Game({
    store: { load: () => mem.data, save: (d: any) => { mem.data = d; } } as any,
    hasher: { hash: async (p: string) => 'h:' + p, verify: async (p: string, h: string) => h === 'h:' + p, token: () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) },
    llm: null, now: () => t, mode: 'offline', bots: 0, dev: false, serverName: 'test',
  });
  return { game, adv: (s: number) => { t += s; } };
}
function client(game: Game, id: number) {
  const inbox: S2C[] = [];
  game.connect({ id, send: (m: S2C) => inbox.push(m) } as any);
  const wait = async (type: string) => { for (let i = 0; i < 50; i++) { const m = inbox.find((x) => x.type === type); if (m) { inbox.splice(inbox.indexOf(m), 1); return m as any; } await new Promise((r) => setTimeout(r, 2)); } throw new Error('no ' + type); };
  return { inbox, wait, send: (m: any) => void game.handle(id, m) };
}
async function joinAs(game: Game, id: number, user: string, cls: string) {
  const c = client(game, id);
  c.send({ type: 'register', user, pass: 'secret-pass' }); expect((await c.wait('auth')).ok).toBe(true);
  c.send({ type: 'createChar', name: 'Hero' + id, cls, appearance: { tint: 0xffffff, accent: 0x55ccff, headgear: false, cape: true, scale: 1, body: 'f' } });
  const chars = await c.wait('chars');
  c.send({ type: 'join', charId: chars.list[0].id });
  return { c, joined: await c.wait('joined') };
}

describe('server inventory & equipment', () => {
  it('a new character joins with its starter weapon and class legendary equipped, and stats include the bonus', async () => {
    const { game } = makeGame();
    const { joined } = await joinAs(game, 1, 'aria@example.com', 'knight');
    expect(joined.equipment.weapon).toBe('sol_aurelia');
    expect(joined.inventory.map((e: any) => e.item)).toEqual(expect.arrayContaining(['iron_sword', 'sol_aurelia']));
    const p = [...game.players.values()][0];
    expect(p.stats.atk).toBe(statsFor('knight', 1).atk + (ITEMS.sol_aurelia.atk ?? 0));
    expect(p.char.appearance.body).toBe('f');
  });
  it('equip swaps the weapon server-side, recomputes stats, persists, and is visible to others', async () => {
    const { game, adv } = makeGame();
    const { c } = await joinAs(game, 1, 'kael', 'knight');
    const { c: other } = await joinAs(game, 2, 'lyra', 'mage');
    c.send({ type: 'equip', item: 'iron_sword' });
    const r = await c.wait('equipment');
    expect(r.ok).toBe(true); expect(r.equipment.weapon).toBe('iron_sword');
    const p = [...game.players.values()].find((x) => x.char.name === 'Hero1')!;
    expect(p.stats.atk).toBe(statsFor('knight', 1).atk + ITEMS.iron_sword.atk!);
    adv(0.1); game.tick(); adv(0.1); game.tick();
    const snaps = other.inbox.filter((m) => m.type === 'snap') as any[];
    const seen = snaps.flatMap((s) => s.ents).find((e: any) => e.id === p.id);
    expect(seen?.w).toBe('iron_sword');
    c.send({ type: 'unequip', slot: 'weapon' });
    const u = await c.wait('equipment');
    expect(u.equipment.weapon).toBeUndefined();
    expect(p.stats.atk).toBe(statsFor('knight', 1).atk);
  });
  it('rejects equipping items not owned or not wieldable by the class, and unknown slots', async () => {
    const { game } = makeGame();
    const { c } = await joinAs(game, 1, 'rogue1', 'knight');
    c.send({ type: 'equip', item: 'frostfang' });
    let r = await c.wait('equipment'); expect(r.ok).toBe(false); expect(r.equipment.weapon).toBe('sol_aurelia');
    c.send({ type: 'equip', item: 'Bone Shard' });
    r = await c.wait('equipment'); expect(r.ok).toBe(false);
    c.send({ type: 'unequip', slot: '__proto__' });
    r = await c.wait('equipment'); expect(r.ok).toBe(false); expect(r.equipment.weapon).toBe('sol_aurelia');
  });
  it('older saves without equipment are backfilled once', () => {
    const ch: any = { cls: 'archer', inventory: [{ item: 'Bone Shard', rarity: 'Common', n: 2 }] };
    ensureKit(ch);
    expect(ch.equipment.weapon).toBe('skyreach');
    expect(ch.inventory.map((e: any) => e.item)).toEqual(['Bone Shard', 'hunter_bow', 'skyreach']);
    ch.equipment = { weapon: 'hunter_bow' }; ensureKit(ch);
    expect(ch.equipment.weapon).toBe('hunter_bow');
  });
  it('accepts email logins', async () => {
    const { game } = makeGame();
    const c = client(game, 9);
    c.send({ type: 'register', user: 'Omkar.Test+dos@Example.com', pass: 'secret-pass' });
    expect((await c.wait('auth')).ok).toBe(true);
    c.send({ type: 'register', user: 'not an email', pass: 'secret-pass' });
    expect((await c.wait('auth')).ok).toBe(false);
  });
});
