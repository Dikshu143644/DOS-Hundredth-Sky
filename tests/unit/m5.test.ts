import { describe, it, expect } from 'vitest';
import { makeGame, joinAs } from './helpers';
import { FLOORS, floorPlan, floorId, isBossFloor, TOWER_BOSSES, TOWER_GATE, TRAP, THEMES } from '../../src/shared/tower';
import { REGIONS } from '../../src/shared/regions';
import { withZone, SEALS_OPEN, buildZone } from '../../src/shared/world';
import { queryColliders, circleVsCollider } from '../../src/shared/physics';
import { MONSTERS } from '../../src/shared/combat';
import { ITEMS } from '../../src/shared/items';

/** Flood-fill the walkable floor (0.5 m body) from the landing; can we reach the stairs? */
function reachable(n: number): boolean {
  const P = floorPlan(n), W = P.cols * P.R, D = P.rows * P.R, S = 1;
  return withZone(floorId(n), () => {
    const nx = Math.ceil(W / S), nz = Math.ceil(D / S), seen = new Uint8Array(nx * nz);
    const cell = (x: number, z: number) => [Math.floor((x + W / 2) / S), Math.floor((z + D / 2) / S)];
    const free = (i: number, j: number) => { const x = -W / 2 + (i + 0.5) * S, z = -D / 2 + (j + 0.5) * S; for (const c of queryColliders(x, z, 0.5)) if (circleVsCollider(x, z, 0.45, c)) return false; return true; };
    const [si, sj] = cell(P.start.x + 0.2, P.start.z + 2.2), [ti, tj] = cell(P.stairs.x, P.stairs.z + 2.5);
    const q = [[si, sj]]; seen[sj * nx + si] = 1;
    while (q.length) {
      const [i, j] = q.pop()!;
      if (Math.abs(i - ti) <= 1 && Math.abs(j - tj) <= 1) return true;
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || b < 0 || a >= nx || b >= nz || seen[b * nx + a]) continue;
        seen[b * nx + a] = 1;
        if (free(a, b)) q.push([a, b]);
      }
    }
    return false;
  });
}

