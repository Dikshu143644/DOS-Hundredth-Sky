import { ATTRS, ADVANCED, ADVANCE_LEVEL, classSkills, MAX_RANK, rankScale, TITLES, FACTIONS, repRank, REP_RANKS, masteryLevel } from '../../shared/skills';
import { classById, type ClassId } from '../../shared/combat';
import type { C2S, ProgressView } from '../../shared/protocol';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
type Tab = 'stats' | 'skills' | 'titles' | 'rep';

/** Hero panel (P): attributes (stat points), the skill tree (ranks + advanced class at 20),
 *  titles, reputation and weapon mastery. Every button only asks; the server decides. */
export function heroPanel(o: { cls: ClassId; level: number; progress: ProgressView | null; send: (m: C2S) => void; onClose: () => void }) {
  let p = o.progress, level = o.level, tab: Tab = 'stats';
  const d = document.createElement('div');
  d.className = 'modal inv-modal'; d.id = 'hero';
  document.getElementById('ui')!.appendChild(d);
  const close = () => { d.remove(); window.removeEventListener('keydown', key, true); o.onClose(); };
  const key = (e: KeyboardEvent) => { if (e.code === 'Escape' || e.code === 'KeyP') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', key, true);
  const cls = classById(o.cls);
  const render = () => {
    if (!p) { d.innerHTML = '<div class="inv-box"><div class="inv-head"><div class="t">HERO</div><button class="x" data-close>✕</button></div><p style="padding:20px">Loading…</p></div>'; bind(); return; }
    const st = p.stats;
    const tabs = (['stats', 'skills', 'titles', 'rep'] as Tab[]).map((t) => `<button class="htab ${t === tab ? 'on' : ''}" data-tab="${t}">${{ stats: 'Attributes', skills: 'Skill Tree', titles: 'Titles', rep: 'Reputation & Mastery' }[t]}${t === 'stats' && p!.statPoints > 0 ? ` <b>${p!.statPoints}</b>` : t === 'skills' && (p!.skillPoints > 0 || (level >= ADVANCE_LEVEL && !p!.adv)) ? ` <b>${p!.skillPoints || '!'}</b>` : ''}</button>`).join('');
    let body = '';
    if (tab === 'stats') {
      body = `<div class="hgrid"><div>
        <div class="h">ATTRIBUTES · <span class="pts">${p.statPoints}</span> points to spend</div>
        ${ATTRS.map((a) => `<div class="attr"><span class="an">${a.name}</span><span class="av">${p!.attrs[a.id] ?? 0}</span><button class="plus" data-attr="${a.id}" ${p!.statPoints < 1 ? 'disabled' : ''}>+</button><button class="plus" data-attr5="${a.id}" ${p!.statPoints < 5 ? 'disabled' : ''}>+5</button><small>${a.desc}</small></div>`).join('')}
        <button class="btn ghost small" data-reset>Reset attributes (${50 * level} gold)</button>
      </div><div>
        <div class="h">${esc(cls.name.toUpperCase())}${p.adv ? ' · ' + esc(ADVANCED[o.cls].find((x) => x.id === p!.adv)?.name.toUpperCase() ?? '') : ''} · LEVEL ${level}</div>
        <table class="stt">
          <tr><td>Max HP</td><td>${st.maxHp}</td></tr><tr><td>Max MP</td><td>${st.maxMp}</td></tr>
          <tr><td>Attack</td><td>${st.atk}</td></tr><tr><td>Magic</td><td>${st.mag}</td></tr><tr><td>Defence</td><td>${st.def}</td></tr>
          <tr><td>Critical</td><td>${(st.crit * 100).toFixed(1)} %</td></tr><tr><td>Move speed</td><td>${(st.spd * 100).toFixed(0)} %</td></tr><tr><td>Mana regen</td><td>×${st.mpRegen.toFixed(2)}</td></tr>
          <tr><td>Monsters defeated</td><td>${p.kills}</td></tr><tr><td>Times fallen</td><td>${p.deaths}</td></tr>
          <tr><td>Best combo</td><td>${p.counters.maxCombo ?? 0}</td></tr><tr><td>Parries / dodges</td><td>${p.counters.parries ?? 0} / ${p.counters.dodges ?? 0}</td></tr>
        </table></div></div>`;
    } else if (tab === 'skills') {
      const sk = classSkills(o.cls);
      const row = (s: typeof sk[number]) => {
        const known = level >= s.unlock && (s.slot !== 5 || s.adv === p!.adv);
        const r = p!.ranks[s.id] ?? 1, rs = rankScale(s, r);
        return `<div class="sk ${known ? '' : 'lk'} ${s.ult ? 'ult' : ''}"><div class="skn">${esc(s.name)} <small>${esc(s.title)}</small></div>
          <div class="skd">${esc(s.desc)}</div>
          <div class="skm">${s.slot === 6 ? 'R' : s.slot} · ${rs.mana} MP · ${rs.cooldown.toFixed(1)} s CD${s.castTime > 0.3 ? ` · ${s.castTime}s cast` : ''} · ${s.element}${s.incantation ? `<br><i>“${esc(s.incantation)}”</i>` : ''}</div>
          <div class="skr">${known ? `<span class="pips">${Array.from({ length: MAX_RANK }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('')}</span><button class="plus" data-rank="${s.id}" ${p!.skillPoints < 1 || r >= MAX_RANK ? 'disabled' : ''}>Rank up</button>` : `<span class="lock">${s.slot === 5 ? (p!.adv ? 'Other path' : `Choose this path at ${ADVANCE_LEVEL}`) : 'Unlocks at level ' + s.unlock}</span>`}</div></div>`;
      };
      const adv = ADVANCED[o.cls];
      body = `<div class="h">SKILL TREE · <span class="pts">${p.skillPoints}</span> skill points (1 per level)</div>
        <div class="tree">${sk.filter((s) => s.slot <= 4).map(row).join('')}${sk.filter((s) => s.slot === 6).map(row).join('')}</div>
        <div class="h" style="margin-top:14px">ADVANCED CLASS · level ${ADVANCE_LEVEL}</div>
        <div class="advs">${adv.map((a) => { const s = sk.find((x) => x.adv === a.id)!; const chosen = p!.adv === a.id; return `<div class="adv ${chosen ? 'on' : ''}"><div class="an">${esc(a.name)}</div><div class="ad">${esc(a.desc)}</div><div class="ab">${Object.entries(a.bonus).map(([k, v]) => `+${Math.round((v as number) * 100)}% ${k.toUpperCase()}`).join(' · ')}</div>${row(s)}${!p!.adv ? `<button class="btn small" data-adv="${a.id}" ${level < ADVANCE_LEVEL ? 'disabled' : ''}>${level < ADVANCE_LEVEL ? 'Level ' + ADVANCE_LEVEL : 'Become ' + esc(a.name)}</button>` : chosen ? '<div class="chosen">Your path</div>' : ''}</div>`; }).join('')}</div>`;
    } else if (tab === 'titles') {
      body = `<div class="h">TITLES · ${p.titles.length} / ${TITLES.length} earned · shown above your name</div><div class="titles">${TITLES.map((t) => { const has = p!.titles.includes(t.id); return `<div class="ttl ${has ? '' : 'lk'} ${p!.title === t.id ? 'on' : ''}"><b>${esc(t.name)}</b><small>${esc(t.desc)}</small>${has ? `<button class="plus" data-title="${t.id}">${p!.title === t.id ? 'Shown' : 'Show'}</button>` : '<span class="lock">locked</span>'}</div>`; }).join('')}</div>
        <button class="btn ghost small" data-title-none>Hide title</button>`;
    } else {
      body = `<div class="hgrid"><div><div class="h">REPUTATION</div>${FACTIONS.map((f) => { const v = p!.rep[f.id] ?? 0, rk = repRank(v); const i = REP_RANKS.findIndex((x) => x.name === rk), next = REP_RANKS[i + 1]; const pct = next ? Math.max(0, Math.min(100, ((v - REP_RANKS[i].min) / (next.min - REP_RANKS[i].min)) * 100)) : 100; return `<div class="rep"><span>${esc(f.name)}</span><b>${rk}</b><div class="bar"><i style="width:${pct}%"></i></div><small>${v}${next ? ' / ' + next.min : ''}</small></div>`; }).join('')}</div>
        <div><div class="h">WEAPON MASTERY</div>${['sword', 'axe', 'staff', 'bow', 'daggers', 'dual'].map((w) => { const xp = p!.mastery[w] ?? 0, lv = masteryLevel(xp); return `<div class="rep"><span>${w}</span><b>${lv} / 20</b><div class="bar"><i style="width:${(lv / 20) * 100}%"></i></div><small>+${(lv * 1.5).toFixed(1)}% damage</small></div>`; }).join('')}</div></div>`;
    }
    d.innerHTML = `<div class="inv-box hero-box"><div class="inv-head"><div class="t">HERO</div><div class="htabs">${tabs}</div><button class="x" data-close>✕</button></div><div class="hbody">${body}</div></div>`;
    bind();
  };
  const bind = () => {
    d.querySelector('[data-close]')?.addEventListener('click', close);
    d.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab as Tab; render(); });
    d.querySelectorAll<HTMLElement>('[data-attr]').forEach((b) => b.onclick = () => o.send({ type: 'allocStat', attr: b.dataset.attr!, n: 1 }));
    d.querySelectorAll<HTMLElement>('[data-attr5]').forEach((b) => b.onclick = () => o.send({ type: 'allocStat', attr: b.dataset.attr5!, n: 5 }));
    d.querySelector<HTMLElement>('[data-reset]')?.addEventListener('click', () => o.send({ type: 'resetStats' }));
    d.querySelectorAll<HTMLElement>('[data-rank]').forEach((b) => b.onclick = () => o.send({ type: 'rankSkill', skill: b.dataset.rank! }));
    d.querySelectorAll<HTMLElement>('[data-adv]').forEach((b) => b.onclick = () => { if (confirm('Your advanced class is permanent. Continue?')) o.send({ type: 'advance', adv: b.dataset.adv! }); });
    d.querySelectorAll<HTMLElement>('[data-title]').forEach((b) => b.onclick = () => o.send({ type: 'setTitle', title: b.dataset.title! }));
    d.querySelector<HTMLElement>('[data-title-none]')?.addEventListener('click', () => o.send({ type: 'setTitle', title: null }));
  };
  render();
  return { close, update(np: ProgressView, lvl: number) { p = np; level = lvl; render(); }, el: d, setTab(t: Tab) { tab = t; render(); } };
}
