/** OpenAI-compatible chat client for the live server (Gemini's OpenAI endpoint by default).
 *  Built for a free-tier key whose models are often rate-limited (429), overloaded (503) or slow:
 *  - a model CHAIN (flash models first, then the lite variants) with per-model backoff that
 *    honours the provider's retry-after (header, RetryInfo.retryDelay or "retry in Ns");
 *  - HEDGING: when the current model has not produced its first token after `hedgeMs`, the next
 *    model in the chain starts beside it, and the first one to speak wins (the rest are aborted);
 *  - STREAMING: replies are read as server-sent events and handed to `onPartial` as they arrive;
 *  - thinking switched off (reasoning_effort none → minimal → omitted, learned per model) and
 *    short replies, so a reply lands in seconds, not tens of seconds.
 *  The key is read here and never leaves the server. */
import fs from 'node:fs';
import type { LlmFn, ChatMsg, LlmOpts } from './core/llm';

export interface LlmConfig { baseUrl: string; key: string; models: string[] }
export interface LlmModelStat {
  ok: number; fail: number; r429: number; timeouts: number; lost: number;
  lastMs: number | null; firstTokenMs: number | null; restingUntil: number; backoffMs: number;
  effort: 'none' | 'minimal' | 'omit'; lastError: string | null;
}
export interface LlmStatus {
  model: string | null; lastOkAt: number; lastError: string | null; retries: number; fallbacks: number;
  count429?: number; lastLatencyMs?: number | null; lastFirstTokenMs?: number | null; hedges?: number; streamed?: number;
  perModel?: Record<string, LlmModelStat>;
}
export interface LlmClientOpts { budgetMs?: number; hedgeMs?: number; firstTokenMs?: number; maxParallel?: number; now?: () => number }

/** Env first (DOS_LLM_BASE_URL / DOS_LLM_KEY / DOS_LLM_MODEL[S]), else a server-side secret file
 *  (DOS_LLM_SECRET_FILE, default ./llm.secret.json next to server.mjs, never inside client/). */
export function loadLlmConfig(defaultFile: string): LlmConfig | null {
  let base = process.env.DOS_LLM_BASE_URL, key = process.env.DOS_LLM_KEY, models = (process.env.DOS_LLM_MODELS || process.env.DOS_LLM_MODEL || '').split(',').map((s) => s.trim()).filter(Boolean);
  const file = process.env.DOS_LLM_SECRET_FILE || defaultFile;
  if (!key && fs.existsSync(file)) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      key = j.key; base = base || j.base_url; if (!models.length) models = Array.isArray(j.models) ? j.models : j.model ? [j.model] : [];
    } catch { /* unreadable secret file: stay offline */ }
  }
  if (!key || !base) return null;
  if (!models.length) models = DEFAULT_GEMINI_CHAIN;
  return { baseUrl: base.replace(/\/$/, ''), key, models };
}
/** Flash models first (best lines), then the lite variants (fast, rarely rate-limited). */
export const DEFAULT_GEMINI_CHAIN = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.6-flash'];

/** Seconds the provider asked us to wait, from the header or the error body. */
export function retryAfterMs(header: string | null, body: string): number | null {
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return n * 1000;
    const d = Date.parse(header); if (Number.isFinite(d)) return Math.max(0, d - Date.now());
  }
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body) ?? /retry in (\d+(?:\.\d+)?)\s*s/i.exec(body);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

type Outcome = { kind: 'ok'; text: string } | { kind: 'fail'; why: string; fatal?: boolean; again?: boolean } | { kind: 'aborted' };

