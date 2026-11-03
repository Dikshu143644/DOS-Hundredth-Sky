import { inventoryScreen } from '../ui/inventory';
import type { ClassId } from '../../shared/combat';
import * as THREE from 'three';
import type { Engine } from '../engine/engine';
import type { Transport } from '../net/transport';
import { CharacterView } from './character';
import { ThirdPersonCamera } from './camera';
import { Input } from './input';
import { VFX } from './vfx';
import { Hud } from './hud';
import { audio } from '../audio';
import { settings } from '../settings';
import { newCharState, stepCharacter, CharState, MoveInput, PHYS, raycastWorld } from '../../shared/physics';
import { InterpBuffer, PendingInputs, PingStats, lerpAngle } from '../../shared/netcode';
import { INTERP_DELAY_MS, NetEntity, S2C, CharacterSummary, SelfState } from '../../shared/protocol';
import { spellById, classById } from '../../shared/combat';
import { skillForSlot, rankScale, SkillDef } from '../../shared/skills';
import { heroPanel } from '../ui/hero';
import type { ProgressView } from '../../shared/protocol';
import { heightAt, WATER_LEVEL } from '../../shared/world';

interface Remote { id: number; t: NetEntity['t']; view: CharacterView; buf: InterpBuffer; ent: NetEntity; name: string; key: string; lv: number; plate: HTMLElement; lastPos: THREE.Vector3; speed: number }

/** Client game: owns the local player's predicted state, reconciles with the authoritative server,
 *  interpolates everyone else, and drives camera, input, VFX, audio and HUD. */
export class GameClient {
  me: CharState;
  myId = 0;
  myView!: CharacterView;
  cam: ThirdPersonCamera;
  input: Input;
  vfx: VFX;
  hud: Hud;
  remotes = new Map<number, Remote>();
  pending = new PendingInputs<MoveInput>();
  ping = new PingStats();
  seq = 0;
  acc = 0;
  serverTimeOffset = 0;        // serverTime ≈ performance.now()/1000 + offset
  self: SelfState;
  targetId = 0;
  casting: { spell: string; until: number; start: number } | null = null;
  animOverride: { name: string; until: number } | null = null;
  correction = new THREE.Vector3(); // visual smoothing of reconciliation snaps
  renderPos = new THREE.Vector3();
  dead = false;
  combatT = 0;
  stats = { corrections: 0, bigCorrections: 0 };
  private lastPing = 0;
  private wasGrounded = true;
  private lastNear = 0;
  running = true;

  constructor(public engine: Engine, public net: Transport, joined: Extract<S2C, { type: 'joined' }>) {
    this.myId = joined.id;
    this.self = joined.self;
    this.me = newCharState(0, -72, 0);
    this.cam = new ThirdPersonCamera(engine.camera);
    this.input = new Input(engine.canvas);
    this.vfx = new VFX(engine);
    this.hud = new Hud(this, joined.char);
    this.myView = new CharacterView('p', joined.char.cls, joined.char.appearance);
    this.cls = joined.char.cls;
    this.equipment = joined.equipment ?? {};
    this.myView.setWeapon(this.equipment.weapon ?? null, { light: settings.quality !== 'low', quality: settings.quality as any });
    this.myView.onStep = () => audio.footstep(engine.rainAmt > 0.2);
    engine.scene.add(this.myView.root);
    engine.hours = joined.worldTime;
    engine.weather = joined.weather;
    this.serverTimeOffset = joined.t - performance.now() / 1000;
    for (const q of joined.quests) this.hud.setQuest(q, false);
    this.hud.setInventory(joined.inventory);
    this.input.onAction = (a) => this.action(a);
    this.input.mountTouch(this.hud.root, (a) => this.action(a));
    net.onMessage = (m) => this.onMessage(m);
    this.sendPing();
  }

  get myClass() { return classById(this.hud.char.cls); }

  sendPing() { this.lastPing = performance.now(); this.net.send({ type: 'ping', t: performance.now(), rtt: this.ping.rtt }); }

