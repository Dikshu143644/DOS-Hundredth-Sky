// In-game still for comparisons: node tests/e2e/ingameshot.mjs <base> out.png [cls] [poi] [yaw] [hour]   (server needs DOS_DEV=1)
import { launch } from './browser.mjs';
const [, , base, out, cls = 'archer', poi = 'camp', yaw = '3.14', hour = '17.4'] = process.argv;
const W = +(process.env.W || 1600), H = +(process.env.H || 900);
const { browser, page, errors } = await launch({ viewport: { width: W, height: H } });
await page.goto(`${base}/?autotest=1&prologue=skip&quality=${process.env.Q || 'high'}`, { waitUntil: 'load' });
await page.waitForSelector('#menu [data-act=newgame]', { timeout: 60000 });
await page.click('#menu .tm-item[data-act=newgame]');
await page.waitForSelector('#login button[type=submit]', { timeout: 30000 });
await page.click('#login .tabs button[data-m=register]');
await page.fill('#login [name=username]', 'shot' + Date.now().toString(36) + '@test.dev');
await page.fill('#login [name=password]', 'correct horse battery');
await page.click('#login button[type=submit]');
await page.waitForSelector('#create', { timeout: 300000 });
await page.click(`#create .classbtn[data-c=${cls}]`);
await page.fill('#create [data-name]', process.env.NAME || 'Aren');
await page.click('#create [data-create]');
await page.waitForFunction(() => window.__dos?.mode === 'game' && window.__dos.game, null, { timeout: 300000 });
await page.evaluate(([poi, hour]) => { const n = window.__dos.net; n.send({ type: 'chat', text: '/weather clear' }); n.send({ type: 'chat', text: '/time ' + hour }); if (poi !== 'none') n.send({ type: 'chat', text: '/tp ' + poi }); }, [poi, hour]);
await page.evaluate((h) => { window.__hourPin = +h; window.__dos.settings.timeOverride = +h; }, hour); // photo-mode time pin (Settings → Graphics → time of day)
await page.waitForTimeout(4000);
await page.evaluate(([yaw, pitch, dist]) => { const c = window.__dos.game.cam; c.yaw = +yaw; c.pitch = +pitch; if (dist) { c.targetDist = +dist; c.dist = +dist; } document.querySelectorAll('.chat .log').forEach((e) => (e.innerHTML = '')); if (window.__hourPin) window.__dos.settings.timeOverride = window.__hourPin; }, [yaw, process.env.PITCH || '0.12', process.env.DIST || '']);
if (process.env.WALK) { await page.keyboard.down('w'); await page.waitForTimeout(+process.env.WALK); await page.keyboard.up('w'); await page.evaluate(([yaw]) => { window.__dos.game.cam.yaw = +yaw; }, [yaw]); }
await page.waitForTimeout(+(process.env.WAIT || 9000));
await page.screenshot({ path: out });
console.log('shot', out, JSON.stringify(errors.filter((e) => !/WebSocket|404/.test(e)).slice(0, 4)));
await browser.close();
