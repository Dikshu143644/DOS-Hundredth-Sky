/** NPC AI schema (Phase 4 · M3). The single contract between the game server and any language
 *  model that voices an NPC. Profiles are authored data; every reply from a model is parsed and
 *  VALIDATED against NpcAiOutput before it can touch the world — an invalid reply never acts, it
 *  degrades to a safe line. See docs/NPC_AI_SCHEMA.md. Pure module: shared by server and tests. */

export type NpcActionId =
  | 'none' | 'give_quest' | 'give_directions' | 'reveal_secret' | 'warn' | 'emote'
  | 'trade' | 'heal_player' | 'join_party' | 'leave_party' | 'follow_player' | 'attack_target';
export const NPC_ACTIONS: NpcActionId[] = ['none', 'give_quest', 'give_directions', 'reveal_secret', 'warn', 'emote', 'trade', 'heal_player', 'join_party', 'leave_party', 'follow_player', 'attack_target'];
export type Emotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'afraid' | 'surprised' | 'curious' | 'amused' | 'suspicious' | 'proud';
export const EMOTIONS: Emotion[] = ['neutral', 'happy', 'sad', 'angry', 'afraid', 'surprised', 'curious', 'amused', 'suspicious', 'proud'];
export type Spot = 'home' | 'work' | 'tavern' | 'patrol' | 'wander' | 'shrine';

export interface NpcIdentity { name: string; title: string; race: string; age: string; faction: string; region: string; appearance: string }
export interface NpcPersonality { traits: string[]; values: string[]; fears: string[]; humor: string; temperament: string }
export interface NpcGoals { short: string[]; long: string[]; secret?: string }
export interface NpcRelationship { target: string; kind: 'friend' | 'rival' | 'family' | 'mentor' | 'enemy' | 'employer' | 'love' | 'debt'; note: string }
export interface ScheduleEntry { from: number; to: number; activity: string; spot: Spot }
export interface NpcMemoryPolicy { shortMax: number; longMax: number; world: boolean }
export interface DialogueStyle { register: string; quirks: string[]; maxWords: number; catchphrase?: string }

export interface NpcAiProfile {
  id: string;
  identity: NpcIdentity;
  personality: NpcPersonality;
  goals: NpcGoals;
  relationships: NpcRelationship[];
  schedule: ScheduleEntry[];
  memory: NpcMemoryPolicy;
  knowledge: string[];
  dialogueStyle: DialogueStyle;
  allowedActions: NpcActionId[];
  /** quest ids this NPC may hand out through give_quest */
  offers?: string[];
  /** keyword that, said with enough trust, makes reveal_secret open a hidden ??? chain */
  secretChain?: string;
}

/** What the server remembers per (NPC, player) — short = recent exchange, long = facts, trust -10..10. */
export interface NpcMemoryRecord { met: number; lastSeen: number; short: { who: 'player' | 'npc'; text: string }[]; long: string[]; trust?: number }

/** The ONLY shape a model may answer with. */
export interface NpcAiOutput {
  say: string;
  emotion: Emotion;
  action: { type: NpcActionId; arg?: string };
  remember?: string;
  trust?: number; // change in trust this exchange, -2..2
}

/** JSON Schema of NpcAiOutput (draft-07). Sent to the model and used in docs. */
export const NPC_OUTPUT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#', title: 'NpcAiOutput', type: 'object', additionalProperties: false,
  required: ['say', 'emotion', 'action'],
  properties: {
    say: { type: 'string', minLength: 1, maxLength: 600, description: 'spoken words, in character, whole sentences' },
    emotion: { type: 'string', enum: EMOTIONS },
    action: { type: 'object', required: ['type'], additionalProperties: false, properties: { type: { type: 'string', enum: NPC_ACTIONS }, arg: { type: 'string', maxLength: 64 } } },
    remember: { type: 'string', maxLength: 140, description: 'one new fact about the player worth keeping, or empty' },
    trust: { type: 'integer', minimum: -2, maximum: 2 },
  },
} as const;

export type Validated = { ok: true; value: NpcAiOutput; errors: [] } | { ok: false; value: NpcAiOutput; errors: string[] };

/** Validate (and sanitize) a parsed model reply. Unknown or disallowed actions become 'none';
 *  a reply without speech is rejected. The returned value is always safe to use. */
