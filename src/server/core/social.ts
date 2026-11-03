import { REGIONS } from '../../shared/regions';
import { SPAWN, withZone } from '../../shared/world';
import { newCharState } from '../../shared/physics';
import { addItem, ITEMS, type InvEntry } from '../../shared/items';
import { rollDrops, removeItem, count, gearId, tierFor, GEAR_KINDS, BOSS_MYTHIC } from '../../shared/economy';
import { arenaPlan, raidId, isRaidZone, RAID_INSTANCES, RAID_BOSS, RAID_MIN, RAID_MAX, WORLD_BOSSES } from '../../shared/instances';
import { MONSTERS } from '../../shared/combat';
import type { Game, Player, Monster, Ent } from './game';

export interface Guild { id: string; name: string; tag: string; leader: string; officers: string[]; members: { id: string; name: string; cls: string; joined: number }[]; open: boolean; bank: { gold: number; items: InvEntry[] }; log: string[]; created: number }
interface Party { id: number; leader: number; members: number[] }
interface Match { a: number; b: number; startAt: number; endAt: number; prev: Map<number, { zone: string; x: number; z: number; yaw: number }>; over: boolean }
interface Raid { k: number; party: number; members: number[]; boss: number; startedAt: number; enrageAt: number; phase: number; done: boolean; closeAt: number }
const GUILD_COST = 500;
const sanitize = (s: string, max: number) => String(s ?? '').replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Phase 4 · M6: parties, guilds (chat + bank), the timed world boss, the Eclipse raid (4–8 players,
 *  private instances) and the PvP arena (ranked 1v1). All server-authoritative. */
export class Social {
  parties = new Map<number, Party>();
  private partyOfP = new Map<number, number>();
  private invites = new Map<number, { party: number; from: number; at: number }>();
  private guildInvites = new Map<number, { guild: string; from: string; at: number }>();
  private nextParty = 1;
  queue: number[] = [];
  match: Match | null = null;
  raids = new Map<number, Raid>();
  wb: { idx: number; state: 'idle' | 'soon' | 'active'; at: number; id: number; until: number } = { idx: 0, state: 'idle', at: 0, id: 0, until: 0 };
  private lastPartySend = 0; private lastWbSend = 0;
  constructor(private g: Game) {
    this.g.data.guilds ??= {};
    this.wb.at = g.o.now() + 300; // first world boss 5 minutes after the server starts
  }
  get guilds(): Record<string, Guild> { return (this.g.data.guilds ??= {}); }
  private say(p: Player, text: string, style: 'info' | 'warn' | 'rank' | 'levelup' = 'info') { p.conn?.send({ type: 'notice', text, style }); }
  private sys(p: Player, text: string) { p.conn?.send({ type: 'chat', from: 'System', text, channel: 'system' }); }
  private byName(name: string) { const n = String(name ?? '').toLowerCase(); return [...this.g.players.values()].find((x) => x.type === 'p' && x.name.toLowerCase() === n); }

