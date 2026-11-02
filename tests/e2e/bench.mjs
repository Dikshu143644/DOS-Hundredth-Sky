// Runs the in-game ?bench=1 flythrough headless for each preset and prints fps.
import { launch } from './browser.mjs';
const base = process.argv[2] || 'http://localhost:8787';
const presets = (process.argv[3] || 'low,medium,high').split(',');
const [w, h] = (process.argv[4] || '1280x720').split('x').map(Number);
for (const q of presets) {
  const { browser, page } = await launch({ viewport: { width: w, height: h } });
  await page.goto(`${base}/?bench=1&quality=${q}`);
  await page.keyboard.press('Enter');
  const r = await page.waitForFunction(() => window.__benchResult, null, { timeout: 600000, polling: 1000 }).then((h) => h.jsonValue());
  console.log(JSON.stringify(r));
  await browser.close();
}
