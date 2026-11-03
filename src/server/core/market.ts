/** Phase 4 · M4: the market — crafting, enchanting, salvage, consumables, town shops and
 *  player-to-player trading. Every change to an inventory happens here, on the server. */
import type { Game, Player } from './game';
import { ITEMS, addItem, rarityOf } from '../../shared/items';
import { RECIPES, craft, enchant, enchantCost, MAX_ENCHANT, salvageYield, removeItem, count, CONSUMABLES, SHOPS, shopStock, sellPrice, validOffer, settleTrade, type TradeOffer } from '../../shared/economy';
import { REGIONS } from '../../shared/regions';
import { npcByKey } from './npcdefs';

interface Trade { a: number; b: number; offer: Record<number, TradeOffer>; lock: Record<number, boolean>; confirm: Record<number, boolean>; started: number }

export class Market {
  private trades = new Map<number, Trade>(); // player id → trade
  private invites = new Map<number, { from: number; at: number }>(); // target → inviter
  constructor(private g: Game) {}

  private sendInv(p: Player) { p.conn?.send({ type: 'inv', inventory: p.char.inventory, gold: p.char.gold, enchant: p.char.enchant ?? {}, equipment: (p.char.equipment ?? {}) as Record<string, string> } as any); this.g.markDirty(); }
  private say(p: Player, text: string, style: 'info' | 'warn' | 'rank' = 'info') { p.conn?.send({ type: 'notice', text, style }); }
  private inTown(p: Player) { const t = REGIONS[p.zone as 'capital']?.town; return !!t && Math.hypot(p.s.x - t.x, p.s.z - t.z) < t.r + 14; }
  private nearNpc(p: Player, key: string, r = 8) { for (const e of this.g.ents.values()) if (e.type === 'n' && (e as any).def.key === key && e.zone === p.zone && Math.hypot(e.s.x - p.s.x, e.s.z - p.s.z) < r) return true; return false; }
  private freeCount(p: Player, id: string) { return count(p.char.inventory, id) - Object.values(p.char.equipment ?? {}).filter((x) => x === id).length; }

