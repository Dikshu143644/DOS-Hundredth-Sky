// Prologue e2e: New Game → Act I (an ordinary life ends) → the void → soul creation → the Goddess
// (past life, cheat, class, affinity) → status window → AWAKEN → the Capital at Lv 1 → skill fusion
// at Lv 5 → cast it → rankings. Usage: node tests/e2e/prologue.mjs [outDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/prologue';
fs.mkdirSync(out, { recursive: true });
const port = 8700 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-pro-')), DOS_BOTS: '0', DOS_DEV: '1', DOS_LLM_KEY: '', DOS_LLM_SECRET_FILE: '/nonexistent' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = process.env.BASE || `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${port}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const step = (s) => console.log('·', s);
const fail = async (m) => { console.error('PROLOGUE FAIL:', m); try { await page.screenshot({ path: path.join(out, 'fail.jpg'), type: 'jpeg', quality: 70 }); } catch {} server.kill('SIGKILL'); process.exit(1); };
const { browser, page, errors } = await launch({ viewport: { width: 1600, height: 900 } });
const g = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: path.join(out, n), type: 'jpeg', quality: 82 });
const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(900); };
const goddessSays = async () => { await page.waitForFunction(() => { const t = document.querySelector('.pro-text'); return t && t.dataset.done === '1' && t.textContent.length > 20; }, null, { timeout: 40000 }); const t = await g(() => document.querySelector('.pro-text').textContent); if (!/[.!?…"”’)]$/.test(t.trim())) await fail('goddess line ends mid-sentence: ' + t); await page.waitForTimeout(600); };
try {
  await page.goto(`${base}/?autotest=1&quality=${process.env.Q || 'medium'}`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 });
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'pro' + Date.now().toString(36));
  await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  // Act I
  await page.waitForFunction(() => window.__dos.mode === 'prologue' && window.__dos.pro, null, { timeout: 30000 });
  await page.waitForTimeout(3500); await shot('pro_1_life.jpg');
  step('Act I: an ordinary life (city at night)');
  await page.waitForFunction(() => window.__dos.pro?.phase === 'void', null, { timeout: 40000 });
  step('the truck, the white, and the void');
  await page.waitForSelector('#create.over-void', { timeout: 20000 });
  await page.click('#create .classbtn[data-c=mage]');
  await page.fill('#create [data-name]', 'Haruto');
  await page.waitForTimeout(2500); await shot('pro_2_soul.jpg');
  await page.click('#create [data-create]');
  // Act II: the Goddess
  await page.waitForSelector('#prologue .pro-opt', { timeout: 40000 });
  await goddessSays(); await shot('pro_3_goddess.jpg');
  step('Aurelia speaks [' + (await g(() => document.querySelector('.pro-src').textContent)) + ']: ' + (await g(() => document.querySelector('.pro-text').textContent)).slice(0, 160));
  await page.click('#prologue .pro-opt');
  await page.waitForSelector('#prologue .pro-card', { timeout: 30000 });
  await goddessSays(); await shot('pro_4_cheats.jpg');
  const cheat = await g(() => document.querySelector('#prologue .pro-card b').textContent);
  await page.click('#prologue .pro-card');
  step('cheat skill chosen: ' + cheat);
  await page.waitForSelector('#prologue .pro-cls', { timeout: 30000 });
  await page.click('#prologue .pro-cls[data-v=mage]');
  await page.waitForSelector('#prologue .pro-orb', { timeout: 30000 });
  await goddessSays();
  await page.hover('#prologue .pro-orb.forbidden'); await page.click('#prologue .pro-orb.forbidden');
  await page.waitForTimeout(500); await shot('pro_5_affinity.jpg');
  await page.click('#prologue .pro-orb[data-v=water]');
  await page.waitForSelector('.status-wrap.reveal [data-wake]', { timeout: 30000 });
  await page.waitForTimeout(1500); await shot('pro_6_status.jpg');
  step('status window revealed');
  await page.click('.status-wrap.reveal [data-wake]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const st = await g(() => ({ lvl: window.__dos.game.self.level, zone: window.__dos.game.engine.zone, status: window.__dos.game.status }));
  if (st.lvl !== 1 || st.zone !== 'capital') await fail('did not wake in the Capital at Lv 1: ' + JSON.stringify(st));
  if (st.status?.affinity !== 'water' || !st.status?.cheat) await fail('origin missing: ' + JSON.stringify(st.status));
  step(`woke in the Capital at Lv 1 · rank ${st.status.rank} · ${st.status.cheat} · ${st.status.affinity}`);
  await shot('pro_7_capital.jpg');
  // fusion at Lv 5
  await chat('/xp 3000');
  await page.waitForFunction(() => (window.__dos.game.status?.fusionSlots ?? 0) >= 1, null, { timeout: 15000 });
  await page.keyboard.press('KeyU');
  await page.waitForSelector('.status-win [data-el=lightning]', { timeout: 10000 });
  await page.click('.status-win [data-el=lightning]');
  await page.click('.status-win [data-fuse]');
  await page.waitForFunction(() => window.__dos.game.status?.fusions?.includes('f_storm'), null, { timeout: 10000 });
  await page.click('.status-win [data-el=lightning]');
  await page.waitForTimeout(800); await shot('pro_8_fusion.jpg');
  step('SKILL FUSION: Water + Lightning = TEMPESTAS (Storm)');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await g(() => window.__dos.game.action('fusion1'));
  await page.waitForTimeout(1600); await shot('pro_9_storm_cast.jpg');
  const cd = await g(() => window.__dos.game.self.cds?.f_storm ?? 0);
  step('cast the fused skill (cooldown ' + Number(cd).toFixed(1) + ')');
  await page.keyboard.press('KeyL');
  await page.waitForSelector('#rankings .rk-t', { timeout: 10000 });
  await page.waitForTimeout(500); await shot('pro_10_rankings.jpg');
  step('rankings: ' + await g(() => document.querySelector('#rankings .rk-t tr.me')?.textContent));
  const bad = errors.filter((e) => !/favicon|404|net::ERR/.test(e));
  if (bad.length) await fail('console errors: ' + bad.slice(0, 5).join(' | '));
  console.log('PROLOGUE OK');
} catch (e) { await fail(String(e?.stack || e)); }
await browser.close(); server.kill('SIGKILL');
