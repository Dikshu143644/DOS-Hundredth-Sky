# Game systems (Phase 4: the whole game)

This file grows one section per milestone. Everything listed here is implemented, server-authoritative and covered by tests.

## M1 · Core RPG

**Classes and skill kits** (`src/shared/skills.ts`, executed in `src/server/core/combat.ts`)

Every class has 4 skills (keys 1–4), an ultimate (R, level 12) and two advanced classes (level 20), each with its own signature skill (key 5).

| Class | 1 | 2 | 3 | 4 | Ultimate (R) | Advanced paths (5) |
|---|---|---|---|---|---|---|
| Warrior | Cleave | TERRA FRANGO · Earthsplitter | War Cry | Skyfall (leap) | RAGNAROK | Berserker: Blood Frenzy · Warlord: Banner of the Capital |
| Mage | IGNIS | FULGUR | GLACIES | VENTUS | CAELUM RUENS (meteor) | Archmage: INFERNUS · Chronomancer: TEMPUS |
| Archer | Piercing Arrow | Rain of Arrows | Hunter's Mark | Evasive Shot | VENTUS CENTUM | Sniper: Heartseeker · Ranger: Thorn Snare |
| Assassin | Shadowstep | Venom Fang | Smoke Veil | Fan of Knives | UMBRA MILLE | Shadowblade: Death Mark · Phantom: Void Blink |
| Knight | Shield Bash | Holy Guard | Challenge | Charge | SANCTUS MURUS (Aegis) | Paladin: Judgment · Guardian: Unbreakable |
| Summoner | ANIMA (spirit bolt) | LUPUS (wolf spirit) | VINCULA (chains) | SAXUM (stone golem) | PORTA ANTIQUA (ancient drake) | Spirit Lord: Pack Command · Void Caller: ABYSSUS |
| Healer | LUX | SANA (mend) | AQUA SANCTA | RADIUS (smite) | RENASCOR (mass revive) | Saint: Divine Barrier · Oracle: TEMPUS REDUX |

Skill kinds: projectile, strike, nova, cone, dash, buff, heal, summon. Effects: stun, root, slow, damage-over-time, knockback, mark (+damage taken), taunt, heal, heal-over-time, shields, buffs (attack/defence/magic/speed/crit/lifesteal), revive, cleanse.

**Elements and reactions.** All nine elements from the plan are used (Fire, Water, Wind, Earth, Lightning, Light, Darkness, Space, Time). Statuses combine: lightning on a *Soaked* target = CONDUCTED ×1.6, wind on *Burning* = FIRESTORM ×1.5, earth/physical on *Chilled* = SHATTER ×1.4, fire on *Chilled* = MELT, light on *Burning* = RADIANCE.

**Combat feel.** Basic attacks chain into combos (every third hit is a finisher: ×1.8 and a short stagger; skills landing inside a 3+ combo do +10 %). **Dodge roll** (Q) is part of the shared physics, so client prediction and the server agree exactly; it gives i-frames. **Parry** (V) opens a 0.38 s window: a melee hit inside it is turned back, the attacker is stunned and your next hits are guaranteed crits. Bosses telegraph specials with a danger zone, so dodging matters. **Weapon mastery** grows with every hit (up to 20 levels, +1.5 % damage each).

**Progression.** XP and levels (cap 60), 3 stat points per level (Strength, Intellect, Vitality, Agility, Spirit), 1 skill point per level (rank skills up to 5: +12 % power, −5 % cooldown per rank), advanced class at level 20 (permanent, with stat bonuses). Hero panel: **P**.

**Death without permadeath.** Falling costs 8 % of the level's XP (never a level) and 10 % of carried gold; you rise at your shrine *Soul-Weary* (−15 % damage dealt, +10 % taken) for 60 s. Healers can revive on the spot.

**Titles and reputation.** 16 titles (First Blood, Slayer, Iron Wall, Wind Dancer, Combo Artist, Bossbreaker, Weapon Master…) shown above your name; 7 factions (Capital, Forest Wardens, Mountain Kingdom, Sand Nomads, Frost Clans, Order of the Veil, Tower Climbers) from Hostile to Exalted.

Tests: `tests/unit/rpg.test.ts` (kits, rules, dodge determinism, parry, points, advanced class, death penalty, summons, heals, reactions) and `tests/e2e/m1.mjs` (a real browser plays it).
