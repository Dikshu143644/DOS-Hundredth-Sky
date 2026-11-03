/** Quests (Phase 4 · M3): the main story, regional side quests, hidden ??? chains and the
 *  Adventurers' Guild quest board (F → SSS). Pure data + generators, shared by server and tests. */
import { MONSTERS } from './combat';
import { ADV_RANKS } from './origin';

export type QStepType = 'kill' | 'visit' | 'talk' | 'cast' | 'collect' | 'night' | 'zone';
export interface QStepT { type: QStepType; target: string; count: number; text: string }
export interface QuestT {
  id: string; kind: 'story' | 'side' | 'hidden' | 'board'; title: string; rank: string; region: string; giver: string;
  hook: string; steps: QStepT[]; xp: number; gold: number; pts: number; minLevel?: number; next?: string;
}
/** every hunt-able monster with its level, region and boss flag */
export const SPECS_LEVELS: { kind: string; name: string; level: number; region: string; boss: boolean }[] = Object.values(MONSTERS).map((m: any) => ({ kind: m.kind, name: m.name, level: m.level ?? 2, region: m.region ?? 'capital', boss: !!m.boss }));
const RANK_PTS_REWARD = [20, 40, 70, 110, 160, 230, 320, 450, 650, 800];
export const QRANKS = [...ADV_RANKS, '???'] as const;
export const rankIdx = (r: string) => QRANKS.indexOf(r as any);
const reward = (rank: string) => { const i = Math.max(0, rankIdx(rank)); return { xp: [60, 110, 180, 280, 420, 620, 900, 1300, 2000, 2600][i], gold: 25 * (i + 1), pts: RANK_PTS_REWARD[i] }; };
const K = (target: string, count: number, text: string): QStepT => ({ type: 'kill', target, count, text });
const T = (target: string, text: string): QStepT => ({ type: 'talk', target, count: 1, text });
const V = (target: string, text: string): QStepT => ({ type: 'visit', target, count: 1, text });
const Z = (target: string, text: string): QStepT => ({ type: 'zone', target, count: 1, text });
const q = (o: Omit<QuestT, 'xp' | 'gold' | 'pts'>): QuestT => ({ ...reward(o.rank), ...o });

/** The main story: seven chapters, one per region, ending at the Tower's gate. */
export const STORY: QuestT[] = [
  q({ id: 'story1', kind: 'story', title: 'Ch.1 · A Name in the Ledger', rank: 'F', region: 'capital', giver: 'mina', minLevel: 1, next: 'story2',
    hook: 'Every climber begins at the Adventurers\' Guild. Mina keeps the ledger.',
    steps: [T('mina', 'Register with Mina at the Adventurers\' Guild in the Capital.'), K('minion', 4, 'Put 4 Hollow Skeletons to rest outside the Gate of Dawn.'), T('lyra', 'Ask Elder Lyra what the Tower wants with you.')] }),
  q({ id: 'story2', kind: 'story', title: 'Ch.2 · Whispers in Elderwood', rank: 'E', region: 'forest', giver: 'sylwen', minLevel: 6, next: 'story3',
    hook: 'Lyra says the forest has started to sing at night. The druid Sylwen knows why.',
    steps: [Z('forest', 'Travel north into the Ancient Forest.'), T('sylwen', 'Find Sylwen the Warden in Elderwood Haven.'), K('wolf', 5, 'Thin the maddened Timber Wolves (5).'), K('mushking', 1, 'Silence Ylva, the Mushroom Queen.')] }),
  q({ id: 'story3', kind: 'story', title: 'Ch.3 · Iron Under the Mountain', rank: 'D', region: 'mountain', giver: 'thrain', minLevel: 12, next: 'story4',
    hook: 'Sylwen\'s spores came from the east: something wakes beneath the Iron Peaks.',
    steps: [T('thrain', 'Speak with Forge-Lord Thrain in Kharaz Hold.'), K('caveorc', 6, 'Break the Cave Orc war-band (6).'), K('colossus', 1, 'Topple the Iron Colossus.')] }),
  q({ id: 'story4', kind: 'story', title: 'Ch.4 · The Oracle of Sunspire', rank: 'C', region: 'desert', giver: 'nefa', minLevel: 18, next: 'story5',
    hook: 'The Colossus carried a sun-sigil from the Sunspire Desert.',
    steps: [T('nefa', 'Seek Nefa, the Sand Oracle, at Sunspire Oasis.'), K('scarab', 6, 'Collect the oracle\'s price: 6 Brass Scarabs.'), K('sandmaw', 1, 'Slay the Sandmaw Tyrant beneath the dunes.')] }),
  q({ id: 'story5', kind: 'story', title: 'Ch.5 · The Frozen Oath', rank: 'B', region: 'frozen', giver: 'sigrun', minLevel: 24, next: 'story6',
    hook: 'Nefa saw a wyrm of ice holding the second key.',
    steps: [T('sigrun', 'Swear before Jarl Sigrun in Frosthold.'), K('wraith', 6, 'Free the Ice Wraiths (6).'), K('hrimfang', 1, 'Defeat Hrimfang the Frost Wyrm.')] }),
  q({ id: 'story6', kind: 'story', title: 'Ch.6 · Into the Forbidden Lands', rank: 'A', region: 'forbidden', giver: 'caius', minLevel: 30, next: 'story7',
    hook: 'Both keys point south, to the land the maps leave blank.',
    steps: [T('caius', 'Find Caius, the exiled paladin, at Last Light Outpost.'), K('imp', 8, 'Purge the Void Imps (8).'), K('malakar', 1, 'Cast down Archfiend Malakar.')] }),
  q({ id: 'story7', kind: 'story', title: 'Ch.7 · The Gate of the Hundredth Sky', rank: 'S', region: 'tower', giver: 'orin', minLevel: 38,
    hook: 'With two keys and a demon\'s heart, the Tower will open for you.',
    steps: [T('orin', 'Present yourself to Orin, Keeper of the Tower, in Climbers\' Rest.'), K('sentinel', 6, 'Pass the Tower Sentinels (6).'), K('skyfang', 1, 'Defeat Skyfang, Gatekeeper of the Tower.'), T('orin', 'Return to Orin. The first floor awaits.')] }),
];

