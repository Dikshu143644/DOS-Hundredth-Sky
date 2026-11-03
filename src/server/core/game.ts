import { newCharState, stepCharacter, CharState, MoveInput, PHYS, hasLineOfSight, raycastWorld, sweepDash } from '../../shared/physics';
import { heightAt, SPAWN, POIS, poiAt, POI, WATER_LEVEL, buildZone } from '../../shared/world';
import { mulberry32, clamp } from '../../shared/rng';
import {
  CLASSES, classById, SPELLS, spellById, BASIC_ATTACK, MONSTERS, MonsterKind, MonsterDef, statsFor, grantXp, xpToNext,
  computeDamage, canCast, rollLoot, Stats, ClassId,
} from '../../shared/combat';
import { ITEMS, LEGENDARY_IDS, STARTER_WEAPON, CLASS_GIFT, SLOTS, Slot, Equipment, equip, unequip, equipBonus, addItem, rarityOf } from '../../shared/items';
import { C2S, S2C, NetEntity, CharacterSummary, Appearance, SelfState, PROTOCOL_VERSION, sanitizeName, sanitizeChat } from '../../shared/protocol';
import { InputBudget } from '../../shared/netcode';
import { NPCS, NpcDef } from './npcdefs';
import { Selector, Sequence, Cond, Act, BTNode, Status } from './bt';
import { LlmGate, LlmFn, parseJsonLoose } from './llm';
import { Quest, SPARKS, generateQuest, questView, DirectorContext } from './director';
import { Combat, Status as FxStatus, newStatus, Summon } from './combat';
import { Progression } from './progression';
import { SKILLS, Attr, titleById } from '../../shared/skills';

// ------------------------------------------------------------------ persistence contracts
export interface CharRecord {
  id: string; name: string; cls: ClassId; level: number; xp: number; gold: number; appearance: Appearance; created: number;
  inventory: { item: string; rarity: string; n: number }[]; quests: Quest[]; sparks: string[]; deeds: string[]; kills: number; deaths: number;
  equipment?: Equipment;
  attrs?: Partial<Record<Attr, number>>; skillRanks?: Record<string, number>; adv?: string | null; titles?: string[]; title?: string | null;
  rep?: Record<string, number>; mastery?: Record<string, number>; counters: Record<string, number>; shrine?: string; zone?: string;
}
export interface UserRecord { hash: string; created: number; chars: CharRecord[] }
export interface NpcMemory { met: number; lastSeen: number; short: { who: 'player' | 'npc'; text: string }[]; long: string[] }
export interface SaveData {
  users: Record<string, UserRecord>;
  sessions: Record<string, { user: string; exp: number }>;
  npcMemory: Record<string, Record<string, NpcMemory>>;
  worldEvents: string[];
}
export interface Store { load(): SaveData | null; save(d: SaveData): void }
export interface Hasher { hash(pw: string): Promise<string>; verify(pw: string, stored: string): Promise<boolean>; token(): string }
export interface Conn { id: number; send(m: S2C): void; close(): void; remote?: string }

export interface GameOptions {
  store: Store; hasher: Hasher; llm: LlmFn | null; now: () => number; mode: 'online' | 'offline'; bots: number; dev: boolean;
  serverName: string; log?: (...a: unknown[]) => void;
}

export type EntType = 'p' | 'm' | 'n' | 'b' | 's';
export interface Ent { id: number; type: EntType; s: CharState; hp: number; mhp: number; anim: string; animUntil: number; name: string; model: string; dead: boolean; stunUntil: number; level: number; st: FxStatus; zone: string }

export interface Player extends Ent {
  conn: Conn | null; user: string; char: CharRecord; stats: Stats; mp: number; cds: Record<string, number>;
  inputs: MoveInput[]; budget: InputBudget; lastSeq: number; known: Set<number>;
  casting: null | { spell: string; until: number; target?: number; aim?: { x: number; y: number; z: number }; yaw: number };
  attackReadyAt: number; lastHurt: number; poi: string | null; streak: number; lastChat: number; lastTalk: number;
  brain?: BotBrain; respawnAt: number; joinedAt: number;
  combo: { n: number; last: number }; parryCd: number; weakUntil: number;
}
export interface Monster extends Ent { enraged?: boolean; specialAt?: number; summonedBy?: number; noRespawn?: boolean; def: MonsterDef; home: { x: number; z: number }; ai: 'idle' | 'patrol' | 'chase' | 'attack' | 'flee' | 'return'; target: number; nextAttack: number; wander: { x: number; z: number } | null; aiTimer: number; respawnAt: number; fleeUntil: number; lastHitBy: number; threat: Map<number, number> }
interface Npc extends Ent { def: NpcDef; bt: BTNode<Npc>; talkTo: number; talkUntil: number; patrolIdx: number; hidden: boolean; goal: { x: number; z: number; anim: string; yaw?: number } | null }
interface BotBrain { role: ClassId; goal: { x: number; z: number } | null; target: number; retreat: boolean; nextThink: number; nextChat: number }
export interface Projectile { owner: number; spell: string; x: number; y: number; z: number; dx: number; dy: number; dz: number; speed: number; left: number; power: number; stat: number; homing?: number }

const SPAWNS: { kind: MonsterKind; x: number; z: number; n: number }[] = [
  { kind: 'minion', x: 16, z: -30, n: 3 },
  { kind: 'minion', x: -26, z: 46, n: 4 },
  { kind: 'minion', x: 70, z: 84, n: 4 },
  { kind: 'warrior', x: 70, z: 84, n: 2 },
  { kind: 'magus', x: -104, z: 118, n: 2 },
  { kind: 'warrior', x: -100, z: 126, n: 1 },
  { kind: 'minion', x: 118, z: 4, n: 3 },
  { kind: 'magus', x: 112, z: 14, n: 1 },
];

const BOT_NAMES = ['Kirin', 'Sora', 'Yuki', 'Ren', 'Aoi', 'Haru'];
const BOT_LINES = ['anyone seen the Grave Knight at the ruins?', 'LFG Hollow Ruins, need a healer', 'that Tower never stops glowing…', 'IGNIS at night looks unreal', 'rain incoming, watch for magus at the shrine', 'gg, nice FULGUR', 'heading to the Ember Glade'];

export class Game {
  ents = new Map<number, Ent>();
  players = new Map<number, Player>();
  conns = new Map<number, { conn: Conn; user: string | null; authTries: number[]; player: Player | null }>();
  projectiles: Projectile[] = [];
  data: SaveData;
  llm: LlmGate;
  worldTime = 9.2;          // hours
  weather: 'clear' | 'rain' | 'storm' = 'clear';
  weatherUntil = 0;
  private nextId = 1;
  private rnd = mulberry32(Date.now() & 0xffff);
  private dirty = false;
  private lastSave = 0;
  private lastTick = 0;
  private tickN = 0;
  readonly DAY_SECONDS = 1200; // one in-game day = 20 real minutes
  combat: Combat;
  progress: Progression;
  newId() { return this.nextId++; }
  rand() { return this.rnd(); }
  removeEnt(id: number) { this.ents.delete(id); }
  /** PvP: players are hostile to each other only inside a duel/arena (set by the social system). */
  pvpHostile(a: Ent, b: Ent): boolean { void a; void b; return false; }
  weatherAt(p: Ent): string { void p; return this.weather; }
  poiIdAt(x: number, z: number): string | null { return poiAt(x, z)?.id ?? null; }

  constructor(public o: GameOptions) {
    this.data = o.store.load() ?? { users: {}, sessions: {}, npcMemory: {}, worldEvents: [] };
    this.llm = new LlmGate(o.llm, o.now);
    this.combat = new Combat(this);
    this.progress = new Progression(this);
    buildZone();
    for (const sp of SPAWNS) for (let i = 0; i < sp.n; i++) this.spawnMonster(sp.kind, sp.x + (this.rnd() - 0.5) * 10, sp.z + (this.rnd() - 0.5) * 10);
    for (const d of NPCS) this.spawnNpc(d);
    for (let i = 0; i < o.bots; i++) this.spawnBot(i);
    this.lastTick = o.now();
    this.weatherUntil = o.now() + 240;
  }

  // ------------------------------------------------------------------ connections
  connect(conn: Conn) {
    this.conns.set(conn.id, { conn, user: null, authTries: [], player: null });
    conn.send({ type: 'welcome', v: PROTOCOL_VERSION, server: this.o.serverName, mode: this.o.mode, llm: this.llm.enabled, motd: 'Welcome to the edge of the Capital. The Hundredth Tower awaits.' });
  }
  disconnect(connId: number) {
    const c = this.conns.get(connId);
    if (c?.player) this.removePlayer(c.player);
    this.conns.delete(connId);
  }

