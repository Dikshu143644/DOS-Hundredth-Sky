import { ITEMS, LEGENDARY_IDS, rarityOf, canEquip } from '../../shared/items';
import type { ClassId } from '../../shared/combat';
import { show, hide, esc } from './screens';
import type { Armory } from '../scenes/armory';

/** Legendary Armory overlay: weapon card (rarity, stats, lore), weapon picker, lineup view,
 *  drag-to-rotate, equip when owned. Keys: ←/→ cycle, L lineup, Esc close. */
export function armoryScreen(scene: Armory, o: { focus?: string; owned: Set<string>; equipped?: string; cls?: ClassId; onEquip: (id: string) => void; onClose: () => void }) {
  let idx = Math.max(0, LEGENDARY_IDS.indexOf(o.focus ?? scene.current));
  let equipped = o.equipped;
  const d = show(`
    <div class="ar-top"><button class="ar-back" data-close aria-label="Back">‹ Back</button><div class="ar-title">LEGENDARY ARMORY</div><button class="ar-line" data-lineup>Lineup</button></div>
    <div class="ar-card"></div>
    <div class="ar-pick">${LEGENDARY_IDS.map((id, i) => { const d = ITEMS[id]; const r = rarityOf(d.rarity); return `<button data-i="${i}" style="--rc:${r.color}"><span class="gem"></span><span class="nm">${esc(d.name)}</span><span class="rr">${r.name}</span></button>`; }).join('')}</div>
    <div class="ar-hint">Drag to turn · ← → to browse · L lineup · Esc back</div>`, 'armory');
  d.classList.add('ar-screen');
  const card = d.querySelector('.ar-card') as HTMLElement;
  const render = () => {
    const id = LEGENDARY_IDS[idx]; const it = ITEMS[id]; const r = rarityOf(it.rarity);
    const own = o.owned.has(id); const can = o.cls ? canEquip(o.cls, [...o.owned].map((x) => ({ item: x, rarity: '', n: 1 })), id) : { ok: false, reason: 'log in to equip' };
    const stat = (k: string, v?: number) => (v ? `<div class="st"><span>${k}</span><b>+${v}</b></div>` : '');
    card.style.setProperty('--rc', r.color);
    card.innerHTML = `<div class="rar">${r.name.toUpperCase()} · ${(it.family ?? '').toUpperCase()}</div><h1>${esc(it.name)}</h1><div class="ttl">${esc(it.title ?? '')}</div>
      <div class="stats">${stat('ATK', it.atk)}${stat('MAG', it.mag)}${stat('HP', it.hp)}${stat('MP', it.mp)}${it.element ? `<div class="st"><span>ELEMENT</span><b>${it.element.toUpperCase()}</b></div>` : ''}</div>
      <p class="lore">${esc(it.lore)}</p>
      <div class="cls">Wielded by: ${(it.classes ?? []).map((c) => c[0].toUpperCase() + c.slice(1)).join(', ')}</div>
      ${equipped === id ? '<div class="eqd">✦ Equipped</div>' : own ? (can.ok ? '<button class="sk-btn ar-eq" data-equip><span>EQUIP</span></button>' : `<div class="lock">Owned · your class can't wield it</div>`) : '<div class="lock">Not yet found · drops in the Tower</div>'}`;
    card.querySelector('[data-equip]')?.addEventListener('click', () => { o.onEquip(id); equipped = id; render(); });
    d.querySelectorAll('.ar-pick button').forEach((b, i) => b.classList.toggle('on', i === idx));
    if (scene.mode !== 'showcase' || scene.current !== id) scene.show(id);
  };
  const go = (k: number) => { idx = (idx + k + LEGENDARY_IDS.length) % LEGENDARY_IDS.length; render(); };
  d.querySelectorAll('.ar-pick button').forEach((b) => b.addEventListener('click', () => { idx = Number((b as HTMLElement).dataset.i); render(); }));
  d.querySelector('[data-lineup]')!.addEventListener('click', () => { if (scene.mode === 'lineup') render(); else { scene.lineup(); card.classList.add('dim'); } });
  const close = () => { removeEventListener('keydown', key); hide('armory', false); o.onClose(); };
  d.querySelector('[data-close]')!.addEventListener('click', close);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Escape') close(); else if (e.key.toLowerCase() === 'l') (d.querySelector('[data-lineup]') as HTMLElement).click();
    else return; e.preventDefault(); e.stopPropagation();
  };
  addEventListener('keydown', key);
  let drag: number | null = null;
  d.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('button')) return; drag = e.clientX; });
  addEventListener('pointerup', () => (drag = null));
  d.addEventListener('pointermove', (e) => { if (drag === null) return; scene.rotateBy((e.clientX - drag) * 0.01); drag = e.clientX; });
  render();
  card.classList.remove('dim');
  return { el: d, setEquipped(id: string) { equipped = id; render(); } };
}
