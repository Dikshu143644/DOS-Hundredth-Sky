/** The Adventurers' Guild quest board (Phase 4 · M3): one bounty per rank F → SSS, rank-gated.
 *  Glass window, phone-first. */
import type { BoardEntry } from '../../shared/protocol';
import { icon } from './icons';

export interface BoardUi { update(m: { region: string; rank: string; active: number; max: number; list: BoardEntry[] }): void; close(): void }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function openBoard(o: { take: (id: string) => void; close: () => void }): BoardUi {
  const wrap = document.createElement('div');
  wrap.className = 'modal qb-modal';
  wrap.id = 'questboard';
  wrap.innerHTML = `<div class="inv-box qb-box"><div class="inv-head"><div class="t">${icon('scroll', 20)}<span>Quest Board</span></div><div class="qb-me"></div><button class="x" data-close aria-label="Close">${icon('close', 16)}</button></div>
    <div class="qb-sub">Adventurers' Guild · bounties up to one rank above yours</div><div class="qb-list"><div class="qb-wait">Reading the board…</div></div></div>`;
  document.getElementById('ui')!.appendChild(wrap);
  const close = () => { wrap.remove(); window.removeEventListener('keydown', key, true); o.close(); };
  const key = (e: KeyboardEvent) => { if (e.code === 'Escape' || e.code === 'KeyB') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', key, true);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  (wrap.querySelector('[data-close]') as HTMLElement).onclick = close;
  return {
    close,
    update(m) {
      (wrap.querySelector('.qb-me') as HTMLElement).innerHTML = `<span class="rk r-${m.rank}">${m.rank}</span> your rank · ${m.active}/${m.max} bounties`;
      const list = wrap.querySelector('.qb-list') as HTMLElement;
      list.innerHTML = m.list.map((b) => `<div class="qb-card ${b.can ? '' : 'locked'} ${b.taken ? 'taken' : ''}" data-id="${esc(b.id)}">
        <div class="qb-rank r-${b.rank}">${b.rank}</div>
        <div class="qb-main"><b>${esc(b.title)}</b><small>${esc(b.hook)}</small><em>${esc(b.reward)}</em></div>
        <div class="qb-act">${b.taken ? `<span class="qb-tag">${icon('star', 14)} Taken</span>` : b.can ? `<button class="btn small primary" data-take="${esc(b.id)}">Take</button>` : `<span class="qb-tag lock">${esc(b.need ?? 'Locked')}</span>`}</div></div>`).join('');
      for (const b of Array.from(list.querySelectorAll<HTMLButtonElement>('[data-take]'))) b.onclick = () => { b.disabled = true; o.take(b.dataset.take!); };
    },
  };
}