  // ------------------------------------------------------------------ parties
  partyOf(p: Player | number) { const id = this.partyOfP.get(typeof p === 'number' ? p : p.id); return id ? this.parties.get(id) ?? null : null; }
  invite(p: Player, target: Player | undefined) {
    if (!target || target === p) return this.say(p, 'Nobody by that name is online.', 'warn');
    let party = this.partyOf(p);
    if (party && party.leader !== p.id) return this.say(p, 'Only the party leader can invite.', 'warn');
    if (party && party.members.length >= RAID_MAX) return this.say(p, `A party holds at most ${RAID_MAX}.`, 'warn');
    if (this.partyOf(target)) return this.say(p, `${target.name} is already in a party.`, 'warn');
    if (!party) { party = { id: this.nextParty++, leader: p.id, members: [p.id] }; this.parties.set(party.id, party); this.partyOfP.set(p.id, party.id); }
    this.invites.set(target.id, { party: party.id, from: p.id, at: this.g.o.now() });
    target.conn?.send({ type: 'invite', kind: 'party', from: p.name } as any);
    this.say(p, `Party invite sent to ${target.name}.`);
    this.sendParty(party);
  }
  accept(p: Player) {
    const inv = this.invites.get(p.id); this.invites.delete(p.id);
    const party = inv && this.parties.get(inv.party);
    if (!inv || !party || this.g.o.now() - inv.at > 60) return this.say(p, 'That invite has expired.', 'warn');
    if (party.members.length >= RAID_MAX) return this.say(p, 'That party is full.', 'warn');
    this.leave(p, true);
    party.members.push(p.id); this.partyOfP.set(p.id, party.id);
    for (const id of party.members) { const m = this.g.players.get(id); if (m) this.sys(m, `${p.name} joined the party.`); }
    this.sendParty(party);
  }
  decline(p: Player) { const inv = this.invites.get(p.id); this.invites.delete(p.id); const from = inv && this.g.players.get(inv.from); if (from) this.say(from, `${p.name} declined the party invite.`); }
  leave(p: Player, quiet = false) {
    const party = this.partyOf(p);
    if (!party) return;
    party.members = party.members.filter((x) => x !== p.id); this.partyOfP.delete(p.id);
    p.conn?.send({ type: 'party', party: null } as any);
    if (party.members.length <= 1) { for (const id of party.members) { this.partyOfP.delete(id); this.g.players.get(id)?.conn?.send({ type: 'party', party: null } as any); } this.parties.delete(party.id); return; }
    if (party.leader === p.id) party.leader = party.members[0];
    if (!quiet) for (const id of party.members) { const m = this.g.players.get(id); if (m) this.sys(m, `${p.name} left the party.`); }
    this.sendParty(party);
  }
  kick(p: Player, targetId: number) { const party = this.partyOf(p); if (!party || party.leader !== p.id) return; const t = this.g.players.get(targetId); if (t && party.members.includes(t.id)) { this.say(t, 'You were removed from the party.', 'warn'); this.leave(t); } }
  promote(p: Player, targetId: number) { const party = this.partyOf(p); if (!party || party.leader !== p.id || !party.members.includes(targetId)) return; party.leader = targetId; this.sendParty(party); }
  partyView(party: Party) {
    return { id: party.id, leader: party.leader, members: party.members.map((id) => { const m = this.g.players.get(id); return m ? { id, name: m.name, cls: m.char.cls, level: m.char.level, hp: Math.round(m.hp), mhp: m.mhp, zone: m.zone, dead: m.dead } : null; }).filter(Boolean) };
  }
  sendParty(party: Party) { const v = this.partyView(party); for (const id of party.members) this.g.players.get(id)?.conn?.send({ type: 'party', party: v } as any); }
  partyChat(p: Player, text: string) { const party = this.partyOf(p); if (!party) return this.sys(p, 'You are not in a party. Invite someone with /invite name.'); for (const id of party.members) this.g.players.get(id)?.conn?.send({ type: 'chat', from: p.name, text, channel: 'party' }); }
  /** Party members near the kill who did not hit it still share half the XP. */
  onKill(m: Monster, killer: Ent, hitters: number[] = []) {
    const k = this.g.players.get(killer.id); const party = k && this.partyOf(k);
    if (party) for (const id of party.members) {
      const mem = this.g.players.get(id);
      if (!mem || mem.dead || mem.zone !== m.zone || hitters.includes(id) || Math.hypot(mem.s.x - m.s.x, mem.s.z - m.s.z) > 60) continue;
      this.g.giveXpPublic(mem, m.def.xp * 0.5);
    }
    if (m.id === this.wb.id) this.worldBossDown(m, hitters, killer.id);
    for (const r of this.raids.values()) if (r.boss === m.id) this.raidWon(r);
  }

