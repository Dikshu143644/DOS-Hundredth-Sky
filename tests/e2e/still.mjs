// Look-dev stills from dev.html: node tests/e2e/still.mjs "<query>" out.png [w h steps]
import { launch } from './browser.mjs';
const [, , q, out, W = '1600', H = '900', steps = '3'] = process.argv;
const base = process.env.DEV_URL || 'http://localhost:5173';
const { browser, page, errors } = await launch({ viewport: { width: +W, height: +H } });
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'log') console.log('[page]', m.text().slice(0, 300)); });
const t0 = Date.now();
await page.goto(`${base}/dev.html?${q}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready || window.__err, null, { timeout: 240000 });
const err = await page.evaluate(() => window.__err);
if (err) { console.log('ERR', err); }
if (process.env.PRE) await page.evaluate(process.env.PRE);
const calls = await page.evaluate((n) => window.__step(n), +steps);
await page.waitForTimeout(400);
await page.screenshot({ path: out });
console.log('shot', out, 'calls', calls, 'ms', Date.now() - t0, 'errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();
