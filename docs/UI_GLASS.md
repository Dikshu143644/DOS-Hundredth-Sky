# Spatial glass UI (visionOS-style)

All UI is one material, defined in `src/client/ui/glass.css` (tokens at the top, the "visionOS SPATIAL LAYER" at the end):

- **Light, clear glass**: white fill (10–20 %) with a top-to-bottom white gradient and a soft specular highlight along the top edge; backdrop blur 14–20 px, saturate 180 %, a slight luminance drop so white text stays legible over bright ground.
- **Rim + depth**: 1 px bright rim on top (≈ 0.42 white), faint at the bottom (≈ 0.10), soft drop shadow so panels float over the world.
- **No navy / indigo / violet** anywhere in UI CSS or canvas UI. Colour is used only for small element/rarity badges, HP/MP/XP bars and status dots.
- **Text**: white 96 % primary, 74 % secondary, with a faint text shadow.
- **Buttons**: neutral glass pills; primary = brighter white glass; selected = brightest white glass. Tab bars and segmented controls are floating "ornament" pills; icon buttons are circular glass.
- **Bright scenes** (snow, desert, noon; `body.bright`): stronger blur and a deeper text shadow — never dark panels.
- Minimap: light glass ring around a light, natural-colour map. World map: natural painted teal sea.
- The prologue void is a teal aurora with a gold goddess (no violet).

Screenshot tour: `LLM_SECRET=/path/llm.secret.json node tests/e2e/p5shots.mjs /tmp/p5 1600 900` (and `390 844` for phone).
