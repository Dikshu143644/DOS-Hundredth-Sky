/** ?capture=1 — deterministic video capture. Replaces the page's clock (performance.now, Date.now,
 *  setTimeout/setInterval) with a virtual one that only advances when the capture script calls
 *  window.__dosStep(ms), so the game, the in-browser server and every UI timer run at exact
 *  video time no matter how slowly a software renderer draws each frame. Imported first by main.ts. */
export const CAPTURE = new URLSearchParams(location.search).get('capture') === '1';
export let stepHook: (() => void) | null = null;
export function setStepHook(f: () => void) { stepHook = f; }
if (CAPTURE) {
  let now = performance.now();
  const dateBase = Date.now() - now;
  interface T { id: number; at: number; fn: (...a: any[]) => void; every: number }
  let timers: T[] = [];
  let nextId = 1;
  const add = (fn: any, ms: number, every: number) => { const id = nextId++; timers.push({ id, at: now + Math.max(0, +ms || 0), fn: typeof fn === 'function' ? fn : () => {}, every }); return id; };
  const clear = (id: number) => { timers = timers.filter((t) => t.id !== id); };
  (performance as any).now = () => now;
  Date.now = () => Math.floor(dateBase + now);
  (window as any).setTimeout = (fn: any, ms?: number, ...a: any[]) => add(() => fn(...a), ms ?? 0, 0);
  (window as any).setInterval = (fn: any, ms?: number, ...a: any[]) => add(() => fn(...a), ms ?? 0, Math.max(1, ms ?? 1));
  (window as any).clearTimeout = clear;
  (window as any).clearInterval = clear;
  (window as any).__dosStep = (ms: number) => {
    const end = now + ms;
    for (let guard = 0; guard < 10000; guard++) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every; else timers.shift();
      try { t.fn(); } catch (e) { console.error(e); }
    }
    now = end;
    stepHook?.();
  };
}
