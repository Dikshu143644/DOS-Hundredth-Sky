import { ITEMS, SLOTS, Slot, rarityOf, canEquip, equipBonus, InvEntry, Equipment } from '../../shared/items';
import { CONSUMABLES, sellPrice } from '../../shared/economy';
import type { ClassId } from '../../shared/combat';

const SLOT_ICON: Record<Slot, string> = { weapon: '⚔', armor: '🛡', helmet: '⛑', gloves: '🧤', boots: '🥾', ring: '💍', necklace: '📿', accessory: '✧' };
const FAM_ICON: Record<string, string> = { sword: '🗡', greatsword: '⚔', daggers: '🔪', bow: '🏹', spear: '🔱', dual: '☾', staff: '🪄', axe: '🪓' };
const iconOf = (id: string) => { const d = ITEMS[id]; return d?.family ? FAM_ICON[d.family] ?? '⚔' : d?.slot ? SLOT_ICON[d.slot] : '◆'; };
const statsOf = (id: string) => { const d = ITEMS[id]; return d ? (['atk', 'mag', 'def', 'hp', 'mp'] as const).filter((k) => d[k]).map((k) => [k, d[k]!] as const) : []; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Inventory + equipment screen (I). Equipment slots on the left, the bag on the right,
 *  item detail with Equip / Unequip / View in Armory. The server decides; this only asks. */
export function inventoryScreen(o: {
  inv: InvEntry[]; equipment: Equipment; cls: ClassId;
  onEquip: (id: string) => void; onUnequip: (slot: Slot) => void; onArmory: (id: string) => void; onClose: () => void;
  enchant?: Record<string, number>; gold?: number; onUse?: (id: string) => void; onForge?: () => void;
}) {
  let ench = o.enchant ?? {}, gold = o.gold ?? 0;
  let inv = o.inv, eq = o.equipment, sel: string | null = eq.weapon ?? inv[0]?.item ?? null;
  const d = document.createElement('div');
  d.className = 'modal inv-modal'; d.id = 'inventory';
  document.getElementById('ui')!.appendChild(d);
  const close = () => { d.remove(); window.removeEventListener('keydown', key, true); o.onClose(); };
  const key = (e: KeyboardEvent) => { if (e.code === 'Escape' || e.code === 'KeyI') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', key, true);
  const cell = (id: string, n = 1, extra = '') => {
    const def = ITEMS[id]; const r = rarityOf(def?.rarity ?? 'common');
    return `<button class="inv-cell ${extra} ${sel === id ? 'sel' : ''}" data-item="${esc(id)}" style="--rc:${r.color}" title="${esc(def?.name ?? id)}">
      <span class="ic">${iconOf(id)}</span>${n > 1 ? `<span class="n">${n}</span>` : ''}${ench[id] ? `<span class="pl">+${ench[id]}</span>` : ''}${Object.values(eq).includes(id) ? '<span class="e">E</span>' : ''}</button>`;
  };
  const render = () => {
    const b = equipBonus(eq, ench);
    const def = sel ? ITEMS[sel] : undefined; const r = rarityOf(def?.rarity ?? 'common');
    const owned = sel ? inv.some((e) => e.item === sel) : false;
    const slotOf = def?.slot; const isEq = !!(sel && slotOf && eq[slotOf] === sel);
    const can = sel ? canEquip(o.cls, inv, sel) : { ok: false };
    d.innerHTML = `<div class="inv-box">
      <div class="inv-head"><div class="t">INVENTORY</div><button class="x" data-close>✕</button></div>
      <div class="inv-body">
        <div class="inv-eq">
          <div class="h">EQUIPMENT</div>
          ${SLOTS.map((s) => `<div class="slot" data-slot="${s}"><span class="si">${SLOT_ICON[s]}</span><span class="sn">${s}</span>${eq[s] ? cell(eq[s]!, 1, 'small') : '<span class="empty">—</span>'}</div>`).join('')}
          <div class="bonus">Bonus: ATK +${b.atk} · MAG +${b.mag} · DEF +${b.def}${b.hp ? ` · HP +${b.hp}` : ''}${b.mp ? ` · MP +${b.mp}` : ''}</div>
        </div>
        <div class="inv-bag">
          <div class="h">BAG · ${inv.reduce((a, e) => a + e.n, 0)} items · ${gold} gold</div>
          <div class="grid">${inv.map((e) => cell(e.item, e.n)).join('')}${Array.from({ length: Math.max(0, 24 - inv.length) }, () => '<div class="inv-cell blank"></div>').join('')}</div>
        </div>
        <div class="inv-detail" style="--rc:${r.color}">${def ? `
          <div class="rar">${r.name}</div><div class="nm">${esc(def.name)}${ench[sel!] ? ` <span class="plv">+${ench[sel!]}</span>` : ''}</div>${def.title ? `<div class="ttl">${esc(def.title)}</div>` : ''}
          <div class="ty">${def.slot ? def.slot + (def.family ? ' · ' + def.family : '') : 'material'}</div>
          ${statsOf(sel!).length ? `<div class="st">${statsOf(sel!).map(([k, v]) => `<span>${k.toUpperCase()} +${v}</span>`).join('')}</div>` : ''}
          ${def.lore ? `<div class="lore">${esc(def.lore)}</div>` : ''}
          <div class="act">
            ${isEq ? `<button class="sk-btn ghost" data-unequip="${slotOf}"><span>UNEQUIP</span></button>` : slotOf && owned ? (can.ok ? `<button class="sk-btn" data-equip="${esc(sel!)}"><span>EQUIP</span></button>` : `<div class="lock">${esc(can.reason ?? 'cannot equip')}</div>`) : ''}
            ${CONSUMABLES[sel!] && owned ? `<button class="sk-btn" data-use="${esc(sel!)}"><span>USE</span></button>` : ''}
            ${def.slot && o.onForge ? `<button class="sk-btn ghost" data-forge><span>ENCHANT / SALVAGE</span></button>` : ''}
            <div class="lock" style="opacity:.7">Sells for ${sellPrice(sel!)} gold</div>
            ${def.model ? `<button class="sk-btn ghost" data-armory="${esc(sel!)}"><span>VIEW IN ARMORY</span></button>` : ''}
          </div>` : '<div class="lore">Your bag is empty.</div>'}
        </div>
      </div></div>`;
    d.querySelector('[data-close]')!.addEventListener('click', close);
    d.querySelectorAll<HTMLElement>('[data-item]').forEach((c) => c.addEventListener('click', () => { sel = c.dataset.item!; render(); }));
    d.querySelector<HTMLElement>('[data-equip]')?.addEventListener('click', (e) => o.onEquip((e.currentTarget as HTMLElement).dataset.equip!));
    d.querySelector<HTMLElement>('[data-unequip]')?.addEventListener('click', (e) => o.onUnequip((e.currentTarget as HTMLElement).dataset.unequip as Slot));
    d.querySelector<HTMLElement>('[data-use]')?.addEventListener('click', (e) => o.onUse?.((e.currentTarget as HTMLElement).dataset.use!));
    d.querySelector<HTMLElement>('[data-forge]')?.addEventListener('click', () => { close(); o.onForge?.(); });
    d.querySelector<HTMLElement>('[data-armory]')?.addEventListener('click', (e) => { const id = (e.currentTarget as HTMLElement).dataset.armory!; close(); o.onArmory(id); });
  };
  render();
  return { el: d, close, update(nInv: InvEntry[], nEq: Equipment, nEnch?: Record<string, number>, nGold?: number) { inv = nInv; eq = nEq; if (nEnch) ench = nEnch; if (nGold !== undefined) gold = nGold; render(); } };
}
