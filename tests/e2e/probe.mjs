import { launch } from './browser.mjs';
const [, , q, secs = '60'] = process.argv;
const { browser, page, errors } = await launch({ viewport: { width: 800, height: 450 } });
page.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 300)));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url()));
await page.goto(`http://localhost:5173/dev.html?${q}`, { waitUntil: 'load' });
for (let i = 0; i < +secs; i += 5) { await page.waitForTimeout(5000); const st = await page.evaluate(() => ({ r: !!window.__ready, e: window.__err })); console.log(i, JSON.stringify(st)); if (st.r || st.e) break; }
console.log('errors', JSON.stringify(errors.slice(0, 5)));
await browser.close();
