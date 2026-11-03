// M7 · protocol-level player bots: each one is a real WebSocket client that plays the game the way the browser does
// (60 Hz movement inputs, basic attacks / skills by target id), with no server-side help except the documented dev
// shortcuts for travel (/zone, /gate) and levelling (/xp). Flow per bot:
//   New Game (register → create character → prologue skip) → a tour of regions (kill monsters in each)
//   → walk to the Gate of the Tower → floor picker → climb floors 1–10 (solve runes / braziers / trials, beat the
//   floor-10 guardian, take the stairs).
// Usage: npx tsx tests/e2e/m7bots.ts ws://localhost:8787/ws [bots=4] [floors=10]
import WebSocket from 'ws';
import { floorPlan, floorId, floorOf, TOWER_GATE } from '../../src/shared/tower';
import { withZone, buildZone, SEALS_OPEN } from '../../src/shared/world';
import { queryColliders, circleVsCollider } from '../../src/shared/physics';
import { GEAR_KINDS, gearId, tierFor } from '../../src/shared/economy';
import { SKILLS } from '../../src/shared/skills';

const URL_ = process.argv[2] ?? 'ws://localhost:8787/ws';
const N = Number(process.argv[3] ?? 4), FLOORS = Number(process.argv[4] ?? 10);
const REGIONS_TOUR = ['forest', 'mountain', 'desert', 'frozen'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

type V = { x: number; z: number };
/** A* on a 1 m grid over a tower floor's real colliders (spike plates cost extra). The walkable grid is
 *  computed once per floor and seal state; the open set is a binary heap. */
const gridCache = new Map<string, { nx: number; nz: number; W: number; D: number; free: Uint8Array; cost: Uint8Array }>();
function floorGrid(n: number) {
  const key = n + ':' + SEALS_OPEN.has(floorId(n));
  let g = gridCache.get(key);
  if (g) return g;
  const P = floorPlan(n), W = P.cols * P.R, D = P.rows * P.R, nx = Math.ceil(W), nz = Math.ceil(D);
  const free = new Uint8Array(nx * nz), cost = new Uint8Array(nx * nz);
  const spikes = P.plates.filter((q) => q.kind === 'spike');
  withZone(floorId(n), () => {
    buildZone();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = -W / 2 + i + 0.5, z = -D / 2 + j + 0.5;
      let ok = 1; for (const c of queryColliders(x, z, 0.8)) if (circleVsCollider(x, z, 0.7, c)) { ok = 0; break; }
      free[j * nx + i] = ok;
      cost[j * nx + i] = spikes.some((s) => Math.abs(x - s.x) < s.r + 0.6 && Math.abs(z - s.z) < s.r + 0.6) ? 6 : 1;
    }
  });
  g = { nx, nz, W, D, free, cost }; gridCache.set(key, g);
  return g;
}
function planPath(n: number, from: V, to: V): V[] | null {
  const { nx, nz, W, D, free, cost } = floorGrid(n);
  const ci = (x: number) => Math.max(0, Math.min(nx - 1, Math.floor(x + W / 2))), cj = (z: number) => Math.max(0, Math.min(nz - 1, Math.floor(z + D / 2)));
  const si = ci(from.x), sj = cj(from.z), ti = ci(to.x), tj = cj(to.z);
  const g = new Float32Array(nx * nz).fill(1e9), came = new Int32Array(nx * nz).fill(-1), closed = new Uint8Array(nx * nz);
  const heap: [number, number][] = [];
  const push = (f: number, k: number) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const s0 = sj * nx + si; g[s0] = 0; push(0, s0);
  while (heap.length) {
    const [, cur] = pop();
    if (closed[cur]) continue; closed[cur] = 1;
    const i = cur % nx, j = (cur - i) / nx;
    if (Math.abs(i - ti) <= 1 && Math.abs(j - tj) <= 1) {
      const out: V[] = []; let c = cur; while (c !== -1) { const a = c % nx, b = (c - a) / nx; out.push({ x: -W / 2 + a + 0.5, z: -D / 2 + b + 0.5 }); c = came[c]; }
      out.reverse(); out.push(to); return out;
    }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz || !free[b * nx + a]) continue;
      if (di && dj && (!free[j * nx + i + di] || !free[(j + dj) * nx + i])) continue;
      const k = b * nx + a, ng = g[cur] + (di && dj ? 1.414 : 1) * cost[k];
      if (ng < g[k]) { g[k] = ng; came[k] = cur; push(ng + Math.hypot(a - ti, b - tj), k); }
    }
  }
  return null;
}