  async handle(connId: number, m: C2S) {
    const c = this.conns.get(connId);
    if (!c || !m || typeof m !== 'object') return;
    const send = (x: S2C) => c.conn.send(x);
    const now = this.o.now();
    switch (m.type) {
      case 'hello': return;
      case 'ping': send({ type: 'pong', t: m.t, st: now }); return;
      case 'register':
      case 'login': {
        c.authTries = c.authTries.filter((t) => now - t < 60);
        if (c.authTries.length >= 8) return send({ type: 'auth', ok: false, error: 'Too many attempts — wait a minute.' });
        c.authTries.push(now);
        const user = String(m.user ?? '').toLowerCase().trim();
        const pass = String(m.pass ?? '');
        if (!/^[a-z0-9_]{3,20}$/.test(user) && !/^[a-z0-9._%+-]{1,48}@[a-z0-9.-]{1,60}\.[a-z]{2,24}$/.test(user)) return send({ type: 'auth', ok: false, error: 'Use your email, or a name of 3–20 letters, digits or _' });
        if (pass.length < 6 || pass.length > 128) return send({ type: 'auth', ok: false, error: 'Password must be at least 6 characters.' });
        if (m.type === 'register') {
          if (this.data.users[user]) return send({ type: 'auth', ok: false, error: 'That name is already taken.' });
          this.data.users[user] = { hash: await this.o.hasher.hash(pass), created: Date.now(), chars: [] };
          this.markDirty();
        } else {
          const u = this.data.users[user];
          if (!u || !(await this.o.hasher.verify(pass, u.hash))) return send({ type: 'auth', ok: false, error: 'Wrong username or password.' });
        }
        const token = this.o.hasher.token();
        this.data.sessions[token] = { user, exp: Date.now() + 7 * 864e5 };
        c.user = user;
        this.markDirty();
        send({ type: 'auth', ok: true, token, user });
        return;
      }
      case 'resume': {
        const sess = this.data.sessions[String(m.token)];
        if (!sess || sess.exp < Date.now() || !this.data.users[sess.user]) return send({ type: 'auth', ok: false, error: 'Session expired — please log in.' });
        c.user = sess.user;
        send({ type: 'auth', ok: true, token: m.token, user: sess.user });
        return;
      }
    }
    if (!c.user) return send({ type: 'auth', ok: false, error: 'Not logged in.' });
    const u = this.data.users[c.user];
    if (!u) return;
    switch (m.type) {
      case 'chars': send({ type: 'chars', list: u.chars.map(summary) }); return;
      case 'createChar': {
        const name = sanitizeName(String(m.name ?? ''));
        if (name.length < 3) return send({ type: 'charError', error: 'Name must be 3–16 characters.' });
        if (!CLASSES.some((k) => k.id === m.cls)) return send({ type: 'charError', error: 'Unknown class.' });
        if (u.chars.length >= 4) return send({ type: 'charError', error: 'Four characters per account in this build.' });
        const taken = Object.values(this.data.users).some((uu) => uu.chars.some((ch) => ch.name.toLowerCase() === name.toLowerCase())) || BOT_NAMES.includes(name);
        if (taken) return send({ type: 'charError', error: 'That name already walks this world.' });
        const ap = m.appearance ?? ({} as Appearance);
        const appearance: Appearance = { tint: clampInt(ap.tint, 0, 0xffffff, 0xffffff), accent: clampInt(ap.accent, 0, 0xffffff, 0x3fd0ff), headgear: !!ap.headgear, cape: ap.cape !== false, scale: clamp(Number(ap.scale) || 1, 0.92, 1.08), body: ap.body === 'f' ? 'f' : 'm' };
        const ch: CharRecord = { id: this.o.hasher.token().slice(0, 12), name, cls: m.cls, level: 1, xp: 0, gold: 10, appearance, created: Date.now(), inventory: [], quests: [], sparks: [], deeds: [], kills: 0, deaths: 0, counters: {} };
        u.chars.push(ch);
        this.markDirty();
        send({ type: 'chars', list: u.chars.map(summary) });
        return;
      }
      case 'deleteChar': {
        u.chars = u.chars.filter((ch) => ch.id !== m.id);
        this.markDirty();
        send({ type: 'chars', list: u.chars.map(summary) });
        return;
      }
      case 'join': {
        const ch = u.chars.find((x) => x.id === m.charId);
        if (!ch) return send({ type: 'charError', error: 'Character not found.' });
        if (c.player) this.removePlayer(c.player);
        for (const p of this.players.values()) if (p.char.id === ch.id && p.conn) { p.conn.send({ type: 'kick', reason: 'Logged in elsewhere.' }); this.removePlayer(p); }
        const p = this.addPlayer(c.conn, c.user, ch);
        c.player = p;
        return;
      }
    }
    const p = c.player;
    if (!p) return;
    this.handlePlayerMsg(p, m, now);
  }

  private handlePlayerMsg(p: Player, m: C2S, now: number) {
    switch (m.type) {
      case 'input': {
        if (p.inputs.length > 120) return; // flood guard
        const dt = Number(m.dt);
        if (!(dt > 0 && dt <= 0.05)) return;
        if (m.seq <= p.lastSeq) return;
        p.inputs.push({ seq: m.seq | 0, mx: clamp(+m.mx || 0, -1, 1), mz: clamp(+m.mz || 0, -1, 1), yaw: +m.yaw || 0, jump: !!m.jump, sprint: !!m.sprint, walk: !!m.walk, dt, dodge: !!m.dodge });
        return;
      }
      case 'attack': this.combat.basicAttack(p, +m.yaw || 0, m.target, now); return;
      case 'parry': this.combat.parry(p, now); return;
      case 'resync': p.known.clear(); return;
      case 'allocStat': this.progress.allocStat(p, String(m.attr), Number(m.n ?? 1)); return;
      case 'resetStats': this.progress.resetStats(p); return;
      case 'rankSkill': this.progress.rankSkill(p, String(m.skill)); return;
      case 'advance': this.progress.advance(p, String(m.adv)); return;
      case 'setTitle': this.progress.setTitle(p, m.title ? String(m.title) : null); return;
      case 'cast': this.combat.startCast(p, String(m.spell), m.target, +m.yaw || 0, m.aimX !== undefined ? { x: +m.aimX!, y: +m.aimY!, z: +m.aimZ! } : undefined, now); return;
      case 'chat': {
        if (now - p.lastChat < 0.8) return;
        p.lastChat = now;
        const text = sanitizeChat(String(m.text ?? ''));
        if (!text) return;
        if (text.startsWith('/')) return this.command(p, text);
        this.broadcastNear(p.s.x, p.s.z, 200, { type: 'chat', from: p.name, text, channel: 'say' });
        return;
      }
      case 'talk': void this.talk(p, m.npc, sanitizeChat(String(m.text ?? '')), now); return;
      case 'interact': void this.talk(p, m.target, '', now); return;
      case 'respawn': if (p.dead) this.respawnPlayer(p); return;
      case 'equip':
      case 'unequip': {
        const before = p.char.equipment ?? {};
        let ok = true, error: string | undefined;
        if (m.type === 'equip') { const r = equip(p.char.cls, p.char.inventory, before, String(m.item ?? '')); ok = r.ok; error = r.reason; p.char.equipment = r.eq; }
        else if ((SLOTS as string[]).includes(String(m.slot))) p.char.equipment = unequip(before, m.slot as Slot);
        else { ok = false; error = 'unknown slot'; }
        if (ok) {
          const hpFrac = p.hp / p.mhp, mpFrac = p.mp / p.stats.maxMp;
          p.stats = this.statsOf(p.char); p.mhp = p.stats.maxHp; p.hp = Math.max(1, Math.round(p.mhp * hpFrac)); p.mp = Math.round(p.stats.maxMp * mpFrac);
          this.markDirty();
        }
        p.conn?.send({ type: 'equipment', equipment: (p.char.equipment ?? {}) as Record<string, string>, inventory: p.char.inventory, ok, error });
        return;
      }
    }
  }

  private command(p: Player, text: string) {
    const [cmd, arg] = text.slice(1).split(/\s+/, 2);
    const sys = (t: string) => p.conn?.send({ type: 'chat', from: 'System', text: t, channel: 'system' });
    if (cmd === 'who') return sys(`${[...this.players.values()].filter((x) => x.type === 'p').length} player(s), ${[...this.players.values()].filter((x) => x.type === 'b').length} adventurer bot(s) in the zone.`);
    if (cmd === 'where') { const poi = poiAt(p.s.x, p.s.z); return sys(`${poi ? poi.name : 'Ancient Forest'} (${p.s.x.toFixed(0)}, ${p.s.z.toFixed(0)})`); }
    if (!this.o.dev) return sys('Commands: /who, /where');
    if (cmd === 'time') { const h = clamp(Number(arg), 0, 24); this.worldTime = h; return sys(`World time set to ${h}:00.`); }
    if (cmd === 'weather' && (arg === 'clear' || arg === 'rain' || arg === 'storm')) { this.weather = arg; this.weatherUntil = this.o.now() + 600; return sys(`Weather: ${arg}.`); }
    if (cmd === 'tp') { const poi = POIS.find((x) => x.id === arg); if (poi) { p.s = newCharState(poi.x + 2, poi.z + 2, p.s.yaw); p.inputs.length = 0; } return; }
    if (cmd === 'xp') { this.giveXp(p, Number(arg) || 100); return; }
    sys('Dev commands: /time H, /weather clear|rain|storm, /tp poi, /xp N, /who, /where');
  }

