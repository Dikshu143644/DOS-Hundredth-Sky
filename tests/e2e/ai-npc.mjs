// AI NPC e2e: walk up to Captain Aldric, say something, wait for a model-written reply, screenshot.
// Usage: node tests/e2e/ai-npc.mjs [--url https://hundredth-sky.sites.tab.bot] [--out dir]
// Without --url it boots dist/server.mjs (set DOS_LLM_SECRET_FILE to give it a model).
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
let base = arg('--url'), server = null;
const out = arg('--out') || '/tmp/ai-npc';
fs.mkdirSync(out, { recursive: true });
if (!base) {
  const port = 8700 + Math.floor(Math.random() * 90);
  server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-ai-')), DOS_BOTS: '0' }, stdio: ['ignore', 'ignore', 'inherit'] });
  base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
}
const fail = (m) => { console.error('AI-NPC FAIL:', m); server?.kill('SIGKILL'); process.exit(1); };
const { browser, page, errors } = await launch({ viewport: { width: 1600, height: 900 } });
try {
  await page.goto(`${base}/?autotest=1&quality=${process.env.Q || 'medium'}`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 90000 });
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'ai' + Date.now().toString(36));
  await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 30000 });
  await page.click('#create .classbtn[data-c=knight]');
  await page.fill('#create [data-name]', 'Seren');
  await page.click('#create [data-create]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 120000 });
  console.log('· in the world');
  await page.waitForTimeout(2500);
  // walk to the nearest important NPC (Aldric by day, wherever his schedule has him)
  const find = () => page.evaluate(() => { const g = window.__dos.game; let best = null, bd = 1e9; for (const r of g.remotes.values()) { if (r.t !== 'n' || r.key !== 'aldric') continue; const d = Math.hypot(r.view.root.position.x - g.me.x, r.view.root.position.z - g.me.z); if (d < bd) { bd = d; best = { id: r.id, x: r.view.root.position.x, z: r.view.root.position.z, d }; } } return best; });
  let t = null;
  for (let i = 0; i < 20 && !t; i++) { t = await find(); if (!t) await page.waitForTimeout(500); }
  if (!t) { const all = await page.evaluate(() => [...window.__dos.game.remotes.values()].map((r) => r.t + ':' + r.key + ':' + r.name)); fail('Captain Aldric not in view; remotes: ' + all.join(', ') + ' errors: ' + errors.slice(0, 5).join(' | ')); }
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 120 && t && t.d > 3.2; i++) {
    await page.evaluate((t) => { const g = window.__dos.game; g.cam.yaw = Math.atan2(-(t.x - g.me.x), -(t.z - g.me.z)); }, t);
    await page.waitForTimeout(150); t = await find();
  }
  await page.keyboard.up('KeyW');
  console.log('· next to Aldric, distance', t.d.toFixed(1));
  await page.waitForTimeout(400);
  await page.evaluate((t) => { const g = window.__dos.game; g.cam.yaw = Math.atan2(-(t.x - g.me.x), -(t.z - g.me.z)) + 0.5; }, t);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.dialog input', { timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.fill('.dialog input', 'Captain, I am Seren, a knight from the south. What trouble stirs near the Hollow Ruins?');
  await page.click('.dialog .row .btn');
  const t0 = Date.now();
  await page.waitForFunction(() => /AI dialogue/.test(document.querySelector('.dialog .ai')?.textContent || '') && (document.querySelector('.dialog .txt')?.textContent || '').length > 12, null, { timeout: 30000 }).catch(() => {});
  const res = await page.evaluate(() => ({ ai: document.querySelector('.dialog .ai')?.textContent, txt: document.querySelector('.dialog .txt')?.textContent }));
  console.log(`· reply after ${((Date.now() - t0) / 1000).toFixed(1)} s · ${res.ai}\n  “${res.txt}”`);
  await page.waitForTimeout(2500); // let the typewriter finish
  res.txt = await page.evaluate(() => document.querySelector('.dialog .txt')?.textContent);
  console.log('  full: “' + res.txt + '”');
  await page.screenshot({ path: path.join(out, 'ai_npc_reply.jpg'), quality: 88 });
  const fps = await page.evaluate(() => Math.round(window.__dos.engine?.fps ?? 0));
  console.log('· fps', fps);
  if (!/AI dialogue/.test(res.ai || '')) fail('reply was scripted, not AI: ' + res.ai);
  console.log('AI-NPC PASS');
} catch (e) { fail(e.stack || String(e)); }
finally { await browser.close(); server?.kill('SIGKILL'); }
