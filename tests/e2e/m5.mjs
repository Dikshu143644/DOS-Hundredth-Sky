// M5 e2e: the Gate of the Tower → floor picker → Floor 1 (walls, seal, plates, floor chip) → seal → stairs → Floor 2;
// a boss floor (10); the Tower leaderboard. Usage: node tests/e2e/m5.mjs outDir
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/m5'; fs.mkdirSync(out, { recursive: true });
const port = 8800 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-m5-')), DOS_BOTS: '0', DOS_DEV: '1', DOS_LLM_KEY: '', DOS_LLM_SECRET_FILE: '/nonexistent' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const L = await launch({ viewport: { width: 1600, height: 900 } }); const page = L.page;
const step = (s) => console.log('·', s); const fail = (s) => { throw new Error(s); };
const g = (fn, a) => page.evaluate(fn, a);
const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(950); };
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(out, n), type: 'jpeg', quality: 84 }); step('screenshot ' + n); };
const zone = () => g(() => window.__dos.game.engine.zone);
const waitZone = async (z) => { await page.waitForFunction((z) => window.__dos.game?.engine.zone === z && !window.__dos.game.loadingZone, z, { timeout: 60000 }); await page.waitForTimeout(1500); };
let ok = false;
try {
  await page.goto(`${base}/?autotest=1&prologue=skip&quality=low`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 });
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'm5' + Date.now().toString(36)); await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 30000 });
  await page.click('#create .classbtn[data-c=knight]'); await page.fill('#create [data-name]', 'Ascender');
  await page.click('#create [data-create]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await chat('/xp 400000'); await chat('/time 11');
  // the Gate
  await chat('/zone tower'); await waitZone('tower');
  await chat('/tpxy 0 -163'); // walk up to the Gate of the Tower: the picker opens by itself
  await page.waitForSelector('#towergate .tg-floor', { timeout: 15000 });
  const enabled = await page.$$eval('#towergate .tg-grid .tg-floor:not([disabled])', (e) => e.length);
  if (enabled !== 1) fail('a new climber should only have floor 1 open, got ' + enabled);
  step('gate: floor picker open, floor 1 available');
  await shot('m5_gate.jpg');
  await page.click('#towergate .tg-floor[data-floor="1"]');
  await waitZone('f1'); step('entered Floor 1');
  await page.waitForSelector('.tw-chip', { timeout: 15000 });
  const chip = await page.$eval('.tw-chip', (e) => e.textContent);
  if (!/Floor 1/.test(chip)) fail('floor chip: ' + chip);
  step('floor chip: ' + chip.replace(/\s+/g, ' ').slice(0, 120));
  const walls = await g(() => window.__dos.game.engine.settlement.floor?.P.walls.length ?? 0);
  if (walls < 8) fail('no walls drawn');
  await shot('m5_floor1_landing.jpg');
  // walk into the puzzle room and look
  await chat('/room gate'); await page.waitForTimeout(1500);
  await shot('m5_floor1_puzzle.jpg');
  // the seal blocks the stairs until the floor is solved (client physics agrees with the server)
  const sealed = await g(() => !window.__dos.game.towerState.seal);
  if (!sealed) fail('seal open on arrival');
  await chat('/solve'); await page.waitForTimeout(800);
  const open = await g(() => window.__dos.game.towerState.seal && !window.__dos.game.engine.settlement.floor.seal.visible);
  if (!open) fail('seal did not open on the client');
  step('seal broken');
  await chat('/room stairs'); await page.waitForTimeout(600);
  await shot('m5_floor1_stairs.jpg');
  // step onto the stairway portal (server moves us up)
  const P = await g(() => { const f = window.__dos.game.engine.settlement.floor.P; return { x: f.stairsAt.x, z: f.stairsAt.z }; });
  await chat('/tpxy ' + P.x + ' ' + (P.z + 1));
  await waitZone('f2'); step('climbed to Floor 2 (first clear recorded)');
  // a guardian floor
  await chat('/floor 10'); await waitZone('f10');
  await chat('/room gate'); await page.waitForTimeout(2500);
  const boss = await g(() => [...window.__dos.game.remotes.values()].some((r) => /Thornmaw/.test(r.view?.name ?? r.name ?? '')));
  step('floor 10 guardian visible: ' + boss);
  await shot('m5_floor10_boss.jpg');
  await page.keyboard.press('KeyL'); await page.waitForSelector('#rankings .rk-t', { timeout: 10000 });
  const top = await page.$eval('#rankings .rk-t tr:nth-child(2)', (e) => e.textContent);
  if (!/Ascender/.test(top)) fail('tower board: ' + top);
  step('tower leaderboard: ' + top.replace(/\s+/g, ' '));
  await shot('m5_tower_board.jpg');
  await page.keyboard.press('Escape');
  if (L.errors.length) fail('console errors: ' + L.errors.slice(0, 3).join(' | '));
  ok = true; console.log('M5 E2E OK');
} catch (e) { console.error('M5 E2E FAIL', e); await page.screenshot({ path: path.join(out, 'fail.jpg') }); }
await L.browser.close(); server.kill('SIGKILL');
process.exit(ok ? 0 : 1);
