# Items & Economy (Phase 4 · M4)

Code: `src/shared/items.ts` (rarities, slots, legendaries), `src/shared/economy.ts` (all rules, pure), `src/server/core/market.ts` (server), `src/client/ui/market.ts` + `inventory.ts` (UI).

## Rarity
Common · Uncommon · Rare · Epic · Legendary · Mythical · Divine · **Unique**.

| Source | Rarities |
|---|---|
| Generated gear: 11 kinds (sword, axe, daggers, bow, staff, cuirass, helm, gauntlets, greaves, ring, amulet) × 7 tiers (Copper → Skyforged, one per region) | Common – Epic |
| The original legendaries (Frostfang, Ignis, Umbra Twins, Aether Staff, Sol Aurelia, Skyreach) | Epic – Divine |
| Boss mythicals: one per field boss, 25 % drop | Mythical |
| Aurelia's Tear, Halo of the First Climber: crafted from every region's rarest material | Divine |
| Crown of the Hundredth Sky: reward of the hidden chain "Keeper of the Hundredth Sky"; one per character | Unique |

## Loot tables (`rollDrops`)
- Region materials: common 55 %, uncommon 22 %, rare 5 % (bosses always drop the rare one).
- Gear: 12 % chance per kill; tier follows the monster's level; rarity rolls 60/28/10/2 %.
- Bosses: 2 gear drops (Rare or Epic) + an Enchant Stone + a 25 % chance at their mythical.
- Also potions, Enchant Stones, and the old capital loot and legendary rolls.

## Crafting (C → Craft, in any town)
Tier T gear = 4× and 2× of that tier's region materials + 25·T gold → **Rare**, with a 25 % chance of **Epic** ("Heroic"). Potions and elixirs are crafted too, and there are 2 divine recipes.

## Enchanting (C → Enchant)
+1 … +10, each level +6 % to the item's stats. Cost: Enchant Stones + gold. Success is 100 % up to +3, then 10 % lower per level (minimum 25 %). A failure keeps the level, except from +7 up, where it drops one level. Salvage (C → Salvage) turns gear into Mana Dust (and Enchant Stones for Rare+). Equipped copies are protected.

## Shops
Each region has a merchant (Sela, Tobb, Gunda, Omar, Eira, Vex, Juna). Talk to them → **Browse goods**. They sell potions, stones and 8 pieces of their tier's gear, rotating daily, and buy at 40 %. Divine and Unique items can't be sold.

## Player trading
Use `/trade <name>` (within 12 m); the other player sees an Accept/Decline toast. Both sides build offers (items + gold), lock, and confirm. Any change unlocks both sides. The server re-validates at settlement: ownership, equipped items, gold and distance. The swap is atomic and enchant levels travel with the item.

Simplification: enchant level is stored per item *type* per character (copies of the same item share it).
