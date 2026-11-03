import { CLASSES, ClassId, classById } from '../../shared/combat';
import type { Appearance, CharacterSummary } from '../../shared/protocol';
import { audio } from '../audio';

export const ui = () => document.getElementById('ui')!;
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function show(html: string, id: string): HTMLElement {
  document.getElementById(id)?.remove();
  const d = document.createElement('div');
  d.id = id; d.className = 'screen fade-in';
  d.innerHTML = html;
  ui().appendChild(d);
  d.querySelectorAll('button, .charcard, .classbtn, .sw').forEach((b) => { b.addEventListener('mouseenter', () => audio.uiHover()); b.addEventListener('click', () => audio.uiClick()); });
  return d;
}
export function hide(id: string, fade = true) {
  const d = document.getElementById(id);
  if (!d) return;
  if (!fade) { d.remove(); return; }
  d.classList.remove('fade-in'); d.classList.add('fade-out');
  setTimeout(() => d.remove(), 700);
}
export const LOGO_SVG = `
<svg viewBox="0 0 300 230" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6d6"/><stop offset=".55" stop-color="#e2bf74"/><stop offset="1" stop-color="#9b7330"/></linearGradient>
    <filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <g class="halo" opacity=".85"><circle cx="150" cy="112" r="92" fill="none" stroke="#5fe8ff" stroke-width="1" stroke-dasharray="2 9" /><circle cx="150" cy="112" r="104" fill="none" stroke="#d9b56b" stroke-width=".6" stroke-dasharray="40 12 4 12"/></g>
  <g filter="url(#gl)" fill="none" stroke="url(#lg)" stroke-width="3" stroke-linejoin="round">
    <path class="draw" d="M150 18 L166 88 L150 210 L134 88 Z"/>
    <path class="draw" d="M150 88 m-56 0 a56 56 0 1 0 112 0 a56 56 0 1 0 -112 0" stroke="#5fe8ff" stroke-width="2"/>
    <path class="draw" d="M70 150 L106 150 M194 150 L230 150" />
  </g>
  <g class="fill" font-family="Cinzel, serif" font-weight="900" text-anchor="middle">
    <text x="150" y="160" font-size="58" fill="url(#lg)" letter-spacing="10" filter="url(#gl)">DOS</text>
  </g>
</svg>`;

export const LORE_TIPS = [
  'The Hundredth Tower has 100 floors. No one alive has passed the forty-first.',
  'Speak an incantation in full. Magic, the Archivist says, remembers rudeness.',
  'Light spoken at the Whispering Shrine after dusk is never wasted.',
  'Hidden scenarios open for one climber only. The world notices what you do — and what no one else has done.',
  'Grave Knights flinch from fire; Bone Magi from lightning; the hollow dead from light.',
  'Quests range from F to SSS. A few are simply marked ???.',
  'Death is not the end here. It is merely expensive.',
  'Captain Aldric has kept the Gate of Dawn for nine years. Ask him why.',
  'Rain hides footsteps — yours and theirs.',
];

