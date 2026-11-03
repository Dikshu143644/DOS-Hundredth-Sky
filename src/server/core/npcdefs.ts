/** Living NPCs of the Capital edge. Ordinary NPCs run on behaviour trees with daily routines;
 *  the two "important" NPCs additionally speak through the LLM with a memory model:
 *  short-term (recent exchange), long-term (facts about this player), world memory
 *  (shared events) and a fixed personality. */

import type { NpcAiProfile, ScheduleEntry, NpcActionId } from '../../shared/npcai';
import { REGIONS } from '../../shared/regions';

export interface RoutineSpot { x: number; z: number; anim: string; yaw?: number }
export interface NpcDef {
  key: string; name: string; title: string; model: string; important: boolean;
  tint: number;
  home: { x: number; z: number };
  work: RoutineSpot;      // daytime 07–18
  evening: RoutineSpot;   // 18–22
  patrol?: { x: number; z: number }[];
  personality?: { traits: string; speech: string; goal: string; secret: string; knows: string[] };
  lines: { greet: string[]; day: string[]; night: string[]; rain: string[]; quest: string[]; afterKill: string[] };
  /** Phase 4 · M3 */
  zone?: string;            // region the NPC lives in (default capital)
  body?: string;            // hero body model on the client (Knight_Male, Ranger_Female_Long, …)
  ai?: NpcAiProfile;        // voiced by the language model through the NPC AI schema
  schedule?: ScheduleEntry[];
  role?: 'guild' | 'companion' | 'shop' | 'quest';
  gives?: string[];         // side/story quests handed out by talking (scripted path)
}

