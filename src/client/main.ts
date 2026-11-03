import { CLASS_GIFT } from '../shared/items';
import { CAPTURE, setStepHook } from './capture';
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { Engine } from './engine/engine';
import { preloadAnimations, loadProgress } from './engine/assets';
import { audio } from './audio';
import { settings } from './settings';
import { connectWS, serverUrl, Transport } from './net/transport';
import { startOffline } from './net/offline';
import { GameClient } from './game/client';
import { CharacterView } from './game/character';
import { SkyCastle } from './scenes/skycastle';
import type { Armory } from './scenes/armory';
import type { Prologue } from './scenes/prologue';
import { show, hide, loginScreen, charSelectScreen, createScreen, loadingScreen, ui } from './ui/screens';
import { titleMenu, confirmBox, TitleMenu, MenuAction } from './ui/menu';
import { openSettings } from './ui/settings';
import { TOWER, heightAt, SPAWN } from '../shared/world';
import type { S2C, CharacterSummary, Appearance } from '../shared/protocol';
import type { ClassId } from '../shared/combat';

declare global { interface Window { __dos: any } }
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const AUTOTEST = params.get('autotest') === '1'; // headless test hooks: skip cinematic waits

// WebGL2 check
if (!canvas.getContext('webgl2')) {
  ui().innerHTML = '<div class="screen"><div class="panel" style="padding:30px;max-width:420px;text-align:center"><h2>WebGL2 required</h2><p>Your browser or device does not support WebGL2. Try the latest Chrome, Edge, Safari or Firefox.</p></div></div>';
  throw new Error('no webgl2');
}

const engine = new Engine(canvas);
const dolly = new THREE.Group();
dolly.add(engine.camera);
let game: GameClient | null = null;
let preview: CharacterView | null = null;
type Mode = 'boot' | 'cine' | 'sky' | 'menu' | 'game' | 'armory' | 'prologue';
let pro: Prologue | null = null;
const PROLOGUE_SKIP = params.get('prologue') === 'skip';
addEventListener('dos:prologue-sfx', (e) => { const k = (e as CustomEvent).detail; if (k === 'horn') audio.horn(); else if (k === 'crash') audio.crash(); else if (k === 'void') audio.voidChime(); });
let mode = 'boot' as Mode;
let sky: SkyCastle | null = null;
let armory: Armory | null = null;
let armoryReturn: Mode = 'menu';
let cineT = 0;
let net: Transport | null = null;
let welcome: Extract<S2C, { type: 'welcome' }> | null = null;
const handlers: ((m: S2C) => void)[] = [];
const state = { user: '', chars: [] as CharacterSummary[] };
window.__dos = { engine, get game() { return game; }, state, settings, get mode() { return mode; }, get net() { return net; }, get welcome() { return welcome; }, get sky() { return sky; }, get armory() { return armory; }, get pro() { return pro; }, openArmory: (id?: string) => openArmory(id) };

// ------------------------------------------------------------------ title scene first, world streamed behind it (phase 3)
// The title menu (golden-hour sky-castle) is the only thing built before the first frame; the
// world (terrain, city, forest, monsters) starts streaming once the menu is on screen.
const skyQ = (): 'low' | 'medium' | 'high' | 'ultra' => (settings.quality as any) ?? 'high';
const NO_SKY = params.get('bench') === '1' || params.get('cine') === '1';
const skyPromise = (async () => {
  if (NO_SKY) return null;
  try { const s = new SkyCastle(engine.renderer, skyQ()); await s.build(); s.setSize(innerWidth, innerHeight); return s; }
  catch (e) { console.warn('[dos] title scene failed, using the poster', e); return null; }
})();
addEventListener('resize', () => { sky?.setSize(innerWidth, innerHeight); armory?.setSize(innerWidth, innerHeight); pro?.setSize(innerWidth, innerHeight); });
let worldLabel = 'Preparing the world';
let buildPromise: Promise<void> | null = null;
function startWorld(): Promise<void> {
  if (!buildPromise) buildPromise = (async () => {
    const t0 = performance.now();
    await preloadAnimations();
    await engine.build((s) => { worldLabel = s; });
    engine.scene.add(dolly);
    engine.onThunder = (d, s) => audio.thunder(d, s);
    (window as any).__worldMs = Math.round(performance.now() - t0);
    console.info('[dos] world streamed in', (window as any).__worldMs, 'ms');
  })();
  return buildPromise;
}
/** 0..1 world streaming progress: asset downloads (80 %) + build steps (20 %). */
function worldProgress() {
  if (engine.ready) return 1;
  const steps = ['Shaping the sky', 'Raising the land', 'Building the Capital walls', 'Growing the Ancient Forest', 'Compiling shaders'];
  const si = Math.max(0, steps.indexOf(worldLabel));
  const dl = loadProgress.total ? loadProgress.loaded / loadProgress.total : 0;
  return Math.min(0.99, dl * 0.8 + (si / steps.length) * 0.2);
}