export function loginScreen(o: { mode: string; server: string; llm: boolean; ping?: () => number | null; vr?: boolean; onSubmit: (mode: 'login' | 'register', u: string, p: string) => void; onOffline?: () => void }) {
  const icoMail = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5h18v11H3z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 7l8.5 6.5L20.5 7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  const icoLock = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  const d = show(`
    <div class="sk-brand"><div class="sk-dos">DOS</div><div class="sk-sub">THE HUNDREDTH SKY</div><div class="sk-line"></div></div>
    <div class="sk-glass panel">
      <div class="sk-enter">ENTER THE WORLD</div>
      <form autocomplete="on" novalidate>
        <label class="sk-field"><span class="sk-ico">${icoMail}</span><input name="username" type="text" inputmode="email" autocomplete="username" maxlength="64" spellcheck="false" placeholder="Email" aria-label="Email" /></label>
        <label class="sk-field"><span class="sk-ico">${icoLock}</span><input name="password" type="password" autocomplete="current-password" maxlength="128" placeholder="Password" aria-label="Password" /></label>
        <div class="err" role="alert"></div>
        <button class="sk-btn" type="submit"><span>LOG IN</span></button>
      </form>
      <div class="sk-links tabs"><button type="button" data-m="register">Create account</button><button type="button" data-forgot>Forgot password?</button></div>
      <div class="sk-vr">${o.vr ? 'VR HEADSET DETECTED · PRESS ENTER VR TO CONTINUE IN VR' : 'BEST WITH HEADPHONES · PC, PHONE &amp; VR'}</div>
      ${o.onOffline ? '<div class="sk-off"><button type="button" data-off>Play offline instead</button></div>' : ''}
    </div>
    <div class="sk-foot-l">v0.2.0 · pre-alpha · ${o.llm ? 'AI NPCs live' : 'AI NPCs: fallback'}</div>
    <div class="sk-foot-r"><span class="dot" style="color:${o.mode === 'online' ? '#43e08a' : '#ffb547'}"></span>World: ${esc(o.server)} · <span data-ping>— ms</span></div>`, 'login');
  d.classList.add('sk-login');
  let mode: 'login' | 'register' = 'login';
  const form = d.querySelector('form')!, err = d.querySelector('.err')!, btn = form.querySelector('button')! as HTMLButtonElement;
  const toggle = d.querySelector('[data-m]') as HTMLButtonElement;
  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    toggle.dataset.m = mode === 'login' ? 'register' : 'login';
    toggle.textContent = mode === 'login' ? 'Create account' : 'I already have an account';
    btn.firstElementChild!.textContent = mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT';
    (d.querySelector('.sk-enter') as HTMLElement).textContent = mode === 'login' ? 'ENTER THE WORLD' : 'BEGIN YOUR CLIMB';
    (form.querySelector('[name=password]') as HTMLInputElement).autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    err.textContent = '';
  });
  d.querySelector('[data-forgot]')!.addEventListener('click', () => { err.textContent = 'Password reset by email arrives with account email verification (next phase).'; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = (form.querySelector('[name=username]') as HTMLInputElement).value.trim().toLowerCase(), p = (form.querySelector('[name=password]') as HTMLInputElement).value;
    err.textContent = ''; btn.setAttribute('disabled', '');
    o.onSubmit(mode, u, p);
  });
  d.querySelector('[data-off]')?.addEventListener('click', () => o.onOffline?.());
  const pingEl = d.querySelector('[data-ping]') as HTMLElement;
  const iv = setInterval(() => { if (!d.isConnected) return clearInterval(iv); const p = o.ping?.(); pingEl.textContent = p == null ? (o.mode === 'online' ? '— ms' : 'offline') : `${Math.round(p)} ms`; }, 1000);
  return { el: d, error(msg: string) { err.textContent = msg; btn.removeAttribute('disabled'); } };
}

