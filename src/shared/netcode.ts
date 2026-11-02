/** Netcode building blocks shared by client and server, unit-tested in isolation. */

/** Snapshot interpolation buffer for remote entities (rendered INTERP_DELAY behind). */
export interface Sample { t: number; x: number; y: number; z: number; r: number }
export class InterpBuffer {
  samples: Sample[] = [];
  push(s: Sample) {
    if (this.samples.length && s.t <= this.samples[this.samples.length - 1].t) return; // drop out-of-order
    this.samples.push(s);
    if (this.samples.length > 40) this.samples.shift();
  }
  /** Sample at render time `t`; extrapolates at most `maxExtrap` seconds past the newest. */
  sample(t: number, maxExtrap = 0.25): Sample | null {
    const s = this.samples;
    if (!s.length) return null;
    if (t <= s[0].t) return { ...s[0], t };
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1], b = s[i];
      if (t >= a.t && t <= b.t) {
        const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, r: lerpAngle(a.r, b.r, k) };
      }
    }
    const b = s[s.length - 1];
    const a = s.length > 1 ? s[s.length - 2] : b;
    const dt = Math.min(maxExtrap, t - b.t);
    const span = Math.max(1e-6, b.t - a.t);
    return { t, x: b.x + ((b.x - a.x) / span) * dt, y: b.y + ((b.y - a.y) / span) * dt, z: b.z + ((b.z - a.z) / span) * dt, r: b.r };
  }
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Server-side anti-speedhack: a client may only consume as much simulated time as real time
 *  has passed (plus a small burst allowance for jitter). Inputs beyond the budget are dropped. */
export class InputBudget {
  private budget: number;
  private last: number;
  constructor(now: number, public maxBurst = 0.25) { this.budget = 0.1; this.last = now; }
  /** Returns true if an input of `dt` seconds may be simulated at wall-clock `now` (seconds). */
  take(now: number, dt: number): boolean {
    this.budget = Math.min(this.maxBurst, this.budget + Math.max(0, now - this.last));
    this.last = now;
    if (dt > this.budget + 1e-6) return false;
    this.budget -= dt;
    return true;
  }
}

/** Smoothed RTT + jitter estimator for the ping meter. */
export class PingStats {
  rtt = 0; jitter = 0; samples = 0; lost = 0;
  add(rtt: number) {
    if (this.samples === 0) this.rtt = rtt;
    else {
      const d = Math.abs(rtt - this.rtt);
      this.jitter += (d - this.jitter) / 8;
      this.rtt += (rtt - this.rtt) / 8;
    }
    this.samples++;
  }
  quality(): 'excellent' | 'good' | 'fair' | 'poor' {
    const r = this.rtt + this.jitter * 2;
    return r < 60 ? 'excellent' : r < 120 ? 'good' : r < 220 ? 'fair' : 'poor';
  }
}

/** Client reconciliation helper: keeps unacknowledged inputs to replay on top of server state. */
export class PendingInputs<T extends { seq: number }> {
  list: T[] = [];
  push(i: T) { this.list.push(i); if (this.list.length > 240) this.list.shift(); }
  ack(seq: number) { let i = 0; while (i < this.list.length && this.list[i].seq <= seq) i++; if (i) this.list.splice(0, i); }
}
