// M3 e2e: quest board, AI status pill, AI NPC dialogue, the companion joining and following into another region.
// Usage: node tests/e2e/m3.mjs [outDir] [W H]
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/m3';
fs.mkdirSync(out, { recursive: true });
const port = 8700 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-m3-')), DOS_BOTS: '1', DOS_DEV: '1', DOS_LLM_KEY: '', DOS_LLM_SECRET_FILE: '/nonexistent' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const step = (s) => console.log('·', s);
const fail = (m) => { console.error('M3 FAIL:', m); server.kill('SIGKILL'); process.exit(1); };
const { browser, page, errors } = await launch({ viewport: { width: Number(process.argv[3] || 1600), height: Number(process.argv[4] || 900) } });
const g = (fn, a) => page.evaluate(fn, a);
const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(950); };
const shot = async (n) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(out, n), type: 'jpeg', quality: 82 }); step('screenshot ' + n); };
const waitZone = async (z) => { await page.waitForFunction((z) => window.__dos.game.engine.zone === z && !window.__dos.game.loadingZone, z, { timeout: 120000 }); await page.waitForTimeout(800); };
try {
  await page.goto(`${base}/?autotest=1&prologue=skip&quality=low`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 });
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'm3' + Date.now().toString(36));
  await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 30000 });
  await page.click('#create .classbtn[data-c=knight]');
  await page.fill('#create [data-name]', 'Aiko');
  await page.click('#create [data-create]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await chat('/time 13');
  // AI status pill
  const pill = await page.waitForSelector('.ai-pill[data-status]', { timeout: 15000 });
  step('AI status pill: ' + (await pill.textContent()).trim());
  // story chapter in the tracker
  const ql = await page.textContent('.quests .ql');
  if (!/Ch\.1/.test(ql)) fail('main story chapter 1 not in the quest tracker: ' + ql);
  step('main story: Ch.1 · A Name in the Ledger is tracked');
  // quest board
  await page.keyboard.press('KeyB');
  await page.waitForSelector('#questboard .qb-card', { timeout: 15000 });
  const ranks = await page.$$eval('#questboard .qb-rank', (els) => els.map((e) => e.textContent));
  if (ranks.join(',') !== 'F,E,D,C,B,A,S,SS,SSS') fail('board ranks: ' + ranks.join(','));
  const locked = await page.$$eval('#questboard .qb-card.locked', (els) => els.length);
  step(`quest board: ${ranks.join(' ')} · ${locked} locked above rank`);
  await page.click('#questboard [data-take]');
  await page.waitForSelector('#questboard .qb-card.taken', { timeout: 10000 });
  await shot('m3_board.jpg');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  // talk to Mina (guild)
  await chat('/goto mina'); await page.waitForTimeout(1200);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.dialog .opts button', { timeout: 10000 });
  await page.click('.dialog .opts button');
  await page.waitForFunction(() => { const t = document.querySelector('.dialog .txt'); return t && t.textContent.length > 4 && t.textContent !== '…'; }, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  step('Mina: ' + (await page.textContent('.dialog .txt')).slice(0, 90) + ' [' + (await page.textContent('.dialog .ai')) + ']');
  await shot('m3_mina.jpg');
  const st1 = await g(() => document.querySelector('.quests .ql').textContent);
  if (!/✓ Register/.test(st1)) step('(note) tracker after Mina: ' + st1.slice(0, 120));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // Rin joins
  await chat('/goto rin'); await page.waitForTimeout(1200);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.dialog .opts button', { timeout: 10000 });
  await page.click('.dialog .opts button');
  await page.waitForSelector('.comp:not(.hidden)', { timeout: 15000 });
  step('companion frame: ' + (await page.textContent('.comp')).trim());
  await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
  await g(() => { window.__dos.game.cam.yaw = window.__dos.game.cam.yaw + 2.6; });
  await page.waitForTimeout(1200);
  await shot('m3_companion.jpg');
  // into the forest: Rin follows; Sylwen lives in Elderwood Haven
  await chat('/goto sylwen'); await waitZone('forest'); await page.waitForTimeout(3000);
  const near = await g(() => { const G = window.__dos.game; let rin = null, npcs = []; for (const r of G.remotes.values()) { if (r.t === 's' && r.key === 'rin') rin = Math.round(r.view.root.position.distanceTo(G.renderPos)); if (r.t === 'n') npcs.push(r.name); } return { rin, npcs }; });
  if (near.rin === null) fail('Rin did not follow into the forest');
  step(`forest: Rin ${near.rin} m away · NPCs here: ${near.npcs.join(', ')}`);
  if (near.npcs.length < 3) fail('Elderwood Haven should have its people');
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.dialog .opts button', { timeout: 10000 });
  await page.waitForTimeout(800);
  await shot('m3_sylwen.jpg');
  await page.keyboard.press('Escape');
  const errs = errors.filter((e) => !/favicon|404|WebGL|GPU stall|swiftshader/i.test(e));
  if (errs.length) fail('console errors: ' + errs.slice(0, 5).join(' | '));
  console.log('M3 PASS');
} catch (e) { await page.screenshot({ path: path.join(out, 'm3_fail.jpg') }); fail(e.stack || String(e)); }
finally { await browser.close(); server.kill('SIGKILL'); }
