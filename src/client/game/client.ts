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
import { SPELLS, spellById, classById } from '../../shared/combat';
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
      case 'loot': this.hud.loot(m.items, m.gold); if (m.items.length) audio.loot(); break;
      case 'npcSay': this.hud.npcSay(m.npc, m.name, m.text, m.source); break;
      case 'quest': this.hud.setQuest(m.quest, m.event === 'discovered'); if (m.event === 'discovered') audio.questReveal(); break;
      case 'notice': this.hud.notice(m.text, m.style); if (m.style === 'levelup') audio.levelUp(); break;
      case 'died': this.dead = true; this.hud.showDeath(m.by); audio.death(); break;
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
    const s: CharState = { x: m.me.x, y: m.me.y, z: m.me.z, vx: m.me.vx, vy: m.me.vy, vz: m.me.vz, yaw: m.me.yaw, grounded: m.me.g, swimming: m.me.sw, coyote: 0 };
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
      r.ent = e;
      r.buf.push({ t: m.t, x: e.x, y: e.y, z: e.z, r: e.r });
    }
    for (const id of m.gone) { const r = this.remotes.get(id); if (r) { r.view.dispose(); r.plate.remove(); this.remotes.delete(id); } }
    if (this.targetId && !this.remotes.has(this.targetId)) this.targetId = 0;
    this.hud.updateSelf(m.self);
  }

  private speedMul() { return (this.casting ? 0.35 : 1) * this.myClass.spd; }

  private entPos(id: number): THREE.Vector3 | null {
    if (id === this.myId) return this.myView.root.position.clone();
    const r = this.remotes.get(id); return r ? r.view.root.position.clone() : null;
  }

  private onFx(m: Extract<S2C, { type: 'fx' }>) {
    const at = new THREE.Vector3(m.x ?? 0, m.y ?? 0, m.z ?? 0);
    const near = at.distanceTo(this.renderPos);
    const vol = Math.max(0, 1 - near / 80);
    switch (m.kind) {
      case 'cast': {
        const sp = spellById(m.spell!); if (!sp) break;
        const src = m.src!;
        this.vfx.castAura(() => (this.remotes.has(src) || src === this.myId ? this.entPos(src) : null), sp.id, sp.castTime);
        if (src !== this.myId) { if (vol > 0.2) audio.castCharge(sp.id, sp.castTime); const r = this.remotes.get(src); if (r) this.hud.chantBubble(r, sp); }
        break;
      }
      case 'spell': {
        const sp = spellById(m.spell!); if (!sp) break;
        if (vol > 0) audio.spell(sp.id);
        const src = this.entPos(m.src!) ?? at;
        const from = src.clone().add(new THREE.Vector3(-Math.sin(m.src === this.myId ? this.me.yaw : 0) * 0.6, 1.5, -Math.cos(m.src === this.myId ? this.me.yaw : 0) * 0.6));
        const to = new THREE.Vector3(m.tx ?? at.x, m.ty ?? at.y, m.tz ?? at.z);
        if (sp.id === 'ignis') this.vfx.ignis(from, to, () => { audio.explosion(); this.cam.addShake(Math.max(0, 1 - to.distanceTo(this.renderPos) / 30)); });
        else if (sp.id === 'fulgur') { this.vfx.fulgur(from, to); this.cam.addShake(Math.max(0, 0.6 - to.distanceTo(this.renderPos) / 50)); }
        else { this.vfx.lux(src); }
        break;
      }
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
          else if (r.t === 'm') this.vfx.slash(r.view.root.position, r.ent.r, 0xa0c0ff);
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

  /** Discrete actions (keys / buttons). */
  action(a: string) {
    if (this.hud.modalOpen() && a !== 'menu') return;
    const now = performance.now() / 1000;
    if (a === 'menu') return this.hud.toggleMenu();
    if (a === 'chat') return this.hud.focusChat();
    if (a === 'map') return this.hud.toggleMap();
    if (a === 'quests') return this.hud.toggleQuests();
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
    const sp = SPELLS.find((s) => 'spell' + s.key === a);
    if (sp) this.cast(sp.id);
  }

  cast(id: string) {
    const sp = spellById(id)!;
    const now = performance.now() / 1000;
    if (this.casting) return;
    const st = this.serverNow();
    if ((this.self.cds[id] ?? 0) > st) { this.hud.notice('Not ready yet', 'warn'); return; }
    if (this.self.mp < sp.mana) { this.hud.notice('Not enough mana', 'warn'); return; }
    let target = this.targetId && this.remotes.get(this.targetId)?.t === 'm' ? this.targetId : 0;
    if (!target && sp.kind !== 'nova') target = this.autoTarget(sp.range) ?? 0;
    const t = target ? this.remotes.get(target) : undefined;
    const yaw = t ? Math.atan2(-(t.view.root.position.x - this.me.x), -(t.view.root.position.z - this.me.z)) : this.cam.moveYaw;
    this.me.yaw = yaw;
    // aim point = what the crosshair looks at (for untargeted casts)
    const cam = this.engine.camera; const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const d = raycastWorld(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, sp.range + 10);
    const aim = cam.position.clone().addScaledVector(dir, d);
    this.net.send({ type: 'cast', spell: id, target: target || undefined, yaw, aimX: aim.x, aimY: aim.y, aimZ: aim.z });
    this.casting = { spell: id, until: now + sp.castTime, start: now };
    this.hud.startCast(sp);
    audio.castCharge(id, sp.castTime);
    audio.chant(`${sp.name}. ${sp.incantation}`);
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
      const inp: MoveInput = { seq: ++this.seq, mx: ax.mx, mz: ax.mz, yaw: this.cam.moveYaw, jump: !this.dead && !this.input.typing && (this.input.down('jump') || this.input.touchJump), sprint: this.input.down('sprint'), walk: this.input.walkToggle, dt: PHYS.DT };
      stepCharacter(this.me, inp, this.speedMul());
      this.pending.push(inp);
      this.net.send({ type: 'input', seq: inp.seq, mx: inp.mx, mz: inp.mz, yaw: +inp.yaw.toFixed(4), jump: inp.jump, sprint: inp.sprint, walk: inp.walk, dt: inp.dt });
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
    let anim = this.dead ? 'death' : !this.me.grounded && !this.me.swimming ? (this.me.vy > 1 ? 'jump' : 'fall') : this.me.swimming ? 'swim' : sp > 7 ? 'sprint' : sp > 3 ? 'run' : sp > 0.3 ? 'walk' : 'idle';
    if (this.me.grounded && !this.wasGrounded) { anim = 'land'; audio.footstep(false); }
    this.wasGrounded = this.me.grounded;
    if (this.casting) anim = 'cast';
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
