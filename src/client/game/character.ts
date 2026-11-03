import * as THREE from 'three';
import { makeCharacter, makeBeast, CharacterRig, AnimName } from '../engine/assets';
import { makeHero, heroModel, UAL_GAIT, HeroRig } from '../engine/heroes';
import { makeCloak, CloakFX } from '../engine/cloak';
import { buildWeapon, WeaponFX, WeaponModel } from '../engine/weapons';
import { ITEMS } from '../../shared/items';
import { classById, MONSTERS, MonsterKind } from '../../shared/combat';
import { SUMMONS } from '../../shared/skills';
import { NPCS } from '../../server/core/npcdefs';
import type { Appearance } from '../../shared/protocol';

/** Cloak cloth per class (and the two named NPCs), warm and muted like the reference. */
const CLOAK_COLORS: Record<string, number> = { warrior: 0x7a2e22, knight: 0x2c3e66, mage: 0x4a2f6e, archer: 0x3d5232, assassin: 0x2b2a2e, summoner: 0x55306a, healer: 0xe6dcc6, aldric: 0x2c3e66, lyra: 0xd6c4a0 };

const ONE_SHOT = new Set<AnimName>(['attack', 'attack2', 'shoot', 'castshoot', 'hit', 'death', 'jump', 'land', 'spawn', 'taunt', 'roll', 'parry']);

/** A rendered character: skinned model + animation state machine with cross-fades,
 *  speed-matched locomotion (feet don't skate), one-shots and footstep events. */
export class CharacterView {
  root = new THREE.Group();
  rig: CharacterRig | null = null;
  current: THREE.AnimationAction | null = null;
  currentName: AnimName | '' = '';
  oneShotUntil = 0;
  speed = 0;
  onStep?: () => void;
  private stepPhase = 0;
  ready: Promise<void>;
  flash = 0;

