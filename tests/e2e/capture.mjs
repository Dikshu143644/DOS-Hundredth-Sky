// Deterministic gameplay capture: Playwright's fake clock drives the game (and the in-browser offline
// server) at exactly 30 fps of game time regardless of how slow the renderer is; every frame is saved
// as a JPEG, then ffmpeg encodes the mp4.  Usage: node capture.mjs <framesDir> [quality] [WxH]
import fs from 'node:fs';
import { launch } from './browser.mjs';
const out = process.argv[2] || '/tmp/frames';
const q = process.argv[3] || 'medium';
const [w, h] = (process.argv[4] || '1280x720').split('x').map(Number);
const base = process.env.BASE || 'http://localhost:8787';
fs.mkdirSync(out, { recursive: true });
const { browser, page, errors } = await launch({ viewport: { width: w, height: h } });
await page.goto(`${base}/?offline=1&capture=1&quality=${q}`);
let n = 0;
const FR = 1000 / 30;
const frame = async (cap = true) => { await page.evaluate((ms) => window.__dosStep(ms), FR); if (cap) { await page.screenshot({ path: `${out}/f${String(n).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 88 }); n++; if (n % 50 === 0) console.log('frames', n); } };
const frames = async (k) => { for (let i = 0; i < k; i++) await frame(); };
const until = async (fn, cap = false, max = 4000) => { for (let i = 0; i < max; i++) { if (await page.evaluate(fn)) return true; await frame(cap); await new Promise((r) => setTimeout(r, cap ? 0 : 50)); } return false; };
const g = (js) => page.evaluate(js);

await page.waitForFunction(() => window.__dosStep && window.__dos?.engine?.ready, null, { timeout: 300000 });          // world builds before the gate is shown on video
await frames(20);
await page.keyboard.press('Enter');
await until(() => window.__dos.mode === 'cine', true, 150); // logo
await frames(300);                                        // cinematic flight
await page.keyboard.press('Space');
await until(() => !!document.querySelector('#login .panel'));
await frames(45);
await page.click('#login .tabs button[data-m=register]');
await page.type('#login [name=username]', 'omkar', { delay: 0 }); await frames(8);
await page.type('#login [name=password]', 'hundredth', { delay: 0 }); await frames(12);
await page.click('#login button[type=submit]');
await until(() => !!document.querySelector('#create'), true, 60);
await frames(30);
await page.click('#create .classbtn[data-c=mage]'); await frames(40);
await page.fill('#create [data-name]', 'Kaelen'); await frames(15);
await page.click('#create [data-create]');
await until(() => window.__dos.mode === 'game', true, 200);
await g(() => { window.__dos.settings.timeOverride = 16.2; window.__dos.engine.weather = 'clear'; window.__dos.game.cam.yaw = 0.15; window.__dos.game.cam.pitch = 0.1; });
await frames(45);                                         // look at the gate + Tower
await g(() => { window.__dos.game.cam.yaw = Math.PI; });
await page.keyboard.down('KeyW'); await frames(150); await page.keyboard.up('KeyW');   // run into the forest
await frames(10);
await page.keyboard.press('Tab'); await frames(5);
await page.keyboard.press('Digit1'); await frames(80);   // IGNIS with chant
await page.keyboard.press('KeyF'); await frames(22); await page.keyboard.press('KeyF'); await frames(22);
await page.keyboard.press('Digit2'); await frames(75);   // FULGUR
await page.keyboard.press('KeyF'); await frames(22);
await g(() => { window.__dos.settings.timeOverride = 21.6; window.__dos.engine.weather = 'rain'; });
await frames(30);
await page.keyboard.press('Tab'); await frames(5);
await page.keyboard.press('Digit1'); await frames(85);   // IGNIS at night in the rain
await page.keyboard.press('Digit3'); await frames(70);   // LUX
await g(() => { window.__dos.game.cam.yaw = 0.1; window.__dos.game.cam.pitch = 0.25; });
await frames(60);
console.log('done frames', n, 'errors', JSON.stringify(errors.slice(0, 6)));
await browser.close();
