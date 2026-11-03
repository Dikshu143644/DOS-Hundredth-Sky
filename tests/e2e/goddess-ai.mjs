// Goddess live-AI check: New Game → soul creation → the Goddess. Counts how many of her replies in a
// row are model-written (badge "AI · remembers you", not a scripted line), watches the in-world
// "thinking…" indicator and the streamed words, and screenshots the last real reply.
// Usage: node tests/e2e/goddess-ai.mjs [baseUrl|--local] [outDir] [talks=3]
// --local boots dist/server.mjs (DOS_LLM_SECRET_FILE gives it a model).
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { launch } from './browser.mjs';
let base = process.argv[2] || 'https://hundredth-sky.sites.tab.bot'; const out = process.argv[3] || '/tmp/goddess-ai'; const talks = Number(process.argv[4] || 3);
fs.mkdirSync(out, { recursive: true });
let server = null;
if (base === '--local') {
  const port = 8700 + Math.floor(Math.random() * 90);
  server = spawn(process.execPath, ['dist/server.mjs'], { env: { ...process.env, PORT: String(port), DOS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dos-gai-')), DOS_BOTS: '0' }, stdio: ['ignore', 'ignore', 'inherit'] });
  base = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
}
const SCRIPTED = /Hush, little soul|Patient, aren’t you|I hear you\. But first/;
const L = await launch({ viewport: { width: 1600, height: 900 } }); const page = L.page;
const results = [];
// watch the dialogue box: did we see the thinking indicator, and streamed text before the final line?
const watch = () => page.evaluate(() => { const w = (window.__gw = { thinking: false, streamed: 0 }); const t = document.querySelector('.pro-text'); new MutationObserver(() => { if (t.classList.contains('thinking')) w.thinking = true; if (t.classList.contains('streaming')) w.streamed++; }).observe(t, { attributes: true, childList: true, characterData: true, subtree: true }); });
const reply = async (label, t0) => {
  await page.waitForFunction(() => { const t = document.querySelector('.pro-text'); return t && t.dataset.done === '1' && !t.classList.contains('thinking'); }, null, { timeout: 40000 });
  const r = await page.evaluate(() => ({ cls: document.querySelector('.pro-src')?.className || '', badge: document.querySelector('.pro-src')?.textContent, txt: document.querySelector('.pro-text')?.textContent || '', w: { ...(window.__gw || {}) } }));
  const ai = /\bllm\b/.test(r.cls) && !SCRIPTED.test(r.txt);
  results.push({ label, ai, ms: Date.now() - t0, thinking: r.w.thinking, streamedUpdates: r.w.streamed, txt: r.txt });
  console.log(`${ai ? 'AI ' : 'SCRIPTED'} ${label} ${Date.now() - t0} ms thinking=${r.w.thinking} streamed=${r.w.streamed}: ${r.txt}`);
  await page.evaluate(() => { window.__gw.thinking = false; window.__gw.streamed = 0; });
  return ai;
};
let ok = false;
try {
  const t0 = Date.now();
  await page.goto(`${base}/?lifeSkip=1&quality=low`, { waitUntil: 'load' });
  await page.waitForSelector('#menu .tm-item[data-act=newgame]', { timeout: 60000 }); console.log('menu visible ms', Date.now() - t0);
  await page.click('#menu .tm-item[data-act=newgame]');
  await page.waitForSelector('#login button[type=submit]', { timeout: 120000 });
  await page.click('#login .tabs button[data-m=register]');
  await page.fill('#login [name=username]', 'ga' + Date.now().toString(36)); await page.fill('#login [name=password]', 'correct horse battery');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#create', { timeout: 60000 }); await page.fill('#create [data-name]', 'Kai' + Math.random().toString(36).slice(2, 6)); await page.click('#create [data-create]');
  await page.waitForSelector('#prologue .pro-text', { timeout: 90000 }); await watch();
  let t = Date.now(); await reply('greeting', t);
  await page.waitForSelector('#prologue .pro-opt', { timeout: 30000 });
  t = Date.now(); await page.click('#prologue .pro-opt'); await reply('past life', t);
  const lines = ['Will I see my family again?', 'What is waiting for me at the top of the Tower?', 'Why did you choose me, of all souls?', 'Are you lonely here in the void?', 'What should I fear below?'];
  for (let i = 0; i < talks; i++) {
    await page.fill('#prologue .pro-talk input', lines[i % lines.length]);
    t = Date.now(); await page.click('#prologue .pro-talk button');
    await reply('talk ' + (i + 1) + ': ' + lines[i % lines.length], t);
  }
  await page.screenshot({ path: out + '/goddess_ai.jpg', type: 'jpeg', quality: 86 });
  // the last N replies in a row must all be AI
  let streak = 0; for (const r of results) streak = r.ai ? streak + 1 : 0;
  ok = streak >= talks;
  console.log('AI streak at end', streak, 'of', results.length);
  try { const h = await (await fetch(base + '/health')).json(); console.log('health.llm', JSON.stringify({ lastModel: h.llm.lastModel, count429: h.llm.count429, lastLatencyMs: h.llm.lastLatencyMs, calls: h.llm.calls, failures: h.llm.failures })); } catch {}
} catch (e) { console.error('GODDESS-AI FAIL', e); await page.screenshot({ path: out + '/fail.jpg' }); }
fs.writeFileSync(out + '/goddess_ai.json', JSON.stringify(results, null, 1));
await L.browser.close(); server?.kill('SIGKILL');
console.log(ok ? 'GODDESS AI OK' : 'GODDESS AI NOT CONFIRMED'); process.exit(ok ? 0 : 1);