  constructor(public kind: 'p' | 'b' | 'm' | 'n' | 's', public key: string, ap?: Appearance) {
    let model = 'Knight', hide: string[] = [], skeleton = false, tint: number | undefined, accent: number | undefined, headgear = true, cape = true, scale = 1;
    if (kind === 'p' || kind === 'b') {
      const c = classById(key);
      model = c.model; hide = c.hide;
      if (ap) { tint = ap.tint; accent = ap.accent; headgear = ap.headgear; cape = ap.cape; scale = ap.scale; }
      if (key === 'summoner') accent = accent ?? 0x9b6bff;
      if (key === 'healer') tint = tint ?? 0xfff6e0;
    } else if (kind === 'm') {
      const m = MONSTERS[key as MonsterKind] ?? MONSTERS.minion;
      model = m.model; skeleton = true; scale = m.scale ?? (key === 'warrior' ? 1.12 : 1); tint = m.tint;
      if (m.boss && !m.model.startsWith('q:')) this.height = 2.2 * scale;
      if (m.model.startsWith('q:')) this.beast = { file: m.model.slice(2), tint: m.tint, height: m.height ?? 1.6 };
    } else if (kind === 's' && NPCS.some((n) => n.key === key && n.body)) {
      model = 'Knight'; scale = 1; // a companion: drawn as the person, not a spirit
    } else if (kind === 's') {
      const s = SUMMONS[key] ?? SUMMONS.wolf;
      model = s.model; skeleton = true; scale = s.scale; tint = s.tint; this.spirit = s.tint;
    } else {
      const d = NPCS.find((n) => n.key === key);
      model = d?.model ?? 'Knight'; tint = d?.tint; scale = d?.important ? 1.02 : 0.98;
      hide = model === 'Knight' ? ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', '2H_Sword'] : model === 'Mage' ? ['Spellbook', '1H_Wand'] : model === 'Barbarian' ? ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '2H_Axe', 'Mug'] : ['1H_Crossbow', '2H_Crossbow', 'Throwable', 'Knife_Offhand'];
      if (key === 'borin') hide = ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '2H_Axe'];
    }
    const heroNpc: Record<string, [string, number?]> = { aldric: ['Knight_Male'], lyra: ['Wizard_Female_Long', 0xd8c8ff], borin: ['Peasant_Male_SimpleParted'], sela: ['Noble_Female_Long'], guard1: ['Knight_Male', 0xb8c8ff], guard2: ['Knight_Male', 0xb8c8ff], mira: ['Peasant_Female_Long'] };
    const npcDef = kind === 'n' || kind === 's' ? NPCS.find((n) => n.key === key) : undefined;
    if (!heroNpc[key] && npcDef?.body) heroNpc[key] = [npcDef.body, npcDef.tint === 0xffffff ? undefined : npcDef.tint];
    if (kind === 'p' || kind === 'b' || ((kind === 'n' || kind === 's') && heroNpc[key])) {
      // realistic-proportioned hero body (phase 2)
      const isNpc = kind === 'n' || kind === 's';
      const hm = isNpc ? heroNpc[key][0] : heroModel(key, ap?.body ?? 'm');
      const look = isNpc ? { tint: heroNpc[key][1], scale: key === 'mira' ? 0.97 : 1 } : { tint: tint === 0xffffff ? undefined : tint, accent, headgear, scale };
      const wantCloak = (kind === 'p' || kind === 'b') ? (ap?.cape ?? true) : (key === 'aldric' || key === 'lyra');
      this.ready = makeHero(hm, look).then((rig) => {
        this.rig = rig; this.hero = rig; this.root.add(rig.root);
        // phase 3: every hero wears a cloth cloak in the title-menu style (class-coloured, wind + run trail)
        if (wantCloak) {
          const base = CLOAK_COLORS[key] ?? 0xd6c4a0;
          const col = ap?.accent !== undefined && kind !== 'n' ? new THREE.Color(base).lerp(new THREE.Color(ap.accent), 0.08).getHex() : base;
          this.cloak = makeCloak(rig.root, { color: col, length: 1.05, width: 0.72 });
        }
        this.play('idle', 0); if (this.pendingWeapon !== undefined) this.setWeapon(this.pendingWeapon);
      });
    } else if (this.beast) {
      const b = this.beast;
      this.height = b.height;
      this.ready = makeBeast(b.file, { tint: b.tint, height: b.height }).then((rig) => { this.rig = rig; this.root.add(rig.root); this.play('idle', 0); });
    } else {
      this.ready = makeCharacter(model, { hide, skeleton, tint, accent, headgear, cape, scale }).then((rig) => {
        this.rig = rig;
        this.root.add(rig.root);
        if (this.spirit !== undefined) { // summoned spirits: glowing, half-transparent
          rig.root.traverse((o) => { const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (mm && (o as THREE.Mesh).isMesh) { const c = mm.clone(); c.transparent = true; c.opacity = 0.72; c.emissive = new THREE.Color(this.spirit!); c.emissiveIntensity = 0.9; c.depthWrite = false; (o as THREE.Mesh).material = c; } });
        }
        this.play('idle', 0);
      });
    }
  }

  hero: HeroRig | null = null;
  /** nameplate height (m) for big models; 0 = default */
  height = 0;
  beast: { file: string; tint?: number; height: number } | null = null;
  spirit: number | undefined = undefined;
  cloak: CloakFX | null = null;
  weapon: WeaponFX | null = null;
  weaponId: string | null = null;
  private pendingWeapon: string | null | undefined = undefined;
  /** Put an item's weapon model in the right hand (legendaries keep their particle aura). */
  setWeapon(itemId: string | null, o: { light?: boolean; quality?: 'low' | 'medium' | 'high' | 'ultra' } = {}) {
    if (!this.hero) { this.pendingWeapon = itemId; return; }
    if (itemId === this.weaponId && this.weapon) return;
    this.weapon?.group.removeFromParent();
    this.weapon = null; this.weaponId = itemId;
    const d = itemId ? ITEMS[itemId] : undefined;
    if (!d?.model || !this.hero.hand) return;
    const fx = buildWeapon(d.model as WeaponModel, { light: o.light ?? false, quality: o.quality, aura: o.quality !== 'low' });
    // grip in the palm: weapon +Y runs along the closed fingers (bow/staff held at the centre)
    fx.group.scale.setScalar(1);
    if (d.family === 'bow') fx.group.rotation.y = Math.PI / 2; // string toward the body
    else if (d.family === 'staff') fx.group.position.y = -0.55; // held a third of the way up the shaft
    else if (d.family === 'dual') fx.group.scale.setScalar(0.8);
    this.hero.hand.add(fx.group);
    this.weapon = fx;
  }

  private action(name: AnimName): THREE.AnimationAction | null {
    if (!this.rig) return null;
    const clip = this.rig.clipsMap[name] ?? this.rig.clipsMap.idle!;
    return this.rig.actions.get(clip) ?? null;
  }

  play(name: AnimName, fade = 0.2, now = performance.now() / 1000) {
    if (!this.rig) return;
    if (name === this.currentName && !ONE_SHOT.has(name)) return;
    if (this.currentName === 'death' && name !== 'spawn' && name !== 'idle') return;
    const a = this.action(name);
    if (!a) return;
    if (ONE_SHOT.has(name)) {
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
      if (name === 'roll') a.timeScale = a.getClip().duration / 0.55; else if (name === 'parry') a.timeScale = a.getClip().duration / 0.45; else if (a.timeScale > 1.5 && name !== 'attack' && name !== 'attack2') a.timeScale = 1;
      this.oneShotUntil = now + a.getClip().duration / Math.max(0.1, a.timeScale) - 0.05;
      if (name === 'death') this.oneShotUntil = Infinity;
    } else { a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; }
    a.enabled = true; a.setEffectiveWeight(1);
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, true);
    a.play();
    this.current = a;
    this.currentName = name;
  }

  /** Locomotion/state update. `state` comes from prediction (self) or the server (others). */
  update(dt: number, state: string, speed: number, now = performance.now() / 1000) {
    if (!this.rig) return;
    this.speed = speed;
    const busy = now < this.oneShotUntil;
    const want = (state as AnimName) || 'idle';
    if (want === 'death') this.play('death', 0.15, now);
    else if (ONE_SHOT.has(want)) { if (this.currentName !== want || !busy) this.play(want, 0.12, now); }
    else if (!busy) {
      if ((this.currentName as string) === 'death') { this.currentName = ''; }
      this.play(want, want === 'fall' ? 0.3 : 0.22, now);
    }
    // speed-matched locomotion: playback rate follows ground speed so feet don't slide
    if (this.current && (this.currentName === 'walk' || this.currentName === 'run' || this.currentName === 'sprint')) {
      const base = this.hero ? (UAL_GAIT[this.currentName as AnimName] ?? 2.5) : this.currentName === 'walk' ? 2.0 : 5.4;
      this.current.timeScale = THREE.MathUtils.clamp(speed / base, 0.5, this.hero ? 2.2 : 1.6);
      this.stepPhase += dt * this.current.timeScale * (this.currentName === 'walk' ? 2.0 : 2.8);
      if (this.stepPhase >= 1) { this.stepPhase -= 1; this.onStep?.(); }
    } else if (this.current) this.current.timeScale = 1;
    this.rig.mixer.update(dt);
    this.cloak?.update(dt, this.currentName === 'idle' ? 0 : speed);
    if (this.weapon) this.weapon.update(now, dt);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 4);
      for (const m of this.rig.materials) { const e0 = (m.userData.e0 ??= m.emissive.clone()) as THREE.Color; m.emissive.setRGB(e0.r + this.flash, e0.g + this.flash * 0.25, e0.b + this.flash * 0.15); }
    }
  }
  hitFlash() { this.flash = 0.9; }
  dispose() { this.root.removeFromParent(); this.rig?.mixer.stopAllAction(); this.weapon?.group.removeFromParent(); }
}
