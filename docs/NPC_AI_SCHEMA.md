# NPC AI Schema — DOS: The Hundredth Sky

Every AI-voiced NPC is an authored **profile**. Every model reply is parsed and **validated** against one output schema before it can touch the world. A reply that fails validation never takes an action; it falls back to a safe line. Types live in `src/shared/npcai.ts`, profiles in `src/server/core/npcdefs.ts`, and the runtime in `src/server/core/questsys.ts` (`aiTalk`, `applyAction`).

## 1. Profile (`NpcAiProfile`)

| Field | Type | Purpose |
|---|---|---|
| `id` | string | NPC key (`mina`, `sylwen`, …) |
| `identity` | `{ name, title, race, age, faction, region, appearance }` | Who they are |
| `personality` | `{ traits[], values[], fears[], humor, temperament }` | How they behave |
| `goals` | `{ short[], long[], secret? }` | What they want. The secret is hinted at trust ≥ 4 and revealed at trust ≥ 7 |
| `relationships` | `{ target, kind, note }[]` | `kind`: friend · rival · family · mentor · enemy · employer · love · debt |
| `schedule` | `{ from, to, activity, spot }[]` | 24 h day plan. `spot`: home · work · tavern · patrol · wander · shrine. It drives the behaviour tree |
| `memory` | `{ shortMax, longMax, world }` | Size of short-term memory (recent turns) and long-term memory (facts about this player); whether world memory (shared events) is included |
| `knowledge` | string[] | Facts the NPC knows and may share |
| `dialogueStyle` | `{ register, quirks[], maxWords, catchphrase? }` | Voice |
| `allowedActions` | `NpcActionId[]` | The only actions this NPC may take |
| `offers?` | string[] | Quest ids that `give_quest` may hand out |
| `secretChain?` | string | Topic word linked to this NPC's hidden ??? chain |

### Memory model (`NpcMemoryRecord`, stored per NPC × player)
- **short**: the last `shortMax` turns, replayed as chat history.
- **long**: up to `longMax` facts the model chose to `remember` about this player.
- **world**: the time of day, the weather and the latest world events (boss kills, quest completions), shared by all NPCs.
- **trust**: −10…10. It moves by the reply's `trust` delta (−2…2).

## 2. Output (`NpcAiOutput`): the only shape a model may answer with

```json
{
  "say": "The roots remember you already.",
  "emotion": "curious",
  "action": { "type": "give_quest", "arg": "story2" },
  "remember": "asked about the wolves",
  "trust": 1
}
```

JSON Schema (draft-07), exported as `NPC_OUTPUT_SCHEMA`:
- `say` *(required)*: string, 1–600 characters, whole sentences (trimmed by `wholeSentences`).
- `emotion` *(required)*: one of `neutral happy sad angry afraid surprised curious amused suspicious proud`.
- `action` *(required)*: `{ type, arg? }`, where `type` is one of the actions below.
- `remember`: string ≤ 140 characters.
- `trust`: integer −2…2.

### Actions (`NpcActionId`)
| Action | Effect (server re-checks everything) |
|---|---|
| `none` | Nothing |
| `give_quest` | Gives `arg` if it is in `offers` and its prerequisites are met (story chapters in order) |
| `reveal_secret` | Opens the NPC's hidden ??? chain, only if trust ≥ 2 or the player has met them 3 times |
| `give_directions` | Points to the region of their quest |
| `warn` | Shows a warning notice |
| `emote` | Plays an animation |
| `trade` | Reserved for shops (M4) |
| `heal_player` | Restores 25 % HP |
| `join_party` / `follow_player` | The companion joins and follows (companion role only) |
| `leave_party` | The companion leaves |
| `attack_target` | Reserved; no current NPC allows it |

## 3. Validation (`validateNpcOutput(raw, allowed)`)
- A non-object, missing `say`, an unknown action, an action outside `allowedActions`, an emotion outside the enum, or `trust` out of range is an **error**. The result is `ok: false` with an error list.
- The returned `value` is **always safe**: bad actions become `none`, emotion defaults to `neutral`, and trust is clamped.
- The server uses `value.say` (if present) with the sanitized action. If the reply is unparseable or has no speech, the NPC speaks a **scripted line** instead.
- Rate limits, timeouts and missing keys all degrade to scripted lines. The game never blocks on the model.

## 4. Prompt
`npcSystemPrompt(profile)` builds the system prompt from the profile alone (identity, personality, goals, relationships, knowledge, style, allowed actions, offers and the JSON contract). The user turn carries world memory, long-term memory, trust, active quests and the quests on offer. Short-term memory is replayed as chat history.

## 5. AI NPCs in the world (8)
| NPC | Region | Role |
|---|---|---|
| Mina | Capital | Guild receptionist; story ch.1; quest board |
| Rin | Capital | **Companion agent**: joins, follows, fights, heals the leader when low, falls back when hurt, barks on bosses |
| Captain Aldric, Elder Lyra | Capital | Original story NPCs, now on the schema |
| Sylwen | Ancient Forest | Warden; ch.2; hidden "Song Beneath the Roots" |
| Thrain | Iron Peaks | Forge-lord; ch.3; hidden "The First Forge" |
| Nefa | Sunspire Desert | Oracle; ch.4; hidden "The Buried Sun" |
| Sigrun | Frozen Wastes | Jarl; ch.5; hidden "Oathbreaker's Grave" |
| Caius | Forbidden Lands | Exiled paladin; ch.6; hidden "The Paladin's Sin" |
| Orin | Tower Approach | Keeper; ch.7; hidden "Keeper of the Hundredth Sky" |

Every regional town also has 2–3 ordinary NPCs on behaviour-tree schedules who give side quests.

## 6. Status
The server broadcasts `{type:'ai', status: online | degraded | offline}` every 20 s. The HUD pill shows it; tap it for details.

## 7. Tests
`tests/unit/m3.test.ts` covers schema validation, profiles and schedules, and a **mock LLM** (a valid reply gives a quest; a disallowed action is refused; garbage falls back; trust opens a hidden chain). It also covers the companion (follow, fight, heal, zone change, dismiss) and the AI status.
