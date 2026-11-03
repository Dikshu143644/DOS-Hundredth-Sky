import { launch } from '../../tests/e2e/browser.mjs';
const [url, out, w, h] = process.argv.slice(2);
const L = await launch({ viewport: { width: Number(w || 1600), height: Number(h || 900) } });
await L.page.goto(url);
await L.page.waitForFunction(() => window.done === true, null, { timeout: 120000 });
await L.page.screenshot({ path: out, type: 'jpeg', quality: 85 });
console.log('errors', JSON.stringify(L.errors.slice(0, 5)));
await L.browser.close();
