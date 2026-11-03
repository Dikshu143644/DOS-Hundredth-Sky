import { CHEATS, cheatOffer, cheatById, AFFINITIES, findFusion, fusionSlots, ADV_RANKS, RANK_PTS, rankFor, INJURIES, powerScore, type Affinity } from '../../shared/origin';
import { CLASSES, classById, type ClassId } from '../../shared/combat';
import { REGIONS } from '../../shared/regions';
import { parseJsonLoose } from './llm';
import type { Game, Player, Monster, Ent, CharRecord } from './game';

const GODDESS = {
  name: 'Aurelia', title: 'Keeper of the Hundred Skies',
  sys: `You are Aurelia, Keeper of the Hundred Skies, a serene, warm, slightly mischievous goddess in the isekai anime-fantasy MMORPG "DOS: The Hundredth Sky". You speak to a soul whose ordinary life on Earth just ended, in the void between worlds, before you reincarnate them beneath a 100-floor Tower. Speak like a kind anime goddess: gentle, a little playful, profound, never more than 45 words. Never mention being an AI or a game. Reply ONLY as JSON {"say":"..."}.`,
};
const LINES: Record<string, (s: any) => string> = {
  start: () => 'Ah… you are awake. Do not be afraid, little soul. Your life on Earth has ended, but your story has not. I am Aurelia, Keeper of the Hundred Skies. Tell me — who were you, before the light took you?',
  pastlife: (s) => `${s.pastLife ? `“${s.pastLife}”… I see it in you still.` : 'You do not remember? That is all right.'} Every soul I send below the Tower carries one gift no other has. Choose yours — I have three for you.`,
  cheat: (s) => `${s.cheatName}… a fitting gift. Now, the shape of your new life. What path will you walk beneath the Tower?`,
  class: (s) => `A ${s.className}. Good. Last, the element your soul resonates with. Choose freely… though I would not touch the forbidden one, if I were you.`,
  affinity: (s) => s.affinity === 'forbidden' ? 'You chose the Forbidden… Chaos answers you now. It will cost you, little soul — your body, and the trust of others. I will still be watching.' : `${s.affinityName}. It suits you. Look — this is who you are now.`,
  talk: (s) => `${s.affinity ? 'Hush, little soul. There will be time for every question beneath the Tower.' : s.cheat ? 'Patient, aren’t you? First, your path.' : 'I hear you. But first — your choices.'} Choose, and I will listen.`,
  finish: () => 'Go, then. Wake beneath the Hundredth Sky. Climb, fall, rise again. And when you reach the top… come find me.',
};

/** Phase 4 · Reincarnation prologue, cheat skills, skill fusion, adventurer rank F→SSS, lasting
 *  injuries and the power leaderboard. All server-authoritative. */
export class Origin {
  private board: { at: number; rows: { name: string; cls: string; level: number; rank: string; power: number; id: string }[] } = { at: -1e9, rows: [] };
  constructor(private g: Game) {}

  needsPrologue(ch: CharRecord) { return !ch.origin?.done; }
  state(ch: CharRecord) { const o = ch.origin ?? { done: false, notes: [] }; return { pastLife: o.pastLife ?? '', cheat: o.cheat ?? null, cls: ch.cls, affinity: o.affinity ?? null, offer: cheatOffer(ch.id) }; }

