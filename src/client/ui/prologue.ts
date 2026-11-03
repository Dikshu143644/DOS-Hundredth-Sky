import type { C2S, S2C, StatusView } from '../../shared/protocol';
import { CHEATS, AFFINITIES, type Affinity } from '../../shared/origin';
import { CLASSES } from '../../shared/combat';
import { statusWindow } from './status';
import type { Prologue } from '../scenes/prologue';
import { audio } from '../audio';
import { icon, CHEAT_ICON } from './icons';

type ProMsg = Extract<S2C, { type: 'prologue' }>;
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const PAST_LIVES = ['An office worker who never went home on time', 'A student buried in exams', 'A gamer who never left his room', 'A nurse on the night shift', 'I don’t remember'];

/** The Goddess dialogue: past life → cheat skill (3 offered) → class → affinity (incl. Forbidden) →
 *  status window → AWAKEN. Every answer goes to the server, which keeps it (she remembers) and
 *  answers through the AI with a scripted fallback. Resolves when the soul has woken. */
export function runGoddess(o: { send: (m: C2S) => void; wait: <T extends S2C['type']>(t: T) => Promise<Extract<S2C, { type: T }>>; scene: Prologue; cls: string; name: string; autoSkip?: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const d = document.createElement('div'); d.id = 'prologue'; d.className = 'pro-ui';
    d.innerHTML = `<button class="pro-skip" type="button">Skip prologue ›</button>
      <div class="pro-choices"></div>
      <div class="pro-box"><div class="pro-who">AURELIA <small>Keeper of the Hundred Skies</small><span class="pro-src"></span></div>
        <div class="pro-text"></div>
        <form class="pro-talk"><input maxlength="150" placeholder="Speak to her…" aria-label="Speak to the goddess"><button class="btn small" type="submit">Say</button></form></div>`;
    document.getElementById('ui')!.appendChild(d);
    const text = d.querySelector('.pro-text') as HTMLElement, src = d.querySelector('.pro-src') as HTMLElement, choices = d.querySelector('.pro-choices') as HTMLElement;
    const talk = d.querySelector('.pro-talk') as HTMLFormElement, talkIn = talk.querySelector('input') as HTMLInputElement;
    let typing = 0, done = false, step = 'start', busy = false;
    const say = (m: ProMsg) => {
      src.textContent = m.source === 'llm' ? 'AI · remembers you' : 'scripted';
      src.className = 'pro-src ' + m.source;
      clearInterval(typing); text.textContent = ''; text.dataset.done = ''; let i = 0;
      const full = m.say;
      const end = () => { clearInterval(typing); text.textContent = full; text.dataset.done = '1'; text.scrollTop = text.scrollHeight; };
      typing = window.setInterval(() => { text.textContent = full.slice(0, ++i); text.scrollTop = text.scrollHeight; if (i >= full.length) end(); }, 20);
      text.onclick = end;
      audio.goddess();
    };
    const thinking = () => { clearInterval(typing); text.dataset.done = ''; text.innerHTML = '<span class="pro-dots"><i></i><i></i><i></i></span>'; };
    const ask = async (m: C2S): Promise<ProMsg> => { busy = true; thinking(); const p = o.wait('prologue'); o.send(m); const r = await p; busy = false; say(r); return r; };
    const finish = async () => {
      if (done) return; done = true;
      choices.innerHTML = ''; talk.style.display = 'none';
      await new Promise((r) => setTimeout(r, Math.min(5000, 1200 + text.textContent!.length * 25)));
      await o.scene.ascend();
      d.remove(); resolve();
    };
    const skip = async () => {
      if (done) return;
      done = true; choices.innerHTML = '';
      const p = o.wait('status'); o.send({ type: 'prologue', step: 'skip' }); await p;
      d.remove(); resolve();
    };
    (d.querySelector('.pro-skip') as HTMLElement).onclick = () => void skip();
    talk.onsubmit = async (e) => { e.preventDefault(); const t = talkIn.value.trim(); if (!t || busy || done) return; talkIn.value = ''; await ask({ type: 'prologue', step: 'talk', text: t }); };
    talkIn.addEventListener('keydown', (e) => e.stopPropagation());

    const pastLife = () => {
      step = 'pastlife';
      choices.innerHTML = `<div class="pro-h">Who were you, before?</div><div class="pro-list">${PAST_LIVES.map((p) => `<button class="pro-opt" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div>
        <form class="pro-own"><input maxlength="120" placeholder="…or tell her in your own words"><button class="btn small">Tell her</button></form>`;
      const go = async (v: string) => { if (busy) return; choices.innerHTML = ''; const r = await ask({ type: 'prologue', step: 'pastlife', value: v }); cheats(r.offer ?? r.state.offer); };
      choices.querySelectorAll<HTMLElement>('.pro-opt').forEach((b) => b.onclick = () => void go(b.dataset.v!));
      const f = choices.querySelector('.pro-own') as HTMLFormElement, fi = f.querySelector('input')!; fi.addEventListener('keydown', (e) => e.stopPropagation());
      f.onsubmit = (e) => { e.preventDefault(); if (fi.value.trim()) void go(fi.value.trim()); };
    };
    const cheats = (offer: string[]) => {
      step = 'cheat';
      choices.innerHTML = `<div class="pro-h">Choose your Unique Skill <small>— a cheat no other soul has</small></div><div class="pro-cards">${offer.map((id) => { const c = CHEATS.find((x) => x.id === id)!; return `<button class="pro-card" data-v="${id}"><div class="pc-top"><span class="ico">${icon(CHEAT_ICON[id])}</span><span class="jp">${c.jp}</span></div><b>${esc(c.name)}</b><p>${esc(c.desc)}</p><small>${esc(c.effect)}</small></button>`; }).join('')}</div>`;
      choices.querySelectorAll<HTMLElement>('.pro-card').forEach((b) => b.onclick = async () => { if (busy) return; choices.innerHTML = ''; await ask({ type: 'prologue', step: 'cheat', value: b.dataset.v! }); classes(); });
    };
    const classes = () => {
      step = 'class';
      choices.innerHTML = `<div class="pro-h">Your path beneath the Tower</div><div class="pro-classes">${CLASSES.map((c) => `<button class="pro-cls ${c.id === o.cls ? 'on' : ''}" data-v="${c.id}"><span class="ico">${icon(c.id)}</span><b>${esc(c.name)}</b><small>${esc(c.role)}</small></button>`).join('')}</div>`;
      choices.querySelectorAll<HTMLElement>('.pro-cls').forEach((b) => b.onclick = async () => { if (busy) return; choices.innerHTML = ''; o.cls = b.dataset.v!; await ask({ type: 'prologue', step: 'class', value: o.cls }); affinity(); });
    };
    const affinity = () => {
      step = 'affinity';
      choices.innerHTML = `<div class="pro-h">The element your soul resonates with</div><div class="pro-orbs">${AFFINITIES.map((a) => `<button class="pro-orb ${a.id === 'forbidden' ? 'forbidden' : ''}" data-v="${a.id}" style="--c:${hex(a.color)}" title="${esc(a.desc)}"><span>${a.kanji}</span><small>${esc(a.name)}</small></button>`).join('')}</div><p class="pro-desc"></p>`;
      const desc = choices.querySelector('.pro-desc') as HTMLElement;
      choices.querySelectorAll<HTMLElement>('.pro-orb').forEach((b) => {
        b.onmouseenter = () => { desc.textContent = AFFINITIES.find((a) => a.id === b.dataset.v)!.desc; };
        b.onclick = async () => {
          if (busy) return;
          const v = b.dataset.v as Affinity;
          if (v === 'forbidden' && !b.classList.contains('armed')) { b.classList.add('armed'); desc.innerHTML = '<b>Are you sure?</b> The Forbidden path is strong (+25% magic, Chaos fusions), but it costs you 15% max HP forever and the Capital will distrust you. Click again to accept.'; return; }
          choices.innerHTML = ''; await ask({ type: 'prologue', step: 'affinity', value: v }); reveal();
        };
      });
    };
    const reveal = async () => {
      step = 'status';
      const p = o.wait('status'); o.send({ type: 'status' }); const m = await p;
      await new Promise((r) => setTimeout(r, 900));
      const w = statusWindow({ s: m.s as StatusView, mode: 'reveal', onClose: () => {} });
      w.onWake(async () => { w.close(); await ask({ type: 'prologue', step: 'finish' }); void finish(); });
    };

    if (o.autoSkip) { void skip(); return; }
    // she appears, then speaks
    o.scene.showGoddess(true);
    setTimeout(async () => { const r = await ask({ type: 'prologue', step: 'start' }); void r; if (step === 'start') pastLife(); }, 1600);
  });
}
