// Title-menu screenshot: node tests/e2e/menushot.mjs <base> out.png [w h waitMs]
import { launch } from './browser.mjs';
const [, , base, out, W = '1600', H = '900', wait = '6000'] = process.argv;
const { browser, page, errors } = await launch({ viewport: { width: +W, height: +H } });
await page.goto(`${base}/?skipintro=1${process.env.EXTRA || ''}${process.env.Q ? '&quality=' + process.env.Q : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__titleLiveAt, null, { timeout: 240000 });
await page.waitForTimeout(+wait);
if (process.env.EVAL) { console.log('EVAL', JSON.stringify(await page.evaluate(process.env.EVAL))); await page.waitForTimeout(1500); }
if (process.env.CLICK) { await page.click(process.env.CLICK); await page.waitForTimeout(1500); }
await page.screenshot({ path: out });
console.log('shot', out, JSON.stringify(await page.evaluate(() => ({ menu: window.__menuShownAt, live: window.__titleLiveAt, cw: document.getElementById('gl').width, op: getComputedStyle(document.getElementById('gl')).opacity, q: window.__dos.settings.quality, exp: window.__dos.engine.renderer.toneMappingExposure }))), 'errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();
