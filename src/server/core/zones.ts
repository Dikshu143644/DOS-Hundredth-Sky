import { REGIONS, ZONE_IDS, arrivalFor, type ZoneId } from '../../shared/regions';
import { setActiveZone, withZone, heightAt, ZONE, POIS } from '../../shared/world';
import { newCharState } from '../../shared/physics';
import type { Game, Player } from './game';

const CAPITAL_CAMPS: { kinds: string[]; x: number; z: number; n: number }[] = [
  { kinds: ['minion'], x: 16, z: -30, n: 3 }, { kinds: ['minion'], x: -26, z: 46, n: 4 }, { kinds: ['minion', 'warrior'], x: 70, z: 84, n: 5 },
  { kinds: ['magus', 'warrior'], x: -104, z: 118, n: 3 }, { kinds: ['minion', 'magus'], x: 118, z: 4, n: 4 },
];
const WEATHER_NOTICE: Record<string, string> = {
  clear: 'The sky clears.', rain: 'Rain begins to fall.', storm: 'A storm rolls down from the Tower…', fog: 'A thick mist creeps in.',
  snow: 'Snow begins to fall.', blizzard: 'A blizzard howls across the ice!', sandstorm: 'A sandstorm sweeps over the dunes!', ash: 'Ash drifts from a burning sky.',
};

/** Phase 4 · M2: seven streamed regions on one server. Each zone keeps its own monsters, weather and
 *  geometry; a zone with nobody in it sleeps. Exits and attuned shrines move players between zones. */
