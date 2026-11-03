// M2 e2e: stream every region in, check its monsters/boss/shrines, walk through a real gate, attune a shrine,
// fast-travel back. Saves a screenshot per region + the world map. Usage: node tests/e2e/m2.mjs [outDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/m2';
fs.mkdirSync(out, { recursive: true });
const port = 8600 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-m2-')), DOS_BOTS: '1', DOS_DEV: '1', DOS_LLM_KEY: '', DOS_LLM_SECRET_FILE: '/nonexistent' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const step = (s) => console.log('·', s);
const fail = (m) => { console.error('M2 FAIL:', m); server.kill('SIGKILL'); process.exit(1); };
const { browser, page, errors } = await launch({ viewport: { width: 1600, height: 900 } });
const g = (fn, a) => page.evaluate(fn, a);
const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(900); };
const waitZone = async (z) => { try { await page.waitForFunction((z) => window.__dos.game.engine.zone === z && !window.__dos.game.loadingZone, z, { timeout: 120000 }); } catch { const st = await g(() => ({ zone: window.__dos.game.engine.zone, loading: window.__dos.game.loadingZone, me: [window.__dos.game.me.x, window.__dos.game.me.z], notices: [...document.querySelectorAll('.notice, .chat .line')].slice(-6).map((e) => e.textContent) })); fail('zone ' + z + ' never arrived: ' + JSON.stringify(st) + ' errors: ' + errors.slice(0, 6).join(' | ')); } await page.waitForTimeout(400); };
try {
  await page.goto(`${base}/?autotest=1&prologue=skip&quality=${process.env.Q || 'medium'}`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 });
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'm2' + Date.now().toString(36));
  await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 30000 });
  await page.click('#create .classbtn[data-c=mage]');
  await page.fill('#create [data-name]', 'Wanderer');
  await page.click('#create [data-create]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await chat('/xp 900000');
  await chat('/time 15');
  // 1) a real walk through the southern gate of the Capital into the Ancient Forest
  await g(() => { const gm = window.__dos.game; gm.me.x = 20; gm.me.z = 160; });
  await chat('/tp exit_forest');
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__dos.game.cam.yaw = Math.PI; });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
  await waitZone('forest');
  step(`walked through the Capital's south gate → Ancient Forest (streamed in ${await g(() => window.__zoneMs)} ms)`);
  // 2) every region: stream it, count its monsters, shoot it, visit the boss
  const ZONES = ['capital', 'forest', 'mountain', 'desert', 'frozen', 'forbidden', 'tower'];
  const report = [];
  for (const z of ZONES) {
    await chat('/zone ' + z);
    await waitZone(z);
    await page.waitForTimeout(3500);
    const info = await g(() => { const gm = window.__dos.game; const ms = [...gm.remotes.values()].filter((r) => r.t === 'm'); return { ms: ms.length, kinds: [...new Set(ms.map((r) => r.key))], fps: Math.round(gm.engine.fps), zms: window.__zoneMs, weather: gm.engine.weather }; });
    await page.screenshot({ path: path.join(out, `m2_${z}.jpg`), quality: 85 });
    await chat('/boss');
    await page.waitForTimeout(3500);
    const boss = await g(() => [...window.__dos.game.remotes.values()].filter((r) => r.t === 'm' && ['gravelord', 'mushking', 'colossus', 'sandmaw', 'hrimfang', 'malakar', 'skyfang'].includes(r.key)).map((r) => r.name));
    await page.screenshot({ path: path.join(out, `m2_${z}_boss.jpg`), quality: 85 });
    report.push({ z, ...info, boss: boss.join(',') });
    step(`${z}: streamed ${info.zms} ms · ${info.ms} monsters near spawn (${info.kinds.join(', ')}) · boss: ${boss.join(',') || 'none in view'} · weather ${info.weather} · ${info.fps} fps (software GL)`);
    if (!boss.length) fail('no field boss visible in ' + z);
  }
  // 3) attune a shrine in the forest, fast-travel back to the Capital and then to it
  await chat('/zone forest'); await waitZone('forest');
  if (await page.$('.death')) { step('(the hero had fallen in the last region, rising first)'); await g(() => window.__dos.game.net.send({ type: 'respawn' })); await page.waitForTimeout(3000); await chat('/zone forest'); await waitZone('forest'); }
  await chat('/tp shrine_elderwood'); await page.waitForTimeout(2500);
  let attuned = await g(() => window.__dos.game.mapState.attuned);
  if (!attuned.includes('forest:elderwood')) {
    const st = await g(() => { const G = window.__dos.game; return { me: [Math.round(G.me.x), Math.round(G.me.z)], hp: G.me.hp, dead: G.me.dead, zone: G.engine.zone, log: [...document.querySelectorAll('.chat .log div')].slice(-5).map((e) => e.textContent) }; });
    await chat('/where'); await page.waitForTimeout(600);
    step('first tp did not attune: ' + JSON.stringify(st) + ' server says: ' + await g(() => [...document.querySelectorAll('.chat .log div')].slice(-1)[0]?.textContent));
    await page.waitForTimeout(6000); await chat('/tp shrine_elderwood'); await page.waitForTimeout(2500);
    attuned = await g(() => window.__dos.game.mapState.attuned);
  }
  if (!attuned.includes('forest:elderwood')) fail('shrine not attuned: ' + attuned.join(','));
  await page.keyboard.press('KeyM'); await page.waitForSelector('#worldmap .wm-region', { timeout: 15000 }); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, 'm2_worldmap.jpg'), quality: 85 });
  await page.click('#worldmap .wm-side [data-go="capital:dawn"]');
  await waitZone('capital');
  step('attuned Elderwood Shrine, fast-travelled to the Shrine of Dawn via the world map');
  await page.keyboard.press('KeyM'); await page.waitForSelector('#worldmap .wm-side [data-go="forest:elderwood"]');
  await page.click('#worldmap .wm-side [data-go="forest:elderwood"]');
  await waitZone('forest');
  step('and back to the forest shrine');
  const errs = errors.filter((e) => !/favicon|404|WebGL|GPU stall|swiftshader/i.test(e));
  if (errs.length) fail('console errors: ' + errs.slice(0, 5).join(' | '));
  fs.writeFileSync(path.join(out, 'm2_report.json'), JSON.stringify(report, null, 1));
  console.log('M2 PASS');
} catch (e) { fail(e.stack || String(e)); }
finally { await browser.close(); server.kill('SIGKILL'); }