  onMessage(m: S2C) {
    switch (m.type) {
      case 'pong': {
        const rtt = performance.now() - m.t;
        this.ping.add(rtt);
        this.serverTimeOffset = m.st + rtt / 2000 - performance.now() / 1000;
        break;
      }
      case 'snap': this.onSnap(m); break;
      case 'chat': this.hud.chat(m.from, m.text, m.channel); break;
      case 'fx': this.onFx(m); break;
      case 'loot': this.hud.loot(m.items, m.gold); if (m.items.length) audio.loot(); this.inv?.update(this.hud.inventory, this.equipment); break;
      case 'equipment':
        this.equipment = m.equipment; this.hud.setInventory(m.inventory);
        this.myView.setWeapon(m.equipment.weapon ?? null, { light: settings.quality !== 'low', quality: settings.quality as any });
        this.inv?.update(m.inventory, m.equipment);
        if (!m.ok && m.error) this.hud.notice(m.error, 'warn');
        break;
      case 'npcSay': this.hud.npcSay(m.npc, m.name, m.text, m.source); break;
      case 'quest': this.hud.setQuest(m.quest, m.event === 'discovered'); if (m.event === 'discovered') audio.questReveal(); break;
      case 'notice': this.hud.notice(m.text, m.style); if (m.style === 'levelup') audio.levelUp(); break;
      case 'died': this.dead = true; this.hud.showDeath(m.by, m); audio.death(); break;
      case 'progress': this.progress = m.p; this.hud.setProgress(m.p); this.heroUi?.update(m.p, this.self.level); break;
      case 'kick': this.hud.notice(m.reason, 'warn'); break;
    }
  }

  private onSnap(m: Extract<S2C, { type: 'snap' }>) {
    this.self = m.self;
    this.engine.hours = m.worldTime;
    this.engine.weather = m.weather;
    if (this.dead && m.self.hp > 0) { this.dead = false; this.hud.hideDeath(); this.me = newCharState(m.me.x, m.me.z, m.me.yaw); this.pending.list.length = 0; }
    // --- reconciliation: rewind to the server's state for the last acknowledged input, replay the rest
    const before = new THREE.Vector3(this.me.x, this.me.y, this.me.z);
    this.pending.ack(m.ack);
    const s: CharState = { x: m.me.x, y: m.me.y, z: m.me.z, vx: m.me.vx, vy: m.me.vy, vz: m.me.vz, yaw: m.me.yaw, grounded: m.me.g, swimming: m.me.sw, coyote: 0, dg: m.me.dg ?? 0, dc: m.me.dc ?? 0, ddx: m.me.ddx ?? 0, ddz: m.me.ddz ?? 0 };
    for (const inp of this.pending.list) stepCharacter(s, inp, this.speedMul());
    const err = Math.hypot(s.x - before.x, s.y - before.y, s.z - before.z);
    if (err > 0.01) {
      this.stats.corrections++;
      if (err > 2) { this.stats.bigCorrections++; this.correction.set(0, 0, 0); }
      else this.correction.add(before.clone().sub(new THREE.Vector3(s.x, s.y, s.z))); // hide the snap, decay it over a few frames
    }
    const yaw = this.me.yaw;
    this.me = s;
    this.me.yaw = yaw;
    // --- remote entities into interpolation buffers
    const seen = new Set<number>();
    for (const e of m.ents) {
      seen.add(e.id);
      let r = this.remotes.get(e.id);
      if (!r) {
        if (!e.k) continue; // wait for full info
        const view = new CharacterView(e.t, e.k, e.ap);
        this.engine.scene.add(view.root);
        const plate = this.hud.makePlate(e);
        r = { id: e.id, t: e.t, view, buf: new InterpBuffer(), ent: e, name: e.n ?? '?', key: e.k, lv: e.lv ?? 1, plate, lastPos: new THREE.Vector3(e.x, e.y, e.z), speed: 0 };
        this.remotes.set(e.id, r);
        view.root.position.set(e.x, e.y, e.z);
        if (e.t === 'p' || e.t === 'b') view.onStep = () => { if (view.root.position.distanceTo(this.renderPos) < 18) audio.footstep(this.engine.rainAmt > 0.2); };
      }
      if ((e.t === 'p' || e.t === 'b') && (e.w ?? null) !== r.view.weaponId) r.view.setWeapon(e.w ?? null, { quality: settings.quality as any });
      r.ent = e;
      r.buf.push({ t: m.t, x: e.x, y: e.y, z: e.z, r: e.r });
    }
    for (const id of m.gone) { const r = this.remotes.get(id); if (r) { r.view.dispose(); r.plate.remove(); this.remotes.delete(id); } }
    if (this.targetId && !this.remotes.has(this.targetId)) this.targetId = 0;
    this.hud.updateSelf(m.self);
  }

