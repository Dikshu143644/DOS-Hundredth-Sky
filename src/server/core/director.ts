import { mulberry32 } from '../../shared/rng';
import { CAPITAL_POIS as POIS } from '../../shared/world';
import { MONSTERS, SPELLS, LOOT_TABLE, MonsterKind } from '../../shared/combat';
import type { QuestView } from '../../shared/protocol';
import { LlmGate, parseJsonLoose } from './llm';

/** AI Story Director — the Shangri-La Frontier idea: the world notices what a player does and
 *  quietly opens a hidden, chained "unique scenario" for that player alone. Sparks (unusual
 *  deeds) trigger generation; the LLM writes the chain from live world state, constrained to
 *  targets that actually exist; a seeded procedural writer is the fallback so it never breaks. */

export type StepType = 'kill' | 'visit' | 'talk' | 'cast' | 'collect' | 'night' | 'zone';
export interface QuestStep { type: StepType; target: string; count: number; text: string; poi?: string; progress: number }
export interface Quest {
  id: string; rank: string; title: string; hook: string; reward: string; steps: QuestStep[]; current: number;
  hidden: boolean; complete: boolean; source: 'llm' | 'procedural'; spark: string; xp: number;
  /** Phase 4 · M3 */ kind?: 'story' | 'side' | 'hidden' | 'board' | 'spark'; gold?: number; pts?: number; next?: string; giver?: string; region?: string;
}

export const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS', '???'];
export const RANK_XP: Record<string, number> = { F: 60, E: 110, D: 180, C: 280, B: 420, A: 620, S: 900, SS: 1300, SSS: 2000, '???': 2600 };

export interface Spark { id: string; text: string; baseRank: number }
export const SPARKS: Record<string, Spark> = {
  first_blood: { id: 'first_blood', text: 'slew their first undead outside the Gate of Dawn', baseRank: 0 },
  shrine_night_light: { id: 'shrine_night_light', text: 'spoke LUX at the Whispering Shrine under the night sky', baseRank: 6 },
  lake_dawn: { id: 'lake_dawn', text: 'stood at Lake Mirrorveil at the moment of dawn', baseRank: 4 },
  ruins_ignis: { id: 'ruins_ignis', text: 'burned a Grave Knight with IGNIS inside the Hollow Ruins', baseRank: 3 },
  storm_fulgur: { id: 'storm_fulgur', text: 'called FULGUR while a real storm raged overhead', baseRank: 5 },
  untouched_ten: { id: 'untouched_ten', text: 'defeated ten undead without falling once', baseRank: 2 },
  asked_tower: { id: 'asked_tower', text: 'asked the Archivist about the Tower\'s lost floors', baseRank: 3 },
  epic_page: { id: 'epic_page', text: 'found a Page of the Ninth Sky on a Bone Magus', baseRank: 7 },
  shrine_ignis_rain_night: { id: 'shrine_ignis_rain_night', text: 'burned fire at the Whispering Shrine in the rain at night — a deed nobody has done', baseRank: 9 },
};

export interface DirectorContext {
  playerName: string; cls: string; level: number; timeOfDay: string; weather: string;
  deeds: string[]; npcMemories: string[]; worldEvents: string[];
}

const VALID = {
  monsters: Object.keys(MONSTERS) as MonsterKind[],
  pois: POIS.map((p) => p.id),
  npcs: ['aldric', 'lyra', 'borin', 'sela', 'mira'],
  spells: SPELLS.map((s) => s.id),
  items: Object.values(LOOT_TABLE).flat().map((l) => l.item),
};

export function rankFor(spark: Spark, level: number): string {
  const r = Math.min(RANKS.length - 1, spark.baseRank + (level >= 8 ? 1 : 0));
  return RANKS[r];
}

export function validateQuest(raw: any, rank: string, spark: string, id: string): Quest | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) return null;
  const steps: QuestStep[] = [];
  for (const s of raw.steps.slice(0, 5)) {
    const type = String(s.type) as StepType;
    const target = String(s.target ?? '').toLowerCase();
    const count = Math.max(1, Math.min(12, Math.floor(Number(s.count) || 1)));
    const text = String(s.text ?? '').slice(0, 140);
    const ok =
      (type === 'kill' && VALID.monsters.includes(target as MonsterKind)) ||
      (type === 'visit' && VALID.pois.includes(target)) ||
      (type === 'talk' && VALID.npcs.includes(target)) ||
      (type === 'cast' && VALID.spells.includes(target)) ||
      (type === 'night' && VALID.pois.includes(target)) ||
      (type === 'collect' && VALID.items.map((i) => i.toLowerCase()).includes(target));
    if (!ok || !text) continue;
    const poi = s.poi && VALID.pois.includes(String(s.poi)) ? String(s.poi) : undefined;
    steps.push({ type, target, count: type === 'kill' || type === 'collect' ? count : 1, text, poi, progress: 0 });
  }
  if (steps.length < 2) return null;
  return {
    id, rank, spark, title: String(raw.title ?? 'Untitled Scenario').slice(0, 60), hook: String(raw.hook ?? '').slice(0, 260),
    reward: String(raw.reward ?? 'A secret of the Tower').slice(0, 80), steps, current: 0, hidden: true, complete: false,
    source: 'llm', xp: RANK_XP[rank] ?? 100,
  };
}