  private async speak(p: Player, step: string, extra: Record<string, unknown> = {}, said?: string) {
    const ch = p.char, s: any = { ...this.state(ch), ...extra };
    s.cheatName = cheatById(s.cheat)?.name; s.className = classById(ch.cls).name; s.affinityName = AFFINITIES.find((a) => a.id === s.affinity)?.name;
    let say = LINES[step]?.(s) ?? '…', source: 'llm' | 'scripted' = 'scripted';
    if (this.g.llm.enabled) {
      const notes = (ch.origin?.notes ?? []).slice(-6).join(' | ');
      const ctx = `Moment: ${step}. The soul's name in the new world: ${ch.name}. What they told you of their past life: "${s.pastLife || 'nothing yet'}". Gift chosen: ${s.cheatName ?? 'not yet'}. Path: ${s.className}. Element: ${s.affinityName ?? 'not yet'}. Things you remember about them: ${notes || 'nothing yet'}.
${said ? `They just said to you: "${said}"` : ''}
Your line should do this: ${step === 'talk' ? 'answer what they just said in character (warmly, briefly), then gently remind them to make the choice in front of them.' : LINES[step]?.(s) ?? 'answer them kindly.'}`;
      const r = parseJsonLoose<{ say?: string }>(await this.g.llm.ask(p.user, [{ role: 'system', content: GODDESS.sys }, { role: 'user', content: ctx }], { maxTokens: 220, temperature: 0.9, json: true }));
      if (r?.say) { say = String(r.say).slice(0, 360); source = 'llm'; }
    }
    p.conn?.send({ type: 'prologue', step, say, source, state: this.state(ch), offer: step === 'pastlife' ? cheatOffer(ch.id) : undefined } as any);
  }

  async handle(p: Player, m: { step?: string; value?: string; text?: string }) {
    const ch = p.char;
    const o = (ch.origin ??= { done: false, notes: [] });
    if (o.done && m.step !== 'status') return;
    const v = String(m.value ?? '').slice(0, 140);
    switch (m.step) {
      case 'start': return this.speak(p, 'start');
      case 'talk': { const t = String(m.text ?? '').slice(0, 160); if (t) o.notes.push(`said: ${t}`); return this.speak(p, 'talk', {}, t); }
      case 'pastlife': o.pastLife = v || 'someone who does not remember'; o.notes.push(`past life: ${o.pastLife}`); this.g.markDirty(); return this.speak(p, 'pastlife');
      case 'cheat': if (!cheatOffer(ch.id).includes(v)) return; o.cheat = v; o.notes.push(`chose the gift ${cheatById(v)!.name}`); this.g.markDirty(); return this.speak(p, 'cheat');
      case 'class': {
        if (!CLASSES.some((c) => c.id === v) || ch.level > 1) return;
        if (v !== ch.cls) { ch.cls = v as ClassId; ch.equipment = undefined; ch.inventory = []; this.g.reKit(p); }
        o.notes.push(`walks the path of the ${classById(ch.cls).name}`); this.g.markDirty(); return this.speak(p, 'class');
      }
      case 'affinity': {
        if (!AFFINITIES.some((a) => a.id === v)) return;
        o.affinity = v as Affinity; o.notes.push(`resonates with ${v}`);
        this.g.refreshStats(p); this.g.markDirty(); return this.speak(p, 'affinity');
      }
      case 'finish': case 'skip': {
        if (m.step === 'skip') { o.cheat ??= cheatOffer(ch.id)[0]; o.affinity ??= ({ warrior: 'earth', mage: 'fire', archer: 'wind', assassin: 'darkness', knight: 'light', summoner: 'space', healer: 'light' } as Record<string, Affinity>)[ch.cls] ?? 'fire'; }
        if (!o.cheat || !o.affinity) return;
        o.done = true;
        (p as any).hidden = false;
        ch.advPts ??= 0;
        ch.titles = [...new Set([...(ch.titles ?? []), 'reincarnated'])];
        ch.title ??= 'reincarnated';
        if (o.affinity === 'forbidden') this.g.progress.addRep(p, 'capital', -20);
        this.g.refreshStats(p); p.hp = p.mhp; p.mp = p.stats.maxMp;
        this.g.markDirty();
        if (m.step === 'finish') await this.speak(p, 'finish');
        p.conn?.send({ type: 'notice', text: `You wake beneath the Hundredth Sky. Unique skill: ${cheatById(o.cheat)!.name} · Affinity: ${AFFINITIES.find((a) => a.id === o.affinity)!.name}`, style: 'levelup' });
        this.g.progress.send(p);
        this.sendStatus(p);
        return;
      }
    }
  }

