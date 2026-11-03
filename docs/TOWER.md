# The Hundredth Tower (Phase 4 · M5)

Enter at the **Gate of the Tower** (two pillars with a portal at the north end of *Foot of the Tower*, x 0, z −168). Walking between the pillars opens the floor picker: every floor up to one past your best is open.

## Floors
- 100 floors, each its own streamed zone (`f1` … `f100`), generated deterministically from its number by `src/shared/tower.ts` (`floorPlan`, `makeFloorZone`). Server and client build identical walls, doors, plates and seals.
- Layout: a grid of 24 m rooms (3×3 on floors 1–30, 4×3 to 60, 4×4 above) joined by a random spanning tree of doorways plus a few loops. The **Landing** (with a healing fountain and a portal back down) is the south-west room; the **Stairway** is the room farthest from it, behind a sealed doorway.
- Room templates: monster halls, spike-trap halls (plates rise for 1.15 s every 3.2 s and deal 12 % max HP), treasure vaults (a chest that pays once per climber per visit), and the gate room in front of the stairs.
- The seal on the stairway breaks when the gate room is solved:
  - **Chamber of Runes**: step on four symbol plates in the order the stele shows (a wrong rune resets the sequence and stings);
  - **Hall of Braziers**: stand by each of three braziers to light it, all three within 30 s;
  - **Trial Hall**: defeat every guardian in the room;
  - every tenth floor, the **Guardian's Arena**: defeat the floor guardian.
- Ten themes, one per band of ten floors (Verdant Halls, Sunken Ossuary, Ember Forge, Rime Vault, Storm Bastion, Mirror Labyrinth, Abyssal Sanctum, Clockwork Spire, Starlit Gallery, The Hundredth Sky), each with 3 monster types (30 total) built from the existing CC0 models.
- Monster level = 38 + 0.8 × floor (floor 1 ≈ Lv 39, floor 100 ≈ Lv 118).
- Floors spawn when someone enters and reset after 90 s with nobody on them.

## Guardians (floors 10 … 100)
Thornmaw, Warden of the First Gate · Vel'thar, the Ossuary King · Cindrax the Forge Tyrant · Glaciel, Queen of the Rime Vault · Voltaros the Storm Herald · The Mirrored Twin · Nyxaroth, the Abyss Eye · Chronarch, Keeper of Gears · Seraphine, the Fallen Star · Ascalon, the Hundredth Sky. Each has its own element, weakness, special moves and adds, and its own mythical (Ascalon: divine) item, guaranteed on the first clear and a 25 % drop afterwards.

## Rewards and records
- First clear of a floor: XP (150 + 60 × floor, ×3 on guardian floors), gold (30 × floor, ×3), a Rare gear piece of the floor's tier (Epic on guardian floors) and the guardian's item.
- Titles: Climber (10), Forgewalker (30), Halfway to the Sky (50), Keeper of Hours (80), The Hundredth Sky (100).
- Rankings (L) → **Hundredth Tower** tab: highest floor cleared; ties go to whoever got there first.

## Dev commands (local only)
`/gate`, `/floor N`, `/room landing|gate|stairs`, `/solve`, `/tpxy x z`.

Tests: `tests/unit/m5.test.ts` (all 100 floors: the stairs are unreachable while sealed and reachable once open, a flood fill over the real colliders; puzzles; boss seal; rewards; traps; leaderboard) and `tests/e2e/m5.mjs` (browser: gate → floor 1 → seal → stairs → floor 2 → floor 10 guardian → tower rankings).