  /** Class/level stats plus equipped item bonuses (the server is the only place this is computed). */
  statsOf(ch: CharRecord): Stats {
    const st = statsFor(ch.cls, ch.level, ch.attrs ?? {}, ch.adv);
    const b = equipBonus(ch.equipment ?? {});
    return { ...st, atk: st.atk + b.atk, mag: st.mag + b.mag, def: st.def + b.def, maxHp: st.maxHp + b.hp, maxMp: st.maxMp + b.mp };
  }
  /** Recompute stats after attributes/equipment/advanced class change, keeping HP/MP fractions. */
  refreshStats(p: Player) {
    const hpFrac = p.hp / Math.max(1, p.mhp), mpFrac = p.mp / Math.max(1, p.stats.maxMp);
    p.stats = this.statsOf(p.char); p.mhp = p.stats.maxHp; p.hp = Math.max(1, Math.round(p.mhp * hpFrac)); p.mp = Math.round(p.stats.maxMp * mpFrac);
    this.markDirty();
  }

  // ------------------------------------------------------------------ entities
  private addPlayer(conn: Conn | null, user: string, ch: CharRecord, bot?: BotBrain): Player {
    const id = this.nextId++;
    ensureKit(ch);
    ch.counters = ch.counters ?? {};
    const st = this.statsOf(ch);
    const s = newCharState(SPAWN.x + (this.rnd() - 0.5) * 4, SPAWN.z + (this.rnd() - 0.5) * 3, SPAWN.yaw);
    const cls = classById(ch.cls);
    const p: Player = {
      id, type: bot ? 'b' : 'p', s, hp: st.maxHp, mhp: st.maxHp, anim: 'idle', animUntil: 0, name: ch.name, model: cls.id, dead: false, stunUntil: 0, level: ch.level,
      conn, user, char: ch, stats: st, mp: st.maxMp, cds: {}, inputs: [], budget: new InputBudget(this.o.now()), lastSeq: 0, known: new Set(), casting: null,
      attackReadyAt: 0, lastHurt: -99, poi: null, streak: 0, lastChat: 0, lastTalk: 0, brain: bot, respawnAt: 0, joinedAt: this.o.now(),
      st: newStatus(), zone: ch.zone ?? 'capital', combo: { n: 0, last: 0 }, parryCd: 0, weakUntil: 0,
    };
    this.ents.set(id, p);
    this.players.set(id, p);
    if (!bot) {
      this.ensureStarterQuest(p);
      conn!.send({ type: 'joined', id, t: this.o.now(), worldTime: this.worldTime, weather: this.weather, char: summary(ch), self: this.selfState(p), inventory: ch.inventory, quests: ch.quests.map(questView), equipment: ch.equipment as Record<string, string> });
      this.broadcastNear(s.x, s.z, 300, { type: 'chat', from: 'World', text: `${ch.name} the ${cls.name} has arrived at the Gate of Dawn.`, channel: 'world' }, id);
      this.progress.send(p);
      this.progress.award(p, 'newcomer');
      this.progress.checkTitles(p);
    }
    return p;
  }
  private removePlayer(p: Player) {
    this.ents.delete(p.id);
    this.players.delete(p.id);
    this.markDirty();
  }
  private spawnBot(i: number) {
    const roles: ClassId[] = ['mage', 'warrior', 'archer', 'knight', 'healer', 'assassin'];
    const role = roles[i % roles.length];
    const ch: CharRecord = { id: 'bot' + i, name: BOT_NAMES[i % BOT_NAMES.length], cls: role, level: 4 + (i % 3) * 3, xp: 0, gold: 0, created: 0, inventory: [], quests: [], sparks: [], deeds: [], kills: 0, deaths: 0, counters: {},
      appearance: { tint: [0xffffff, 0xffe2c8, 0xd8f0ff, 0xf0d8ff][i % 4], accent: [0x3fd0ff, 0xff7a3f, 0x8dff9a, 0xffd23f][i % 4], headgear: i % 2 === 0, cape: true, scale: 1, body: i % 2 ? 'f' : 'm' } };
    this.addPlayer(null, 'bot', ch, { role, goal: null, target: 0, retreat: false, nextThink: 0, nextChat: this.o.now() + 30 + i * 20 });
  }
  spawnMonster(kind: MonsterKind, x: number, z: number, zone = 'capital'): Monster {
    const def = MONSTERS[kind];
    const id = this.nextId++;
    const m: Monster = { id, type: 'm', s: newCharState(x, z, this.rnd() * 6.28), hp: def.hp, mhp: def.hp, anim: 'idle', animUntil: 0, name: def.name, model: def.kind, dead: false, stunUntil: 0, level: def.level, st: newStatus(), zone,
      def, home: { x, z }, ai: 'idle', target: 0, nextAttack: 0, wander: null, aiTimer: this.rnd() * 3, respawnAt: 0, fleeUntil: 0, lastHitBy: 0, threat: new Map() };
    this.ents.set(id, m);
    return m;
  }
  private spawnNpc(def: NpcDef) {
    const id = this.nextId++;
    const n: Npc = { id, type: 'n', s: newCharState(def.work.x, def.work.z, def.work.yaw ?? 0), hp: 1, mhp: 1, anim: 'idle', animUntil: 0, name: def.name, model: def.key, dead: false, stunUntil: 0, level: 30, st: newStatus(), zone: 'capital',
      def, bt: npcTree(this), talkTo: 0, talkUntil: 0, patrolIdx: 0, hidden: false, goal: null };
    this.ents.set(id, n);
  }

  // ------------------------------------------------------------------ main loop
  tick() {
    const now = this.o.now();
    const dt = clamp(now - this.lastTick, 0, 0.25);
    this.lastTick = now;
    this.tickN++;
    this.worldTime = (this.worldTime + (dt * 24) / this.DAY_SECONDS) % 24;
    if (now > this.weatherUntil) {
      const r = this.rnd();
      this.weather = this.weather === 'clear' ? (r < 0.65 ? 'rain' : 'storm') : r < 0.75 ? 'clear' : 'rain';
      this.weatherUntil = now + (this.weather === 'clear' ? 300 + this.rnd() * 300 : 150 + this.rnd() * 150);
      this.broadcastAll({ type: 'notice', text: this.weather === 'clear' ? 'The clouds part over the Ancient Forest.' : this.weather === 'storm' ? 'A storm rolls down from the Tower…' : 'Rain begins to fall.', style: 'info' });
    }
    for (const p of this.players.values()) this.tickPlayer(p, now, dt);
    for (const e of [...this.ents.values()]) {
      if (!e.dead) this.combat.tickStatus(e, now);
      if (e.type === 'm') this.tickMonster(e as Monster, now, dt);
      else if (e.type === 'n') this.tickNpc(e as Npc, now, dt);
      else if (e.type === 's') this.combat.tickSummon(e as Summon, now, dt);
    }
    this.tickProjectiles(now, dt);
    this.sendSnapshots(now);
    if (this.dirty && now - this.lastSave > 5) this.flush();
  }

  private tickPlayer(p: Player, now: number, dt: number) {
    if (p.dead) {
      if (p.type === 'b' && now > p.respawnAt) this.respawnPlayer(p);
      p.inputs.length = 0;
      return;
    }
    if (p.brain) this.botThink(p, now, dt);
    // consume inputs within the real-time budget (anti speed-hack)
    let consumed = 0;
    while (p.inputs.length) {
      const inp = p.inputs[0];
      if (!p.brain && !p.budget.take(now, inp.dt)) break;
      p.inputs.shift();
      const mul = this.moveMulOf(p, now);
      stepCharacter(p.s, inp, mul);
      p.lastSeq = inp.seq;
      if (++consumed > 30) break;
    }
    if (p.inputs.length > 30) p.inputs.splice(0, p.inputs.length - 30); // drop stale backlog
    // anim state for others
    const sp = Math.hypot(p.s.vx, p.s.vz);
    if ((p.s.dg ?? 0) > 0) p.anim = 'roll';
    else if (now > p.animUntil) p.anim = !p.s.grounded && !p.s.swimming ? (p.s.vy > 0 ? 'jump' : 'fall') : p.s.swimming ? 'swim' : sp > 4.8 ? 'sprint' : sp > 2.2 ? 'run' : sp > 0.25 ? 'walk' : 'idle';
    if (p.casting) {
      p.anim = 'cast';
      if (now >= p.casting.until) this.combat.finishCast(p, now);
    }
    // regen
    const outOfCombat = now - p.lastHurt > 6;
    p.mp = Math.min(p.stats.maxMp, p.mp + dt * (outOfCombat ? 6 : 2.5) * p.stats.mpRegen);
    p.hp = Math.min(p.mhp, p.hp + dt * (outOfCombat ? p.mhp * 0.025 : 0));
    // fell out of the world? (should never happen; belt and braces)
    if (p.s.y < heightAt(p.s.x, p.s.z) - 2 || !isFinite(p.s.x)) { p.s = newCharState(SPAWN.x, SPAWN.z); }
    // points of interest → quests / sparks
    if (this.tickN % 5 === 0) {
      const poi = poiAt(p.s.x, p.s.z);
      if ((poi?.id ?? null) !== p.poi) {
        p.poi = poi?.id ?? null;
        if (poi) this.onVisit(p, poi);
      }
      if (poi?.id === 'lake' && this.worldTime >= 5.6 && this.worldTime <= 6.6) this.spark(p, 'lake_dawn');
    }
  }

