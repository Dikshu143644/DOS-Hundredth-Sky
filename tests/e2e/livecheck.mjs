import { launch } from './browser.mjs';
const base = process.argv[2] || 'https://hundredth-sky.sites.tab.bot'; const out = process.argv[3] || '/tmp/live';
import fs from 'node:fs'; fs.mkdirSync(out, { recursive: true });
const L = await launch({ viewport: { width: 1600, height: 900 } }); const page = L.page; let ok = false;
try {
  const t0 = Date.now();
  await page.goto(`${base}/?lifeSkip=1&quality=low`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 }); console.log('menu visible ms', Date.now() - t0);
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'lv' + Date.now().toString(36)); await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 60000 }); await page.fill('#create [data-name]', 'Hr' + Math.random().toString(36).slice(2, 8)); await page.click('#create [data-create]');
  await page.waitForSelector('#prologue .pro-opt', { timeout: 90000 }); await page.waitForFunction(() => document.querySelector('.pro-text')?.dataset.done === '1', null, { timeout: 40000 });
  await page.click('#prologue .pro-opt'); await page.waitForSelector('#prologue .pro-card', { timeout: 60000 }); await page.waitForFunction(() => document.querySelector('.pro-text')?.dataset.done === '1', null, { timeout: 40000 });
  const src = await page.evaluate(() => ({ cls: document.querySelector('.pro-src')?.className, txt: document.querySelector('.pro-text')?.textContent, badge: document.querySelector('.pro-src')?.textContent }));
  console.log('goddess', JSON.stringify(src));
  await page.screenshot({ path: out + '/live_goddess.jpg', type: 'jpeg', quality: 84 });
  ok = /llm/.test(src.cls || '');
} catch (e) { console.error('LIVE FAIL', e); await page.screenshot({ path: out + '/fail.jpg' }); }
await L.browser.close(); console.log(ok ? 'LIVE AI OK' : 'LIVE AI NOT CONFIRMED'); process.exit(ok ? 0 : 1);