export function charSelectScreen(list: CharacterSummary[], o: { onPick: (c: CharacterSummary) => void; onPlay: (c: CharacterSummary) => void; onCreate: () => void; onDelete: (c: CharacterSummary) => void; onBack: () => void }) {
  const d = show(`
    <div class="side panel"><span class="crn tr"></span><span class="crn bl"></span><h2>Characters</h2><div class="rule"></div><div class="list"></div>
      <button class="btn cyan" data-new ${list.length >= 4 ? 'disabled' : ''}>+ Create character</button>
      <button class="btn ghost" data-back style="margin-top:10px">Log out</button></div>
    <div></div>
    <div class="namebar"><div class="cl"></div><div class="nm"></div><button class="btn" data-play style="min-width:240px">Enter world</button><button class="btn ghost" data-del style="font-size:11px;min-height:30px;padding:4px 14px">Delete</button></div>`, 'chars');
  const listEl = d.querySelector('.list')!;
  let cur: CharacterSummary | null = null;
  const pick = (c: CharacterSummary) => {
    cur = c;
    listEl.querySelectorAll('.charcard').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.id === c.id));
    (d.querySelector('.namebar .nm') as HTMLElement).textContent = c.name;
    (d.querySelector('.namebar .cl') as HTMLElement).textContent = `Level ${c.level} · ${classById(c.cls).name} · ${c.zone}`;
    o.onPick(c);
  };
  for (const c of list) {
    const cc = document.createElement('div'); cc.className = 'charcard'; cc.dataset.id = c.id;
    cc.innerHTML = `<div class="crest"><span>${esc(c.name[0])}</span></div><div><div class="nm">${esc(c.name)}</div><div class="sub">Lv ${c.level} · ${classById(c.cls).name}</div></div>`;
    cc.onclick = () => pick(c);
    cc.ondblclick = () => o.onPlay(c);
    listEl.appendChild(cc);
  }
  if (!list.length) listEl.innerHTML = '<div class="desc" style="text-align:center">No one has climbed under this name yet.</div>';
  d.querySelector('.namebar')!.classList.toggle('hidden', !list.length);
  if (list.length) pick(list[0]);
  d.querySelector('[data-new]')!.addEventListener('click', o.onCreate);
  d.querySelector('[data-back]')!.addEventListener('click', o.onBack);
  d.querySelector('[data-play]')!.addEventListener('click', () => cur && o.onPlay(cur));
  d.querySelector('[data-del]')!.addEventListener('click', () => { if (cur && confirm(`Delete ${cur.name}? This cannot be undone.`)) o.onDelete(cur); });
  return d;
}

