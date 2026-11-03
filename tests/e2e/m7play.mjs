// M7 browser playthrough + performance: for each quality preset, a fresh New Game (menu → register → create →
// prologue skipped via ?prologue=skip) then the regions and the Tower: capital → forest → desert → frozen →
// Foot of the Tower → Gate → floor 1 → floor 10 (guardian). fps sampled for 6 s per scene while walking.
// Also: time-to-menu for a cold page load (3 runs). Usage: node tests/e2e/m7play.mjs [baseUrl|spawn] outDir [presets]
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const arg = process.argv[2] || 'spawn', out = process.argv[3] || '/tmp/m7', presets = (process.argv[4] || 'low,medium,high').split(',');
fs.mkdirSync(out, { recursive: true });
let server = null, base = arg;
if (arg === 'spawn') {
  const port = 8800 + Math.floor(Math.random() * 90);
  server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-m7p-')), DOS_BOTS: '3', DOS_DEV: '1', DOS_LLM_KEY: '', DOS_LLM_SECRET_FILE: '/nonexistent' }, stdio: ['ignore', 'ignore', 'inherit'] });
  base = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
}
const step = (s) => console.log('·', s);
const results = { menu: [], presets: {} };
// ---- time to menu (cold browser each time)
for (let i = 0; i < 3; i++) {
  const L = await launch({ viewport: { width: 1600, height: 900 } });
  const t0 = Date.now();
  await L.page.goto(base + '/', { waitUntil: 'commit' });
  await L.page.waitForSelector('#menu .tm-item[data-act=newgame]', { state: 'visible', timeout: 60000 });
  results.menu.push(Date.now() - t0);
  await L.browser.close();
}
step('menu visible (cold) ms: ' + results.menu.join(', '));
for (const q of presets) {
  const L = await launch({ viewport: { width: 1600, height: 900 } }); const page = L.page;
  const g = (fn, a) => page.evaluate(fn, a);
  const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(950); };
  const waitZone = async (z) => { await page.waitForFunction((z) => window.__dos.game?.engine.zone === z && !window.__dos.game.loadingZone, z, { timeout: 90000 }); };
  const sample = async (label, shotName) => {
    await page.waitForTimeout(2500);
    await page.keyboard.down('KeyW');
    const xs = [];
    for (let i = 0; i < 12; i++) { await page.waitForTimeout(500); xs.push(await g(() => window.__dos.game.engine.fps)); }
    await page.keyboard.up('KeyW');
    xs.sort((a, b) => a - b);
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length, low = xs[0];
    // headless Chrome paces rAF at ~10 Hz on this box (no GPU: SwiftShader renders on the CPU), so also time one
    // frame's render fully synchronised (readPixels waits for the rasteriser): a CPU-raster cost, comparable across presets
    const ms = await g(() => { const e = window.__dos.game.engine, gl = e.renderer.getContext(), px = new Uint8Array(4); const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); e.render(0.016); sync(); const t = performance.now(); for (let i = 0; i < 3; i++) { e.render(0.016); sync(); } return (performance.now() - t) / 3; });
    results.presets[q].scenes.push({ scene: label, avg: +avg.toFixed(1), min: +low.toFixed(1), frameMs: +ms.toFixed(1), fpsCap: +(1000 / ms).toFixed(1) });
    if (shotName) await page.screenshot({ path: path.join(out, shotName), type: 'jpeg', quality: 82, timeout: 90000 }).catch((e) => step('screenshot skipped: ' + e.message.split('\n')[0]));
    step(`${q} · ${label}: ${avg.toFixed(1)} fps paced (min ${low.toFixed(1)}) · frame ${ms.toFixed(1)} ms → ${(1000 / ms).toFixed(1)} fps uncapped`);
  };
  results.presets[q] = { scenes: [], loads: [] };
  try {
    const t0 = Date.now();
    await page.goto(`${base}/?autotest=1&prologue=skip&quality=${q}`, { waitUntil: 'load' });
    await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 });
    await page.click('#menu .tm-item[data-act=newgame]');
    await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
    await page.click('#login .tabs button[data-m=register]');
    await page.fill('#login [name=username]', 'm7' + q + Date.now().toString(36)); await page.fill('#login [name=password]', 'correct horse battery');
    await page.click('#login button[type=submit]');
    await page.waitForSelector('#create', { timeout: 30000 });
    await page.click('#create .classbtn[data-c=mage]'); await page.fill('#create [data-name]', 'Bench' + q.slice(0, 3) + Date.now().toString(36).slice(-3));
    await page.click('#create [data-create]');
    await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 120000 });
    results.presets[q].newGameMs = Date.now() - t0;
    step(`${q} · New Game → in the world in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await chat('/xp 2500000'); await chat('/time 11');
    await sample('Capital', q === 'high' ? 'm7_high_capital.jpg' : null);
    for (const z of ['forest', 'desert', 'frozen']) { const t = Date.now(); await chat('/zone ' + z); await waitZone(z); results.presets[q].loads.push({ zone: z, ms: Date.now() - t }); await sample(z, q === 'high' && z === 'forest' ? 'm7_high_forest.jpg' : null); }
    await chat('/zone tower'); await waitZone('tower'); await sample('Foot of the Tower');
    await chat('/tpxy 0 -163'); await page.waitForSelector('#towergate .tg-floor', { timeout: 15000 });
    await page.click('#towergate .tg-floor[data-floor="1"]'); await waitZone('f1');
    await sample('Tower floor 1', q === 'medium' ? 'm7_med_floor1.jpg' : null);
    await chat('/floor 10'); await waitZone('f10'); await chat('/room gate');
    await sample('Tower floor 10 (guardian)', q === 'low' ? 'm7_low_floor10.jpg' : null);
    results.presets[q].errors = L.errors.slice(0, 5);
    const sc = results.presets[q].scenes; results.presets[q].avg = +(sc.reduce((a, b) => a + b.avg, 0) / sc.length).toFixed(1);
    results.presets[q].gpu = await g(() => { const c = document.createElement('canvas').getContext('webgl'); const d = c?.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  } catch (e) { console.error('M7 PLAY FAIL', q, e); results.presets[q].fail = String(e); await page.screenshot({ path: path.join(out, `fail_${q}.jpg`) }); }
  await L.browser.close();
}
fs.writeFileSync(path.join(out, 'm7_results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
server?.kill('SIGKILL');
const ok = Object.values(results.presets).every((p) => !p.fail && !(p.errors ?? []).length);
console.log(ok ? 'M7 PLAY OK' : 'M7 PLAY FAIL');
process.exit(ok ? 0 : 1);
