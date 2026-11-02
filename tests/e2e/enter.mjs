// Register → create → enter world, then run optional chat commands and take screenshots.
// Usage: node enter.mjs "<query>" outPrefix [cmd1;cmd2] [cls]
import { launch } from './browser.mjs';
const [, , q, out, cmds, cls] = process.argv;
const { browser, page, errors } = await launch({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text().slice(0, 200)); });
await page.goto(`http://localhost:8787/?autotest=1&${q}`, { waitUntil: 'load' });
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForSelector('#login .panel', { timeout: 120000 });
await page.click('#login .tabs button[data-m=register]');
await page.fill('#login [name=username]', 'u' + Math.floor(Math.random() * 1e8));
await page.fill('#login [name=password]', 'hundredth-sky');
await page.click('#login button[type=submit]');
await page.waitForSelector('#create', { timeout: 30000 });
if (cls) await page.click(`#create .classbtn[data-c=${cls}]`);
await page.fill('#create [data-name]', 'K' + Math.random().toString(36).slice(2, 8));
await page.click('#create [data-create]');
await page.waitForFunction(() => window.__dos.mode === 'game', null, { timeout: 60000 });
await page.waitForTimeout(2500);
for (const c of (cmds || '').split(';').filter(Boolean)) {
  if (c.startsWith('wait:')) { await page.waitForTimeout(Number(c.slice(5))); continue; }
  if (c.startsWith('shot:')) { await page.screenshot({ path: `${out}_${c.slice(5)}.png` }); console.log('shot', c.slice(5)); continue; }
  if (c.startsWith('js:')) { console.log('js', JSON.stringify(await page.evaluate(c.slice(3)))); continue; }
  if (c.startsWith('key:')) { const [k, ms] = c.slice(4).split('@'); await page.keyboard.down(k); await page.waitForTimeout(Number(ms || 100)); await page.keyboard.up(k); continue; }
  await page.evaluate((t) => window.__dos.game.net.send({ type: 'chat', text: t }), c);
  await page.waitForTimeout(400);
}
console.log('fps', await page.evaluate(() => window.__dos.engine.fps), 'errors', JSON.stringify(errors.slice(0, 8)));
await browser.close();
