# Live AI NPCs: how a reply reaches the player

The Goddess (Aurelia) and the AI NPCs talk through `src/server/llmclient.ts` (Gemini's OpenAI-compatible endpoint; the key lives only in the server's `llm.secret.json`).

**Model chain.** `gemini-3.5-flash → gemini-3-flash-preview → gemini-3.1-flash-lite → gemini-3.5-flash-lite → gemini-flash-lite-latest → gemini-3.6-flash` (the `models` list in the secret file overrides it). Thinking is switched off per call (`reasoning_effort: none`, learned per model: a model that refuses `none` gets `minimal`, then nothing).

**Backoff.** A 429 rests that model for the provider's retry-after (the `Retry-After` header, `RetryInfo.retryDelay`, or "retry in Ns"), else 15 s doubling to 5 min, and the next model starts at once. A 5xx rests it 10 s doubling to 2 min; a 404/400 rests it 10 min; a model that has not produced its first token after 12 s is cut and rests 30 s doubling. When every model is resting, the call waits for the first rest to end if that fits inside the budget.

**Hedging.** If the current model has not produced its first token after 3 s, the next model starts beside it (at most 3 at once); the first to speak wins and the others are aborted. A model whose first token has been slow (>9 s on average) is tried after the quick ones.

**Streaming.** Replies are read as server-sent events. The server forwards the words to the client as `llmPartial` messages (≤ ~10 per second): plain text for the Goddess, the `say` field of the JSON for NPCs. The client shows an in-world "… is thinking" indicator the moment the player speaks, then the words as they arrive, then the final line (schema-checked for NPCs).

**Limits.** The player waits up to 25 s (gate) / 24 s (client budget) before the scripted fallback line. Short replies: 150 tokens for the Goddess, 260 for NPC JSON (a ≤60-word line plus the JSON fields). Per player: a burst of 6, then 12 per minute; 40 per minute server-wide. Identical prompts within 10 min reuse the cached reply, and identical prompts in flight together share one call.

**/health** (`llm`): `lastModel` (which model answered last), `count429`, `lastLatencyMs`, `lastFirstTokenMs`, `hedges`, `calls/failures/limited/cached/shared`, and `perModel` (ok, fail, r429, timeouts, lostRace, firstTokenMs, restingS, lastError).

**Check on live:** `node tests/e2e/goddess-ai.mjs https://hundredth-sky.sites.tab.bot /tmp/gai 3` (exits 0 when her last replies are all model-written).
