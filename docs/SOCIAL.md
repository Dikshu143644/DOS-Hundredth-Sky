# Social systems (Phase 4 · M6)

Open the **Social** panel with **O** (or the ⚑ button). Four tabs: Party · Guild · Arena · Events. Everything is server-authoritative (`src/server/core/social.ts`).

## Parties (up to 8)
- Invite by name (panel or `/invite name`); the invitee gets an Accept / Decline prompt (60 s).
- Party frames (name, level, live HP) sit under your unit frame. `/p message` is party chat.
- XP: everyone who hit a monster already shares its XP; party members within 60 m who did **not** hit it get 50 % as well.
- The leader can promote someone else or remove a member. A party of one dissolves.

## Guilds (persistent)
- Found one for 500 gold (name 3–24, tag 2–4) → title *Guild Founder*. Up to 50 members.
- Join an open guild from the list, or accept an invite from the leader or an officer (needed when recruitment is closed).
- Roles: leader (recruitment, officers, everything), officers (invite, remove members, withdraw), members.
- **Bank:** anyone deposits gold or items (equipped items are refused); only the leader and officers withdraw. Every movement is logged. 60 item stacks.
- `/g message` is guild chat (also in the panel).

## World boss (timed)
- One rises every 20 minutes (the first 5 minutes after the server starts), rotating: Gorrath the Ruin Titan (Sunscorch Desert · Glass Flats), Vyrnax the Sky Serpent (Frostpeak · Old Quarry), the Hollow Mother (Ancient Forest · Mossmere).
- World chat announces it 2 minutes ahead; a glass event chip shows the countdown, then its HP and the 15 minutes it stays.
- HP scales with players online. Everyone who damaged it gets XP, its own loot roll, 300 gold and the *World Breaker* title; the Worldbreaker Sigil (mythical ring) is on its table.

## Raid: the Eclipse Throne (4–8 players)
- The party leader starts it from the Capital or the Foot of the Tower (Events tab). Every living member is pulled into a private copy of the arena (8 copies can run at once).
- Kaelthar, the Eclipse Dragon (Lv 55, HP scales with party size). Phase 2 at 66 %: Eclipse Shades spawn and chase the party. Phase 3 at 33 %: enrage. At 8 minutes the eclipse is total and wipes the party.
- Win: every member gets 6,000 XP, 1,500 gold, an Epic gear piece, 2 Enchant Stones, the *Eclipse Breaker* title and the Eclipse Scale Mantle (mythical; guaranteed on the first clear, 35 % after). The instance closes 60 s later.
- A wipe resets the instance. Walking out (or dying) removes you from the raid.

## PvP arena: the Crimson Ring
- Queue for ranked 1v1 (panel or `/arena`). When two are queued, both are moved into the Ring at full HP; the bell rings after 5 s (no damage before).
- A knockout ends the match: nobody dies, nothing is lost (no XP, gold, items, injuries). After 3 minutes the higher HP % wins. Leaving or disconnecting forfeits.
- Elo rating (start 1000, K 32), wins/losses, top-10 board; 10 wins → *Gladiator of the Crimson Ring*.
- PvP damage only exists between the two duellists of a running match (`Game.pvpHostile`).

## Anti-cheat (`src/server/core/anticheat.ts`)
The server already simulates movement from inputs inside a real-time budget (no speed or teleport hacks), and owns damage, cooldowns, loot, trades and the bank. On top of that:
- per-connection, per-message-type token buckets (e.g. 90 inputs/s, 3 chats/s); excess messages are dropped;
- every entity a client names (attack/cast targets, NPCs to talk to) must exist in the player's zone and be in reach; spell aim points must be near the player; input values must be finite and in range;
- each violation is a strike; a sustained flood earns at most one strike per second; 25 strikes in 60 s disconnects the client;
- `/health` reports `anticheat: { dropped, strikes, kicks, byReason }` and social counters.

Tests: `tests/unit/m6.test.ts` (11) and `tests/e2e/m6.mjs` (browser + 4 scripted WebSocket players).
