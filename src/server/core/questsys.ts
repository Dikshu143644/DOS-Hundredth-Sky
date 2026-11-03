/** Phase 4 · M3: quests and people. The main story, side quests, hidden ??? chains, the Guild
 *  quest board (F → SSS, rank-gated), AI NPCs speaking through the NPC AI schema, the companion
 *  agent that follows and fights, and the AI status the HUD shows. Server-authoritative. */
import type { Game, Player } from './game';
import type { Quest } from './director';
import { questView } from './director';
import { STORY, SIDE, HIDDEN, questT, generateBoard, canTake, rankIdx, regionName, type QuestT } from '../../shared/questdata';
import { npcSystemPrompt, validateNpcOutput, type NpcAiOutput, type NpcMemoryRecord } from '../../shared/npcai';
import { npcByKey, NPCS, type NpcDef } from './npcdefs';
import { rankFor } from '../../shared/origin';
import { classById } from '../../shared/combat';
import { parseJsonLoose, partialSender, wholeSentences } from './llm';
import type { Summon } from './combat';
import { withZone } from '../../shared/world';
import { UNIQUE_REWARD } from '../../shared/economy';
import { ITEMS, addItem } from '../../shared/items';

export const BOARD_MAX = 3;
const BOARD_PERIOD_MS = 3 * 3600_000;

export function fromTemplate(t: QuestT): Quest {
  return { id: t.id, rank: t.rank, title: t.title, hook: t.hook, reward: `${t.xp} XP · ${t.gold} gold · ${t.pts} rank pts`, current: 0, hidden: t.kind === 'hidden', complete: false,
    source: 'procedural', spark: t.kind, xp: t.xp, kind: t.kind, gold: t.gold, pts: t.pts, next: t.next, giver: t.giver, region: t.region,
    steps: t.steps.map((s) => ({ type: s.type as any, target: s.target, count: s.count, text: s.text, progress: 0 })) };
}

export class QuestSys {
  private aiTick = 0;
  private compTick = 0;
  constructor(private g: Game) {}

  // ------------------------------------------------------------------ giving quests
  has(p: Player, id: string) { return p.char.quests.some((q) => q.id === id); }
  give(p: Player, t: QuestT | undefined, why = 'New quest'): boolean {
    if (!t || this.has(p, t.id)) return false;
    const q = fromTemplate(t);
    p.char.quests.push(q);
    this.g.markDirty();
    p.conn?.send({ type: 'quest', quest: questView(q), event: 'discovered' });
    p.conn?.send({ type: 'notice', text: t.kind === 'hidden' ? `Hidden Scenario discovered — Rank ???` : `${why}: ${t.title} (Rank ${t.rank})`, style: 'rank' });
    return true;
  }
  /** The main story always has its next chapter open. */
  ensureStory(p: Player) {
    if (p.type !== 'p') return;
    if (!this.has(p, 'story1')) { p.char.quests.push(fromTemplate(questT('story1')!)); this.g.markDirty(); } // silent: arrives with 'joined'
  }
  onComplete(p: Player, q: Quest) {
    const uq = UNIQUE_REWARD[q.id];
    if (uq && !p.char.inventory.some((e) => e.item === uq)) { p.char.inventory = addItem(p.char.inventory, uq); p.conn?.send({ type: 'loot', items: [{ item: uq, rarity: 'Unique' }], gold: 0 }); this.g.broadcastAll({ type: 'chat', from: 'World', text: `${p.name} received the one and only ${ITEMS[uq]?.name}.`, channel: 'world' }); }
    if (q.pts) this.g.origin.addPts(p, q.pts, 'quest');
    if (q.next) { const n = questT(q.next); if (n) { this.give(p, n, 'Main story'); if (n.minLevel && p.char.level < n.minLevel) p.conn?.send({ type: 'notice', text: `Recommended level ${n.minLevel} for ${regionName(n.region)}.`, style: 'info' }); } }
  }
  /** Talking to an NPC who hands out quests (scripted path; AI NPCs can also use give_quest). */
  offerOnTalk(p: Player, def: NpcDef) {
    for (const id of def.gives ?? []) {
      const t = questT(id);
      if (!t || this.has(p, id)) continue;
      if (t.kind === 'story') continue; // story chapters arrive by the chain
      if (this.give(p, t)) return t;
    }
    return undefined;
  }

