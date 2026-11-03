import { describe, it, expect } from 'vitest';
import { REGIONS, ZONE_IDS, arrivalFor } from '../../src/shared/regions';
import { setActiveZone, heightAt, buildZone, withZone, SPAWN, POIS } from '../../src/shared/world';
import { queryColliders, newCharState, stepCharacter } from '../../src/shared/physics';
import { MONSTERS } from '../../src/shared/combat';
import { makeGame, joinAs } from './helpers';

describe('M2 · regions', () => {
  it('seven regions, every gate has a gate back, every monster/boss is defined', () => {
    expect(ZONE_IDS.length).toBe(7);
    for (const z of ZONE_IDS) {
      const r = REGIONS[z];
      for (const e of r.exits) expect(REGIONS[e.to].exits.some((x) => x.to === z), `${z}→${e.to} has no way back`).toBe(true);
      expect(MONSTERS[r.boss.kind]?.boss, `${z} boss`).toBe(true);
      for (const c of r.camps) for (const k of c.kinds) expect(MONSTERS[k], k).toBeTruthy();
      expect(r.shrines.length).toBeGreaterThanOrEqual(2);
      if (z !== 'capital') expect(new Set(r.camps.flatMap((c) => c.kinds)).size).toBeGreaterThanOrEqual(3);
    }
  });
  it('terrain is deterministic, finite and the spawn/arrivals/shrines are standable', () => {
    for (const z of ZONE_IDS) withZone(z, () => {
      const r = REGIONS[z];
      expect(heightAt(13.7, -42.1)).toBe(heightAt(13.7, -42.1));
      const spots = [SPAWN, ...r.exits.map((e) => arrivalFor(z, e.to)), ...r.shrines.map((s) => ({ x: s.x + 3, z: s.z + 3 }))];
      for (const p of spots) {
        expect(Number.isFinite(heightAt(p.x, p.z))).toBe(true);
        const hits = queryColliders(p.x, p.z, 0.6).filter((c) => c.kind === 'cyl' ? Math.hypot(c.x - p.x, c.z - p.z) < c.r + 0.45 : Math.abs(c.x - p.x) < c.hx + 0.45 && Math.abs(c.z - p.z) < c.hz + 0.45 && c.tag !== 'bound');
        expect(hits.length, `${z} spot ${p.x},${p.z} is inside ${hits.map((h) => h.tag)}`).toBe(0);
      }
      expect(buildZone().trees.length).toBeGreaterThan(z === 'desert' ? 5 : 50);
    });
    setActiveZone('capital');
  });
  it('each zone has its own collision world', () => {
    const a = withZone('capital', () => buildZone().colliders.length), b = withZone('forest', () => buildZone().colliders.length);
    expect(a).not.toBe(b);
    // the Capital's city wall is not in the forest
    const wall = withZone('forest', () => queryColliders(0, -90, 3).filter((c) => c.tag === 'wall').length);
    expect(wall).toBe(0);
    expect(withZone('capital', () => queryColliders(20, -90, 3).filter((c) => c.tag === 'wall').length)).toBeGreaterThan(0);
  });
  it('a character walks the same way in the same zone (prediction = server)', () => {
    const run = () => withZone('desert', () => { const s = newCharState(-150, 30, -Math.PI / 2); for (let i = 0; i < 120; i++) stepCharacter(s, { seq: i, mx: 0, mz: -1, yaw: -Math.PI / 2, jump: false, sprint: true, walk: false, dt: 1 / 60 }, 1); return [s.x, s.y, s.z]; });
    expect(run()).toEqual(run());
  });
});

describe('M2 · server zones', () => {
  it('walking into a gate moves you to the next region; monsters there are that region\'s', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'warrior');
    expect(p.zone).toBe('capital');
    const e = REGIONS.capital.exits.find((x) => x.to === 'forest')!;
    setActiveZone('capital'); p.s = newCharState(e.x, e.z - 1, 0);
    adv(0.05); game.tick();
    expect(p.zone).toBe('forest');
    const z = c.inbox.find((m) => m.type === 'zone') as any;
    expect(z.zone).toBe('forest');
    const kinds = new Set([...game.ents.values()].filter((x) => x.type === 'm' && x.zone === 'forest').map((m: any) => m.def.kind));
    expect(kinds.has('wolf') && kinds.has('mushking')).toBe(true);
    expect(p.char.visited).toContain('forest');
  });
  it('shrines attune, fast travel works (not in combat) and you rise at your shrine', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'healer');
    const s = REGIONS.forest.shrines[0];
    game.zones.move(p, 'forest', s.x + 1, s.z + 1, 0, 'test');
    adv(0.05); game.tick();
    expect(p.char.shrines).toContain('forest:elderwood');
    expect(p.char.bind).toBe('forest:elderwood');
    p.lastHurt = game.o.now();
    await c.send({ type: 'travel', shrine: 'capital:dawn' });
    expect(p.zone).toBe('forest'); // in combat: refused
    adv(10);
    await c.send({ type: 'travel', shrine: 'capital:dawn' });
    expect(p.zone).toBe('capital');
    await c.send({ type: 'travel', shrine: 'desert:sunspire' });
    expect(p.zone).toBe('capital'); // never attuned
    // die in the capital → rise at the forest shrine (last attuned)
    game.kill([...game.ents.values()].find((x) => x.type === 'm' && x.zone === 'capital')!, p, game.o.now());
    adv(9); await c.send({ type: 'respawn' });
    expect(p.zone).toBe('forest');
    expect(Math.hypot(p.s.x - s.x, p.s.z - s.z)).toBeLessThan(8);
  });
  it('empty zones sleep; weather is per region', async () => {
    const { game, adv } = makeGame();
    await joinAs(game, 'mage');
    const yeti = [...game.ents.values()].find((x) => x.type === 'm' && x.zone === 'frozen')!;
    const x0 = yeti.s.x, z0 = yeti.s.z;
    for (let i = 0; i < 100; i++) { adv(0.1); game.tick(); }
    expect([yeti.s.x, yeti.s.z]).toEqual([x0, z0]);
    expect(['snow', 'clear', 'blizzard']).toContain(game.zones.weatherOf('frozen'));
    expect(['clear', 'sandstorm']).toContain(game.zones.weatherOf('desert'));
  });
});
