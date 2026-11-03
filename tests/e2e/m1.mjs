// M1 e2e: a warrior enters the world, levels to 20 (dev /xp), spends stat + skill points, picks an
// advanced class, fights with skills, combos, dodge and parry. Saves screenshots for the milestone report.
// Usage: node tests/e2e/m1.mjs [outDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/m1';
fs.mkdirSync(out, { recursive: true });
const port = 8800 + Math.floor(Math.random() * 90);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dos-m1-'));
const server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: data, DOS_BOTS: '2', DOS_DEV: '1', DOS_LLM_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const step = (s) => console.log('·', s);
const fail = (m) => { console.error('M1 FAIL:', m); server.kill('SIGKILL'); process.exit(1); };
const q = process.env.Q || 'high';
const { browser, page, errors } = await launch({ viewport: { width: 1600, height: 900 } });
try {
  await page.goto(`${base}/?autotest=1&quality=${q}`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 });
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'm1' + Date.now().toString(36));
  await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 30000 });
  const cls = process.env.CLS || 'warrior';
  await page.click(`#create .classbtn[data-c=${cls}]`);
  await page.fill('#create [data-name]', 'Kaelen');
  await page.click('#create [data-create]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 90000 });
  step('entered the world as a ' + cls);
  await page.waitForTimeout(2500);
  const g = (fn, arg) => page.evaluate(fn, arg);
  const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(400); };
  // skill bar shows 4 skills + adv + ult (locked above level)
  const bar = await g(() => [...document.querySelectorAll('.skills .skill')].map((e) => (e.querySelector('.nm')?.textContent ?? '') + (e.classList.contains('locked') ? '(locked)' : '')));
  step('skill bar: ' + bar.join(' | '));
  if (bar.length < 8) fail('skill bar incomplete');
  await chat('/xp 250000');
  await page.waitForTimeout(800);
  const lvl = await g(() => window.__dos.game.self.level);
  step('level after /xp: ' + lvl);
  if (lvl < 20) fail('did not reach level 20');
  // hero panel: spend points, rank up, pick the advanced class
  await page.keyboard.press('KeyP');
  await page.waitForSelector('#hero .htab', { timeout: 5000 });
  for (let i = 0; i < 6; i++) { await page.click('#hero [data-attr5=str]'); await page.waitForTimeout(150); }
  await page.click('#hero [data-attr5=vit]'); await page.waitForTimeout(150);
  await page.click('#hero [data-attr5=agi]'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, 'm1_hero_attributes.jpg'), quality: 88 });
  await page.click('#hero [data-tab=skills]'); await page.waitForTimeout(200);
  const firstRank = await g(() => document.querySelector('#hero [data-rank]')?.dataset.rank);
  for (let i = 0; i < 4; i++) { await page.click(`#hero [data-rank=${firstRank}]`); await page.waitForTimeout(150); }
  page.once('dialog', (d) => d.accept());
  await page.click('#hero [data-adv]'); await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, 'm1_skill_tree.jpg'), quality: 88 });
  const prog = await g(() => window.__dos.game.progress);
  step(`attributes str=${prog.attrs.str} vit=${prog.attrs.vit} agi=${prog.attrs.agi}; ${firstRank} rank ${prog.ranks[firstRank]}; advanced=${prog.adv}; titles=${prog.titles.join(',')}`);
  if (!prog.adv) fail('advanced class not chosen');
  await page.keyboard.press('KeyP'); await page.waitForTimeout(300);
  // go fight: teleport to the old ruins spawn and use every skill
  await chat('/tp ruins');
  await page.waitForTimeout(2500);
  await chat('/time 17');
  const used = [];
  for (let round = 0; round < 3; round++) {
    await g(() => { const gm = window.__dos.game; gm.cycleTarget(); });
    for (const k of ['KeyF', 'KeyF', 'KeyF', 'Digit1', 'KeyF', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyR', 'KeyQ', 'KeyV']) {
      await page.keyboard.press(k); await page.waitForTimeout(k === 'KeyF' ? 650 : 900);
      used.push(k);
      if (round === 1 && k === 'Digit2') await page.screenshot({ path: path.join(out, 'm1_combat_skill.jpg'), quality: 88 });
      if (round === 2 && k === 'KeyR') { await page.waitForTimeout(500); await page.screenshot({ path: path.join(out, 'm1_ultimate.jpg'), quality: 88 }); }
    }
  }
  const st = await g(() => ({ mp: window.__dos.game.self.mp, cds: Object.keys(window.__dos.game.self.cds), combo: window.__dos.game.progress?.counters?.maxCombo ?? 0, kills: window.__dos.game.progress?.kills }));
  step(`skills on cooldown after the fight: ${st.cds.join(', ')}; best combo ${st.combo}; kills ${st.kills}`);
  if (st.cds.length < 4) fail('skills were not accepted by the server');
  const errs = errors.filter((e) => !/favicon|404|WebGL|GPU stall|swiftshader/i.test(e));
  if (errs.length) fail('console errors: ' + errs.slice(0, 5).join(' | '));
  step('no console errors');
  console.log('M1 PASS');
} catch (e) { fail(e.stack || String(e)); }
finally { await browser.close(); server.kill('SIGKILL'); }