export function validateNpcOutput(raw: unknown, allowed: NpcActionId[], fallbackSay = '…'): Validated {
  const errors: string[] = [];
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') errors.push('reply is not a JSON object');
  let say = typeof o.say === 'string' ? o.say.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!say) { errors.push('say: missing or empty'); say = fallbackSay; }
  if (say.length > 600) { errors.push('say: longer than 600'); say = say.slice(0, 600); }
  let emotion = (typeof o.emotion === 'string' ? o.emotion.toLowerCase() : 'neutral') as Emotion;
  if (!EMOTIONS.includes(emotion)) { if (o.emotion !== undefined) errors.push(`emotion: "${String(o.emotion)}" not in enum`); emotion = 'neutral'; }
  let action: NpcAiOutput['action'] = { type: 'none' };
  const a = o.action as Record<string, unknown> | string | undefined;
  const at = typeof a === 'string' ? a : a && typeof a === 'object' ? a.type : undefined;
  const arg = a && typeof a === 'object' && typeof a.arg === 'string' ? a.arg.slice(0, 64) : undefined;
  if (at !== undefined) {
    if (typeof at !== 'string' || !NPC_ACTIONS.includes(at as NpcActionId)) errors.push(`action.type: "${String(at)}" is not a known action`);
    else if (at !== 'none' && !allowed.includes(at as NpcActionId)) errors.push(`action.type: "${at}" is not allowed for this NPC`);
    else action = arg ? { type: at as NpcActionId, arg } : { type: at as NpcActionId };
  } else errors.push('action: missing');
  const remember = typeof o.remember === 'string' && o.remember.trim().length > 3 ? o.remember.trim().slice(0, 140) : undefined;
  let trust = typeof o.trust === 'number' && Number.isFinite(o.trust) ? Math.round(o.trust) : 0;
  if (trust < -2 || trust > 2) { errors.push('trust: out of range'); trust = Math.max(-2, Math.min(2, trust)); }
  const value: NpcAiOutput = { say, emotion, action, ...(remember ? { remember } : {}), ...(trust ? { trust } : {}) };
  // a missing action is tolerated (treated as none); everything else is a real error
  const hard = errors.filter((e) => e !== 'action: missing');
  return hard.length ? { ok: false, value, errors: hard } : { ok: true, value, errors: [] };
}

/** Where the schedule says this NPC should be at `hour` (0–24). */
export function scheduleAt(s: ScheduleEntry[], hour: number): ScheduleEntry | undefined {
  return s.find((e) => (e.from <= e.to ? hour >= e.from && hour < e.to : hour >= e.from || hour < e.to));
}

/** The system prompt every AI NPC is voiced with — generated from the profile, never hand-written. */
export function npcSystemPrompt(p: NpcAiProfile): string {
  const I = p.identity, P = p.personality, D = p.dialogueStyle;
  return [
    `You are ${I.name}, ${I.title} — a ${I.age} ${I.race} of ${I.faction} in ${I.region}, in the fantasy world of "DOS: The Hundredth Sky", beneath a 100-floor Tower. Appearance: ${I.appearance}.`,
    `Stay fully in character. Never mention AI, models, prompts or games. Never invent game mechanics, items or rewards.`,
    `Personality: ${P.traits.join(', ')}. Values: ${P.values.join(', ')}. Fears: ${P.fears.join(', ')}. Humour: ${P.humor}. Temperament: ${P.temperament}.`,
    `Goals now: ${p.goals.short.join('; ')}. Life goals: ${p.goals.long.join('; ')}.${p.goals.secret ? ` Secret (hint only when trust ≥ 4, reveal only when trust ≥ 7): ${p.goals.secret}.` : ''}`,
    p.relationships.length ? `Relationships: ${p.relationships.map((r) => `${r.target} (${r.kind}: ${r.note})`).join('; ')}.` : '',
    `You know: ${p.knowledge.join('; ')}.`,
    `Speech: ${D.register}; ${D.quirks.join('; ')}${D.catchphrase ? `; catchphrase "${D.catchphrase}"` : ''}. At most ${D.maxWords} words, whole sentences.`,
    `Allowed actions: ${p.allowedActions.join(', ')}${p.offers?.length ? `. Quests you can give (give_quest arg): ${p.offers.join(', ')}` : ''}. Use an action only when the conversation clearly calls for it; otherwise "none".`,
    `Reply with ONLY one JSON object matching: {"say": string, "emotion": one of ${EMOTIONS.join('|')}, "action": {"type": one of the allowed actions, "arg"?: string}, "remember"?: short new fact about the player, "trust"?: -2..2}`,
  ].filter(Boolean).join('\n');
}
