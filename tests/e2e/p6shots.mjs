// POLISH-1 screenshot tour: goddess screen, HUD AI pill, Tower floors 1/10/31 (+ every band), a guardian.
// Usage: LLM_SECRET=/path/llm.secret.json node tests/e2e/p6shots.mjs outDir [W H]   (ONLY=a,b limits shots)
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/p6'; const W = Number(process.argv[3] || 1600), H = Number(process.argv[4] || 900);
fs.mkdirSync(out, { recursive: true });
const port = 8900 + Math.floor(Math.random() * 90);
const env = { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-p6-')), DOS_BOTS: '0', DOS_DEV: '1' };
if (process.env.LLM_SECRET) env.DOS_LLM_SECRET_FILE = process.env.LLM_SECRET; else { env.DOS_LLM_KEY = ''; env.DOS_LLM_SECRET_FILE = '/nonexistent'; }
const server = spawn(process.execPath, ['dist/server.mjs'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const L = await launch({ viewport: { width: W, height: H } }); const page = L.page;
const g = (fn, a) => page.evaluate(fn, a);
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (n) => !only.length || only.includes(n);
const shot = async (n) => { if (!want(n)) return; await page.waitForTimeout(600); await page.screenshot({ path: path.join(out, n + '.jpg'), type: 'jpeg', quality: 86 }); console.log('·', n); };
const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(950); };
const waitZone = (z) => page.waitForFunction((z) => window.__dos.game?.engine?.zone === z, z, { timeout: 90000 }).catch(() => console.log('zone wait timeout', z));
const look = (x, z, pitch = 0.18) => g(([x, z, p]) => { const G = window.__dos.game; const me = G.renderPos; G.cam.yaw = Math.atan2(-(x - me.x), -(z - me.z)); G.cam.pitch = p; }, [x, z, pitch]);
let ok = true;
try {
  await page.goto(`${base}/?autotest=1&lifeSkip=1&quality=${process.env.Q || 'medium'}`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 }); await page.waitForTimeout(1500);
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'p6' + Date.now().toString(36)); await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 60000 }); await page.fill('#create [data-name]', 'Haruto'); await page.waitForTimeout(1000);
  await page.click('#create [data-create]');
  await page.waitForSelector('#prologue .pro-opt', { timeout: 60000 }); await page.waitForFunction(() => document.querySelector('.pro-text')?.dataset.done === '1', null, { timeout: 40000 });
  await page.click('#prologue .pro-opt'); await page.waitForSelector('#prologue .pro-card', { timeout: 40000 }); await page.waitForFunction(() => document.querySelector('.pro-text')?.dataset.done === '1', null, { timeout: 40000 });
  await page.waitForTimeout(2500); await shot('goddess');
  await page.click('#prologue .pro-card'); await page.waitForSelector('#prologue .pro-cls'); await page.waitForTimeout(1500); await shot('goddess_class');
  await page.click('#prologue .pro-cls[data-v=knight]');
  await page.waitForSelector('#prologue .pro-orb'); await page.waitForTimeout(1200);
  await page.click('#prologue .pro-orb[data-v=fire]'); await page.waitForSelector('.status-wrap.reveal [data-wake]', { timeout: 40000 });
  await page.click('.status-wrap.reveal [data-wake]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 120000 }); await page.waitForTimeout(3000);
  await chat('/time 11'); await chat('/xp 200000'); await page.waitForTimeout(1500);
  await page.waitForFunction(() => /online/.test(document.querySelector('.ai-pill')?.className ?? ''), null, { timeout: 20000 }).catch(() => console.log('AI pill not online'));
  console.log('ai pill:', await g(() => document.querySelector('.ai-pill')?.textContent));
  await shot('hud_ai_online');
  const floors = (process.env.FLOORS || '1,10,31').split(',').map(Number);
  for (const n of floors) {
    await chat('/floor ' + n); await waitZone('f' + n); await page.waitForTimeout(4500);
    if (n % 10 === 0) {
      await chat('/room gate'); await page.waitForTimeout(3000);
      const b = await g(() => { const r = [...window.__dos.game.remotes.values()].find((r) => r.ent?.bs || r.plate?.classList.contains('boss')); return r ? { x: r.view.root.position.x, z: r.view.root.position.z, name: r.name } : null; });
      console.log('boss', n, b && b.name);
      if (b) { const G0 = await g(() => { const f = window.__dos.game.engine.settlement.floor.P; return { x: f.gate.x, z: f.gate.z }; }); const dx = G0.x - b.x, dz = G0.z - b.z, d = Math.hypot(dx, dz) || 1; const ox = Math.abs(dx) > 0.5 || Math.abs(dz) > 0.5 ? dx / d : 0, oz = Math.abs(dx) > 0.5 || Math.abs(dz) > 0.5 ? dz / d : 1; await chat(`/tpxy ${(b.x + ox * 9.5).toFixed(1)} ${(b.z + oz * 9.5).toFixed(1)}`); await page.waitForTimeout(500); const b1 = await g(() => { const r = [...window.__dos.game.remotes.values()].find((r) => r.plate?.classList.contains('boss')); return r ? { x: r.view.root.position.x, z: r.view.root.position.z } : null; }); await look((b1 ?? b).x, (b1 ?? b).z, 0.3); }
      await shot('floor' + n);
      if (want('guardian' + n)) { await page.waitForTimeout(1200); const b2 = await g(() => { const r = [...window.__dos.game.remotes.values()].find((r) => r.plate?.classList.contains('boss')); return r ? { x: r.view.root.position.x, z: r.view.root.position.z } : null; }); if (b2) await look(b2.x, b2.z, 0.1); await shot('guardian' + n); }
    } else {
      const P = await g(() => { const f = window.__dos.game.engine.settlement.floor.P; return { x: f.start.x, z: f.start.z, gx: f.gate.x, gz: f.gate.z }; });
      await look(P.x + 10, P.z - 10, 0.05); await page.waitForTimeout(1200);
      await shot('floor' + n);
    }
  }
  console.log('P6SHOTS OK', 'errors:', L.errors.length, L.errors.slice(0, 5).join(' | '));
} catch (e) { ok = false; console.error('P6SHOTS FAIL', e); await page.screenshot({ path: path.join(out, 'fail.jpg') }); }
await L.browser.close(); server.kill('SIGKILL');
process.exit(ok ? 0 : 1);