  // ------------------------------------------------------------------ status window + fusion
  statusOf(p: Player) {
    const ch = p.char, pts = ch.advPts ?? 0, rank = rankFor(pts), ri = ADV_RANKS.indexOf(rank);
    return {
      name: ch.name, cls: ch.cls, adv: ch.adv ?? null, level: ch.level, rank, advPts: pts, nextPts: RANK_PTS[ri + 1] ?? null,
      cheat: ch.origin?.cheat ?? null, affinity: ch.origin?.affinity ?? null, pastLife: ch.origin?.pastLife ?? '',
      titles: ch.titles ?? [], title: ch.title ?? null, stats: p.stats, hp: Math.round(p.hp), mp: Math.round(p.mp),
      power: powerScore(ch.level, p.stats, ri), injuries: (ch.injuries ?? []).filter((j) => j.until > Date.now()), fusions: ch.fusions ?? [], fusionSlots: fusionSlots(ch.level),
      deaths: ch.deaths, kills: ch.kills,
    };
  }
  sendStatus(p: Player) { p.conn?.send({ type: 'status', s: this.statusOf(p) } as any); }
  fuse(p: Player, a: string, b: string) {
    const ch = p.char, o = ch.origin;
    const no = (t: string) => p.conn?.send({ type: 'notice', text: t, style: 'warn' });
    if (!o?.done || !o.affinity) return no('Your soul has not awakened yet.');
    if ((ch.fusions ?? []).length >= fusionSlots(ch.level)) return no(fusionSlots(ch.level) ? 'No free fusion slot — the next opens at a higher level.' : 'Skill fusion awakens at level 5.');
    if (a !== o.affinity && b !== o.affinity) return no('One of the two must be your own affinity.');
    const f = findFusion(a as Affinity, b as Affinity);
    if (!f) return no('Those two will not fuse.');
    if ((ch.fusions ?? []).includes(f.id)) return no('You already know that fusion.');
    ch.fusions = [...(ch.fusions ?? []), f.id];
    p.conn?.send({ type: 'notice', text: `SKILL FUSION: ${f.name} — ${f.title}! (key G)`, style: 'levelup' });
    this.g.broadcastNear(p.s.x, p.s.z, 120, { type: 'fx', kind: 'levelup', src: p.id, x: p.s.x, y: p.s.y, z: p.s.z, amount: ch.level });
    this.g.markDirty(); this.g.progress.send(p); this.sendStatus(p);
  }

