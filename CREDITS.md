# Credits & Licences

Every third-party asset in this repository, with its source and licence. The game ships nothing else.

## 3D models

| Asset | Author | Source | Licence | Used for |
|---|---|---|---|---|
| KayKit Adventurers (Knight, Mage, Rogue, Rogue_Hooded, Barbarian, plus animations) | Kay Lousberg | https://kaylousberg.itch.io/kaykit-adventurers · https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | CC0 1.0 | player classes, NPCs (`public/assets/models/chars/`) |
| KayKit Skeletons (Minion, Warrior, Mage, plus animations) | Kay Lousberg | https://kaylousberg.itch.io/kaykit-skeletons | CC0 1.0 | monsters |
| Ultimate Stylized Nature pack (trees, pines, birches, dead trees, rocks, bushes, grass, flowers, plus their textures) | Quaternius | https://quaternius.com/packs/ultimatestylizednature.html (FBX taken from the MIT-licensed mirror https://github.com/walterpalladino/godot-quaternius-ultimate-stylized-nature) | CC0 1.0 | forest, foliage, rocks (`public/assets/models/nature/`, `public/assets/tex/q_*`) |

Models were converted and optimised with the tools in `tools/` (`fbx2glb.mjs`, `prune.mjs`) and with glTF-Transform.

## Textures (PBR, 1k)

All from **Poly Haven** (https://polyhaven.com), **CC0 1.0**:

| File prefix | Poly Haven asset |
|---|---|
| `grass_*` | aerial_grass_rock |
| `forest_*` | forrest_ground_01 |
| `rock_*` | rock_face |
| `cobble_*` | cobblestone_floor_08 |
| `brick_*` | castle_wall_slates |
| `roof_*` | roof_tiles_14 |
| `wood_*` | wood_planks |
| `sand_*` | coast_sand_rocks_02 |

## Fonts

| Font | Designer | Licence |
|---|---|---|
| Cinzel | Natanael Gama | SIL Open Font License 1.1 |
| Cormorant Garamond | Christian Thalmann | SIL Open Font License 1.1 |
| Rajdhani | Indian Type Foundry | SIL Open Font License 1.1 |

Served from `public/assets/fonts/`, obtained from Google Fonts.

## Audio

No audio files. The score, ambience (wind, birds, rain, thunder), UI sounds and spell sounds are synthesised in real time with the Web Audio API (`src/client/audio.ts`). Spell chants use the browser's built-in speech synthesis.

## Libraries

| Library | Licence |
|---|---|
| three.js (and its examples: Sky, Water, post-processing passes, GLTFLoader, meshopt decoder) | MIT |
| ws | MIT |
| Vite, esbuild, TypeScript, Vitest, tsx, Playwright, glTF-Transform | MIT / Apache-2.0 |

## Original work

The logo, UI, world layout, Tower, city, lore text, incantations, NPC personalities, quest system, netcode, physics and all game code were written for this project.
The setting, names and lore come from Omkar Supe's *DOS: The Hundredth Sky* Game Design Document.

## Phase 2 — realism upgrade

- **Realistic heroes**: Quaternius *Universal Base Characters* bodies with *Modular Fantasy* outfits (Knight, Ranger, Wizard, Noble, Peasant; masculine and feminine) and the *Universal Animation Library* clips (idle, walk, jog, sprint, jump, sword attacks, spell cast, death, swim…). © Quaternius, **CC0 1.0** — https://quaternius.com. Files taken from the MIT-licensed project `benjamincanac/avelune` (https://github.com/benjamincanac/avelune), re-compressed with meshopt (gltf-transform).
- **Sky HDRI**: *Kloofendal 48d Partly Cloudy (Pure Sky)* by Greg Zaal, Poly Haven, **CC0 1.0** — https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
- **Sky-castle login, legendary weapons (Frostfang, Ignis, Umbra Twins, Aether Orb Staff, Sol Aurelia, Skyreach), armory floor, spell VFX**: built procedurally in code for this project (geometry, shaders and canvas textures; no third-party assets, no AI-generated images).
- **Fonts**: Cinzel / Cormorant Garamond (SIL Open Font License 1.1), as in phase 1.

## Phase 4 · M2 (regions)

- **Monsters**: Quaternius "Ultimate Monsters", "Animated Monster Pack" and "Ultimate Animated Animals" (wolf, yeti, mushnub, goleling, orc, ghost, ghost skull, demons, squidle, hywirl, mushroom king, spiky blob, glub, dragon (evolved), bat, snake, spider, wasp, dragon, dino, tribal, ninja, armabee, alien) by **Quaternius** (https://quaternius.com, via https://poly.pizza) — **CC0 1.0** public domain. Unused clips removed and meshes meshopt-compressed with `tools/monsters.mjs`. Copies were taken from CC0 mirrors in the open-source repos travism26/frostmark, cLLeB/Depth-Of-The-Forgotten-King, g0ddest/renethack and JieeiroSst/Knight-of-the-Garden; each states the Quaternius CC0 licence.
- **Textures**: "Snow 02" and "Aerial Rocks 04" from **Poly Haven** (https://polyhaven.com) — **CC0 1.0**. Re-encoded to WebP (1024²).

## UI
- **Lucide icons** (https://lucide.dev), ISC licence: inline line icons in `src/client/ui/icons.ts`.
- **Inter** typeface by Rasmus Andersson (https://rsms.me/inter), SIL Open Font Licence 1.1, via Fontsource.

## POLISH-1 (bosses + Tower interiors)

- **Boss models** (the ten Tower guardians Thornmaw, Vel'thar, Cindrax, Glaciel, Voltaros, the Mirrored Twin, Nyxaroth, Chronarch, Seraphine, Ascalon; the world bosses Gorrath, Vyrnax, the Hollow Mother; the raid boss Kaelthar): built procedurally in code for this project (`src/client/engine/bossrig.ts`: tapered/noise-displaced geometry on named joints, canvas-generated normal/roughness/vein maps, baked AnimationClips). No third-party models, no AI-generated images.
- **Tower interiors** (`src/client/engine/floortheme.ts`): vaults, ribs, upper walls, windows, props, particles and world-space surface overlays are procedural; surface textures are the existing Poly Haven CC0 sets already listed above.
