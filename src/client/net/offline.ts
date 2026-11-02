import { Game, SaveData, Hasher } from '../../server/core/game';
import type { Transport } from './transport';
import type { C2S, S2C } from '../../shared/protocol';

/** Offline single-player: the SAME authoritative server code runs in the browser tab, behind a
 *  simulated ~40 ms link, so prediction/reconciliation/interpolation are exercised exactly as online.
 *  Accounts persist in localStorage with PBKDF2-SHA256 (310k iterations) password hashes. */
const KEY = 'dos.offline.world.v1';
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
async function pbkdf2(pw: string, salt: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310000 }, k, 256));
}
const hasher: Hasher = {
  async hash(pw) { const salt = crypto.getRandomValues(new Uint8Array(16)); return `pbkdf2$${hex(salt.buffer)}$${await pbkdf2(pw, salt)}`; },
  async verify(pw, stored) { const [s, salt, h] = stored.split('$'); return s === 'pbkdf2' && (await pbkdf2(pw, unhex(salt))) === h; },
  token: () => hex(crypto.getRandomValues(new Uint8Array(24)).buffer),
};

let game: Game | null = null;
export function startOffline(): Transport {
  if (!game) {
    game = new Game({
      store: { load: () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') as SaveData | null; } catch { return null; } }, save: (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* quota */ } } },
      hasher, llm: null, now: () => performance.now() / 1000, mode: 'offline', bots: 4, dev: true, serverName: 'Offline · Local World',
    });
    setInterval(() => game!.tick(), 50);
  }
  const LAT = 20; // one-way ms
  const id = Math.floor(Math.random() * 1e9);
  const t: Transport = {
    mode: 'offline',
    send: (m: C2S) => setTimeout(() => void game!.handle(id, m), LAT),
    onMessage: (m) => { t.pending!.push(m); }, onClose: () => {},
    close: () => game!.disconnect(id),
    pending: [],
  };
  game.connect({ id, send: (m: S2C) => setTimeout(() => t.onMessage(m), LAT), close: () => t.onClose('closed') });
  return t;
}
