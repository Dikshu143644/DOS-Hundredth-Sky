// visionOS glass UI tour (P5). Usage: node tests/e2e/p5shots.mjs outDir [W H]
// Set LLM_SECRET=/path/llm.secret.json to run with the real AI (the HUD pill then reflects it).
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/p5'; const W = Number(process.argv[3] || 1600), H = Number(process.argv[4] || 900);
fs.mkdirSync(out, { recursive: true });
const port = 8900 + Math.floor(Math.random() * 90);
const env = { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-p5-')), DOS_BOTS: '2', DOS_DEV: '1' };
if (process.env.LLM_SECRET) env.DOS_LLM_SECRET_FILE = process.env.LLM_SECRET; else { env.DOS_LLM_KEY = ''; env.DOS_LLM_SECRET_FILE = '/nonexistent'; }
const server = spawn(process.execPath, ['dist/server.mjs'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const L = await launch({ viewport: { width: W, height: H } }); const page = L.page;
const g = (fn, a) => page.evaluate(fn, a);
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const shot = async (n) => { if (only.length && !only.includes(n)) return; await page.waitForTimeout(800); await page.screenshot({ path: path.join(out, n + '.jpg'), type: 'jpeg', quality: 84 }); console.log('·', n); };
const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(950); };
const key = async (k, sel) => { await page.keyboard.press(k); if (sel) await page.waitForSelector(sel, { timeout: 15000 }); };
const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400); };
const waitZone = (z) => page.waitForFunction((z) => window.__dos.game?.zone === z || window.__dos.game?.zoneId === z, z, { timeout: 60000 }).catch(() => {});
let ok = true;
try {
  await page.goto(`${base}/?autotest=1&lifeSkip=1&quality=low`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 }); await page.waitForTimeout(2500);
  await shot('menu');
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]'); await shot('login');
  await page.fill('#login [name=username]', 'p5' + Date.now().toString(36)); await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 60000 }); await page.fill('#create [data-name]', 'Haruto'); await page.waitForTimeout(1500); await shot('create');
  await page.click('#create [data-create]');
  await page.waitForSelector('#prologue .pro-opt', { timeout: 60000 }); await page.waitForFunction(() => document.querySelector('.pro-text')?.dataset.done === '1', null, { timeout: 40000 }); await shot('goddess_talk');
  await page.click('#prologue .pro-opt'); await page.waitForSelector('#prologue .pro-card', { timeout: 40000 }); await page.waitForFunction(() => document.querySelector('.pro-text')?.dataset.done === '1', null, { timeout: 40000 });
  await page.hover('#prologue .pro-card'); await shot('goddess');
  await page.click('#prologue .pro-card'); await page.waitForSelector('#prologue .pro-cls'); await page.waitForTimeout(800); await shot('class');
  await page.click('#prologue .pro-cls[data-v=mage]');
  await page.waitForSelector('#prologue .pro-orb'); await page.waitForTimeout(1500); await shot('affinity');
  await page.click('#prologue .pro-orb[data-v=water]'); await page.waitForSelector('.status-wrap.reveal [data-wake]', { timeout: 40000 }); await shot('status_reveal');
  await page.click('.status-wrap.reveal [data-wake]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 120000 }); await page.waitForTimeout(3000);
  await chat('/time 11'); await chat('/xp 3000'); await chat('/gold 6000'); await page.waitForTimeout(1500);
  await page.waitForFunction(() => document.querySelector('.ai-pill')?.className.match(/online|offline|degraded/), null, { timeout: 15000 }).catch(() => {});
  await shot('hud_capital');
  await key('KeyU', '.status-win [data-el]'); await page.click('.status-win [data-el=lightning]'); await shot('status_fusion'); await esc();
  await key('KeyP', '.modal, #hero'); await shot('hero'); await esc();
  await key('KeyK'); await page.waitForTimeout(700); await shot('skilltree'); await esc();
  await key('KeyI'); await page.waitForTimeout(800); await shot('inventory'); await esc();
  await key('KeyM', '#worldmap .wm-region'); await page.waitForTimeout(600); await shot('map'); await esc();
  await key('KeyL', '#rankings .rk-t'); await shot('rankings'); await esc();
  await key('KeyB', '#questboard .qb-card'); await page.click('#questboard [data-take]').catch(() => {}); await page.waitForTimeout(800); await shot('board'); await esc();
  await chat('/give Bone Shard 8'); await chat('/give Grave-Iron Fragment 4'); await chat('/give Enchant Stone 12');
  await key('KeyC', '#forge [data-tier]'); await page.click('#forge [data-tier="1"]').catch(() => {}); await page.waitForTimeout(300);
  await page.click('#forge [data-craft="craft_axe_1"]').catch(() => {}); await page.waitForTimeout(1200);
  await page.click('#forge [data-tab=Enchant]').catch(() => {}); await page.waitForTimeout(700); await shot('forge'); await esc();
  await chat('/goto sela'); await page.waitForTimeout(1500); await page.keyboard.press('KeyE');
  await page.waitForSelector('.dialog .board-open', { timeout: 10000 }).catch(() => {}); await shot('dialogue');
  await page.click('.dialog .board-open').catch(() => {}); await page.waitForSelector('#shop .mk-row', { timeout: 10000 }).catch(() => {}); await shot('shop'); await esc(); await esc();
  await page.keyboard.press('Escape'); await page.waitForTimeout(900); await shot('esc_menu'); await g(() => document.querySelectorAll('.modal').forEach((m) => m.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))); await page.waitForTimeout(500);
  await chat('/goto sigrun'); await waitZone('frozen'); await page.waitForTimeout(6000); await chat('/time 12'); await page.waitForTimeout(1500); await shot('hud_snow');
  await chat('/goto nefa'); await waitZone('desert'); await page.waitForTimeout(6000); await chat('/time 13'); await page.waitForTimeout(1500); await shot('hud_desert');
  console.log('P5SHOTS OK', 'errors:', L.errors.length, L.errors.slice(0, 5).join(' | '));
} catch (e) { ok = false; console.error('P5SHOTS FAIL', e); await page.screenshot({ path: path.join(out, 'fail.jpg') }); }
await L.browser.close(); server.kill('SIGKILL');
process.exit(ok ? 0 : 1);
