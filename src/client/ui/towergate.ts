/** Phase 4 · M5: the Gate of the Tower: pick a floor (every floor up to one past your best). */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function towerGate(o: { best: number; floors: number; themes: string[]; enter: (n: number) => void; ranks: () => void; onClose: () => void }) {
  const d = document.createElement('div');
  d.className = 'modal inv-modal'; d.id = 'towergate';
  document.getElementById('ui')!.appendChild(d);
  const close = () => { d.remove(); window.removeEventListener('keydown', key, true); o.onClose(); };
  const key = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', key, true);
  const max = Math.min(o.floors, o.best + 1);
  let band = Math.min(9, Math.floor((max - 1) / 10));
  const render = () => {
    const floors = Array.from({ length: 10 }, (_, k) => band * 10 + k + 1);
    d.innerHTML = `<div class="inv-box tg-box"><div class="inv-head"><div class="t"><span>The Hundredth Tower</span></div><button class="x" data-close aria-label="Close">✕</button></div>
      <p class="tg-sub">Your best: <b>${o.best ? 'Floor ' + o.best : 'none yet'}</b> · You can enter floors 1–${max}. A boss guards every tenth floor; each floor's stairway is sealed until you solve its puzzle or beat its guardian.</p>
      <div class="mk-tabs"><div class="seg tg-bands">${o.themes.map((t, k) => `<button class="${k === band ? 'on' : ''}" data-band="${k}" title="${esc(t)}" ${k * 10 + 1 > max ? 'disabled' : ''}>${k * 10 + 1}–${k * 10 + 10}</button>`).join('')}</div></div>
      <div class="tg-theme">${esc(o.themes[band])}</div>
      <div class="tg-grid">${floors.map((n) => `<button class="tg-floor ${n % 10 === 0 ? 'boss' : ''} ${n <= o.best ? 'done' : ''} ${n === max ? 'next' : ''}" data-floor="${n}" ${n > max ? 'disabled' : ''}><b>${n}</b><small>${n % 10 === 0 ? 'Guardian' : n <= o.best ? 'Cleared' : n === max ? 'Next' : 'Sealed'}</small></button>`).join('')}</div>
      <div class="tg-foot"><button class="btn ghost" data-ranks>Tower rankings</button><button class="btn primary" data-floor="${max}">Climb to Floor ${max}</button></div></div>`;
    d.querySelector('[data-close]')!.addEventListener('click', close);
    d.querySelectorAll<HTMLButtonElement>('[data-band]').forEach((b) => b.addEventListener('click', () => { band = Number(b.dataset.band); render(); }));
    d.querySelectorAll<HTMLButtonElement>('[data-floor]').forEach((b) => b.addEventListener('click', () => { o.enter(Number(b.dataset.floor)); close(); }));
    d.querySelector('[data-ranks]')!.addEventListener('click', () => { close(); o.ranks(); });
  };
  render();
  return { close };
}