  // ------------------------------------------------------------------ the Guild board
  boardFor(p: Player) {
    const seed = Math.floor(Date.now() / BOARD_PERIOD_MS);
    return generateBoard(p.zone, seed);
  }
  sendBoard(p: Player) {
    const adv = rankFor(p.char.advPts ?? 0);
    const active = p.char.quests.filter((q) => q.kind === 'board' && !q.complete).length;
    const list = this.boardFor(p).map((t) => ({ id: t.id, rank: t.rank, title: t.title, hook: t.hook, region: regionName(t.region), reward: `${t.xp} XP · ${t.gold}g · ${t.pts} pts`, can: canTake(adv, t.rank), taken: this.has(p, t.id), need: canTake(adv, t.rank) ? undefined : `Rank ${['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'][Math.max(0, rankIdx(t.rank) - 1)]} needed` }));
    p.conn?.send({ type: 'board', region: p.zone, rank: adv, active, max: BOARD_MAX, list });
  }
  take(p: Player, id: string) {
    const t = this.boardFor(p).find((x) => x.id === id);
    const adv = rankFor(p.char.advPts ?? 0);
    if (!t) return p.conn?.send({ type: 'notice', text: 'That bounty is no longer posted.', style: 'warn' });
    if (!canTake(adv, t.rank)) return p.conn?.send({ type: 'notice', text: `The Guild won\'t give a ${t.rank}-rank bounty to a ${adv}-rank climber yet.`, style: 'warn' });
    if (p.char.quests.filter((q) => q.kind === 'board' && !q.complete).length >= BOARD_MAX) return p.conn?.send({ type: 'notice', text: `You already carry ${BOARD_MAX} bounties.`, style: 'warn' });
    this.give(p, t, 'Bounty taken');
    this.sendBoard(p);
  }
  drop(p: Player, id: string) {
    const i = p.char.quests.findIndex((q) => q.id === id && !q.complete && (q.kind === 'board' || q.kind === 'side'));
    if (i < 0) return;
    p.char.quests.splice(i, 1); this.g.markDirty();
    p.conn?.send({ type: 'notice', text: 'Quest abandoned.', style: 'info' });
    p.conn?.send({ type: 'questList', quests: p.char.quests.map(questView) } as any);
  }

  // ------------------------------------------------------------------ hidden chains
  openChain(p: Player, npcKey: string): boolean {
    const h = HIDDEN.find((x) => x.trigger.type === 'secret' && x.trigger.npc === npcKey);
    if (!h) return false;
    return this.give(p, h.quest);
  }