  // ------------------------------------------------------------------ guilds
  guildOf(p: Player) { const id = p.char.guild; return id ? this.guilds[id] ?? null : null; }
  createGuild(p: Player, name: string, tag: string) {
    name = sanitize(name, 24); tag = sanitize(tag, 4).replace(/\s/g, '').toUpperCase();
    if (this.guildOf(p)) return this.say(p, 'Leave your guild first.', 'warn');
    if (name.length < 3 || tag.length < 2) return this.say(p, 'A guild needs a name (3–24) and a tag (2–4 letters).', 'warn');
    if (Object.values(this.guilds).some((x) => x.name.toLowerCase() === name.toLowerCase() || x.tag === tag)) return this.say(p, 'That name or tag is taken.', 'warn');
    if (p.char.gold < GUILD_COST) return this.say(p, `Founding a guild costs ${GUILD_COST} gold.`, 'warn');
    p.char.gold -= GUILD_COST;
    const id = 'g' + Date.now().toString(36) + Math.floor(this.g.rand() * 1e4).toString(36);
    this.guilds[id] = { id, name, tag, leader: p.char.id, officers: [], members: [{ id: p.char.id, name: p.char.name, cls: p.char.cls, joined: Date.now() }], open: true, bank: { gold: 0, items: [] }, log: [`${p.name} founded the guild.`], created: Date.now() };
    p.char.guild = id;
    this.g.progress.award(p, 'guild_founder');
    this.g.broadcastAll({ type: 'chat', from: 'World', text: `${p.name} founded the guild ${name} [${tag}].`, channel: 'world' } as any);
    this.g.markDirty(); this.sendGuild(p); this.sendInv(p);
  }
  private addMember(gd: Guild, p: Player) { gd.members.push({ id: p.char.id, name: p.char.name, cls: p.char.cls, joined: Date.now() }); p.char.guild = gd.id; this.glog(gd, `${p.name} joined.`); this.gchatSys(gd, `${p.name} joined the guild.`); this.g.markDirty(); this.sendGuildAll(gd); }
  joinGuild(p: Player, id: string) {
    const gd = this.guilds[id];
    if (!gd) return this.say(p, 'No such guild.', 'warn');
    if (this.guildOf(p)) return this.say(p, 'Leave your guild first.', 'warn');
    const inv = this.guildInvites.get(p.id);
    if (!gd.open && inv?.guild !== id) return this.say(p, 'That guild is invite-only.', 'warn');
    if (gd.members.length >= 50) return this.say(p, 'That guild is full.', 'warn');
    this.guildInvites.delete(p.id);
    this.addMember(gd, p);
  }
  guildInvite(p: Player, target: Player | undefined) {
    const gd = this.guildOf(p);
    if (!gd || !this.canManage(gd, p)) return this.say(p, 'Only the guild leader or an officer can invite.', 'warn');
    if (!target) return this.say(p, 'Nobody by that name is online.', 'warn');
    if (target.char.guild) return this.say(p, `${target.name} is already in a guild.`, 'warn');
    this.guildInvites.set(target.id, { guild: gd.id, from: p.name, at: this.g.o.now() });
    target.conn?.send({ type: 'invite', kind: 'guild', from: p.name, guild: gd.name, id: gd.id } as any);
    this.say(p, `Guild invite sent to ${target.name}.`);
  }
  leaveGuild(p: Player) {
    const gd = this.guildOf(p);
    if (!gd) return;
    gd.members = gd.members.filter((m) => m.id !== p.char.id); gd.officers = gd.officers.filter((x) => x !== p.char.id);
    p.char.guild = undefined;
    if (!gd.members.length) { delete this.guilds[gd.id]; }
    else if (gd.leader === p.char.id) { gd.leader = gd.officers[0] ?? gd.members[0].id; this.glog(gd, `${p.name} left; ${gd.members.find((m) => m.id === gd.leader)?.name} leads now.`); }
    else this.glog(gd, `${p.name} left.`);
    this.g.markDirty(); p.conn?.send({ type: 'guild', guild: null, list: this.list() } as any); if (gd.members.length) this.sendGuildAll(gd);
  }
  private canManage(gd: Guild, p: Player) { return gd.leader === p.char.id || gd.officers.includes(p.char.id); }
  guildOp(p: Player, op: string, a: any) {
    const gd = this.guildOf(p);
    if (!gd) return;
    const isLeader = gd.leader === p.char.id;
    if (op === 'open' && isLeader) { gd.open = !!a.open; this.glog(gd, `Recruitment ${gd.open ? 'opened' : 'closed'}.`); }
    else if (op === 'promote' && isLeader) { const id = String(a.id); if (gd.members.some((m) => m.id === id) && !gd.officers.includes(id) && id !== gd.leader) gd.officers.push(id); }
    else if (op === 'demote' && isLeader) gd.officers = gd.officers.filter((x) => x !== String(a.id));
    else if (op === 'kick' && this.canManage(gd, p)) { const id = String(a.id); if (id === gd.leader || (gd.officers.includes(id) && !isLeader)) return; const mem = gd.members.find((m) => m.id === id); if (!mem) return; gd.members = gd.members.filter((m) => m.id !== id); gd.officers = gd.officers.filter((x) => x !== id); this.glog(gd, `${mem.name} was removed by ${p.name}.`); const t = [...this.g.players.values()].find((x) => x.char.id === id); if (t) { t.char.guild = undefined; t.conn?.send({ type: 'guild', guild: null, list: this.list() } as any); } else for (const u of Object.values(this.g.data.users)) for (const c of u.chars) if (c.id === id) c.guild = undefined; }
    else if (op === 'deposit') this.deposit(p, gd, a);
    else if (op === 'withdraw') this.withdraw(p, gd, a);
    else return;
    this.g.markDirty(); this.sendGuildAll(gd);
  }
  private deposit(p: Player, gd: Guild, a: any) {
    const gold = Math.floor(Number(a.gold) || 0), item = a.item ? String(a.item) : '', n = Math.max(1, Math.floor(Number(a.n) || 1));
    if (gold > 0) { if (gold > p.char.gold) return this.say(p, 'Not enough gold.', 'warn'); p.char.gold -= gold; gd.bank.gold += gold; this.glog(gd, `${p.name} deposited ${gold} gold.`); }
    if (item) {
      if (count(p.char.inventory, item) < n) return this.say(p, 'You do not have that.', 'warn');
      if (Object.values(p.char.equipment ?? {}).includes(item) && count(p.char.inventory, item) <= n) return this.say(p, 'Unequip it first.', 'warn');
      if (gd.bank.items.length >= 60 && !gd.bank.items.some((e) => e.item === item)) return this.say(p, 'The guild bank is full (60 stacks).', 'warn');
      p.char.inventory = removeItem(p.char.inventory, item, n); gd.bank.items = addItem(gd.bank.items, item, n);
      this.glog(gd, `${p.name} deposited ${n}× ${ITEMS[item]?.name ?? item}.`);
    }
    this.sendInv(p);
  }
  private withdraw(p: Player, gd: Guild, a: any) {
    if (!this.canManage(gd, p)) return this.say(p, 'Only the leader and officers can withdraw from the bank.', 'warn');
    const gold = Math.floor(Number(a.gold) || 0), item = a.item ? String(a.item) : '', n = Math.max(1, Math.floor(Number(a.n) || 1));
    if (gold > 0) { if (gold > gd.bank.gold) return this.say(p, 'The bank does not hold that much.', 'warn'); gd.bank.gold -= gold; p.char.gold += gold; this.glog(gd, `${p.name} withdrew ${gold} gold.`); }
    if (item) { if (count(gd.bank.items, item) < n) return this.say(p, 'The bank does not hold that.', 'warn'); gd.bank.items = removeItem(gd.bank.items, item, n); p.char.inventory = addItem(p.char.inventory, item, n); this.glog(gd, `${p.name} withdrew ${n}× ${ITEMS[item]?.name ?? item}.`); }
    this.sendInv(p);
  }
  private glog(gd: Guild, s: string) { gd.log = [...gd.log, s].slice(-30); }
  private gchatSys(gd: Guild, text: string) { for (const pl of this.g.players.values()) if (pl.char.guild === gd.id) pl.conn?.send({ type: 'chat', from: `[${gd.tag}]`, text, channel: 'guild' }); }
  guildChat(p: Player, text: string) { const gd = this.guildOf(p); if (!gd) return this.sys(p, 'You are not in a guild.'); for (const pl of this.g.players.values()) if (pl.char.guild === gd.id) pl.conn?.send({ type: 'chat', from: `[${gd.tag}] ${p.name}`, text, channel: 'guild' }); }
  list() { return Object.values(this.guilds).sort((a, b) => b.members.length - a.members.length).slice(0, 20).map((x) => ({ id: x.id, name: x.name, tag: x.tag, members: x.members.length, open: x.open })); }
  guildView(gd: Guild, p: Player) {
    const online = new Set([...this.g.players.values()].map((x) => x.char.id));
    return { id: gd.id, name: gd.name, tag: gd.tag, open: gd.open, me: p.char.id, role: gd.leader === p.char.id ? 'leader' : gd.officers.includes(p.char.id) ? 'officer' : 'member',
      members: gd.members.map((m) => ({ ...m, role: gd.leader === m.id ? 'leader' : gd.officers.includes(m.id) ? 'officer' : 'member', online: online.has(m.id) })), bank: gd.bank, log: gd.log.slice(-12) };
  }
  sendGuild(p: Player) { const gd = this.guildOf(p); p.conn?.send({ type: 'guild', guild: gd ? this.guildView(gd, p) : null, list: this.list() } as any); }
  sendGuildAll(gd: Guild) { for (const pl of this.g.players.values()) if (pl.char.guild === gd.id) this.sendGuild(pl); }
  private sendInv(p: Player) { p.conn?.send({ type: 'inv', inventory: p.char.inventory, gold: p.char.gold, enchant: p.char.enchant ?? {}, equipment: (p.char.equipment ?? {}) as Record<string, string> } as any); }
  acceptGuild(p: Player) { const inv = this.guildInvites.get(p.id); if (!inv) return; this.joinGuild(p, inv.guild); }

