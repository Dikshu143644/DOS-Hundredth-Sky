import { describe, it, expect } from 'vitest';
import { makeGame, joinAs, client } from './helpers';
import { REGIONS } from '../../src/shared/regions';
import { withZone, buildZone } from '../../src/shared/world';
import { queryColliders, circleVsCollider } from '../../src/shared/physics';
import { arenaPlan, raidId, RAID_INSTANCES, WORLD_BOSSES } from '../../src/shared/instances';
import { MONSTERS } from '../../src/shared/combat';

const seen = (c: any, type: string, pred: (m: any) => boolean = () => true) => c.inbox.filter((m: any) => m.type === type && pred(m));
const last = (c: any, type: string) => { const a = seen(c, type); return a[a.length - 1]; };

describe('M6 · parties', () => {
  it('invite → accept → shared HP frames, party chat, shared XP for members who did not hit', async () => {
    const { game, adv } = makeGame();
    const a = await joinAs(game, 'warrior', 'Leada'), b = await joinAs(game, 'mage', 'Memba');
    await a.c.send({ type: 'social', op: 'invite', name: 'Memba' });
    expect(seen(b.c, 'invite').length).toBe(1);
    await b.c.send({ type: 'social', op: 'accept' });
    const party = game.social.partyOf(a.p)!;
    expect(party.members).toEqual([a.p.id, b.p.id]);
    expect(party.leader).toBe(a.p.id);
    adv(0.6); game.tick();
    const v = last(b.c, 'party').party;
    expect(v.members.map((m: any) => m.name)).toEqual(['Leada', 'Memba']);
    expect(v.members[0].mhp).toBeGreaterThan(0);
    await b.c.send({ type: 'chat', text: '/p hello team' });
    expect(seen(a.c, 'chat', (m) => m.channel === 'party' && m.text === 'hello team').length).toBe(1);
    // XP share: b stands next to the kill but never hit it
    b.p.s.x = a.p.s.x + 3; b.p.s.z = a.p.s.z;
    const xp0 = b.p.char.xp + b.p.char.level * 1e7;
    const m = game.spawnMonster('minion' as any, a.p.s.x + 1, a.p.s.z, a.p.zone);
    m.threat.set(a.p.id, 10);
    game.kill(a.p, m, 0);
    expect(b.p.char.xp + b.p.char.level * 1e7).toBeGreaterThan(xp0);
    // leader leaves → party of one dissolves
    await a.c.send({ type: 'social', op: 'leave' });
    expect(game.social.partyOf(b.p)).toBe(null);
  });
  it('a party caps at 8 and only the leader invites', async () => {
    const { game } = makeGame();
    const ps = [] as any[];
    for (let i = 0; i < 9; i++) ps.push(await joinAs(game, 'warrior', 'Cap' + i));
    for (let i = 1; i < 8; i++) { await ps[0].c.send({ type: 'social', op: 'invite', name: 'Cap' + i }); await ps[i].c.send({ type: 'social', op: 'accept' }); }
    expect(game.social.partyOf(ps[0].p)!.members.length).toBe(8);
    await ps[0].c.send({ type: 'social', op: 'invite', name: 'Cap8' });
    expect(seen(ps[8].c, 'invite').length).toBe(0);
    await ps[3].c.send({ type: 'social', op: 'invite', name: 'Cap8' });
    expect(seen(ps[8].c, 'invite').length).toBe(0);
  });
});

