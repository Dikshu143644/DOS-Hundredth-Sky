import { describe, it, expect } from 'vitest';
import { makeGame, joinAs, sleep, monsterAt } from './helpers';
import { SKILLS, classSkills, ADVANCED, skillForSlot, comboPower, reaction, pointsEarned } from '../../src/shared/skills';
import { CLASSES, statsFor } from '../../src/shared/combat';
import { newCharState, stepCharacter, DODGE } from '../../src/shared/physics';
import { SPAWN } from '../../src/shared/world';

describe('M1 · class kits', () => {
  it('every class has 4 skills, an ultimate and 2 advanced classes with their own skill', () => {
    for (const c of CLASSES) {
      const sk = classSkills(c.id);
      for (const slot of [1, 2, 3, 4]) expect(sk.filter((s) => s.slot === slot).length, `${c.id} slot ${slot}`).toBe(1);
      expect(sk.filter((s) => s.slot === 6 && s.ult).length).toBe(1);
      expect(ADVANCED[c.id].length).toBe(2);
      for (const a of ADVANCED[c.id]) expect(skillForSlot(c.id, 5, a.id)?.adv).toBe(a.id);
    }
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length);
    // the named spells from the plan keep their incantations
    expect(SKILLS.find((s) => s.id === 'ignis')!.incantation).toMatch(/ashes of the ancient flame/);
    for (const s of SKILLS.filter((x) => x.ult)) expect(s.incantation.length).toBeGreaterThan(20);
  });
  it('attributes raise stats and advanced classes add bonuses', () => {
    const base = statsFor('warrior', 10), str = statsFor('warrior', 10, { str: 10 }), adv = statsFor('warrior', 20, {}, 'berserker');
    expect(str.atk).toBe(base.atk + 20);
    expect(adv.atk).toBeGreaterThan(statsFor('warrior', 20).atk);
    expect(pointsEarned(5)).toEqual({ stat: 12, skill: 4 });
  });
});

describe('M1 · combat rules', () => {
  it('basic attack combos: every third hit is a finisher', () => {
    expect(comboPower(1).finisher).toBe(false);
    expect(comboPower(3).finisher).toBe(true);
    expect(comboPower(3).mul).toBeGreaterThan(comboPower(2).mul * 1.5);
  });
  it('elemental reactions', () => {
    expect(reaction('lightning', { soaked: true })?.name).toBe('CONDUCTED');
    expect(reaction('wind', { burning: true })?.name).toBe('FIRESTORM');
    expect(reaction('fire', {})).toBeNull();
  });
  it('a dodge roll is deterministic physics and has a cooldown', () => {
    const a = newCharState(SPAWN.x, SPAWN.z), b = newCharState(SPAWN.x, SPAWN.z);
    for (const s of [a, b]) for (let i = 0; i < 30; i++) stepCharacter(s, { seq: i, mx: 1, mz: 0, yaw: 0, jump: false, sprint: false, walk: false, dt: 1 / 60, dodge: i === 2 }, 1);
    expect(a.x).toBeCloseTo(b.x, 9); expect(a.z).toBeCloseTo(b.z, 9);
    const c = newCharState(SPAWN.x, SPAWN.z);
    for (let i = 0; i < 30; i++) stepCharacter(c, { seq: i, mx: 1, mz: 0, yaw: 0, jump: false, sprint: false, walk: false, dt: 1 / 60 }, 1);
    expect(a.x - SPAWN.x).toBeGreaterThan((c.x - SPAWN.x) + 2); // the roll covered extra ground
    expect(a.dc).toBeGreaterThan(0);
    expect(DODGE.CD).toBeGreaterThan(0.5);
  });
});

