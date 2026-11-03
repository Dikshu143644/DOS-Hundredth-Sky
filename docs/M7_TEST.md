# M7 · full test (Phase 4)

Run on 2026-11-03 against a local build of `main` (the same build that was published).

## 1. Bots play the game (protocol level)
`npx tsx tests/e2e/m7bots.ts ws://localhost:8787/ws 4 10` (needs a server with `DOS_DEV=1`).
Four WebSocket clients play the way the browser does: 60 Hz movement inputs, attacks and class skills by target id, potions, equipping gear from the bag. The only shortcuts are the documented dev commands for travel (`/zone`, `/gate`) and levelling/gear (`/xp`, `/give`); everything inside the Tower is real play: A* over the floor's real colliders, rune order read from the stele, standing at braziers, fighting trial guardians and the floor-10 guardian, walking onto the stairway.
Flow per bot: New Game (register, create character, prologue skipped) → kill monsters in Ancient Forest, Frostpeak, Sunscorch Desert, Frozen Wastes → walk to the Gate of the Tower → floor picker → floors 1–10.

Result (4 bots, Lv 60, Epic gear):
```
Clmk3cy0 (warrior Lv 60): regions [forest:2 kills, mountain:2 kills, desert:2 kills, frozen:2 kills] · floors cleared 10/10 · 1:runes:57s 2:runes:67s 3:braziers:63s 4:runes:67s 5:braziers:47s 6:runes:76s 7:runes:71s 8:braziers:69s 9:trial:48s 10:guardian:217s · kills 42 · deaths 0
Clmk3cy1 (knight Lv 60): regions [forest:2 kills, mountain:2 kills, desert:2 kills, frozen:2 kills] · floors cleared 10/10 · 1:runes:19s 2:runes:44s 3:braziers:60s 4:runes:68s 5:braziers:48s 6:runes:76s 7:runes:71s 8:braziers:69s 9:trial:48s 10:guardian:194s · kills 25 · deaths 0
Clmk3cy2 (warrior Lv 60): regions [forest:3 kills, mountain:2 kills, desert:2 kills, frozen:2 kills] · floors cleared 10/10 · 1:runes:40s 2:runes:71s 3:braziers:62s 4:runes:67s 5:braziers:50s 6:runes:72s 7:runes:74s 8:braziers:67s 9:trial:48s 10:guardian:194s · kills 32 · deaths 0
Clmk3cy3 (knight Lv 60): regions [forest:2 kills, mountain:2 kills, desert:2 kills, frozen:2 kills] · floors cleared 10/10 · 1:runes:19s 2:runes:61s 3:braziers:66s 4:runes:63s 5:braziers:47s 6:runes:76s 7:runes:71s 8:braziers:82s 9:trial:80s 10:guardian:172s · kills 29 · deaths 0
total 890 s · M7 BOTS OK
```
All four cleared floors 1–10 with no deaths; ~1 minute per puzzle floor, ~3 minutes for Thornmaw.
Before the balance pass a lone bot died twice in the floor-9 trial, so hall monsters now have 60 % HP and trial guardians 80 % (see docs/TOWER.md).

## 2. Browser playthrough + performance
`node tests/e2e/m7play.mjs spawn <outDir> low,medium,high` (spawns its own server with 3 adventurer bots). For each preset: New Game in a fresh browser → Capital → Ancient Forest → Sunscorch Desert → Frozen Wastes → Foot of the Tower → Gate → floor 1 → floor 10 (guardian), 6 s of walking per scene. 0 console errors at every preset.

**This box has no GPU**: Chrome renders through SwiftShader (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`) on 4 CPU cores at 1600×900. Two numbers are reported per scene:
- *paced fps*: what the page's own fps counter reads. Headless Chrome paces frames at ~10–12 Hz here at every preset, so this is a ceiling of the test machine, not of the game.
- *frame cost*: one fully synchronised frame (render + `readPixels`, so the CPU rasteriser has to finish). This is CPU rasterisation, so compare presets against each other; real GPU fps was **not** measured.

| preset | paced fps (avg over scenes) | frame cost per scene (paced fps / ms) | New Game → in world |
|---|---|---|---|
| Low | 11.1 | Capital: 9.8 / 738 ms | forest: 12.5 / 964 ms | desert: 12.1 / 586 ms | frozen: 10.3 / 594 ms | Foot of the Tower: 12.2 / 699 ms | Tower floor 1: 10.7 / 361 ms | Tower floor 10 (guardian): 10.3 / 302 ms | 15.8 s |
| Medium | 11.5 | Capital: 8.5 / 927 ms | forest: 13.2 / 1499 ms | desert: 12.2 / 614 ms | frozen: 11.4 / 688 ms | Foot of the Tower: 12.2 / 952 ms | Tower floor 1: 10.9 / 558 ms | Tower floor 10 (guardian): 12.1 / 543 ms | 26.2 s |
| High | 11.3 | Capital: 6.1 / 2270 ms | forest: 10 / 3827 ms | desert: 12.7 / 1249 ms | frozen: 10.4 / 1611 ms | Foot of the Tower: 14.6 / 2031 ms | Tower floor 1: 12.2 / 1128 ms | Tower floor 10 (guardian): 13 / 1092 ms | 27.4 s |

On the CPU rasteriser, Medium costs ~1.4× Low and High ~3× Low; the forest (grass + trees) is the heaviest scene and Tower floors the lightest.

## 3. Menu load
Cold browser, local server: 1308, 1227, 1370 ms to an interactive title menu (target < 2 s). The live site measurement is in the M7 report (it is ~1 s warm; the first one or two loads right after a publish are slower while the edge cache fills).
