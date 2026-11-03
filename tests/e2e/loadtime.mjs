
// Load-time probe: cold cache, throttled network. Usage: node tests/e2e/loadtime.mjs <url> [downMbps] [rttMs]
import { launch } from './browser.mjs';
const url = process.argv[2]; const down = Number(process.argv[3] || 9); const rtt = Number(process.argv[4] || 150);
const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 720 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: down * 1e6 / 8, uploadThroughput: 1.5e6 / 8 });
let bytes = 0, reqs = 0; const marks = {}; const t0 = Date.now();
cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; reqs++; });
const mark = (k) => { if (!(k in marks)) marks[k] = { s: +((Date.now() - t0) / 1000).toFixed(1), MB: +(bytes / 1e6).toFixed(2), reqs }; };
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
mark('domcontentloaded');
const deadline = Date.now() + 600000;
const sels = JSON.parse(process.env.MARKS || '{}');
while (Date.now() < deadline) {
  for (const [k, js] of Object.entries(sels)) { if (!(k in marks)) { try { if (await page.evaluate(js)) { mark(k); if (process.env.PRESS === k) await page.keyboard.press('Enter'); } } catch {} } }
  if (Object.keys(sels).every((k) => k in marks)) break;
  await new Promise((r) => setTimeout(r, 200));
}
await new Promise((r) => setTimeout(r, 1500)); mark('end');
console.log(JSON.stringify({ url, down, rtt, marks, totalMB: +(bytes / 1e6).toFixed(2), reqs, errors: errors.slice(0, 5) }));
await browser.close();
