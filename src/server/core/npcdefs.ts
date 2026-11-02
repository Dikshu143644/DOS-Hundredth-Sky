/** Living NPCs of the Capital edge. Ordinary NPCs run on behaviour trees with daily routines;
 *  the two "important" NPCs additionally speak through the LLM with a memory model:
 *  short-term (recent exchange), long-term (facts about this player), world memory
 *  (shared events) and a fixed personality. */

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
    key: 'borin', name: 'Borin', title: 'Blacksmith', model: 'Barbarian', important: false, tint: 0xffd2b0,
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
    key: 'mira', name: 'Mira', title: 'Villager', model: 'Rogue_Hooded', important: false, tint: 0xffe0f0,
    home: { x: -80, z: -110 }, work: { x: -6, z: -128, anim: 'Idle' }, evening: { x: -28, z: -100, anim: 'Cheer' },
    lines: { greet: ['Oh! Are you a climber? You look like a climber.'], day: ['My cousin says the lake shows your future if you look at dawn.'], night: ['I shouldn\'t be out this late…'], rain: ['I love the rain. The Tower looks like it\'s crying.'], quest: [], afterKill: [] },
  },
];
