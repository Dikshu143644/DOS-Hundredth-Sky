import type { C2S, StatusView } from '../../shared/protocol';
import { CHEATS, AFFINITIES, findFusion, ADV_RANKS, INJURIES, type Affinity } from '../../shared/origin';
import { classById } from '../../shared/combat';
import { ADVANCED, TITLES } from '../../shared/skills';

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** The anime "Status" window (blue holographic panel). In game (U) it also hosts Skill Fusion. */
export function statusWindow(o: { s: StatusView; send?: (m: C2S) => void; onClose: () => void; mode?: 'game' | 'reveal' }) {
  let s = o.s, pick: Affinity | null = null;
  const d = document.createElement('div');
  d.className = 'status-wrap' + (o.mode === 'reveal' ? ' reveal' : '');
  document.getElementById('ui')!.appendChild(d);
  const close = () => { d.remove(); window.removeEventListener('keydown', key, true); o.onClose(); };
  const key = (e: KeyboardEvent) => { if (o.mode !== 'reveal' && (e.code === 'Escape' || e.code === 'KeyU')) { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', key, true);
  const render = () => {
    const cheat = CHEATS.find((c) => c.id === s.cheat), aff = AFFINITIES.find((a) => a.id === s.affinity);
    const adv = s.adv ? ADVANCED[s.cls as 'mage']?.find((a) => a.id === s.adv)?.name : null;
    const title = TITLES.find((t) => t.id === s.title)?.name;
    const ri = ADV_RANKS.indexOf(s.rank as 'F');
    const pct = s.nextPts ? Math.min(100, (s.advPts / s.nextPts) * 100) : 100;
    const row = (k: string, v: string) => `<div class="st-row"><span>${k}</span><b>${v}</b></div>`;
    const inj = s.injuries.map((j) => { const dj = INJURIES.find((x) => x.id === j.id); const m = Math.max(1, Math.round((j.until - Date.now()) / 60000)); return `<span class="st-inj">${esc(dj?.name ?? j.id)} · ${m} min</span>`; }).join('');
    const fuse = o.mode === 'reveal' || !s.affinity ? '' : (() => {
      const slots = s.fusionSlots, known = s.fusions;
      const opts = AFFINITIES.filter((a) => a.id !== s.affinity).map((a) => { const f = findFusion(s.affinity as Affinity, a.id); return f ? `<button class="st-el ${pick === a.id ? 'on' : ''} ${known.includes(f.id) ? 'known' : ''}" data-el="${a.id}" style="--c:${hex(a.color)}">${a.kanji}<small>${a.name}</small></button>` : ''; }).join('');
      const f = pick ? findFusion(s.affinity as Affinity, pick) : null;
      return `<div class="st-sec"><div class="st-h">SKILL FUSION <small>${known.length}/${slots} slots${slots < 3 ? ` · next at Lv ${slots === 0 ? 5 : slots === 1 ? 15 : 30}` : ''}</small></div>
        <div class="st-fuse"><div class="st-el base" style="--c:${hex(aff!.color)}">${aff!.kanji}<small>${aff!.name}</small></div><span class="plus-sign">+</span><div class="st-els">${opts}</div></div>
        ${f ? `<div class="st-result"><b>${esc(f.name)}</b> · ${esc(f.title)}<p>${esc(f.desc)}</p><button class="btn small" data-fuse ${known.length >= slots || known.includes(f.id) ? 'disabled' : ''}>${known.includes(f.id) ? 'Known' : known.length >= slots ? (slots ? 'No free slot' : 'Unlocks at Lv 5') : 'FUSE'}</button></div>` : '<p class="st-tip">Pick an element to fuse with your affinity.</p>'}
        ${known.length ? `<div class="st-known">Known: ${known.map((k) => `<span>${esc(k.replace('f_', '').replace('chaos_', 'chaos ').toUpperCase())}</span>`).join('')} <small>(keys G · H · N)</small></div>` : ''}</div>`;
    })();
    d.innerHTML = `<div class="status-win"><div class="st-glow"></div>
      <div class="st-top">STATUS${o.mode === 'reveal' ? '' : '<button class="st-x" data-close>✕</button>'}</div>
      <div class="st-grid"><div>
        ${row('Name', esc(s.name))}${row('Race', 'Human · Reincarnated')}${row('Class', esc(classById(s.cls as 'mage').name) + (adv ? ` → ${esc(adv)}` : ''))}${row('Level', String(s.level))}
        ${row('Rank', `<span class="st-rank r${ri}">${s.rank}</span>`)}<div class="st-bar"><i style="width:${pct}%"></i><small>${s.advPts}${s.nextPts ? ' / ' + s.nextPts : ''} guild pts</small></div>
        ${row('Title', esc(title ?? '—'))}${row('Power', s.power.toLocaleString())}
      </div><div>
        ${row('HP', `${s.hp} / ${s.stats.maxHp}`)}${row('MP', `${s.mp} / ${s.stats.maxMp}`)}${row('ATK', String(s.stats.atk))}${row('MAG', String(s.stats.mag))}${row('DEF', String(s.stats.def))}${row('CRIT', (s.stats.crit * 100).toFixed(0) + '%')}
      </div></div>
      <div class="st-sec"><div class="st-h">UNIQUE SKILL</div>${cheat ? `<div class="st-cheat"><b>${esc(cheat.name)}</b> <span class="jp">${cheat.jp}</span><p>${esc(cheat.effect)}</p></div>` : '<p>—</p>'}</div>
      <div class="st-sec"><div class="st-h">AFFINITY</div>${aff ? `<div class="st-aff" style="--c:${hex(aff.color)}"><b>${aff.kanji}</b> ${esc(aff.name)} <small>+15% with it · −15% taken from it</small></div>` : '<p>—</p>'}</div>
      ${inj ? `<div class="st-sec"><div class="st-h">CONDITION</div>${inj}</div>` : ''}
      ${fuse}
      ${o.mode === 'reveal' ? '<button class="btn st-wake" data-wake>AWAKEN</button>' : ''}
    </div>`;
    d.querySelector('[data-close]')?.addEventListener('click', close);
    d.querySelectorAll<HTMLElement>('[data-el]').forEach((b) => b.onclick = () => { pick = b.dataset.el as Affinity; render(); });
    d.querySelector('[data-fuse]')?.addEventListener('click', () => { if (pick) o.send?.({ type: 'fuse', a: s.affinity!, b: pick }); });
  };
  render();
  return { el: d, close, update(ns: StatusView) { s = ns; render(); }, onWake(fn: () => void) { d.querySelector('[data-wake]')?.addEventListener('click', fn); } };
}

/** Rankings (L): your adventurer rank + the global power leaderboard. */
export function rankingsPanel(o: { onClose: () => void }) {
  const d = document.createElement('div');
  d.className = 'modal inv-modal'; d.id = 'rankings';
  document.getElementById('ui')!.appendChild(d);
  const close = () => { d.remove(); window.removeEventListener('keydown', key, true); o.onClose(); };
  const key = (e: KeyboardEvent) => { if (e.code === 'Escape' || e.code === 'KeyL') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', key, true);
  d.innerHTML = '<div class="inv-box rk-box"><div class="inv-head"><div class="t">RANKINGS</div><button class="x" data-close>✕</button></div><p style="padding:20px">Consulting the Guild…</p></div>';
  d.querySelector('[data-close]')!.addEventListener('click', close);
  return {
    close,
    update(m: { rows: { name: string; cls: string; level: number; rank: string; power: number; me: boolean }[]; place: number; total: number }) {
      d.innerHTML = `<div class="inv-box rk-box"><div class="inv-head"><div class="t">RANKINGS</div><button class="x" data-close>✕</button></div>
        <div class="rk-body"><div class="rk-ranks">${ADV_RANKS.map((r, i) => `<span class="st-rank r${i}">${r}</span>`).join('<i>›</i>')}</div>
        <p class="rk-tip">Guild rank rises with monsters near your level, bosses and quests, and <b>drops when you fall</b>. A fresh promotion is protected for 10 minutes.</p>
        <table class="rk-t"><tr><th>#</th><th>Adventurer</th><th>Class</th><th>Lv</th><th>Rank</th><th>Power</th></tr>
        ${m.rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(classById(r.cls as 'mage').name)}</td><td>${r.level}</td><td><span class="st-rank r${ADV_RANKS.indexOf(r.rank as 'F')}">${r.rank}</span></td><td>${r.power.toLocaleString()}</td></tr>`).join('')}</table>
        <p class="rk-tip">You are #${m.place} of ${m.total} adventurers.</p></div></div>`;
      d.querySelector('[data-close]')!.addEventListener('click', close);
    },
  };
}
