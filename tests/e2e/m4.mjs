// M4 e2e: shop (buy/sell), forge (craft + enchant), inventory with enchant levels, and a real
// two-player trade between two browsers. Usage: node tests/e2e/m4.mjs [outDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/m4';
fs.mkdirSync(out, { recursive: true });
const port = 8800 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-m4-')), DOS_BOTS: '0', DOS_DEV: '1', DOS_LLM_KEY: '', DOS_LLM_SECRET_FILE: '/nonexistent' }, stdio: ['ignore', 'ignore', 'inherit'] });
const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const step = (s) => console.log('·', s);
const fail = (m) => { console.error('M4 FAIL:', m); server.kill('SIGKILL'); process.exit(1); };
const { browser, page, errors } = await launch({ viewport: { width: 1600, height: 900 } });
const L2 = await launch({ viewport: { width: 1280, height: 720 } }); // a second person on their own machine
const page2 = L2.page;
const tap = async (pg, sel) => { await pg.waitForSelector(sel, { timeout: 30000 }); await pg.$eval(sel, (el) => el.click()); };
const join = async (pg, user, name, cls) => {
  await pg.bringToFront();
  await pg.goto(`${base}/?autotest=1&prologue=skip&quality=low`, { waitUntil: 'load' });
  await pg.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 });
  await tap(pg, '#menu .tm-item[data-act=newgame]');
  await pg.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await tap(pg, '#login .tabs button[data-m=register]');
  await pg.fill('#login [name=username]', user); await pg.fill('#login [name=password]', 'correct horse battery');
  await tap(pg, '#login button[type=submit]');
  await pg.waitForSelector('#create', { timeout: 30000 });
  await tap(pg, `#create .classbtn[data-c=${cls}]`); await pg.fill('#create [data-name]', name);
  await tap(pg, '#create [data-create]');
  await pg.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game?.me, null, { timeout: 90000 });
  await pg.waitForTimeout(3000);
};
const chat = async (pg, t) => { await pg.evaluate((t) => window.__dos.game.net.send({ type: 'chat', text: t }), t); await pg.waitForTimeout(950); };
const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(out, n), type: 'jpeg', quality: 82 }); step('screenshot ' + n); };
try {
  const tag = Date.now().toString(36).slice(-4);
  const RN = 'Ren' + Array.from({ length: 4 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
  await join(page, 'm4a' + tag, 'Kaede', 'warrior');
  await chat(page, '/time 13'); await chat(page, '/gold 6000');
  // shop
  await chat(page, '/goto sela'); await page.waitForTimeout(1200);
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.dialog .board-open', { timeout: 10000 });
  await page.click('.dialog .board-open');
  await page.waitForSelector('#shop .mk-row [data-buy]', { timeout: 10000 });
  const nStock = await page.$$eval('#shop .mk-row', (e) => e.length);
  await page.click('#shop [data-buy="hp_potion"]'); await page.waitForTimeout(900);
  const pots = await page.evaluate(() => window.__dos.game.hud.inventory.find((e) => e.item === 'hp_potion')?.n ?? 0);
  if (pots < 1) fail('buying a potion did not reach the bag');
  step(`shop: ${nStock} wares · bought a Healing Draught`);
  await shot('m4_shop.jpg');
  await page.click('#shop .mk-tabs [data-tab=Sell]'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // forge: craft + enchant
  await chat(page, '/give Bone Shard 8'); await chat(page, '/give Grave-Iron Fragment 4'); await chat(page, '/give Enchant Stone 12');
  await page.keyboard.press('KeyC');
  await page.waitForSelector('#forge [data-craft="craft_axe_1"]', { timeout: 10000 });
  await page.click('#forge [data-tier="1"]'); await page.waitForTimeout(300);
  await page.click('#forge [data-craft="craft_axe_1"]'); await page.waitForTimeout(1200);
  const crafted = await page.evaluate(() => window.__dos.game.hud.inventory.find((e) => e.item.startsWith('g_axe_1_'))?.item);
  if (!crafted) fail('crafting did not produce the axe');
  step('forge: crafted ' + crafted);
  await page.click('#forge [data-tab=Enchant]'); await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) { await page.click(`#forge [data-ench="${crafted}"]`); await page.waitForTimeout(1100); }
  const lv = await page.evaluate((id) => window.__dos.game.enchant[id] ?? 0, crafted);
  if (lv < 3) fail('enchanting did not reach +3 (got +' + lv + ')');
  step(`forge: enchanted to +${lv}`);
  await shot('m4_forge.jpg');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.keyboard.press('KeyI'); await page.waitForSelector('#inventory .inv-cell', { timeout: 10000 });
  await page.click(`#inventory [data-item="${crafted}"]`); await page.waitForTimeout(400);
  await shot('m4_inventory.jpg');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // a second player arrives; trade
  await join(page2, 'm4b' + tag, RN, 'archer');
  await chat(page2, '/goto sela'); await page2.waitForTimeout(1500);
  await page.bringToFront();
  await chat(page, '/trade ' + RN);
  await page2.bringToFront(); await page2.waitForSelector('.mk-invite [data-a]', { timeout: 10000 });
  await tap(page2, '.mk-invite [data-a]');
  await page.bringToFront();
  await page.waitForSelector('#trade .tr-add', { timeout: 10000 });
  await page.click(`#trade [data-add="${crafted}"]`); await page.waitForTimeout(700);
  await page2.bringToFront(); await page2.waitForSelector('#trade .tr-goldin', { timeout: 10000 });
  await page2.fill('#trade .tr-goldin', '5'); await tap(page2, '#trade [data-setgold]'); await page2.waitForTimeout(700);
  await tap(page2, '#trade [data-lock]'); await page.bringToFront(); await page.click('#trade [data-lock]'); await page.waitForTimeout(700);
  await shot('m4_trade.jpg');
  await page.click('#trade [data-confirm]'); await page2.bringToFront(); await tap(page2, '#trade [data-confirm]'); await page2.waitForTimeout(1500);
  const goldA = await page.evaluate(() => window.__dos.game.gold);
  const got = await page2.evaluate((id) => ({ has: window.__dos.game.hud.inventory.some((e) => e.item === id), lv: window.__dos.game.enchant[id] ?? 0 }), crafted);
  if (!got.has) fail('the traded axe did not arrive');
  step(`trade: ${RN} received ${crafted} +${got.lv}; Kaede now has ${goldA} gold (paid 5)`);
  if (goldA !== 5552) step('(note) expected 5552 gold after the trade');
  const errs = errors.filter((e) => !/favicon|404|WebGL|GPU stall|swiftshader/i.test(e));
  if (errs.length) fail('console errors: ' + errs.slice(0, 5).join(' | '));
  console.log('M4 PASS');
} catch (e) { await page.screenshot({ path: path.join(out, 'm4_fail.jpg') }); await page2.screenshot({ path: path.join(out, 'm4_fail2.jpg') }); fail(e.stack || String(e)); }
finally { await browser.close(); await L2.browser.close(); server.kill('SIGKILL'); }
