/** Phase 4 · M6: server-side anti-cheat. The server already owns movement (inputs are simulated within a
 *  real-time budget), damage, cooldowns, loot and trades; this layer adds per-connection message rate
 *  limits, target/range sanity on every action that names an entity, value sanity, and a strike counter
 *  that disconnects a client after repeated violations. Counts are reported on /health. */
export interface ACStats { dropped: number; strikes: number; kicks: number; byReason: Record<string, number> }
const LIMITS: Record<string, [number, number]> = { input: [90, 160], ping: [4, 8], chat: [3, 6], talk: [2, 4], cast: [12, 20], attack: [12, 20] };
const DEFAULT: [number, number] = [15, 30];
export class AntiCheat {
  stats: ACStats = { dropped: 0, strikes: 0, kicks: 0, byReason: {} };
  private buckets = new Map<string, { t: number; tokens: number }>();
  private strikes = new Map<number, number[]>();
  private floodAt = new Map<string, number>();
  constructor(private kick: (connId: number, reason: string) => void, public maxStrikes = 25) {}
  /** Token bucket per connection and message type; false = drop this message. */
  allow(connId: number, type: string, now: number): boolean {
    const [rate, burst] = LIMITS[type] ?? DEFAULT;
    const k = connId + ':' + type;
    const b = this.buckets.get(k) ?? { t: now, tokens: burst };
    b.tokens = Math.min(burst, b.tokens + (now - b.t) * rate); b.t = now;
    this.buckets.set(k, b);
    if (b.tokens < 1) {
      this.stats.dropped++;
      // a sustained flood (well past the burst) earns at most one strike per second per message type
      if (b.tokens < -burst) { const f = this.floodAt.get(k) ?? -1; if (now - f >= 1) { this.floodAt.set(k, now); this.strike(connId, 'flood:' + type, now); } } else b.tokens -= 1;
      return false;
    }
    b.tokens -= 1;
    return true;
  }
  strike(connId: number, reason: string, now: number) {
    this.stats.strikes++; this.stats.byReason[reason.split(':')[0]] = (this.stats.byReason[reason.split(':')[0]] ?? 0) + 1;
    const s = (this.strikes.get(connId) ?? []).filter((t) => now - t < 60);
    s.push(now); this.strikes.set(connId, s);
    if (s.length >= this.maxStrikes) { this.stats.kicks++; this.strikes.delete(connId); this.kick(connId, 'Disconnected: too many invalid actions (anti-cheat).'); }
  }
  forget(connId: number) { this.strikes.delete(connId); for (const k of this.buckets.keys()) if (k.startsWith(connId + ':')) { this.buckets.delete(k); this.floodAt.delete(k); } }
  /** A number the client sent must be finite and inside [lo, hi]. */
  static num(v: unknown, lo: number, hi: number): boolean { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi; }
}
