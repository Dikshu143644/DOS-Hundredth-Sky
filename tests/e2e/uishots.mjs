// UI screenshot tour (before/after a UI pass, desktop + phone). Usage: node tests/e2e/uishots.mjs outDir [W H]
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/ui'; const W = Number(process.argv[3] || 1600), H = Number(process.argv[4] || 900);
fs.mkdirSync(out, { recursive: true });
const port = 8900 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-ui-')), DOS_BOTS: '2', DOS_DEV: '1', DOS_LLM_KEY: '', DOS_LLM_SECRET_FILE: '/nonexistent' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const L = await launch({ viewport: { width: W, height: H } }); const page = L.page;
const g = (fn, a) => page.evaluate(fn, a);
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(out, n + '.jpg'), type: 'jpeg', quality: 80 }); console.log('·', n); };
const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(900); };
const key = async (k, sel) => { await page.keyboard.press(k); if (sel) await page.waitForSelector(sel, { timeout: 15000 }); };
try {
  await page.goto(`${base}/?autotest=1&lifeSkip=1&quality=low`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 }); await page.waitForTimeout(2500);
  await shot('01_menu');
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]'); await shot('02_login');
  await page.fill('#login [name=username]', 'ui' + Date.now().toString(36)); await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 60000 }); await page.fill('#create [data-name]', 'Haruto'); await page.waitForTimeout(1500); await shot('03_create');
  await page.click('#create [data-create]');
  await page.waitForSelector('#prologue .pro-opt', { timeout: 60000 }); await page.waitForFunction(() => document.querySelector('.pro-text')?.dataset.done === '1', null, { timeout: 30000 }); await shot('04_goddess');
  await page.click('#prologue .pro-opt'); await page.waitForSelector('#prologue .pro-card', { timeout: 30000 }); await page.waitForFunction(() => document.querySelector('.pro-text')?.dataset.done === '1', null, { timeout: 30000 }); await shot('05_goddess_cards');
  await page.click('#prologue .pro-card'); await page.waitForSelector('#prologue .pro-cls'); await page.click('#prologue .pro-cls[data-v=mage]');
  await page.waitForSelector('#prologue .pro-orb'); await page.waitForTimeout(1500); await shot('06_affinity');
  await page.click('#prologue .pro-orb[data-v=water]'); await page.waitForSelector('.status-wrap.reveal [data-wake]', { timeout: 30000 }); await shot('07_status_reveal');
  await page.click('.status-wrap.reveal [data-wake]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 120000 }); await page.waitForTimeout(2500);
  await chat('/time 12'); await chat('/xp 3000'); await page.waitForTimeout(1500);
  await shot('08_hud');
  await key('KeyU', '.status-win [data-el]'); await page.click('.status-win [data-el=lightning]'); await shot('09_status_fusion'); await page.keyboard.press('Escape');
  await key('KeyP', '.modal, #hero'); await shot('10_hero'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await key('KeyI'); await page.waitForTimeout(800); await shot('11_inventory'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await key('KeyM', '#worldmap .wm-region'); await shot('12_worldmap'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await key('KeyL', '#rankings .rk-t'); await shot('13_rankings'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await key('KeyJ'); await page.waitForTimeout(600); await shot('14_quests'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(900); await shot('15_esc_menu');
  console.log('UISHOTS OK');
} catch (e) { console.error('UISHOTS FAIL', e); await page.screenshot({ path: path.join(out, 'fail.jpg') }); }
await L.browser.close(); server.kill('SIGKILL');