  // ------------------------------------------------------------------ rank, cheats on kill, stakes on death
  addPts(p: Player, n: number, why: string) {
    const ch = p.char, before = rankFor(ch.advPts ?? 0), now = Date.now();
    let pts = Math.max(0, (ch.advPts ?? 0) + Math.round(n));
    // a fresh promotion is protected for 10 minutes: you cannot drop below it yet
    if (n < 0 && now < (ch.rankProtectUntil ?? 0)) pts = Math.max(pts, RANK_PTS[ADV_RANKS.indexOf(before)]);
    ch.advPts = pts;
    const after = rankFor(pts);
    if (after !== before) {
      const up = ADV_RANKS.indexOf(after) > ADV_RANKS.indexOf(before);
      if (up) ch.rankProtectUntil = now + 10 * 60_000;
      p.conn?.send({ type: 'notice', text: up ? `Adventurer rank up: ${before} → ${after}!` : `Rank lost: ${before} → ${after} (${why})`, style: up ? 'levelup' : 'warn' });
      if (up && ADV_RANKS.indexOf(after) >= 6) this.g.broadcastAll({ type: 'chat', from: 'Guild', text: `${ch.name} has been promoted to ${after}-rank!`, channel: 'world' });
      this.board.at = -1e9;
      this.sendStatus(p);
    }
    this.g.markDirty();
  }
  onKill(m: Monster, killer: Ent, now: number) {
    const p = this.g.players.get(killer.id);
    if (!p || p.type !== 'p') return;
    const gap = m.def.level - p.char.level;
    this.addPts(p, m.def.boss ? 60 + Math.max(0, gap) * 4 : gap >= -5 ? 1 + Math.max(0, gap) : 0, 'kill');
    const cheat = p.char.origin?.cheat;
    if (cheat === 'lucky_star') p.char.gold += Math.round((m.def.gold ?? 5) * 0.3);
    if (cheat === 'shadow_monarch' && !m.def.boss && this.g.rand() < 0.15) {
      const s = this.g.combat.spawnSummon(p, 'wolf', 30, 1.0 + p.char.level * 0.02, now);
      if (s) s.name = `Shadow ${m.def.name}`;
      p.conn?.send({ type: 'notice', text: `ARISE. ${m.def.name} kneels as your shadow.`, style: 'rank' });
    }
  }
  /** Return by Death: once per 10 min a killing blow is refused. */
  rewind(p: Player, now: number): boolean {
    if (p.type !== 'p' || p.char.origin?.cheat !== 'return_by_death') return false;
    const o = p.char.origin!;
    if (Date.now() < (o.rewindAt ?? 0)) return false;
    o.rewindAt = Date.now() + 10 * 60_000;
    p.hp = Math.round(p.mhp * 0.3); p.dead = false;
    this.g.broadcastNear(p.s.x, p.s.z, 150, { type: 'fx', kind: 'react', dst: p.id, x: p.s.x, y: p.s.y + 2.6, z: p.s.z, text: 'RETURN BY DEATH' });
    p.conn?.send({ type: 'notice', text: 'The world rewinds. You are still alive. (Return by Death: ready again in 10 min)', style: 'rank' });
    void now; return true;
  }
  /** The real stakes of falling (on top of XP/gold loss): rank points, a lasting injury, maybe an item, and people remember. */
  onDeath(p: Player, by: Ent): { injury?: string; lostItem?: string; rankLost?: number } {
    if (p.type !== 'p') return {};
    const ch = p.char, out: { injury?: string; lostItem?: string; rankLost?: number } = {};
    const lose = Math.max(10, Math.round((ch.advPts ?? 0) * 0.05));
    if ((ch.advPts ?? 0) > 0) { out.rankLost = Math.min(lose, ch.advPts ?? 0); this.addPts(p, -lose, 'you fell'); }
    if (this.g.rand() < (p.zone === 'forbidden' ? 0.8 : 0.4)) {
      const pool = p.zone === 'forbidden' ? INJURIES : INJURIES.filter((j) => j.id !== 'haunted');
      const j = pool[Math.floor(this.g.rand() * pool.length)];
      ch.injuries = [...(ch.injuries ?? []).filter((x) => x.until > Date.now() && x.id !== j.id), { id: j.id, until: Date.now() + j.mins * 60_000 }];
      out.injury = `${j.name} (${j.desc}, ${j.mins} min)`;
    }
    const loose = ch.inventory.filter((e) => !Object.values(ch.equipment ?? {}).includes(e.item) && !/potion/.test(e.item));
    if (loose.length && this.g.rand() < 0.25) {
      const e = loose[Math.floor(this.g.rand() * loose.length)];
      e.n -= 1; if (e.n <= 0) ch.inventory = ch.inventory.filter((x) => x !== e);
      out.lostItem = e.item;
    }
    this.g.progress.addRep(p, 'capital', -3);
    ch.deeds = [...(ch.deeds ?? []), `Fell to ${by.name} in ${REGIONS[p.zone as 'capital']?.name ?? 'the wilds'}`].slice(-12);
    this.g.refreshStats(p);
    return out;
  }

  leaderboard(p: Player) {
    const now = this.g.o.now();
    if (now - this.board.at > 15) {
      const rows: { name: string; cls: string; level: number; rank: string; power: number; id: string }[] = [];
      for (const u of Object.values(this.g.data.users)) for (const c of u.chars) {
        const st = this.g.statsOf(c), rank = rankFor(c.advPts ?? 0);
        rows.push({ name: c.name, cls: c.cls, level: c.level, rank, power: powerScore(c.level, st, ADV_RANKS.indexOf(rank)), id: c.id });
      }
      rows.sort((a, b) => b.power - a.power);
      this.board = { at: now, rows };
    }
    const place = this.board.rows.findIndex((r) => r.id === p.char.id) + 1;
    p.conn?.send({ type: 'leaderboard', rows: this.board.rows.slice(0, 20).map(({ id, ...r }) => ({ ...r, me: id === p.char.id })), place, total: this.board.rows.length } as any);
  }
}
export { CHEATS };
