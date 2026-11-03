/** Server combat system: class skills, statuses, elemental reactions, combos, dodge/parry,
 *  summons and the death penalty. Everything here runs only on the authoritative server. */
import { stepCharacter, hasLineOfSight, raycastWorld, sweepDash, newCharState, PHYS, MoveInput, CharState } from '../../shared/physics';
import { heightAt } from '../../shared/world';
import { clamp } from '../../shared/rng';
import { classById, computeDamage, xpToNext, Element, MONSTERS, MonsterDef } from '../../shared/combat';
import { SkillDef, skillById, rankScale, comboPower, COMBO_WINDOW, reaction, SkillEffects, masteryLevel, SUMMONS } from '../../shared/skills';
import { itemDef } from '../../shared/items';
import type { Game, Ent, Player, Monster } from './game';

export interface Buff { atk: number; def: number; mag: number; spd: number; crit: number; lifesteal: number; until: number; src: string }
export interface Status {
  rootUntil: number; slowUntil: number; slowMul: number; markUntil: number; mark: number;
  soakUntil: number; burnUntil: number; chillUntil: number; iframesUntil: number; parryUntil: number; tauntUntil: number;
  dots: { src: number; dps: number; until: number; el: Element; next: number }[];
  hots: { src: number; hps: number; until: number; next: number }[];
  shield: number; shieldUntil: number; buffs: Buff[];
}
export const newStatus = (): Status => ({ rootUntil: 0, slowUntil: 0, slowMul: 1, markUntil: 0, mark: 0, soakUntil: 0, burnUntil: 0, chillUntil: 0, iframesUntil: 0, parryUntil: 0, tauntUntil: 0, dots: [], hots: [], shield: 0, shieldUntil: 0, buffs: [] });

/** A summoned spirit fighting for a player. */
export interface Summon extends Ent { owner: number; kind: string; power: number; until: number; target: number; nextAttack: number; taunt: boolean }

export const SUMMON_DEFS = SUMMONS;

const sum = (bs: Buff[], k: keyof Omit<Buff, 'until' | 'src'>, now: number) => bs.reduce((a, b) => (b.until > now ? a + b[k] : a), 0);

export class Combat {
  constructor(private g: Game) {}

  // ------------------------------------------------------------------ derived numbers
  buffSum(e: Ent, k: keyof Omit<Buff, 'until' | 'src'>, now: number) { return sum(e.st.buffs, k, now); }
  atkOf(p: Player, now: number) { return p.stats.atk * (1 + this.buffSum(p, 'atk', now)) * this.masteryMul(p); }
  magOf(p: Player, now: number) { return p.stats.mag * (1 + this.buffSum(p, 'mag', now)); }
  defOf(e: Ent, now: number) {
    const base = e.type === 'm' ? (e as Monster).def.def : e.type === 's' ? 4 : (e as Player).stats?.def ?? 5;
    return Math.max(0, base * (1 + this.buffSum(e, 'def', now)));
  }
  /** Movement multiplier from slows, roots, stuns and speed buffs (shared with client prediction via SelfState.sm). */
  moveMul(e: Ent, now: number) {
    if (now < e.stunUntil || now < e.st.rootUntil) return 0;
    const slow = now < e.st.slowUntil ? e.st.slowMul : 1;
    return Math.max(0.15, slow * (1 + this.buffSum(e, 'spd', now)));
  }
  weaponKind(p: Player): string {
    const w = p.char.equipment?.weapon ? itemDef(p.char.equipment.weapon) : undefined;
    return w?.family ?? classById(p.char.cls).weapon;
  }
  masteryMul(p: Player) { return 1 + 0.015 * masteryLevel(p.char.mastery?.[this.weaponKind(p)] ?? 0); }
  rankOf(p: Player, id: string) { return Math.max(1, p.char.skillRanks?.[id] ?? 1); }
  /** Can this player use this skill right now (class, level, advanced path)? */
  knows(p: Player, s: SkillDef) {
    if (s.cls !== p.char.cls) return false;
    if (p.char.level < s.unlock) return false;
    if (s.slot === 5 && s.adv !== p.char.adv) return false;
    return true;
  }
  isEnemy(a: Ent, b: Ent): boolean {
    if (a === b || b.dead) return false;
    const side = (e: Ent) => (e.type === 'm' ? 'm' : e.type === 'n' ? 'n' : 'p');
    if (side(a) === 'n' || side(b) === 'n') return false;
    if (side(a) !== side(b)) return true;
    return this.g.pvpHostile(a, b);
  }
  isAlly(a: Ent, b: Ent): boolean { return !b.dead && (b.type === 'p' || b.type === 'b') && (a.type === 'p' || a.type === 'b' || a.type === 's') && !this.g.pvpHostile(a, b); }
  ownerOf(e: Ent): Player | undefined { return e.type === 's' ? this.g.players.get((e as Summon).owner) : e.type === 'p' || e.type === 'b' ? (e as Player) : undefined; }