/** Side quests: two per region, given by its people. */
export const SIDE: QuestT[] = [
  q({ id: 'side_cap1', kind: 'side', title: 'The Blacksmith\'s Bones', rank: 'F', region: 'capital', giver: 'borin', hook: 'Borin wants grave-iron — the skeletons carry it.', steps: [K('minion', 6, 'Collect grave-iron from 6 Hollow Skeletons.'), T('borin', 'Bring it to Borin.')] }),
  q({ id: 'side_cap2', kind: 'side', title: 'Mira\'s Lake Dawn', rank: 'E', region: 'capital', giver: 'mira', hook: 'Mira swears Lake Mirrorveil shows the future at dawn.', steps: [V('lake', 'Stand at Lake Mirrorveil.'), T('mira', 'Tell Mira what you saw.')] }),
  q({ id: 'side_for1', kind: 'side', title: 'Herbs for Tobb', rank: 'E', region: 'forest', giver: 'tobb', hook: 'Sporelings guard the herbs Tobb needs.', steps: [K('mushnub', 6, 'Clear 6 Sporelings from the herb beds.'), T('tobb', 'Return to Tobb.')] }),
  q({ id: 'side_for2', kind: 'side', title: 'The Webweaver Nest', rank: 'D', region: 'forest', giver: 'kit', hook: 'Kit lost two hounds to the spiders.', steps: [K('spider', 5, 'Burn out 5 Webweavers.'), T('kit', 'Report to Kit.')] }),
  q({ id: 'side_mtn1', kind: 'side', title: 'Bats in the Mine', rank: 'D', region: 'mountain', giver: 'gunda', hook: 'Crag Bats nest in Gunda\'s shaft.', steps: [K('cragbat', 6, 'Drive out 6 Crag Bats.'), T('gunda', 'Tell Gunda the shaft is clear.')] }),
  q({ id: 'side_mtn2', kind: 'side', title: 'Raiders on the Pass', rank: 'C', region: 'mountain', giver: 'brask', hook: 'Highland Raiders tax the pass.', steps: [K('raider', 5, 'Defeat 5 Highland Raiders.'), T('brask', 'Return to Brask.')] }),
  q({ id: 'side_des1', kind: 'side', title: 'The Lost Caravan', rank: 'C', region: 'desert', giver: 'omar', hook: 'Omar\'s caravan never reached the oasis.', steps: [K('viper', 6, 'Clear 6 Dune Vipers off the route.'), T('omar', 'Report to Omar.')] }),
  q({ id: 'side_des2', kind: 'side', title: 'Wasps at the Well', rank: 'C', region: 'desert', giver: 'zahra', hook: 'Zahra cannot draw water with wasps swarming.', steps: [K('sandwasp', 6, 'Swat 6 Sand Wasps.'), T('zahra', 'Tell Zahra.')] }),
  q({ id: 'side_frz1', kind: 'side', title: 'Under the Ice', rank: 'B', region: 'frozen', giver: 'olaf', hook: 'Rime Glubs eat Olaf\'s catch.', steps: [K('glub', 5, 'Chase off 5 Rime Glubs.'), T('olaf', 'Return to Olaf.')] }),
  q({ id: 'side_frz2', kind: 'side', title: 'Yeti Fur for Eira', rank: 'B', region: 'frozen', giver: 'eira', hook: 'Eira\'s patients need warm furs.', steps: [K('yeti', 3, 'Hunt 3 Snow Yetis.'), T('eira', 'Bring the furs to Eira.')] }),
  q({ id: 'side_fbd1', kind: 'side', title: 'Screams in the Dark', rank: 'A', region: 'forbidden', giver: 'vex', hook: 'Vex can\'t scavenge with skulls screaming.', steps: [K('skullghost', 6, 'Silence 6 Screaming Skulls.'), T('vex', 'Report to Vex.')] }),
  q({ id: 'side_fbd2', kind: 'side', title: 'Ink of the Abyss', rank: 'A', region: 'forbidden', giver: 'caius', hook: 'Caius needs abyssal ink for his wards.', steps: [K('squidle', 5, 'Take ink from 5 Abyss Squids.'), T('caius', 'Bring it to Caius.')] }),
  q({ id: 'side_twr1', kind: 'side', title: 'Mapping the Approach', rank: 'S', region: 'tower', giver: 'pell', hook: 'Pell needs someone to walk the construct fields.', steps: [K('construct', 4, 'Disable 4 Guardian Constructs.'), T('pell', 'Return to Pell.')] }),
  q({ id: 'side_twr2', kind: 'side', title: 'Starlight Reagents', rank: 'S', region: 'tower', giver: 'juna', hook: 'Juna\'s potions need starspawn dust.', steps: [K('starspawn', 6, 'Gather dust from 6 Starspawn.'), T('juna', 'Bring it to Juna.')] }),
];

