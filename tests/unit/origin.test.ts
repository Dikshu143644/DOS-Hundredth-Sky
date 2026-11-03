import { describe, it, expect } from 'vitest';
import { makeGame, joinAs, client } from './helpers';
import { findFusion, fusionSlots, rankFor, applyOrigin, cheatOffer, FUSION_SKILLS } from '../../src/shared/origin';
import { SKILLS } from '../../src/shared/skills';

async function fullPrologue(c: any, steps: [string, string?][]) {
  const out: any[] = [];
  for (const [step, value] of steps) { c.send({ type: 'prologue', step, value }); out.push(await c.wait('prologue')); }
  return out;
}

describe('reincarnation prologue', () => {
  it('a new soul joins hidden, chooses past life / cheat / class / affinity, and wakes reincarnated', async () => {
    const { game } = makeGame();
    const watcher = await joinAs(game, 'knight', 'Watcher');
    const { c, p } = await joinAs(game, 'mage', 'Isekai', { prologue: true });
    expect((p as any).hidden).toBe(true);
    game.tick();
    const r = await fullPrologue(c, [['start'], ['pastlife', 'An office worker who never went home on time']]);
    expect(r[0].say).toMatch(/Aurelia/); expect(r[0].source).toBe('scripted');
    const offer: string[] = r[1].offer;
    expect(offer).toHaveLength(3); expect(offer).toEqual(cheatOffer(p.char.id));
    // a cheat that was not offered is refused (server authority)
    const notOffered = ['sky_oracle', 'devourer', 'endless_well', 'second_dawn', 'eclipse_sovereign', 'thousand_blades', 'wyrmblood', 'fortunes_favor'].find((x) => !offer.includes(x))!;
    c.send({ type: 'prologue', step: 'cheat', value: notOffered });
    expect(p.char.origin!.cheat).toBeUndefined();
    const baseHp = game.statsOf({ ...p.char, cls: 'warrior', origin: undefined } as any).maxHp;
    await fullPrologue(c, [['cheat', offer[0]], ['class', 'warrior'], ['affinity', 'forbidden']]);
    expect(p.char.cls).toBe('warrior');
    expect(p.char.origin!.cheat).toBe(offer[0]);
    c.send({ type: 'prologue', step: 'finish' });
    await c.wait('prologue', (m: any) => m.step === 'finish');
    const st = await c.wait('status');
    expect(st.s.affinity).toBe('forbidden'); expect(st.s.rank).toBe('F'); expect(st.s.cheat).toBe(offer[0]);
    expect(p.char.origin!.done).toBe(true);
    expect((p as any).hidden).toBe(false);
    expect(p.char.titles).toContain('reincarnated');
    // the Forbidden path costs max HP (unless Dragon Heart offsets it)
    if (offer[0] !== 'wyrmblood') expect(p.stats.maxHp).toBeLessThan(baseHp);
    // she remembers
    expect(p.char.origin!.notes.join(' ')).toMatch(/office worker/);
    void watcher;
  });
  it('the goddess speaks through the AI when it is on (mock LLM) and falls back when it fails', async () => {
    let calls = 0; let fail = false;
    const { game } = makeGame({ llm: async (msgs: any[]) => { calls++; if (fail) return null; expect(msgs[1].content).toMatch(/Isekai2/); return '{"say":"Welcome, little soul, I am Aurelia."}'; } });
    const { c } = await joinAs(game, 'mage', 'Isekai2', { prologue: true });
    c.send({ type: 'prologue', step: 'start' });
    const m = await c.wait('prologue');
    expect(m.source).toBe('llm'); expect(m.say).toMatch(/little soul/); expect(calls).toBe(1);
    fail = true;
    c.send({ type: 'prologue', step: 'talk', text: 'Where am I?' });
    const m2 = await c.wait('prologue');
    expect(m2.source).toBe('scripted'); expect(m2.say.length).toBeGreaterThan(10);
  });
  it('skip gives a sensible cheat + class affinity and finishes', async () => {
    const { game } = makeGame();
    const { c, p } = await joinAs(game, 'archer', 'Skipper', { prologue: true });
    c.send({ type: 'prologue', step: 'skip' });
    await c.wait('status');
    expect(p.char.origin!.done).toBe(true); expect(p.char.origin!.affinity).toBe('wind');
  });
});