  // ------------------------------------------------------------------ skills
  startCast(p: Player, skillId: string, target: number | undefined, yaw: number, aim: { x: number; y: number; z: number } | undefined, now: number) {
    const sp = skillById(skillId);
    if (!sp || p.dead || p.casting) return;
    const fail = (t: string) => p.conn?.send({ type: 'fx', kind: 'castfail', src: p.id, spell: sp.id, text: t });
    if (!this.knows(p, sp)) return fail(sp.slot === 5 ? 'Needs the right advanced class' : `Unlocks at level ${sp.unlock}`);
    if (now < p.stunUntil) return fail('Stunned');
    const rs = rankScale(sp, this.rankOf(p, sp.id));
    if ((p.cds[sp.id] ?? 0) > now) return fail('Not ready yet');
    if (p.mp < rs.mana) return fail('Not enough mana');
    p.mp -= rs.mana;
    p.cds[sp.id] = now + rs.cooldown + sp.castTime;
    p.s.yaw = yaw;
    p.casting = { spell: sp.id, until: now + sp.castTime, target, aim, yaw };
    this.g.broadcastNear(p.s.x, p.s.z, 200, { type: 'fx', kind: 'cast', src: p.id, spell: sp.id, x: p.s.x, y: p.s.y, z: p.s.z });
    if (sp.castTime <= 0.05) this.finishCast(p, now);
  }

