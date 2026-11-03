// M6 e2e: one browser player + scripted WebSocket players. Party (invite x3, frames) → guild (found, a bot joins,
// bank deposit) → timed world boss (event chip) → Eclipse raid with a party of 4 → PvP arena (queue, countdown,
// forfeit win, Elo) → anti-cheat counters on /health. Usage: node tests/e2e/m6.mjs outDir
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import WebSocket from 'ws';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/m6'; fs.mkdirSync(out, { recursive: true });
const port = 8800 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-m6-')), DOS_BOTS: '0', DOS_DEV: '1', DOS_LLM_KEY: '', DOS_LLM_SECRET_FILE: '/nonexistent' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const step = (s) => console.log('·', s); const fail = (s) => { throw new Error(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = Date.now().toString(36).slice(-4);

/** A headless player that auto-accepts party invites and remembers what it was told. */
function wsPlayer(name, cls) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const st = { name, id: 0, zone: '', inbox: [], ws, send: (m) => ws.send(JSON.stringify(m)), seq: 0 };
    ws.on('open', () => st.send({ type: 'register', user: name.toLowerCase(), pass: 'secret123' }));
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)); st.inbox.push(m); if (st.inbox.length > 400) st.inbox.shift();
      if (m.type === 'auth' && m.ok) st.send({ type: 'createChar', name, cls, appearance: { tint: 0xffffff, accent: 0x33ccff, headgear: false, cape: true, scale: 1 } });
      if (m.type === 'chars' && m.list.length) st.send({ type: 'join', charId: m.list[0].id });
      if (m.type === 'joined') { st.id = m.id; st.zone = m.zone; st.send({ type: 'prologue', step: 'skip' }); resolve(st); }
      if (m.type === 'zone') st.zone = m.zone;
      if (m.type === 'invite' && m.kind === 'party') setTimeout(() => st.send({ type: 'social', op: 'accept' }), 200);
    });
  });
}
const L = await launch({ viewport: { width: 1600, height: 900 } }); const page = L.page;
const g = (fn, a) => page.evaluate(fn, a);
const chat = async (t) => { await g((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await page.waitForTimeout(950); };
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(out, n), type: 'jpeg', quality: 84 }); step('screenshot ' + n); };
const waitZone = async (z) => { await page.waitForFunction((z) => window.__dos.game?.engine.zone === z && !window.__dos.game.loadingZone, z, { timeout: 60000 }); await page.waitForTimeout(1500); };
const bots = [];
let ok = false;
try {
  await page.goto(`${base}/?autotest=1&prologue=skip&quality=low`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 });
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'cap' + tag); await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 30000 });
  await page.click('#create .classbtn[data-c=knight]'); await page.fill('#create [data-name]', 'Captain' + tag);
  await page.click('#create [data-create]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await chat('/xp 900000'); await chat('/gold 3000'); await chat('/time 11');
  for (const [i, c] of [['Aria', 'mage'], ['Brann', 'warrior'], ['Cyra', 'archer'], ['Rival', 'warrior']].entries()) bots.push(await wsPlayer(c[0] + tag, c[1]));
  step('4 scripted players online');
  // ---------------- party
  await page.keyboard.press('KeyO');
  await page.waitForSelector('#social .so-box', { timeout: 10000 });
  for (const b of bots.slice(0, 3)) { await page.fill('#social [data-inv]', b.name); await page.click('#social [data-act=invite]'); await page.waitForTimeout(700); }
  await page.waitForFunction(() => window.__dos.game.soc.party?.members.length === 4, null, { timeout: 15000 });
  await page.waitForSelector('.pt-frames .pt-f:nth-child(3)', { timeout: 10000 });
  step('party of 4: frames for 3 allies');
  await shot('m6_party.jpg');
  // ---------------- guild
  await page.click('#social [data-tab=guild]');
  await page.fill('#social [data-gname]', 'Dawn Wardens ' + tag.slice(0, 2)); await page.fill('#social [data-gtag]', 'DW' + tag.slice(0, 2));
  await page.click('#social [data-act=gcreate]');
  await page.waitForFunction(() => !!window.__dos.game.soc.guild, null, { timeout: 10000 });
  const gid = await g(() => window.__dos.game.soc.guild.id);
  bots[0].send({ type: 'social', op: 'gjoin', id: gid }); bots[1].send({ type: 'social', op: 'gjoin', id: gid });
  await page.waitForFunction(() => window.__dos.game.soc.guild?.members.length === 3, null, { timeout: 10000 });
  await page.fill('#social [data-dg]', '750'); await page.click('#social [data-act=depgold]');
  await page.waitForFunction(() => window.__dos.game.soc.guild?.bank.gold === 750, null, { timeout: 10000 });
  bots[0].send({ type: 'social', op: 'gchat', text: 'for the dawn!' });
  await page.waitForTimeout(800);
  await page.fill('#social [data-gchat]', 'welcome, both of you'); await page.click('#social [data-act=gchat]');
  await page.waitForTimeout(800);
  step('guild founded, 2 joined, 750 g in the bank, guild chat both ways');
  await shot('m6_guild.jpg');
  // ---------------- world boss
  await chat('/worldboss');
  await page.waitForSelector('.ev-chip.wb', { timeout: 15000 });
  await page.waitForFunction(() => window.__dos.game.soc.wb?.state === 'active', null, { timeout: 15000 });
  await page.click('#social [data-tab=events]');
  step('world boss: ' + (await page.$eval('.ev-chip', (e) => e.textContent)));
  await shot('m6_worldboss.jpg');
  // ---------------- raid (party of 4)
  await page.click('#social [data-act=raid]');
  await waitZone('raid1');
  await page.waitForSelector('.ev-chip.raid', { timeout: 15000 });
  for (let i = 0; i < 30 && !bots.slice(0, 3).every((b) => b.zone === 'raid1'); i++) await sleep(200);
  if (!bots.slice(0, 3).every((b) => b.zone === 'raid1')) fail('party did not enter the raid together');
  step('raid: party of 4 inside the Eclipse Throne · ' + (await page.$eval('.ev-chip', (e) => e.textContent)));
  await g(() => window.__dos.game.engine.cam && (window.__dos.game.engine.camYaw = Math.PI)); 
  await shot('m6_raid.jpg');
  // ---------------- arena
  await chat('/zone capital'); await waitZone('capital');
  await page.keyboard.press('KeyO'); await page.waitForSelector('#social .so-box');
  await page.click('#social [data-tab=arena]'); await page.click('#social [data-act=ajoin]');
  bots[3].send({ type: 'social', op: 'arenaJoin' });
  await waitZone('arena');
  await page.waitForSelector('.ev-chip.arena', { timeout: 10000 });
  step('arena: matched · ' + (await page.$eval('.ev-chip', (e) => e.textContent)));
  await shot('m6_arena.jpg');
  await page.waitForTimeout(5500);
  bots[3].ws.close();
  await waitZone('capital');
  await page.waitForFunction(() => (window.__dos.game.soc.arena?.wins ?? 0) === 1, null, { timeout: 10000 });
  const rating = await g(() => window.__dos.game.soc.arena.rating);
  if (rating <= 1000) fail('rating did not rise: ' + rating);
  await page.keyboard.press('KeyO'); await page.waitForSelector('#social .so-box'); await page.click('#social [data-tab=arena]');
  step('arena: opponent left → forfeit win, rating ' + rating);
  await shot('m6_arena_board.jpg');
  const h = await (await fetch(base + '/health')).json();
  if (!h.anticheat || h.anticheat.kicks !== 0) fail('anticheat health: ' + JSON.stringify(h.anticheat));
  step('health: anticheat ' + JSON.stringify(h.anticheat) + ' · social ' + JSON.stringify(h.social));
  if (L.errors.length) fail('console errors: ' + L.errors.slice(0, 3).join(' | '));
  ok = true; console.log('M6 E2E OK');
} catch (e) { console.error('M6 E2E FAIL', e); await page.screenshot({ path: path.join(out, 'fail.jpg') }); }
for (const b of bots) try { b.ws.close(); } catch {}
await L.browser.close(); server.kill('SIGKILL');
process.exit(ok ? 0 : 1);