// ------------------------------------------------------------------ cinematic camera path (spline over forest → gate → Tower)
const path = new THREE.CatmullRomCurve3([
  new THREE.Vector3(70, 26, 150), new THREE.Vector3(48, 22, 70), new THREE.Vector3(14, 18, 0), new THREE.Vector3(2, 16, -55), new THREE.Vector3(0, 26, -96), new THREE.Vector3(10, 60, -150), new THREE.Vector3(40, 120, -230),
]);
const lookPath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(30, 10, 40), new THREE.Vector3(10, 10, -20), new THREE.Vector3(0, 12, -90), new THREE.Vector3(0, 30, -200), new THREE.Vector3(TOWER.x * 0.5, 300, TOWER.z * 0.5), new THREE.Vector3(TOWER.x, 900, TOWER.z), new THREE.Vector3(TOWER.x, 1100, TOWER.z),
]);
const CINE_LEN = 17;
const SUBS = [
  [1.0, 'They say the sky has a hundred floors.'],
  [5.2, 'That a tower holds them up — and that no one who reached the top ever came back down.'],
  [9.6, 'At the edge of the Capital, beneath the Ancient Forest, new climbers arrive every dawn.'],
] as const;

function sunTowardTower() {
  // golden hour, low in the west-north-west: side-lights the walls, rims the Tower, god rays in frame
  return new THREE.Vector3(-0.7, 0.2, 0.55).normalize();
}

function menuCamera(t: number) {
  // slow drift near the gate with the Tower framed in the sky
  const a = t * 0.02;
  engine.camera.position.set(-14 + Math.sin(a) * 6, 14 + Math.sin(a * 0.7) * 2, -40 + Math.cos(a) * 4);
  engine.camera.lookAt(TOWER.x * 0.08, 60, -400);
  engine.focus.set(0, heightAt(0, -60), -60);
}
const STAGE = { x: 3.5, z: -79.5 };
function previewCamera() {
  const y = heightAt(STAGE.x, STAGE.z);
  engine.camera.position.set(STAGE.x + 0.9, y + 1.55, STAGE.z + 4.4);
  engine.camera.lookAt(STAGE.x - 0.5, y + 1.05, STAGE.z);
  engine.focus.set(STAGE.x, y, STAGE.z);
}
async function setPreview(cls: ClassId, ap: Appearance) {
  const v = new CharacterView('p', cls, ap);
  await v.ready;
  preview?.dispose();
  preview = v;
  v.root.position.set(STAGE.x, heightAt(STAGE.x, STAGE.z), STAGE.z);
  v.root.rotation.y = 0.35;
  engine.scene.add(v.root);
  v.setWeapon(CLASS_GIFT[cls], { light: true, quality: settings.quality as any });
  v.play('cheer', 0);
  setTimeout(() => v === preview && v.play('idle', 0.4), 1800);
}