  // ------------------------------------------------------------------ crafting
  craft(p: Player, id: string) {
    const rc = RECIPES.find((r) => r.id === id);
    if (!rc) return this.say(p, 'Unknown recipe.', 'warn');
    if (!this.inTown(p)) return this.say(p, 'You need a town forge to craft. Visit any town.', 'warn');
    const r = craft(rc, p.char.inventory.filter((e) => true), p.char.gold, this.g.rand());
    if ('error' in r) return this.say(p, `Can't craft: ${r.error}.`, 'warn');
    p.char.inventory = r.inv; p.char.gold = r.gold;
    const d = ITEMS[r.out];
    this.say(p, `Crafted ${d?.name ?? r.out} (${rarityOf(d?.rarity ?? 'common').name}).`, d && ['epic', 'divine'].includes(d.rarity) ? 'rank' : 'info');
    if (d?.rarity === 'divine') this.g.broadcastAll({ type: 'chat', from: 'World', text: `${p.name} forged the divine ${d.name}!`, channel: 'world' });
    this.sendInv(p);
  }
  enchant(p: Player, id: string) {
    const d = ITEMS[id];
    if (!d?.slot || count(p.char.inventory, id) < 1) return this.say(p, 'Choose a piece of gear you own.', 'warn');
    if (!this.inTown(p)) return this.say(p, 'Enchanting needs a town forge.', 'warn');
    const ench = (p.char.enchant ??= {}); const lvl = ench[id] ?? 0;
    if (lvl >= MAX_ENCHANT) return this.say(p, 'Already at +10.', 'warn');
    const c = enchantCost(lvl);
    if (count(p.char.inventory, 'Enchant Stone') < c.stones || p.char.gold < c.gold) return this.say(p, `Enchanting to +${lvl + 1} needs ${c.stones} Enchant Stone${c.stones > 1 ? 's' : ''} and ${c.gold} gold.`, 'warn');
    p.char.inventory = removeItem(p.char.inventory, 'Enchant Stone', c.stones); p.char.gold -= c.gold;
    const r = enchant(lvl, this.g.rand()); ench[id] = r.lvl;
    this.say(p, r.ok ? `${d.name} is now +${r.lvl}!` : r.lvl < lvl ? `The enchantment cracked — ${d.name} fell to +${r.lvl}.` : `The enchantment failed. ${d.name} stays +${lvl}.`, r.ok ? 'rank' : 'warn');
    this.g.refreshStats(p);
    this.sendInv(p);
  }
  salvage(p: Player, id: string) {
    const y = salvageYield(id);
    if (!y.length || this.freeCount(p, id) < 1) return this.say(p, 'Nothing to salvage (unequip it first).', 'warn');
    if (['legendary', 'mythical', 'divine', 'unique'].includes(ITEMS[id]!.rarity) && !(p as any).confirmSalvage?.[id]) { ((p as any).confirmSalvage ??= {})[id] = true; return this.say(p, `${ITEMS[id]!.name} is ${ITEMS[id]!.rarity}. Salvage again to confirm.`, 'warn'); }
    p.char.inventory = removeItem(p.char.inventory, id, 1);
    for (const x of y) p.char.inventory = addItem(p.char.inventory, x.item, x.n ?? 1);
    if (count(p.char.inventory, id) === 0 && p.char.enchant) delete p.char.enchant[id];
    this.say(p, `Salvaged into ${y.map((x) => `${x.n}× ${x.item}`).join(', ')}.`);
    this.sendInv(p);
  }
  use(p: Player, id: string, now: number) {
    const c = CONSUMABLES[id];
    if (!c || count(p.char.inventory, id) < 1) return;
    if (now < ((p as any).potCd ?? 0)) return this.say(p, 'Not yet — your last draught is still settling.', 'warn');
    (p as any).potCd = now + c.cd;
    p.char.inventory = removeItem(p.char.inventory, id, 1);
    if (c.hp) p.hp = Math.min(p.mhp, p.hp + p.mhp * c.hp);
    if (c.mp) p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.maxMp * c.mp);
    this.g.broadcastNear(p.s.x, p.s.z, 100, { type: 'fx', kind: 'heal', src: p.id, dst: p.id, x: p.s.x, y: p.s.y, z: p.s.z });
    this.sendInv(p);
  }

  // ------------------------------------------------------------------ shops
  private day() { return Math.floor(Date.now() / 86400000); }
  openShop(p: Player, npc: string) {
    if (!SHOPS[npc]) return;
    if (!this.nearNpc(p, npc)) return this.say(p, 'Walk up to the merchant first.', 'warn');
    const sell: Record<string, number> = {};
    for (const e of p.char.inventory) if (ITEMS[e.item]) sell[e.item] = sellPrice(e.item);
    p.conn?.send({ type: 'shop', npc, name: SHOPS[npc].name, keeper: npcByKey(npc)?.name ?? npc, stock: shopStock(npc, this.day()), sell } as any);
  }
  buy(p: Player, npc: string, id: string, n = 1) {
    n = Math.max(1, Math.min(20, Math.floor(n)));
    const line = shopStock(npc, this.day()).find((s) => s.item === id);
    if (!line || !this.nearNpc(p, npc)) return this.say(p, 'That is not for sale here.', 'warn');
    const cost = line.price * n;
    if (p.char.gold < cost) return this.say(p, `Not enough gold (${cost} needed).`, 'warn');
    p.char.gold -= cost; p.char.inventory = addItem(p.char.inventory, id, n);
    this.say(p, `Bought ${n}× ${ITEMS[id]?.name ?? id} for ${cost} gold.`);
    this.sendInv(p); this.openShop(p, npc);
  }
  sell(p: Player, npc: string, id: string, n = 1) {
    n = Math.max(1, Math.floor(n));
    if (!SHOPS[npc] || !this.nearNpc(p, npc)) return this.say(p, 'Find a merchant to sell to.', 'warn');
    if (this.freeCount(p, id) < n) return this.say(p, 'You can\'t sell what you are wearing.', 'warn');
    if (['divine', 'unique'].includes(ITEMS[id]?.rarity ?? '')) return this.say(p, 'No merchant can afford that.', 'warn');
    const gain = sellPrice(id) * n;
    p.char.inventory = removeItem(p.char.inventory, id, n); p.char.gold += gain;
    if (count(p.char.inventory, id) === 0 && p.char.enchant) delete p.char.enchant[id];
    this.say(p, `Sold ${n}× ${ITEMS[id]?.name ?? id} for ${gain} gold.`);
    this.sendInv(p); this.openShop(p, npc);
  }

  // ------------------------------------------------------------------ player trading
  private tradeOf(p: Player) { return this.trades.get(p.id); }
  private other(t: Trade, p: Player) { return this.g.players.get(t.a === p.id ? t.b : t.a); }
  private push(t: Trade, msg?: string) {
    for (const id of [t.a, t.b]) {
      const me = this.g.players.get(id), them = this.g.players.get(id === t.a ? t.b : t.a);
      if (!me || !them) continue;
      me.conn?.send({ type: 'trade', state: { with: them.name, mine: t.offer[id], theirs: t.offer[them.id], myLock: t.lock[id], theirLock: t.lock[them.id], myConfirm: t.confirm[id], theirConfirm: t.confirm[them.id] }, msg } as any);
    }
  }
  private end(t: Trade, msg: string) {
    for (const id of [t.a, t.b]) { this.trades.delete(id); this.g.players.get(id)?.conn?.send({ type: 'trade', state: null, msg } as any); }
  }
  request(p: Player, target: Player | undefined) {
    if (!target || target.type !== 'p' || target.id === p.id) return this.say(p, 'No such adventurer nearby.', 'warn');
    if (target.zone !== p.zone || Math.hypot(target.s.x - p.s.x, target.s.z - p.s.z) > 12) return this.say(p, `${target.name} is too far away to trade.`, 'warn');
    if (this.trades.has(p.id) || this.trades.has(target.id)) return this.say(p, 'One of you is already trading.', 'warn');
    this.invites.set(target.id, { from: p.id, at: this.g.o.now() });
    target.conn?.send({ type: 'tradeInvite', from: p.name, id: p.id } as any);
    this.say(p, `Trade request sent to ${target.name}.`);
  }
  accept(p: Player) {
    const inv = this.invites.get(p.id); this.invites.delete(p.id);
    const from = inv && this.g.o.now() - inv.at < 60 ? this.g.players.get(inv.from) : undefined;
    if (!from || this.trades.has(from.id) || this.trades.has(p.id)) return this.say(p, 'That trade request expired.', 'warn');
    const t: Trade = { a: from.id, b: p.id, offer: { [from.id]: { items: [], gold: 0 }, [p.id]: { items: [], gold: 0 } }, lock: {}, confirm: {}, started: this.g.o.now() };
    this.trades.set(from.id, t); this.trades.set(p.id, t);
    this.push(t, 'Trade opened.');
  }
  offer(p: Player, o: TradeOffer) {
    const t = this.tradeOf(p); if (!t) return;
    const clean: TradeOffer = { items: (Array.isArray(o?.items) ? o.items : []).slice(0, 12).map((x) => ({ item: String(x.item), n: Math.floor(Number(x.n)) })), gold: Math.floor(Number(o?.gold) || 0) };
    const v = validOffer(clean, p.char.inventory, p.char.equipment ?? {}, p.char.gold);
    if (!v.ok) return this.say(p, `Offer refused: ${v.reason}.`, 'warn');
    t.offer[p.id] = clean; t.lock = {}; t.confirm = {}; // any change unlocks both sides
    this.push(t);
  }
  lock(p: Player) { const t = this.tradeOf(p); if (!t) return; t.lock[p.id] = true; this.push(t); }
  confirm(p: Player) {
    const t = this.tradeOf(p); if (!t) return;
    if (!t.lock[t.a] || !t.lock[t.b]) return this.say(p, 'Both sides must lock their offers first.', 'warn');
    t.confirm[p.id] = true;
    if (!(t.confirm[t.a] && t.confirm[t.b])) return this.push(t);
    const A = this.g.players.get(t.a), B = this.g.players.get(t.b);
    if (!A || !B) return this.end(t, 'Trade cancelled.');
    if (A.zone !== B.zone || Math.hypot(A.s.x - B.s.x, A.s.z - B.s.z) > 14) return this.end(t, 'Trade cancelled: you moved too far apart.');
    const r = settleTrade({ inv: A.char.inventory, eq: A.char.equipment ?? {}, gold: A.char.gold, offer: t.offer[A.id] }, { inv: B.char.inventory, eq: B.char.equipment ?? {}, gold: B.char.gold, offer: t.offer[B.id] });
    if ('error' in r) return this.end(t, `Trade failed: ${r.error}.`);
    A.char.inventory = r.a.inv; A.char.gold = r.a.gold; B.char.inventory = r.b.inv; B.char.gold = r.b.gold;
    // enchant levels travel with the item
    for (const it of t.offer[A.id].items) moveEnchant(A, B, it.item);
    for (const it of t.offer[B.id].items) moveEnchant(B, A, it.item);
    this.end(t, 'Trade complete!');
    this.sendInv(A); this.sendInv(B);
    this.g.worldEvent(`${A.name} and ${B.name} traded`);
  }
  cancel(p: Player) { const t = this.tradeOf(p); if (t) this.end(t, `${p.name} cancelled the trade.`); this.invites.delete(p.id); }
  onLeave(p: Player) { this.cancel(p); }
}
function moveEnchant(from: Player, to: Player, id: string) {
  const lv = from.char.enchant?.[id]; if (!lv) return;
  (to.char.enchant ??= {})[id] = Math.max(to.char.enchant[id] ?? 0, lv);
  if (count(from.char.inventory, id) === 0) delete from.char.enchant![id];
}