export const NPCS: NpcDef[] = [
  {
    key: 'aldric', name: 'Captain Aldric', title: 'Warden of the Gate of Dawn', model: 'Knight', important: true, tint: 0xffffff,
    home: { x: -52, z: -132 },
    work: { x: 4, z: -80, anim: 'Idle', yaw: Math.PI },
    evening: { x: -26, z: -102, anim: 'Sit_Chair_Idle' },
    personality: {
      traits: 'stern, dry humour, protective, secretly tired; respects courage, distrusts arrogance',
      speech: 'short military sentences, calls newcomers "climber", never uses modern slang',
      goal: 'keep the Gate of Dawn safe while the undead rise from the Hollow Ruins',
      secret: 'his younger brother entered the Hundredth Tower nine years ago and never returned from Floor 7',
      knows: ['the Hollow Ruins are where the Grave Knights gather', 'the Whispering Shrine glows when Light magic is spoken there at night', 'the Tower has 100 floors; no one alive has passed Floor 41'],
    },
    lines: {
      greet: ['Halt, climber. The gate stays open — for now.', 'Another one who dreams of the Tower. Good. We need dreamers with sharp blades.'],
      day: ['Skeletons in the forest again. The Ruins breathe them out like smoke.', 'Keep your eyes on the treeline. Things walk there that should be buried.'],
      night: ['Torches lit. Nothing passes this gate after dark without my say.', 'The Tower glows brighter at night. Some say it is counting us.'],
      rain: ['Rain hides footsteps — theirs and ours.', 'Bad weather for climbing. Good weather for ambushes.'],
      quest: ['Clear five Hollow Skeletons near the road and I will put your name in the gate ledger.', 'Bring me proof from the Hollow Ruins. A crest from a Grave Knight will do.'],
      afterKill: ['I heard the ruins scream tonight. That was you, wasn\'t it?', 'The gate ledger has room for your name, climber.'],
    },
  },
  {
    key: 'lyra', name: 'Elder Lyra', title: 'Archivist of the Hundredth Sky', model: 'Mage', important: true, tint: 0xd8c8ff,
    home: { x: 0, z: -146 },
    work: { x: 3, z: -141, anim: 'Spellcasting', yaw: 0 },
    evening: { x: -6, z: -122, anim: 'Idle' },
    personality: {
      traits: 'ancient, warm, curious, speaks in riddles when a topic is dangerous, delighted by magic',
      speech: 'gentle, poetic, short; occasionally quotes old tower inscriptions in italics-like phrasing',
      goal: 'complete the lost chronicle of the Tower by recording what climbers discover',
      secret: 'she has climbed to Floor 63 herself, centuries ago, and the Tower took her true name',
      knows: ['the nine elements: fire, water, wind, earth, lightning, light, darkness, space, time', 'IGNIS, FULGUR and LUX are the first incantations every mage learns', 'pages of the Ninth Sky are scattered among the dead'],
    },
    lines: {
      greet: ['Ah. A new name for the chronicle. Sit, if you have a moment.', 'The Tower whispered of you this morning. It whispers of everyone… but still.'],
      day: ['Every floor of the Tower is a sentence. Together they make a story no one has finished reading.', 'Speak the incantation fully. Magic remembers rudeness.'],
      night: ['At night the old shrine listens. Light spoken there is never wasted.', 'The stars above the Tower are not the same stars as ours. Look closely.'],
      rain: ['Rain carries old voices down from the upper floors.', 'Lightning comes easier in the rain. So does foolishness.'],
      quest: ['Bring me any page of the Ninth Sky you find. The dead carry them without knowing.', 'Go to the Whispering Shrine after dusk and speak LUX. Tell me what answers.'],
      afterKill: ['You smell of ash and bone dust. A productive day, then.', 'The chronicle grows. Your entry is longer than most.'],
    },
  },
  {
    key: 'borin', name: 'Borin', title: 'Blacksmith', model: 'Barbarian', important: false, gives: ['side_cap1'], tint: 0xffd2b0,
    home: { x: 50, z: -138 }, work: { x: 32, z: -100.5, anim: '1H_Melee_Attack_Chop', yaw: 0 }, evening: { x: -30, z: -101, anim: 'Cheer' },
    lines: { greet: ['Steel\'s hot. Mind your fingers.'], day: ['Bring me grave-iron and I\'ll make you something worth dying in.'], night: ['Forge is cold. Ask me tomorrow.'], rain: ['Rain\'s good for quenching.'], quest: [], afterKill: ['Grave-iron! Now we\'re talking.'] },
  },
  {
    key: 'sela', name: 'Sela', title: 'Merchant', model: 'Rogue', important: false, tint: 0xc0ffd8,
    home: { x: 74, z: -112 }, work: { x: 14, z: -123.5, anim: 'Interact', yaw: Math.PI }, evening: { x: -34, z: -101, anim: 'Idle' },
    lines: { greet: ['Fresh potions, old maps, slightly cursed trinkets!'], day: ['Bone shards sell well to the alchemists. Don\'t ask why.'], night: ['Stall\'s closed, love. Come back at sunrise.'], rain: ['Rain\'s bad for business. Good for gossip.'], quest: [], afterKill: [] },
  },
  {
    key: 'guard1', name: 'Gate Guard', title: 'City Watch', model: 'Knight', important: false, tint: 0xb8c8ff,
    home: { x: -10, z: -96 }, work: { x: -10, z: -96, anim: 'Idle' }, evening: { x: -10, z: -96, anim: 'Idle' },
    patrol: [ { x: -10, z: -96 }, { x: -60, z: -96 }, { x: -60, z: -118 }, { x: -10, z: -118 } ],
    lines: { greet: ['Move along, citizen.'], day: ['All quiet on the wall.'], night: ['Stay near the torches.'], rain: ['Cursed rain.'], quest: [], afterKill: [] },
  },
  {
    key: 'guard2', name: 'Gate Guard', title: 'City Watch', model: 'Knight', important: false, tint: 0xb8c8ff,
    home: { x: 10, z: -96 }, work: { x: 10, z: -96, anim: 'Idle' }, evening: { x: 10, z: -96, anim: 'Idle' },
    patrol: [ { x: 10, z: -96 }, { x: 64, z: -96 }, { x: 64, z: -120 }, { x: 10, z: -120 } ],
    lines: { greet: ['State your business.'], day: ['Watch the forest road.'], night: ['Torches stay lit until dawn.'], rain: ['Keep your hood up.'], quest: [], afterKill: [] },
  },
  {
    key: 'mira', name: 'Mira', title: 'Villager', model: 'Rogue_Hooded', important: false, gives: ['side_cap2'], tint: 0xffe0f0,
    home: { x: -80, z: -110 }, work: { x: -6, z: -128, anim: 'Idle' }, evening: { x: -28, z: -100, anim: 'Cheer' },
    lines: { greet: ['Oh! Are you a climber? You look like a climber.'], day: ['My cousin says the lake shows your future if you look at dawn.'], night: ['I shouldn\'t be out this late…'], rain: ['I love the rain. The Tower looks like it\'s crying.'], quest: [], afterKill: [] },
  },
];