describe('M6 · guilds', () => {
  it('create (costs gold) → join open guild → guild chat → bank deposit / officer-only withdraw → persists', async () => {
    const { game, mem } = makeGame();
    const a = await joinAs(game, 'warrior', 'Founder'), b = await joinAs(game, 'archer', 'Recruit');
    await a.c.send({ type: 'social', op: 'gcreate', name: 'Dawn Wardens', tag: 'dw' });
    expect(a.p.char.guild).toBeFalsy(); // not enough gold
    a.p.char.gold = 800;
    await a.c.send({ type: 'social', op: 'gcreate', name: 'Dawn Wardens', tag: 'dw' });
    const gid = a.p.char.guild!;
    expect(gid).toBeTruthy();
    expect(a.p.char.gold).toBe(300);
    expect(a.p.char.titles).toContain('guild_founder');
    const g = game.social.guilds[gid];
    expect(g.tag).toBe('DW');
    await b.c.send({ type: 'social', op: 'gjoin', id: gid });
    expect(b.p.char.guild).toBe(gid);
    await b.c.send({ type: 'chat', text: '/g for the dawn' });
    expect(seen(a.c, 'chat', (m) => m.channel === 'guild' && m.text === 'for the dawn').length).toBe(1);
    b.p.char.gold = 200;
    b.p.char.inventory.push({ item: 'Enchant Stone', rarity: 'Rare', n: 3 });
    await b.c.send({ type: 'social', op: 'gop', sub: 'deposit', gold: 150, item: 'Enchant Stone', n: 2 });
    expect(g.bank.gold).toBe(150); expect(b.p.char.gold).toBe(50);
    expect(g.bank.items.find((e) => e.item === 'Enchant Stone')!.n).toBe(2);
    // overdraw and member-withdraw are refused
    await b.c.send({ type: 'social', op: 'gop', sub: 'deposit', gold: 999 });
    expect(g.bank.gold).toBe(150);
    await b.c.send({ type: 'social', op: 'gop', sub: 'withdraw', gold: 100 });
    expect(g.bank.gold).toBe(150);
    await a.c.send({ type: 'social', op: 'gop', sub: 'withdraw', gold: 100, item: 'Enchant Stone', n: 1 });
    expect(g.bank.gold).toBe(50); expect(a.p.char.gold).toBe(400);
    await a.c.send({ type: 'social', op: 'gop', sub: 'withdraw', gold: 51 });
    expect(g.bank.gold).toBe(50);
    // closed recruitment: invite only
    await a.c.send({ type: 'social', op: 'gop', sub: 'open', open: false });
    const c3 = await joinAs(game, 'mage', 'Outsider');
    await c3.c.send({ type: 'social', op: 'gjoin', id: gid });
    expect(c3.p.char.guild).toBeFalsy();
    await a.c.send({ type: 'social', op: 'ginvite', name: 'Outsider' });
    await c3.c.send({ type: 'social', op: 'gaccept' });
    expect(c3.p.char.guild).toBe(gid);
    expect(g.members.length).toBe(3);
    expect(JSON.stringify(game.data.guilds)).toContain('Dawn Wardens');
    void mem;
  });
});

describe('M6 · world boss', () => {
  it('announced, spawns on its timer, every participant is rewarded, then the next one is scheduled', async () => {
    const { game, adv, now } = makeGame();
    const a = await joinAs(game, 'warrior', 'Titanfoe'), b = await joinAs(game, 'mage', 'Titanfoe2');
    expect(game.social.wb.state).toBe('idle');
    adv(185); game.tick();
    expect(game.social.wb.state).toBe('soon');
    expect(seen(a.c, 'chat', (m) => m.channel === 'world' && /will rise/.test(m.text)).length).toBe(1);
    adv(120); game.tick();
    expect(game.social.wb.state).toBe('active');
    const boss = game.ents.get(game.social.wb.id) as any;
    expect(boss.zone).toBe(WORLD_BOSSES[0].zone);
    expect(boss.mhp).toBeGreaterThan(MONSTERS[WORLD_BOSSES[0].kind as 'slime'].hp); // scaled for 2 online
    boss.threat.set(a.p.id, 50); boss.threat.set(b.p.id, 40);
    const inv0 = b.p.char.inventory.length, gold0 = b.p.char.gold;
    game.kill(a.p, boss, now());
    expect(a.p.char.titles).toContain('world_breaker');
    expect(b.p.char.titles).toContain('world_breaker');
    expect(b.p.char.gold).toBeGreaterThan(gold0);
    expect(b.p.char.inventory.length).toBeGreaterThan(inv0);
    expect(game.social.wb.state).toBe('idle');
    expect(game.social.wb.at).toBeGreaterThan(now() + 1100);
    expect(game.social.wb.idx).toBe(1);
  });
});