describe('M5 · the Hundredth Tower', () => {
  it('100 template floors, ten themes, a unique guardian every tenth floor', () => {
    expect(THEMES.length).toBe(10);
    const bosses = new Set<string>();
    for (let n = 1; n <= FLOORS; n++) {
      const P = floorPlan(n), R = REGIONS[floorId(n) as 'capital'];
      expect(R, 'region ' + n).toBeTruthy();
      expect(P.walls.length).toBeGreaterThan(8);
      expect(P.stairs).not.toBe(P.start);
      expect(P.seal.hx + P.seal.hz).toBeGreaterThan(1);
      for (const m of P.monsters) expect(MONSTERS[m.kind as 'minion'], m.kind).toBeTruthy();
      if (isBossFloor(n)) { expect(P.boss).toBeTruthy(); bosses.add(P.boss!.kind); expect(MONSTERS[P.boss!.kind as 'minion'].boss).toBe(true); }
      else { expect(P.boss).toBeNull(); expect(P.puzzle).toBeTruthy(); }
      expect(P.plates.some((p) => p.kind === 'fountain')).toBe(true);
    }
    expect([...bosses].sort()).toEqual([...TOWER_BOSSES].sort());
    const kinds = new Set(Array.from({ length: FLOORS }, (_, k) => floorPlan(k + 1).puzzle?.kind).filter(Boolean));
    expect(kinds).toEqual(new Set(['runes', 'braziers', 'trial']));
    expect(Array.from({ length: FLOORS }, (_, k) => floorPlan(k + 1).plates.some((p) => p.kind === 'spike')).every(Boolean)).toBe(true);
  });
  it('every floor: the stairs are sealed until the seal breaks, then reachable (no gaps in the walls)', () => {
    for (let n = 1; n <= FLOORS; n++) {
      withZone(floorId(n), () => buildZone());
      SEALS_OPEN.delete(floorId(n));
      expect(reachable(n), `floor ${n} sealed`).toBe(false);
      SEALS_OPEN.add(floorId(n));
      expect(reachable(n), `floor ${n} open`).toBe(true);
      SEALS_OPEN.delete(floorId(n));
    }
  });
  it('enter at the Gate, solve the floor, climb: first clear pays once and records the best floor', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'warrior', 'Climber');
    // stand at the Gate of the Tower
    game.zones.move(p, 'tower', TOWER_GATE.x, TOWER_GATE.z + 2, 0, 'Gate');
    adv(0.1); game.tick();
    expect(c.inbox.some((m: any) => m.type === 'towerGate')).toBe(true);
    await c.send({ type: 'towerEnter', floor: 2 }); // locked
    expect(p.zone).toBe('tower');
    await c.send({ type: 'towerEnter', floor: 1 });
    expect(p.zone).toBe('f1');
    adv(0.1); game.tick();
    const P = floorPlan(1), st = game.tower.state(1);
    const stand = (x: number, z: number, secs = 0.2) => { p.s.x = x; p.s.z = z; p.s.y = 0; p.lastHurt = -99; for (let t = 0; t < secs; t += 0.1) { adv(0.1); game.tick(); } };
    // stairs do nothing while sealed
    stand(P.stairsAt.x, P.stairsAt.z); expect(p.zone).toBe('f1');
    if (P.puzzle!.kind === 'runes') {
      const runes = P.plates.filter((q) => q.kind === 'rune');
      const wrong = runes[(P.puzzle!.order![0] + 1) % 4];
      stand(wrong.x, wrong.z); expect(st.lit.length).toBe(0); stand(P.start.x, P.start.z);
      for (const k of P.puzzle!.order!) { stand(runes[k].x, runes[k].z); stand(P.gate.x, P.gate.z + 3); }
    } else if (P.puzzle!.kind === 'braziers') {
      for (const b of P.plates.filter((q) => q.kind === 'brazier')) stand(b.x + 1.6, b.z, 1.5);
    } else {
      for (const id of [...st.guardians]) game.kill(p, game.ents.get(id)!, 0);
    }
    expect(st.seal).toBe(true);
    const xp0 = p.char.xp + p.char.level * 1e6, gold0 = p.char.gold;
    stand(P.stairsAt.x, P.stairsAt.z);
    expect(p.zone).toBe('f2');
    expect(p.char.counters.towerBest).toBe(1);
    expect(p.char.gold).toBeGreaterThan(gold0);
    expect(p.char.xp + p.char.level * 1e6).toBeGreaterThan(xp0);
    // the floor resets after everyone has left for 90 s
    adv(95); game.tick(); adv(1); game.tick();
    expect(game.tower.floors.has(1)).toBe(false);
  });
  it('floor 10: the guardian holds the seal; its first clear drops its mythical and the Climber title', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'mage', 'Guardianbane');
    p.char.counters.towerBest = 9;
    game.zones.move(p, 'tower', TOWER_GATE.x, TOWER_GATE.z + 2, 0, 'Gate');
    await c.send({ type: 'towerEnter', floor: 10 });
    expect(p.zone).toBe('f10');
    adv(0.1); game.tick();
    const st = game.tower.state(10), boss = game.ents.get(st.boss)!;
    expect(boss.name).toContain('Thornmaw');
    expect(st.seal).toBe(false);
    game.kill(p, boss, 0);
    expect(st.seal).toBe(true);
    const P = floorPlan(10);
    p.s.x = P.stairsAt.x; p.s.z = P.stairsAt.z; p.lastHurt = -99; adv(0.1); game.tick();
    expect(p.char.counters.towerBest).toBe(10);
    expect(p.char.inventory.some((e) => e.item === 'thornmaw_fang')).toBe(true);
    expect(ITEMS.thornmaw_fang.rarity).toBe('mythical');
    expect(p.char.titles).toContain('climber');
  });
  it('spike traps bite only while raised; the landing fountain heals', async () => {
    const { game, adv, now } = makeGame();
    const { c, p } = await joinAs(game, 'knight', 'Trapfoot');
    game.zones.move(p, 'tower', TOWER_GATE.x, TOWER_GATE.z + 2, 0, 'Gate');
    await c.send({ type: 'towerEnter', floor: 1 });
    const spike = floorPlan(1).plates.find((q) => q.kind === 'spike')!;
    // step on during a lowered phase: no damage; during a raised phase: damage
    const phaseAt = () => (now() + (spike.phase ?? 0)) % TRAP.period;
    while (phaseAt() < TRAP.active + 0.1 || phaseAt() > TRAP.period - 0.3) adv(0.05);
    p.hp = p.mhp; p.s.x = spike.x; p.s.z = spike.z; game.tick();
    expect(p.hp).toBe(p.mhp);
    while (phaseAt() > 0.2) adv(0.05);
    p.s.x = spike.x; p.s.z = spike.z; game.tick();
    expect(p.hp).toBeLessThan(p.mhp);
    const f = floorPlan(1).plates.find((q) => q.kind === 'fountain')!;
    const h0 = p.hp; p.s.x = f.x + 1.8; p.s.z = f.z; p.lastHurt = -99;
    for (let i = 0; i < 20; i++) { adv(0.1); game.tick(); }
    expect(p.hp).toBeGreaterThan(h0);
  });
  it('leaderboard ranks the highest floor first', async () => {
    const { game } = makeGame();
    const a = await joinAs(game, 'archer', 'Lowfloor'), b = await joinAs(game, 'healer', 'Highfloor');
    a.p.char.counters.towerBest = 3; b.p.char.counters.towerBest = 12;
    await a.c.send({ type: 'towerBoard' });
    const m = await a.c.wait('towerBoard');
    expect(m.rows[0].name).toBe('Highfloor'); expect(m.rows[0].floor).toBe(12); expect(m.place).toBe(2);
  });
});
