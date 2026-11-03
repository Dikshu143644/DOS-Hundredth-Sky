import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = import.meta.env.BASE_URL + 'assets/';
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();
const gltfCache = new Map<string, Promise<GLTF>>();
const texCache = new Map<string, THREE.Texture>();

export let loadProgress = { loaded: 0, total: 0 };
const pendingTex: Promise<void>[] = [];
/** Resolves once every texture requested so far has finished loading (needed before baking impostors). */
export function texturesLoaded(): Promise<void> { return Promise.all(pendingTex).then(() => undefined); }
export function loadGLTF(path: string): Promise<GLTF> {
  let p = gltfCache.get(path);
  if (!p) {
    loadProgress.total++;
    p = loader.loadAsync(BASE + path).then((g) => { loadProgress.loaded++; return g; });
    gltfCache.set(path, p);
  }
  return p;
}
export function tex(path: string, opts: { srgb?: boolean; repeat?: number; anisotropy?: number } = {}): THREE.Texture {
  path = path.replace(/^(tex\/.*)\.(jpg|png)$/, '$1.webp'); // phase 3: all surface textures ship as WebP
  const k = path + JSON.stringify(opts);
  let t = texCache.get(k);
  if (!t) {
    loadProgress.total++;
    let done!: () => void;
    pendingTex.push(new Promise<void>((r) => (done = r)));
    t = texLoader.load(BASE + path, () => { loadProgress.loaded++; done(); }, undefined, () => { loadProgress.loaded++; done(); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (opts.repeat) t.repeat.set(opts.repeat, opts.repeat);
    t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = opts.anisotropy ?? 8;
    texCache.set(k, t);
  }
  return t;
}

export type AnimName = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'land' | 'attack' | 'attack2' | 'shoot' | 'cast' | 'castshoot' | 'hit' | 'death' | 'talk' | 'sit' | 'channel' | 'work' | 'interact' | 'cheer' | 'combat' | 'taunt' | 'spawn' | 'swim' | 'walkback' | 'roll' | 'parry';
export const HERO_CLIPS: Record<AnimName, string> = {
  idle: 'Idle', walk: 'Walking_A', run: 'Running_A', sprint: 'Running_A', jump: 'Jump_Start', fall: 'Jump_Idle', land: 'Jump_Land', attack: '1H_Melee_Attack_Slice_Diagonal', attack2: '1H_Melee_Attack_Chop',
  shoot: '2H_Ranged_Shoot', cast: 'Spellcasting', castshoot: 'Spellcast_Shoot', hit: 'Hit_A', death: 'Death_A', talk: 'Interact', sit: 'Sit_Chair_Idle', channel: 'Spellcasting', work: '1H_Melee_Attack_Chop',
  interact: 'Interact', cheer: 'Cheer', combat: 'Idle', taunt: 'Cheer', spawn: 'Idle', swim: 'Jump_Idle', walkback: 'Walking_Backwards', roll: 'Dodge_Forward', parry: 'Block',
};
export const SKEL_CLIPS: Partial<Record<AnimName, string>> = {
  idle: 'Idle', walk: 'Walking_D_Skeletons', run: 'Running_C', attack: '1H_Melee_Attack_Chop', castshoot: 'Spellcast_Shoot', hit: 'Hit_A', death: 'Death_A', combat: 'Idle_Combat', taunt: 'Taunt', spawn: 'Spawn_Ground_Skeletons', cast: 'Spellcasting',
};

let heroClips: THREE.AnimationClip[] = [];
let skelClips: THREE.AnimationClip[] = [];
export async function preloadAnimations() {
  // phase 3: only the skeleton monsters still use the KayKit clip set (heroes use UAL clips)
  const s = await loadGLTF('models/chars/anims_skel.glb');
  skelClips = s.animations;
}

export interface CharacterRig { root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; clipsMap: Partial<Record<AnimName, string>>; materials: THREE.MeshStandardMaterial[] }

/** Instantiate a skinned character with its own mixer; hides named accessory meshes. */
export async function makeCharacter(model: string, opts: { hide?: string[]; tint?: number; accent?: number; headgear?: boolean; cape?: boolean; scale?: number; skeleton?: boolean } = {}): Promise<CharacterRig> {
  const g = await loadGLTF(`models/chars/${model}.glb`);
  const root = SkeletonUtils.clone(g.scene);
  const materials: THREE.MeshStandardMaterial[] = [];
  const hide = new Set(opts.hide ?? []);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (hide.has(o.name)) { o.visible = false; return; }
    if (/Helmet|Hat|Head_Hooded/.test(o.name) && opts.headgear === false && !/Head_Hooded/.test(o.name)) o.visible = false;
    if (/Cape|Cloak/.test(o.name) && opts.cape === false) o.visible = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    const src = m.material as THREE.MeshStandardMaterial;
    const mat = src.clone();
    mat.roughness = 0.62; mat.metalness = 0.08;
    if (opts.tint !== undefined && !/Helmet|Hat|Shield|Sword|Axe|Staff|Wand|Crossbow|Knife|Dagger/.test(o.name)) mat.color = new THREE.Color(opts.tint);
    if (/Cape|Cloak/.test(o.name) && opts.accent !== undefined) mat.color = new THREE.Color(opts.accent).lerp(new THREE.Color(0xffffff), 0.25);
    if (/Eyes/.test(o.name)) { mat.emissive = new THREE.Color(0x66ccff); mat.emissiveIntensity = 2.5; }
    m.material = mat;
    materials.push(mat);
  });
  if (opts.scale) root.scale.setScalar(opts.scale);
  const mixer = new THREE.AnimationMixer(root);
  const clips = opts.skeleton ? skelClips : heroClips;
  const clipsMap = opts.skeleton ? SKEL_CLIPS : HERO_CLIPS;
  const actions = new Map<string, THREE.AnimationAction>();
  for (const c of clips) actions.set(c.name, mixer.clipAction(c));
  return { root, mixer, actions, clipsMap, materials };
}