const TITLES = ['The {a} of {b}', 'Whispers Beneath {b}', 'Ashes of the {a}', 'The {a} Who Would Not Sleep', 'Echo of the {c} Floor', 'Oath of the {a}'];
const A = ['Ember', 'Lantern', 'Hollow Crown', 'Ninth Sky', 'Pale Wyrm', 'First Dawn', 'Broken Bell', 'Silent Choir'];
const B = ['Mirrorveil', 'the Hollow Ruins', 'the Shrine', 'the Gate of Dawn', 'the Ember Glade'];
const C = ['Seventh', 'Forty-First', 'Sixty-Third', 'Hundredth', 'Forgotten'];

export function proceduralQuest(seed: number, spark: Spark, rank: string, id: string, ctx: DirectorContext): Quest {
  const r = mulberry32(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const title = pick(TITLES).replace('{a}', pick(A)).replace('{b}', pick(B)).replace('{c}', pick(C));
  const poiName = (id: string) => POIS.find((p) => p.id === id)!.name;
  const n = Math.min(5, 2 + Math.floor(RANKS.indexOf(rank) / 3) + (r() < 0.5 ? 1 : 0));
  const steps: QuestStep[] = [];
  const pool: (() => QuestStep)[] = [
    () => { const p = pick(['ruins', 'shrine', 'glade', 'lake', 'camp']); return { type: 'visit', target: p, count: 1, text: `Follow the cold wind to ${poiName(p)}.`, progress: 0 }; },
    () => { const m = pick(VALID.monsters); const c = 2 + Math.floor(r() * 4); return { type: 'kill', target: m, count: c, text: `Lay ${c} ${MONSTERS[m].name}s to rest; they carry something that is not theirs.`, progress: 0 }; },
    () => { const s = pick(VALID.spells); const p = pick(['shrine', 'ruins', 'lake']); return { type: 'cast', target: s, count: 1, poi: p, text: `Speak ${s.toUpperCase()} at ${poiName(p)} and listen to what answers.`, progress: 0 }; },
    () => { const npc = pick(['lyra', 'aldric']); return { type: 'talk', target: npc, count: 1, text: `Tell ${npc === 'lyra' ? 'Elder Lyra' : 'Captain Aldric'} what you have seen.`, progress: 0 }; },
    () => { const p = pick(['shrine', 'lake', 'ruins']); return { type: 'night', target: p, count: 1, text: `Return to ${poiName(p)} when the Tower lights its night rings.`, progress: 0 }; },
  ];
  let last = -1;
  while (steps.length < n) {
    let i = Math.floor(r() * pool.length);
    if (i === last) i = (i + 1) % pool.length;
    last = i;
    steps.push(pool[i]());
  }
  if (!steps.some((s) => s.type === 'talk')) steps.push({ type: 'talk', target: 'lyra', count: 1, text: 'Bring the tale to Elder Lyra for the chronicle.', progress: 0 });
  return {
    id, rank, spark: spark.id, title, source: 'procedural', current: 0, hidden: true, complete: false, xp: RANK_XP[rank] ?? 100,
    hook: `Because ${ctx.playerName} ${spark.text}, something in the world has started to watch them.`,
    reward: RANKS.indexOf(rank) >= 6 ? 'A title, and a door in the Tower that was not there before' : 'Experience and a line in the Archivist\'s chronicle',
    steps,
  };
}

export async function generateQuest(llm: LlmGate, user: string, spark: Spark, ctx: DirectorContext, id: string, seed: number): Promise<Quest> {
  const rank = rankFor(spark, ctx.level);
  if (llm.enabled) {
    const sys = `You are the Story Director of the anime-fantasy MMORPG "DOS: The Hundredth Sky" (a world under a 100-floor tower). Like the unique scenarios in Shangri-La Frontier, you secretly open a HIDDEN chained quest for ONE player because of something unusual they did. Write evocative, mysterious, specific text. Reply with ONLY a JSON object.`;
    const user_ = `Player: ${ctx.playerName}, a level ${ctx.level} ${ctx.cls}. Trigger: they ${spark.text}. Rank: ${rank}.
World now: ${ctx.timeOfDay}, weather ${ctx.weather}. Recent deeds: ${ctx.deeds.slice(-6).join('; ') || 'none'}.
NPC memories of them: ${ctx.npcMemories.slice(-5).join('; ') || 'none'}. World events: ${ctx.worldEvents.slice(-5).join('; ') || 'none'}.
Allowed step types and targets (use ONLY these exact ids):
- kill: ${VALID.monsters.join(', ')} (count 1-8)
- visit / night: ${VALID.pois.join(', ')}
- talk: ${VALID.npcs.join(', ')}
- cast: ${VALID.spells.join(', ')} (optional "poi")
- collect: ${VALID.items.join(', ')} (count 1-3)
JSON: {"title": "...", "hook": "1-2 sentences, second person, ominous", "reward": "short", "steps": [{"type":"visit","target":"shrine","text":"..."}, ...3 to 5 steps that form a story]}`;
    const reply = await llm.ask(user, [{ role: 'system', content: sys }, { role: 'user', content: user_ }], { maxTokens: 900, temperature: 0.95, json: true });
    const q = validateQuest(parseJsonLoose(reply), rank, spark.id, id);
    if (q) return q;
  }
  return proceduralQuest(seed, spark, rank, id, ctx);
}

export function questView(q: Quest): QuestView {
  const reveal = !q.hidden;
  return {
    id: q.id, rank: q.rank, title: reveal ? q.title : '???', hook: q.hook, reward: q.reward, hidden: q.hidden, complete: q.complete, current: q.current, source: q.source,
    steps: q.steps.map((s, i) => ({ text: i <= q.current ? s.text : '???', done: i < q.current || q.complete, progress: s.count > 1 ? `${Math.min(s.progress, s.count)}/${s.count}` : undefined })),
  };
}
