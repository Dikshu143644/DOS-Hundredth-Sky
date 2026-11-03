/** OpenAI-compatible chat client for the live server (Gemini's OpenAI endpoint by default).
 *  Free-tier friendly: short replies, a model fallback list, retry with backoff on 429/5xx, and a
 *  per-model "resting" window after hard failures. The key is read here and never leaves the server. */
import fs from 'node:fs';
import type { LlmFn, ChatMsg } from './core/llm';

export interface LlmConfig { baseUrl: string; key: string; models: string[] }
export interface LlmStatus { model: string | null; lastOkAt: number; lastError: string | null; retries: number; fallbacks: number }

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
  if (!models.length) models = ['gpt-4o-mini'];
  return { baseUrl: base.replace(/\/$/, ''), key, models };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeLlm(cfg: LlmConfig, status: LlmStatus, fetchFn: typeof fetch = fetch, budgetMs = 8500): LlmFn {
  const resting = new Map<string, number>();       // model -> until (ms)
  const noReasoningFlag = new Set<string>();       // models that refuse reasoning_effort
  return async (messages: ChatMsg[], opts) => {
    const t0 = Date.now();
    let attempt = 0;
    while (Date.now() - t0 < budgetMs - 600) {
      const now = Date.now();
      const models = cfg.models.filter((m) => (resting.get(m) ?? 0) < now);
      const model = models[0] ?? cfg.models[attempt % cfg.models.length];
      if (model !== cfg.models[0]) status.fallbacks++;
      const body: Record<string, unknown> = { model, messages, max_tokens: Math.max(400, Math.min(opts?.maxTokens ?? 220, 1200)) /* thinking models spend part of it before answering */, temperature: opts?.temperature ?? 0.8 };
      if (opts?.json) body.response_format = { type: 'json_object' };
      let r: Response;
      try {
        r = await fetchFn(cfg.baseUrl + '/chat/completions', {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
          body: JSON.stringify(body), // the first choice gets a short leash: when it is overloaded it hangs, so fall through to the next model fast
          signal: AbortSignal.timeout(Math.max(1500, Math.min(model === cfg.models[0] && cfg.models.length > 1 ? 3500 : 6000, budgetMs - (Date.now() - t0) - 300))),
        });
      } catch (e) {
        status.lastError = `${model}: ${(e as Error).name}`; attempt++; status.retries++;
        resting.set(model, Date.now() + 90_000); // overloaded: let it rest, use the fallback meanwhile
        continue;
      }
      if (r.ok) {
        const j: any = await r.json().catch(() => null);
        const text = j?.choices?.[0]?.message?.content ?? null;
        if (text) { status.model = model; status.lastOkAt = Date.now(); status.lastError = null; return text; }
        status.lastError = `${model}: empty reply`; attempt++; continue;
      }
      const errText = (await r.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
      status.lastError = `${model}: HTTP ${r.status}`;
      if (r.status === 400 && /reasoning/i.test(errText) && !noReasoningFlag.has(model)) { noReasoningFlag.add(model); continue; }
      if (r.status === 404 || r.status === 400) resting.set(model, Date.now() + 10 * 60_000);  // unknown/retired model
      else if (r.status === 401 || r.status === 403) return null;                             // bad key: no point retrying
      if (r.status === 503 || r.status === 429) resting.set(model, Date.now() + 60_000);
      attempt++; status.retries++;
      if ((r.status === 429 || r.status >= 500) && models.length <= 1) await sleep(Math.min(2000, 350 * 2 ** Math.min(attempt, 3)));
    }
    return null;
  };
}
