import { REGIONS, ZONE_IDS } from '../../shared/regions';
import type { C2S } from '../../shared/protocol';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export interface MapState { zone: string; attuned: string[]; bind: string; visited: string[] }

/** World map (M): the seven regions, how they connect, and every attuned shrine you can fast-travel to. */
export function worldMap(o: { state: MapState; level: number; send: (m: C2S) => void; onClose: () => void; toggleMinimap: () => void }) {
  const d = document.createElement('div');
  d.className = 'modal inv-modal'; d.id = 'worldmap';
  document.getElementById('ui')!.appendChild(d);
  const close = () => { d.remove(); window.removeEventListener('keydown', key, true); o.onClose(); };
  const key = (e: KeyboardEvent) => { if (e.code === 'Escape' || e.code === 'KeyM') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', key, true);
  // schematic layout (x, y in %) — how the regions border each other
  const POS: Record<string, [number, number]> = { capital: [50, 46], forest: [50, 68], forbidden: [50, 89], mountain: [17, 46], frozen: [17, 14], desert: [83, 46], tower: [83, 14] };
  const render = () => {
    const s = o.state;
    const links = ZONE_IDS.flatMap((z) => REGIONS[z].exits.filter((e) => z < e.to).map((e) => [z, e.to]));
    const svg = links.map(([a, b]) => `<line x1="${POS[a][0]}%" y1="${POS[a][1]}%" x2="${POS[b][0]}%" y2="${POS[b][1]}%" />`).join('');
    const nodes = ZONE_IDS.map((z) => {
      const r = REGIONS[z], seen = s.visited.includes(z), here = s.zone === z;
      const danger = o.level < r.levels[0] - 2 ? 'danger' : '';
      return `<div class="wm-node ${seen ? 'seen' : ''} ${here ? 'here' : ''} ${danger}" style="left:${POS[z][0]}%;top:${POS[z][1]}%"><b>${esc(seen ? r.name : '???')}</b><small>Lv ${r.levels[0]}–${r.levels[1]}${here ? ' · you are here' : ''}</small></div>`;
    }).join('');
    const shrines = ZONE_IDS.flatMap((z) => REGIONS[z].shrines.map((sh) => ({ z, sh, key: z + ':' + sh.id })));
    const list = shrines.map(({ z, sh, key }) => {
      const has = s.attuned.includes(key);
      return `<div class="wm-sh ${has ? '' : 'lk'}"><span>${esc(has ? sh.name : 'Unattuned shrine')}<small>${esc(REGIONS[z].name)}${s.bind === key ? ' · you rise here' : ''}</small></span>${has ? `<button class="plus" data-go="${key}">Travel</button>` : '<span class="lock">touch it to attune</span>'}</div>`;
    }).join('');
    d.innerHTML = `<div class="inv-box wm-box"><div class="inv-head"><div class="t">WORLD MAP</div><button class="btn ghost small" data-mini style="margin:0 10px">Minimap size</button><button class="x" data-close>✕</button></div>
      <div class="wm-body"><div class="wm-map"><svg>${svg}</svg>${nodes}<div class="wm-tower">THE HUNDREDTH TOWER ↑</div></div>
      <div class="wm-list"><div class="h">FAST TRAVEL · ${s.attuned.length} shrines attuned</div>${list}<p class="wm-tip">Walk through a glowing gate at a region's edge to travel on foot. Touch a shrine's crystal to attune it: you can return any time (not in combat) and you rise at the last shrine you touched.</p></div></div></div>`;
    d.querySelector('[data-close]')!.addEventListener('click', close);
    d.querySelector('[data-mini]')!.addEventListener('click', () => o.toggleMinimap());
    d.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.onclick = () => { o.send({ type: 'travel', shrine: b.dataset.go! }); close(); });
  };
  render();
  return { close, update(st: MapState) { o.state = st; render(); } };
}