  finishCast(p: Player, now: number) {
    const c = p.casting!;
    p.casting = null;
    const sp = skillById(c.spell)!;
    const rs = rankScale(sp, this.rankOf(p, sp.id));
    const e = sp.fx2 ?? {};
    p.anim = sp.scale === 'mag' ? 'castshoot' : sp.kind === 'dash' ? 'attack2' : 'attack';
    p.animUntil = now + 0.5;
    const stat = sp.scale === 'mag' ? this.magOf(p, now) : this.atkOf(p, now);
    const ox = p.s.x, oy = p.s.y + 1.4, oz = p.s.z;
    this.g.onCast(p, sp.id);
    const bc = (m: Parameters<Game['broadcastNear']>[3], x = ox, z = oz) => this.g.broadcastNear(x, z, 220, m);
    // where the skill is aimed
    const aimPoint = () => {
      const tgt = c.target ? this.g.ents.get(c.target) : undefined;
      if (tgt && !tgt.dead && this.isEnemy(p, tgt) && Math.hypot(tgt.s.x - ox, tgt.s.z - oz) <= sp.range + 2) return { x: tgt.s.x, y: tgt.s.y + 1, z: tgt.s.z, ent: tgt };
      if (c.aim && Math.hypot(c.aim.x - ox, c.aim.z - oz) <= sp.range + 2) return { x: c.aim.x, y: c.aim.y, z: c.aim.z, ent: undefined };
      const tx = ox - Math.sin(c.yaw) * sp.range, tz = oz - Math.cos(c.yaw) * sp.range;
      return { x: tx, y: heightAt(tx, tz) + 1, z: tz, ent: undefined };
    };
    switch (sp.kind) {
      case 'projectile': {
        const a = aimPoint();
        const dx = a.x - ox, dy = a.y - oy, dz = a.z - oz, d = Math.hypot(dx, dy, dz) || 1;
        this.g.projectiles.push({ owner: p.id, spell: sp.id, x: ox, y: oy, z: oz, dx: dx / d, dy: dy / d, dz: dz / d, speed: sp.fx === 'arrow' ? 42 : 26, left: Math.min(sp.range, d + 2), power: rs.power, stat, homing: sp.id === 'spiritbolt' ? a.ent?.id : undefined });
        bc({ type: 'fx', kind: 'spell', src: p.id, spell: sp.id, x: ox, y: oy, z: oz, tx: a.x, ty: a.y, tz: a.z });
        return;
      }
      case 'strike': {
        const a = aimPoint();
        const dx = a.x - ox, dy = a.y - oy, dz = a.z - oz, d = Math.hypot(dx, dy, dz) || 1;
        const hitD = raycastWorld(ox, oy, oz, dx / d, dy / d, dz / d, d, new Set(['bound']));
        const k = Math.min(1, hitD / d);
        const sx = ox + dx * k, sz = oz + dz * k, sy = heightAt(sx, sz);
        bc({ type: 'fx', kind: 'spell', src: p.id, spell: sp.id, x: ox, y: oy, z: oz, tx: sx, ty: sy, tz: sz }, sx, sz);
        this.areaHit(p, sp, rs.power, stat, sx, sy, sz, now);
        if (e.heal) this.areaHeal(p, sp, stat, sx, sz, now);
        if (this.g.weatherAt(p) === 'storm' && sp.element === 'lightning') this.g.spark(p, 'storm_fulgur');
        return;
      }
      case 'nova': {
        bc({ type: 'fx', kind: 'spell', src: p.id, spell: sp.id, x: p.s.x, y: p.s.y, z: p.s.z });
        if (sp.power > 0) this.areaHit(p, sp, rs.power, stat, p.s.x, p.s.y + 1, p.s.z, now);
        else for (const t of this.g.ents.values()) if (this.isEnemy(p, t) && Math.hypot(t.s.x - p.s.x, t.s.z - p.s.z) <= sp.radius) this.hostileEffects(p, t, e, now, stat);
        if (e.heal || e.hot || e.shield || e.buff || e.revive || e.cleanse) this.friendly(p, sp, stat, now);
        return;
      }
      case 'cone': {
        bc({ type: 'fx', kind: 'spell', src: p.id, spell: sp.id, x: p.s.x, y: p.s.y, z: p.s.z, tx: ox - Math.sin(c.yaw) * sp.range, ty: oy, tz: oz - Math.cos(c.yaw) * sp.range });
        const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
        for (const t of [...this.g.ents.values()]) {
          if (!this.isEnemy(p, t)) continue;
          const dx = t.s.x - p.s.x, dz = t.s.z - p.s.z, d = Math.hypot(dx, dz);
          if (d > sp.range + 0.6) continue;
          const ang = Math.acos(clamp((dx * fx + dz * fz) / Math.max(d, 1e-3), -1, 1));
          if (ang > (sp.arc ?? 1.6) / 2 && d > 1.2) continue;
          if (!hasLineOfSight(p.s.x, p.s.y + 1.2, p.s.z, t.s.x, t.s.y + 1.1, t.s.z)) continue;
          this.damage(p, t, stat, rs.power, sp.element, now, { skill: sp, melee: true, crit: this.buffSum(p, 'crit', now) > 0.9 ? 1 : undefined });
          this.hostileEffects(p, t, e, now, stat);
        }
        if (e.buff) this.addBuff(p, e.buff, now, sp.id);
        return;
      }
      case 'dash': {
        const a = aimPoint();
        let dirx = -Math.sin(c.yaw), dirz = -Math.cos(c.yaw);
        let dist = e.dash ?? sp.range;
        if (dist > 0 && a.ent) { const dx = a.x - p.s.x, dz = a.z - p.s.z, dd = Math.hypot(dx, dz); if (dd > 0.5) { dirx = dx / dd; dirz = dz / dd; dist = Math.min(dist, Math.max(0, dd - 1.3)); } }
        const fx0 = p.s.x, fz0 = p.s.z;
        if (dist < 0) { // backwards: blast where you stood, then leap away
          this.areaHit(p, sp, rs.power, stat, p.s.x, p.s.y + 1, p.s.z, now);
          sweepDash(p.s, dirx * dist, dirz * dist);
        } else sweepDash(p.s, dirx * dist, dirz * dist);
        if (e.iframes) p.st.iframesUntil = now + e.iframes;
        p.inputs.length = 0;
        bc({ type: 'fx', kind: 'dash', src: p.id, spell: sp.id, x: fx0, y: p.s.y, z: fz0, tx: p.s.x, ty: p.s.y, tz: p.s.z });
        if (dist >= 0) this.areaHit(p, sp, rs.power, stat, p.s.x, p.s.y + 1, p.s.z, now);
        return;
      }
      case 'buff': {
        bc({ type: 'fx', kind: 'spell', src: p.id, spell: sp.id, x: p.s.x, y: p.s.y, z: p.s.z });
        if (e.taunt) for (const t of this.g.ents.values()) if (t.type === 'm' && !t.dead && Math.hypot(t.s.x - p.s.x, t.s.z - p.s.z) <= sp.radius) this.taunt(t as Monster, p, now, 6);
        if (sp.id === 'pack') for (const s of this.g.ents.values()) if (s.type === 's' && (s as Summon).owner === p.id) { s.hp = s.mhp; (s as Summon).power *= 1.6; }
        this.friendly(p, sp, stat, now);
        return;
      }
      case 'heal': {
        let t: Ent = p;
        const tg = c.target ? this.g.ents.get(c.target) : undefined;
        if (tg && this.isAlly(p, tg) && Math.hypot(tg.s.x - p.s.x, tg.s.z - p.s.z) <= sp.range) t = tg;
        const amt = Math.round(stat * 2.4 * (e.heal ?? 1) * (1 + 0.12 * (this.rankOf(p, sp.id) - 1)) + 12);
        this.heal(p, t, amt, now);
        if (e.cleanse) this.cleanse(t);
        if (sp.id === 'redux' && (t.type === 'p' || t.type === 'b')) { const pl = t as Player; for (const k of Object.keys(pl.cds)) pl.cds[k] = Math.max(now, pl.cds[k] - 5); }
        bc({ type: 'fx', kind: 'spell', src: p.id, spell: sp.id, x: t.s.x, y: t.s.y, z: t.s.z, tx: t.s.x, ty: t.s.y, tz: t.s.z, dst: t.id });
        return;
      }
      case 'summon': {
        const sd = e.summon!;
        const mine = [...this.g.ents.values()].filter((s) => s.type === 's' && (s as Summon).owner === p.id && (s as Summon).kind === sd.kind) as Summon[];
        while (mine.length >= sd.max) { const old = mine.shift()!; this.g.removeEnt(old.id); }
        const s = this.spawnSummon(p, sd.kind, sd.dur, sd.power * (1 + 0.12 * (this.rankOf(p, sp.id) - 1)), now);
        bc({ type: 'fx', kind: 'spell', src: p.id, spell: sp.id, x: s.s.x, y: s.s.y, z: s.s.z, dst: s.id });
        return;
      }
    }
  }

