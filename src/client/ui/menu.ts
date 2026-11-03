import { icon } from './icons';
import { audio } from '../audio';

/** Title / main menu in Omkar's reference style: ivory-gold serif "DOS" with a four-point star in
 *  the O, "THE HUNDREDTH SKY", a tagline, Continue / New Game / Settings / Quit bottom-right,
 *  heart + lightning bars bottom-left, the gear top-right and "EXPLORE • FIGHT • DISCOVER". */
export type MenuAction = 'continue' | 'newgame' | 'settings' | 'quit';
export interface MenuOpts { onAction: (a: MenuAction) => void; signedIn: boolean; hero?: { name: string; hp: number; hpMax: number; mp: number; mpMax: number } | null }

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0 L14.2 9.8 L24 12 L14.2 14.2 L12 24 L9.8 14.2 L0 12 L9.8 9.8 Z" fill="currentColor"/></svg>';
const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm8.2 4.7-1.9-.3a6.6 6.6 0 0 1-.7 1.6l1.1 1.6-1.5 1.5-1.6-1.1c-.5.3-1 .5-1.6.7l-.3 1.9h-2.2l-.3-1.9a6.6 6.6 0 0 1-1.6-.7l-1.6 1.1-1.5-1.5 1.1-1.6a6.6 6.6 0 0 1-.7-1.6l-1.9-.3v-2.2l1.9-.3c.2-.6.4-1.1.7-1.6L6.3 6.4l1.5-1.5 1.6 1.1c.5-.3 1-.5 1.6-.7l.3-1.9h2.2l.3 1.9c.6.2 1.1.4 1.6.7l1.6-1.1 1.5 1.5-1.1 1.6c.3.5.5 1 .7 1.6l1.9.3Z"/></svg>';
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21Z"/></svg>';
const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 1 4 13.6h6.3L9 23l10-13.2h-6.4L13.5 1Z"/></svg>';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const DIAMOND = (filled: boolean) => `<svg class="dia" viewBox="0 0 24 24" aria-hidden="true">${filled ? '<path d="M12 1 23 12 12 23 1 12Z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M12 5.5 13.4 10.6 18.5 12 13.4 13.4 12 18.5 10.6 13.4 5.5 12 10.6 10.6Z" fill="currentColor"/>' : '<path d="M12 3 21 12 12 21 3 12Z" fill="none" stroke="currentColor" stroke-width="1.3"/>'}</svg>`;