// ------------------------------------------------------------------ ?bench=1 : 20 s fixed flythrough, reports avg fps and 1% low
let bench: { t: number; frames: number[]; done: boolean } | null = null;
function finishBench() {
  bench!.done = true;
  const f = bench!.frames, dts: number[] = [];
  for (let i = 10; i < f.length; i++) dts.push(f[i] - f[i - 1]);
  const avg = 1000 / (dts.reduce((a, b) => a + b, 0) / dts.length);
  const sorted = [...dts].sort((a, b) => b - a);
  const low1 = 1000 / sorted[Math.max(0, Math.floor(sorted.length * 0.01))];
  const gl = engine.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown GPU';
  const res = { quality: settings.quality, avgFps: +avg.toFixed(1), low1Fps: +low1.toFixed(1), frames: dts.length, resolution: `${innerWidth}x${innerHeight}@${engine.renderer.getPixelRatio().toFixed(2)}`, gpu };
  (window as any).__benchResult = res;
  console.info('[dos] bench', JSON.stringify(res));
  show(`<div class="panel" style="padding:26px 34px;max-width:520px;text-align:center"><h2>Benchmark · ${res.quality.toUpperCase()}</h2><p style="font-size:42px;margin:10px 0">${res.avgFps} fps</p><p>1% low ${res.low1Fps} fps · ${res.frames} frames · ${res.resolution}</p><p class="small">${gpu}</p></div>`, 'bench');
}

// ------------------------------------------------------------------ render loop
let last = performance.now();
let menuT = 0;
const loop = () => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'sky' && sky) {
    sky.render(dt);
    return;
  }
  if (mode === 'armory' && armory) { armory.render(dt); return; }
  if (mode === 'prologue' && pro) { pro.render(dt); return; }
  if (!engine.ready) return;
  if (bench) {
    bench.t += dt; bench.frames.push(now);
    const e = Math.min(1, bench.t / 20);
    engine.camera.position.copy(path.getPointAt(e * 0.75));
    engine.camera.lookAt(lookPath.getPointAt(e * 0.75));
    engine.focus.copy(engine.camera.position).setY(heightAt(engine.camera.position.x, engine.camera.position.z));
    if (bench.t >= 20 && !bench.done) finishBench();
  } else if (mode === 'cine') {
    if (!params.has('cineAt')) cineT += dt;
    const k = Math.min(1, cineT / CINE_LEN);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    engine.camera.position.copy(path.getPointAt(e));
    engine.camera.lookAt(lookPath.getPointAt(Math.min(1, e * 1.02)));
    engine.focus.copy(engine.camera.position).setY(heightAt(engine.camera.position.x, engine.camera.position.z));
    for (const [t, s] of SUBS) if (cineT >= t && cineT < t + dt + 0.0001) setSub(s);
    if (cineT > 12.2 && !document.querySelector('#cine .title.show')) document.querySelector('#cine .title')?.classList.add('show');
    if (cineT >= CINE_LEN + 2.5) endCinematic();
  } else if (mode === 'sky' && sky) {
    sky.render(dt);
    for (const [t, s] of SUBS) if (sky.time >= t && sky.time < t + dt + 0.0001 && document.getElementById('login') === null) setSub(s);
    return;
  } else if (mode === 'armory' && armory) {
    armory.render(dt);
    return;
  } else if (mode === 'menu') {
    menuT += dt;
    if (preview) { previewCamera(); preview.update(dt, preview.currentName || 'idle', 0); preview.root.rotation.y += dt * 0.15; }
    else menuCamera(menuT);
  } else if (mode === 'game' && game) {
    game.update(dt);
    if (engine.renderer.xr.isPresenting) { dolly.position.copy(game.renderPos).add(new THREE.Vector3(Math.sin(game.cam.yaw) * 3.5, 0.4, Math.cos(game.cam.yaw) * 3.5)); }
  }
  engine.update(dt);
  engine.render(dt);
};
if (CAPTURE) setStepHook(loop); else engine.renderer.setAnimationLoop(loop);

function setSub(text: string) {
  let s = document.querySelector('.subtitle') as HTMLElement | null;
  if (!s) { s = document.createElement('div'); s.className = 'subtitle'; ui().appendChild(s); }
  s.style.opacity = '0';
  setTimeout(() => { s!.textContent = text; s!.style.opacity = '1'; }, 400);
}