export function makeLlm(cfg: LlmConfig, status: LlmStatus, fetchFn: typeof fetch = fetch, o: LlmClientOpts | number = {}): LlmFn {
  const op: LlmClientOpts = typeof o === 'number' ? { budgetMs: o } : o;
  const budgetMs = op.budgetMs ?? 24_000, hedgeMs = op.hedgeMs ?? 3_000, firstTokenMs = op.firstTokenMs ?? 12_000, maxParallel = op.maxParallel ?? 3;
  const now = op.now ?? Date.now;
  status.count429 ??= 0; status.hedges ??= 0; status.streamed ??= 0; status.lastLatencyMs ??= null; status.lastFirstTokenMs ??= null;
  const per = (status.perModel ??= {});
  const stat = (m: string): LlmModelStat => (per[m] ??= { ok: 0, fail: 0, r429: 0, timeouts: 0, lost: 0, lastMs: null, firstTokenMs: null, restingUntil: 0, backoffMs: 0, effort: 'none', lastError: null });
  for (const m of cfg.models) stat(m);
  const rest = (m: string, ms: number) => { const s = stat(m); s.restingUntil = Math.max(s.restingUntil, now() + ms); };
  const backoff = (m: string, start: number, cap: number) => { const s = stat(m); s.backoffMs = Math.min(cap, s.backoffMs ? s.backoffMs * 2 : start); rest(m, s.backoffMs); };

  /** One streamed attempt on one model. `onToken` fires with the text so far (raw). */
  async function attempt(model: string, messages: ChatMsg[], opts: LlmOpts | undefined, signal: AbortSignal, onToken: (soFar: string) => void): Promise<Outcome> {
    const s = stat(model);
    const body: Record<string, unknown> = { model, messages, stream: true, max_tokens: Math.max(64, Math.min(opts?.maxTokens ?? 150, 1000)), temperature: opts?.temperature ?? 0.8 };
    if (s.effort !== 'omit') body.reasoning_effort = s.effort;
    if (opts?.json) body.response_format = { type: 'json_object' };
    let r: Response;
    try {
      r = await fetchFn(cfg.baseUrl + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal.aborted) return { kind: 'aborted' };
      return { kind: 'fail', why: `${model}: ${(e as Error).name}` };
    }
    if (!r.ok) {
      const errText = (await r.text().catch(() => '')).slice(0, 2000);
      const why = `${model}: HTTP ${r.status}`;
      if (r.status === 429) {
        status.count429!++; s.r429++;
        const ra = retryAfterMs(r.headers.get('retry-after'), errText);
        if (ra != null) { rest(model, Math.min(ra, 10 * 60_000)); s.backoffMs = Math.max(s.backoffMs, Math.min(ra, 300_000)); } else backoff(model, 15_000, 300_000);
        return { kind: 'fail', why };
      }
      if (r.status === 400 && s.effort !== 'omit' && (/reasoning|thinking|invalid argument/i.test(errText))) { s.effort = s.effort === 'none' ? 'minimal' : 'omit'; return { kind: 'fail', why, again: true }; }
      if (r.status === 401 || r.status === 403) return { kind: 'fail', why, fatal: true };
      if (r.status === 404 || r.status === 400) rest(model, 10 * 60_000);          // unknown/retired model or bad request
      else backoff(model, 10_000, 120_000);                                        // 5xx / overloaded
      return { kind: 'fail', why };
    }
    let text = '', buf = '';
    try {
      const ct = r.headers.get('content-type') ?? '';
      if (!r.body || !/event-stream/.test(ct)) {                                  // provider ignored stream: plain JSON
        const j: any = await r.json().catch(() => null);
        text = j?.choices?.[0]?.message?.content ?? '';
        if (text) onToken(text);
      } else {
        const dec = new TextDecoder();
        for await (const chunk of r.body as any as AsyncIterable<Uint8Array>) {
          buf += dec.decode(chunk, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try { const d = JSON.parse(data); const c = d?.choices?.[0]?.delta?.content ?? d?.choices?.[0]?.message?.content; if (c) { text += c; onToken(text); } } catch { /* keep-alive or partial line */ }
          }
        }
      }
    } catch (e) {
      if (signal.aborted && !text) return { kind: 'aborted' };
      if (!text) return { kind: 'fail', why: `${model}: stream ${(e as Error).name}` };
    }
    if (!text.trim()) return { kind: 'fail', why: `${model}: empty reply` };
    return { kind: 'ok', text };
  }

  return (messages: ChatMsg[], opts?: LlmOpts) => new Promise<string | null>((resolve) => {
    const t0 = now();
    const running = new Map<string, AbortController>();
    const deadThisCall = new Set<string>();
    let winner: string | null = null, done = false, launched = 0, latest = '';
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null, wakeTimer: ReturnType<typeof setTimeout> | null = null;
    const killAll = (except?: string) => { for (const [m, c] of running) if (m !== except) { c.abort(); running.delete(m); } };
    const finish = (text: string | null) => {
      if (done) return; done = true;
      clearTimeout(budget); if (hedgeTimer) clearTimeout(hedgeTimer); if (wakeTimer) clearTimeout(wakeTimer);
      killAll(); resolve(text);
    };
    const budget = setTimeout(() => {           // out of time: keep what the speaking model has said so far, if anything
      if (winner && latest.trim()) { status.model = winner; status.lastOkAt = Date.now(); status.lastLatencyMs = now() - t0; finish(latest); return; }
      status.lastError = status.lastError ?? 'budget exceeded'; finish(null);
    }, budgetMs);
    const candidates = () => {
      const t = now();
      return cfg.models.filter((m) => !running.has(m) && !deadThisCall.has(m) && stat(m).restingUntil <= t)
        // keep the configured order, but a model that has been answering slowly goes behind the quick ones
        .sort((a, b) => ((stat(a).firstTokenMs ?? 0) > 9000 ? 1 : 0) - ((stat(b).firstTokenMs ?? 0) > 9000 ? 1 : 0));
    };
    const armHedge = () => {
      if (hedgeTimer) clearTimeout(hedgeTimer);
      hedgeTimer = setTimeout(() => { if (!done && !winner && running.size < maxParallel && candidates().length) { status.hedges!++; launch(); } armHedge(); }, hedgeMs);
    };
    const launch = (): void => {
      if (done || winner) return;
      const left = budgetMs - (now() - t0);
      const c = candidates();
      if (!c.length) {
        if (running.size) return;
        // everything is resting: wait for the first model whose rest ends inside the budget (retry-after honoured)
        const soonest = Math.min(...cfg.models.filter((m) => !deadThisCall.has(m)).map((m) => stat(m).restingUntil));
        if (Number.isFinite(soonest) && soonest - now() < left - 2500) { if (wakeTimer) clearTimeout(wakeTimer); wakeTimer = setTimeout(launch, Math.max(50, soonest - now() + 20)); return; }
        finish(null); return;
      }
      const model = c[0];
      if (launched++ > 0) status.fallbacks++;
      const ctl = new AbortController(); running.set(model, ctl);
      const ta = now(); let first: number | null = null;
      const ftTimer = setTimeout(() => { if (first == null && running.get(model) === ctl) { ctl.abort(); running.delete(model); const s = stat(model); s.timeouts++; s.fail++; s.lastError = 'no first token in time'; status.lastError = `${model}: slow (no reply in ${Math.round(firstTokenMs / 1000)} s)`; deadThisCall.add(model); backoff(model, 30_000, 300_000); launch(); } }, Math.min(firstTokenMs, Math.max(1500, left - 300)));
      void attempt(model, messages, opts, ctl.signal, (soFar) => {
        if (done) return;
        if (first == null) {
          first = now() - ta; const s = stat(model); s.firstTokenMs = s.firstTokenMs == null ? first : Math.round(s.firstTokenMs * 0.5 + first * 0.5);
          if (!winner) { winner = model; clearTimeout(ftTimer); if (hedgeTimer) clearTimeout(hedgeTimer); killAll(model); }
        }
        if (winner === model) { latest = soFar; try { opts?.onPartial?.(soFar); } catch { /* caller's problem */ } }
      }).then((out) => {
        clearTimeout(ftTimer);
        if (running.get(model) === ctl) running.delete(model);
        const s = stat(model);
        if (out.kind === 'aborted') { if (winner && winner !== model) { s.lost++; const el = now() - ta; s.firstTokenMs = Math.max(s.firstTokenMs ?? 0, Math.round(((s.firstTokenMs ?? el) + el) / 2)); } return; }
        if (out.kind === 'ok') {
          s.ok++; s.backoffMs = 0; s.lastMs = now() - ta; s.lastError = null;
          if (winner === model || !winner) {
            status.model = model; status.lastOkAt = Date.now(); status.lastError = null; status.lastLatencyMs = now() - t0; status.lastFirstTokenMs = first; status.streamed!++;
            finish(out.text);
          }
          return;
        }
        s.fail++; s.lastError = out.why; status.lastError = out.why; status.retries++;
        if (out.fatal) { finish(null); return; }
        if (winner === model) { finish(null); return; }                   // the speaking model broke mid-reply
        if (!out.again && stat(model).restingUntil <= now()) deadThisCall.add(model);   // resting models come back when their retry-after ends
        if (!done && !winner) launch();
      });
      armHedge();
    };
    launch();
  });
}