export function titleMenu(o: MenuOpts) {
  document.getElementById('menu')?.remove();
  const d = document.createElement('div');
  d.id = 'menu'; d.className = 'tm fade-in';
  const h = o.hero;
  const hp = h ? `${h.hp} / ${h.hpMax}` : '100 / 100', mp = h ? `${h.mp} / ${h.mpMax}` : '50 / 50';
  d.innerHTML = `
    <div class="tm-brand">
      <div class="tm-dos" aria-label="DOS">D<span class="tm-o">O<i>${STAR}</i></span>S</div>
      <div class="tm-sub">THE HUNDREDTH SKY</div>
      <div class="tm-rule"><span></span><i>${STAR}</i><span></span></div>
      <div class="tm-tag">A journey beyond the skies...</div>
    </div>
    <button class="tm-gear" data-act="settings" aria-label="Settings">${GEAR}</button>
    <nav class="tm-nav" aria-label="Main menu">
      <button class="tm-item on" data-act="continue"><i class="dia">${icon('play', 18)}</i><span>Continue</span></button>
      <button class="tm-item" data-act="newgame"><i class="dia">${icon('plus', 18)}</i><span>New Game</span></button>
      <button class="tm-item" data-act="settings"><i class="dia">${icon('settings', 18)}</i><span>Settings</span></button>
      <button class="tm-item" data-act="quit"><i class="dia">${icon('logout', 18)}</i><span>Quit</span></button>
    </nav>
    <div class="tm-bars">
      ${h ? `<div class="tm-who">${h.name.replace(/[<>&"]/g, '')}</div>` : ''}
      <div class="tm-bar hp"><b>${HEART}</b><div class="tm-track"><i style="width:${h ? Math.round((h.hp / h.hpMax) * 100) : 100}%"></i></div><span>${hp}</span></div>
      <div class="tm-bar mp"><b>${BOLT}</b><div class="tm-track"><i style="width:${h ? Math.round((h.mp / h.mpMax) * 100) : 100}%"></i></div><span>${mp}</span></div>
    </div>
    <div class="tm-foot"><span></span>EXPLORE <i>•</i> FIGHT <i>•</i> DISCOVER<span></span></div>
    <div class="tm-stream" aria-live="polite"><div class="tm-stream-bar"><i></i></div><span>Preparing the world</span></div>
    <div class="tm-toast" role="status"></div>`;
  document.getElementById('ui')!.appendChild(d);
  const items = [...d.querySelectorAll<HTMLButtonElement>('.tm-item')];
  const focus = (b: HTMLButtonElement) => { items.forEach((x) => x.classList.toggle('on', x === b)); };
  for (const b of d.querySelectorAll<HTMLButtonElement>('[data-act]')) {
    b.addEventListener('mouseenter', () => { if (b.classList.contains('tm-item')) focus(b); audio.uiHover(); });
    b.addEventListener('focus', () => { if (b.classList.contains('tm-item')) focus(b); });
    b.addEventListener('click', () => { audio.uiClick(); o.onAction(b.dataset.act as MenuAction); });
  }
  // keyboard / gamepad-style navigation: arrows move, Enter activates
  const onKey = (e: KeyboardEvent) => {
    if (!d.isConnected || d.classList.contains('busy') || document.querySelector('.modal, #login, #create, #chars')) return;
    const i = items.findIndex((x) => x.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 's') { focus(items[(i + 1) % items.length]); items[(i + 1) % items.length].focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' || e.key === 'w') { focus(items[(i + items.length - 1) % items.length]); items[(i + items.length - 1) % items.length].focus(); e.preventDefault(); }
    else if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') { items[Math.max(0, i)].click(); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);
  const streamEl = d.querySelector('.tm-stream') as HTMLElement, streamBar = d.querySelector('.tm-stream-bar i') as HTMLElement, streamTxt = d.querySelector('.tm-stream span') as HTMLElement;
  let toastT = 0;
  return {
    el: d,
    /** world streaming progress under the menu (0..1); hides itself at 1 */
    stream(p: number, label?: string) {
      streamEl.classList.toggle('show', p < 1);
      streamBar.style.width = `${Math.round(Math.min(1, p) * 100)}%`;
      streamTxt.textContent = p >= 1 ? 'World ready' : `${label ?? 'Preparing the world'} · ${Math.round(p * 100)}%`;
    },
    toast(msg: string) { const t = d.querySelector('.tm-toast') as HTMLElement; t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = window.setTimeout(() => t.classList.remove('show'), 2600); },
    busy(on: boolean) { d.classList.toggle('busy', on); },
    hide() { d.classList.add('tm-hidden'); },
    show() { d.classList.remove('tm-hidden'); },
    remove() { window.removeEventListener('keydown', onKey); d.remove(); },
  };
}
export type TitleMenu = ReturnType<typeof titleMenu>;

/** A small confirm dialog in the same ivory-gold glass style. */
export function confirmBox(title: string, body: string, yes: string, no = 'Cancel'): Promise<boolean> {
  return new Promise((res) => {
    const m = document.createElement('div');
    m.className = 'modal tm-confirm';
    m.innerHTML = `<div class="tm-glass"><h3>${title}</h3><p>${body}</p><div class="tm-row"><button class="tm-btn gold" data-y>${yes}</button><button class="tm-btn" data-n>${no}</button></div></div>`;
    document.getElementById('ui')!.appendChild(m);
    const done = (v: boolean) => { m.remove(); res(v); };
    m.querySelector('[data-y]')!.addEventListener('click', () => done(true));
    m.querySelector('[data-n]')!.addEventListener('click', () => done(false));
    m.addEventListener('click', (e) => { if (e.target === m) done(false); });
  });
}
