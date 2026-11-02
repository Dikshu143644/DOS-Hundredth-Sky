import { describe, it, expect } from 'vitest';
import { buildZone, WALL_Z, heightAt } from '../../src/shared/world';
import { stepCharacter, newCharState, PHYS, raycastWorld } from '../../src/shared/physics';

buildZone();
const run = (s: ReturnType<typeof newCharState>, seconds: number, inp: Partial<{ mx: number; mz: number; yaw: number; sprint: boolean; jump: boolean }>) => {
  for (let i = 0; i < seconds * 60; i++) stepCharacter(s, { seq: i, mx: 0, mz: 0, yaw: 0, jump: false, sprint: false, walk: false, dt: 1 / 60, ...inp } as any);
};

describe('character physics', () => {
  it('stands on the terrain', () => {
    const s = newCharState(20, 40);
    run(s, 1, {});
    expect(Math.abs(s.y - heightAt(20, 40))).toBeLessThan(0.3);
  });
  it('cannot walk through the city wall (anti wall-clip)', () => {
    const s = newCharState(40, -78);
    run(s, 6, { mz: 1, yaw: 0, sprint: true }); // yaw 0 = north (-z), into the wall
    expect(s.z).toBeGreaterThan(WALL_Z);
  });
  it('can pass through the open gate', () => {
    const s = newCharState(0, -78);
    run(s, 4, { mz: 1, yaw: 0 });
    expect(s.z).toBeLessThan(WALL_Z);
  });
  it('does not tunnel even at absurd speed', () => {
    const s = newCharState(40, -80);
    for (let i = 0; i < 120; i++) stepCharacter(s, { seq: i, mx: 0, mz: 1, yaw: 0, jump: false, sprint: true, walk: false, dt: 1 / 60 } as any, 25);
    expect(s.z).toBeGreaterThan(WALL_Z);
  });
  it('jumps and lands', () => {
    const s = newCharState(20, 40);
    run(s, 0.5, {});
    const y0 = s.y;
    stepCharacter(s, { seq: 0, mx: 0, mz: 0, yaw: 0, jump: true, sprint: false, walk: false, dt: 1 / 60 } as any);
    run(s, 0.2, {});
    expect(s.y).toBeGreaterThan(y0 + 0.5);
    run(s, 2, {});
    expect(s.grounded).toBe(true);
    expect(PHYS.JUMP_V).toBeGreaterThan(0);
  });
  it('raycasts hit the wall', () => {
    const d = raycastWorld(40, 6, -70, 0, 0, -1, 60);
    expect(d).toBeLessThan(25);
  });
});
