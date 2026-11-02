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