// ------------------------------------------------------------------ network
let connectedResolve: () => void;
const connected = new Promise<void>((r) => (connectedResolve = r));
async function connect() {
  const url = serverUrl();
  let t: Transport | null = null;
  if (url) { try { t = await connectWS(url); } catch { t = null; } }
  if (!t) { console.info('[dos] server unreachable, starting offline world'); t = startOffline(); }
  console.info('[dos] transport', t.mode);
  bindNet(t);
}
function bindNet(t: Transport) {
  net = t;
  t.onMessage = (m) => { if (m.type === 'welcome') { welcome = m; connectedResolve(); } for (const h of [...handlers]) h(m); };
  const queued = t.pending ?? []; t.pending = [];
  for (const m of queued) t.onMessage(m);
  t.onClose = (reason) => {
    if (mode === 'game') { game?.hud.notice(reason, 'warn'); game?.hud.chat('System', reason + ' Switching to the offline world…', 'system'); }
    setTimeout(() => location.reload(), 2500);
  };
}
function once<T extends S2C['type']>(types: T[], fn: (m: Extract<S2C, { type: T }>) => boolean | void) {
  const h = (m: S2C) => { if ((types as string[]).includes(m.type)) { if (fn(m as any) !== false) handlers.splice(handlers.indexOf(h), 1); } };
  handlers.push(h);
}
let cineEnded = false;
function endCinematic() { if (cineEnded) return; cineEnded = true; hide('cine'); document.querySelector('.subtitle')?.remove(); engine.env.cinematicSun = sunTowardTower(); mode = 'menu'; menuT = 0; }

// ------------------------------------------------------------------ flow: TITLE MENU → (log in) → continue / new game → world
let menu: TitleMenu | null = null;
const lastHero = (): { name: string; hp: number; hpMax: number; mp: number; mpMax: number } | null => { try { return JSON.parse(localStorage.getItem('dos.lastHero') || 'null'); } catch { return null; } };
const hasToken = () => Object.keys(localStorage).some((k) => k.startsWith('dos.token.'));

function boot() {
  document.body.classList.add('poster');
  engine.resize();
  menu = titleMenu({ signedIn: hasToken(), hero: lastHero(), onAction: (a) => void onMenu(a) });
  (window as any).__menuShownAt = performance.now();
  void connect();
  // first gesture anywhere starts the score (browsers block audio before one)
  const go = () => { audio.start(); removeEventListener('pointerdown', go); removeEventListener('keydown', go); };
  addEventListener('pointerdown', go); addEventListener('keydown', go);
  if (NO_SKY) { void startWorld().then(() => { if (params.get('bench') === '1') { engine.env.cinematicSun = sunTowardTower(); bench = { t: 0, frames: [], done: false }; menu?.hide(); } }); return; }
  void skyPromise.then((sc) => {
    if (sc) { sky = sc; mode = 'sky'; if (params.get('skipintro') === '1' || AUTOTEST) sky.intro = 1; }
    (window as any).__titleLiveAt = performance.now();
    requestAnimationFrame(() => document.body.classList.remove('poster'));
    // stream the world once the title scene is live (a beat later on slow devices)
    if (params.get('nostream') !== '1') setTimeout(() => void startWorld(), AUTOTEST ? 0 : 900);
  });
  const iv = setInterval(() => { if (!menu?.el.isConnected) return clearInterval(iv); const p = buildPromise ? worldProgress() : 0; menu.stream(p, worldLabel); if (p >= 1) clearInterval(iv); }, 250);
}

