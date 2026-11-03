/** Phase 4 · M4 client windows: town shop (buy/sell), the forge (craft · enchant · salvage) and
 *  player trading. Glass, phone-first. They only ask; the server decides. */
import { ITEMS, rarityOf, type InvEntry } from '../../shared/items';
import { RECIPES, canCraft, enchantCost, enchantChance, MAX_ENCHANT, salvageYield, count, TIERS } from '../../shared/economy';
import type { TradeView } from '../../shared/protocol';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const nm = (id: string) => ITEMS[id]?.name ?? id;
const chip = (id: string) => { const d = ITEMS[id]; const r = rarityOf(d?.rarity ?? 'common'); return `<span class="mk-r" style="--rc:${r.color}">${r.name}</span>`; };
const stats = (id: string) => { const d = ITEMS[id]; return d ? (['atk', 'mag', 'def', 'hp', 'mp'] as const).filter((k) => d[k]).map((k) => `${k.toUpperCase()} +${d[k]}`).join(' · ') : ''; };

function shell(id: string, title: string, ico: string, onClose: () => void, closeKeys: string[] = ['Escape']) {
  const wrap = document.createElement('div');
  wrap.className = 'modal mk-modal'; wrap.id = id;
  wrap.innerHTML = `<div class="inv-box mk-box"><div class="inv-head"><div class="t">${icon(ico, 20)}<span>${esc(title)}</span></div><div class="mk-gold"></div><button class="x" data-close aria-label="Close">${icon('close', 16)}</button></div><div class="mk-tabs"></div><div class="mk-body"></div></div>`;
  document.getElementById('ui')!.appendChild(wrap);
  const key = (e: KeyboardEvent) => { if (closeKeys.includes(e.code)) { e.preventDefault(); e.stopPropagation(); close(); } };
  const close = () => { wrap.remove(); window.removeEventListener('keydown', key, true); onClose(); };
  window.addEventListener('keydown', key, true);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  (wrap.querySelector('[data-close]') as HTMLElement).onclick = close;
  return { wrap, close, body: wrap.querySelector('.mk-body') as HTMLElement, tabs: wrap.querySelector('.mk-tabs') as HTMLElement, gold: wrap.querySelector('.mk-gold') as HTMLElement };
}
const tabs = (el: HTMLElement, names: string[], cur: string, go: (t: string) => void) => {
  el.innerHTML = `<div class="seg">${names.map((t) => `<button class="${t === cur ? 'on' : ''}" data-tab="${t}">${t}</button>`).join('')}</div>`;
  el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => (b.onclick = () => go(b.dataset.tab!)));
};

// ------------------------------------------------------------------ shop
export interface ShopUi { update(m: { npc: string; name: string; keeper: string; stock: { item: string; price: number }[]; sell: Record<string, number> }, inv: InvEntry[], gold: number, eq: Record<string, string>): void; close(): void }
export function shopWindow(o: { buy: (npc: string, item: string, n: number) => void; sell: (npc: string, item: string, n: number) => void; onClose: () => void }): ShopUi {
  const s = shell('shop', 'Shop', 'bag', o.onClose);
  let tab = 'Buy', last: any = null, inv: InvEntry[] = [], gold = 0, eq: Record<string, string> = {};
  const render = () => {
    if (!last) { s.body.innerHTML = '<div class="qb-wait">Opening the stall…</div>'; return; }
    (s.wrap.querySelector('.inv-head .t span') as HTMLElement).textContent = last.name;
    s.gold.textContent = `${gold} gold`;
    tabs(s.tabs, ['Buy', 'Sell'], tab, (t) => { tab = t; render(); });
    if (tab === 'Buy') s.body.innerHTML = last.stock.map((l: any) => `<div class="mk-row"><div class="mk-main"><b>${esc(nm(l.item))}</b>${chip(l.item)}<small>${esc(stats(l.item) || ITEMS[l.item]?.lore || '')}</small></div><div class="mk-act"><span class="mk-price">${l.price}g</span><button class="btn small primary" data-buy="${esc(l.item)}" ${gold < l.price ? 'disabled' : ''}>Buy</button></div></div>`).join('');
    else {
      const rows = inv.filter((e) => last.sell[e.item] && !['divine', 'unique'].includes(ITEMS[e.item]?.rarity ?? '')).map((e) => { const free = e.n - Object.values(eq).filter((x) => x === e.item).length; return `<div class="mk-row ${free < 1 ? 'locked' : ''}"><div class="mk-main"><b>${esc(nm(e.item))} ×${e.n}</b>${chip(e.item)}<small>${free < 1 ? 'equipped' : esc(stats(e.item))}</small></div><div class="mk-act"><span class="mk-price">${last.sell[e.item]}g</span><button class="btn small" data-sell="${esc(e.item)}" ${free < 1 ? 'disabled' : ''}>Sell</button></div></div>`; });
      s.body.innerHTML = rows.join('') || '<div class="qb-wait">Nothing to sell.</div>';
    }
    s.body.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => (b.onclick = () => { b.disabled = true; o.buy(last.npc, b.dataset.buy!, 1); }));
    s.body.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((b) => (b.onclick = () => { b.disabled = true; o.sell(last.npc, b.dataset.sell!, 1); }));
  };
  render();
  return { close: s.close, update(m, i, g, e) { last = m; inv = i; gold = g; eq = e; render(); } };
}