interface Mon { id: number; x: number; z: number; hp: number; mhp: number; name?: string; boss?: boolean }
class Bot {
  ws!: WebSocket; id = 0; zone = ''; me = { x: 0, z: 0, yaw: 0 }; hp = 1; mhp = 1; level = 1; seq = 0;
  mons = new Map<number, Mon>(); tower: any = null; gateOpen = false; dead = false;
  path: V[] = []; pathGoal: V | null = null; pathAt = 0; lastPos = { x: 0, z: 0, t: 0 }; side = 0;
  stats = { kills: 0, deaths: 0, floors: [] as { n: number; secs: number; puzzle: string }[], regions: [] as string[], errors: [] as string[] };
  deadWait = 0; floorStart = 0; standSince = 0; standAt = -1; lastWarn = '';
  constructor(public name: string, public cls: string) {}
  send(m: unknown) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  async connect() {
    this.ws = new WebSocket(URL_);
    await new Promise<void>((res, rej) => {
      this.ws.on('error', rej);
      this.ws.on('open', () => this.send({ type: 'register', user: this.name.toLowerCase(), pass: 'secret123' }));
      this.ws.on('message', (d) => {
        const m = JSON.parse(String(d));
        if (m.type === 'auth' && m.ok) this.send({ type: 'createChar', name: this.name, cls: this.cls, appearance: { tint: 0xffffff, accent: 0x66ddcc, headgear: false, cape: true, scale: 1 } });
        else if (m.type === 'auth') this.stats.errors.push('auth: ' + m.error);
        if (m.type === 'chars' && m.list.length) this.send({ type: 'join', charId: m.list[0].id });
        if (m.type === 'joined') { this.id = m.id; this.zone = m.zone; this.send({ type: 'prologue', step: 'skip' }); res(); }
        this.onMsg(m);
      });
    });
  }
  onMsg(m: any) {
    switch (m.type) {
      case 'snap':
        this.me = { x: m.me.x, z: m.me.z, yaw: m.me.yaw }; this.hp = m.self.hp; this.mhp = m.self.mhp; this.level = m.self.level; this.mp = m.self.mp;
        if (m.self.zone && m.self.zone !== this.zone) { this.zone = m.self.zone; this.mons.clear(); }
        for (const e of m.ents) if (e.t === 'm') { const o: Mon = this.mons.get(e.id) ?? { id: e.id, x: 0, z: 0, hp: 1, mhp: 1 }; Object.assign(o, { x: e.x, z: e.z, hp: e.hp, mhp: e.mhp }); if (e.n) o.name = e.n; if (e.bs) o.boss = true; this.mons.set(e.id, o); }
        for (const id of m.gone ?? []) this.mons.delete(id);
        break;
      case 'zone': this.zone = m.zone; this.mons.clear(); this.path = []; this.me = { x: m.x, z: m.z, yaw: m.yaw }; break;
      case 'tower': this.tower = m; if (m.seal) SEALS_OPEN.add(floorId(m.floor)); else SEALS_OPEN.delete(floorId(m.floor)); break;
      case 'towerGate': this.gateOpen = true; break;
      case 'died': this.dead = true; this.deadWait = Number(m.wait ?? 0); this.stats.deaths++; break;
      case 'fx': if (m.kind === 'death' && m.src === this.id && this.mons.has(m.dst)) this.stats.kills++; break;
      case 'kick': this.stats.errors.push('kicked: ' + m.reason); break;
      case 'notice': if (m.style === 'warn') this.lastWarn = m.text; break;
    }
  }
  chat(t: string) { this.send({ type: 'chat', text: t }); }
  /** One 60 Hz movement step toward (gx, gz). */
  step(gx: number, gz: number, stop = 0.6) {
    const dx = gx - this.me.x, dz = gz - this.me.z, d = Math.hypot(dx, dz);
    let yaw = Math.atan2(-dx, -dz);
    if (this.side > 0) { yaw += 1.4; this.side--; }
    this.send({ type: 'input', seq: ++this.seq, mx: 0, mz: d > stop ? 1 : 0, yaw, jump: false, sprint: d > 6, walk: false, dt: 1 / 60 });
    return d;
  }
  /** Follow an A* path on a tower floor toward goal; returns distance left. */
  walkTo(goal: V, now: number, stop = 0.8) {
    const n = floorOf(this.zone);
    if (!n) return this.step(goal.x, goal.z, stop);
    if (!this.pathGoal || Math.hypot(goal.x - this.pathGoal.x, goal.z - this.pathGoal.z) > 1.5 || now - this.pathAt > 3 || !this.path.length) {
      this.path = planPath(n, this.me, goal) ?? [goal]; this.pathGoal = goal; this.pathAt = now;
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - this.me.x, this.path[0].z - this.me.z) < 1.2) this.path.shift();
    const look = this.path[Math.min(2, this.path.length - 1)];
    // stuck? sidestep and replan
    if (now - this.lastPos.t > 1.5) { if (Math.hypot(this.me.x - this.lastPos.x, this.me.z - this.lastPos.z) < 0.4 && Math.hypot(goal.x - this.me.x, goal.z - this.me.z) > stop + 0.5) { this.side = 25; this.pathAt = 0; } this.lastPos = { x: this.me.x, z: this.me.z, t: now }; }
    this.step(look.x, look.z, this.path.length > 1 ? 0.2 : stop);
    return Math.hypot(goal.x - this.me.x, goal.z - this.me.z);
  }
  nearestMon(r: number, filter: (m: Mon) => boolean = () => true) { let best: Mon | null = null, bd = r; for (const m of this.mons.values()) { if (m.hp <= 0 || !filter(m)) continue; const d = Math.hypot(m.x - this.me.x, m.z - this.me.z); if (d < bd) { bd = d; best = m; } } return best; }
  cds = new Map<string, number>(); mp = 0;
  potAt = 0;
  fight(m: Mon, now: number) {
    if (this.hp < this.mhp * 0.45 && now - this.potAt > 8.2) { this.potAt = now; this.send({ type: 'use', item: 'hp_potion' }); }
    const d = Math.hypot(m.x - this.me.x, m.z - this.me.z);
    if (d > 2.0) { this.walkTo({ x: m.x, z: m.z }, now, 1.6); return; }
    const yaw = Math.atan2(-(m.x - this.me.x), -(m.z - this.me.z));
    this.send({ type: 'input', seq: ++this.seq, mx: 0, mz: 0, yaw, jump: false, sprint: false, walk: false, dt: 1 / 60 });
    // a real player's rotation: the class skills off cooldown first, basic-attack combos in between
    const sk = SKILLS.find((s) => s.cls === this.cls && s.slot <= 4 && s.unlock <= this.level && s.kind !== 'heal' && (this.cds.get(s.id) ?? 0) <= now && this.mp >= s.mana && (s.range === 0 || s.range >= d));
    if (sk && Math.random() < 0.3) { this.cds.set(sk.id, now + sk.cooldown + 0.3); this.send({ type: 'cast', spell: sk.id, target: m.id, yaw }); return; }
    if (Math.random() < 0.12) this.send({ type: 'attack', yaw, target: m.id });
  }
  /** Gear up like a player who has been farming: an Epic set of the right tier, equipped from the bag. */
  async gearUp() {
    const t = tierFor(this.level);
    const kinds = GEAR_KINDS.filter((k) => k.slot !== 'weapon' || (k.classes ?? []).includes(this.cls as never)).filter((k, i, a) => a.findIndex((x) => x.slot === k.slot) === i);
    this.chat('/give hp_potion 30'); await sleep(900);
    for (const k of kinds) { this.chat('/give ' + gearId(k.key, t, 'epic')); await sleep(900); this.send({ type: 'equip', item: gearId(k.key, t, 'epic') }); await sleep(150); }
  }
  async respawnIfDead() { await sleep(1000 + this.deadWait * 1000); for (let i = 0; i < 20 && this.dead; i++) { this.send({ type: 'respawn' }); await sleep(1000); if (this.hp > 0 && this.zone && !floorOf(this.zone)) this.dead = false; } this.dead = false; }
  /** Run a 60 Hz control loop until done() or the timeout. */
  async loop(secs: number, tick: (now: number) => boolean | void) {
    const t0 = performance.now() / 1000;
    while (performance.now() / 1000 - t0 < secs) {
      const now = performance.now() / 1000;
      if (this.dead) { await this.respawnIfDead(); continue; }
      if (tick(now) === true) return true;
      await sleep(1000 / 60);
    }
    return false;
  }
  async tourRegion(z: string) {
    this.chat('/zone ' + z); await sleep(1500);
    const k0 = this.stats.kills;
    const ok = await this.loop(90, (now) => { const m = this.nearestMon(140); if (m) this.fight(m, now); else this.step(this.me.x + 20 * Math.sin(now / 5), this.me.z + 20 * Math.cos(now / 5)); return this.stats.kills - k0 >= 2; });
    this.stats.regions.push(`${z}:${this.stats.kills - k0} kills${ok ? '' : ' (timeout)'}`);
  }
  async enterTower(floor = 1) {
    this.chat('/gate'); await sleep(1500);
    this.gateOpen = false;
    await this.loop(20, () => { this.step(TOWER_GATE.x, TOWER_GATE.z + 2, 0.5); return this.gateOpen; });
    if (!this.gateOpen) throw new Error(this.name + ': the gate never opened');
    // fight off anything that followed us, then ask the Gate (it stays shut for 5 s after you are hurt)
    let hp = this.hp, calm = performance.now() / 1000, asked = 0;
    await this.loop(90, (now) => {
      if (this.zone === floorId(floor)) return true;
      if (this.hp < hp) calm = now; hp = this.hp;
      const m = this.nearestMon(20); if (m) { this.fight(m, now); return; }
      this.step(TOWER_GATE.x, TOWER_GATE.z + 2, 0.5);
      if (now - calm > 5.5 && now - asked > 2) { asked = now; this.send({ type: 'towerEnter', floor }); }
    });
    if (this.zone !== floorId(floor)) throw new Error(this.name + ': not on floor ' + floor + ' (' + this.zone + ') · ' + this.lastWarn);
  }
  async climb(n: number) {
    const P = floorPlan(n), t0 = performance.now() / 1000;
    const runes = P.plates.filter((q) => q.kind === 'rune'), braz = P.plates.filter((q) => q.kind === 'brazier');
    let lastRune = -1, runeStep = 0, brazI = 0, phase = 'solve', away = 0;
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    if (attempt) { log(`${this.name} fell on floor ${n}; walking back to the Gate`); await this.enterTower(n); }
    ok = await this.loop(240, (now) => {
      if (this.zone === floorId(n + 1)) return true;
      if (this.zone !== floorId(n)) { away ||= now; return now - away > 3 ? true : undefined; }
      away = 0;
      const T = this.tower?.floor === n ? this.tower : null;
      if (process.env.TRACE && now - ((this as any).tr ?? 0) > 4) { (this as any).tr = now; const c = this.nearestMon(60); log(`${this.name} f${n} pos ${this.me.x.toFixed(0)},${this.me.z.toFixed(0)} hp ${this.hp}/${this.mhp} seal ${T?.seal} obj ${T?.objective} mon ${c ? c.name + '@' + Math.hypot(c.x - this.me.x, c.z - this.me.z).toFixed(0) + ' hp' + c.hp : '-'} path ${this.path.length} phase ${phase}`); }
      const sealed = !T || T.floor !== n || !T.seal;
      const inGate = (m: Mon) => Math.abs(m.x - P.gate.x) < P.R / 2 && Math.abs(m.z - P.gate.z) < P.R / 2;
      if (this.hp < this.mhp * 0.3 && phase !== 'heal') phase = 'heal';
      if (phase === 'heal') { const f = P.plates.find((q) => q.kind === 'fountain')!; const c = this.nearestMon(3); if (c && Math.hypot(f.x - this.me.x, f.z - this.me.z) < 3) { this.fight(c, now); return; } this.walkTo(f, now, 1.5); if (this.hp >= this.mhp * 0.9) phase = 'solve'; return; }
      // defend: anything close is fought first
      const close = this.nearestMon(sealed && (P.puzzle?.kind === 'trial' || P.boss) ? 60 : 7, sealed && (P.puzzle?.kind === 'trial' || P.boss) ? inGate : undefined) ?? this.nearestMon(6);
      if (close) { this.fight(close, now); return; }
      if (!sealed) { this.walkTo(P.stairsAt, now, 0.3); return; }
      if (P.boss || P.puzzle?.kind === 'trial') { this.walkTo({ x: P.gate.x, z: P.gate.z + 4 }, now, 2); return; }
      if (P.puzzle?.kind === 'runes') {
        const lit = T?.lit?.length ?? 0;
        if (lit !== runeStep) { runeStep = lit; lastRune = -1; }
        const k = P.puzzle.order![Math.min(lit, 3)]; const r = runes[k];
        if (lastRune === k) { this.walkTo({ x: P.gate.x, z: P.gate.z + 4 }, now, 1); if (Math.hypot(this.me.x - r.x, this.me.z - r.z) > r.r + 1.5) lastRune = -1; return; }
        if (this.walkTo(r, now, 0.3) < r.r * 0.6) lastRune = k;
        return;
      }
      if (P.puzzle?.kind === 'braziers') {
        const on = T?.braziers ?? []; while (brazI < braz.length && on[brazI]) brazI++; if (brazI >= braz.length) brazI = 0;
        const b = braz.findIndex((_, i) => !on[i]); const tgt = braz[b < 0 ? 0 : b];
        this.walkTo({ x: tgt.x + 1.6, z: tgt.z }, now, 0.3);
        return;
      }
    }) && this.zone === floorId(n + 1);
    }
    const secs = performance.now() / 1000 - t0;
    this.stats.floors.push({ n, secs: Math.round(secs), puzzle: P.boss ? 'guardian' : P.puzzle?.kind ?? '?' });
    return ok;
  }
}