  // ------------------------------------------------------------------ world boss (timed)
  worldBossNow() { this.wb.at = this.g.o.now() + 3; this.wb.state = 'idle'; }
  private wbDef() { return WORLD_BOSSES[this.wb.idx % WORLD_BOSSES.length]; }
  wbView() {
    const d = this.wbDef(), m = this.wb.id ? (this.g.ents.get(this.wb.id) as Monster | undefined) : undefined;
    return { type: 'worldboss', state: this.wb.state, name: MONSTERS[d.kind as keyof typeof MONSTERS]?.name ?? d.kind, region: REGIONS[d.zone].name, zone: d.zone, where: d.where, at: this.wb.state === 'active' ? this.wb.until : this.wb.at, now: this.g.o.now(), hp: m ? Math.round(m.hp) : 0, mhp: m ? m.mhp : 0 } as any;
  }
  private tickWorldBoss(now: number) {
    const d = this.wbDef();
    if (this.wb.state === 'idle' && now >= this.wb.at - 120) {
      this.wb.state = 'soon';
      this.g.broadcastAll({ type: 'chat', from: 'World', text: `The ground trembles… ${MONSTERS[d.kind as keyof typeof MONSTERS]?.name} will rise at ${d.where} (${REGIONS[d.zone].name}) in ${Math.max(1, Math.round((this.wb.at - now) / 60))} min. Gather!`, channel: 'world' } as any);
    }
    if (this.wb.state === 'soon' && now >= this.wb.at) {
      const online = [...this.g.players.values()].filter((p) => p.type === 'p').length;
      const m = withZone(d.zone, () => this.g.spawnMonster(d.kind as any, d.x, d.z, d.zone));
      m.noRespawn = true; m.mhp = m.hp = Math.round(m.hp * (1 + 0.5 * Math.max(0, online - 1)));
      this.wb = { ...this.wb, state: 'active', id: m.id, until: now + 900 };
      this.g.broadcastAll({ type: 'chat', from: 'World', text: `WORLD BOSS: ${m.name} has risen at ${d.where} in ${REGIONS[d.zone].name}! Everyone who fights it shares the spoils.`, channel: 'world' } as any);
      this.g.broadcastAll({ type: 'notice', text: `World boss: ${m.name} has risen in ${REGIONS[d.zone].name}!`, style: 'rank' });
    }
    if (this.wb.state === 'active') {
      const m = this.g.ents.get(this.wb.id) as Monster | undefined;
      if (!m || (m.dead && !this.wb.id)) { /* handled in worldBossDown */ }
      else if (now > this.wb.until && !m.dead) { this.g.removeEnt(m.id); this.g.broadcastAll({ type: 'chat', from: 'World', text: `${m.name} sinks back into the earth, unbeaten.`, channel: 'world' } as any); this.nextWorldBoss(now); }
    }
    if (now - this.lastWbSend > 2) { this.lastWbSend = now; if (this.wb.state !== 'idle') this.g.broadcastAll(this.wbView()); }
  }
  private nextWorldBoss(now: number) { this.wb = { idx: this.wb.idx + 1, state: 'idle', at: now + 1200, id: 0, until: 0 }; this.g.broadcastAll(this.wbView()); }
  private worldBossDown(m: Monster, hitters: number[], killerId: number) {
    const now = this.g.o.now();
    for (const pid of hitters) {
      const p = this.g.players.get(pid);
      if (!p || p.type !== 'p') continue;
      if (pid !== killerId) { // the killer already rolled the normal boss table
        const loot: { item: string; rarity: string }[] = [];
        for (const d of rollDrops({ kind: m.def.kind, level: m.def.level ?? 40, boss: true, region: m.zone }, () => this.g.rand())) { p.char.inventory = addItem(p.char.inventory, d.item, d.n ?? 1); loot.push({ item: d.item, rarity: d.rarity }); }
        const gold = 300; p.char.gold += gold;
        p.conn?.send({ type: 'loot', items: loot, gold } as any); this.sendInv(p);
      }
      this.g.progress.award(p, 'world_breaker');
    }
    this.g.broadcastAll({ type: 'chat', from: 'World', text: `${m.name} has been brought down by ${hitters.length} adventurer(s)! The next world boss rises in 20 minutes.`, channel: 'world' } as any);
    this.nextWorldBoss(now);
  }