const TINTS = [0xffffff, 0xffe2c8, 0xf3d0b0, 0xd8f0ff, 0xf0d8ff, 0xd6ffd8, 0xfff0a8, 0xc8c8d8];
const ACCENTS = [0x3fd0ff, 0xff7a3f, 0x9b6bff, 0x43e08a, 0xff4f7a, 0xffd23f, 0xe8e8f0, 0x2a2a3a];
export function createScreen(o: { onChange: (cls: ClassId, ap: Appearance) => void; onCreate: (name: string, cls: ClassId, ap: Appearance) => void; onBack: () => void }) {
  let cls: ClassId = 'mage';
  const ap: Appearance = { tint: 0xffffff, accent: 0x3fd0ff, headgear: true, cape: true, scale: 1, body: 'm' };
  const d = show(`
    <div class="side panel"><span class="crn tr"></span><span class="crn bl"></span><h2>Choose your path</h2><div class="rule"></div>
      <div class="classgrid">${CLASSES.map((c) => `<button class="classbtn ${c.id === cls ? 'on' : ''}" data-c="${c.id}"><b>${c.name}</b><small>${c.role}</small></button>`).join('')}</div>
      <div class="desc"></div><div class="stats"></div></div>
    <div class="side panel"><span class="crn tr"></span><span class="crn bl"></span><h2>Appearance</h2><div class="rule"></div>
      <div class="field"><label>Outfit tone</label><div class="swatches" data-k="tint">${TINTS.map((t) => `<div class="sw ${t === ap.tint ? 'on' : ''}" data-v="${t}" style="background:#${t.toString(16).padStart(6, '0')}"></div>`).join('')}</div></div>
      <div class="field"><label>Cape & accent</label><div class="swatches" data-k="accent">${ACCENTS.map((t) => `<div class="sw ${t === ap.accent ? 'on' : ''}" data-v="${t}" style="background:#${t.toString(16).padStart(6, '0')}"></div>`).join('')}</div></div>
      <div class="field"><label>Body</label><div class="seg" data-body><button type="button" data-b="m" class="on">Masculine</button><button type="button" data-b="f">Feminine</button></div></div>
      <div class="toggle"><span>Helmet / hat</span><input type="checkbox" data-t="headgear" checked></div>
      <div class="toggle"><span>Cape</span><input type="checkbox" data-t="cape" checked></div>
      <div class="field" style="margin-top:12px"><label>Height</label><input type="range" min="0.92" max="1.08" step="0.01" value="1" data-scale style="height:auto;padding:0;accent-color:var(--gold)"></div>
      <div class="field" style="margin-top:6px"><label>Name</label><input data-name maxlength="16" placeholder="3–16 letters" spellcheck="false"></div>
      <div class="err"></div>
      <button class="btn" data-create>Create</button><button class="btn ghost" data-back style="margin-top:10px">Back</button></div>`, 'create');
  const upd = () => {
    const c = classById(cls);
    (d.querySelector('.desc') as HTMLElement).textContent = c.desc;
    const max = { hp: 180, mp: 170, atk: 18, mag: 20, def: 13 };
    (d.querySelector('.stats') as HTMLElement).innerHTML = (['hp', 'mp', 'atk', 'mag', 'def'] as const).map((k) => `<span>${k.toUpperCase()}</span><div class="bar"><i style="width:${(c[k] / max[k]) * 100}%"></i></div>`).join('');
    o.onChange(cls, { ...ap });
  };
  d.querySelectorAll('.classbtn').forEach((b) => b.addEventListener('click', () => { cls = (b as HTMLElement).dataset.c as ClassId; d.querySelectorAll('.classbtn').forEach((x) => x.classList.toggle('on', x === b)); upd(); }));
  d.querySelectorAll('.swatches').forEach((s) => s.addEventListener('click', (e) => {
    const t = e.target as HTMLElement; if (!t.dataset.v) return;
    (ap as any)[(s as HTMLElement).dataset.k!] = Number(t.dataset.v);
    s.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === t)); upd();
  }));
  d.querySelectorAll('[data-t]').forEach((c) => c.addEventListener('change', () => { (ap as any)[(c as HTMLElement).dataset.t!] = (c as HTMLInputElement).checked; upd(); }));
  d.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => b.addEventListener('click', () => { ap.body = b.dataset.b as 'm' | 'f'; d.querySelectorAll('[data-b]').forEach((x) => x.classList.toggle('on', x === b)); upd(); }));
  d.querySelector('[data-scale]')!.addEventListener('input', (e) => { ap.scale = Number((e.target as HTMLInputElement).value); upd(); });
  const err = d.querySelector('.err')!;
  d.querySelector('[data-create]')!.addEventListener('click', () => {
    const name = (d.querySelector('[data-name]') as HTMLInputElement).value.trim();
    if (name.length < 3) { err.textContent = 'Name must be 3–16 characters.'; return; }
    o.onCreate(name, cls, { ...ap });
  });
  d.querySelector('[data-back]')!.addEventListener('click', o.onBack);
  upd();
  return { el: d, error(m: string) { err.textContent = m; } };
}

export function loadingScreen() {
  const d = show(`<div class="tower"></div><div class="zone">The Gate of Dawn</div><div class="zsub">Edge of the Capital · Ancient Forest</div><div class="tip"></div><div class="prog"><i></i></div><div class="pl">Loading</div>`, 'loading');
  const tip = d.querySelector('.tip') as HTMLElement;
  let i = Math.floor(Math.random() * LORE_TIPS.length);
  tip.textContent = LORE_TIPS[i];
  const iv = setInterval(() => { tip.style.opacity = '0'; setTimeout(() => { i = (i + 1) % LORE_TIPS.length; tip.textContent = LORE_TIPS[i]; tip.style.opacity = '1'; }, 600); }, 4200);
  return {
    set(p: number, label: string) { (d.querySelector('.prog i') as HTMLElement).style.width = Math.round(p * 100) + '%'; (d.querySelector('.pl') as HTMLElement).textContent = label; },
    done() { clearInterval(iv); hide('loading'); },
  };
}
