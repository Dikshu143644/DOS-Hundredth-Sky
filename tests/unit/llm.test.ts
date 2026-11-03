import { describe, it, expect } from 'vitest';
import { makeLlm } from '../../src/server/llmclient';
import { LlmGate } from '../../src/server/core/llm';

const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
describe('live LLM client (Gemini, OpenAI-compatible)', () => {
  it('falls back to the next model when the first is overloaded, then rests it', async () => {
    const calls: string[] = [];
    const fetchFn = (async (_u: string, init: any) => { const b = JSON.parse(init.body); calls.push(b.model); return b.model === 'flash' ? new Response('{"error":{"code":503}}', { status: 503 }) : ok('{"say":"Halt!"}'); }) as any;
    const st = { model: null as string | null, lastOkAt: 0, lastError: null as string | null, retries: 0, fallbacks: 0 };
    const llm = makeLlm({ baseUrl: 'https://x', key: 'k', models: ['flash', 'lite'] }, st, fetchFn);
    expect(await llm([{ role: 'user', content: 'hi' }])).toBe('{"say":"Halt!"}');
    expect(calls).toEqual(['flash', 'lite']);
    expect(st.model).toBe('lite');
    calls.length = 0;
    await llm([{ role: 'user', content: 'again' }]);
    expect(calls).toEqual(['lite']); // the overloaded model is resting
  });
  it('gives up quietly on a bad key (scripted fallback takes over)', async () => {
    const fetchFn = (async () => new Response('denied', { status: 401 })) as any;
    const st = { model: null, lastOkAt: 0, lastError: null, retries: 0, fallbacks: 0 };
    expect(await makeLlm({ baseUrl: 'https://x', key: 'bad', models: ['a', 'b'] }, st as any, fetchFn)([{ role: 'user', content: 'x' }])).toBeNull();
  });
  it('the gate caches identical prompts (free tier friendly)', async () => {
    let n = 0;
    const gate = new LlmGate(async () => { n++; return 'ok'; }, () => 0);
    await gate.ask('u', [{ role: 'user', content: 'same' }]); await gate.ask('u', [{ role: 'user', content: 'same' }]);
    expect(n).toBe(1); expect(gate.cached).toBe(1);
  });
});