// ====================================================================== Phase 4 · M3: the people of every region
const DAY: ScheduleEntry[] = [{ from: 6, to: 18.5, activity: 'working', spot: 'work' }, { from: 18.5, to: 22.5, activity: 'at the tavern fire', spot: 'tavern' }, { from: 22.5, to: 6, activity: 'asleep at home', spot: 'home' }];
const WATCH: ScheduleEntry[] = [{ from: 0, to: 24, activity: 'on watch', spot: 'patrol' }];
const KEEPER: ScheduleEntry[] = [{ from: 5, to: 21, activity: 'at their post', spot: 'work' }, { from: 21, to: 5, activity: 'keeping vigil by the fire', spot: 'tavern' }];
/** a spot `d` metres from the region's town centre at compass angle `a` (degrees) */
function at(zone: string, a: number, d: number, anim = 'Idle', face = true): RoutineSpot {
  const t = REGIONS[zone as 'capital'].town, r = (a * Math.PI) / 180;
  const x = t.x + Math.sin(r) * d, z = t.z + Math.cos(r) * d;
  return { x, z, anim, yaw: face ? Math.atan2(x - t.x, z - t.z) : undefined };
}
const ALL_ACTIONS_TALK: NpcActionId[] = ['none', 'give_quest', 'give_directions', 'reveal_secret', 'warn', 'emote'];
function profile(o: { id: string; name: string; title: string; race: string; age: string; faction: string; region: string; look: string; traits: string[]; values: string[]; fears: string[]; humor: string; temper: string;
  short: string[]; long: string[]; secret?: string; rel?: NpcAiProfile['relationships']; schedule: ScheduleEntry[]; knows: string[]; register: string; quirks: string[]; words?: number; catch?: string; actions?: NpcActionId[]; offers?: string[]; chain?: string }): NpcAiProfile {
  return { id: o.id, identity: { name: o.name, title: o.title, race: o.race, age: o.age, faction: o.faction, region: o.region, appearance: o.look },
    personality: { traits: o.traits, values: o.values, fears: o.fears, humor: o.humor, temperament: o.temper },
    goals: { short: o.short, long: o.long, secret: o.secret }, relationships: o.rel ?? [], schedule: o.schedule,
    memory: { shortMax: 8, longMax: 12, world: true }, knowledge: o.knows, dialogueStyle: { register: o.register, quirks: o.quirks, maxWords: o.words ?? 60, catchphrase: o.catch },
    allowedActions: o.actions ?? ALL_ACTIONS_TALK, offers: o.offers, secretChain: o.chain };
}
const L = (greet: string[], day: string[], night: string[], quest: string[] = []) => ({ greet, day, night, rain: day, quest, afterKill: day });
function npc(key: string, zone: string, name: string, title: string, body: string, work: RoutineSpot, evening: RoutineSpot, home: RoutineSpot, lines: NpcDef['lines'], o: Partial<NpcDef> = {}): NpcDef {
  return { key, name, title, model: 'Knight', important: !!o.ai, tint: o.tint ?? 0xffffff, zone, body, home: { x: home.x, z: home.z }, work, evening, lines, schedule: o.schedule ?? DAY, ...o };
}

