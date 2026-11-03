import { withZone, SEALS_OPEN, setActiveZone } from '../../shared/world';
import { REGIONS } from '../../shared/regions';
import { FLOORS, floorId, floorOf, floorPlan, floorLevel, isBossFloor, themeOf, TRAP, TOWER_GATE, TOWER_BOSS_ITEM, SYMBOL_NAMES, type FloorPlan } from '../../shared/tower';
import { addItem, ITEMS } from '../../shared/items';
import { gearId, tierFor, GEAR_KINDS } from '../../shared/economy';
import { MONSTERS } from '../../shared/combat';
import type { Game, Player, Monster } from './game';

interface FloorState {
  n: number; seal: boolean; lit: number[]; braziers: number[]; guardians: Set<number>; boss: number; bossDead: boolean;
  chests: Set<string>; spawned: boolean; emptySince: number; openedBy?: string;
}
const ZERO = (n: number): FloorState => ({ n, seal: false, lit: [], braziers: [], guardians: new Set(), boss: 0, bossDead: false, chests: new Set(), spawned: false, emptySince: 0 });

/** Phase 4 · M5: the Hundredth Tower, server-authoritative. Floors spawn on first entry and reset
 *  after 90 s with nobody on them. Traps, rune/brazier puzzles, guardian trials and boss seals are all
 *  decided here; the client only draws what it is told. */
export class TowerSys {
  floors = new Map<number, FloorState>();
  private board: { at: number; rows: { name: string; cls: string; level: number; floor: number; at: number; id: string }[] } = { at: -1e9, rows: [] };
  constructor(private g: Game) {}

  state(n: number) { let s = this.floors.get(n); if (!s) { s = ZERO(n); this.floors.set(n, s); } return s; }
  /** Floor zones that need ticking this frame. */
  liveZones(): string[] { return [...this.floors.values()].filter((s) => s.spawned).map((s) => floorId(s.n)); }
  best(p: Player) { return p.char.counters?.towerBest ?? 0; }

  ensure(n: number) {
    const st = this.state(n);
    if (st.spawned) return st;
    st.spawned = true;
    const P = floorPlan(n), z = floorId(n), L = floorLevel(n);
    withZone(z, () => {
      for (const m of P.monsters) {
        const e = this.spawn(m.kind, m.x, m.z, z, n, L);
        if (m.guardian) st.guardians.add(e.id);
      }
      if (P.boss) { const b = this.spawn(P.boss.kind, P.boss.x, P.boss.z, z, n, L); st.boss = b.id; }
    });
    return st;
  }
  private spawn(kind: string, x: number, z: number, zone: string, n: number, L: number): Monster {
    const m = this.g.spawnMonster(kind as any, x, z, zone);
    const base = MONSTERS[kind as keyof typeof MONSTERS];
    const f = Math.max(0.7, 1 + (L - (base?.level ?? L)) * 0.035);
    m.mhp = m.hp = Math.round(m.hp * f); m.level = L; m.noRespawn = true;
    void n;
    return m;
  }
  reset(n: number) {
    const z = floorId(n);
    for (const e of [...this.g.ents.values()]) if (e.zone === z && e.type !== 'p' && e.type !== 'b') this.g.removeEnt(e.id);
    this.floors.delete(n);
    SEALS_OPEN.delete(z);
  }
  tick(now: number) {
    for (const st of [...this.floors.values()]) {
      const z = floorId(st.n);
      let anyone = false;
      for (const p of this.g.players.values()) if (p.zone === z) { anyone = true; break; }
      if (anyone) st.emptySince = 0;
      else if (!st.emptySince) st.emptySince = now;
      else if (now - st.emptySince > 90) this.reset(st.n);
    }
  }
  objective(n: number, st: FloorState): string {
    const P = floorPlan(n);
    if (st.seal) return 'The seal is broken: take the stairs';
    if (P.boss) return `Defeat ${MONSTERS[P.boss.kind as keyof typeof MONSTERS]?.name ?? 'the guardian'}`;
    if (P.puzzle?.kind === 'runes') return `Chamber of Runes: step on the runes in the order the stele shows (${st.lit.length}/4)`;
    if (P.puzzle?.kind === 'braziers') return `Hall of Braziers: light all three braziers within 30 s (${st.braziers.filter(Boolean).length}/3)`;
    if (P.puzzle?.kind === 'trial') return `Trial Hall: defeat the guardians (${st.guardians.size} left)`;
    return 'Find the stairs';
  }
  view(p: Player, n: number) {
    const st = this.state(n), P = floorPlan(n);
    return { type: 'tower', floor: n, name: REGIONS[floorId(n) as 'capital'].name, seal: st.seal, lit: st.lit, braziers: st.braziers.map((t) => (t ? 1 : 0)), order: P.puzzle?.order ?? null,
      bossDead: st.bossDead, chest: st.chests.has(p.char.id), now: this.g.o.now(), best: this.best(p), objective: this.objective(n, st), boss: !!P.boss } as any;
  }
  sendState(p: Player, n = floorOf(p.zone)) { if (n) p.conn?.send(this.view(p, n)); }
  broadcast(n: number) { const z = floorId(n); for (const p of this.g.players.values()) if (p.zone === z) this.sendState(p, n); }
  notify(n: number, text: string, style: 'info' | 'rank' | 'warn' | 'levelup' = 'info') { const z = floorId(n); for (const p of this.g.players.values()) if (p.zone === z) p.conn?.send({ type: 'notice', text, style }); }
  open(n: number, why: string) {
    const st = this.state(n);
    if (st.seal) return;
    st.seal = true; SEALS_OPEN.add(floorId(n));
    this.notify(n, `${why} The seal on the stairway shatters!`, 'rank');
    const P = floorPlan(n);
    for (const p of this.g.players.values()) if (p.zone === floorId(n)) p.conn?.send({ type: 'fx', kind: 'shrine', src: p.id, x: P.seal.x, y: 0, z: P.seal.z, text: 'Seal broken' } as any);
    this.broadcast(n);
  }