  // ------------------------------------------------------------------ raid: the Eclipse Throne
  raidOf(p: Player) { for (const r of this.raids.values()) if (r.members.includes(p.id) && (p.zone === raidId(r.k) || p.dead)) return r; return null; }
  enterRaid(p: Player, devSolo = false) {
    const party = this.partyOf(p);
    const members = party ? party.members.map((id) => this.g.players.get(id)).filter((x): x is Player => !!x && !x.dead) : [p];
    if (party && party.leader !== p.id) return this.say(p, 'Only the party leader can lead the party into the raid.', 'warn');
    if (!devSolo && (members.length < RAID_MIN || members.length > RAID_MAX)) return this.say(p, `The Eclipse Throne needs a party of ${RAID_MIN}–${RAID_MAX} living members (you have ${members.length}).`, 'warn');
    if (members.some((m) => this.g.o.now() - m.lastHurt < 5)) return this.say(p, 'Someone in your party is still in combat.', 'warn');
    if (members.some((m) => this.raidOf(m) || this.inMatch(m))) return this.say(p, 'Someone in your party is busy (raid or arena).', 'warn');
    let k = 0;
    for (let i = 1; i <= RAID_INSTANCES; i++) if (!this.raids.has(i)) { k = i; break; }
    if (!k) return this.say(p, 'Every Eclipse Throne is occupied. Try again in a few minutes.', 'warn');
    const z = raidId(k), now = this.g.o.now();
    const boss = withZone(z, () => this.g.spawnMonster(RAID_BOSS as any, 0, -6, z));
    boss.noRespawn = true; boss.mhp = boss.hp = Math.round(boss.hp * Math.max(1, members.length) / 4);
    const r: Raid = { k, party: party?.id ?? 0, members: members.map((m) => m.id), boss: boss.id, startedAt: now, enrageAt: now + 480, phase: 0, done: false, closeAt: 0 };
    this.raids.set(k, r);
    const P = arenaPlan('raid');
    members.forEach((m, i) => { const a = (i - (members.length - 1) / 2) * 2.2; this.g.zones.move(m, z as any, P.entry[0].x + a, P.entry[0].z, P.entry[0].yaw, 'The Eclipse Throne'); this.say(m, 'Kaelthar wakes. Bring him down before the eclipse is total (8 minutes).', 'rank'); });
    this.sendRaid(r);
  }
  private raidView(r: Raid) { const b = this.g.ents.get(r.boss) as Monster | undefined; return { type: 'raid', k: r.k, phase: r.phase, hp: b ? Math.round(b.hp) : 0, mhp: b?.mhp ?? 1, enrageAt: r.enrageAt, now: this.g.o.now(), done: r.done, size: r.members.length } as any; }
  private sendRaid(r: Raid) { const v = this.raidView(r); for (const id of r.members) this.g.players.get(id)?.conn?.send(v); }
  private tickRaids(now: number) {
    for (const r of [...this.raids.values()]) {
      const z = raidId(r.k);
      r.members = r.members.filter((id) => { const m = this.g.players.get(id); return !!m && (m.zone === z || m.dead); }); // walked out or fell: no longer in this raid
      const inside = r.members.map((id) => this.g.players.get(id)).filter((x): x is Player => !!x && x.zone === z);
      if (r.done) { if (now > r.closeAt) { for (const m of inside) this.home(m, 'The Eclipse Throne fades. You return to the Capital.'); this.closeRaid(r); } continue; }
      const b = this.g.ents.get(r.boss) as Monster | undefined;
      if (!inside.length || inside.every((m) => m.dead)) { for (const m of inside) this.say(m, 'Your party has fallen. The Eclipse Throne resets.', 'warn'); this.closeRaid(r); continue; }
      if (!b) { this.closeRaid(r); continue; }
      const f = b.hp / b.mhp;
      if (r.phase === 0 && f < 0.66) {
        r.phase = 1;
        withZone(z, () => { for (let i = 0; i < 2 + Math.ceil(inside.length / 2); i++) { const a = (i / 4) * Math.PI * 2; const s = this.g.spawnMonster('rb_shade' as any, Math.cos(a) * 18, Math.sin(a) * 18, z); s.noRespawn = true; s.ai = 'chase'; s.target = inside[i % inside.length].id; } });
        for (const m of inside) this.say(m, 'Phase 2: Kaelthar calls the Eclipse Shades! Kill the shades before they swarm the healers.', 'warn');
      } else if (r.phase === 1 && f < 0.33) {
        r.phase = 2; b.enraged = true;
        b.st.buffs.push({ atk: 0.3, def: 0, mag: 0.3, spd: 0.15, crit: 0, lifesteal: 0, until: now + 999, src: 'eclipse' } as any);
        for (const m of inside) this.say(m, 'Phase 3: the eclipse burns! Kaelthar is enraged.', 'warn');
      }
      if (now > r.enrageAt) {
        for (const m of inside) if (!m.dead) { this.say(m, 'The eclipse is total. Darkness swallows the Throne.', 'warn'); this.g.kill(b, m, now); }
      }
      if (Math.floor(now * 2) !== Math.floor((now - 0.05) * 2)) this.sendRaid(r);
    }
  }
  private raidWon(r: Raid) {
    r.done = true; r.closeAt = this.g.o.now() + 60;
    const z = raidId(r.k);
    for (const id of r.members) {
      const p = this.g.players.get(id);
      if (!p || p.zone !== z) continue;
      const first = !(p.char.counters.raidClears ?? 0);
      p.char.counters.raidClears = (p.char.counters.raidClears ?? 0) + 1;
      this.g.giveXpPublic(p, 6000);
      const K = GEAR_KINDS[Math.floor(this.g.rand() * GEAR_KINDS.length)];
      const items = [gearId(K.key, tierFor(55), 'epic'), 'Enchant Stone', 'Enchant Stone'];
      if (first || this.g.rand() < 0.35) items.push(BOSS_MYTHIC[RAID_BOSS]);
      for (const it of items) if (ITEMS[it] || it === 'Enchant Stone') p.char.inventory = addItem(p.char.inventory, it, 1);
      p.char.gold += 1500;
      p.conn?.send({ type: 'loot', items: items.map((it) => ({ item: it, rarity: ITEMS[it] ? ITEMS[it].rarity[0].toUpperCase() + ITEMS[it].rarity.slice(1) : 'Uncommon' })), gold: 1500 } as any);
      this.sendInv(p);
      this.g.progress.award(p, 'eclipse_breaker');
      this.say(p, 'Kaelthar falls! The Eclipse Throne is yours. Returning to the Capital in 60 s.', 'levelup');
    }
    this.g.broadcastAll({ type: 'chat', from: 'World', text: `A party of ${r.members.length} has broken the Eclipse: Kaelthar is slain!`, channel: 'world' } as any);
    this.sendRaid(r);
    this.g.markDirty();
  }
  private closeRaid(r: Raid) {
    const z = raidId(r.k);
    for (const e of [...this.g.ents.values()]) if (e.zone === z && e.type !== 'p' && e.type !== 'b') this.g.removeEnt(e.id);
    for (const id of r.members) this.g.players.get(id)?.conn?.send({ type: 'raid', k: 0 } as any);
    this.raids.delete(r.k);
  }
  private home(p: Player, text: string) { this.g.zones.move(p, 'capital', SPAWN.x, SPAWN.z, SPAWN.yaw, REGIONS.capital.name); this.say(p, text); }

