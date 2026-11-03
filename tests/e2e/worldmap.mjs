// World map e2e: the illustrated map paints from real terrain, labels do not overlap, shrines are
// clickable, the compact fast-travel list works, and it fits a phone. Usage: node tests/e2e/worldmap.mjs [outDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/wm';
fs.mkdirSync(out, { recursive: true });
const port = 8800 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-wm-')), DOS_BOTS: '0', DOS_DEV: '1', DOS_LLM_KEY: '', DOS_LLM_SECRET_FILE: '/nonexistent' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const step = (s) => console.log('·', s);
let page;
const fail = async (m) => { console.error('WORLDMAP FAIL:', m); try { await page.screenshot({ path: path.join(out, 'fail.jpg'), type: 'jpeg', quality: 70 }); } catch {} server.kill('SIGKILL'); process.exit(1); };
const L = await launch({ viewport: { width: 1600, height: 900 } }); page = L.page;
const g = (fn, a) => page.evaluate(fn, a);
const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(900); };
const waitZone = async (z) => { await page.waitForFunction((z) => window.__dos.game.engine.zone === z && !window.__dos.game.loadingZone, z, { timeout: 120000 }); await page.waitForTimeout(500); };
const overlaps = () => g(() => {
  const els = [...document.querySelectorAll('#worldmap .wm-region b, #worldmap .wm-region small, #worldmap .wm-town em, #worldmap .wm-towerlbl')].map((e) => ({ t: e.textContent, r: e.getBoundingClientRect() })).filter((e) => e.r.width > 0);
  const bad = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i].r, b = els[j].r; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(els[i].t + ' × ' + els[j].t); }
  return bad;
});
try {
  await page.goto(`${base}/?autotest=1&prologue=skip&quality=low`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 });
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'wm' + Date.now().toString(36));
  await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 60000 });
  await page.fill('#create [data-name]', 'Cartographer');
  await page.click('#create [data-create]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  for (const z of ['forest', 'desert']) { await chat('/zone ' + z); await waitZone(z); }
  await chat('/zone capital'); await waitZone('capital');
  await page.keyboard.press('KeyM');
  await page.waitForSelector('#worldmap .wm-region', { timeout: 30000 });
  await page.waitForTimeout(1200);
  step('map painted from terrain in ' + await g(() => window.__mapPaintMs) + ' ms');
  let bad = await overlaps(); if (bad.length) await fail('labels overlap: ' + bad.join(', '));
  await page.screenshot({ path: path.join(out, 'worldmap.jpg'), type: 'jpeg', quality: 85 });
  const n = await g(() => ({ regions: document.querySelectorAll('#worldmap .wm-region').length, shrines: document.querySelectorAll('#worldmap .wm-shrine').length, lit: document.querySelectorAll('#worldmap .wm-shrine.on').length, list: document.querySelectorAll('#worldmap .wm-side .wm-go').length, locked: document.querySelector('#worldmap .wm-locked').textContent }));
  if (n.regions !== 7 || n.shrines !== 14) await fail('map content: ' + JSON.stringify(n));
  step(`7 regions, 14 shrines (${n.lit} attuned), list: ${n.list} + "${n.locked}"`);
  // zoom in on the player, click the attuned shrine
  await page.click('#worldmap [data-me]'); await page.waitForTimeout(600);
  await page.click('#worldmap .wm-shrine.on'); await page.waitForSelector('#worldmap .wm-pop.on [data-go]');
  await page.screenshot({ path: path.join(out, 'worldmap_zoom.jpg'), type: 'jpeg', quality: 85 });
  step('zoomed to the player, shrine popup shows Travel here');
  await page.keyboard.press('Escape');
  // phone size
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  await page.keyboard.press('KeyM'); await page.waitForSelector('#worldmap .wm-region'); await page.waitForTimeout(1000);
  bad = await overlaps();
  await page.screenshot({ path: path.join(out, 'worldmap_phone.jpg'), type: 'jpeg', quality: 85 });
  step('phone size: ' + (bad.length ? 'overlaps ' + bad.join(', ') : 'no overlapping labels'));
  if (bad.length) await fail('phone overlaps');
  const errs = L.errors.filter((e) => !/favicon|404|net::ERR/.test(e));
  if (errs.length) await fail('console errors: ' + errs.slice(0, 5).join(' | '));
  console.log('WORLDMAP OK');
} catch (e) { await fail(String(e?.stack || e)); }
await L.browser.close(); server.kill('SIGKILL');