  /** Per-player, zone already active. */
  tickPlayer(p: Player, now: number) {
    const n = floorOf(p.zone);
    if (!n || p.type !== 'p') return;
    const st = this.ensure(n), P = floorPlan(n);
    if (p.dead) return;
    const pr = p as Player & { onPlate?: number; plateSince?: number; trapHit?: Record<number, number> };
    let on = 0;
    for (const pl of P.plates) {
      const d = Math.hypot(p.s.x - pl.x, p.s.z - pl.z);
      if (d > pl.r) continue;
      on = pl.id;
      if (pl.kind === 'spike') {
        const cyc = Math.floor((now + (pl.phase ?? 0)) / TRAP.period), ph = (now + (pl.phase ?? 0)) % TRAP.period;
        pr.trapHit ??= {};
        if (ph < TRAP.active && pr.trapHit[pl.id] !== cyc && p.s.y < 1.2) {
          pr.trapHit[pl.id] = cyc;
          const dmg = Math.round(p.mhp * TRAP.damage);
          p.hp = Math.max(0, p.hp - dmg); p.lastHurt = now;
          this.g.broadcastNear(p.s.x, p.s.z, 60, { type: 'fx', kind: 'hit', src: 0, dst: p.id, x: p.s.x, y: p.s.y + 1, z: p.s.z, text: `-${dmg}` } as any);
          if (now > ((p as any).trapWarn ?? 0)) { (p as any).trapWarn = now + 6; p.conn?.send({ type: 'notice', text: 'Spikes! Time your steps when the plates go dark.', style: 'warn' }); }
          if (p.hp <= 0) this.g.kill({ id: -1, type: 'm', name: 'a spike trap', s: p.s, zone: p.zone } as any, p, now);
        }
      } else if (pl.kind === 'fountain') {
        if (now - p.lastHurt > 3) { p.hp = Math.min(p.mhp, p.hp + p.mhp * 0.15 * 0.05); p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.maxMp * 0.15 * 0.05); }
      } else if (pl.kind === 'rune' && pr.onPlate !== pl.id && P.puzzle?.order && !st.seal) {
        const idx = P.plates.filter((q) => q.kind === 'rune').indexOf(pl);
        const want = P.puzzle.order[st.lit.length];
        if (st.lit.includes(idx)) { /* already lit */ }
        else if (idx === want) {
          st.lit.push(idx);
          this.notify(n, `The ${SYMBOL_NAMES[idx]} rune awakens (${st.lit.length}/4).`, 'info');
          if (st.lit.length === 4) { st.openedBy = p.name; this.open(n, `${p.name} completed the rune sequence.`); } else this.broadcast(n);
        } else {
          st.lit = [];
          const dmg = Math.round(p.mhp * 0.08); p.hp = Math.max(1, p.hp - dmg);
          this.notify(n, `Wrong rune: the ${SYMBOL_NAMES[idx]} flares and every rune goes dark. Read the stele again.`, 'warn');
          this.broadcast(n);
        }
      } else if (pl.kind === 'brazier' && P.puzzle?.kind === 'braziers' && !st.seal) {
        const bi = P.plates.filter((q) => q.kind === 'brazier').indexOf(pl);
        if (pr.onPlate !== pl.id) pr.plateSince = now;
        if (!st.braziers[bi] && now - (pr.plateSince ?? now) > 1.2) {
          st.braziers[bi] = now;
          const lit = st.braziers.filter(Boolean).length;
          this.notify(n, `A brazier roars to life (${lit}/3).`, 'info');
          if (lit === 3) { st.openedBy = p.name; this.open(n, 'All three braziers burn.'); } else this.broadcast(n);
        }
      } else if (pl.kind === 'chest' && !st.chests.has(p.char.id)) {
        st.chests.add(p.char.id);
        this.lootChest(p, n);
        this.sendState(p, n);
      }
    }
    pr.onPlate = on;
    // braziers burn out if the third is not lit in time
    if (P.puzzle?.kind === 'braziers' && !st.seal && st.braziers.some((t) => t && now - t > 30)) { st.braziers = []; this.notify(n, 'The braziers gutter out. Light all three faster.', 'warn'); this.broadcast(n); }
    // exits
    if (Math.hypot(p.s.x - P.stairsAt.x, p.s.z - P.stairsAt.z) < 4.2 && st.seal) { this.clear(p, n, now); return; }
    if (Math.hypot(p.s.x - P.descentAt.x, p.s.z - P.descentAt.z) < 3.6) { this.leave(p, now, 'You descend to the Foot of the Tower.'); return; }
  }
  private lootChest(p: Player, n: number) {
    const L = floorLevel(n), t = tierFor(L), r = () => this.g.rand();
    const K = GEAR_KINDS[Math.floor(r() * GEAR_KINDS.length)];
    const rar = r() < 0.2 + n * 0.004 ? 'epic' : 'rare';
    const items = [gearId(K.key, t, rar as any), 'Enchant Stone', r() < 0.5 ? 'hp_potion' : 'elixir'].filter((id) => ITEMS[id] || id === 'Enchant Stone');
    for (const id of items) p.char.inventory = addItem(p.char.inventory, id, 1);
    const gold = 20 + n * 12; p.char.gold += gold;
    p.conn?.send({ type: 'loot', items: items.map((id) => ({ item: id, rarity: ITEMS[id] ? ITEMS[id].rarity[0].toUpperCase() + ITEMS[id].rarity.slice(1) : 'Uncommon' })), gold } as any);
    p.conn?.send({ type: 'inv', inventory: p.char.inventory, gold: p.char.gold, enchant: p.char.enchant ?? {}, equipment: (p.char.equipment ?? {}) as Record<string, string> } as any);
    p.conn?.send({ type: 'notice', text: 'Treasure! The vault chest opens for you.', style: 'rank' });
    this.g.markDirty();
  }
  onKill(m: Monster) {
    const n = floorOf(m.zone);
    if (!n) return;
    const st = this.floors.get(n);
    if (!st) return;
    if (m.id === st.boss && !st.bossDead) { st.bossDead = true; this.open(n, `${m.name} has fallen!`); this.g.broadcastAll({ type: 'chat', from: 'World', text: `The guardian of Floor ${n}, ${m.name}, has been defeated!`, channel: 'world' } as any); return; }
    if (st.guardians.delete(m.id)) {
      if (st.guardians.size === 0) this.open(n, 'The last guardian falls.');
      else { this.notify(n, `A guardian falls (${st.guardians.size} left).`); this.broadcast(n); }
    }
  }
  /** First clear of a floor: rewards, record, title; then up the stairs. */
  clear(p: Player, n: number, now: number) {
    const best = this.best(p);
    p.char.counters = p.char.counters ?? {};
    if (n > best) {
      p.char.counters.towerBest = n; p.char.counters.towerBestAt = Date.now();
      const L = floorLevel(n), t = tierFor(L), boss = isBossFloor(n);
      const xp = Math.round(150 + n * 60 * (boss ? 3 : 1)), gold = Math.round(30 * n * (boss ? 3 : 1));
      p.char.gold += gold;
      this.g.giveXpPublic(p, xp);
      const K = GEAR_KINDS[Math.floor(this.g.rand() * GEAR_KINDS.length)];
      const items = [gearId(K.key, t, boss ? 'epic' : 'rare')];
      const bk = floorPlan(n).boss?.kind;
      if (boss && bk && TOWER_BOSS_ITEM[bk]) items.push(TOWER_BOSS_ITEM[bk]);
      for (const id of items) if (ITEMS[id]) p.char.inventory = addItem(p.char.inventory, id, 1);
      p.conn?.send({ type: 'loot', items: items.filter((id) => ITEMS[id]).map((id) => ({ item: id, rarity: ITEMS[id].rarity[0].toUpperCase() + ITEMS[id].rarity.slice(1) })), gold } as any);
      p.conn?.send({ type: 'inv', inventory: p.char.inventory, gold: p.char.gold, enchant: p.char.enchant ?? {}, equipment: (p.char.equipment ?? {}) as Record<string, string> } as any);
      p.conn?.send({ type: 'notice', text: `Floor ${n} cleared for the first time! +${xp} XP · +${gold} gold`, style: 'levelup' });
      if (boss || n === FLOORS) this.g.broadcastAll({ type: 'chat', from: 'World', text: `${p.name} has conquered Floor ${n} of the Hundredth Tower!`, channel: 'world' } as any);
      this.g.progress.checkTitles(p);
      this.board.at = -1e9;
      this.g.markDirty();
    }
    if (n >= FLOORS) { this.leave(p, now, 'You stand on the summit of the Hundredth Tower. The sky is yours.'); return; }
    this.go(p, n + 1);
  }
  go(p: Player, n: number) {
    this.ensure(n);
    const R = REGIONS[floorId(n) as 'capital'];
    this.g.zones.move(p, floorId(n) as any, R.spawn.x, R.spawn.z, R.spawn.yaw, R.name);
    setTimeout(() => { if (p.zone === floorId(n)) this.sendState(p, n); }, 50);
  }
  leave(p: Player, now: number, text: string) {
    void now;
    this.g.zones.move(p, 'tower', TOWER_GATE.x + 6, TOWER_GATE.z + 14, 0, REGIONS.tower.name);
    p.conn?.send({ type: 'notice', text, style: 'info' });
    (p as any).gatePrompt = this.g.o.now() + 8;
  }
  /** At the Gate of the Tower: offer the floor picker. */
  gateCheck(p: Player, now: number) {
    if (p.type !== 'p' || p.dead) return;
    const d = Math.hypot(p.s.x - TOWER_GATE.x, p.s.z - TOWER_GATE.z);
    const pr = p as Player & { gatePrompt?: number; atGate?: boolean };
    if (d < TOWER_GATE.r) {
      if (!pr.atGate && now > (pr.gatePrompt ?? 0)) { pr.atGate = true; this.sendGate(p); }
    } else if (d > TOWER_GATE.r + 3) pr.atGate = false;
  }
  sendGate(p: Player) { p.conn?.send({ type: 'towerGate', best: this.best(p), floors: FLOORS, themes: Array.from({ length: 10 }, (_, k) => themeOf(k * 10 + 1).name) } as any); }
  enter(p: Player, floor: number, now: number) {
    const n = Math.floor(Number(floor));
    const max = Math.min(FLOORS, this.best(p) + 1);
    if (!(n >= 1 && n <= max)) { p.conn?.send({ type: 'notice', text: `You can enter floors 1 to ${max}.`, style: 'warn' }); return; }
    const atGate = p.zone === 'tower' && Math.hypot(p.s.x - TOWER_GATE.x, p.s.z - TOWER_GATE.z) < TOWER_GATE.r + 8;
    if (!atGate && !floorOf(p.zone)) { p.conn?.send({ type: 'notice', text: 'Stand at the Gate of the Tower to enter.', style: 'warn' }); return; }
    if (now - p.lastHurt < 5 || p.dead) { p.conn?.send({ type: 'notice', text: 'The Gate will not open while you are in combat.', style: 'warn' }); return; }
    this.go(p, n);
  }
  leaderboard(p: Player) {
    const now = this.g.o.now();
    if (now - this.board.at > 15) {
      const rows: { name: string; cls: string; level: number; floor: number; at: number; id: string }[] = [];
      for (const u of Object.values(this.g.data.users)) for (const c of u.chars) { const f = c.counters?.towerBest ?? 0; if (f > 0) rows.push({ name: c.name, cls: c.cls, level: c.level, floor: f, at: c.counters?.towerBestAt ?? 0, id: c.id }); }
      rows.sort((a, b) => b.floor - a.floor || a.at - b.at);
      this.board = { at: now, rows };
    }
    const place = this.board.rows.findIndex((r) => r.id === p.char.id) + 1;
    p.conn?.send({ type: 'towerBoard', rows: this.board.rows.slice(0, 20).map(({ id, at, ...r }) => { void at; return { ...r, me: id === p.char.id }; }), place, total: this.board.rows.length, best: this.best(p) } as any);
  }
}
export type { FloorPlan };
