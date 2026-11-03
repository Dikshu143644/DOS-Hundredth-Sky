/** DOS: The Hundredth Sky — authoritative game server (Node).
 *  Serves the built client, hosts the WebSocket game protocol, persists accounts/characters/NPC memory,
 *  and is the only place an LLM key ever lives. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Game, SaveData, Hasher } from './core/game';
import type { LlmFn } from './core/llm';
import { loadLlmConfig, makeLlm, type LlmStatus } from './llmclient';
import type { C2S } from '../shared/protocol';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.DOS_DATA_DIR || path.join(here, '..', 'data');
const STATIC_DIR = process.env.DOS_STATIC_DIR || path.join(here, 'client');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'world.json');

const hasher: Hasher = {
  async hash(pw) {
    const salt = crypto.randomBytes(16);
    const key = await new Promise<Buffer>((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
    return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
  },
  async verify(pw, stored) {
    const [scheme, s, h] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const key = await new Promise<Buffer>((res, rej) => crypto.scrypt(pw, Buffer.from(s, 'hex'), 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
    const want = Buffer.from(h, 'hex');
    return want.length === key.length && crypto.timingSafeEqual(want, key);
  },
  token: () => crypto.randomBytes(24).toString('hex'),
};

const store = {
  load(): SaveData | null { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return null; } },
  save(d: SaveData) { const tmp = DATA_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, DATA_FILE); },
};

// Any OpenAI-compatible chat endpoint (live: Gemini). Env or a server-side secret file; without it
// NPCs and the Story Director use their scripted fallbacks.
const llmCfg = loadLlmConfig(path.join(here, 'llm.secret.json'));
const llmStatus: LlmStatus = { model: null, lastOkAt: 0, lastError: null, retries: 0, fallbacks: 0 };
const llm: LlmFn | null = llmCfg ? makeLlm(llmCfg, llmStatus) : null;
const LLM_MODEL = llmCfg ? llmCfg.models.join(' > ') : 'off';

const game = new Game({
  store, hasher, llm, now: () => performance.now() / 1000, mode: 'online', bots: Number(process.env.DOS_BOTS ?? 3),
  dev: process.env.DOS_DEV === '1', serverName: process.env.DOS_SERVER_NAME || 'Hundredth Sky · Shard 1', log: console.log,
});
setInterval(() => game.tick(), 50);
process.on('SIGTERM', () => { game.flush(); process.exit(0); });
process.on('SIGINT', () => { game.flush(); process.exit(0); });

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webp': 'image/webp', '.hdr': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); const s = game.stats(); res.end(JSON.stringify({ ok: true, ...s, llm: { ...s.llm, models: llmCfg?.models ?? [], lastModel: llmStatus.model, lastOkAgoS: llmStatus.lastOkAt ? Math.round((Date.now() - llmStatus.lastOkAt) / 1000) : null, lastError: llmStatus.lastError, retries: llmStatus.retries, fallbacks: llmStatus.fallbacks } })); return; }
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (p.includes('..')) { res.writeHead(400); res.end(); return; }
  let f = path.join(STATIC_DIR, p || 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(STATIC_DIR, 'index.html');
  const ext = path.extname(f);
  // phase 3: serve the build's pre-compressed twin (.br / .gz) when the browser takes it. Meshopt
  // geometry and animation buffers are built to be followed by a byte compressor (animations ~7x).
  const ae = String(req.headers['accept-encoding'] || '');
  let enc: 'br' | 'gzip' | null = null;
  if (/\bbr\b/.test(ae) && fs.existsSync(f + '.br')) enc = 'br'; else if (/\bgzip\b/.test(ae) && fs.existsSync(f + '.gz')) enc = 'gzip';
  const file = enc === 'br' ? f + '.br' : enc === 'gzip' ? f + '.gz' : f;
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    // content-hashed build output never changes: cache it for a year; other assets for a week
    const hashed = /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(f);
    const headers: Record<string, string> = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=604800, stale-while-revalidate=86400', 'x-content-type-options': 'nosniff', vary: 'Accept-Encoding' };
    if (enc) headers['content-encoding'] = enc;
    res.writeHead(200, headers);
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
let connSeq = 1;
wss.on('connection', (ws: WebSocket, req) => {
  const id = connSeq++;
  let msgs = 0, windowStart = Date.now();
  game.connect({ id, send: (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }, close: () => ws.close(), remote: req.socket.remoteAddress });
  ws.on('message', (data) => {
    const t = Date.now();
    if (t - windowStart > 1000) { windowStart = t; msgs = 0; }
    if (++msgs > 160) return; // flood protection (~2.5x the 60 Hz input rate)
    let m: C2S;
    try { m = JSON.parse(String(data)); } catch { return; }
    void game.handle(id, m);
  });
  ws.on('close', () => game.disconnect(id));
  ws.on('error', () => game.disconnect(id));
});

server.listen(PORT, () => console.log(`[dos] server on :${PORT} · llm=${llm ? LLM_MODEL : 'off (fallback dialogue)'} · data=${DATA_FILE}`));