  // ------------------------------------------------------------------ PvP arena (ranked 1v1)
  inMatch(p: Player) { const m = this.match; return !!m && !m.over && (m.a === p.id || m.b === p.id); }
  hostile(a: Ent, b: Ent) { const m = this.match; if (!m || m.over || this.g.o.now() < m.startAt) return false; return (a.id === m.a && b.id === m.b) || (a.id === m.b && b.id === m.a); }
  rating(p: Player) { return p.char.counters.arenaRating ?? 1000; }
  queueJoin(p: Player) {
    if (this.queue.includes(p.id) || this.inMatch(p)) return this.say(p, 'You are already queued.', 'warn');
    if (this.raidOf(p)) return this.say(p, 'Finish your raid first.', 'warn');
    this.queue.push(p.id); this.say(p, 'Queued for the Crimson Ring (ranked 1v1). You will be pulled in when an opponent is found.'); this.sendArena(p);
  }
  queueLeave(p: Player) { this.queue = this.queue.filter((x) => x !== p.id); this.sendArena(p); }
  private tickArena(now: number) {
    this.queue = this.queue.filter((id) => { const p = this.g.players.get(id); return !!p && !p.dead; });
    if ((!this.match || this.match.over) && this.queue.length >= 2) {
      const [a, b] = this.queue.splice(0, 2).map((id) => this.g.players.get(id)!) as [Player, Player];
      const prev = new Map<number, { zone: string; x: number; z: number; yaw: number }>();
      for (const p of [a, b]) prev.set(p.id, { zone: p.zone, x: p.s.x, z: p.s.z, yaw: p.s.yaw });
      this.match = { a: a.id, b: b.id, startAt: now + 5, endAt: now + 185, prev, over: false };
      const P = arenaPlan('arena');
      [a, b].forEach((p, i) => { p.hp = p.mhp; p.mp = p.stats.maxMp; this.g.zones.move(p, 'arena' as any, P.entry[i].x, P.entry[i].z, P.entry[i].yaw, 'The Crimson Ring'); });
      this.say(a, `Arena: ${b.name} (${this.rating(b)}) vs you (${this.rating(a)}). Fight in 5…`, 'rank'); this.say(b, `Arena: ${a.name} (${this.rating(a)}) vs you (${this.rating(b)}). Fight in 5…`, 'rank');
      for (const p of [a, b]) this.sendArena(p);
    }
    const m = this.match;
    if (m && !m.over) {
      const a = this.g.players.get(m.a), b = this.g.players.get(m.b);
      if (!a || a.zone !== 'arena') return this.endMatch(b ?? null, a ?? null, 'forfeit');
      if (!b || b.zone !== 'arena') return this.endMatch(a, b ?? null, 'forfeit');
      if (now > m.endAt) { const fa = a.hp / a.mhp, fb = b.hp / b.mhp; return fa === fb ? this.endMatch(null, null, 'draw') : fa > fb ? this.endMatch(a, b, 'time') : this.endMatch(b, a, 'time'); }
    }
  }
  /** Called from Game.kill: a KO in the ring ends the match instead of killing anyone. */
  arenaKO(dst: Player, src: Ent): boolean {
    const m = this.match;
    if (!m || m.over || (dst.id !== m.a && dst.id !== m.b) || dst.zone !== 'arena') return false;
    const win = this.g.players.get(dst.id === m.a ? m.b : m.a) ?? null;
    void src;
    this.endMatch(win, dst, 'ko');
    return true;
  }
  private endMatch(win: Player | null, lose: Player | null, how: 'ko' | 'time' | 'forfeit' | 'draw') {
    const m = this.match; if (!m || m.over) return;
    m.over = true;
    const K = 32;
    if (win && lose) {
      const ra = this.rating(win), rb = this.rating(lose), ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
      const d = Math.round(K * (1 - ea));
      win.char.counters.arenaRating = ra + d; lose.char.counters.arenaRating = Math.max(100, rb - d);
      win.char.counters.arenaWins = (win.char.counters.arenaWins ?? 0) + 1; lose.char.counters.arenaLosses = (lose.char.counters.arenaLosses ?? 0) + 1;
      this.say(win, `Victory${how === 'ko' ? ' by knockout' : how === 'time' ? ' on time' : ' (forfeit)'}! Rating ${ra} → ${ra + d}.`, 'levelup');
      this.say(lose, `Defeat. Rating ${rb} → ${Math.max(100, rb - d)}. No XP, gold or items are lost in the Ring.`, 'warn');
      if ((win.char.counters.arenaWins ?? 0) >= 10) this.g.progress.award(win, 'gladiator');
      this.g.broadcastAll({ type: 'chat', from: 'World', text: `Crimson Ring: ${win.name} defeats ${lose.name}.`, channel: 'world' } as any);
    } else for (const id of [m.a, m.b]) { const p = this.g.players.get(id); if (p) this.say(p, 'The match ends in a draw.'); }
    for (const id of [m.a, m.b]) {
      const p = this.g.players.get(id); if (!p) continue;
      p.dead = false; p.hp = p.mhp; p.mp = p.stats.maxMp; p.st.dots = []; p.st.hots = []; p.anim = 'idle';
      const back = m.prev.get(id)!;
      if (p.zone === 'arena') this.g.zones.move(p, back.zone as any, back.x, back.z, back.yaw, REGIONS[back.zone as 'capital']?.name ?? 'Home');
      this.sendArena(p);
    }
    this.g.markDirty();
  }
  arenaBoard() {
    const rows: { name: string; cls: string; rating: number; wins: number; losses: number }[] = [];
    for (const u of Object.values(this.g.data.users)) for (const c of u.chars) if (c.counters?.arenaRating !== undefined) rows.push({ name: c.name, cls: c.cls, rating: c.counters.arenaRating, wins: c.counters.arenaWins ?? 0, losses: c.counters.arenaLosses ?? 0 });
    return rows.sort((a, b) => b.rating - a.rating).slice(0, 10);
  }
  sendArena(p: Player) { const m = this.match; p.conn?.send({ type: 'arena', queued: this.queue.includes(p.id), inMatch: this.inMatch(p), startAt: m && !m.over && this.inMatch(p) ? m.startAt : 0, endAt: m && !m.over && this.inMatch(p) ? m.endAt : 0, now: this.g.o.now(), rating: this.rating(p), wins: p.char.counters.arenaWins ?? 0, losses: p.char.counters.arenaLosses ?? 0, board: this.arenaBoard() } as any); }