  /** Damage + hostile effects for every enemy in a sphere (walls block the blast). */
  areaHit(p: Player, sp: SkillDef, power: number, stat: number, x: number, y: number, z: number, now: number) {
    for (const t of [...this.g.ents.values()]) {
      if (!this.isEnemy(p, t)) continue;
      const d = Math.hypot(t.s.x - x, t.s.y + 1 - y, t.s.z - z);
      if (d > sp.radius + 0.4) continue;
      if (!hasLineOfSight(x, y + 0.5, z, t.s.x, t.s.y + 1, t.s.z)) continue;
      const falloff = 1 - 0.4 * (d / Math.max(0.1, sp.radius));
      this.damage(p, t, stat, power * falloff, sp.element, now, { skill: sp });
      this.hostileEffects(p, t, sp.fx2 ?? {}, now, stat, x, z);
      if (sp.id === 'ignis' && (t as Monster).def?.kind === 'warrior' && this.g.poiIdAt(x, z) === 'ruins') this.g.spark(p, 'ruins_ignis');
    }
    if (sp.id === 'ignis' && this.g.poiIdAt(x, z) === 'shrine' && this.g.weatherAt(p) !== 'clear' && this.g.isNight()) this.g.spark(p, 'shrine_ignis_rain_night');
  }
  areaHeal(p: Player, sp: SkillDef, stat: number, x: number, z: number, now: number) {
    for (const t of this.g.ents.values()) if (this.isAlly(p, t) && Math.hypot(t.s.x - x, t.s.z - z) <= sp.radius + 3) this.heal(p, t, Math.round(stat * 2.4 * (sp.fx2?.heal ?? 1) + 8), now);
  }

  hostileEffects(src: Ent, t: Ent, e: SkillEffects, now: number, stat: number, ox = src.s.x, oz = src.s.z) {
    if (t.dead) return;
    const immune = t.type === 'm' && (t as Monster).def.boss;
    const st = t.st;
    if (e.stun && !immune) t.stunUntil = Math.max(t.stunUntil, now + e.stun);
    if (e.stun && immune) t.stunUntil = Math.max(t.stunUntil, now + e.stun * 0.25);
    if (e.root) st.rootUntil = Math.max(st.rootUntil, now + e.root * (immune ? 0.3 : 1));
    if (e.slow) { st.slowUntil = now + (e.slowDur ?? 3); st.slowMul = Math.min(st.slowUntil > now ? st.slowMul : 1, 1 - e.slow * (immune ? 0.5 : 1)); }
    if (e.dot) st.dots.push({ src: src.id, dps: Math.max(1, stat * e.dot), until: now + (e.dotDur ?? 4), el: 'fire', next: now + 1 });
    if (e.mark) { st.mark = Math.max(st.markUntil > now ? st.mark : 0, e.mark); st.markUntil = now + (e.markDur ?? 8); }
    if (e.soak) st.soakUntil = now + e.soak;
    if (e.burn) st.burnUntil = now + 5;
    if (e.chill) st.chillUntil = now + e.chill;
    if (e.taunt && t.type === 'm') { const pl = this.ownerOf(src); if (pl) this.taunt(t as Monster, pl, now, 6); }
    if (e.knock && !immune) {
      const dx = t.s.x - ox, dz = t.s.z - oz, d = Math.hypot(dx, dz) || 1;
      sweepDash(t.s, (dx / d) * e.knock, (dz / d) * e.knock);
      if (t.type === 'p' || t.type === 'b') (t as Player).inputs.length = 0;
    }
    if (e.stun || e.root || e.slow || e.mark) this.g.broadcastNear(t.s.x, t.s.z, 150, { type: 'fx', kind: 'status', dst: t.id, x: t.s.x, y: t.s.y + 2.4, z: t.s.z, text: e.stun ? 'STUNNED' : e.root ? 'ROOTED' : e.mark ? 'MARKED' : 'SLOWED' });
  }

