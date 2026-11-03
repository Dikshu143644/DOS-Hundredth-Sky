import { describe, it, expect } from 'vitest';
import { TOWER_BOSSES, floorPlan, FLOORS } from '../../src/shared/tower';
import { BOSS_LOOKS } from '../../src/client/engine/bossrig';
import { LOOKS, CEIL } from '../../src/client/engine/floortheme';

describe('POLISH-1', () => {
  it('every tower guardian, world boss and the raid boss has a procedural look', () => {
    for (const k of [...TOWER_BOSSES, 'wb_gorrath', 'wb_vyrnax', 'wb_mother', 'rb_kaelthar']) expect(BOSS_LOOKS[k], k).toBeTruthy();
  });
  it('ten tower bands, each with its own interior look', () => {
    expect(LOOKS.length).toBe(10);
    expect(new Set(LOOKS.map((l) => l.ov)).size).toBe(10);
  });
  it('the vaulted ceiling clears the walls, doors and the tallest guardian on every floor', () => {
    for (let n = 1; n <= FLOORS; n++) { const P = floorPlan(n); for (const w of P.walls) expect(w.h).toBeLessThan(CEIL); }
    expect(CEIL).toBeGreaterThan(7.5 + 1);
  });
});