  /** The exact speed multiplier used to simulate this player's inputs (sent to the client as SelfState.sm). */
  moveMulOf(p: Player, now: number) { return Math.round((p.casting ? 0.35 : 1) * this.combat.moveMul(p, now) * classById(p.char.cls).spd * p.stats.spd * 1000) / 1000; }

  // ------------------------------------------------------------------ combat (skills live in combat.ts)
  onCast(p: Player, spell: string) { this.onCastQuest(p, spell, poiAt(p.s.x, p.s.z)); }

  private tickProjectiles(now: number, dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const owner = this.players.get(pr.owner);
      if (!owner) { this.projectiles.splice(i, 1); continue; }
      if (pr.homing) { // spirit bolts curve toward their target
        const t = this.ents.get(pr.homing);
        if (t && !t.dead) { const dx = t.s.x - pr.x, dy = t.s.y + 1 - pr.y, dz = t.s.z - pr.z, d = Math.hypot(dx, dy, dz) || 1; const k = Math.min(1, dt * 6); pr.dx += (dx / d - pr.dx) * k; pr.dy += (dy / d - pr.dy) * k; pr.dz += (dz / d - pr.dz) * k; const l = Math.hypot(pr.dx, pr.dy, pr.dz) || 1; pr.dx /= l; pr.dy /= l; pr.dz /= l; }
      }
      const step = pr.speed * dt;
      const hitWorld = raycastWorld(pr.x, pr.y, pr.z, pr.dx, pr.dy, pr.dz, step, new Set(['bound']));
      let hit = hitWorld < step;
      let adv = Math.min(step, hitWorld);
      for (const e of this.ents.values()) {
        if (!this.combat.isEnemy(owner, e) || e.zone !== owner.zone) continue;
        const ex = e.s.x - pr.x, ey = e.s.y + 1 - pr.y, ez = e.s.z - pr.z;
        const t = clamp(ex * pr.dx + ey * pr.dy + ez * pr.dz, 0, adv);
        const cx = pr.x + pr.dx * t - e.s.x, cy = pr.y + pr.dy * t - (e.s.y + 1), cz = pr.z + pr.dz * t - e.s.z;
        const rr = (e as Monster).def?.scale ? 1.0 * (e as Monster).def.scale! : 1.0;
        if (cx * cx + cy * cy + cz * cz < rr * rr) { hit = true; adv = t; break; }
      }
      pr.x += pr.dx * adv; pr.y += pr.dy * adv; pr.z += pr.dz * adv; pr.left -= adv;
      if (hit || pr.left <= 0) {
        this.projectiles.splice(i, 1);
        this.broadcastNear(pr.x, pr.z, 220, { type: 'fx', kind: 'hit', spell: pr.spell, x: pr.x, y: pr.y, z: pr.z });
        const sp = spellById(pr.spell);
        if (sp) this.combat.areaHit(owner, sp, pr.power, pr.stat, pr.x, pr.y, pr.z, now);
      }
    }
  }

  kill(src: Ent, dst: Ent, now: number) {
    if (dst.dead) return;
    dst.hp = 0;
    dst.dead = true;
    dst.anim = 'death';
    dst.st.dots = []; dst.st.hots = [];
    this.broadcastNear(dst.s.x, dst.s.z, 200, { type: 'fx', kind: 'death', src: src.id, dst: dst.id, x: dst.s.x, y: dst.s.y, z: dst.s.z });
    const killer = this.combat.ownerOf(src) ?? src;
    if (dst.type === 's') { this.removeEnt(dst.id); return; }
    if (dst.type === 'm') {
      const m = dst as Monster;
      m.respawnAt = now + (m.def.boss ? 240 : 22 + this.rnd() * 10);
      m.enraged = false;
      // XP to everyone who did damage (party-friendly), killer gets loot
      for (const [pid] of m.threat) {
        const p = this.players.get(pid);
        if (!p || p.dead) continue;
        this.giveXp(p, m.def.xp * (pid === killer.id ? 1 : 0.6));
        this.progress.addRep(p, m.def.faction ?? 'capital', m.def.boss ? 60 : 3);
        if (pid === killer.id) this.onKill(p, m, now);
        if (m.def.boss) { p.char.counters.bosses = (p.char.counters.bosses ?? 0) + 1; this.progress.checkTitles(p); }
      }
      if (m.def.boss) this.broadcastAll({ type: 'chat', from: 'World', text: `${killer.name} and allies have slain ${m.def.name}!`, channel: 'world' });
      m.threat.clear();
      this.onMonsterKilled(m, killer, now);
    } else {
      const p = dst as Player;
      p.casting = null;
      p.char.deaths++;
      p.streak = 0;
      p.respawnAt = now + 8;
      for (const s of [...this.ents.values()]) if (s.type === 's' && (s as Summon).owner === p.id) this.removeEnt(s.id);
      const pen = p.type === 'p' ? this.combat.deathPenalty(p) : { xpLost: 0, goldLost: 0 };
      p.conn?.send({ type: 'died', by: src.name, xpLost: pen.xpLost, goldLost: pen.goldLost, at: this.shrineName(p), wait: 8 });
      this.progress.checkTitles(p);
      this.markDirty();
    }
  }
  /** hook for later systems (world bosses, tower, quests) */
  onMonsterKilled(m: Monster, killer: Ent, now: number) { void m; void killer; void now; }

  /** Where a fallen player comes back (the last shrine they touched). */
  shrineName(p: Player) { void p; return 'the Gate of Dawn shrine'; }
  shrinePos(p: Player): { x: number; z: number; yaw: number } { void p; return SPAWN; }

  private respawnPlayer(p: Player) {
    p.dead = false;
    p.hp = Math.round(p.mhp * 0.6);
    p.mp = Math.round(p.stats.maxMp * 0.5);
    const sp = this.shrinePos(p);
    p.s = newCharState(sp.x + (this.rnd() - 0.5) * 4, sp.z + (this.rnd() - 0.5) * 3, sp.yaw);
    p.inputs.length = 0;
    p.anim = 'idle';
    p.st = newStatus();
    p.stunUntil = 0;
    // soul-weary: −15 % damage dealt and +10 % taken for 60 s (see combat.damage)
    if (p.type === 'p') { p.weakUntil = this.o.now() + 60; p.st.buffs.push({ atk: -0.15, def: -0.1, mag: -0.15, spd: 0, crit: 0, lifesteal: 0, until: this.o.now() + 60, src: 'soulweary' }); p.conn?.send({ type: 'notice', text: 'Soul-Weary: weaker for 60 s', style: 'warn' }); }
  }
  /** Brought back on the spot by an ally (Resurrection). */
  revivePlayer(p: Player, frac: number) {
    p.dead = false; p.hp = Math.round(p.mhp * frac); p.anim = 'idle'; p.st = newStatus(); p.inputs.length = 0;
    p.conn?.send({ type: 'notice', text: 'You were revived!', style: 'levelup' });
  }

  private giveXp(p: Player, amount: number) {
    const before = p.char.level;
    const r = grantXp(p.char.level, p.char.xp, amount);
    p.char.level = r.level; p.char.xp = r.xp; p.level = r.level;
    if (r.gained > 0) {
      p.stats = this.statsOf(p.char);
      p.mhp = p.stats.maxHp; p.hp = p.mhp; p.mp = p.stats.maxMp;
      this.broadcastNear(p.s.x, p.s.z, 200, { type: 'fx', kind: 'levelup', src: p.id, x: p.s.x, y: p.s.y, z: p.s.z, amount: p.char.level });
      p.conn?.send({ type: 'notice', text: `LEVEL ${p.char.level}`, style: 'levelup' });
      this.worldEvent(`${p.name} reached level ${p.char.level}`);
      const unlocked = SKILLS.filter((s) => s.cls === p.char.cls && s.unlock > before && s.unlock <= p.char.level && s.slot !== 5);
      for (const s of unlocked) p.conn?.send({ type: 'notice', text: `New skill: ${s.name} · ${s.title}`, style: 'rank' });
      if (p.char.level >= 20 && before < 20) p.conn?.send({ type: 'notice', text: 'Advanced classes unlocked — open the Hero panel (P)', style: 'rank' });
      this.progress.send(p);
      this.progress.checkTitles(p);
    }
    if (before !== p.char.level || amount > 0) this.markDirty();
  }

  // ------------------------------------------------------------------ monster AI (state machine)
  private tickMonster(m: Monster, now: number, dt: number) {
    if (m.dead) {
      if (m.noRespawn) { if (now > m.respawnAt - 15) this.removeEnt(m.id); return; }
      if (now > m.respawnAt) {
        m.dead = false; m.hp = m.mhp; m.s = newCharState(m.home.x + (this.rnd() - 0.5) * 8, m.home.z + (this.rnd() - 0.5) * 8); m.ai = 'idle'; m.anim = 'spawn'; m.animUntil = now + 1.6; m.st = newStatus(); m.enraged = false;
      }
      return;
    }
    if (!this.zoneActive(m.zone)) return; // nobody here: the zone sleeps
    const night = this.isNight();
    const aggroR = m.def.aggro * (night ? 1.25 : 1) * (this.weather !== 'clear' ? 0.85 : 1);
    let mx = 0, mz = 0, yaw = m.s.yaw, walk = false;
    let tgt = m.target ? this.ents.get(m.target) : undefined;
    if (tgt && (tgt.dead || tgt.zone !== m.zone || !(tgt.type === 'p' || tgt.type === 'b' || tgt.type === 's'))) { tgt = undefined; m.target = 0; }
    const stunned = now < m.stunUntil;
    const rooted = now < m.st.rootUntil;
    m.aiTimer -= dt;
    const homeD = Math.hypot(m.s.x - m.home.x, m.s.z - m.home.z);
    const leash = m.def.boss ? 70 : 45;
    // threat: every second, the monster turns on whoever hurt it most (unless taunted)
    if (m.threat.size && this.tickN % 20 === m.id % 20 && now > m.st.tauntUntil) {
      let best = 0, bv = -1;
      for (const [id, v] of m.threat) { const e = this.ents.get(id); if (!e || e.dead || e.zone !== m.zone) { m.threat.delete(id); continue; } if (v > bv) { bv = v; best = id; } }
      if (best && (m.ai === 'chase' || m.ai === 'attack')) m.target = best;
    }
    if (m.def.boss && !stunned) this.bossTick(m, now);
    switch (m.ai) {
      case 'idle':
      case 'patrol': {
        if (m.aiTimer <= 0 || this.tickN % 4 === 0) {
          let best: Ent | null = null, bd = aggroR;
          for (const p of this.ents.values()) {
            if (p.dead || p.zone !== m.zone || !(p.type === 'p' || p.type === 'b' || p.type === 's')) continue;
            const d = Math.hypot(p.s.x - m.s.x, p.s.z - m.s.z);
            if (d < bd && hasLineOfSight(m.s.x, m.s.y + 1.5, m.s.z, p.s.x, p.s.y + 1.5, p.s.z)) { bd = d; best = p; }
          }
          if (best) { m.ai = 'chase'; m.target = best.id; m.anim = 'taunt'; m.animUntil = now + 0.6; break; }
        }
        if (m.ai === 'idle' && m.aiTimer <= 0) { m.ai = 'patrol'; m.wander = { x: m.home.x + (this.rnd() - 0.5) * 18, z: m.home.z + (this.rnd() - 0.5) * 18 }; m.aiTimer = 6 + this.rnd() * 6; }
        if (m.ai === 'patrol' && m.wander) {
          const dx = m.wander.x - m.s.x, dz = m.wander.z - m.s.z, d = Math.hypot(dx, dz);
          if (d < 1 || m.aiTimer <= 0) { m.ai = 'idle'; m.wander = null; m.aiTimer = 2 + this.rnd() * 4; }
          else { yaw = Math.atan2(-dx, -dz); mz = 1; walk = true; }
        }
        break;
      }
      case 'chase':
      case 'attack': {
        if (!tgt || tgt.dead || homeD > leash) { m.ai = 'return'; m.target = 0; break; }
        if (m.hp < m.mhp * 0.2 && m.def.kind === 'minion' && now > m.fleeUntil + 20) { m.ai = 'flee'; m.fleeUntil = now + 3.5; break; }
        const dx = tgt.s.x - m.s.x, dz = tgt.s.z - m.s.z, d = Math.hypot(dx, dz);
        yaw = Math.atan2(-dx, -dz);
        const reach = m.def.attackRange + (m.def.scale ? (m.def.scale - 1) * 0.8 : 0);
        const inRange = d <= reach && (!m.def.ranged || hasLineOfSight(m.s.x, m.s.y + 1.5, m.s.z, tgt.s.x, tgt.s.y + 1.2, tgt.s.z));
        if (inRange) {
          m.ai = 'attack';
          if (m.def.ranged && d < 5) { mz = -0.6; } // kite
          if (now >= m.nextAttack && !stunned) {
            m.nextAttack = now + m.def.attackCd * (m.enraged ? 0.7 : 1);
            m.anim = m.def.ranged ? 'castshoot' : 'attack';
            m.animUntil = now + 0.8;
            this.broadcastNear(m.s.x, m.s.z, 150, { type: 'fx', kind: 'attack', src: m.id, dst: tgt.id, x: m.s.x, y: m.s.y, z: m.s.z, spell: m.def.ranged ? 'bolt' : undefined });
            const target = tgt;
            const windup = m.def.ranged ? 650 : 480;
            setTimeout(() => {
              const t2 = this.o.now();
              if (m.dead || target.dead || t2 < m.stunUntil) return;
              const dd = Math.hypot(target.s.x - m.s.x, target.s.z - m.s.z);
              if (dd <= reach + 1.2) this.combat.damage(m, target, m.def.atk, 1, m.def.ranged ? (m.def.element ?? 'darkness') : 'physical', t2, { melee: !m.def.ranged });
            }, windup);
          }
        } else { m.ai = 'chase'; mz = 1; }
        break;
      }
      case 'flee': {
        if (!tgt || now > m.fleeUntil) { m.ai = tgt ? 'chase' : 'return'; break; }
        const dx = m.s.x - tgt.s.x, dz = m.s.z - tgt.s.z;
        yaw = Math.atan2(-dx, -dz); mz = 1;
        break;
      }
      case 'return': {
        const dx = m.home.x - m.s.x, dz = m.home.z - m.s.z, d = Math.hypot(dx, dz);
        m.hp = Math.min(m.mhp, m.hp + m.mhp * 0.3 * dt);
        if (d < 2) { m.ai = 'idle'; m.aiTimer = 2; m.threat.clear(); }
        else { yaw = Math.atan2(-dx, -dz); mz = 1; }
        break;
      }
    }
    if (stunned || rooted) { mz = 0; mx = 0; }
    if (mz !== 0) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const ahead = raycastWorld(m.s.x, m.s.y + 0.8, m.s.z, fx, 0, fz, 2.2, undefined);
      if (ahead < 2.2) yaw += (m.id % 2 ? 1 : -1) * 0.9;
    }
    const slow = now < m.st.slowUntil ? m.st.slowMul : 1;
    const speedMul = (walk ? 0.45 : 1) * (m.def.speed / PHYS.RUN) * (m.ai === 'flee' ? 1.15 : 1) * slow * (m.enraged ? 1.2 : 1);
    stepSub(m.s, { seq: 0, mx, mz, yaw, jump: false, sprint: false, walk: false, dt }, speedMul);
    if (mz === 0 && mx === 0 && m.ai === 'attack' && tgt) m.s.yaw = Math.atan2(-(tgt.s.x - m.s.x), -(tgt.s.z - m.s.z));
    if (now > m.animUntil) {
      const sp = Math.hypot(m.s.vx, m.s.vz);
      m.anim = stunned ? 'hit' : sp > 1.8 ? 'run' : sp > 0.3 ? 'walk' : m.ai === 'attack' ? 'combat' : 'idle';
    }
  }

  /** Field/tower bosses: enrage under 30 % HP and a telegraphed special every few seconds
   *  (slam = ring around the boss, volley = bolts at everyone near, summon = adds, charge = rush). */
  private bossTick(m: Monster, now: number) {
    if (!m.enraged && m.hp < m.mhp * 0.3 && m.def.specials?.includes('enrage')) {
      m.enraged = true;
      this.broadcastNear(m.s.x, m.s.z, 200, { type: 'notice', text: `${m.def.name} is ENRAGED!`, style: 'warn' });
    }
    if (m.ai !== 'attack' && m.ai !== 'chase') return;
    if (now < (m.specialAt ?? 0)) return;
    m.specialAt = now + (m.enraged ? 6 : 9) + this.rnd() * 3;
    const sp = (m.def.specials ?? []).filter((s) => s !== 'enrage');
    if (!sp.length) return;
    const kind = sp[Math.floor(this.rnd() * sp.length)];
    const R = kind === 'slam' ? 7 : kind === 'breath' ? 11 : 0;
    m.anim = 'castshoot'; m.animUntil = now + 1.3;
    // telegraph: the client draws the danger zone; damage lands after 1.2 s (dodge it!)
    this.broadcastNear(m.s.x, m.s.z, 200, { type: 'fx', kind: 'cast', src: m.id, spell: 'boss_' + kind, x: m.s.x, y: m.s.y, z: m.s.z, amount: R, text: kind });
    const yaw0 = m.s.yaw;
    setTimeout(() => {
      const t2 = this.o.now();
      if (m.dead) return;
      const victims = [...this.ents.values()].filter((e) => !e.dead && e.zone === m.zone && (e.type === 'p' || e.type === 'b' || e.type === 's'));
      if (kind === 'slam' || kind === 'breath') {
        this.broadcastNear(m.s.x, m.s.z, 200, { type: 'fx', kind: 'spell', src: m.id, spell: 'boss_' + kind, x: m.s.x, y: m.s.y, z: m.s.z, amount: R });
        const fx = -Math.sin(yaw0), fz = -Math.cos(yaw0);
        for (const v of victims) {
          const dx = v.s.x - m.s.x, dz = v.s.z - m.s.z, d = Math.hypot(dx, dz);
          if (d > R) continue;
          if (kind === 'breath' && (dx * fx + dz * fz) / Math.max(d, 0.01) < 0.5) continue;
          if (this.combat.damage(m, v, m.def.atk, 1.8, kind === 'breath' ? (m.def.element ?? 'fire') : 'earth', t2, {})) this.combat.hostileEffects(m, v, { knock: 3, stun: kind === 'slam' ? 0.6 : 0 }, t2, m.def.atk);
        }
      } else if (kind === 'volley') {
        for (const v of victims) if (Math.hypot(v.s.x - m.s.x, v.s.z - m.s.z) < 28) {
          this.broadcastNear(m.s.x, m.s.z, 200, { type: 'fx', kind: 'attack', src: m.id, dst: v.id, x: m.s.x, y: m.s.y, z: m.s.z, spell: 'bolt' });
          this.combat.damage(m, v, m.def.atk, 0.9, m.def.element ?? 'darkness', t2, {});
        }
      } else if (kind === 'summon' && m.def.adds) {
        const alive = [...this.ents.values()].filter((e) => e.type === 'm' && (e as Monster).summonedBy === m.id && !e.dead).length;
        for (let i = alive; i < 3; i++) { const a = this.spawnMonster(m.def.adds, m.s.x + (this.rnd() - 0.5) * 8, m.s.z + (this.rnd() - 0.5) * 8, m.zone); a.summonedBy = m.id; a.noRespawn = true; a.ai = 'chase'; a.target = m.target; }
      } else if (kind === 'charge') {
        const t = this.ents.get(m.target);
        if (t && !t.dead) {
          const dx = t.s.x - m.s.x, dz = t.s.z - m.s.z, d = Math.hypot(dx, dz) || 1;
          const fx0 = m.s.x, fz0 = m.s.z;
          sweepDash(m.s, (dx / d) * Math.max(0, d - 1.5), (dz / d) * Math.max(0, d - 1.5));
          this.broadcastNear(m.s.x, m.s.z, 200, { type: 'fx', kind: 'dash', src: m.id, spell: 'boss_charge', x: fx0, y: m.s.y, z: fz0, tx: m.s.x, ty: m.s.y, tz: m.s.z });
          for (const v of victims) if (Math.hypot(v.s.x - m.s.x, v.s.z - m.s.z) < 3.5) this.combat.damage(m, v, m.def.atk, 1.5, 'physical', t2, { melee: true });
        }
      }
    }, 1200);
  }

  // ------------------------------------------------------------------ NPCs (behaviour trees + routines)
  private tickNpc(n: Npc, now: number, dt: number) {
    n.bt.tick(n, dt);
    let mx = 0, mz = 0, yaw = n.s.yaw;
    if (n.goal) {
      const dx = n.goal.x - n.s.x, dz = n.goal.z - n.s.z, d = Math.hypot(dx, dz);
      if (d > 0.6) { yaw = Math.atan2(-dx, -dz); mz = 1; }
      else if (n.goal.yaw !== undefined) n.s.yaw = n.goal.yaw;
    }
    if (n.talkTo && now < n.talkUntil) {
      const p = this.players.get(n.talkTo);
      if (p) { mz = 0; n.s.yaw = Math.atan2(-(p.s.x - n.s.x), -(p.s.z - n.s.z)); }
    }
    if (mz) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      if (raycastWorld(n.s.x, n.s.y + 0.8, n.s.z, fx, 0, fz, 1.6) < 1.6) yaw += 0.8;
    }
    stepSub(n.s, { seq: 0, mx, mz, yaw, jump: false, sprint: false, walk: true, dt }, 1.0);
    const sp = Math.hypot(n.s.vx, n.s.vz);
    if (n.talkTo && now < n.talkUntil) n.anim = 'talk';
    else if (sp > 0.3) n.anim = 'walk';
    else n.anim = n.goal?.anim ? animKey(n.goal.anim) : 'idle';
  }

  zoneActive(zone: string) { void zone; return true; }
  isNight() { return this.worldTime < 5.5 || this.worldTime > 19.5; }
  timeOfDay() { const h = this.worldTime; return h < 5.5 ? 'deep night' : h < 7 ? 'dawn' : h < 11 ? 'morning' : h < 15 ? 'midday' : h < 18.5 ? 'afternoon' : h < 20 ? 'dusk' : 'night'; }

  // ------------------------------------------------------------------ dialogue & memory
  private memory(npcKey: string, charId: string): NpcMemory {
    const byNpc = (this.data.npcMemory[npcKey] ??= {});
    return (byNpc[charId] ??= { met: 0, lastSeen: 0, short: [], long: [] });
  }

  async talk(p: Player, npcId: number, text: string, now: number) {
    const n = this.ents.get(npcId) as Npc | undefined;
    if (!n || n.type !== 'n' || n.hidden) return;
    if (Math.hypot(n.s.x - p.s.x, n.s.z - p.s.z) > 6) return p.conn?.send({ type: 'notice', text: 'Too far away to talk.', style: 'warn' });
    if (now - p.lastTalk < 1.5) return;
    p.lastTalk = now;
    n.talkTo = p.id; n.talkUntil = now + 12;
    const def = n.def;
    const mem = this.memory(def.key, p.char.id);
    const firstMeet = mem.met === 0;
    mem.met++; mem.lastSeen = Date.now();
    this.onTalk(p, def.key);
    if (text) mem.short.push({ who: 'player', text });
    let say = '', mood = 'neutral', source: 'llm' | 'scripted' = 'scripted';
    if (def.important && text && this.llm.enabled) {
      const pers = def.personality!;
      const quest = p.char.quests.find((q) => !q.complete);
      const sys = `You are ${def.name}, ${def.title}, an NPC in the anime-fantasy MMORPG "DOS: The Hundredth Sky" (a world beneath a mysterious 100-floor tower). Stay fully in character, never mention being an AI or a game.
Personality: ${pers.traits}. Speech: ${pers.speech}. Goal: ${pers.goal}. Secret (only hint at it if trust is high): ${pers.secret}. You know: ${pers.knows.join('; ')}.
Reply with ONLY JSON: {"say": "your spoken reply, max 60 words", "mood": "one word", "remember": "one short new fact about this player worth remembering, or empty"}`;
      const ctx = `WORLD MEMORY: it is ${this.timeOfDay()}, weather ${this.weather}. Recent events: ${this.data.worldEvents.slice(-4).join('; ') || 'quiet'}.
LONG-TERM MEMORY of this player: name ${p.name}, a level ${p.char.level} ${classById(p.char.cls).name}; met ${mem.met} times; kills ${p.char.kills}; deaths ${p.char.deaths}. ${mem.long.join('; ')}
Active quest: ${quest ? quest.title + ' (' + quest.rank + ')' : 'none'}.`;
      const history = mem.short.slice(-8).map((s) => ({ role: (s.who === 'player' ? 'user' : 'assistant') as 'user' | 'assistant', content: s.text }));
      const reply = parseJsonLoose<{ say?: string; mood?: string; remember?: string }>(await this.llm.ask(p.user, [{ role: 'system', content: sys }, { role: 'user', content: ctx }, ...history], { maxTokens: 220, temperature: 0.85, json: true }));
      if (reply?.say) {
        say = String(reply.say).slice(0, 420); mood = String(reply.mood ?? 'neutral').slice(0, 20); source = 'llm';
        if (reply.remember && String(reply.remember).length > 3) { mem.long.push(String(reply.remember).slice(0, 120)); if (mem.long.length > 12) mem.long.shift(); }
      }
    }
    if (!say) say = this.scriptedLine(def, p, mem, firstMeet, text);
    if (def.key === 'lyra' && /tower|floor|hundred/i.test(text)) this.spark(p, 'asked_tower');
    mem.short.push({ who: 'npc', text: say });
    if (mem.short.length > 16) mem.short.splice(0, mem.short.length - 16);
    this.markDirty();
    p.conn?.send({ type: 'npcSay', npc: n.id, name: def.name, text: say, mood, source });
  }

  private scriptedLine(def: NpcDef, p: Player, mem: NpcMemory, first: boolean, text: string): string {
    const pick = (a: string[]) => a[Math.floor(this.rnd() * a.length)] ?? '…';
    if (first) return pick(def.lines.greet);
    if (text && /quest|job|work|help|task/i.test(text) && def.lines.quest.length) return pick(def.lines.quest);
    if (p.char.kills > 0 && this.rnd() < 0.35 && def.lines.afterKill.length) return pick(def.lines.afterKill).replace('{name}', p.name);
    if (this.weather !== 'clear' && this.rnd() < 0.5) return pick(def.lines.rain);
    const base = pick(this.isNight() ? def.lines.night : def.lines.day);
    return mem.met > 2 && this.rnd() < 0.4 ? `${p.name}. ${base}` : base;
  }

  worldEvent(t: string) {
    this.data.worldEvents.push(`${t} (${this.timeOfDay()})`);
    if (this.data.worldEvents.length > 40) this.data.worldEvents.shift();
  }

  // ------------------------------------------------------------------ quests & the Story Director
  private ensureStarterQuest(p: Player) {
    if (p.char.quests.some((q) => q.id === 'starter')) return;
    p.char.quests.push({ id: 'starter', rank: 'F', title: 'Bones at the Gate', hook: 'Captain Aldric needs the forest road cleared.', reward: '60 XP · your name in the gate ledger', spark: 'starter', source: 'procedural', hidden: false, complete: false, current: 0, xp: 60,
      steps: [ { type: 'talk', target: 'aldric', count: 1, text: 'Speak with Captain Aldric at the Gate of Dawn.', progress: 0 }, { type: 'kill', target: 'minion', count: 5, text: 'Lay 5 Hollow Skeletons to rest along the forest road.', progress: 0 }, { type: 'talk', target: 'aldric', count: 1, text: 'Report back to Captain Aldric.', progress: 0 } ] });
  }

  spark(p: Player, sparkId: string) {
    if (p.type !== 'p' || p.char.sparks.includes(sparkId)) return;
    const spark = SPARKS[sparkId];
    if (!spark) return;
    p.char.sparks.push(sparkId);
    p.char.deeds.push(spark.text);
    if (p.char.deeds.length > 20) p.char.deeds.shift();
    this.markDirty();
    p.conn?.send({ type: 'notice', text: 'The world stirs… something has begun to watch you.', style: 'rank' });
    const ctx: DirectorContext = {
      playerName: p.name, cls: classById(p.char.cls).name, level: p.char.level, timeOfDay: this.timeOfDay(), weather: this.weather, deeds: p.char.deeds,
      npcMemories: ['aldric', 'lyra'].flatMap((k) => this.memory(k, p.char.id).long.map((l) => `${k}: ${l}`)), worldEvents: this.data.worldEvents,
    };
    const qid = 'q' + this.o.hasher.token().slice(0, 8);
    void generateQuest(this.llm, p.user, spark, ctx, qid, (this.rnd() * 1e9) | 0).then((q) => {
      p.char.quests.push(q);
      this.markDirty();
      p.conn?.send({ type: 'quest', quest: questView(q), event: 'discovered' });
      p.conn?.send({ type: 'notice', text: `Hidden Scenario discovered — Rank ${q.rank}`, style: 'rank' });
    });
  }

  private advance(p: Player, match: (s: Quest['steps'][number]) => boolean, amount = 1) {
    for (const q of p.char.quests) {
      if (q.complete) continue;
      const st = q.steps[q.current];
      if (!st || !match(st)) continue;
      st.progress += amount;
      if (st.progress >= st.count) {
        q.current++;
        if (q.hidden && q.current >= 1) q.hidden = false;
        if (q.current >= q.steps.length) {
          q.complete = true;
          this.giveXp(p, q.xp);
          p.char.gold += 25 * (1 + ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS', '???'].indexOf(q.rank));
          p.conn?.send({ type: 'notice', text: `Quest complete — ${q.title} (Rank ${q.rank})`, style: 'rank' });
          this.worldEvent(`${p.name} completed the ${q.rank}-rank scenario "${q.title}"`);
          p.conn?.send({ type: 'quest', quest: questView(q), event: 'complete' });
        } else p.conn?.send({ type: 'quest', quest: questView(q), event: 'step' });
      } else p.conn?.send({ type: 'quest', quest: questView(q), event: 'progress' });
      this.markDirty();
    }
  }
  private onKill(p: Player, m: Monster, now: number) {
    p.char.kills++;
    p.streak++;
    const poi = poiAt(m.s.x, m.s.z);
    if (m.def.kind !== 'minion') this.worldEvent(`${p.name} destroyed a ${m.def.name}${poi ? ' at ' + poi.name : ''}`);
    this.spark(p, 'first_blood');
    if (p.streak >= 10 && p.char.deaths === 0) this.spark(p, 'untouched_ten');
    this.advance(p, (s) => s.type === 'kill' && s.target === m.def.kind);
    if (p.type === 'p') {
      const loot = rollLoot(m.def.kind, [this.rnd(), this.rnd(), this.rnd()]);
      const gold = Math.round(m.def.xp / 6 + this.rnd() * 5);
      p.char.gold += gold;
      for (const l of loot) {
        const ex = p.char.inventory.find((i) => i.item === l.item);
        if (ex) ex.n++; else p.char.inventory.push({ ...l, n: 1 });
        this.advance(p, (s) => s.type === 'collect' && s.target === l.item.toLowerCase());
        if (l.item === 'Page of the Ninth Sky') this.spark(p, 'epic_page');
      }
      // rare legendary drop (one the player does not own yet), weighted by monster tier
      if (this.rnd() < (m.def.kind === 'minion' ? 0.01 : 0.025)) {
        const missing = LEGENDARY_IDS.filter((id) => !p.char.inventory.some((e) => e.item === id));
        if (missing.length) { const id = missing[Math.floor(this.rnd() * missing.length)]; p.char.inventory = addItem(p.char.inventory, id); loot.push({ item: id, rarity: rarityOf(ITEMS[id].rarity).name }); this.worldEvent(`${p.name} found the legendary ${ITEMS[id].name}`); }
      }
      p.conn?.send({ type: 'loot', items: loot, gold });
      if (loot.length) this.broadcastNear(m.s.x, m.s.z, 120, { type: 'fx', kind: 'loot', x: m.s.x, y: m.s.y, z: m.s.z, text: loot.map((l) => l.rarity).join(',') });
    }
  }
  private onVisit(p: Player, poi: POI) {
    this.advance(p, (s) => s.type === 'visit' && s.target === poi.id);
    if (this.isNight()) this.advance(p, (s) => s.type === 'night' && s.target === poi.id);
  }
  private onTalk(p: Player, npcKey: string) { this.advance(p, (s) => s.type === 'talk' && s.target === npcKey); }
  private onCastQuest(p: Player, spell: string, poi: POI | null) {
    this.advance(p, (s) => s.type === 'cast' && s.target === spell && (!s.poi || s.poi === poi?.id));
    if (spell === 'lux' && poi?.id === 'shrine' && this.isNight()) this.spark(p, 'shrine_night_light');
  }

  // ------------------------------------------------------------------ bots (AI adventurers)
  private botThink(p: Player, now: number, dt: number) {
    const b = p.brain!;
    if (now > b.nextChat) { b.nextChat = now + 60 + this.rnd() * 90; this.broadcastNear(p.s.x, p.s.z, 250, { type: 'chat', from: p.name, text: BOT_LINES[Math.floor(this.rnd() * BOT_LINES.length)], channel: 'say' }); }
    if (now > b.nextThink) {
      b.nextThink = now + 0.5;
      b.retreat = p.hp < p.mhp * 0.3 || (b.retreat && p.hp < p.mhp * 0.9);
      if (!b.retreat) {
        let best: Ent | null = null, bd = 28;
        for (const e of this.ents.values()) if (e.type === 'm' && !e.dead) { const d = Math.hypot(e.s.x - p.s.x, e.s.z - p.s.z); if (d < bd) { bd = d; best = e; } }
        b.target = best?.id ?? 0;
      } else b.target = 0;
      if (!b.target && (!b.goal || Math.hypot(b.goal.x - p.s.x, b.goal.z - p.s.z) < 4)) {
        const poi = b.retreat ? POIS[0] : POIS[1 + Math.floor(this.rnd() * (POIS.length - 1))];
        b.goal = { x: poi.x + (this.rnd() - 0.5) * 8, z: poi.z + (this.rnd() - 0.5) * 8 };
      }
    }
    const tgt = b.target ? this.ents.get(b.target) : undefined;
    let gx: number, gz: number, stop = 0;
    const cls = classById(p.char.cls);
    const ranged = cls.weapon === 'staff' || cls.weapon === 'bow';
    if (tgt && !tgt.dead) {
      gx = tgt.s.x; gz = tgt.s.z; stop = ranged ? 14 : 1.9;
      const d = Math.hypot(gx - p.s.x, gz - p.s.z);
      const yaw = Math.atan2(-(gx - p.s.x), -(gz - p.s.z));
      if (d <= stop + 0.5) {
        p.s.yaw = yaw;
        // use a ready class skill now and then, otherwise chain basic attacks
        const ready = SKILLS.filter((s) => this.combat.knows(p, s) && s.slot !== 5 && (p.cds[s.id] ?? 0) <= now && p.mp >= s.mana + 10 && s.kind !== 'heal' && (s.range === 0 || s.range >= d));
        const pick = ready.length && this.rnd() < 0.35 ? ready[Math.floor(this.rnd() * ready.length)] : null;
        if (pick && !p.casting) this.combat.startCast(p, pick.id, tgt.id, yaw, undefined, now);
        else this.combat.basicAttack(p, yaw, tgt.id, now);
      }
    } else if (b.goal) { gx = b.goal.x; gz = b.goal.z; stop = 1; }
    else return;
    const dx = gx - p.s.x, dz = gz - p.s.z, d = Math.hypot(dx, dz);
    let yaw = Math.atan2(-dx, -dz);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (raycastWorld(p.s.x, p.s.y + 0.8, p.s.z, fx, 0, fz, 2.5) < 2.5) yaw += 1.0;
    const go = d > stop ? 1 : 0;
    if (p.s.swimming || (p.s.grounded && this.rnd() < 0.002)) { /* hop occasionally like real players */ }
    p.inputs.push({ seq: p.lastSeq + 1, mx: 0, mz: go, yaw, jump: p.s.swimming, sprint: false, walk: false, dt });
  }

  // ------------------------------------------------------------------ snapshots
  selfState(p: Player): SelfState {
    const now = this.o.now();
    return { hp: Math.round(p.hp), mhp: p.mhp, mp: Math.round(p.mp), mmp: p.stats.maxMp, xp: p.char.xp, xpNext: xpToNext(p.char.level), level: p.char.level, cds: p.cds, gold: p.char.gold,
      sm: this.moveMulOf(p, now), sf: this.combat.statusFlags(p, now), sh: Math.round(p.st.shield), combo: now - p.combo.last < 1.7 ? p.combo.n : 0, zone: p.zone };
  }
  private sendSnapshots(now: number) {
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      const ents: NetEntity[] = [];
      const seen = new Set<number>();
      for (const e of this.ents.values()) {
        if (e.id === p.id) continue;
        if ((e as Npc).hidden) continue;
        if (e.zone !== p.zone) continue;
        const d = Math.hypot(e.s.x - p.s.x, e.s.z - p.s.z);
        if (d > 150) continue;
        seen.add(e.id);
        const ne: NetEntity = { id: e.id, t: e.type, x: r2(e.s.x), y: r2(e.s.y), z: r2(e.s.z), r: r2(e.s.yaw), a: e.anim, hp: Math.round(e.hp), mhp: e.mhp };
        if ((e as Player).casting) ne.c = (e as Player).casting!.spell;
        if (e.type === 'p' || e.type === 'b') { const w = (e as Player).char.equipment?.weapon; if (w) ne.w = w; }
        if (!p.known.has(e.id)) {
          ne.n = e.name; ne.k = e.model; ne.lv = e.level;
          if (e.type === 'p' || e.type === 'b') ne.ap = (e as Player).char.appearance;
          if (e.type === 'n') { ne.k = (e as Npc).def.key; }
          if (e.type === 'm' && (e as Monster).def.boss) ne.bs = true;
        }
        if ((e.type === 'p' || e.type === 'b') && (e as Player).char.title) ne.ti = titleById((e as Player).char.title!)?.name;
        const sf = this.combat.statusFlags(e, now);
        if (sf) ne.sf = sf;
        ents.push(ne);
      }
      const gone: number[] = [];
      for (const id of p.known) if (!seen.has(id)) gone.push(id);
      p.known = seen;
      const s = p.s;
      p.conn.send({ type: 'snap', t: now, ack: p.lastSeq, me: { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, g: s.grounded, sw: s.swimming, yaw: s.yaw, dg: s.dg, dc: s.dc, ddx: s.ddx, ddz: s.ddz }, ents, gone, self: this.selfState(p), worldTime: this.worldTime, weather: this.weather });
    }
  }

  broadcastNear(x: number, z: number, r: number, m: S2C, except?: number) {
    for (const p of this.players.values()) if (p.conn && p.id !== except && Math.hypot(p.s.x - x, p.s.z - z) <= r) p.conn.send(m);
  }
  broadcastAll(m: S2C) { for (const p of this.players.values()) p.conn?.send(m); }
  markDirty() { this.dirty = true; }
  flush() {
    this.dirty = false;
    this.lastSave = this.o.now();
    const t = Date.now();
    for (const [k, v] of Object.entries(this.data.sessions)) if (v.exp < t) delete this.data.sessions[k];
    try { this.o.store.save(this.data); } catch (e) { this.o.log?.('save failed', e); }
  }
  stats() { return { players: [...this.players.values()].filter((p) => p.type === 'p').length, bots: [...this.players.values()].filter((p) => p.type === 'b').length, monsters: [...this.ents.values()].filter((e) => e.type === 'm').length, llm: { enabled: this.llm.enabled, calls: this.llm.calls, failures: this.llm.failures, limited: this.llm.limited, cached: this.llm.cached }, worldTime: this.worldTime, weather: this.weather }; }
}