  friendly(p: Player, sp: SkillDef, stat: number, now: number) {
    const e = sp.fx2 ?? {};
    const rankMul = 1 + 0.12 * (this.rankOf(p, sp.id) - 1);
    const targets: Ent[] = e.party ? [...this.g.ents.values()].filter((t) => (t === p || this.isAlly(p, t)) && Math.hypot(t.s.x - p.s.x, t.s.z - p.s.z) <= Math.max(sp.radius, 1)) : [p];
    if (e.revive) for (const t of this.g.players.values()) if (t.dead && t !== p && !this.g.pvpHostile(p, t) && Math.hypot(t.s.x - p.s.x, t.s.z - p.s.z) <= sp.radius) { this.g.revivePlayer(t, 0.6); targets.push(t); }
    for (const t of targets) {
      if (e.heal) this.heal(p, t, Math.round(stat * 2.4 * e.heal * rankMul * (e.revive ? 0.25 : 1) + 12), now);
      if (e.hot) t.st.hots.push({ src: p.id, hps: stat * e.hot * rankMul, until: now + (e.hotDur ?? 6), next: now + 1 });
      if (e.shield) { t.st.shield = Math.round(t.mhp * e.shield * rankMul); t.st.shieldUntil = now + (e.shieldDur ?? 8); }
      if (e.buff) this.addBuff(t, e.buff, now, sp.id, rankMul);
      if (e.cleanse) this.cleanse(t);
      if (t !== p) this.g.broadcastNear(t.s.x, t.s.z, 150, { type: 'fx', kind: 'buff', dst: t.id, spell: sp.id, x: t.s.x, y: t.s.y, z: t.s.z });
    }
  }
  addBuff(t: Ent, b: SkillEffects['buff'] & object, now: number, src: string, mul = 1) {
    t.st.buffs = t.st.buffs.filter((x) => x.until > now && x.src !== src);
    t.st.buffs.push({ atk: (b.atk ?? 0) * mul, def: (b.def ?? 0) * mul, mag: (b.mag ?? 0) * mul, spd: b.spd ?? 0, crit: b.crit ?? 0, lifesteal: b.lifesteal ?? 0, until: now + b.dur, src });
  }
  cleanse(t: Ent) { t.st.dots = []; t.st.slowUntil = 0; t.st.rootUntil = 0; t.stunUntil = 0; t.st.buffs = t.st.buffs.filter((b) => b.atk >= 0 && b.def >= 0); }
  heal(src: Ent, t: Ent, amount: number, now: number) {
    if (t.dead) return;
    const before = t.hp;
    t.hp = Math.min(t.mhp, t.hp + amount);
    const got = Math.round(t.hp - before);
    if (got > 0) this.g.broadcastNear(t.s.x, t.s.z, 150, { type: 'fx', kind: 'heal', src: src.id, dst: t.id, amount: got, x: t.s.x, y: t.s.y + 2, z: t.s.z });
    void now;
  }
  taunt(m: Monster, p: Ent, now: number, dur: number) { if (m.dead) return; m.target = p.id; m.ai = 'chase'; m.st.tauntUntil = now + dur; }