export class Zones {
  weather: Record<string, { w: string; until: number }> = {};
  constructor(private g: Game) {
    const now = g.o.now();
    for (const z of ZONE_IDS) this.weather[z] = { w: z === 'capital' ? 'clear' : REGIONS[z].weather[0][0], until: now + 120 + g.rand() * 240 };
  }
  spawnAll() {
    for (const z of ZONE_IDS) withZone(z, () => {
      const r = REGIONS[z];
      const camps = z === 'capital' ? CAPITAL_CAMPS : r.camps;
      for (const c of camps) for (let i = 0; i < c.n; i++) this.g.spawnMonster(c.kinds[i % c.kinds.length], c.x + (this.g.rand() - 0.5) * 12, c.z + (this.g.rand() - 0.5) * 12, z);
      this.g.spawnMonster(r.boss.kind, r.boss.x, r.boss.z, z);
    });
  }
  /** A zone ticks while a real or bot player is in it (plus a 20 s grace so fights resolve). */
  private lastSeen: Record<string, number> = {};
  active(zone: string) { return (this.g.o.now() - (this.lastSeen[zone] ?? -1e9)) < 20; }
  weatherOf(zone: string) { return this.weather[zone]?.w ?? 'clear'; }
  tickWeather(now: number) {
    for (const z of ZONE_IDS) {
      const w = this.weather[z];
      if (now < w.until) continue;
      const opts = REGIONS[z].weather, tot = opts.reduce((a, o) => a + o[1], 0);
      let r = this.g.rand() * tot, pick = opts[0][0];
      for (const [name, wt] of opts) { if ((r -= wt) <= 0) { pick = name; break; } }
      const calm = pick === 'clear' || pick === 'snow' || pick === 'fog';
      w.until = now + (calm ? 240 + this.g.rand() * 300 : 120 + this.g.rand() * 150);
      if (pick === w.w) continue;
      w.w = pick;
      for (const p of this.g.players.values()) if (p.zone === z) p.conn?.send({ type: 'notice', text: WEATHER_NOTICE[pick] ?? pick, style: 'info' });
    }
  }
  /** Called each tick for a player (zone already active): exits, shrine attunement, presence. */
  tickPlayer(p: Player, now: number) {
    this.lastSeen[p.zone] = now;
    if (p.dead || p.type !== 'p') return;
    const r = REGIONS[p.zone as ZoneId];
    if (!r) return;
    for (const e of r.exits) {
      if (Math.hypot(p.s.x - e.x, p.s.z - e.z) < 4.2) {
        if (now - p.lastHurt < 4) { if (now > (p.exitWarn ?? 0)) { p.exitWarn = now + 3; p.conn?.send({ type: 'notice', text: 'You cannot leave while in combat.', style: 'warn' }); } return; }
        const a = arrivalFor(e.to, p.zone as ZoneId);
        this.move(p, e.to, a.x, a.z, a.yaw, `${REGIONS[e.to].name}`);
        return;
      }
    }
    for (const s of r.shrines) {
      if (Math.hypot(p.s.x - s.x, p.s.z - s.z) < 5.5) {
        const key = p.zone + ':' + s.id;
        const list = (p.char.shrines ??= ['capital:dawn']);
        const fresh = !list.includes(key);
        if (fresh) list.push(key);
        if (fresh || p.char.bind !== key) {
          p.char.bind = key;
          p.conn?.send({ type: 'notice', text: fresh ? `Shrine attuned: ${s.name}. You can now fast-travel here and you will rise here if you fall.` : `${s.name}: you will rise here.`, style: 'rank' });
          p.conn?.send({ type: 'fx', kind: 'shrine', src: p.id, x: s.x, y: p.s.y, z: s.z, text: s.name });
          this.sendMap(p);
          this.g.markDirty();
        }
      }
    }
  }
  /** Fast travel to an attuned shrine. */
  travel(p: Player, key: string, now: number) {
    const [zone, id] = String(key).split(':');
    const r = REGIONS[zone as ZoneId];
    const s = r?.shrines.find((x) => x.id === id);
    if (!s || !(p.char.shrines ?? ['capital:dawn']).includes(key)) { p.conn?.send({ type: 'notice', text: 'You have not attuned that shrine yet.', style: 'warn' }); return; }
    if (p.dead) return;
    if (now - p.lastHurt < 6) { p.conn?.send({ type: 'notice', text: 'The shrine will not answer while you are in combat.', style: 'warn' }); return; }
    this.move(p, zone as ZoneId, s.x + 3, s.z + 3, 0, s.name);
  }
  /** Shrine you rise at after death (last attuned), defaulting to the Shrine of Dawn. */
  bindPos(p: Player): { zone: ZoneId; x: number; z: number; yaw: number; name: string } {
    const [zone, id] = String(p.char.bind ?? 'capital:dawn').split(':');
    const r = REGIONS[zone as ZoneId] ?? REGIONS.capital;
    const s = r.shrines.find((x) => x.id === id) ?? REGIONS.capital.shrines[0];
    return { zone: r.id, x: s.x + 2, z: s.z + 3, yaw: 0, name: s.name };
  }
  /** Move a player into a zone (same or other); the client streams the new region in. */
  move(p: Player, zone: ZoneId, x: number, z: number, yaw: number, label: string) {
    const from = p.zone;
    // summons follow their owner
    for (const e of this.g.ents.values()) if (e.type === 's' && (e as any).owner === p.id) this.g.removeEnt(e.id);
    p.compWasUp = false; // the companion walks through the gate with you
    p.zone = zone; p.char.zone = zone;
    setActiveZone(zone);
    p.s = newCharState(x, z, yaw);
    p.inputs.length = 0;
    p.known.clear();
    p.casting = null;
    this.lastSeen[zone] = this.g.o.now();
    if (from !== zone) p.char.visited = [...new Set([...(p.char.visited ?? []), zone])];
    p.conn?.send({ type: 'zone', zone, x: p.s.x, y: p.s.y, z: p.s.z, yaw, weather: this.weatherOf(zone), label, region: REGIONS[zone].name, levels: REGIONS[zone].levels });
    this.g.markDirty();
    this.g.onZoneEnter?.(p, from);
    if (from !== zone) this.g.advance(p, (s) => s.type === 'zone' && s.target === zone);
  }
  /** What the map / travel panel shows. */
  sendMap(p: Player) {
    p.conn?.send({ type: 'map', zone: p.zone, attuned: p.char.shrines ?? ['capital:dawn'], bind: p.char.bind ?? 'capital:dawn', visited: p.char.visited ?? ['capital'] });
  }
  poiName(x: number, z: number) { for (const q of POIS) if (Math.hypot(x - q.x, z - q.z) < q.r) return q.name; return REGIONS[ZONE].name; }
  groundY(x: number, z: number) { return heightAt(x, z); }
}
