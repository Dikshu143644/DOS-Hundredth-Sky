import * as THREE from 'three';
import { SkyCastle } from './skycastle';
import { loginScreen } from '../ui/screens';

/** Dev harness (dev.html, not shipped): renders one scene standalone for look-dev and stills.
 *  ?scene=skycastle|armory&panel=1&q=high. window.__step(n, dt) advances deterministically. */
const p = new URLSearchParams(location.search);
(window as any).__THREE = THREE;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(p.get('exp') || 1.0);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Number(p.get('dpr') || 1));
renderer.setSize(innerWidth, innerHeight);
const q = (p.get('q') || 'high') as any;
let scene: { setSize(w: number, h: number): void; render(dt: number): void; build(): Promise<void>; [k: string]: any };
const which = p.get('scene') || 'skycastle';
(async () => {
  if (which === 'hero') {
    const { Armory } = await import('./armory'); const { CharacterView } = await import('../game/character');
    const a = new Armory(renderer, q); await a.build(); a.items.forEach((i) => i.holder.removeFromParent()); a.show = () => {}; (a as any).floorLight.intensity = 0; (a as any).key.intensity = 18; (a as any).glowU.uGlowCount.value = 0; scene = a;
    const cls = p.get('cls') || 'knight'; const v = new CharacterView('p', cls, { tint: 0xffffff, accent: 0x3fd0ff, headgear: p.get('helm') === '1', cape: true, scale: 1, body: (p.get('body') as any) || 'm' });
    await v.ready; v.setWeapon(p.get('item') || 'frostfang', { light: false, quality: q }); a.scene.add(v.root); v.root.rotation.y = Number(p.get('ry') || 0.5);
    const anim = p.get('anim') || 'idle'; v.play(anim as any, 0); (v as any).rig.mixer.update(Number(p.get('at') || 0.4));
    const orig = a.update.bind(a); a.update = (dt: number) => { orig(dt); a.camera.position.set(0, 1.25, 3.3); a.camera.lookAt(0, 0.95, 0); };
    (window as any).__view = v;
  } else if (which === 'armory') { const { Armory } = await import('./armory'); scene = new Armory(renderer, q); }
  else scene = new SkyCastle(renderer, q);
  (window as any).__scene = scene;
  await scene.build();
  scene.setSize(innerWidth, innerHeight);
  if (p.get('t')) { scene.time = Number(p.get('t')); if ('intro' in scene) scene.intro = 1; }
  if (p.get('w')) scene.show(p.get('w'));
  if (p.get('lineup') === '1') scene.lineup();
  if (p.get('panel') === '1') loginScreen({ mode: 'online', server: 'Hundredth Sky · Shard 1', llm: true, ping: () => 38, onSubmit: () => {}, onOffline: undefined });
  (window as any).__step = (n: number, dt = 1 / 30) => { for (let i = 0; i < n; i++) scene.render(dt); return renderer.info.render.calls; };
  (window as any).__ready = true;
  if (p.get('loop') === '1') { let last = performance.now(); const f = () => { const t = performance.now(); scene.render(Math.min(0.05, (t - last) / 1000)); last = t; requestAnimationFrame(f); }; f(); }
})().catch((e) => { console.error(e); (window as any).__err = String(e?.stack || e); });