  // ------------------------------------------------------------------ basic attack (combos)
  basicAttack(p: Player, yaw: number, target: number | undefined, now: number) {
    if (p.dead || now < p.attackReadyAt || p.casting || now < p.stunUntil) return;
    const cls = classById(p.char.cls);
    const ranged = cls.weapon === 'bow' || cls.weapon === 'staff';
    p.attackReadyAt = now + (ranged ? 0.8 : 0.62);
    p.s.yaw = yaw;
    // combo chain: keep hitting inside the window
    const n = now - p.combo.last < COMBO_WINDOW ? p.combo.n + 1 : 1;
    const cp = comboPower(n);
    p.anim = ranged ? 'shoot' : cp.finisher ? 'attack2' : n % 2 ? 'attack' : 'attack2';
    p.animUntil = now + 0.55;
    this.g.broadcastNear(p.s.x, p.s.z, 150, { type: 'fx', kind: 'attack', src: p.id, x: p.s.x, y: p.s.y, z: p.s.z, amount: n });
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best: Ent | null = null, bestD = 1e9;
    for (const e of this.g.ents.values()) {
      if (!this.isEnemy(p, e)) continue;
      const dx = e.s.x - p.s.x, dz = e.s.z - p.s.z, d = Math.hypot(dx, dz);
      const range = ranged ? 26 : 3.4;
      if (d > range) continue;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / Math.max(d, 1e-3), -1, 1));
      const isTarget = e.id === target;
      if (!isTarget && ang > (ranged ? 0.35 : 1.0) && d > 1.2) continue;
      if (!hasLineOfSight(p.s.x, p.s.y + 1.4, p.s.z, e.s.x, e.s.y + 1.1, e.s.z)) continue;
      const score = d + (isTarget ? -100 : 0);
      if (score < bestD) { bestD = score; best = e; }
    }
    if (!best) { p.combo = { n: 0, last: 0 }; return; }
    const tgt = best;
    setTimeout(() => {
      const t2 = this.g.o.now();
      if (tgt.dead || p.dead) return;
      const stat = cls.weapon === 'staff' ? this.magOf(p, t2) * 0.7 : this.atkOf(p, t2);
      const hit = this.damage(p, tgt, stat, cp.mul, 'physical', t2, { melee: !ranged, basic: true });
      if (hit) {
        p.combo = { n, last: t2 };
        p.char.counters.maxCombo = Math.max(p.char.counters.maxCombo ?? 0, n);
        if (n >= 2) p.conn?.send({ type: 'fx', kind: 'combo', src: p.id, amount: n, text: cp.finisher ? 'FINISHER' : undefined });
        if (cp.finisher && tgt.type === 'm' && !(tgt as Monster).def.boss) tgt.stunUntil = Math.max(tgt.stunUntil, t2 + 0.6);
        this.g.progress.onHit(p, this.weaponKind(p));
      }
    }, (ranged ? 0.25 : 0.2) * 1000);
  }

  // ------------------------------------------------------------------ dodge & parry
  parry(p: Player, now: number) {
    if (p.dead || now < p.parryCd || now < p.stunUntil) return;
    p.parryCd = now + 1.1;
    p.st.parryUntil = now + 0.38;
    p.anim = 'parry'; p.animUntil = now + 0.4;
    this.g.broadcastNear(p.s.x, p.s.z, 150, { type: 'fx', kind: 'parrystance', src: p.id, x: p.s.x, y: p.s.y, z: p.s.z });
  }

  // ------------------------------------------------------------------ damage
  /** Returns false when the hit was dodged, parried or blocked entirely. */
  damage(src: Ent, dst: Ent, atk: number, power: number, element: Element, now: number, o: { skill?: SkillDef; melee?: boolean; basic?: boolean; crit?: number; dot?: boolean } = {}): boolean {
    if (dst.dead) return false;
    const fxAt = (kind: 'dodge' | 'parry', text: string) => this.g.broadcastNear(dst.s.x, dst.s.z, 150, { type: 'fx', kind, src: src.id, dst: dst.id, x: dst.s.x, y: dst.s.y + 2.2, z: dst.s.z, text });
    const dp = dst.type === 'p' || dst.type === 'b' ? (dst as Player) : null;
    if (!o.dot) {
      // i-frames: dodge roll (physics-deterministic) or a skill's untouchable window
      if ((dst.s.dg ?? 0) > 0 || now < dst.st.iframesUntil) {
        fxAt('dodge', 'DODGE');
        if (dp) { dp.char.counters.dodges = (dp.char.counters.dodges ?? 0) + 1; this.g.progress.checkTitles(dp); }
        return false;
      }
      // parry: a melee hit inside the parry window is turned back
      if (dp && o.melee && now < dst.st.parryUntil) {
        fxAt('parry', 'PARRY!');
        src.stunUntil = Math.max(src.stunUntil, now + ((src as Monster).def?.boss ? 0.8 : 1.8));
        dp.st.parryUntil = 0;
        this.addBuff(dp, { crit: 1, dur: 2.5 }, now, 'riposte');
        dp.char.counters.parries = (dp.char.counters.parries ?? 0) + 1;
        this.g.progress.checkTitles(dp);
        return false;
      }
    }
    const isMon = dst.type === 'm';
    const def = this.defOf(dst, now);
    const weakTo = isMon ? (dst as Monster).def.weakTo : undefined;
    const sp = this.ownerOf(src);
    const critChance = o.crit ?? (sp ? sp.stats.crit + this.buffSum(sp, 'crit', now) : 0.08);
    let mul = 1;
    // elemental reactions on the target's statuses
    const st = dst.st;
    const react = o.dot ? null : reaction(element, { soaked: now < st.soakUntil, burning: now < st.burnUntil, chilled: now < st.chillUntil });
    if (react) {
      mul *= react.mul;
      this.g.broadcastNear(dst.s.x, dst.s.z, 150, { type: 'fx', kind: 'react', dst: dst.id, x: dst.s.x, y: dst.s.y + 2.8, z: dst.s.z, text: react.name });
      if (react.name === 'CONDUCTED') st.soakUntil = 0;
      if (react.name === 'SHATTER' || react.name === 'MELT') st.chillUntil = 0;
      if (sp) { sp.char.counters.reactions = (sp.char.counters.reactions ?? 0) + 1; this.g.progress.checkTitles(sp); }
    }
    if (now < st.markUntil) mul *= 1 + st.mark;
    // combo momentum: skills landing inside a live combo hit harder
    if (sp && o.skill && now - sp.combo.last < COMBO_WINDOW && sp.combo.n >= 3) mul *= 1.1;
    if (dp && now < (dp.weakUntil ?? 0)) mul *= 1.1; // soul-weary takes more damage
    if (src.type === 'p' || src.type === 'b') { if (now < ((src as Player).weakUntil ?? 0)) mul *= 0.85; }
    if (src.type === 'm' && (src as Monster).enraged) mul *= 1.35;
    const r = computeDamage({ atk, power: power * mul, def, element, weakTo, roll: this.g.rand(), critRoll: o.dot ? 1 : this.g.rand(), critChance });
    let dmg = r.dmg;
    // shields absorb first
    if (st.shield > 0 && now < st.shieldUntil) { const ab = Math.min(st.shield, dmg); st.shield -= ab; dmg -= ab; if (dmg <= 0) { this.g.broadcastNear(dst.s.x, dst.s.z, 150, { type: 'fx', kind: 'hit', src: src.id, dst: dst.id, amount: 0, text: 'ABSORBED', x: dst.s.x, y: dst.s.y + 2.1, z: dst.s.z }); return true; } }
    dst.hp -= dmg;
    if (dst.anim !== 'cast' && !o.dot) { dst.anim = 'hit'; dst.animUntil = now + 0.3; }
    this.g.broadcastNear(dst.s.x, dst.s.z, 150, { type: 'fx', kind: 'hit', src: src.id, dst: dst.id, amount: dmg, crit: r.crit, weak: r.weak, x: dst.s.x, y: dst.s.y + 2.1, z: dst.s.z, spell: o.dot ? 'dot' : o.skill?.id });
    // lifesteal
    if (sp) { const ls = this.buffSum(sp, 'lifesteal', now); if (ls > 0 && !o.dot) sp.hp = Math.min(sp.mhp, sp.hp + dmg * ls); }
    if (isMon) {
      const m = dst as Monster;
      const credit = sp ?? src;
      m.threat.set(credit.id, (m.threat.get(credit.id) ?? 0) + dmg * (src.type === 's' && (src as Summon).taunt ? 3 : 1));
      if (src.type === 's') m.threat.set(src.id, (m.threat.get(src.id) ?? 0) + dmg * ((src as Summon).taunt ? 4 : 0.5));
      m.lastHitBy = credit.id;
      if (m.ai === 'idle' || m.ai === 'patrol' || m.ai === 'return') { m.ai = 'chase'; m.target = src.type === 's' && (src as Summon).taunt ? src.id : credit.id; }
    } else if (dp) {
      dp.lastHurt = now;
      if (dp.casting && this.g.rand() < 0.2 && !o.dot) dp.casting = null;
    }
    if (sp && o.skill) { sp.combo = { n: (now - sp.combo.last < COMBO_WINDOW ? sp.combo.n : 0) + 1, last: now }; }
    if (dst.hp <= 0) this.g.kill(src, dst, now);
    return true;
  }

  // ------------------------------------------------------------------ per-tick statuses (dots, hots, shields)
  tickStatus(e: Ent, now: number) {
    const st = e.st;
    if (st.dots.length) {
      for (const d of st.dots) if (now >= d.next && d.until > now - 0.01) {
        d.next += 1;
        const src = this.g.ents.get(d.src) ?? e;
        if (src !== e) this.damage(src, e, d.dps, 1 / 2.2, d.el, now, { dot: true });
        if (e.dead) break;
      }
      st.dots = st.dots.filter((d) => d.until > now);
    }
    if (st.hots.length) {
      for (const h of st.hots) if (now >= h.next) { h.next += 1; this.heal(this.g.ents.get(h.src) ?? e, e, Math.round(h.hps), now); }
      st.hots = st.hots.filter((h) => h.until > now);
    }
    if (st.shield > 0 && now > st.shieldUntil) st.shield = 0;
    if (st.buffs.length && st.buffs.some((b) => b.until <= now)) st.buffs = st.buffs.filter((b) => b.until > now);
  }

  /** Short status words for the HUD and nameplates. */
  statusFlags(e: Ent, now: number): string {
    const st = e.st, f: string[] = [];
    if (now < e.stunUntil) f.push('stun');
    if (now < st.rootUntil) f.push('root');
    if (now < st.slowUntil) f.push('slow');
    if (now < st.markUntil) f.push('mark');
    if (now < st.soakUntil) f.push('soak');
    if (now < st.burnUntil) f.push('burn');
    if (now < st.chillUntil) f.push('chill');
    if (st.dots.length) f.push('dot');
    if (st.shield > 0) f.push('shield');
    if (st.buffs.some((b) => b.until > now && (b.atk > 0 || b.def > 0 || b.mag > 0 || b.spd > 0 || b.crit > 0))) f.push('buff');
    if (st.buffs.some((b) => b.until > now && (b.atk < 0 || b.def < 0))) f.push('weak');
    return f.join(',');
  }

  // ------------------------------------------------------------------ summons
  spawnSummon(p: Player, kind: string, dur: number, power: number, now: number): Summon {
    const d = SUMMON_DEFS[kind];
    const id = this.g.newId();
    const a = p.s.yaw + Math.PI * 0.75 + this.g.rand();
    const x = p.s.x + Math.sin(a) * 2, z = p.s.z + Math.cos(a) * 2;
    const hp = Math.round(p.mhp * d.hp);
    const s: Summon = {
      id, type: 's', s: newCharState(x, z, p.s.yaw), hp, mhp: hp, anim: 'spawn', animUntil: now + 1.2, name: `${p.name}'s ${d.name}`, model: kind, dead: false, stunUntil: 0, level: p.level,
      st: newStatus(), zone: p.zone, owner: p.id, kind, power, until: now + dur, target: 0, nextAttack: now + 1, taunt: kind === 'golem',
    };
    this.g.ents.set(id, s);
    return s;
  }
  tickSummon(s: Summon, now: number, dt: number) {
    const owner = this.g.players.get(s.owner);
    if (!owner || owner.dead || now > s.until || owner.zone !== s.zone) { this.g.broadcastNear(s.s.x, s.s.z, 150, { type: 'fx', kind: 'death', src: s.id, dst: s.id, x: s.s.x, y: s.s.y, z: s.s.z }); this.g.removeEnt(s.id); return; }
    const d = SUMMON_DEFS[s.kind];
    // pick a target: the owner's target, else the nearest monster near the owner
    let tgt = s.target ? this.g.ents.get(s.target) : undefined;
    if (!tgt || tgt.dead || Math.hypot(tgt.s.x - owner.s.x, tgt.s.z - owner.s.z) > 30) {
      tgt = undefined; let bd = 22;
      for (const e of this.g.ents.values()) if (e.type === 'm' && !e.dead && e.zone === s.zone) { const dd = Math.hypot(e.s.x - s.s.x, e.s.z - s.s.z); if (dd < bd) { bd = dd; tgt = e; } }
      s.target = tgt?.id ?? 0;
    }
    let gx = owner.s.x + Math.sin(owner.s.yaw + 2.2) * 2.5, gz = owner.s.z + Math.cos(owner.s.yaw + 2.2) * 2.5, stop = 1.2;
    if (tgt) { gx = tgt.s.x; gz = tgt.s.z; stop = d.range * 0.85; }
    const dx = gx - s.s.x, dz = gz - s.s.z, dist = Math.hypot(dx, dz);
    let yaw = Math.atan2(-dx, -dz), mz = dist > stop ? 1 : 0;
    if (dist > 40) { s.s = newCharState(owner.s.x + 1.5, owner.s.z + 1.5, owner.s.yaw); mz = 0; }
    if (mz) { const fx = -Math.sin(yaw), fz = -Math.cos(yaw); if (raycastWorld(s.s.x, s.s.y + 0.8, s.s.z, fx, 0, fz, 2) < 2) yaw += 0.9; }
    if (now < s.stunUntil) mz = 0;
    const inp: MoveInput = { seq: 0, mx: 0, mz, yaw, jump: false, sprint: false, walk: false, dt };
    stepSubC(s.s, inp, d.speed / PHYS.RUN);
    if (!mz && tgt) s.s.yaw = Math.atan2(-(tgt.s.x - s.s.x), -(tgt.s.z - s.s.z));
    if (tgt && dist <= d.range + 0.5 && now >= s.nextAttack && now >= s.stunUntil) {
      s.nextAttack = now + d.cd;
      s.anim = d.ranged ? 'castshoot' : 'attack'; s.animUntil = now + 0.6;
      this.g.broadcastNear(s.s.x, s.s.z, 150, { type: 'fx', kind: 'attack', src: s.id, dst: tgt.id, x: s.s.x, y: s.s.y, z: s.s.z, spell: d.ranged ? 'firebolt' : undefined });
      const t = tgt;
      setTimeout(() => { if (!t.dead && !s.dead && this.g.ents.has(s.id)) this.damage(s, t, this.magOf(owner, this.g.o.now()), s.power, d.el, this.g.o.now()); }, d.ranged ? 500 : 300);
    }
    if (now > s.animUntil) { const sp = Math.hypot(s.s.vx, s.s.vz); s.anim = sp > 2.5 ? 'run' : sp > 0.3 ? 'walk' : 'idle'; }
  }

  // ------------------------------------------------------------------ death penalty
  /** High-stakes death without permadeath: XP and gold are lost, and you come back Soul-Weary. */
  deathPenalty(p: Player): { xpLost: number; goldLost: number } {
    const xpLost = Math.min(p.char.xp, Math.round(xpToNext(p.char.level) * 0.08));
    p.char.xp -= xpLost;
    const goldLost = Math.floor((p.char.gold ?? 0) * 0.1);
    p.char.gold -= goldLost;
    return { xpLost, goldLost };
  }
}

function stepSubC(s: CharState, inp: MoveInput, mul: number) {
  const n = Math.max(1, Math.ceil(inp.dt / PHYS.DT));
  const sub = { ...inp, dt: inp.dt / n };
  for (let i = 0; i < n; i++) stepCharacter(s, sub, mul);
}
export { MONSTERS };
export type { MonsterDef };