  // ------------------------------------------------------------------ AI NPCs (schema path)
  async aiTalk(p: Player, def: NpcDef, mem: NpcMemoryRecord, text: string, npcId?: number): Promise<{ say: string; mood: string; action?: string; actionText?: string; valid: boolean } | null> {
    const prof = def.ai!;
    if (!this.g.llm.enabled || !text) return null;
    const trust = mem.trust ?? 0;
    const active = p.char.quests.filter((q) => !q.complete).map((q) => `${q.title} [${q.rank}] step: ${q.steps[q.current]?.text ?? 'done'}`).slice(0, 4);
    const avail = (prof.offers ?? []).filter((id) => !this.has(p, id) && (questT(id)?.kind !== 'story' || this.storyReady(p, id)));
    const ctx = `WORLD MEMORY: ${this.g.timeOfDay()}, weather ${this.g.weather}. Recent events: ${this.g.data.worldEvents.slice(-4).join('; ') || 'quiet'}.
LONG-TERM MEMORY of this player: ${p.name}, level ${p.char.level} ${classById(p.char.cls).name}, adventurer rank ${rankFor(p.char.advPts ?? 0)}; met you ${mem.met} times; trust ${trust}/10. ${mem.long.join('; ')}
Their active quests: ${active.join(' | ') || 'none'}. Quests you could give now: ${avail.join(', ') || 'none'}.${def.role === 'companion' ? ` You are ${p.char.companion === def.key ? 'currently travelling with them' : 'not in their party'}.` : ''}`;
    const history = mem.short.slice(-prof.memory.shortMax).map((s) => ({ role: (s.who === 'player' ? 'user' : 'assistant') as 'user' | 'assistant', content: s.text }));
    const raw = await this.g.llm.ask(p.user, [{ role: 'system', content: npcSystemPrompt(prof) }, { role: 'user', content: ctx }, ...history], { maxTokens: 260 /* JSON wrapper + a ≤60-word line */, temperature: 0.85, json: true, onPartial: npcId == null ? undefined : partialSender((t) => p.conn?.send({ type: 'llmPartial', ctx: 'npc', npc: npcId, text: t }), true) });
    if (!raw) return null;
    const parsed = parseJsonLoose<unknown>(raw);
    if (!parsed) return null;
    const v = validateNpcOutput(parsed, prof.allowedActions);
    if (!v.value.say || v.value.say === '…') return null;
    const out = v.value;
    out.say = wholeSentences(out.say, 420);
    if (out.remember) { mem.long.push(out.remember); if (mem.long.length > prof.memory.longMax) mem.long.shift(); }
    if (out.trust) mem.trust = Math.max(-10, Math.min(10, trust + out.trust));
    const actionText = this.applyAction(p, def, out, mem);
    return { say: out.say, mood: out.emotion, action: out.action.type, actionText, valid: v.ok };
  }
  private storyReady(p: Player, id: string) { const i = STORY.findIndex((s) => s.id === id); return i <= 0 || p.char.quests.some((q) => q.id === STORY[i - 1].id && q.complete); }
  /** The world-changing half of a reply. Every branch re-checks what the model asked for. */
  applyAction(p: Player, def: NpcDef, out: NpcAiOutput, mem: NpcMemoryRecord): string | undefined {
    const a = out.action;
    switch (a.type) {
      case 'give_quest': {
        const id = a.arg && def.ai?.offers?.includes(a.arg) ? a.arg : (def.ai?.offers ?? []).find((x) => !this.has(p, x) && (questT(x)?.kind !== 'story' || this.storyReady(p, x)));
        if (id && questT(id)?.kind !== 'story' || (id && this.storyReady(p, id))) { if (id && this.give(p, questT(id))) return 'gave you a quest'; }
        return undefined;
      }
      case 'reveal_secret': if ((mem.trust ?? 0) >= 2 || mem.met >= 3) { if (this.openChain(p, def.key)) return 'revealed a secret'; } return undefined;
      case 'heal_player': if (p.hp < p.mhp) { p.hp = Math.min(p.mhp, p.hp + p.mhp * 0.25); return 'healed you'; } return undefined;
      case 'join_party': case 'follow_player': if (def.role === 'companion') { this.recruit(p, def.key); return 'joined your party'; } return undefined;
      case 'leave_party': if (def.role === 'companion' && p.char.companion === def.key) { this.dismiss(p); return 'left your party'; } return undefined;
      case 'give_directions': { const t = def.ai?.offers?.map(questT).find(Boolean); return t ? `pointed the way to ${regionName(t.region)}` : 'gave directions'; }
      case 'warn': return 'warned you';
      default: return undefined;
    }
  }
  /** Scripted (no-LLM) triggers so every system works offline too. */
  scriptedTriggers(p: Player, def: NpcDef, mem: NpcMemoryRecord, text: string): string | undefined {
    const t = text.toLowerCase();
    if (def.role === 'companion' && /\b(join|come with|follow|party|together|recruit)\b/.test(t)) { this.recruit(p, def.key); return 'joined your party'; }
    if (def.role === 'companion' && /\b(leave|dismiss|go home|part ways)\b/.test(t) && p.char.companion === def.key) { this.dismiss(p); return 'left your party'; }
    const chainWord = def.ai?.secretChain;
    if (chainWord && (t.includes(chainWord) || /secret/.test(t)) && ((mem.trust ?? 0) >= 2 || mem.met >= 3)) { if (this.openChain(p, def.key)) return 'revealed a secret'; }
    return undefined;
  }