// ------------------------------------------------------------------ forge
export interface ForgeUi { update(inv: InvEntry[], gold: number, ench: Record<string, number>, eq: Record<string, string>): void; close(): void }
export function forgeWindow(o: { level: number; craft: (id: string) => void; enchant: (id: string) => void; salvage: (id: string) => void; onClose: () => void; inv: InvEntry[]; gold: number; ench: Record<string, number>; eq: Record<string, string> }): ForgeUi {
  const s = shell('forge', 'Forge', 'settings', o.onClose, ['Escape', 'KeyC']);
  let tab = 'Craft', inv = o.inv, gold = o.gold, ench = o.ench, eq = o.eq;
  const maxTier = Math.min(7, TIERS.filter((t) => t.lvl <= o.level + 7).length);
  let tier = Math.max(1, Math.min(maxTier, TIERS.filter((t) => t.lvl <= o.level).length));
  const render = () => {
    s.gold.textContent = `${gold} gold · ${count(inv, 'Enchant Stone')} stones`;
    tabs(s.tabs, ['Craft', 'Enchant', 'Salvage'], tab, (t) => { tab = t; render(); });
    if (tab === 'Craft') {
      const tiersBar = `<div class="seg mk-tiers">${[...TIERS.map((t) => t.t), 0, 8].map((t) => `<button class="${t === tier ? 'on' : ''}" data-tier="${t}">${t === 0 ? 'Potions' : t === 8 ? 'Divine' : 'T' + t}</button>`).join('')}</div>`;
      const list = RECIPES.filter((r) => r.tier === tier).map((r) => { const c = canCraft(r, inv, gold); return `<div class="mk-row ${c.ok ? '' : 'locked'}"><div class="mk-main"><b>${esc(nm(r.out))}</b>${chip(r.out)}<small>${esc(stats(r.out))}${r.outEpic ? ' · 25% Heroic' : ''}</small><em>${r.inputs.map((i) => `<span class="${count(inv, i.item) >= i.n ? 'ok' : 'no'}">${i.n}× ${esc(nm(i.item))} (${count(inv, i.item)})</span>`).join(' ')} · ${r.gold}g</em></div><div class="mk-act"><button class="btn small primary" data-craft="${r.id}" ${c.ok ? '' : 'disabled'}>Craft</button></div></div>`; }).join('');
      s.body.innerHTML = tiersBar + list;
      s.body.querySelectorAll<HTMLElement>('[data-tier]').forEach((b) => (b.onclick = () => { tier = Number(b.dataset.tier); render(); }));
    } else {
      const gear = inv.filter((e) => ITEMS[e.item]?.slot);
      s.body.innerHTML = gear.map((e) => {
        const lv = ench[e.item] ?? 0, c = enchantCost(lv), equipped = Object.values(eq).includes(e.item);
        if (tab === 'Enchant') return `<div class="mk-row"><div class="mk-main"><b>${esc(nm(e.item))} ${lv ? `<span class="plv">+${lv}</span>` : ''}</b>${chip(e.item)}<small>${esc(stats(e.item))}${equipped ? ' · equipped' : ''}</small><em>${lv >= MAX_ENCHANT ? 'Maxed' : `→ +${lv + 1}: ${c.stones} stone${c.stones > 1 ? 's' : ''} · ${c.gold}g · ${Math.round(enchantChance(lv) * 100)}%${lv >= 7 ? ' · failure drops a level' : ''}`}</em></div><div class="mk-act"><button class="btn small primary" data-ench="${esc(e.item)}" ${lv >= MAX_ENCHANT || count(inv, 'Enchant Stone') < c.stones || gold < c.gold ? 'disabled' : ''}>Enchant</button></div></div>`;
        const y = salvageYield(e.item);
        return `<div class="mk-row ${equipped && e.n < 2 ? 'locked' : ''}"><div class="mk-main"><b>${esc(nm(e.item))} ×${e.n}</b>${chip(e.item)}<em>→ ${y.map((x) => `${x.n}× ${x.item}`).join(', ')}</em></div><div class="mk-act"><button class="btn small" data-salv="${esc(e.item)}" ${equipped && e.n < 2 ? 'disabled' : ''}>Salvage</button></div></div>`;
      }).join('') || '<div class="qb-wait">No gear in your bag.</div>';
    }
    s.body.querySelectorAll<HTMLButtonElement>('[data-craft]').forEach((b) => (b.onclick = () => { b.disabled = true; o.craft(b.dataset.craft!); }));
    s.body.querySelectorAll<HTMLButtonElement>('[data-ench]').forEach((b) => (b.onclick = () => { b.disabled = true; o.enchant(b.dataset.ench!); }));
    s.body.querySelectorAll<HTMLButtonElement>('[data-salv]').forEach((b) => (b.onclick = () => { b.disabled = true; o.salvage(b.dataset.salv!); }));
  };
  render();
  return { close: s.close, update(i, g, e, q) { inv = i; gold = g; ench = e; eq = q; render(); } };
}