/** Hidden ??? chains: one per region, opened by a secret trigger, shown as ??? until the first step. */
export interface HiddenChain { quest: QuestT; trigger: { type: 'secret'; npc: string } | { type: 'night_visit'; zone: string; target: string } | { type: 'kill_streak'; target: string; count: number } }
export const HIDDEN: HiddenChain[] = [
  { trigger: { type: 'secret', npc: 'aldric' }, quest: q({ id: 'hid_cap', kind: 'hidden', title: 'The Brother on Floor 7', rank: '???', region: 'capital', giver: 'aldric', hook: 'Aldric\'s brother entered the Tower nine years ago.', steps: [V('hollow_ruins', 'Search the Hollow Ruins for the brother\'s crest.'), K('warrior', 3, 'Defeat the Grave Knights guarding it (3).'), T('aldric', 'Give the crest to Aldric.')] }) },
  { trigger: { type: 'secret', npc: 'sylwen' }, quest: q({ id: 'hid_for', kind: 'hidden', title: 'The Song Beneath the Roots', rank: '???', region: 'forest', giver: 'sylwen', hook: 'The forest sings a name at night.', steps: [K('blob', 4, 'Cut through 4 Thorn Blobs to the old roots.'), K('mushking', 1, 'Take the Queen\'s crown-spore.'), T('sylwen', 'Bring it to Sylwen.')] }) },
  { trigger: { type: 'secret', npc: 'thrain' }, quest: q({ id: 'hid_mtn', kind: 'hidden', title: 'The First Forge', rank: '???', region: 'mountain', giver: 'thrain', hook: 'Thrain\'s clan forged something for the Tower once.', steps: [K('rockling', 6, 'Mine heart-stone from 6 Rocklings.'), K('colossus', 1, 'Tear the core from the Colossus.'), T('thrain', 'Return to Thrain.')] }) },
  { trigger: { type: 'secret', npc: 'nefa' }, quest: q({ id: 'hid_des', kind: 'hidden', title: 'The Buried Sun', rank: '???', region: 'desert', giver: 'nefa', hook: 'Nefa dreams of a sun under the sand.', steps: [K('mummy', 5, 'Unwrap 5 Sand Mummies for the sun-script.'), T('nefa', 'Read the script to Nefa.')] }) },
  { trigger: { type: 'secret', npc: 'sigrun' }, quest: q({ id: 'hid_frz', kind: 'hidden', title: 'Oathbreaker\'s Grave', rank: '???', region: 'frozen', giver: 'sigrun', hook: 'Sigrun\'s father broke an oath to the wyrm.', steps: [K('frostwolf', 6, 'Follow the frost wolves\' trail (6).'), K('hrimfang', 1, 'Face Hrimfang again.'), T('sigrun', 'Tell Sigrun the truth.')] }) },
  { trigger: { type: 'secret', npc: 'caius' }, quest: q({ id: 'hid_fbd', kind: 'hidden', title: 'The Paladin\'s Sin', rank: '???', region: 'forbidden', giver: 'caius', hook: 'Caius was not exiled for cowardice.', steps: [K('hywirl', 5, 'Catch 5 Warp Wisps holding his memories.'), T('caius', 'Return them to Caius.')] }) },
  { trigger: { type: 'secret', npc: 'orin' }, quest: q({ id: 'hid_twr', kind: 'hidden', title: 'Keeper of the Hundredth Sky', rank: '???', region: 'tower', giver: 'orin', hook: 'Orin has kept the gate for longer than a human can live.', steps: [K('starspawn', 5, 'Read the stars on 5 Starspawn.'), K('skyfang', 1, 'Defeat Skyfang once more.'), T('orin', 'Ask Orin who he really is.')] }) },
];

