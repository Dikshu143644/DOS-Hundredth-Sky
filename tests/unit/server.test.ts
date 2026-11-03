import { describe, it, expect } from 'vitest';
import { Game } from '../../src/server/core/game';
import { LlmGate, TokenBucket, parseJsonLoose } from '../../src/server/core/llm';
import { proceduralQuest, validateQuest, SPARKS, RANKS } from '../../src/server/core/director';
import type { S2C } from '../../src/shared/protocol';

function makeGame() {
  let t = 1000;
  const mem = { data: null as any };
  const game = new Game({
    store: { load: () => mem.data, save: (d: any) => { mem.data = d; } } as any,
    hasher: { hash: async (p: string) => 'h:' + p, verify: async (p: string, h: string) => h === 'h:' + p, token: () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) },
    llm: null, now: () => t, mode: 'offline', bots: 0, dev: false, serverName: 'test',
  });
  return { game, adv: (s: number) => { t += s; }, now: () => t };
}
function client(game: Game, id: number) {
  const inbox: S2C[] = [];
  game.connect({ id, send: (m: S2C) => inbox.push(m) } as any);
  const wait = async (type: string) => { for (let i = 0; i < 50; i++) { const m = inbox.find((x) => x.type === type); if (m) { inbox.splice(inbox.indexOf(m), 1); return m as any; } await new Promise((r) => setTimeout(r, 2)); } throw new Error('no ' + type); };
  return { inbox, wait, send: (m: any) => void game.handle(id, m) };
}

describe('auth and characters', () => {
  it('registers, rejects a wrong password, creates and joins', async () => {
    const { game } = makeGame();
    const c = client(game, 1);
    expect((await c.wait('welcome')).mode).toBe('offline');
    c.send({ type: 'register', user: 'omkar', pass: 'secret-pass' });
    expect((await c.wait('auth')).ok).toBe(true);
    const c2 = client(game, 2);
    c2.send({ type: 'login', user: 'omkar', pass: 'wrong' });
    expect((await c2.wait('auth')).ok).toBe(false);
    c.send({ type: 'createChar', name: 'Kaelen', cls: 'mage', appearance: { tint: 0xffffff, accent: 0x55ccff, headgear: true, cape: false, scale: 1 } });
    const chars = await c.wait('chars');
    expect(chars.list[0].name).toBe('Kaelen');
    c.send({ type: 'join', charId: chars.list[0].id });
    expect((await c.wait('joined')).char.cls).toBe('mage');
  });
});

describe('server-side anti-speedhack', () => {
  it('a client flooding inputs cannot move faster than real time allows', async () => {
    const { game, adv } = makeGame();
    const c = client(game, 1);
    c.send({ type: 'register', user: 'speedy', pass: 'secret-pass' });
    await c.wait('auth');
    c.send({ type: 'createChar', name: 'Speedy', cls: 'assassin', appearance: { tint: 0xffffff, accent: 0xffffff, headgear: false, cape: false, scale: 1 } });
    const chars = await c.wait('chars');
    c.send({ type: 'join', charId: chars.list[0].id });
    await c.wait('joined');
    const p = [...game.players.values()][0];
    const x0 = p.s.x, z0 = p.s.z;
    // 2 s worth of sprint inputs sent within 0.25 s of wall clock
    for (let i = 1; i <= 100; i++) c.send({ type: 'input', seq: i, mx: 1, mz: 0, yaw: 0, jump: false, sprint: true, walk: false, dt: 0.02 });
    for (let k = 0; k < 5; k++) { adv(0.05); game.tick(); }
    const moved = Math.hypot(p.s.x - x0, p.s.z - z0);
    expect(moved).toBeGreaterThan(0.5);      // inputs within budget are simulated
    expect(moved).toBeLessThan(10 * 0.55); // but never more than ~0.5 s of sprint
  });
});

describe('LLM gate and Story Director', () => {
  it('rate limits per user and returns null without a model', async () => {
    let t = 0;
    const gate = new LlmGate(async () => 'ok', () => t, 40, 8);
    const r: (string | null)[] = [];
    for (let i = 0; i < 6; i++) r.push(await gate.ask('u', [{ role: 'user', content: 'hi ' + i }]));
    expect(r.filter(Boolean).length).toBe(3);
    expect(gate.limited).toBe(3);
    expect(await new LlmGate(null, () => 0).ask('u', [])).toBeNull();
    const b = new TokenBucket(2, 1, 0); expect(b.take(0)).toBe(true); expect(b.take(0)).toBe(true); expect(b.take(0)).toBe(false); expect(b.take(1.5)).toBe(true);
  });
  it('parses JSON wrapped in prose', () => { expect(parseJsonLoose('sure! {"a":1} done')).toEqual({ a: 1 }); });
  it('procedural fallback produces a valid hidden quest chain for every spark', () => {
    for (const sp of Object.values(SPARKS)) {
      const q = proceduralQuest(7, sp, 'C', 'q1', { level: 3, cls: 'mage', name: 'K', poi: 'Ancient Forest', time: 22, weather: 'rain', recent: [] } as any);
      expect(q.steps.length).toBeGreaterThanOrEqual(2);
      expect(RANKS).toContain(q.rank);
    }
    expect(validateQuest({ title: 'x' }, 'C', 'x', 'q')).toBeNull();
  });
});