// ------------------------------------------------------------------ helpers
function stepSub(s: CharState, inp: MoveInput, mul: number) {
  const n = Math.max(1, Math.ceil(inp.dt / PHYS.DT));
  const sub = { ...inp, dt: inp.dt / n };
  for (let i = 0; i < n; i++) stepCharacter(s, sub, mul);
}
const r2 = (v: number) => Math.round(v * 100) / 100;
function clampInt(v: unknown, a: number, b: number, d: number) { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; }
function summary(c: CharRecord): CharacterSummary { return { id: c.id, name: c.name, cls: c.cls, level: c.level, appearance: c.appearance, zone: 'Gate of Dawn', created: c.created }; }
function animKey(a: string): string {
  const m: Record<string, string> = { Idle: 'idle', Sit_Chair_Idle: 'sit', Spellcasting: 'channel', '1H_Melee_Attack_Chop': 'work', Interact: 'interact', Cheer: 'cheer' };
  return m[a] ?? 'idle';
}

/** Ordinary NPC daily routine as a behaviour tree:
 *  Selector[ talking → face player | night → go home & sleep | patrol (guards) | work hours → work spot | evening → tavern ] */
function npcTree(g: Game): BTNode<Npc> {
  const goTo = (spot: (n: Npc) => { x: number; z: number; anim: string; yaw?: number }) => new Act<Npc>((n) => { n.goal = spot(n); n.hidden = false; return 'running'; });
  return new Selector<Npc>([
    new Sequence<Npc>([new Cond((n) => n.talkTo !== 0 && g.o.now() < n.talkUntil), new Act<Npc>((n) => { n.goal = null; return 'running'; })]),
    new Sequence<Npc>([new Cond((n) => !n.def.patrol && !n.def.important && (g.worldTime < 6 || g.worldTime > 22.5)), new Act<Npc>((n) => {
      n.goal = { x: n.def.home.x, z: n.def.home.z + 6, anim: 'Idle' };
      const d = Math.hypot(n.s.x - n.goal.x, n.s.z - n.goal.z);
      n.hidden = d < 1.2; // went inside to sleep
      return 'running';
    })]),
    new Sequence<Npc>([new Cond((n) => !!n.def.patrol), new Act<Npc>((n) => {
      const pts = n.def.patrol!;
      const t = pts[n.patrolIdx % pts.length];
      if (Math.hypot(n.s.x - t.x, n.s.z - t.z) < 1.2) n.patrolIdx++;
      n.goal = { x: t.x, z: t.z, anim: 'Idle' };
      return 'running';
    })]),
    new Sequence<Npc>([new Cond(() => g.worldTime >= 7 && g.worldTime < 18.5), goTo((n) => n.def.work)]),
    goTo((n) => n.def.evening),
  ]);
}

/** Every character carries its class starter weapon and the Tower's legendary gift (equipped);
 *  older saves are backfilled the first time they join. */
export function ensureKit(ch: CharRecord) {
  if (ch.equipment) return;
  for (const id of [STARTER_WEAPON[ch.cls], CLASS_GIFT[ch.cls]]) if (!ch.inventory.some((e) => e.item === id)) ch.inventory = addItem(ch.inventory, id);
  ch.equipment = { weapon: CLASS_GIFT[ch.cls] };
}