const tag = Date.now().toString(36).slice(-4);
const classes = ['warrior', 'knight', 'warrior', 'knight', 'warrior', 'knight'];
const bots = Array.from({ length: N }, (_, i) => new Bot(`Clm${tag}${i}`, classes[i % classes.length]));
const t0 = Date.now();
await Promise.all(bots.map((b) => b.connect()));
log(`${N} bots: New Game → registered, created, prologue skipped`);
for (const b of bots) { b.chat('/xp 2500000'); await sleep(900); b.chat('/time 11'); }
await sleep(1500);
await Promise.all(bots.map((b) => b.gearUp()));
log('levels: ' + bots.map((b) => b.level).join(', '));
const results = await Promise.all(bots.map(async (b) => {
  try {
    if (!process.env.SKIP_REGIONS) for (const z of REGIONS_TOUR) await b.tourRegion(z);
    const start = Number(process.env.START_FLOOR ?? 1);
    if (start > 1) { b.chat('/floor ' + start); await sleep(2000); } else await b.enterTower();
    let reached = start - 1;
    for (let n = start; n <= FLOORS; n++) { if (!(await b.climb(n))) { b.stats.errors.push(`stuck on floor ${n} (${b.tower?.objective ?? ''})`); break; } reached = n; log(`${b.name} cleared floor ${n}`); }
    return { b, reached };
  } catch (e) { b.stats.errors.push(String(e)); return { b, reached: 0 }; }
}));
for (const { b, reached } of results) {
  console.log(`${b.name} (${b.cls} Lv ${b.level}): regions [${b.stats.regions.join(', ')}] · floors cleared ${reached}/${FLOORS} · ${b.stats.floors.map((f) => `${f.n}:${f.puzzle}:${f.secs}s`).join(' ')} · kills ${b.stats.kills} · deaths ${b.stats.deaths}${b.stats.errors.length ? ' · ERR ' + b.stats.errors.join(' | ') : ''}`);
  b.ws.close();
}
const ok = results.every((r) => r.reached >= FLOORS);
console.log(`total ${Math.round((Date.now() - t0) / 1000)} s · ${ok ? 'M7 BOTS OK' : 'M7 BOTS FAIL'}`);
process.exit(ok ? 0 : 1);