  // ------------------------------------------------------------------ lifecycle
  liveZones(): string[] { const z: string[] = []; if (this.match && !this.match.over) z.push('arena'); for (const r of this.raids.values()) z.push(raidId(r.k)); return z; }
  tick(now: number) {
    this.tickWorldBoss(now); this.tickRaids(now); this.tickArena(now);
    if (now - this.lastPartySend > 0.5) { this.lastPartySend = now; for (const party of this.parties.values()) this.sendParty(party); }
    for (const [pid, inv] of this.invites) if (now - inv.at > 60) this.invites.delete(pid);
  }
  onLeave(p: Player) {
    this.leave(p, false); this.queueLeave(p);
    if (this.inMatch(p)) { const m = this.match!; const other = this.g.players.get(m.a === p.id ? m.b : m.a) ?? null; this.endMatch(other, p, 'forfeit'); }
    const r = this.raidOf(p); if (r) r.members = r.members.filter((x) => x !== p.id);
  }
  /** The Social panel's whole state for one player. */
  sendAll(p: Player) { const party = this.partyOf(p); p.conn?.send({ type: 'party', party: party ? this.partyView(party) : null } as any); this.sendGuild(p); this.sendArena(p); p.conn?.send(this.wbView()); }
  onRespawnHome(p: Player) { void p; }
}
export { isRaidZone };
