import { describe, it, expect } from 'vitest';
import { InterpBuffer, InputBudget, PingStats, PendingInputs, lerpAngle } from '../../src/shared/netcode';

describe('InterpBuffer', () => {
  it('interpolates between bracketing snapshots', () => {
    const b = new InterpBuffer();
    b.push({ t: 0, x: 0, y: 0, z: 0, r: 0 });
    b.push({ t: 1, x: 10, y: 2, z: -4, r: 0 });
    const s = b.sample(0.5)!;
    expect(s.x).toBeCloseTo(5); expect(s.y).toBeCloseTo(1); expect(s.z).toBeCloseTo(-2);
  });
  it('drops out-of-order snapshots and caps extrapolation', () => {
    const b = new InterpBuffer();
    b.push({ t: 0, x: 0, y: 0, z: 0, r: 0 });
    b.push({ t: 1, x: 1, y: 0, z: 0, r: 0 });
    b.push({ t: 0.5, x: 99, y: 0, z: 0, r: 0 });
    expect(b.samples.length).toBe(2);
    expect(b.sample(10, 0.25)!.x).toBeCloseTo(1.25);
  });
});

describe('lerpAngle', () => {
  it('takes the short way round', () => {
    expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI, 5);
  });
});

describe('InputBudget (anti-speedhack)', () => {
  it('accepts inputs at real-time rate', () => {
    const b = new InputBudget(0);
    let ok = 0;
    for (let i = 1; i <= 600; i++) if (b.take(i / 60, 1 / 60)) ok++;
    expect(ok).toBeGreaterThan(590);
  });
  it('rejects a client simulating 3x faster than wall clock', () => {
    const b = new InputBudget(0);
    let simulated = 0;
    for (let i = 1; i <= 600; i++) for (let k = 0; k < 3; k++) if (b.take(i / 60, 1 / 60)) simulated += 1 / 60;
    expect(simulated).toBeLessThan(10 + 0.5); // 10 s of real time -> at most ~10 s simulated
  });
});

describe('PingStats / PendingInputs', () => {
  it('smooths rtt and grades quality', () => {
    const p = new PingStats();
    for (let i = 0; i < 30; i++) p.add(40 + (i % 2) * 4);
    expect(p.rtt).toBeGreaterThan(38); expect(p.rtt).toBeLessThan(46);
    expect(p.quality()).toBe('excellent');
  });
  it('acks inputs up to a sequence number', () => {
    const q = new PendingInputs<{ seq: number }>();
    for (let i = 1; i <= 10; i++) q.push({ seq: i });
    q.ack(7);
    expect(q.list.map((i) => i.seq)).toEqual([8, 9, 10]);
  });
});