  private speedMul() { return this.self.sm ?? (this.casting ? 0.35 : 1) * this.myClass.spd; }

  private entPos(id: number): THREE.Vector3 | null {
    if (id === this.myId) return this.myView.root.position.clone();
    const r = this.remotes.get(id); return r ? r.view.root.position.clone() : null;
  }

  private onFx(m: Extract<S2C, { type: 'fx' }>) {
    const at = new THREE.Vector3(m.x ?? 0, m.y ?? 0, m.z ?? 0);
    const at0 = at;
    const near = at.distanceTo(this.renderPos);
    const vol = Math.max(0, 1 - near / 80);
    switch (m.kind) {
      case 'cast': {
        if (m.spell?.startsWith('boss_')) { // telegraphed boss attack: show the danger zone
          const r = this.remotes.get(m.src!);
          const at = r ? r.view.root.position.clone() : at0;
          if (m.amount) this.vfx.telegraph(at, m.amount, 0xff3020, 1.2, m.spell === 'boss_breath' ? 1.05 : undefined)?.rotation.set(-Math.PI / 2, 0, m.spell === 'boss_breath' ? (r?.ent.r ?? 0) : 0);
          if (m.spell === 'boss_volley' || m.spell === 'boss_charge') this.vfx.aura(() => this.entPos(m.src!), 0xff4030, 1.2);
          this.hud.notice(`${r?.name ?? 'The boss'} prepares ${m.text === 'slam' ? 'a GROUND SLAM' : m.text === 'breath' ? 'a BREATH attack' : m.text === 'volley' ? 'a VOLLEY' : m.text === 'charge' ? 'to CHARGE' : 'to call ADDS'} — dodge!`, 'warn');
          break;
        }
        const sp = spellById(m.spell!); if (!sp) break;
        const src = m.src!;
        this.vfx.castAura(() => (this.remotes.has(src) || src === this.myId ? this.entPos(src) : null), sp.id, sp.castTime);
        if (src !== this.myId) { if (vol > 0.2) audio.castCharge(sp.id, sp.castTime); const r = this.remotes.get(src); if (r) this.hud.chantBubble(r, sp); }
        break;
      }
      case 'spell': {
        if (m.spell?.startsWith('boss_')) { const p = this.entPos(m.src!) ?? at; if (m.spell === 'boss_breath') this.vfx.explosion(p.clone().add(new THREE.Vector3(-Math.sin(this.remotes.get(m.src!)?.ent.r ?? 0) * 5, 1, -Math.cos(this.remotes.get(m.src!)?.ent.r ?? 0) * 5)), 0xff5a1a, 5); else this.vfx.quake(p, m.amount ?? 6, 0xff6040); this.cam.addShake(Math.max(0, 1 - p.distanceTo(this.renderPos) / 25)); if (vol > 0) audio.explosion(); break; }
        const sp = spellById(m.spell!); if (!sp) break;
        if (vol > 0) audio.spell(sp.fx === 'ignis' || sp.fx === 'meteor' ? 'ignis' : sp.fx === 'fulgur' ? 'fulgur' : sp.fx === 'lux' || sp.fx === 'heal' || sp.kind === 'buff' ? 'lux' : sp.scale === 'mag' ? 'fulgur' : 'ignis');
        const src = this.entPos(m.src!) ?? at;
        const yaw = m.src === this.myId ? this.me.yaw : (this.remotes.get(m.src!)?.ent.r ?? 0);
        const from = src.clone().add(new THREE.Vector3(-Math.sin(yaw) * 0.6, 1.5, -Math.cos(yaw) * 0.6));
        const to = new THREE.Vector3(m.tx ?? at.x, m.ty ?? at.y, m.tz ?? at.z);
        this.skillFx(sp, src, from, to, m.dst, yaw);
        break;
      }
      case 'dash': {
        const sp = m.spell ? spellById(m.spell) : undefined;
        const from = at.clone(), to = new THREE.Vector3(m.tx ?? at.x, m.ty ?? at.y, m.tz ?? at.z);
        this.vfx.dashTrail(from, to, sp?.color ?? 0xff6040);
        if (m.src === this.myId) { this.me.x = to.x; this.me.y = to.y; this.me.z = to.z; this.me.vx = this.me.vy = this.me.vz = 0; this.pending.list.length = 0; this.correction.set(0, 0, 0); }
        if (sp && (sp.fx === 'quake' || sp.radius > 0)) setTimeout(() => this.vfx.quake(to, sp.radius, sp.color), 60);
        if (vol > 0) audio.swing();
        break;
      }
      case 'buff': { const sp = m.spell ? spellById(m.spell) : undefined; this.vfx.aura(() => this.entPos(m.dst!), sp?.color ?? 0xffe9a8, 1.4); break; }
      case 'combo': if (m.text === 'FINISHER') { this.cam.addShake(0.25); const t = this.targetId ? this.entPos(this.targetId) : null; if (t) this.vfx.quake(t, 2, 0xffd9a0); } break;
      case 'dodge': case 'parry': case 'react': case 'status': {
        const p = m.dst !== undefined ? this.entPos(m.dst) : at; if (!p) break;
        const col = m.kind === 'parry' ? 0xffe9a8 : m.kind === 'dodge' ? 0xc8ffe8 : m.kind === 'react' ? 0xff9a40 : 0xd0d0ff;
        this.hud.floatWord(p.clone().setY(p.y + (m.kind === 'react' ? 2.9 : 2.5)), m.text ?? '', col, m.kind === 'react' || m.kind === 'parry');
        if (m.kind === 'parry') { this.vfx.floatText(p.clone().setY(p.y + 1.3), col); this.cam.addShake(0.2); if (vol > 0) audio.hit(true); }
        if (m.kind === 'react') this.vfx.nova(p, 2.5, col);
        break;
      }
      case 'parrystance': { const r = this.remotes.get(m.src!); if (r) r.view.update(0, 'parry', 0); break; }
      case 'hit': {
        if (m.dst === undefined) break; // projectile impact handled by spell fx
        const p = this.entPos(m.dst); if (!p) break;
        this.vfx.hit(p.clone().setY(p.y + 1.1));
        this.hud.damageNumber(p.clone().setY(p.y + 2.2), m.amount!, m.crit, m.weak, m.dst === this.myId);
        if (m.dst === this.myId) { this.engine.hurt = Math.min(1, this.engine.hurt + 0.5); this.cam.addShake(0.3); this.combatT = 6; }
        else { const r = this.remotes.get(m.dst); r?.view.hitFlash(); if (m.src === this.myId) { this.combatT = 6; this.targetId = this.targetId || m.dst; } }
        if (vol > 0) audio.hit(m.crit);
        break;
      }
      case 'heal': { const p = this.entPos(m.dst!); if (p) this.hud.damageNumber(p.clone().setY(p.y + 2.2), m.amount!, false, false, false, true); break; }
      case 'attack': {
        const src = m.src!;
        if (src === this.myId) break; // own swing already played predictively
        const r = this.remotes.get(src);
        if (r) {
          if (m.spell === 'bolt' && m.dst !== undefined) { const to = this.entPos(m.dst); if (to) this.vfx.bolt(r.view.root.position.clone().setY(r.view.root.position.y + 1.6), to.setY(to.y + 1.1)); }
          else if (m.spell === 'firebolt' && m.dst !== undefined) { const to = this.entPos(m.dst); if (to) this.vfx.orb(r.view.root.position.clone().setY(r.view.root.position.y + 1.6), to.setY(to.y + 1.1), 0xff8a3a, 26); }
          else if (r.t === 'm' || r.t === 's') this.vfx.slash(r.view.root.position, r.ent.r, r.t === 's' ? 0x9fe8ff : 0xa0c0ff);
          else { const c = classById(r.key); if (c.weapon === 'bow' || c.weapon === 'staff') { const tgt = this.nearestMonsterTo(r.view.root.position, r.ent.r); if (tgt) this.vfx.arrow(r.view.root.position.clone().setY(r.view.root.position.y + 1.4), tgt.setY(tgt.y + 1.1), c.weapon === 'staff' ? 0xa0f0ff : 0xfff0d0); } else this.vfx.slash(r.view.root.position, r.ent.r); }
          if (vol > 0.3) audio.swing();
        }
        break;
      }
      case 'death': { const p = this.entPos(m.dst!); if (p) this.vfx.death(p); if (m.dst === this.targetId) this.targetId = 0; break; }
      case 'levelup': { const p = this.entPos(m.src!); if (p) this.vfx.levelUp(p); break; }
      case 'loot': this.vfx.loot(at, (m.text ?? '').includes('Rare') || (m.text ?? '').includes('Epic')); break;
      case 'castfail': this.hud.notice(m.text ?? 'Cannot cast', 'warn'); this.casting = null; this.hud.endCast(); break;
    }
  }