describe('M1 · server', () => {
  it('skills are class-locked and level-locked; casting spends mana and starts the cooldown', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'warrior');
    await c.send({ type: 'cast', spell: 'ignis', yaw: 0 });
    expect(c.inbox.some((m) => m.type === 'fx' && (m as any).kind === 'castfail')).toBe(true);
    c.inbox.length = 0;
    await c.send({ type: 'cast', spell: 'leap', yaw: 0 }); // unlocks at 9
    expect(c.inbox.some((m) => m.type === 'fx' && (m as any).kind === 'castfail' && /level 9/.test((m as any).text))).toBe(true);
    const mp0 = p.mp;
    await c.send({ type: 'cast', spell: 'cleave', yaw: 0 });
    expect(p.mp).toBeLessThan(mp0);
    expect(p.cds.cleave).toBeGreaterThan(game.o.now());
    adv(0.3); game.tick();
  });
  it('cleave hits monsters in front, ignis projectile damages and leaves Burning', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'warrior');
    const m = monsterAt(game, 'minion', p.s.x, p.s.z - 2);
    m.def = { ...m.def, aggro: 0 };
    p.s.yaw = 0;
    await c.send({ type: 'cast', spell: 'cleave', yaw: 0 });
    adv(0.2); game.tick();
    expect(m.hp).toBeLessThan(m.mhp);
    const mage = await joinAs(game, 'mage');
    const m2 = monsterAt(game, 'warrior', mage.p.s.x, mage.p.s.z - 10);
    m2.hp = m2.mhp = 5000;
    await mage.c.send({ type: 'cast', spell: 'ignis', target: m2.id, yaw: 0 });
    for (let i = 0; i < 40; i++) { adv(0.05); game.tick(); }
    expect(m2.hp).toBeLessThan(m2.mhp);
    expect(m2.st.burnUntil).toBeGreaterThan(game.o.now() - 2);
  });
  it('parry turns a melee hit back and stuns the attacker; a dodge roll gives i-frames', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'knight');
    const m = monsterAt(game, 'minion', p.s.x, p.s.z - 1.5);
    await c.send({ type: 'parry' });
    const hp0 = p.hp;
    expect(game.combat.damage(m, p, 50, 1, 'physical', game.o.now(), { melee: true })).toBe(false);
    expect(p.hp).toBe(hp0);
    expect(m.stunUntil).toBeGreaterThan(game.o.now());
    expect(p.char.counters.parries).toBe(1);
    adv(2); game.tick();
    // not parrying any more: the same hit lands
    expect(game.combat.damage(m, p, 50, 1, 'physical', game.o.now(), { melee: true })).toBe(true);
    expect(p.hp).toBeLessThan(hp0);
    p.s.dg = 0.2; // mid-roll
    expect(game.combat.damage(m, p, 50, 1, 'physical', game.o.now(), { melee: true })).toBe(false);
  });
  it('stat points, skill ranks, advanced class at 20 and titles', async () => {
    const { game } = makeGame();
    const { c, p } = await joinAs(game, 'archer');
    await c.send({ type: 'allocStat', attr: 'str', n: 1 });
    expect(c.inbox.some((m) => m.type === 'notice' && /No stat points/.test((m as any).text))).toBe(true);
    (game as any).giveXp(p, 200000);
    expect(p.char.level).toBeGreaterThanOrEqual(20);
    const atk0 = p.stats.atk;
    await c.send({ type: 'allocStat', attr: 'str', n: 5 });
    expect(p.char.attrs!.str).toBe(5);
    expect(p.stats.atk).toBe(atk0 + 10);
    await c.send({ type: 'rankSkill', skill: 'pierce' });
    expect(p.char.skillRanks!.pierce).toBe(2);
    await c.send({ type: 'advance', adv: 'sniper' });
    expect(p.char.adv).toBe('sniper');
    expect(p.char.titles).toContain('ascendant');
    expect(p.char.titles).toContain('seasoned');
    await c.send({ type: 'advance', adv: 'ranger' });
    expect(p.char.adv).toBe('sniper'); // permanent
    await c.send({ type: 'cast', spell: 'heartseeker', yaw: 0 });
    expect(p.casting?.spell).toBe('heartseeker');
  });
  it('death costs XP and gold and you respawn Soul-Weary at the shrine', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'mage');
    (game as any).giveXp(p, 50);
    p.char.gold = 100;
    const xp0 = p.char.xp;
    const m = monsterAt(game, 'warrior', p.s.x + 30, p.s.z);
    game.kill(m, p, game.o.now());
    const died = await c.wait('died');
    expect(died.goldLost).toBe(10);
    expect(p.char.xp).toBeLessThan(xp0 + 1);
    adv(9); await c.send({ type: 'respawn' });
    expect(p.dead).toBe(false);
    expect(p.weakUntil).toBeGreaterThan(game.o.now());
    expect(p.char.deaths).toBe(1);
  });
  it('a summoner calls a wolf spirit that fights and expires', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'summoner');
    await c.send({ type: 'cast', spell: 'wolf', yaw: 0 });
    for (let i = 0; i < 30; i++) { adv(0.05); game.tick(); }
    const wolves = [...game.ents.values()].filter((e) => e.type === 's');
    expect(wolves.length).toBe(1);
    const m = monsterAt(game, 'minion', p.s.x + 3, p.s.z);
    for (let i = 0; i < 60; i++) { adv(0.05); game.tick(); await sleep(5); }
    await sleep(350);
    expect(m.hp).toBeLessThan(m.mhp);
    adv(30); game.tick();
    expect([...game.ents.values()].filter((e) => e.type === 's').length).toBe(0);
  });
  it('healer heals an ally; knight shield absorbs; reactions trigger', async () => {
    const { game, adv } = makeGame();
    const h = await joinAs(game, 'healer');
    const k = await joinAs(game, 'knight');
    k.p.hp = 20;
    k.p.s.x = h.p.s.x + 3; k.p.s.z = h.p.s.z;
    await h.c.send({ type: 'cast', spell: 'mend', target: k.p.id, yaw: 0 });
    adv(1); game.tick();
    expect(k.p.hp).toBeGreaterThan(20);
    k.p.char.level = 5; await k.c.send({ type: 'cast', spell: 'guard', yaw: 0 }); adv(0.3); game.tick();
    expect(k.p.st.shield).toBeGreaterThan(0);
    const m = monsterAt(game, 'magus', h.p.s.x + 30, h.p.s.z + 30);
    m.st.soakUntil = game.o.now() + 5;
    const before = m.hp;
    game.combat.damage(h.p, m, 30, 1, 'lightning', game.o.now(), {});
    expect(m.hp).toBeLessThan(before);
    expect(m.st.soakUntil).toBe(0); // consumed by CONDUCTED
  });
});
