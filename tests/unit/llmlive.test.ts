import { describe, it, expect } from 'vitest';
import { makeLlm, retryAfterMs, type LlmStatus } from '../../src/server/llmclient';
import { LlmGate, partialSay, partialSender } from '../../src/server/core/llm';

const st = (): LlmStatus => ({ model: null, lastOkAt: 0, lastError: null, retries: 0, fallbacks: 0 });
/** A server-sent-events reply that writes `parts` with `gapMs` between them, after `delayMs`. */
function sse(parts: string[], delayMs = 0, gapMs = 5, signal?: AbortSignal): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      await new Promise((r) => setTimeout(r, delayMs));
      for (const p of parts) {
        if (signal?.aborted) { c.error(new DOMException('aborted', 'AbortError')); return; }
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
        await new Promise((r) => setTimeout(r, gapMs));
      }
      c.enqueue(enc.encode('data: [DONE]\n\n')); c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const hang = (signal: AbortSignal) => new Promise<Response>((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
const user = [{ role: 'user' as const, content: 'Who are you?' }];

describe('live AI: model chain, 429 backoff, hedging, streaming', () => {
  it('reads retry-after from the header, RetryInfo or the message', () => {
    expect(retryAfterMs('7', '')).toBe(7000);
    expect(retryAfterMs(null, '{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"37s"}]}')).toBe(37000);
    expect(retryAfterMs(null, 'Quota exceeded. Please retry in 12.5s.')).toBe(12500);
    expect(retryAfterMs(null, 'nothing')).toBeNull();
  });

  it('on 429 moves down the chain at once, rests the model for its retry-after and counts it', async () => {
    let t = 1_000_000; const calls: string[] = [];
    const fetchFn = (async (_u: string, init: any) => {
      const b = JSON.parse(init.body); calls.push(b.model); expect(b.stream).toBe(true);
      return b.model === 'flash' ? new Response('{"error":{"code":429,"details":[{"retryDelay":"40s"}]}}', { status: 429 }) : sse(['I am ', 'Aurelia.']);
    }) as any;
    const s = st();
    const llm = makeLlm({ baseUrl: 'https://x', key: 'k', models: ['flash', 'lite'] }, s, fetchFn, { now: () => t });
    expect(await llm(user)).toBe('I am Aurelia.');
    expect(calls).toEqual(['flash', 'lite']); expect(s.count429).toBe(1); expect(s.model).toBe('lite');
    expect(s.perModel!.flash.restingUntil).toBe(1_000_000 + 40_000);
    calls.length = 0; t += 39_000; await llm(user); expect(calls).toEqual(['lite']);    // still resting
    calls.length = 0; t += 2_000; await llm(user); expect(calls[0]).toBe('flash');       // retry-after over: flash first again
  });

  it('hedges: when the flash model is slow to speak, the lite model starts beside it and wins', async () => {
    const calls: string[] = [];
    const fetchFn = (async (_u: string, init: any) => { const b = JSON.parse(init.body); calls.push(b.model); return b.model === 'flash' ? hang(init.signal) : sse(['Quick ', 'line.']); }) as any;
    const s = st();
    const llm = makeLlm({ baseUrl: 'https://x', key: 'k', models: ['flash', 'lite'] }, s, fetchFn, { hedgeMs: 60, firstTokenMs: 5000 });
    const t0 = Date.now();
    expect(await llm(user)).toBe('Quick line.');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(calls).toEqual(['flash', 'lite']); expect(s.hedges).toBe(1); expect(s.model).toBe('lite');
    expect(s.perModel!.flash.lost).toBe(1);
  });

  it('streams words to onPartial as they arrive', async () => {
    const seen: string[] = [];
    const llm = makeLlm({ baseUrl: 'https://x', key: 'k', models: ['m'] }, st(), (async () => sse(['Go ', 'then, ', 'little soul.'])) as any);
    expect(await llm(user, { onPartial: (x) => seen.push(x) })).toBe('Go then, little soul.');
    expect(seen).toEqual(['Go ', 'Go then, ', 'Go then, little soul.']);
  });

  it('learns which models refuse reasoning_effort none (none → minimal)', async () => {
    const efforts: (string | undefined)[] = [];
    const fetchFn = (async (_u: string, init: any) => { const b = JSON.parse(init.body); efforts.push(b.reasoning_effort); return b.reasoning_effort === 'none' ? new Response('Request contains an invalid argument.', { status: 400 }) : sse(['ok.']); }) as any;
    const llm = makeLlm({ baseUrl: 'https://x', key: 'k', models: ['lite'] }, st(), fetchFn);
    expect(await llm(user)).toBe('ok.'); expect(efforts).toEqual(['none', 'minimal']);
    efforts.length = 0; await llm(user); expect(efforts).toEqual(['minimal']);
  });

  it('a model that never speaks is cut at the first-token deadline and the next one answers', async () => {
    const s = st();
    const fetchFn = (async (_u: string, init: any) => JSON.parse(init.body).model === 'a' ? hang(init.signal) : sse(['Here.'])) as any;
    const llm = makeLlm({ baseUrl: 'https://x', key: 'k', models: ['a', 'b'] }, s, fetchFn, { hedgeMs: 10_000, firstTokenMs: 80 });
    expect(await llm(user)).toBe('Here.'); expect(s.perModel!.a.timeouts).toBe(1); expect(s.perModel!.a.restingUntil).toBeGreaterThan(Date.now());
  });

  it('when every model is rate-limited it returns null inside the budget (scripted fallback)', async () => {
    const llm = makeLlm({ baseUrl: 'https://x', key: 'k', models: ['a', 'b'] }, st(), (async () => new Response('{}', { status: 429, headers: { 'retry-after': '60' } })) as any, { budgetMs: 500 });
    const t0 = Date.now(); expect(await llm(user)).toBeNull(); expect(Date.now() - t0).toBeLessThan(700);
  });

  it('waits out a short retry-after when nothing else is free', async () => {
    let n = 0;
    const llm = makeLlm({ baseUrl: 'https://x', key: 'k', models: ['a'] }, st(), (async () => (++n === 1 ? new Response('{}', { status: 429, headers: { 'retry-after': '0.15' } }) : sse(['Back.']))) as any, { budgetMs: 4000 });
    expect(await llm(user)).toBe('Back.'); expect(n).toBe(2);
  });
});

describe('live AI: gate (timeout, per-player limit, shared identical prompts)', () => {
  it('shares one call between identical prompts that are in flight together', async () => {
    let n = 0;
    const gate = new LlmGate(async () => { n++; await new Promise((r) => setTimeout(r, 30)); return 'same'; }, () => 0);
    const [a, b] = await Promise.all([gate.ask('u1', user), gate.ask('u2', user)]);
    expect([a, b]).toEqual(['same', 'same']); expect(n).toBe(1); expect(gate.shared).toBe(1);
  });
  it('limits each player (a burst of 6, then 12/min) without blocking others', async () => {
    let k = 0; const gate = new LlmGate(async () => 'x', () => 0);
    for (let i = 0; i < 6; i++) expect(await gate.ask('spam', [{ role: 'user', content: 'q' + k++ }])).toBe('x');
    expect(await gate.ask('spam', [{ role: 'user', content: 'q' + k++ }])).toBeNull();
    expect(await gate.ask('other', [{ role: 'user', content: 'q' + k++ }])).toBe('x');
    expect(gate.limited).toBe(1);
  });
  it('waits ~25 s by default, not 9', () => { expect(new LlmGate(async () => 'x', () => 0).timeoutMs).toBeGreaterThanOrEqual(24_000); });
  it('extracts the words of a JSON reply while it is still streaming', () => {
    expect(partialSay('{"say": "Hello, trav', true)).toBe('Hello, trav');
    expect(partialSay('{"say": "He said \\"hi\\" and', true)).toBe('He said "hi" and');
    expect(partialSay('{"emo', true)).toBe('');
    expect(partialSay('Plain words', false)).toBe('Plain words');
    const sent: string[] = []; const f = partialSender((x) => sent.push(x), true, 0);
    f('{"say":"A'); f('{"say":"A b'); expect(sent).toEqual(['A', 'A b']);
  });
});

describe('live AI: words stream to the player while the NPC "thinks"', () => {
  it('an AI NPC reply arrives as llmPartial updates, then the final npcSay', async () => {
    const { makeGame, joinAs } = await import('./helpers');
    const full = '{"say":"The roots remember you, climber. Walk softly.","emotion":"curious","action":{"type":"none"}}';
    const { game, adv } = makeGame({ llm: async (_m: any, o: any) => { for (let i = 12; i <= full.length; i += 9) { o?.onPartial?.(full.slice(0, i)); await new Promise((r) => setTimeout(r, 100)); } return full; } });
    const { c, p } = await joinAs(game, 'mage');
    const n: any = [...(game as any).ents.values()].find((e: any) => e.type === 'n' && e.def.key === 'sylwen'); p.zone = n.zone; p.s.x = n.s.x + 1; p.s.z = n.s.z + 1; adv(2);
    await c.send({ type: 'talk', npc: n.id, text: 'Hello?' });
    let m: any; for (let i = 0; i < 400 && !m; i++) { m = c.inbox.find((x: any) => x.type === 'npcSay'); if (!m) await new Promise((r) => setTimeout(r, 10)); }
    const parts = c.inbox.filter((x: any) => x.type === 'llmPartial');
    expect(m.source).toBe('llm'); expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((x: any) => x.ctx === 'npc' && x.npc === n.id && m.text.startsWith(x.text.trim().slice(0, -1)))).toBe(true);
  });
  it('the Goddess speaks plain words that stream into her box', async () => {
    const { makeGame, joinAs } = await import('./helpers');
    const line = 'Ah, a curious soul. Ask, and I shall answer — then choose your gift.';
    const { game } = makeGame({ llm: async (_m: any, o: any) => { for (let i = 5; i <= line.length; i += 12) { o?.onPartial?.(line.slice(0, i)); await new Promise((r) => setTimeout(r, 100)); } return line; } });
    const { c } = await joinAs(game, 'mage', 'Kai' + Math.floor(Math.random() * 1e5), { prologue: true });
    await c.send({ type: 'prologue', step: 'talk', text: 'Who are you?' });
    let m: any; for (let i = 0; i < 400 && !m; i++) { m = c.inbox.find((x: any) => x.type === 'prologue'); if (!m) await new Promise((r) => setTimeout(r, 10)); }
    expect(m.source).toBe('llm'); expect(m.say).toBe(line);
    expect(c.inbox.filter((x: any) => x.type === 'llmPartial' && x.ctx === 'prologue').length).toBeGreaterThan(2);
  });
});