  private nearestMonsterTo(p: THREE.Vector3, yaw: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, bd = 30;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const r of this.remotes.values()) {
      if (r.t !== 'm' || r.ent.hp <= 0) continue;
      const d = r.view.root.position.distanceTo(p);
      const dot = ((r.view.root.position.x - p.x) * fx + (r.view.root.position.z - p.z) * fz) / Math.max(d, 0.01);
      if (d < bd && dot > 0.5) { bd = d; best = r.view.root.position.clone(); }
    }
    return best;
  }

  cls: ClassId = 'knight';
  equipment: Record<string, string> = {};
  inv: ReturnType<typeof inventoryScreen> | null = null;
  openInventory() {
    if (this.inv) { this.inv.close(); return; }
    document.exitPointerLock?.();
    this.inv = inventoryScreen({
      inv: this.hud.inventory, equipment: this.equipment, cls: this.cls,
      onEquip: (id) => this.net.send({ type: 'equip', item: id }),
      onUnequip: (slot) => this.net.send({ type: 'unequip', slot }),
      onArmory: (id) => (window as any).__dos?.openArmory?.(id),
      onClose: () => { this.inv = null; },
    });
  }

  /** Discrete actions (keys / buttons). */
  action(a: string) {
    if (this.hud.modalOpen() && a !== 'menu') return;
    const now = performance.now() / 1000;
    if (a === 'menu') return this.hud.toggleMenu();
    if (a === 'chat') return this.hud.focusChat();
    if (a === 'map') return this.hud.toggleMap();
    if (a === 'quests') return this.hud.toggleQuests();
    if (a === 'inventory') return this.openInventory();
    if (a === 'armory') return (window as any).__dos?.openArmory?.(this.equipment.weapon);
    if (a === 'hero') return this.openHero();
    if (this.dead) return;
    if (a === 'target') return this.cycleTarget();
    if (a === 'interact') return this.interact();
    if (a === 'attack') {
      if (this.casting) return;
      const t = this.targetId ? this.remotes.get(this.targetId) : undefined;
      const yaw = t ? Math.atan2(-(t.view.root.position.x - this.me.x), -(t.view.root.position.z - this.me.z)) : this.cam.moveYaw;
      this.me.yaw = yaw;
      this.net.send({ type: 'attack', yaw, target: this.targetId || undefined });
      const c = this.myClass;
      if (c.weapon === 'bow' || c.weapon === 'staff') {
        this.animOverride = { name: c.weapon === 'bow' ? 'shoot' : 'castshoot', until: now + 0.6 };
        const to = t ? t.view.root.position.clone().setY(t.view.root.position.y + 1.1) : this.renderPos.clone().add(new THREE.Vector3(-Math.sin(yaw) * 20, 1.2, -Math.cos(yaw) * 20));
        this.vfx.arrow(this.renderPos.clone().setY(this.renderPos.y + 1.4), to, c.weapon === 'staff' ? 0xa0f0ff : 0xfff0d0);
      } else { this.animOverride = { name: Math.random() < 0.5 ? 'attack' : 'attack2', until: now + 0.65 }; setTimeout(() => this.vfx.slash(this.renderPos, yaw), 180); }
      audio.swing();
      this.combatT = 6;
      return;
    }
    if (a === 'dodge') { if (!this.me.grounded || (this.me.dc ?? 0) > 0) return; this.dodgeQueued = true; return; }
    if (a === 'parry') { if (now < this.parryCdLocal) return; this.parryCdLocal = now + 1.1; this.net.send({ type: 'parry' }); this.animOverride = { name: 'parry', until: now + 0.45 }; return; }
    const m = /^spell([1-5])$/.exec(a);
    const slot = m ? Number(m[1]) : a === 'ult' ? 6 : 0;
    if (slot) {
      const sp = skillForSlot(this.cls, slot, this.progress?.adv ?? null);
      if (!sp) { if (slot === 5) this.hud.notice('Choose an advanced class at level 20 (P)', 'warn'); return; }
      if (this.self.level < sp.unlock) { this.hud.notice(`${sp.name} unlocks at level ${sp.unlock}`, 'warn'); return; }
      this.cast(sp.id);
    }
  }
  progress: ProgressView | null = null;
  heroUi: ReturnType<typeof heroPanel> | null = null;
  dodgeQueued = false;
  parryCdLocal = 0;
  openHero() {
    if (this.heroUi) { this.heroUi.close(); return; }
    document.exitPointerLock?.();
    this.heroUi = heroPanel({ cls: this.cls, level: this.self.level, progress: this.progress, send: (m) => this.net.send(m), onClose: () => { this.heroUi = null; } });
  }

  /** Draw a class skill (server already decided what it hit). */
  private skillFx(sp: SkillDef, src: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3, dst: number | undefined, yaw: number) {
    const shake = (k: number) => this.cam.addShake(Math.max(0, k - to.distanceTo(this.renderPos) / 40));
    switch (sp.fx) {
      case 'ignis': if (sp.kind === 'projectile') this.vfx.ignis(from, to, () => { audio.explosion(); shake(1); }); else { this.vfx.explosion(sp.kind === 'nova' ? src.clone().setY(src.y + 1) : to, sp.color, sp.radius); shake(0.9); audio.explosion(); } break;
      case 'fulgur': this.vfx.fulgur(from, to); shake(0.6); break;
      case 'lux': this.vfx.lux(sp.kind === 'strike' ? to : src); break;
      case 'meteor': this.vfx.meteor(to, sp.color, sp.radius, () => { audio.explosion(); shake(1.2); }); break;
      case 'frost': if (sp.kind === 'projectile') this.vfx.orb(from, to, sp.color, 32); else this.vfx.nova(to, sp.radius, sp.color); break;
      case 'arrow': this.vfx.arrow(from, to, sp.color); break;
      case 'rain': this.vfx.arrowRain(to, sp.radius, sp.color); break;
      case 'quake': this.vfx.quake(sp.kind === 'strike' ? to : src, sp.radius, sp.color); shake(0.5); break;
      case 'slash': { const n = sp.kind === 'cone' ? 3 : 1; for (let i = 0; i < n; i++) setTimeout(() => this.vfx.slash(src, yaw + (i - 1) * 0.35, sp.color), i * 60); break; }
      case 'shadow': if (sp.kind === 'cone' || sp.kind === 'nova') { for (let i = 0; i < 6; i++) setTimeout(() => this.vfx.slash(src, yaw + i * 1.05, sp.color), i * 50); this.vfx.nova(src, sp.radius || 4, sp.color); } else this.vfx.nova(to, sp.radius || 3, sp.color); break;
      case 'gale': case 'ring': this.vfx.nova(sp.kind === 'strike' ? to : src, sp.radius || 4, sp.color); break;
      case 'aura': this.vfx.aura(() => src, sp.color, 1.2); if (sp.radius > 2) this.vfx.nova(src, sp.radius, sp.color); break;
      case 'heal': { const p = dst !== undefined ? this.entPos(dst) : src; if (p) this.vfx.heal(p, sp.color); if (sp.kind === 'nova') this.vfx.nova(src, sp.radius, sp.color); break; }
      case 'summon': { const p = dst !== undefined ? this.entPos(dst) ?? to : to; this.vfx.nova(p, 2.5, sp.color); this.vfx.lux(p); break; }
      case 'dash': this.vfx.nova(to, sp.radius || 3, sp.color); break;
    }
  }

  cast(id: string) {
    const sp = spellById(id)!;
    const now = performance.now() / 1000;
    if (this.casting) return;
    const st = this.serverNow();
    const rs = rankScale(sp, this.progress?.ranks[id] ?? 1);
    if ((this.self.cds[id] ?? 0) > st) { this.hud.notice('Not ready yet', 'warn'); return; }
    if (this.self.mp < rs.mana) { this.hud.notice('Not enough mana', 'warn'); return; }
    const hostile = this.targetId && this.remotes.get(this.targetId)?.t === 'm';
    let target = hostile ? this.targetId : 0;
    if (sp.kind === 'heal') { const r = this.targetId ? this.remotes.get(this.targetId) : undefined; target = r && (r.t === 'p' || r.t === 'b') ? r.id : 0; }
    else if (!target && sp.range > 0) target = this.autoTarget(sp.range) ?? 0;
    const t = target ? this.remotes.get(target) : undefined;
    const yaw = t ? Math.atan2(-(t.view.root.position.x - this.me.x), -(t.view.root.position.z - this.me.z)) : this.cam.moveYaw;
    this.me.yaw = yaw;
    // aim point = what the crosshair looks at (for untargeted casts)
    const cam = this.engine.camera; const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const d = raycastWorld(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, sp.range + 10);
    const aim = cam.position.clone().addScaledVector(dir, d);
    this.net.send({ type: 'cast', spell: id, target: target || undefined, yaw, aimX: aim.x, aimY: aim.y, aimZ: aim.z });
    if (sp.castTime > 0.25) {
      this.casting = { spell: id, until: now + sp.castTime, start: now };
      this.hud.startCast(sp);
      audio.castCharge(sp.fx === 'fulgur' ? 'fulgur' : sp.fx === 'lux' || sp.fx === 'heal' ? 'lux' : 'ignis', sp.castTime);
    } else this.animOverride = { name: sp.scale === 'mag' ? 'castshoot' : sp.kind === 'dash' ? 'attack2' : 'attack', until: now + 0.5 };
    if (sp.incantation) audio.chant(`${sp.name}. ${sp.incantation}`);
    this.combatT = 6;
  }

  private autoTarget(range: number): number | null {
    let best = 0, bs = 1e9;
    const yaw = this.cam.moveYaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const r of this.remotes.values()) {
      if (r.t !== 'm' || r.ent.hp <= 0) continue;
      const dx = r.view.root.position.x - this.me.x, dz = r.view.root.position.z - this.me.z, d = Math.hypot(dx, dz);
      if (d > range) continue;
      const dot = (dx * fx + dz * fz) / Math.max(d, 0.01);
      if (dot < 0.55) continue;
      const score = d * (2 - dot);
      if (score < bs) { bs = score; best = r.id; }
    }
    return best || null;
  }

  cycleTarget() {
    const list = [...this.remotes.values()].filter((r) => r.t === 'm' && r.ent.hp > 0 && r.view.root.position.distanceTo(this.renderPos) < 35).sort((a, b) => a.view.root.position.distanceTo(this.renderPos) - b.view.root.position.distanceTo(this.renderPos));
    if (!list.length) { this.targetId = 0; return; }
    const i = list.findIndex((r) => r.id === this.targetId);
    this.targetId = list[(i + 1) % list.length].id;
  }

  interact() {
    let best: Remote | null = null, bd = 5.5;
    for (const r of this.remotes.values()) { if (r.t !== 'n') continue; const d = r.view.root.position.distanceTo(this.renderPos); if (d < bd) { bd = d; best = r; } }
    if (best) { this.net.send({ type: 'interact', target: best.id }); this.hud.openDialog(best.id, best.name, best.key); }
  }
  nearestNpc(): Remote | null {
    let best: Remote | null = null, bd = 5.5;
    for (const r of this.remotes.values()) { if (r.t !== 'n') continue; const d = r.view.root.position.distanceTo(this.renderPos); if (d < bd) { bd = d; best = r; } }
    return best;
  }

  serverNow() { return performance.now() / 1000 + this.serverTimeOffset; }

  update(dt: number) {
    const now = performance.now() / 1000;
    if (now * 1000 - this.lastPing > 1000) this.sendPing();
    // look
    const look = this.input.consumeLook();
    this.cam.rotate(look.dx, look.dy);
    if (this.input.wheel) this.cam.zoom(this.input.wheel * 0.8);
    // fixed-step prediction at 60 Hz
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= PHYS.DT) {
      this.acc -= PHYS.DT;
      const ax = this.dead ? { mx: 0, mz: 0 } : this.input.axes();
      const inp: MoveInput = { seq: ++this.seq, mx: ax.mx, mz: ax.mz, yaw: this.cam.moveYaw, jump: !this.dead && !this.input.typing && (this.input.down('jump') || this.input.touchJump), sprint: this.input.down('sprint'), walk: this.input.walkToggle, dt: PHYS.DT, dodge: this.dodgeQueued && !this.dead };
      this.dodgeQueued = false;
      stepCharacter(this.me, inp, this.speedMul());
      this.pending.push(inp);
      this.net.send({ type: 'input', seq: inp.seq, mx: inp.mx, mz: inp.mz, yaw: +inp.yaw.toFixed(4), jump: inp.jump, sprint: inp.sprint, walk: inp.walk, dt: inp.dt, dodge: inp.dodge || undefined });
    }
    // casting state
    if (this.casting && now >= this.casting.until) { this.casting = null; this.animOverride = { name: 'castshoot', until: now + 0.5 }; this.hud.endCast(); }
    if (this.casting) this.hud.castProgress((now - this.casting.start) / (this.casting.until - this.casting.start));
    // render position = predicted + decaying correction offset
    this.correction.multiplyScalar(Math.exp(-dt * 12));
    this.renderPos.set(this.me.x, this.me.y, this.me.z).add(this.correction);
    const v = this.myView.root;
    v.position.copy(this.renderPos);
    v.rotation.y = lerpAngle(v.rotation.y, this.me.yaw + Math.PI, Math.min(1, dt * 14));
    const sp = Math.hypot(this.me.vx, this.me.vz);
    let anim = this.dead ? 'death' : !this.me.grounded && !this.me.swimming ? (this.me.vy > 1 ? 'jump' : 'fall') : this.me.swimming ? 'swim' : sp > 4.8 ? 'sprint' : sp > 2.2 ? 'run' : sp > 0.25 ? 'walk' : 'idle';
    if (this.me.grounded && !this.wasGrounded) { anim = 'land'; audio.footstep(false); }
    this.wasGrounded = this.me.grounded;
    if (this.casting) anim = 'cast';
    if ((this.me.dg ?? 0) > 0) anim = 'roll';
    if (this.animOverride && now < this.animOverride.until && !this.dead) anim = this.animOverride.name;
    this.myView.update(dt, anim, sp);
    // remotes: interpolate INTERP_DELAY behind server time
    const rt = this.serverNow() - INTERP_DELAY_MS / 1000;
    for (const r of this.remotes.values()) {
      const s = r.buf.sample(rt);
      if (s) {
        r.view.root.position.set(s.x, s.y, s.z);
        r.view.root.rotation.y = lerpAngle(r.view.root.rotation.y, s.r + Math.PI, Math.min(1, dt * 12));
      }
      r.speed = r.view.root.position.distanceTo(r.lastPos) / Math.max(dt, 1e-3);
      r.lastPos.copy(r.view.root.position);
      const a = r.ent.hp <= 0 ? 'death' : r.ent.a;
      const vis = r.view.root.position.distanceTo(this.renderPos) < 120;
      r.view.root.visible = vis;
      if (vis) r.view.update(dt, a === 'talk' ? 'interact' : a, r.speed);
      if (r.ent.c && r.t !== 'm') { /* remote casting handled by fx */ }
    }
    // camera, engine focus, audio
    this.cam.update(dt, this.renderPos);
    this.engine.focus.copy(this.renderPos);
    this.engine.lowHp = this.self.hp / Math.max(1, this.self.mhp) < 0.3 ? 0.6 : 0;
    this.combatT = Math.max(0, this.combatT - dt);
    audio.setWorld({ night: this.engine.env.night, rain: this.engine.rainAmt, wind: this.engine.env.overcast, combat: this.combatT > 0 ? 1 : 0 });
    this.vfx.update(dt);
    if (now - this.lastNear > 0.25) { this.lastNear = now; this.hud.setHint(this.nearestNpc()); }
    this.hud.update(dt);
    this.input.endFrame();
  }

  waterline() { return this.me.y < WATER_LEVEL && heightAt(this.me.x, this.me.z) < WATER_LEVEL; }
}
