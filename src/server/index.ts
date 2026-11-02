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

// Any OpenAI-compatible chat endpoint. Configure with env; without it NPCs/Director use their fallbacks.
const LLM_URL = process.env.DOS_LLM_BASE_URL;
const LLM_KEY = process.env.DOS_LLM_KEY;
const LLM_MODEL = process.env.DOS_LLM_MODEL || 'gpt-4o-mini';
const llm: LlmFn | null = LLM_URL && LLM_KEY ? async (messages, opts) => {
  const r = await fetch(LLM_URL.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: opts?.maxTokens ?? 400, temperature: opts?.temperature ?? 0.8 }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) return null;
  const j: any = await r.json();
  return j?.choices?.[0]?.message?.content ?? null;
} : null;

const game = new Game({
  store, hasher, llm, now: () => performance.now() / 1000, mode: 'online', bots: Number(process.env.DOS_BOTS ?? 3),
  dev: process.env.DOS_DEV === '1', serverName: process.env.DOS_SERVER_NAME || 'Hundredth Sky · Shard 1', log: console.log,
});
setInterval(() => game.tick(), 50);
process.on('SIGTERM', () => { game.flush(); process.exit(0); });
process.on('SIGINT', () => { game.flush(); process.exit(0); });

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, ...game.stats() })); return; }
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (p.includes('..')) { res.writeHead(400); res.end(); return; }
  let f = path.join(STATIC_DIR, p || 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(STATIC_DIR, 'index.html');
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(f);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=604800', 'x-content-type-options': 'nosniff' });
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