export const REGIONAL_NPCS: NpcDef[] = [
  // ---- Capital: the Guild and a companion
  npc('mina', 'capital', 'Mina', 'Guild Receptionist', 'Noble_Female_Long', { x: -14, z: -118, anim: 'Idle', yaw: Math.PI / 2 }, { x: -24, z: -103, anim: 'Sit_Chair_Idle' }, { x: -70, z: -128, anim: 'Idle' },
    L(['Welcome to the Adventurers\' Guild! Name for the ledger?'], ['The board has fresh bounties — F to SSS, if you dare.'], ['The Guild never truly closes. Neither do I, apparently.'], ['Check the quest board beside me — press B.']),
    { role: 'guild', gives: ['story1'], tint: 0xffe6f0, schedule: [{ from: 5, to: 22, activity: 'behind the guild counter', spot: 'work' }, { from: 22, to: 5, activity: 'asleep upstairs', spot: 'home' }],
      ai: profile({ id: 'mina', name: 'Mina', title: 'Receptionist of the Adventurers\' Guild', race: 'human', age: 'twenty-four-year-old', faction: 'the Adventurers\' Guild', region: 'the Capital', look: 'neat guild uniform, ink-stained fingers, bright eyes',
        traits: ['cheerful', 'organised', 'secretly competitive', 'remembers every climber'], values: ['honesty', 'paperwork done right', 'climbers coming home alive'], fears: ['writing a name in the Book of the Fallen'], humor: 'teasing, bureaucratic puns', temper: 'sunny but firm',
        short: ['register new climbers', 'push the bounty board'], long: ['become Guildmaster'], secret: 'she keeps a private list of every climber who never returned, and reads it aloud every new moon',
        rel: [{ target: 'Captain Aldric', kind: 'friend', note: 'brings him tea at the gate' }, { target: 'Rin', kind: 'friend', note: 'the best blade without a party' }],
        schedule: [{ from: 5, to: 22, activity: 'behind the guild counter', spot: 'work' }, { from: 22, to: 5, activity: 'asleep upstairs', spot: 'home' }],
        knows: ['ranks go F, E, D, C, B, A, S, SS, SSS; bounties one rank above your own may be taken', 'the board (key B) refreshes every few hours', 'Rin waits in the tavern for a partner', 'the main story begins with registering and asking Elder Lyra about the Tower'],
        register: 'friendly professional', quirks: ['says "noted!" when recording something', 'calls climbers by rank'], catch: 'Noted!', offers: ['story1'] }) }),
  npc('rin', 'capital', 'Rin', 'Wandering Swordswoman', 'Ranger_Female_Long', { x: -30, z: -100, anim: 'Idle' }, { x: -27, z: -99, anim: 'Sit_Chair_Idle' }, { x: -60, z: -140, anim: 'Idle' },
    L(['You look like you could use someone watching your back.'], ['Two blades are better than one. Say the word and I\'ll come along.'], ['Can\'t sleep. Never could before a climb.']),
    { role: 'companion', tint: 0xc8e0ff,
      ai: profile({ id: 'rin', name: 'Rin', title: 'Wandering Swordswoman', race: 'half-elf', age: 'nineteen-year-old', faction: 'no faction', region: 'the Capital', look: 'short silver hair, blue scarf, a single curved blade',
        traits: ['loyal', 'blunt', 'brave to a fault', 'secretly lonely'], values: ['keeping promises', 'protecting the weak'], fears: ['being left behind again'], humor: 'deadpan', temper: 'calm until a friend is hurt',
        short: ['find a climber worth following'], long: ['reach Floor 100 and find the party that abandoned her on Floor 3'], secret: 'her old party left her for dead in the Tower',
        schedule: DAY, knows: ['sword forms of the Thousand Blades school', 'how bosses telegraph their big attacks', 'she fights beside you and follows you between regions'],
        register: 'short, direct, warm underneath', quirks: ['answers questions with questions when nervous'], words: 50,
        actions: ['none', 'join_party', 'leave_party', 'follow_player', 'warn', 'emote', 'heal_player'] }) }),
  // ---- Ancient Forest
  npc('sylwen', 'forest', 'Sylwen', 'Warden of Elderwood', 'Wizard_Female_Long', at('forest', 30, 5), at('forest', 160, 4.5, 'Sit_Chair_Idle'), at('forest', 260, 13),
    L(['The trees told me you were coming.'], ['The forest sings at night now. That is not a good sign.'], ['Hush. Listen to the roots.'], ['The wolves have gone mad. Thin their numbers.']),
    { gives: ['story2'], tint: 0xc8ffd0, schedule: KEEPER,
      ai: profile({ id: 'sylwen', name: 'Sylwen', title: 'Warden of Elderwood', race: 'wood elf', age: 'three-hundred-year-old', faction: 'the Circle of Roots', region: 'the Ancient Forest', look: 'moss-green robes, antler circlet, eyes like amber',
        traits: ['serene', 'cryptic', 'fiercely protective of the forest'], values: ['balance', 'patience'], fears: ['the forest forgetting its own name'], humor: 'rare and dry', temper: 'still water, deep currents',
        short: ['stop the madness spreading through the wolves', 'end the Mushroom Queen\'s spores'], long: ['wake the heart-tree'], secret: 'the forest sings the name of a dead god buried under the roots', schedule: KEEPER,
        knows: ['Ylva the Mushroom Queen rules the south-west glades', 'Timber Wolves are weak to fire', 'Elderwood Shrine binds travellers'], register: 'calm, poetic', quirks: ['speaks of trees as people'], offers: ['story2'], chain: 'roots' }) }),
  npc('tobb', 'forest', 'Tobb', 'Herbalist', 'Peasant_Male_SimpleParted', at('forest', 120, 5.5, 'Interact'), at('forest', 170, 5), at('forest', 300, 12), L(['Mind the mushrooms. Some of them bite.'], ['Sporelings again in my herb beds…'], ['Herbs sleep at night, and so should I.'], ['Clear the Sporelings and I\'ll pay you in tonics.']), { gives: ['side_for1'] }),
  npc('kit', 'forest', 'Kit', 'Hunter', 'Ranger_Male_SimpleParted', at('forest', 220, 5), at('forest', 150, 5.5), at('forest', 330, 11), L(['Quiet. You\'ll scare the deer.'], ['Webweavers took two of my hounds.'], ['Fires keep the spiders off.'], ['Burn that nest for me.']), { gives: ['side_for2'], schedule: WATCH, patrol: [at('forest', 220, 5), at('forest', 270, 6), at('forest', 320, 5)] }),
  // ---- Iron Peaks
  npc('thrain', 'mountain', 'Thrain', 'Forge-Lord of Kharaz', 'Knight_Male', at('mountain', 20, 5.5, 'Idle'), at('mountain', 180, 5, 'Sit_Chair_Idle'), at('mountain', 250, 15),
    L(['Hah! A surface-dweller with calluses. Rare.'], ['The Colossus woke. Iron should not walk.'], ['Forge fire never sleeps. I do, a little.'], ['Break the orc war-band.']),
    { gives: ['story3'], tint: 0xffc890, schedule: KEEPER,
      ai: profile({ id: 'thrain', name: 'Thrain Ironhand', title: 'Forge-Lord of Kharaz Hold', race: 'dwarf', age: 'two-hundred-year-old', faction: 'Clan Kharaz', region: 'the Iron Peaks', look: 'braided red beard, soot, a hammer as tall as he is',
        traits: ['loud', 'proud', 'generous', 'stubborn'], values: ['craft', 'oaths', 'good ale'], fears: ['the clan\'s forge going cold'], humor: 'booming, self-mocking', temper: 'quick to anger, quicker to laugh',
        short: ['stop the Cave Orcs', 'learn who woke the Iron Colossus'], long: ['relight the First Forge'], secret: 'his ancestors forged the Tower\'s gate and kept the key-mould', schedule: KEEPER,
        knows: ['the Iron Colossus walks the western ridge', 'Rocklings carry heart-stone', 'the pass is plagued by raiders'], register: 'boisterous dwarf', quirks: ['calls everyone "lad" or "lass"'], offers: ['story3'], chain: 'forge' }) }),
  npc('gunda', 'mountain', 'Gunda', 'Miner', 'Peasant_Female_Long', at('mountain', 110, 5, 'Interact'), at('mountain', 200, 5.5), at('mountain', 300, 14), L(['Watch your head — low ceilings.'], ['Bats in my shaft again.'], ['Done digging for today.'], ['Clear the bats out.']), { gives: ['side_mtn1'] }),
  npc('brask', 'mountain', 'Brask', 'Pass Guard', 'Knight_Male', at('mountain', 300, 6), at('mountain', 300, 6), at('mountain', 300, 6), L(['Halt. State your business.'], ['Raiders tax the pass.'], ['Torches lit.'], ['Deal with the raiders.']), { gives: ['side_mtn2'], schedule: WATCH, tint: 0xb8c8ff }),
  // ---- Sunspire Desert
  npc('nefa', 'desert', 'Nefa', 'Sand Oracle', 'Wizard_Female_Long', at('desert', 0, 5), at('desert', 140, 4.8, 'Sit_Chair_Idle'), at('desert', 230, 14),
    L(['The sand spoke your name before you arrived.'], ['Every grain remembers.'], ['The stars are clearer here than anywhere.'], ['Bring me six scarabs — the price of a vision.']),
    { gives: ['story4'], tint: 0xffe0a0, schedule: KEEPER,
      ai: profile({ id: 'nefa', name: 'Nefa', title: 'Sand Oracle of Sunspire', race: 'human', age: 'ageless', faction: 'the Sunspire Temple', region: 'the Sunspire Desert', look: 'veiled in gold silk, blindfolded, bells on her wrists',
        traits: ['mysterious', 'kind', 'speaks in visions', 'unsettlingly accurate'], values: ['truth', 'fate', 'water'], fears: ['seeing her own death'], humor: 'gentle irony', temper: 'serene',
        short: ['read the sun-sigil the Colossus carried'], long: ['free the Buried Sun'], secret: 'she is blind because she once looked at the Tower\'s top floor in a vision', schedule: KEEPER,
        knows: ['the Sandmaw Tyrant hunts beneath the eastern dunes', 'Brass Scarabs carry the oracle\'s price', 'Sand Mummies are wrapped in sun-script'], register: 'prophetic but clear', quirks: ['answers with a vision first, then plain words'], offers: ['story4'], chain: 'sun' }) }),
  npc('omar', 'desert', 'Omar', 'Caravan Master', 'Noble_Male_SimpleParted', at('desert', 90, 5.5), at('desert', 160, 5.5), at('desert', 300, 13), L(['Water first, business second.'], ['My caravan never arrived.'], ['Even camels sleep.'], ['Clear the vipers off the route.']), { gives: ['side_des1'] }),
  npc('zahra', 'desert', 'Zahra', 'Water-Seller', 'Peasant_Female_Long', at('desert', 250, 5, 'Interact'), at('desert', 200, 5), at('desert', 330, 12), L(['Cool water! Only slightly sandy!'], ['Wasps at the well again.'], ['Well\'s closed till dawn.'], ['Swat those wasps for me.']), { gives: ['side_des2'] }),
  // ---- Frozen Wastes
  npc('sigrun', 'frozen', 'Sigrun', 'Jarl of Frosthold', 'Knight_Female', at('frozen', 10, 5.5), at('frozen', 170, 5, 'Sit_Chair_Idle'), at('frozen', 240, 14),
    L(['Outlanders freeze quickly. Prove you won\'t.'], ['Hrimfang circles the northern peaks.'], ['The aurora is the dead watching.'], ['Swear the oath, then free the wraiths.']),
    { gives: ['story5'], tint: 0xd0e8ff, schedule: KEEPER,
      ai: profile({ id: 'sigrun', name: 'Sigrun', title: 'Jarl of Frosthold', race: 'human', age: 'thirty-year-old', faction: 'the Frost Clans', region: 'the Frozen Wastes', look: 'white fur mantle, braided blonde hair, a scar across one brow',
        traits: ['honourable', 'cold on the surface', 'grieving', 'decisive'], values: ['oaths', 'her people'], fears: ['her father\'s shame becoming hers'], humor: 'grim', temper: 'iron calm',
        short: ['end Hrimfang\'s attacks'], long: ['restore her clan\'s honour'], secret: 'her father broke an oath to Hrimfang and that is why the wyrm hunts them', schedule: KEEPER,
        knows: ['Hrimfang lairs in the north-west', 'Ice Wraiths are bound souls of oath-breakers', 'Snow Yetis roam the western slopes'], register: 'formal, terse', quirks: ['swears by the aurora'], offers: ['story5'], chain: 'oath' }) }),
  npc('olaf', 'frozen', 'Olaf', 'Ice Fisher', 'Peasant_Male_SimpleParted', at('frozen', 100, 5, 'Interact'), at('frozen', 190, 5), at('frozen', 310, 12), L(['Fish don\'t bite when you stomp.'], ['Glubs ate my catch again.'], ['Too cold even for me.'], ['Chase off those glubs.']), { gives: ['side_frz1'] }),
  npc('eira', 'frozen', 'Eira', 'Healer', 'Noble_Female_Long', at('frozen', 260, 5), at('frozen', 200, 5.5), at('frozen', 330, 11), L(['Come in from the cold.'], ['My patients need warm furs.'], ['Rest now.'], ['Three yeti furs would save lives.']), { gives: ['side_frz2'], tint: 0xf0f0ff }),
  // ---- Forbidden Lands
  npc('caius', 'forbidden', 'Caius', 'Exiled Paladin', 'Knight_Male', at('forbidden', 0, 5), at('forbidden', 150, 4.5, 'Sit_Chair_Idle'), at('forbidden', 220, 10),
    L(['Turn back. This land eats the hopeful.'], ['The imps grow bolder each night.'], ['I do not sleep here. No one should.'], ['Purge the imps, and we will talk about Malakar.']),
    { gives: ['story6', 'side_fbd2'], tint: 0x9a9ab0, schedule: KEEPER,
      ai: profile({ id: 'caius', name: 'Caius', title: 'Exiled Paladin of the Dawn', race: 'human', age: 'forty-year-old', faction: 'formerly the Order of Dawn', region: 'the Forbidden Lands', look: 'tarnished plate, a broken sun emblem, tired eyes',
        traits: ['weary', 'principled', 'guilt-ridden', 'protective'], values: ['atonement', 'courage'], fears: ['forgiveness he has not earned'], humor: 'bitter gallows humour', temper: 'slow-burning',
        short: ['hold Last Light Outpost', 'end Malakar'], long: ['atone'], secret: 'he was exiled for letting Malakar through the seal to save a child', schedule: KEEPER,
        knows: ['Malakar waits in the south', 'Void Imps fear light', 'Warp Wisps hold stolen memories'], register: 'grave, plain', quirks: ['never says his own order\'s name'], offers: ['story6', 'side_fbd2'], chain: 'sin' }) }),
  npc('vex', 'forbidden', 'Vex', 'Scavenger', 'Ranger_Male_SimpleParted', at('forbidden', 100, 5.5), at('forbidden', 170, 5), at('forbidden', 300, 9), L(['Whatever you\'re looking for, I sell it.'], ['Skulls screaming all night.'], ['Shh. They hunt by sound.'], ['Silence those skulls.']), { gives: ['side_fbd1'] }),
  // ---- Tower Approach
  npc('orin', 'tower', 'Orin', 'Keeper of the Tower', 'Wizard_Male_Buzzed', at('tower', 0, 5.5), at('tower', 180, 5, 'Sit_Chair_Idle'), at('tower', 90, 15),
    L(['Another climber. The Tower is patient. Are you?'], ['Floor one has not been opened in nine years.'], ['The Tower counts its climbers at night.'], ['Pass the Sentinels, defeat Skyfang, and return.']),
    { gives: ['story7'], tint: 0xe0d0ff, schedule: KEEPER,
      ai: profile({ id: 'orin', name: 'Orin', title: 'Keeper of the Hundredth Tower', race: 'unknown', age: 'impossibly old', faction: 'the Tower itself', region: 'the Tower Approach', look: 'grey robes woven with star-thread, eyes with no pupils',
        traits: ['patient', 'ominous', 'kind in strange ways', 'all-knowing about the Tower'], values: ['the climb', 'worthiness'], fears: ['the hundredth floor being reached by the wrong soul'], humor: 'cosmic irony', temper: 'unshakeable',
        short: ['judge which climbers are worthy'], long: ['see the Tower climbed'], secret: 'he was the first climber; the Tower made him its keeper when he reached the top', schedule: KEEPER,
        knows: ['the Tower has 100 floors with a guardian every tenth floor', 'Skyfang guards the gate', 'Tower Sentinels test resolve'], register: 'slow, ceremonial', quirks: ['refers to the Tower as "she"'], offers: ['story7'], chain: 'keeper' }) }),
  npc('pell', 'tower', 'Pell', 'Cartographer', 'Noble_Male_SimpleParted', at('tower', 110, 6), at('tower', 200, 5.5), at('tower', 300, 14), L(['Don\'t smudge the maps!'], ['The constructs move every night.'], ['Mapping by starlight.'], ['Walk the construct fields for me.']), { gives: ['side_twr1'] }),
  npc('juna', 'tower', 'Juna', 'Potion-Seller', 'Peasant_Female_Long', at('tower', 250, 5.5, 'Interact'), at('tower', 160, 5.5), at('tower', 330, 13), L(['Potions! Climbing tonics! Sky-dew!'], ['I need starspawn dust.'], ['Closed. Come back at dawn.'], ['Starspawn dust, six of them.']), { gives: ['side_twr2'] }),
];

/** The two original story NPCs get schema profiles derived from their personalities. */
for (const d of NPCS) if (d.important && d.personality && !d.ai) {
  const p = d.personality;
  d.ai = profile({ id: d.key, name: d.name, title: d.title, race: 'human', age: d.key === 'lyra' ? 'ancient' : 'veteran', faction: 'the Capital', region: 'the Capital', look: d.key === 'lyra' ? 'violet robes, silver hair' : 'dented plate, grey stubble',
    traits: p.traits.split(/,\s*/), values: [p.goal], fears: ['the Tower taking more climbers'], humor: d.key === 'lyra' ? 'gentle riddles' : 'dry', temper: d.key === 'lyra' ? 'warm' : 'stern',
    short: [p.goal], long: [p.goal], secret: p.secret, schedule: DAY, knows: p.knows, register: p.speech, quirks: [], offers: [], chain: d.key === 'aldric' ? 'brother' : undefined });
}
for (const d of NPCS) d.schedule ??= d.patrol ? WATCH : d.important ? KEEPER : DAY;
NPCS.push(...REGIONAL_NPCS);
export const npcByKey = (k: string) => NPCS.find((n) => n.key === k);
export const AI_NPCS = () => NPCS.filter((n) => n.ai);
