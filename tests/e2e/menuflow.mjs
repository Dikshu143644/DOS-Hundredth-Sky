// Title-menu flow test (phase 3): menu → New Game → register → create → world; reload → Continue → same hero;
// Settings opens and closes; Quit logs out. Usage: node tests/e2e/menuflow.mjs <baseUrl> [shotDir]
import { launch } from './browser.mjs';
const base = process.argv[2] || 'http://localhost:8787';
const shots = process.argv[3];
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const { browser, page, errors } = await launch({ viewport: { width: W, height: H } });
const fail = async (m) => { console.error('MENUFLOW FAIL:', m, JSON.stringify(errors.slice(0, 5))); if (shots) await page.screenshot({ path: shots + '/fail.png' }).catch(() => {}); await browser.close(); process.exit(1); };
const step = (s) => console.log('·', s);
const q = process.env.Q || 'low';
try {
  await page.goto(`${base}/?autotest=1&prologue=skip&quality=${q}`, { waitUntil: 'load' });
  await page.waitForSelector('#menu [data-act=continue]', { timeout: 60000 });
  const t = await page.evaluate(() => ({ menu: Math.round(window.__menuShownAt) }));
  step(`title menu shown (${t.menu} ms after navigation start)`);
  const labels = await page.$$eval('#menu .tm-item span', (e) => e.map((x) => x.textContent));
  if (labels.join('|') !== 'Continue|New Game|Settings|Quit') await fail('menu items: ' + labels.join('|'));
  step('menu items: ' + labels.join(' / '));
  // Settings opens over the title and closes back to it
  await page.click('#menu .tm-item[data-act=settings]');
  await page.waitForSelector('.modal [data-close]', { timeout: 10000 });
  await page.click('.modal [data-close]');
  await page.waitForFunction(() => !document.querySelector('#menu.tm-hidden'), null, { timeout: 10000 });
  step('settings opened and closed');
  // New Game → glass login over the menu → register
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 30000 });
  const user = 'menu' + Date.now().toString(36) + '@test.dev';
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', user);
  await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 240000 });
  step('New Game → registered → character creation (world streamed in)');
  await page.click('#create .classbtn[data-c=knight]');
  const name = 'Menu' + Math.floor(Math.random() * 9999);
  await page.fill('#create [data-name]', name);
  await page.click('#create [data-create]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game, null, { timeout: 120000 });
  step(`entered the world as ${name}`);
  await page.waitForTimeout(2500);
  if (shots) await page.screenshot({ path: shots + '/ingame.png' });
  // reload → Continue resumes the same hero without the create/select screens
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#menu [data-act=continue]', { timeout: 60000 });
  const who = await page.$eval('#menu', (e) => e.querySelector('.tm-who')?.textContent || '');
  if (who !== name) await fail('title bars should show the last hero, got ' + who);
  await page.click('#menu .tm-item[data-act=continue]');
  await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game, null, { timeout: 120000 });
  const me = await page.evaluate(() => window.__dos.game?.myName ?? window.__dos.game?.joined?.char?.name ?? null);
  step('Continue → straight back into the world' + (me ? ' as ' + me : ''));
  // Quit from the title logs out
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#menu [data-act=quit]', { timeout: 60000 });
  await page.click('#menu .tm-item[data-act=quit]');
  await page.waitForSelector('.tm-confirm [data-y]', { timeout: 10000 });
  await page.click('.tm-confirm [data-y]');
  await page.waitForTimeout(2500);
  await page.waitForSelector('#menu [data-act=continue]', { timeout: 60000 });
  const tok = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dos.token.')).length);
  if (tok) await fail('quit should clear the session');
  step('Quit → logged out');
  const bad = errors.filter((e) => !/WebSocket|favicon|404/.test(e));
  if (bad.length) await fail('page errors: ' + bad.join(' | '));
  console.log('MENUFLOW OK');
  await browser.close();
} catch (e) { await fail(String(e)); }
