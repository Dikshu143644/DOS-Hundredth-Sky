import * as THREE from 'three';
import { makeCharacter, CharacterRig, AnimName } from '../engine/assets';
import { classById, MONSTERS, MonsterKind } from '../../shared/combat';
import { NPCS } from '../../server/core/npcdefs';
import type { Appearance } from '../../shared/protocol';

const ONE_SHOT = new Set<AnimName>(['attack', 'attack2', 'shoot', 'castshoot', 'hit', 'death', 'jump', 'land', 'spawn', 'taunt']);

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

  constructor(public kind: 'p' | 'b' | 'm' | 'n', public key: string, ap?: Appearance) {
    let model = 'Knight', hide: string[] = [], skeleton = false, tint: number | undefined, accent: number | undefined, headgear = true, cape = true, scale = 1;
    if (kind === 'p' || kind === 'b') {
      const c = classById(key);
      model = c.model; hide = c.hide;
      if (ap) { tint = ap.tint; accent = ap.accent; headgear = ap.headgear; cape = ap.cape; scale = ap.scale; }
      if (key === 'summoner') accent = accent ?? 0x9b6bff;
      if (key === 'healer') tint = tint ?? 0xfff6e0;
    } else if (kind === 'm') {
      const m = MONSTERS[key as MonsterKind] ?? MONSTERS.minion;
      model = m.model; skeleton = true; scale = key === 'warrior' ? 1.12 : 1;
    } else {
      const d = NPCS.find((n) => n.key === key);
      model = d?.model ?? 'Knight'; tint = d?.tint; scale = d?.important ? 1.02 : 0.98;
      hide = model === 'Knight' ? ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', '2H_Sword'] : model === 'Mage' ? ['Spellbook', '1H_Wand'] : model === 'Barbarian' ? ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '2H_Axe', 'Mug'] : ['1H_Crossbow', '2H_Crossbow', 'Throwable', 'Knife_Offhand'];
      if (key === 'borin') hide = ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '2H_Axe'];
    }
    this.ready = makeCharacter(model, { hide, skeleton, tint, accent, headgear, cape, scale }).then((rig) => {
      this.rig = rig;
      this.root.add(rig.root);
      this.play('idle', 0);
    });
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
      const base = this.currentName === 'walk' ? 2.0 : 5.4;
      this.current.timeScale = THREE.MathUtils.clamp(speed / base, 0.6, 1.6);
      this.stepPhase += dt * this.current.timeScale * (this.currentName === 'walk' ? 2.0 : 2.8);
      if (this.stepPhase >= 1) { this.stepPhase -= 1; this.onStep?.(); }
    } else if (this.current) this.current.timeScale = 1;
    this.rig.mixer.update(dt);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 4);
      for (const m of this.rig.materials) { const e0 = (m.userData.e0 ??= m.emissive.clone()) as THREE.Color; m.emissive.setRGB(e0.r + this.flash, e0.g + this.flash * 0.25, e0.b + this.flash * 0.15); }
    }
  }
  hitFlash() { this.flash = 0.9; }
  dispose() { this.root.removeFromParent(); this.rig?.mixer.stopAllAction(); }
}