// ------------------------------------------------------------------ trade
export interface TradeUi { update(st: TradeView, inv: InvEntry[], gold: number): void; close(): void }
export function tradeWindow(o: { offer: (items: { item: string; n: number }[], gold: number) => void; lock: () => void; confirm: () => void; cancel: () => void; onClose: () => void }): TradeUi {
  const s = shell('trade', 'Trade', 'user', () => { o.cancel(); o.onClose(); });
  let st: TradeView | null = null, inv: InvEntry[] = [], gold = 0;
  const side = (title: string, of: TradeView['mine'], lock?: boolean, conf?: boolean) => `<div class="tr-side ${lock ? 'locked' : ''}"><div class="h">${esc(title)} ${conf ? '✓ confirmed' : lock ? '🔒 locked' : ''}</div>${of.items.map((i) => `<div class="tr-it">${esc(nm(i.item))} ×${i.n} ${chip(i.item)}</div>`).join('') || '<div class="tr-it dim">nothing yet</div>'}<div class="tr-g">${of.gold} gold</div></div>`;
  const render = () => {
    if (!st) return;
    s.gold.textContent = `${gold} gold`;
    (s.wrap.querySelector('.inv-head .t span') as HTMLElement).textContent = `Trade with ${st.with}`;
    const mine = st.mine;
    s.body.innerHTML = `<div class="tr-grid">${side('You give', mine, st.myLock, st.myConfirm)}${side(st.with + ' gives', st.theirs, st.theirLock, st.theirConfirm)}</div>
      <div class="h" style="margin:10px 2px 6px">Your bag — tap to add</div><div class="tr-bag">${inv.map((e) => `<button class="tr-add" data-add="${esc(e.item)}">${esc(nm(e.item))} ×${e.n}</button>`).join('')}</div>
      <div class="tr-row"><input class="tr-goldin" type="number" min="0" max="${gold}" value="${mine.gold}" placeholder="gold" /><button class="btn small" data-setgold>Set gold</button><button class="btn small" data-clear>Clear</button>
      <span style="flex:1"></span><button class="btn small" data-lock ${st.myLock ? 'disabled' : ''}>Lock</button><button class="btn small primary" data-confirm ${st.myLock && st.theirLock && !st.myConfirm ? '' : 'disabled'}>Confirm</button></div>`;
    const send = (items: { item: string; n: number }[], g: number) => o.offer(items, g);
    s.body.querySelectorAll<HTMLElement>('[data-add]').forEach((b) => (b.onclick = () => { const id = b.dataset.add!; const items = mine.items.map((x) => ({ ...x })); const ex = items.find((x) => x.item === id); const have = inv.find((x) => x.item === id)?.n ?? 0; if (ex) { if (ex.n < have) ex.n++; } else items.push({ item: id, n: 1 }); send(items, mine.gold); }));
    (s.body.querySelector('[data-setgold]') as HTMLElement).onclick = () => send(mine.items, Math.max(0, Math.floor(Number((s.body.querySelector('.tr-goldin') as HTMLInputElement).value) || 0)));
    (s.body.querySelector('[data-clear]') as HTMLElement).onclick = () => send([], 0);
    (s.body.querySelector('[data-lock]') as HTMLElement).onclick = () => o.lock();
    (s.body.querySelector('[data-confirm]') as HTMLElement).onclick = () => o.confirm();
    const gi = s.body.querySelector('.tr-goldin') as HTMLInputElement; gi.addEventListener('keydown', (e) => e.stopPropagation());
  };
  return { close: () => { s.wrap.remove(); o.onClose(); }, update(n, i, g) { st = n; inv = i; gold = g; render(); } };
}
/** A small glass toast: "<name> wants to trade" with Accept / Decline. */
export function tradeInvite(from: string, accept: () => void, decline: () => void) {
  const t = document.createElement('div');
  t.className = 'mk-invite';
  t.innerHTML = `<b>${esc(from)}</b> wants to trade<div><button class="btn small primary" data-a>Accept</button><button class="btn small ghost" data-d>Decline</button></div>`;
  document.getElementById('ui')!.appendChild(t);
  const done = () => t.remove();
  (t.querySelector('[data-a]') as HTMLElement).onclick = () => { done(); accept(); };
  (t.querySelector('[data-d]') as HTMLElement).onclick = () => { done(); decline(); };
  setTimeout(done, 30000);
}