describe('skill fusion, rank, stakes, leaderboard', () => {
  it('fusion rules: pairs, chaos, level slots', () => {
    expect(findFusion('water', 'lightning')!.name).toBe('TEMPESTAS');
    expect(findFusion('lightning', 'water')!.id).toBe('f_storm');
    expect(findFusion('forbidden', 'fire')!.id).toBe('f_chaos_fire');
    expect(findFusion('fire', 'fire')).toBeNull();
    expect([1, 5, 15, 30].map(fusionSlots)).toEqual([0, 1, 2, 3]);
    for (const f of FUSION_SKILLS) expect(SKILLS.find((s) => s.id === f.id)).toBeTruthy();
  });
  it('fuses at level 5 and the fused skill can be cast', async () => {
    const { game } = makeGame();
    const { c, p } = await joinAs(game, 'mage', 'Fuser', { prologue: true });
    await fullPrologue(c, [['start'], ['pastlife', 'x']]);
    await fullPrologue(c, [['cheat', cheatOffer(p.char.id)[0]], ['class', 'mage'], ['affinity', 'water']]);
    c.send({ type: 'prologue', step: 'finish' }); await c.wait('status');
    c.send({ type: 'fuse', a: 'water', b: 'lightning' });
    expect((await c.wait('notice', (m: any) => /level 5/.test(m.text))).text).toMatch(/level 5/);
    p.char.level = 5; p.level = 5;
    c.send({ type: 'fuse', a: 'water', b: 'lightning' });
    const st = await c.wait('status');
    expect(st.s.fusions).toEqual(['f_storm']);
    c.send({ type: 'fuse', a: 'water', b: 'fire' });
    expect((await c.wait('notice', (m: any) => /slot/.test(m.text))).text).toMatch(/slot/);
    expect(game.combat.knows(p, SKILLS.find((s) => s.id === 'f_storm')!)).toBe(true);
  });
  it('adventurer rank rises, is protected after a promotion, then drops when you fall', async () => {
    const { game } = makeGame();
    const { c, p } = await joinAs(game, 'warrior', 'Ranker', { prologue: true });
    c.send({ type: 'prologue', step: 'skip' }); await c.wait('status');
    game.origin.addPts(p, 120, 'test');
    expect(rankFor(p.char.advPts!)).toBe('E');
    game.origin.addPts(p, -50, 'fell'); // protected right after promotion
    expect(rankFor(p.char.advPts!)).toBe('E');
    p.char.rankProtectUntil = 0;
    game.origin.addPts(p, -50, 'fell');
    expect(rankFor(p.char.advPts!)).toBe('F');
    // death stakes
    p.char.advPts = 500;
    const out = game.origin.onDeath(p, { name: 'Grave Knight' } as any);
    expect(out.rankLost).toBeGreaterThan(0);
    expect(p.char.deeds!.at(-1)).toMatch(/Grave Knight/);
  });
  it('injuries weaken stats until they heal', () => {
    const base = { maxHp: 200, maxMp: 100, atk: 20, mag: 20, def: 10, crit: 0.05, spd: 1, mpRegen: 2 } as any;
    const now = 1_000_000;
    const hurt = applyOrigin(base, { injuries: [{ id: 'arm', until: now + 60_000 }] }, now);
    expect(hurt.atk).toBeLessThan(20);
    expect(applyOrigin(base, { injuries: [{ id: 'arm', until: now - 1 }] }, now).atk).toBe(20);
  });
  it('power leaderboard ranks every adventurer', async () => {
    const { game } = makeGame();
    const a = await joinAs(game, 'warrior', 'Strong');
    const b = await joinAs(game, 'mage', 'Weak');
    a.p.char.level = 30; game.refreshStats(a.p);
    b.c.send({ type: 'leaderboard' });
    const lb = await b.c.wait('leaderboard');
    expect(lb.rows[0].name).toBe('Strong'); expect(lb.total).toBe(2); expect(lb.place).toBe(2);
    void client;
  });
});