  // ------------------------------------------------------------------ the companion agent
  recruit(p: Player, key: string) {
    if (p.type !== 'p') return;
    p.char.companion = key; p.compDownUntil = 0; this.g.markDirty();
    this.spawnCompanion(p);
    p.conn?.send({ type: 'notice', text: `${npcByKey(key)?.name ?? key} joined your party.`, style: 'rank' });
  }
  dismiss(p: Player) {
    const c = this.companionOf(p); if (c) this.g.removeEnt(c.id);
    p.char.companion = undefined; this.g.markDirty();
    p.conn?.send({ type: 'companion', name: null, state: 'none' });
  }
  companionOf(p: Player): Summon | undefined { for (const e of this.g.ents.values()) if (e.type === 's' && (e as Summon).owner === p.id && (e as Summon).kind === p.char.companion) return e as Summon; return undefined; }
  private spawnCompanion(p: Player) {
    if (!p.char.companion || p.dead || (p as any).hidden) return;
    withZone(p.zone, () => {
      const s = this.g.combat.spawnSummon(p, p.char.companion!, 1e9, 1.15 + p.char.level * 0.01, this.g.o.now());
      s.name = npcByKey(p.char.companion!)?.name ?? s.name; s.anim = 'idle';
    });
  }
  tick(now: number, dt: number) {
    // AI status to everyone, every 20 s
    if ((this.aiTick -= dt) <= 0) { this.aiTick = 20; this.g.broadcastAll(this.aiStatus()); }
    if ((this.compTick -= dt) > 0) return; this.compTick = 0.5;
    for (const p of this.g.players.values()) {
      if (p.type !== 'p' || !p.char.companion) continue;
      const c = this.companionOf(p);
      if (!c) {
        if (now < (p.compDownUntil ?? 0) || p.dead) continue;
        if (p.compWasUp) { p.compDownUntil = now + 30; p.compWasUp = false; p.conn?.send({ type: 'companion', name: npcByKey(p.char.companion)?.name ?? null, state: 'downed' }); continue; }
        this.spawnCompanion(p); p.compWasUp = true; continue;
      }
      p.compWasUp = true;
      // companion brain: protect the leader, then fight, then follow
      if (p.hp < p.mhp * 0.35 && now > ((c as any).healAt ?? 0)) {
        (c as any).healAt = now + 14;
        p.hp = Math.min(p.mhp, p.hp + p.mhp * 0.22);
        this.g.broadcastNear(p.s.x, p.s.z, 120, { type: 'fx', kind: 'heal', src: c.id, dst: p.id, x: p.s.x, y: p.s.y, z: p.s.z });
        this.bark(p, c, ['Hold on — I\'ve got you!', 'Drink this. Now.', 'Stay with me!']);
      }
      if (c.hp < c.mhp * 0.25) c.target = 0; // too hurt: fall back to the leader
      const tgt = c.target ? this.g.ents.get(c.target) : undefined;
      if (tgt && (tgt as any).def?.boss && !(c as any).bossBark) { (c as any).bossBark = true; this.bark(p, c, ['That one\'s big. Watch for the wind-up!', 'Boss! I\'ll take its flank.']); }
      if (!tgt) (c as any).bossBark = false;
      p.conn?.send({ type: 'companion', name: c.name, state: 'following', hp: Math.round(c.hp), mhp: c.mhp });
    }
  }
  private bark(p: Player, c: Summon, lines: string[]) { p.conn?.send({ type: 'chat', from: c.name, text: lines[Math.floor(this.g.rand() * lines.length)], channel: 'npc' }); }

  aiStatus() {
    const L = this.g.llm;
    const npcs = NPCS.filter((n) => n.ai).length;
    const status: 'online' | 'degraded' | 'offline' = !L.enabled ? 'offline' : 'online'; // POLISH-1: enabled = online; a busy model only changes the detail line
    const busy = L.enabled && L.lastFailAt > L.lastOkAt && L.failures > 0 && this.g.o.now() - L.lastFailAt < 120;
    const detail = status === 'offline' ? 'AI is off — NPCs use scripted lines' : busy ? `${npcs} NPCs speak through the AI (busy right now — a few lines may be scripted)` : `${npcs} NPCs speak through the AI`;
    return { type: 'ai' as const, status, npcs, calls: L.calls, failures: L.failures, detail };
  }
}
