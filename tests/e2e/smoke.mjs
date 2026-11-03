// Playwright smoke test: boots a real server, then in a real (headless) browser:
// title menu → New Game → register → create character → enter world → walk into the city wall (must not pass) → cast IGNIS.
// Exit code 0 = pass. Usage: node tests/e2e/smoke.mjs [--url http://host:port]   (default: spawns dist/server.mjs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from './browser.mjs';

const argUrl = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null;
let server = null, base = argUrl;
const WALL_Z = -90;
const fail = (msg) => { console.error('SMOKE FAIL:', msg); cleanup(); process.exit(1); };
const cleanup = () => { try { server?.kill('SIGKILL'); } catch {} };
const step = (s) => console.log('·', s);

if (!base) {
  const port = 8900 + Math.floor(Math.random() * 90);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dos-smoke-'));
  server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: data, DOS_BOTS: '1', DOS_DEV: '0', DOS_LLM_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
}
const t0 = Date.now();
const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 720 } });
try {
  await page.goto(`${base}/?autotest=1&prologue=skip&quality=low`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 });
  step('title menu shown');
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  step('New Game → login screen shown');
  const user = 'smoke' + Date.now().toString(36);
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', user);
  await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 30000 });
  step('registered (password hashed server-side) → character creation');
  await page.click('#create .classbtn[data-c=mage]');
  await page.fill('#create [data-name]', 'Smoke' + Math.floor(Math.random() * 999));
  await page.click('#create [data-create]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 60000 });
  step('character created, entered the world');
  await page.waitForTimeout(1500);
  const pos = () => page.evaluate(() => ({ x: window.__dos.game.me.x, z: window.__dos.game.me.z }));
  const p0 = await pos();
  // face north (camera yaw 0), strafe east away from the gate, then run north into the wall
  await page.evaluate(() => { window.__dos.game.cam.yaw = 0; });
  await page.keyboard.down('KeyD'); for (let i = 0; i < 80 && (await pos()).x - p0.x < 12; i++) await page.waitForTimeout(300); await page.keyboard.up('KeyD');
  const p1 = await pos();
  if (p1.x - p0.x < 8) fail(`strafe did not move the character (${p0.x.toFixed(1)} → ${p1.x.toFixed(1)})`);
  await page.evaluate(() => { window.__dos.game.cam.yaw = 0; });
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  let lastZ = 1e9; for (let i = 0; i < 80; i++) { await page.waitForTimeout(400); const z = (await pos()).z; if (z < WALL_Z + 2 && Math.abs(z - lastZ) < 0.02) break; lastZ = z; }
  await page.waitForTimeout(1500); // keep pushing into the wall
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  await page.waitForTimeout(800); // let reconciliation settle on the authoritative position
  const p2 = await pos();
  if (p2.z > WALL_Z + 6) fail(`never reached the wall (z=${p2.z.toFixed(2)})`);
  if (p2.z < WALL_Z) fail(`PASSED THROUGH THE WALL (z=${p2.z.toFixed(2)})`);
  step(`walked into the wall at x=${p2.x.toFixed(1)}: stopped at z=${p2.z.toFixed(2)} (wall plane z=${WALL_Z}) ✓ no pass-through`);
  // cast IGNIS
  const mp0 = await page.evaluate(() => window.__dos.game.self.mp);
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(250);
  const casting = await page.evaluate(() => ({ c: !!window.__dos.game.casting, bar: !document.querySelector('.castbar')?.classList.contains('hidden'), chant: document.querySelector('.castbar .chant')?.textContent }));
  if (!casting.c || !casting.bar) fail('cast did not start: ' + JSON.stringify(casting));
  step(`casting IGNIS — chant on screen: "${(casting.chant || '').slice(0, 60)}…"`);
  await page.waitForFunction((m) => window.__dos.game.self.mp < m, mp0, { timeout: 15000 }).catch(() => fail('mana was never spent (server did not accept the cast)'));
  step('server accepted the cast (mana spent)');
  // inventory + equipment: realistic hero holds the class legendary; equip the starter through the UI
  await page.waitForTimeout(2500);
  const kit = await page.evaluate(() => ({ eq: window.__dos.game.equipment?.weapon, hand: window.__dos.game.myView.weaponId, hero: !!window.__dos.game.myView.hero, inv: window.__dos.game.hud.inventory.map((e) => e.item) }));
  if (kit.eq !== 'aether_staff' || kit.hand !== 'aether_staff' || !kit.hero) fail('starting kit wrong: ' + JSON.stringify(kit));
  step(`realistic hero in world holding ${kit.hand}; bag: ${kit.inv.join(', ')}`);
  await page.keyboard.press('KeyI');
  await page.waitForSelector('#inventory .inv-box', { timeout: 5000 }).catch(() => fail('inventory screen did not open'));
  await page.click('#inventory [data-item=oak_staff]');
  await page.click('#inventory [data-equip=oak_staff]');
  await page.waitForFunction(() => window.__dos.game.equipment?.weapon === 'oak_staff' && window.__dos.game.myView.weaponId === 'oak_staff', null, { timeout: 8000 }).catch(() => fail('server did not confirm the equip'));
  step('inventory screen: equipped the Novice Oak Staff → server confirmed, hand model swapped');
  await page.keyboard.press('Escape');
  const real = errors.filter((e) => !/favicon|speechSynthesis|AudioContext/i.test(e));
  if (real.length) fail('console errors: ' + real.join(' | '));
  step('no console errors');
  console.log(`SMOKE PASS in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) { fail(String(e?.stack || e)); }
await browser.close();
cleanup();
process.exit(0);