export const ALL_FIXED: QuestT[] = [...STORY, ...SIDE, ...HIDDEN.map((h) => h.quest)];
export const questT = (id: string) => ALL_FIXED.find((x) => x.id === id);

/** Bounty rank of a monster from its level (bosses one rank higher). */
export function monsterRank(level: number, boss = false): number { return Math.max(0, Math.min(8, Math.floor((level - 2) / 6) + (boss ? 1 : 0))); }

/** The Guild board for a region: one bounty per rank F → SSS, preferring the region's own monsters.
 *  Deterministic for (region, seed); the board rotates when the seed changes. */
export function generateBoard(region: string, seed: number): QuestT[] {
  const mons = SPECS_LEVELS;
  const out: QuestT[] = [];
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let r = 0; r < 9; r++) {
    const pool = mons.filter((m) => monsterRank(m.level, m.boss) === r);
    const local = pool.filter((m) => m.region === region);
    const from = local.length && rnd() < 0.8 ? local : pool.length ? pool : mons;
    const m = from[Math.floor(rnd() * from.length)];
    const n = m.boss ? 1 : 3 + Math.floor(rnd() * 5);
    const rank = QRANKS[r];
    out.push(q({ id: `board_${region}_${seed}_${r}`, kind: 'board', title: m.boss ? `Bounty: ${m.name}` : `Cull: ${m.name} ×${n}`, rank, region: m.region, giver: 'board',
      hook: m.boss ? `A bounty is posted on ${m.name} (${regionName(m.region)}).` : `${plural(m.name)} are out of hand in ${regionName(m.region)}.`,
      steps: [K(m.kind, n, m.boss ? `Defeat ${m.name}.` : `Defeat ${n} ${plural(m.name)} in ${regionName(m.region)}.`)] }));
  }
  return out;
}
export const plural = (n: string) => /wolf$/i.test(n) ? n.slice(0, -1) + 'ves' : /[^aeiou]y$/i.test(n) ? n.slice(0, -1) + 'ies' : /(spawn|s)$/i.test(n) ? n : n + 's';
const RN: Record<string, string> = { capital: 'the Capital', forest: 'the Ancient Forest', mountain: 'the Iron Peaks', desert: 'the Sunspire Desert', frozen: 'the Frozen Wastes', forbidden: 'the Forbidden Lands', tower: 'the Tower Approach' };
export const regionName = (r: string) => RN[r] ?? r;
/** A climber may take bounties up to one rank above their adventurer rank. */
export const canTake = (advRank: string, questRank: string) => rankIdx(questRank) <= rankIdx(advRank) + 1;
