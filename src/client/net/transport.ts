import type { C2S, S2C } from '../../shared/protocol';

export interface Transport {
  mode: 'online' | 'offline';
  send(m: C2S): void;
  onMessage: (m: S2C) => void;
  onClose: (reason: string) => void;
  close(): void;
  pending?: S2C[];
}

export function serverUrl(): string | null {
  const q = new URLSearchParams(location.search);
  if (q.get('offline') === '1') return null;
  const s = q.get('server');
  if (s) return s;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** WebSocket transport with an optional artificial latency (?lag=120) to test netcode. */
export function connectWS(url: string, timeoutMs = 3500): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const lag = Number(new URLSearchParams(location.search).get('lag') || 0);
    const t: Transport = {
      mode: 'online',
      send: (m) => { const s = JSON.stringify(m); if (lag) setTimeout(() => ws.readyState === 1 && ws.send(s), lag / 2); else if (ws.readyState === 1) ws.send(s); },
      onMessage: (m) => { t.pending!.push(m); }, onClose: () => {},
      close: () => ws.close(),
      pending: [],
    };
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, timeoutMs);
    ws.onopen = () => { clearTimeout(timer); resolve(t); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('unreachable')); };
    ws.onclose = () => t.onClose('Connection to the server was lost.');
    ws.onmessage = (e) => { let m: S2C; try { m = JSON.parse(e.data); } catch { return; } if (lag) setTimeout(() => t.onMessage(m), lag / 2); else t.onMessage(m); };
  });
}
