/** Progression: stat points, skill ranks, advanced classes, weapon mastery, titles and reputation. */
import { ATTRS, Attr, pointsEarned, SKILLS, MAX_RANK, ADVANCED, ADVANCE_LEVEL, TITLES, titleById, masteryLevel, FACTIONS, repRank } from '../../shared/skills';
import type { Game, Player } from './game';
import type { ProgressView } from '../../shared/protocol';

export function spentStat(a: Partial<Record<Attr, number>> | undefined) { return Object.values(a ?? {}).reduce((s, v) => s + (v ?? 0), 0); }
export function spentSkill(r: Record<string, number> | undefined) { return Object.values(r ?? {}).reduce((s, v) => s + Math.max(0, (v ?? 1) - 1), 0); }

export class Progression {
  constructor(private g: Game) {}

  view(p: Player): ProgressView {
    const ch = p.char;
    const earned = pointsEarned(ch.level);
    return {
      attrs: { str: 0, int: 0, vit: 0, agi: 0, spi: 0, ...(ch.attrs ?? {}) } as Record<Attr, number>,
      statPoints: earned.stat - spentStat(ch.attrs), skillPoints: earned.skill - spentSkill(ch.skillRanks),
      ranks: { ...(ch.skillRanks ?? {}) }, adv: ch.adv ?? null, titles: [...(ch.titles ?? [])], title: ch.title ?? null,
      rep: { ...(ch.rep ?? {}) }, mastery: { ...(ch.mastery ?? {}) }, counters: { ...ch.counters },
      stats: { ...p.stats }, deaths: ch.deaths, kills: ch.kills,
    };
  }
  send(p: Player) { p.conn?.send({ type: 'progress', p: this.view(p) }); }

  allocStat(p: Player, attr: string, n: number) {
    if (!ATTRS.some((a) => a.id === attr)) return this.err(p, 'Unknown attribute');
    n = Math.max(1, Math.min(10, Math.floor(n) || 1));
    const v = this.view(p);
    if (v.statPoints < n) return this.err(p, 'No stat points left');
    p.char.attrs = { ...(p.char.attrs ?? {}), [attr]: (p.char.attrs?.[attr as Attr] ?? 0) + n };
    this.g.refreshStats(p);
    this.send(p);
  }
  resetStats(p: Player) {
    const cost = 50 * p.char.level;
    if ((p.char.gold ?? 0) < cost) return this.err(p, `A reset costs ${cost} gold`);
    p.char.gold -= cost; p.char.attrs = {}; this.g.refreshStats(p); this.send(p);
    p.conn?.send({ type: 'notice', text: `Attributes reset (−${cost} gold)`, style: 'info' });
  }
  rankSkill(p: Player, id: string) {
    const s = SKILLS.find((x) => x.id === id);
    if (!s || s.cls !== p.char.cls) return this.err(p, 'Not your skill');
    if (p.char.level < s.unlock) return this.err(p, `Unlocks at level ${s.unlock}`);
    if (s.slot === 5 && s.adv !== p.char.adv) return this.err(p, 'Choose that advanced class first');
    const r = p.char.skillRanks?.[id] ?? 1;
    if (r >= MAX_RANK) return this.err(p, 'Already at max rank');
    if (this.view(p).skillPoints < 1) return this.err(p, 'No skill points left');
    p.char.skillRanks = { ...(p.char.skillRanks ?? {}), [id]: r + 1 };
    this.g.markDirty();
    this.send(p);
  }
  advance(p: Player, adv: string) {
    if (p.char.adv) return this.err(p, 'You already chose your path');
    if (p.char.level < ADVANCE_LEVEL) return this.err(p, `Advanced classes open at level ${ADVANCE_LEVEL}`);
    const a = ADVANCED[p.char.cls].find((x) => x.id === adv);
    if (!a) return this.err(p, 'Unknown advanced class');
    p.char.adv = adv;
    this.g.refreshStats(p);
    this.award(p, 'ascendant');
    this.g.broadcastNear(p.s.x, p.s.z, 300, { type: 'fx', kind: 'levelup', src: p.id, x: p.s.x, y: p.s.y, z: p.s.z, amount: p.char.level });
    p.conn?.send({ type: 'notice', text: `You are now a ${a.name}`, style: 'rank' });
    this.g.worldEvent(`${p.name} ascended as a ${a.name}`);
    this.send(p);
  }
  setTitle(p: Player, id: string | null) {
    if (id && !(p.char.titles ?? []).includes(id)) return this.err(p, 'You have not earned that title');
    p.char.title = id; this.g.markDirty(); this.send(p);
  }
  onHit(p: Player, weapon: string) {
    p.char.mastery = p.char.mastery ?? {};
    const before = masteryLevel(p.char.mastery[weapon] ?? 0);
    p.char.mastery[weapon] = (p.char.mastery[weapon] ?? 0) + 1;
    const after = masteryLevel(p.char.mastery[weapon]);
    if (after > before) { p.conn?.send({ type: 'notice', text: `${weapon[0].toUpperCase() + weapon.slice(1)} mastery ${after}`, style: 'info' }); if (after >= 10) this.award(p, 'weapon_master'); this.send(p); }
  }
  addRep(p: Player, faction: string, amount: number) {
    if (!FACTIONS.some((f) => f.id === faction)) return;
    p.char.rep = p.char.rep ?? {};
    const before = repRank(p.char.rep[faction] ?? 0);
    p.char.rep[faction] = (p.char.rep[faction] ?? 0) + amount;
    const after = repRank(p.char.rep[faction]);
    if (after !== before) {
      const f = FACTIONS.find((x) => x.id === faction)!;
      p.conn?.send({ type: 'notice', text: `${f.name}: ${after}`, style: 'rank' });
      if (faction === 'capital' && (after === 'Honored' || after === 'Revered' || after === 'Exalted')) this.award(p, 'friend_capital');
      this.send(p);
    }
  }
  award(p: Player, id: string) {
    const t = titleById(id);
    if (!t || p.type !== 'p') return;
    p.char.titles = p.char.titles ?? [];
    if (p.char.titles.includes(id)) return;
    p.char.titles.push(id);
    if (!p.char.title) p.char.title = id;
    this.g.markDirty();
    p.conn?.send({ type: 'notice', text: `Title earned: ${t.name}`, style: 'rank' });
    p.conn?.send({ type: 'chat', from: 'System', text: `New title: “${t.name}” — ${t.desc} (set it in the Hero panel, P)`, channel: 'system' });
    this.send(p);
  }
  checkTitles(p: Player) {
    if (p.type !== 'p') return;
    const c = p.char, k = c.counters;
    if (c.kills >= 1) this.award(p, 'first_blood');
    if (c.kills >= 100) this.award(p, 'slayer');
    if (c.kills >= 500) this.award(p, 'reaper');
    if (c.level >= 10) this.award(p, 'seasoned');
    if ((k.parries ?? 0) >= 25) this.award(p, 'iron_wall');
    if ((k.dodges ?? 0) >= 50) this.award(p, 'wind_dancer');
    if ((k.maxCombo ?? 0) >= 10) this.award(p, 'combo_artist');
    if (c.deaths >= 10) this.award(p, 'undying');
    if ((k.bosses ?? 0) >= 1) this.award(p, 'bossbreaker');
    if ((k.reactions ?? 0) >= 10) this.award(p, 'elementalist');
    if ((k.towerBest ?? 0) >= 10) this.award(p, 'climber');
  }
  private err(p: Player, t: string) { p.conn?.send({ type: 'notice', text: t, style: 'warn' }); }
}
export { TITLES };
