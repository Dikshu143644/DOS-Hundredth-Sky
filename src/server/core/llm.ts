/** LLM access for important NPCs and the Story Director.
 *  Runs ONLY on the server: the browser never sees a key. Every call is rate limited,
 *  time-boxed, and has a non-LLM fallback, so the game never breaks when the model is
 *  slow, rate-limited, or not configured at all (offline mode). */

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }
export type LlmFn = (messages: ChatMsg[], opts?: { maxTokens?: number; temperature?: number; json?: boolean }) => Promise<string | null>;

export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(public capacity: number, public perSecond: number, now: number) { this.tokens = capacity; this.last = now; }
  take(now: number, n = 1): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.perSecond);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

export class LlmGate {
  private global: TokenBucket;
  private per = new Map<string, TokenBucket>();
  calls = 0; failures = 0; limited = 0; cached = 0;
  private cache = new Map<string, { v: string; at: number }>();
  constructor(public fn: LlmFn | null, private now: () => number, perMinuteGlobal = 40, private perMinuteUser = 8) {
    this.global = new TokenBucket(perMinuteGlobal / 4, perMinuteGlobal / 60, now());
  }
  get enabled() { return !!this.fn; }
  async ask(user: string, messages: ChatMsg[], opts?: { maxTokens?: number; temperature?: number; json?: boolean }): Promise<string | null> {
    if (!this.fn) return null;
    const t = this.now();
    // identical prompts (same NPC, same context, same words) within 10 min reuse the reply: free-tier friendly
    const ck = JSON.stringify(messages).slice(-1200) + '|' + (opts?.maxTokens ?? 0);
    const hit = this.cache.get(ck);
    if (hit && t - hit.at < 600) { this.cached++; return hit.v; }
    let b = this.per.get(user);
    if (!b) this.per.set(user, (b = new TokenBucket(3, this.perMinuteUser / 60, t)));
    if (!b.take(t) || !this.global.take(t)) { this.limited++; return null; }
    this.calls++;
    try {
      const r = await Promise.race([this.fn(messages, opts), new Promise<null>((res) => setTimeout(() => res(null), 9000))]);
      if (!r) this.failures++;
      else { this.cache.set(ck, { v: r, at: t }); if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!); }
      return r;
    } catch {
      this.failures++;
      return null;
    }
  }
}

/** Extract the first JSON object from a model reply (models sometimes wrap it in prose). */
export function parseJsonLoose<T = any>(s: string | null): T | null {
  if (!s) return null;
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)) as T; } catch { /* fall through */ } }
  // a reply cut off by the token limit: keep the complete sentences of "say", drop the rest
  const m = /"say"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(s);
  if (m) { try { const said = JSON.parse('"' + m[1] + '"') as string; const w = wholeSentences(said, 420, true); if (w) return { say: w } as unknown as T; } catch { /* unusable */ } }
  return null;
}
/** Never show a line that stops mid-word: trim to the last complete sentence (or add an ellipsis).
 *  `strict` returns '' when no complete sentence exists. */
export function wholeSentences(s: string, max = 420, strict = false): string {
  let t = s.replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max);
  if (/[.!?…"”’)]$/.test(t) && t.length <= max) return t;
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), t.lastIndexOf('… '), t.lastIndexOf('." '), t.lastIndexOf('.” '));
  if (cut > 8) return t.slice(0, cut + 1).trim();
  if (strict) return '';
  return t.replace(/[,;:\-–—\s]+$/, '').replace(/\s+\S*$/, '') + '…';
}
