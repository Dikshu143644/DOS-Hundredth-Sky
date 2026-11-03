# Story · The Reincarnation Prologue

> *"Your life on Earth has ended, but your story has not."* — Aurelia, Keeper of the Hundred Skies

DOS: The Hundredth Sky opens like an isekai anime: an ordinary life ends, a soul wakes in the void between worlds, a goddess grants it a gift no one else has, and it is reborn beneath a tower with a hundred floors.

## Flow (New Game)

| Beat | What the player sees | Where in code |
|---|---|---|
| **Act I · An ordinary life** | Rainy city street at 11:47 PM. A tired office worker walks home under street lamps. Captions: *"11:47 PM. Another overtime night." · "Another ordinary day, in an ordinary life." · "If I could start over… just once…"* Headlights, a horn, white. Skippable (`Skip ›`, `Esc`, `Space`). | `src/client/scenes/prologue.ts` (`buildLife`, `updateLife`) |
| **Darkness** | Black. *"…" · "Is this… what dying feels like?"* | `endLife()` |
| **Between worlds** | A violet nebula void with stars, rising motes of light and a turning rune circle (the nine element kanji + 禁). The new body takes shape as a pale soul while the player picks a name, class and look (the create screen, over the void). | `buildVoid()`, `setSoul()`, `showCreate(true)` in `main.ts` |
| **The Goddess** | Aurelia, a figure of light with a halo and wings, rises above the rune circle and speaks. Dialogue box with typed text and a badge: **AI · remembers you** (Gemini) or **scripted** (fallback). The player can type to her at any time. | `src/client/ui/prologue.ts`, server `src/server/core/origin.ts` |
| 1. Past life | *"Who were you, before the light took you?"* Pick one of five or type your own. She remembers it. | step `pastlife` |
| 2. Unique Skill (cheat) | Three of eight gifts are offered (seeded per soul, so a reload offers the same three). | step `cheat` |
| 3. Path | Confirm or change the class (7). Changing re-kits the hero server-side. | step `class` |
| 4. Affinity | Ten orbs: Fire 火, Water 水, Wind 風, Earth 土, Lightning 雷, Light 光, Darkness 闇, Space 空, Time 時, and **FORBIDDEN 禁** (asks twice: strong, but it costs). | step `affinity` |
| **Status window** | The anime blue holographic STATUS panel: name, race (Human · Reincarnated), class, level, adventurer rank with guild points, title, power, HP/MP/ATK/MAG/DEF/CRIT, Unique Skill, Affinity. **AWAKEN**. | `src/client/ui/status.ts` |
| **Rebirth** | Her last line, a white fade, and the hero wakes in the Capital at Lv 1 with the title *Reincarnated*. | step `finish`, client re-joins |

A soul in the prologue is in the world but **hidden**: other players do not see it and monsters ignore it. `Skip prologue ›` gives the first offered cheat and a class-fitting affinity.

## Unique Skills (cheats)

| Skill | 日本語 | Effect |
|---|---|---|
| Great Sage | 大賢者 | +10% crit · weaknesses hit ×1.8 instead of ×1.5 |
| Predator | 捕食者 | 5% of damage dealt heals you · +15% XP |
| Mana Overflow | 魔力無限 | +40% max MP · +60% mana regeneration |
| Return by Death | 死に戻り | once every 10 min a killing blow leaves you at 30% HP |
| Shadow Monarch | 影の君主 | 15% chance a defeated monster rises as your shadow for 30 s |
| Sword Saint | 剣聖 | +20% attack · finishers hit twice as hard |
| Dragon Heart | 竜の心臓 | +25% max HP · 4% HP/s regeneration out of combat |
| Lucky Star | 幸運の星 | +30% gold · +5% crit |

## Affinity

+15% damage with your element, −15% taken from it. **Forbidden**: +25% magic, every element fuses into a CHAOS spell; the cost is −15% max HP forever and −20 Capital reputation (the Capital distrusts you).

## Skill Fusion (Status window, `U`)

Fuse your affinity with another element into a stronger skill. Slots unlock with level: **1 at Lv 5, 2 at Lv 15, 3 at Lv 30**. Fused skills go on `G` · `H` · `N`.

| Fusion | Name | Effect |
|---|---|---|
| Water + Lightning | **TEMPESTAS** · Storm Sovereign | soaks and electrocutes everything around you |
| Fire + Wind | INFERNO CYCLONE · Firestorm | burning whirlwind |
| Fire + Earth | MAGMA · Molten Earth | lava under enemies, burns and slows |
| Water + Wind | GLACIES VORTEX · Blizzard | freezing gale, heavy slow |
| Fire + Lightning | PLASMA · Star Lance | armour-piercing lance, marks the target |
| Earth + Water | PALUS · Quagmire | roots and soaks |
| Wind + Lightning | TONITRUS · Thunderclap | knock-back shockwave + stun |
| Light + Darkness | CREPUSCULUM · Twilight | pure damage |
| Space + Time | SINGULARITAS · Singularity | everything stops (2 s stun) |
| Light + Fire | SOL INVICTUS · Solar Flare | heals allies, burns the wicked |
| Darkness + Space | ABYSSUS MAGNUS · Event Horizon | drags enemies in, slows and marks |
| Earth + Lightning | MAGNETAR · Iron Tempest | shredding stone shards |
| Time + Light | AURORA AETERNA · Eternal Dawn | party heal over time |
| Forbidden + any | CHAOS ⟨element⟩ · Forbidden Chaos | huge damage over time |

## Stakes (no permadeath)

Falling in battle costs, on top of the XP and 10% gold loss:

- **Adventurer rank points** (5%, at least 10): ranks can be **lost** (demotion). A fresh promotion is protected for 10 minutes.
- **A lasting injury** (40% chance, 80% in the Forbidden Territory), real time: Broken Arm (−15% attack, 15 min), Cracked Ribs (−15% max HP, 15 min), Concussion (−30% mana regen, −10% magic, 10 min), Twisted Ankle (−10% speed, 10 min), Haunted (−10% everything, 20 min, Forbidden Territory only). Shown in the Status window.
- **A lost item** (25%): one unequipped, non-potion item is gone.
- **Reputation** −3 with the Capital, and the death is written into the hero's **deeds**, which the AI NPCs read: people remember your failures.
- Soul-Weary for 60 s, respawn at your last shrine.

## Adventurer rank F → SSS and the power leaderboard (`L`)

| Rank | F | E | D | C | B | A | S | SS | SSS |
|---|---|---|---|---|---|---|---|---|---|
| Guild points | 0 | 100 | 300 | 700 | 1,500 | 3,000 | 6,000 | 12,000 | 25,000 |

Points come from monsters near your level (more for stronger ones), field bosses (60 + 4 per level above you) and quests. Promotions to S and above are announced to the whole server. Levels are continuous (no cap). The **power score** combines level, stats, crit and rank; the Rankings panel shows the top 20 adventurers and your place.

## The Goddess as an AI NPC

Aurelia runs on the same server-side LLM gate as the other important NPCs (Gemini on the live shard; key only on the server). Her prompt carries the moment, the soul's new name, the past life they told her, the gift, the path, the element and her notes about them (*past life: …*, *chose the gift …*, *said: …*), and she must answer as JSON `{"say": "…"}` in ≤45 words. If the model is busy or offline the scripted line for that moment is used and the badge says **scripted**. Tests: `tests/unit/origin.test.ts` (mock LLM + fallback), `tests/e2e/prologue.mjs` (the whole flow in a browser).
