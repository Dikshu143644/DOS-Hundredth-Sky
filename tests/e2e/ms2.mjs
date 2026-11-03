// Phase-2 milestone stills from the real client: sky-castle login + armory showcases.
import { launch } from './browser.mjs';
const [, , out, W = '1920', H = '1080', base = 'http://localhost:5173'] = process.argv;
const { browser, page, errors } = await launch({ viewport: { width: +W, height: +H } });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[page]', m.type(), m.text().slice(0, 200)); });
await page.goto(`${base}/?skipintro=1&quality=ultra`, { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.keyboard.press('Enter');
await page.waitForSelector('#login .sk-glass', { timeout: 180000 });
await page.waitForTimeout(9000);
await page.screenshot({ path: `${out}/p2_login.png` });
console.log('login shot');
for (const id of (process.env.WEAPONS ?? 'frostfang,ignis_edge').split(',').filter(Boolean)) {
  await page.evaluate((i) => window.__dos.openArmory(i), id);
  await page.waitForSelector('#armory .ar-card', { timeout: 120000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/p2_armory_${id}.png` });
  console.log('armory', id);
  await page.click('#armory [data-close]');
  await page.waitForTimeout(300);
}
if (process.env.LINEUP) { await page.evaluate(() => window.__dos.openArmory('frostfang')); await page.waitForTimeout(1500); await page.click('#armory [data-lineup]'); await page.waitForTimeout(5000); await page.screenshot({ path: `${out}/p2_lineup.png` }); }
console.log('mode', await page.evaluate(() => window.__dos.mode), 'errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();
