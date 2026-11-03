/** LLM access for important NPCs and the Story Director.
 *  Runs ONLY on the server: the browser never sees a key. Every call is rate limited,
 *  time-boxed, and has a non-LLM fallback, so the game never breaks when the model is
 *  slow, rate-limited, or not configured at all (offline mode). */

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }
export interface LlmOpts { maxTokens?: number; temperature?: number; json?: boolean; /** streamed text so far (raw model output) */ onPartial?: (soFar: string) => void }
export type LlmFn = (messages: ChatMsg[], opts?: LlmOpts) => Promise<string | null>;

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
  calls = 0; failures = 0; limited = 0; cached = 0; shared = 0; lastOkAt = 0; lastFailAt = 0;
  private cache = new Map<string, { v: string; at: number }>();
  private inflight = new Map<string, Promise<string | null>>();
  /** `timeoutMs`: how long a player is allowed to wait for a line before the scripted fallback (the
   *  client shows an in-world "thinking…" meanwhile and streams the words as they arrive). */
  constructor(public fn: LlmFn | null, private now: () => number, perMinuteGlobal = 40, private perMinuteUser = 12, public timeoutMs = 25_000, private burstUser = 6) {
    this.global = new TokenBucket(perMinuteGlobal / 4, perMinuteGlobal / 60, now());
  }
  get enabled() { return !!this.fn; }
  async ask(user: string, messages: ChatMsg[], opts?: LlmOpts): Promise<string | null> {
    if (!this.fn) return null;
    const t = this.now();
    // identical prompts (same NPC, same context, same words) within 10 min reuse the reply: free-tier friendly
    const ck = hashKey(JSON.stringify(messages) + '|' + (opts?.maxTokens ?? 0) + '|' + (opts?.json ? 1 : 0));
    const hit = this.cache.get(ck);
    if (hit && t - hit.at < 600) { this.cached++; opts?.onPartial?.(hit.v); return hit.v; }
    const same = this.inflight.get(ck);                       // the same prompt is already on its way: share it
    if (same) { this.shared++; return same; }
    let b = this.per.get(user);
    if (!b) this.per.set(user, (b = new TokenBucket(this.burstUser, this.perMinuteUser / 60, t)));
    if (!b.take(t) || !this.global.take(t)) { this.limited++; return null; }
    this.calls++;
    const run = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const r = await Promise.race([this.fn!(messages, opts), new Promise<null>((res) => { timer = setTimeout(() => res(null), this.timeoutMs); })]);
        if (!r) { this.failures++; this.lastFailAt = this.now(); }
        else { this.lastOkAt = this.now(); this.cache.set(ck, { v: r, at: t }); if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value!); }
        return r;
      } catch {
        this.failures++; this.lastFailAt = this.now();
        return null;
      } finally { clearTimeout(timer); this.inflight.delete(ck); }
    })();
    this.inflight.set(ck, run);
    return run;
  }
}

function hashKey(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + ':' + s.length;
}

/** Turns raw streamed model text into at most ~10 "words so far" updates per second for a client. */
export function partialSender(send: (say: string) => void, json: boolean, everyMs = 90): (raw: string) => void {
  let last = '', at = 0, pending: ReturnType<typeof setTimeout> | null = null, latest = '';
  const flush = () => { pending = null; if (latest && latest !== last) { last = latest; at = Date.now(); send(latest); } };
  return (raw: string) => {
    latest = partialSay(raw, json).trimStart();
    if (!latest) return;
    if (Date.now() - at >= everyMs) flush(); else if (!pending) pending = setTimeout(flush, everyMs);
  };
}

/** The words of a reply that is still streaming in: for JSON replies, the "say" string so far;
 *  for plain text, the text itself. Returns '' until there is something worth showing. */
export function partialSay(raw: string, json: boolean): string {
  if (!json) return raw.replace(/\s+/g, ' ');
  const m = /"say"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw);
  if (!m) return '';
  let body = m[1].replace(/\\$/, '');
  try { return JSON.parse('"' + body + '"'); } catch { return body.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/\\(.)/g, '$1'); }
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