describe('M6 · raid (4–8 players)', () => {
  it('the raid arena is walled with no gaps', () => {
    const P = arenaPlan('raid');
    withZone(raidId(1), () => {
      buildZone();
      for (let k = 0; k < 360; k++) { const a = (k / 360) * Math.PI * 2, x = Math.cos(a) * P.wallR, z = Math.sin(a) * P.wallR; expect(queryColliders(x, z, 0.5).some((c) => circleVsCollider(x, z, 0.45, c))).toBe(true); }
    });
    expect(Object.keys(REGIONS).filter((z) => /^raid\d$/.test(z)).length).toBe(RAID_INSTANCES);
  });
  it('needs a party of 4–8; phases, then rewards for every member; instance is private and closes', async () => {
    const { game, adv, now } = makeGame();
    const ps = [] as any[];
    for (let i = 0; i < 4; i++) ps.push(await joinAs(game, i % 2 ? 'mage' : 'warrior', 'Raider' + i));
    for (const x of ps) x.p.char.level = 55;
    await ps[0].c.send({ type: 'social', op: 'raid' });
    expect(ps[0].p.zone).toBe('capital'); // alone
    for (let i = 1; i < 3; i++) { await ps[0].c.send({ type: 'social', op: 'invite', name: 'Raider' + i }); await ps[i].c.send({ type: 'social', op: 'accept' }); }
    await ps[0].c.send({ type: 'social', op: 'raid' });
    expect(ps[0].p.zone).toBe('capital'); // 3 < 4
    await ps[0].c.send({ type: 'social', op: 'invite', name: 'Raider3' }); await ps[3].c.send({ type: 'social', op: 'accept' });
    await ps[1].c.send({ type: 'social', op: 'raid' });
    expect(ps[1].p.zone).toBe('capital'); // not the leader
    await ps[0].c.send({ type: 'social', op: 'raid' });
    for (const x of ps) expect(x.p.zone).toBe('raid1');
    const r = game.social.raidOf(ps[0].p)!;
    const boss = game.ents.get(r.boss) as any;
    expect(boss.name).toContain('Kaelthar');
    // phase 2 summons shades, phase 3 enrages
    boss.hp = boss.mhp * 0.6; adv(0.1); game.tick();
    expect(r.phase).toBe(1);
    expect([...game.ents.values()].filter((e: any) => e.zone === 'raid1' && e.def?.kind === 'rb_shade').length).toBeGreaterThanOrEqual(4);
    boss.hp = boss.mhp * 0.3; adv(0.1); game.tick();
    expect(r.phase).toBe(2); expect(boss.enraged).toBe(true);
    for (const x of ps) boss.threat.set(x.p.id, 10);
    game.kill(ps[0].p, boss, now());
    for (const x of ps) { expect(x.p.char.titles).toContain('eclipse_breaker'); expect(x.p.char.inventory.some((e: any) => e.item === 'eclipse_scale')).toBe(true); }
    adv(61); game.tick();
    for (const x of ps) expect(x.p.zone).toBe('capital');
    expect(game.social.raids.size).toBe(0);
    expect([...game.ents.values()].some((e: any) => e.zone === 'raid1')).toBe(false);
  });
  it('a wipe or the 8-minute eclipse resets the instance', async () => {
    const { game, adv } = makeGame();
    const a = await joinAs(game, 'warrior', 'Soloraid');
    await a.c.send({ type: 'chat', text: '/raid' }); // dev: solo
    expect(a.p.zone).toBe('raid1');
    adv(481); game.tick(); adv(0.1); game.tick();
    expect(game.social.raids.size).toBe(0);
  });
});