let busy = false;
async function onMenu(a: MenuAction) {
  if (busy) return;
  busy = true; menu?.busy(true);
  try {
    if (a === 'settings') { menu?.hide(); await new Promise<void>((r) => openSettings(engine, r)); menu?.show(); return; }
    if (a === 'quit') {
      if (state.user || hasToken()) {
        if (await confirmBox('LOG OUT', 'Leave the Hundredth Sky and sign out of this device?', 'LOG OUT')) {
          for (const k of Object.keys(localStorage)) if (k.startsWith('dos.token.') || k === 'dos.lastChar' || k === 'dos.lastHero') localStorage.removeItem(k);
          menu?.toast('Signed out. See you in the sky.');
          setTimeout(() => location.reload(), 900);
        }
      } else menu?.toast('Close this tab to quit. The sky will wait for you.');
      return;
    }
    const ok = await ensureAuth();
    if (!ok) return;
    const chars = await fetchChars();
    if (a === 'continue' && chars.length) {
      const last = localStorage.getItem('dos.lastChar');
      const c = chars.find((x) => x.id === last) ?? chars[0];
      enterWorld(c);
      return;
    }
    if (a === 'continue' && !chars.length) menu?.toast('No hero yet. Let us create one.');
    if (a === 'newgame' && chars.length >= 4) { if (!(await leaveSky())) return; showChars(); return; }
    // NEW GAME: the reincarnation prologue opens (an ordinary life ends → the void), then the soul takes shape
    menu?.hide();
    void startWorld();
    await playLifeAct();
    showCreate(true);
  } finally { busy = false; menu?.busy(false); }
}

/** Resolves true once a user is signed in (saved session, or the glass login over the menu). */
async function ensureAuth(): Promise<boolean> {
  await connected;
  if (state.user) return true;
  const token = localStorage.getItem('dos.token.' + net!.mode);
  if (token) {
    const ok = await new Promise<boolean>((res) => { once(['auth'], (m) => { if (m.ok) { state.user = m.user!; res(true); } else { localStorage.removeItem('dos.token.' + net!.mode); res(false); } }); net!.send({ type: 'resume', token }); });
    if (ok) return true;
  }
  return showLoginForm();
}
function showLoginForm(): Promise<boolean> {
  return new Promise((resolve) => {
    menu?.hide();
    const L = loginScreen({
      mode: welcome!.mode, server: welcome!.server, llm: welcome!.llm,
      onOffline: net!.mode === 'online' ? () => { net!.close(); bindNet(startOffline()); hide('login', false); void connected.then(() => showLoginForm().then(resolve)); } : undefined,
      onSubmit: (m, u, p) => {
        once(['auth'], (r) => { if (r.ok) { localStorage.setItem('dos.token.' + net!.mode, r.token!); state.user = r.user!; hide('login'); resolve(true); } else L.error(r.error ?? 'Failed'); });
        net!.send({ type: m, user: u, pass: p });
      },
    });
    L.el.classList.add('over-menu');
    const x = document.createElement('button'); x.className = 'sk-close'; x.type = 'button'; x.setAttribute('aria-label', 'Back'); x.textContent = '✕';
    x.onclick = () => { hide('login', false); menu?.show(); resolve(false); };
    L.el.querySelector('.sk-glass')?.appendChild(x);
  });
}
function fetchChars(): Promise<CharacterSummary[]> {
  return new Promise((res) => { once(['chars'], (m) => { state.chars = m.list; res(m.list); }); net!.send({ type: 'chars' }); });
}
/** Leaves the title scene for the world stage (character create/select). Waits for the streamed
 *  world with a real progress bar if it is not ready yet. */
