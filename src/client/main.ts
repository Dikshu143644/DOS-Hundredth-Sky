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
import { show, hide, LOGO_SVG, loginScreen, charSelectScreen, createScreen, loadingScreen, ui } from './ui/screens';
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
let mode: 'boot' | 'cine' | 'menu' | 'game' = 'boot';
let cineT = 0;
let net: Transport | null = null;
let welcome: Extract<S2C, { type: 'welcome' }> | null = null;
const handlers: ((m: S2C) => void)[] = [];
const state = { user: '', chars: [] as CharacterSummary[] };
window.__dos = { engine, get game() { return game; }, state, settings, get mode() { return mode; }, get net() { return net; }, get welcome() { return welcome; } };

// ------------------------------------------------------------------ build world in the background
const buildPromise = (async () => {
  await preloadAnimations();
  await engine.build((s) => { (document.querySelector('#gate .small') as HTMLElement | null)?.replaceChildren(document.createTextNode(s.toUpperCase() + '…')); });
  engine.scene.add(dolly);
  engine.onThunder = (d, s) => audio.thunder(d, s);
})();

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

// ------------------------------------------------------------------ flow
function gate() {
  const d = show(`<div class="logo">${LOGO_SVG.replace(/class="draw"/g, '').replace('class="fill"', '')}</div><div class="press">Press any key to begin</div><div class="small">Preparing the world…</div>`, 'gate');
  const go = () => { window.removeEventListener('keydown', go); d.removeEventListener('pointerdown', go); void logo(); };
  window.addEventListener('keydown', go);
  d.addEventListener('pointerdown', go);
}

async function logo() {
  audio.start();
  hide('gate', false);
  show(`<div class="logo">${LOGO_SVG}<div class="tag">The Hundredth Sky</div><div class="studio">a DOS Studio world</div></div>`, 'logo');
  void connect();
  await Promise.all([buildPromise, new Promise((r) => setTimeout(r, AUTOTEST ? 300 : 4200))]);
  hide('logo');
  if (params.get('bench') === '1') { engine.env.cinematicSun = sunTowardTower(); bench = { t: 0, frames: [], done: false }; return; }
  if (AUTOTEST || params.get('skipintro') === '1') return endCinematic();
  mode = 'cine'; cineT = Number(params.get('cineAt') || 0);
  engine.env.cinematicSun = sunTowardTower();
  const c = show(`<div class="bars"></div><div class="title"><div class="t1">DOS presents</div><div class="t2">THE HUNDREDTH SKY</div><div class="t3">Every floor is a story. Every story is waiting.</div></div><div class="skip">Press any key to skip ›</div>`, 'cine');
  const skip = () => endCinematic();
  setTimeout(() => { window.addEventListener('keydown', skip, { once: true }); c.querySelector('.skip')!.addEventListener('click', skip); }, 600);
}

let cineEnded = false;
function endCinematic() {
  if (cineEnded) return; cineEnded = true;
  hide('cine'); document.querySelector('.subtitle')?.remove();
  engine.env.cinematicSun = sunTowardTower();
  mode = 'menu'; menuT = 0;
  void connected.then(showLogin);
}

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

function showLogin() {
  const token = localStorage.getItem('dos.token.' + (net!.mode));
  if (token) {
    once(['auth'], (m) => { if (m.ok) afterAuth(m.user!); else { localStorage.removeItem('dos.token.' + net!.mode); showLoginForm(); } });
    net!.send({ type: 'resume', token });
    return;
  }
  showLoginForm();
}
function showLoginForm() {
  const L = loginScreen({
    mode: welcome!.mode, server: welcome!.server, llm: welcome!.llm,
    onOffline: net!.mode === 'online' ? () => { net!.close(); bindNet(startOffline()); hide('login', false); void connected.then(showLoginForm); } : undefined,
    onSubmit: (m, u, p) => {
      once(['auth'], (r) => { if (r.ok) { localStorage.setItem('dos.token.' + net!.mode, r.token!); hide('login'); afterAuth(r.user!); } else L.error(r.error ?? 'Failed'); });
      net!.send({ type: m, user: u, pass: p });
    },
  });
}
function afterAuth(user: string) {
  state.user = user;
  once(['chars'], (m) => { state.chars = m.list; if (m.list.length) showChars(); else showCreate(); });
  net!.send({ type: 'chars' });
}
function showChars() {
  charSelectScreen(state.chars, {
    onPick: (c) => void setPreview(c.cls, c.appearance),
    onPlay: (c) => enterWorld(c),
    onCreate: () => { hide('chars', false); showCreate(); },
    onDelete: (c) => { once(['chars'], (m) => { state.chars = m.list; hide('chars', false); if (m.list.length) showChars(); else showCreate(); }); net!.send({ type: 'deleteChar', id: c.id }); },
    onBack: () => { localStorage.removeItem('dos.token.' + net!.mode); location.reload(); },
  });
}
function showCreate() {
  const C = createScreen({
    onChange: (cls, ap) => void setPreview(cls, ap),
    onCreate: (name, cls, ap) => {
      once(['chars', 'charError'], (m) => {
        if (m.type === 'charError') { C.error(m.error); return; }
        state.chars = m.list; hide('create', false);
        const c = m.list.find((x) => x.name.toLowerCase() === name.toLowerCase()) ?? m.list[m.list.length - 1];
        enterWorld(c);
      });
      net!.send({ type: 'createChar', name, cls, appearance: ap });
    },
    onBack: () => { hide('create', false); if (state.chars.length) showChars(); else { localStorage.removeItem('dos.token.' + net!.mode); location.reload(); } },
  });
}

function enterWorld(c: CharacterSummary) {
  hide('chars', false); hide('create', false);
  const L = loadingScreen();
  const t0 = performance.now();
  let joined: Extract<S2C, { type: 'joined' }> | null = null;
  once(['joined', 'charError'], (m) => { if (m.type === 'joined') joined = m; });
  net!.send({ type: 'join', charId: c.id });
  const iv = setInterval(() => {
    const p = Math.min(1, ((performance.now() - t0) / (AUTOTEST ? 300 : 2600)) * 0.7 + (loadProgress.total ? (loadProgress.loaded / loadProgress.total) * 0.3 : 0.3));
    L.set(joined ? p : Math.min(p, 0.9), joined ? 'Entering the world' : 'Contacting the world server');
    if (joined && p >= 1) {
      clearInterval(iv);
      preview?.dispose(); preview = null;
      engine.env.cinematicSun = null;
      game = new GameClient(engine, net!, joined);
      // keep the network handler chain alive for later screens
      const gameHandler = net!.onMessage;
      net!.onMessage = (m) => { gameHandler(m); for (const h of [...handlers]) h(m); };
      mode = 'game';
      L.done();
      if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then((ok) => { if (ok) { const b = VRButton.createButton(engine.renderer); b.style.bottom = '90px'; document.body.appendChild(b); } }).catch(() => {});
    }
  }, 50);
}

gate();
void SPAWN; void settings;
