import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLTF, AnimName, CharacterRig } from './assets';

/** Realistic-proportioned hero bodies (Quaternius Universal Base Characters + Modular Fantasy
 *  outfits, CC0) driven by the Universal Animation Library clip set, all on one 65-bone skeleton. */
export const UAL_CLIPS: Record<AnimName, string> = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', jump: 'Jump_Start', fall: 'Jump_Loop', land: 'Jump_Land',
  attack: 'Sword_Regular_A', attack2: 'Sword_Dash', shoot: 'OverhandThrow', cast: 'Idle_FoldArms_Loop', castshoot: 'Spell_Simple_Shoot', hit: 'Shield_Dash',
  death: 'Death01', talk: 'Yes', sit: 'Idle_FoldArms_Loop', channel: 'Idle_FoldArms_Loop', work: 'Sword_Regular_A', interact: 'Yes', cheer: 'Dance_Loop',
  combat: 'Idle_Loop', taunt: 'Yes', spawn: 'Idle_Loop', swim: 'Swim_Loop', walkback: 'Walk_Loop', roll: 'Roll', parry: 'Shield_Dash',
};

/** Natural ground speed (m/s) of each locomotion clip at timeScale 1, measured from the foot
 *  contacts of the clips (2 × foot travel per step ÷ cycle time; measured in the browser on the
 *  Knight_Male rig: walk 1.33 s cycle / 0.64 m steps, jog 0.92 s / 1.17 m, sprint 0.67 s / 1.08 m) — used to speed-match so feet never skate. */
export const UAL_GAIT: Partial<Record<AnimName, number>> = { walk: 0.96, run: 2.55, sprint: 3.24, walkback: 0.96, swim: 1.2 };

let ualClips: THREE.AnimationClip[] | null = null;
export async function loadHeroClips() {
  if (ualClips) return ualClips;
  const [g, roll] = await Promise.all([loadGLTF('models/heroes/animations.glb'), loadGLTF('models/heroes/anim_roll.glb').catch(() => null)]);
  // strip root-bone translation so every clip plays in place (movement comes from physics)
  ualClips = [...g.animations, ...(roll?.animations ?? [])].map((c) => {
    const k = c.clone();
    k.tracks = k.tracks.filter((t) => !(/^root\.position$/.test(t.name)));
    for (const t of k.tracks) if (/^pelvis\.position$/.test(t.name)) {
      const v = t.values; const x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
    }
    return k;
  });
  return ualClips;
}

export interface HeroLook { tint?: number; accent?: number; hair?: number; scale?: number; headgear?: boolean }
export interface HeroRig extends CharacterRig { play: (n: AnimName, fade?: number) => void; hand: THREE.Object3D | null; back: THREE.Object3D | null; leftHand: THREE.Object3D | null }

export async function makeHero(model: string, look: HeroLook = {}): Promise<HeroRig> {
  const [g, clips] = await Promise.all([loadGLTF(`models/heroes/${model}.glb`), loadHeroClips()]);
  const root = SkeletonUtils.clone(g.scene);
  const materials: THREE.MeshStandardMaterial[] = [];
  let hand: THREE.Object3D | null = null, leftHand: THREE.Object3D | null = null, spine: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (o.name === 'hand_r') hand = o;
    if (o.name === 'hand_l') leftHand = o;
    if (o.name === 'spine_03') spine = o;
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    if (look.headgear === false && /Head_(Armet|Hood|Hat)|Helmet|Hood/.test(o.name)) { o.visible = false; return; }
    const src = m.material as THREE.MeshStandardMaterial;
    const mat = src.clone();
    mat.envMapIntensity = 1.0;
    // outfit tint / accent per class (multiplies the painted albedo, keeps the PBR maps)
    if (look.tint !== undefined && /Body|Legs|Arms|Cape|Cloak|Robe/.test(o.name) && !/Superhero|Regular|Face|Eye|Hair/.test(mat.name)) mat.color = new THREE.Color(look.tint).lerp(new THREE.Color(0xffffff), 0.45);
    if (look.hair !== undefined && /Hair/.test(mat.name)) mat.color = new THREE.Color(look.hair);
    if (/Eyes?$/.test(mat.name) || /MI_Eyes/.test(mat.name)) { mat.roughness = 0.08; }
    m.material = mat;
    materials.push(mat);
  });
  if (look.scale) root.scale.setScalar(look.scale);
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const c of clips) actions.set(c.name, mixer.clipAction(c));
  // attachment sockets (weapon in right hand, a sheath on the back)
  const sock = new THREE.Object3D(); sock.name = 'weapon_socket';
  if (hand) { (hand as THREE.Object3D).add(sock); sock.position.set(0, 0.08, 0); sock.rotation.set(Math.PI / 2, 0, 0); } // weapon +Y → hand +Z: out of the fist on the thumb side (measured on the rig: fingers run +Y, index/thumb side is +Z)
  const back = new THREE.Object3D(); back.name = 'back_socket';
  if (spine) { (spine as THREE.Object3D).add(back); back.position.set(0, 0.12, -0.2); back.rotation.set(0, 0, Math.PI * 0.8); }
  let cur: THREE.AnimationAction | null = null;
  const play = (n: AnimName, fade = 0.25) => {
    const a = actions.get(UAL_CLIPS[n]);
    if (!a || a === cur) return;
    a.reset().fadeIn(fade).play();
    cur?.fadeOut(fade);
    cur = a;
  };
  return { root, mixer, actions, clipsMap: UAL_CLIPS, materials, play, hand: hand ? sock : null, back: spine ? back : null, leftHand };
}

/** Body + outfit per class (and NPC role). `f` picks the feminine body where the pack has one. */
export function heroModel(cls: string, body: 'm' | 'f' = 'm'): string {
  const F = body === 'f';
  switch (cls) {
    case 'warrior': case 'knight': return F ? 'Knight_Female' : 'Knight_Male';
    case 'archer': case 'assassin': return F ? 'Ranger_Female_Long' : 'Ranger_Male_SimpleParted';
    case 'mage': case 'summoner': return F ? 'Wizard_Female_Long' : 'Wizard_Male_Buzzed';
    case 'healer': return F ? 'Noble_Female_Long' : 'Noble_Male_SimpleParted';
    case 'peasant': return F ? 'Peasant_Female_Long' : 'Peasant_Male_SimpleParted';
    default: return 'Knight_Male';
  }
}