async function leaveSky(): Promise<boolean> {
  menu?.hide();
  if (!engine.ready) {
    const L = loadingScreen();
    void startWorld();
    const iv = setInterval(() => L.set(worldProgress(), worldLabel), 100);
    await startWorld(); clearInterval(iv); L.set(1, 'Ready'); L.done();
  }
  document.querySelector('.subtitle')?.remove();
  mode = 'menu'; menuT = 0;
  engine.env.cinematicSun = sunTowardTower();
  return true;
}
function backToTitle() {
  hide('chars', false); hide('create', false);
  preview?.dispose(); preview = null;
  if (sky) { mode = 'sky'; menu?.show(); } else location.reload();
}
function showChars() {
  charSelectScreen(state.chars, {
    onPick: (c) => void setPreview(c.cls, c.appearance),
    onPlay: (c) => enterWorld(c),
    onCreate: () => { hide('chars', false); showCreate(); },
    onDelete: (c) => { once(['chars'], (m) => { state.chars = m.list; hide('chars', false); if (m.list.length) showChars(); else showCreate(); }); net!.send({ type: 'deleteChar', id: c.id }); },
    onBack: () => backToTitle(),
  });
}
/** Act I of the prologue (skippable), ending in the void between worlds. */
async function playLifeAct() {
  const { Prologue } = await import('./scenes/prologue');
  pro = new Prologue(engine.renderer);
  mode = 'prologue';
  if (PROLOGUE_SKIP || params.has('lifeSkip')) { pro.enterVoid(); return; }
  const btn = document.createElement('button'); btn.className = 'pro-skip'; btn.type = 'button'; btn.textContent = 'Skip ›';
  ui().appendChild(btn);
  await new Promise<void>((r) => {
    pro!.onLifeEnd = r;
    const sk = () => pro?.skipLife();
    btn.onclick = sk;
    const k = (e: KeyboardEvent) => { if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') sk(); };
    addEventListener('keydown', k);
    const done = r; pro!.onLifeEnd = () => { removeEventListener('keydown', k); done(); };
  });
  btn.remove();
}
function showCreate(soul = false) {
  const C = createScreen({
    onChange: (cls, ap) => void (soul && pro ? pro.setSoul(cls, ap) : setPreview(cls, ap)),
    onCreate: (name, cls, ap) => {
      once(['chars', 'charError'], (m) => {
        if (m.type === 'charError') { C.error(m.error); return; }
        state.chars = m.list; hide('create', false);
        const c = m.list.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? m.list[m.list.length - 1];
        enterWorld(c);
      });
      net!.send({ type: 'createChar', name, cls, appearance: ap });
    },
    onBack: () => { hide('create', false); if (soul && pro) { pro.dispose(); pro = null; void leaveSky().then(() => { if (state.chars.length) showChars(); else backToTitle(); }); return; } if (state.chars.length) showChars(); else backToTitle(); },
  });
  if (soul) { C.el.classList.add('over-void'); const b = document.createElement('div'); b.className = 'void-banner'; b.innerHTML = '<b>BETWEEN WORLDS</b><span>Your soul takes shape… who will you be in the new world?</span>'; C.el.prepend(b); }
}

function enterWorld(c: CharacterSummary) {
  hide('chars', false); hide('create', false); menu?.hide();
  localStorage.setItem('dos.lastChar', c.id);
  let L: ReturnType<typeof loadingScreen> | null = mode === 'prologue' ? null : loadingScreen();
  const t0 = performance.now();
  void startWorld();
  let joined: Extract<S2C, { type: 'joined' }> | null = null;
  let inPrologue = false;
  once(['joined', 'charError'], (m) => { if (m.type === 'joined') joined = m; });
  net!.send({ type: 'join', charId: c.id });
  const iv = setInterval(() => {
    // a soul that has not been reincarnated yet: the Goddess first, the world streams in behind her
    if (joined?.prologue && !inPrologue) {
      inPrologue = true;
      void runPrologue(c, joined).then((j2) => { joined = j2; inPrologue = false; if (!engine.ready && !L) L = loadingScreen(); });
      return;
    }
    if (inPrologue) return;
    if (!L) { if (joined && engine.ready) L = loadingScreen(); else if (!joined) return; else { L = loadingScreen(); } }
    // real progress: the streamed world (85 %) + the server handshake (15 %)
    const w = worldProgress();
    const p = Math.min(1, w * 0.85 + (joined ? 0.15 : Math.min(0.1, (performance.now() - t0) / 20000)));
    L.set(p, !engine.ready ? `${worldLabel}` : joined ? 'Entering the world' : 'Contacting the world server');
    if (joined && engine.ready) {
      clearInterval(iv);
      const j = joined as Extract<S2C, { type: 'joined' }>;
      saveHero(c.name, j.self);
      preview?.dispose(); preview = null;
      if (pro) { pro.dispose(); pro = null; }
      if (sky) { sky.dispose(); sky = null; }
      menu?.remove(); menu = null;
      engine.env.cinematicSun = null;
      game = new GameClient(engine, net!, j);
      // keep the network handler chain alive for later screens; remember hp/mp for the title bars
      const gameHandler = net!.onMessage;
      let lastSave = 0;
      net!.onMessage = (m) => { gameHandler(m); for (const h of [...handlers]) h(m); if (m.type === 'snap' && performance.now() - lastSave > 5000) { lastSave = performance.now(); saveHero(c.name, m.self); } };
      mode = 'game';
      L.done();
      (window as any).__enteredAt = performance.now();
      if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then((ok) => { if (ok) { const b = VRButton.createButton(engine.renderer); b.style.bottom = '90px'; document.body.appendChild(b); } }).catch(() => {});
    }
  }, 50);
}
/** Act II: the void and the Goddess. Afterwards the server has the soul's choices (class may have
 *  changed), so the hero joins again and gets a fresh, reincarnated state. */
async function runPrologue(c: CharacterSummary, j: Extract<S2C, { type: 'joined' }>): Promise<Extract<S2C, { type: 'joined' }>> {
  document.getElementById('loading')?.remove();
  if (!pro) { const { Prologue } = await import('./scenes/prologue'); pro = new Prologue(engine.renderer); pro.enterVoid(); }
  mode = 'prologue';
  void pro.setSoul(j.char.cls as ClassId, j.char.appearance);
  const { runGoddess } = await import('./ui/prologue');
  const wait = <T extends S2C['type']>(t: T) => new Promise<Extract<S2C, { type: T }>>((res) => once([t], (m) => { res(m as any); }));
  (window as any).__prologue = 'goddess';
  const listen = (fn: (m: S2C) => void) => { const h = (m: S2C) => fn(m); handlers.push(h); return () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); }; };
  await runGoddess({ send: (m) => net!.send(m), wait, listen, scene: pro, cls: j.char.cls, name: c.name, autoSkip: PROLOGUE_SKIP });
  (window as any).__prologue = 'done';
  const again = new Promise<Extract<S2C, { type: 'joined' }>>((res) => once(['joined'], (m) => { res(m); }));
  net!.send({ type: 'join', charId: c.id });
  const j2 = await again;
  if (pro) { pro.dispose(); pro = null; }
  mode = 'menu'; menuT = 0;
  return j2;
}
function saveHero(name: string, s: { hp: number; mhp: number; mp: number; mmp: number }) {
  try { localStorage.setItem('dos.lastHero', JSON.stringify({ name, hp: Math.round(s.hp), hpMax: Math.round(s.mhp), mp: Math.round(s.mp), mpMax: Math.round(s.mmp) })); } catch { /* private mode */ }
}

async function openArmory(focus?: string) {
  const { Armory } = await import('./scenes/armory');
  const { armoryScreen } = await import('./ui/armory');
  if (!armory) { armory = new Armory(engine.renderer, skyQ()); await armory.build(); }
  armory.setSize(innerWidth, innerHeight);
  armoryReturn = mode === 'armory' ? armoryReturn : mode;
  if (mode === 'game') { game?.hud && ((game as any).paused = true); document.exitPointerLock?.(); }
  mode = 'armory';
  const hidden = [...document.querySelectorAll<HTMLElement>('#ui > *:not(#armory)')].filter((e) => e.style.visibility !== 'hidden');
  hidden.forEach((e) => (e.style.visibility = 'hidden'));
  const owned = new Set<string>(game?.hud.inventory.map((e) => e.item) ?? []);
  const equipped = (game as any)?.equipment?.weapon as string | undefined;
  armoryScreen(armory, {
    focus, owned, equipped, cls: game?.cls,
    onEquip: (id) => { net?.send({ type: 'equip', item: id }); },
    onClose: () => { hidden.forEach((e) => (e.style.visibility = '')); mode = armoryReturn; if (game) (game as any).paused = false; },
  });
}

boot();
void SPAWN; void settings;