describe('M6 · PvP arena', () => {
  it('queue → matched → no damage before the bell → KO ends it without a death; Elo moves; both go home', async () => {
    const { game, adv, now } = makeGame();
    const a = await joinAs(game, 'warrior', 'Duelist'), b = await joinAs(game, 'mage', 'Duelist2');
    const home = { x: a.p.s.x, z: a.p.s.z };
    expect(game.combat.isEnemy(a.p, b.p)).toBe(false);
    await a.c.send({ type: 'social', op: 'arenaJoin' }); await b.c.send({ type: 'chat', text: '/arena' });
    adv(0.1); game.tick();
    expect(a.p.zone).toBe('arena'); expect(b.p.zone).toBe('arena');
    expect(game.combat.isEnemy(a.p, b.p)).toBe(false); // countdown
    adv(5.1); game.tick();
    expect(game.combat.isEnemy(a.p, b.p)).toBe(true);
    const deaths = b.p.char.deaths, gold = b.p.char.gold, inv = JSON.stringify(b.p.char.inventory);
    game.kill(a.p, b.p, now());
    expect(b.p.dead).toBe(false); expect(b.p.hp).toBe(b.p.mhp);
    expect(b.p.char.deaths).toBe(deaths); expect(b.p.char.gold).toBe(gold); expect(JSON.stringify(b.p.char.inventory)).toBe(inv);
    expect(a.p.char.counters.arenaRating).toBe(1016); expect(b.p.char.counters.arenaRating).toBe(984);
    expect(a.p.zone).toBe('capital'); expect(Math.hypot(a.p.s.x - home.x, a.p.s.z - home.z)).toBeLessThan(1);
    expect(game.combat.isEnemy(a.p, b.p)).toBe(false);
    expect(game.social.arenaBoard()[0].name).toBe('Duelist');
  });
  it('leaving mid-match forfeits', async () => {
    const { game, adv } = makeGame();
    const a = await joinAs(game, 'warrior', 'Stayer'), b = await joinAs(game, 'mage', 'Quitter');
    await a.c.send({ type: 'social', op: 'arenaJoin' }); await b.c.send({ type: 'social', op: 'arenaJoin' });
    adv(0.1); game.tick(); adv(6); game.tick();
    game.disconnect(b.c.id);
    expect(a.p.char.counters.arenaWins).toBe(1);
    expect(a.p.zone).toBe('capital');
  });
});

describe('M6 · anti-cheat', () => {
  it('floods are dropped and repeated invalid actions disconnect the client', async () => {
    const { game } = makeGame();
    const a = await joinAs(game, 'warrior', 'Cheater');
    const far = game.spawnMonster('minion' as any, a.p.s.x + 300, a.p.s.z, 'capital');
    for (let i = 0; i < 40; i++) await a.c.send({ type: 'chat', text: 'spam ' + i });
    expect(game.anti.stats.dropped).toBeGreaterThan(20);
    // attacks on a monster 300 m away: target stripped and a strike each
    for (let i = 0; i < 10; i++) await a.c.send({ type: 'attack', yaw: 0, target: far.id });
    expect(game.anti.stats.byReason.target).toBeGreaterThanOrEqual(10);
    expect(far.hp).toBe(far.mhp);
    // bogus inputs (NaN / huge dt) until the strike limit kicks the client
    for (let i = 0; i < 30; i++) await a.c.send({ type: 'input', seq: i, mx: 0, mz: 1, yaw: 0, jump: false, sprint: false, walk: false, dt: 5 });
    expect(seen(a.c, 'kick').length).toBe(1);
    expect(game.players.has(a.p.id)).toBe(false);
    expect(game.stats().anticheat.kicks).toBe(1);
  });
  it('legit play is never flagged', async () => {
    const { game, adv } = makeGame();
    const a = await joinAs(game, 'warrior', 'Honest');
    for (let i = 0; i < 300; i++) { await a.c.send({ type: 'input', seq: i + 1, mx: 0, mz: 1, yaw: 0, jump: false, sprint: true, walk: false, dt: 1 / 60 }); if (i % 6 === 5) { adv(0.1); game.tick(); } }
    expect(game.anti.stats.strikes).toBe(0);
  });
});
