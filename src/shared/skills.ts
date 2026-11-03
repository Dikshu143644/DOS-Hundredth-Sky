/** Class skill kits, advanced classes, attributes, titles and reputation — pure data + rules
 *  shared by the authoritative server (which executes them) and the client (which shows them). */
import type { ClassId, Element } from './combat';

export type SkillKind = 'projectile' | 'strike' | 'nova' | 'cone' | 'dash' | 'buff' | 'heal' | 'summon';
/** Which client effect draws the skill (colour comes from the skill). */
export type SkillFx = 'ignis' | 'fulgur' | 'lux' | 'arrow' | 'slash' | 'quake' | 'ring' | 'dash' | 'aura' | 'heal' | 'summon' | 'meteor' | 'frost' | 'gale' | 'shadow' | 'rain';

export interface BuffDef { atk?: number; def?: number; mag?: number; spd?: number; crit?: number; lifesteal?: number; dur: number }
export interface SkillEffects {
  stun?: number;            // seconds
  root?: number;            // seconds (cannot move, can act)
  slow?: number; slowDur?: number;   // speed multiplier lost (0.5 = 50 % slower)
  dot?: number; dotDur?: number;     // power per second (scaled by the caster's stat)
  knock?: number;           // metres pushed away
  mark?: number; markDur?: number;   // target takes +mark damage
  taunt?: boolean;          // monsters in range switch to the caster
  heal?: number;            // heal power (allies in radius / target)
  hot?: number; hotDur?: number;     // heal per second power
  shield?: number; shieldDur?: number; // absorb as a fraction of the receiver's max HP
  buff?: BuffDef;           // applied to self (and party if `party`)
  party?: boolean;          // buff/heal/shield also reaches allies in radius
  revive?: boolean;         // brings fallen allies in radius back
  cleanse?: boolean;
  soak?: number;            // seconds the target is Soaked (lightning combo)
  burn?: boolean;           // marks Burning (wind combo)
  chill?: number;           // seconds Chilled (earth/physical shatter combo)
  dash?: number;            // metres the caster travels (negative = backwards)
  iframes?: number;         // seconds of invulnerability while dashing
  summon?: { kind: string; dur: number; power: number; max: number };
}

export interface SkillDef {
  id: string; cls: ClassId; slot: 1 | 2 | 3 | 4 | 5 | 6; unlock: number;
  name: string; title: string; element: Element; incantation: string;
  castTime: number; cooldown: number; mana: number; range: number; radius: number; power: number;
  kind: SkillKind; fx: SkillFx; color: number; light: number; scale: 'atk' | 'mag';
  arc?: number; ult?: boolean; adv?: string; desc: string; fx2?: SkillEffects;
  /** legacy alias so older client code that reads `key` keeps working */
  key: number;
}

type S = Omit<SkillDef, 'key' | 'fx2'> & { e?: SkillEffects };
const mk = (s: S): SkillDef => ({ ...s, key: s.slot, fx2: s.e });

/** Slots: 1–4 class skills, 5 advanced-class skill (level 20), 6 ultimate (level 12). */
export const SKILLS: SkillDef[] = [
  // ---------------------------------------------------------------- WARRIOR (strength · axe)
  mk({ id: 'cleave', cls: 'warrior', slot: 1, unlock: 1, name: 'CLEAVE', title: 'Wide Cleave', element: 'physical', incantation: '', castTime: 0.15, cooldown: 4.5, mana: 8, range: 3.6, radius: 3.6, arc: 2.2, power: 1.7, kind: 'cone', fx: 'slash', color: 0xffd9a0, light: 3, scale: 'atk', desc: 'A heavy sweep that hits every foe in front of you.', e: { chill: 0 } }),
  mk({ id: 'terra', cls: 'warrior', slot: 2, unlock: 3, name: 'TERRA FRANGO', title: 'Earthsplitter', element: 'earth', incantation: 'Mountain bones, break beneath my blade.', castTime: 0.45, cooldown: 9, mana: 16, range: 9, radius: 3.6, power: 2.1, kind: 'strike', fx: 'quake', color: 0xc8a070, light: 4, scale: 'atk', desc: 'Smash the ground ahead; foes in the crack are stunned.', e: { stun: 1.1 } }),
  mk({ id: 'warcry', cls: 'warrior', slot: 3, unlock: 6, name: 'WAR CRY', title: 'Roar of the Vanguard', element: 'physical', incantation: '', castTime: 0.2, cooldown: 18, mana: 18, range: 0, radius: 11, power: 0, kind: 'buff', fx: 'aura', color: 0xff8a4a, light: 4, scale: 'atk', desc: 'Taunt every monster nearby; you and your party hit 25 % harder for 10 s.', e: { taunt: true, party: true, buff: { atk: 0.25, dur: 10 } } }),
  mk({ id: 'leap', cls: 'warrior', slot: 4, unlock: 9, name: 'SKYFALL', title: 'Leap Strike', element: 'physical', incantation: '', castTime: 0.2, cooldown: 12, mana: 20, range: 12, radius: 3.4, power: 1.9, kind: 'dash', fx: 'quake', color: 0xffc070, light: 5, scale: 'atk', desc: 'Leap forward and crash down, knocking foes back.', e: { dash: 11, knock: 3 } }),
  mk({ id: 'ragnarok', cls: 'warrior', slot: 6, unlock: 12, ult: true, name: 'RAGNAROK', title: "Titan's Burning Wrath", element: 'fire', incantation: 'Blood of titans, burn in my veins. Let the earth remember my name in fire.', castTime: 1.0, cooldown: 60, mana: 45, range: 0, radius: 7.5, power: 4.6, kind: 'nova', fx: 'ignis', color: 0xff5a1a, light: 12, scale: 'atk', desc: 'ULTIMATE · Erupt in fire around you; heal for 20 % of the damage.', e: { buff: { lifesteal: 0.2, dur: 1.5 }, burn: true, dot: 0.3, dotDur: 4 } }),
  mk({ id: 'frenzy', cls: 'warrior', slot: 5, unlock: 20, adv: 'berserker', name: 'BLOOD FRENZY', title: 'Berserker Rage', element: 'fire', incantation: '', castTime: 0.1, cooldown: 30, mana: 15, range: 0, radius: 0, power: 0, kind: 'buff', fx: 'aura', color: 0xff2a2a, light: 6, scale: 'atk', desc: 'ADVANCED · +40 % attack, +15 % speed and 15 % lifesteal for 12 s.', e: { buff: { atk: 0.4, spd: 0.15, lifesteal: 0.15, dur: 12 } } }),
  mk({ id: 'banner', cls: 'warrior', slot: 5, unlock: 20, adv: 'warlord', name: 'BANNER OF THE CAPITAL', title: 'Warlord Standard', element: 'earth', incantation: 'Stand with me. The line does not break.', castTime: 0.5, cooldown: 35, mana: 25, range: 0, radius: 14, power: 0, kind: 'buff', fx: 'aura', color: 0xffd060, light: 6, scale: 'atk', desc: 'ADVANCED · Party gains +30 % defence and +15 % attack for 15 s.', e: { party: true, buff: { def: 0.3, atk: 0.15, dur: 15 } } }),

  // ---------------------------------------------------------------- MAGE (elements · staff)
  mk({ id: 'ignis', cls: 'mage', slot: 1, unlock: 1, name: 'IGNIS', title: 'Apocalyptic Flame', element: 'fire', incantation: 'From the ashes of the ancient flame, awaken and consume all that stands before me.', castTime: 1.6, cooldown: 6, mana: 28, range: 38, radius: 5.5, power: 2.6, kind: 'projectile', fx: 'ignis', color: 0xff6a1f, light: 9, scale: 'mag', desc: 'A fireball that bursts on impact. Leaves foes Burning.', e: { burn: true, dot: 0.25, dotDur: 3 } }),
  mk({ id: 'fulgur', cls: 'mage', slot: 2, unlock: 1, name: 'FULGUR', title: 'Spear of the Ninth Storm', element: 'lightning', incantation: 'Heaven, split open. Let the ninth storm descend as a spear and judge my enemy.', castTime: 0.9, cooldown: 4, mana: 18, range: 30, radius: 2.2, power: 1.9, kind: 'strike', fx: 'fulgur', color: 0x8fd4ff, light: 14, scale: 'mag', desc: 'Lightning strikes the target. ×1.6 on Soaked foes.' }),
  mk({ id: 'glacies', cls: 'mage', slot: 3, unlock: 4, name: 'GLACIES', title: 'Lance of the Frozen Sea', element: 'water', incantation: 'Still the tide, sharpen the cold, and pierce what moves.', castTime: 1.0, cooldown: 7, mana: 22, range: 34, radius: 2.5, power: 1.9, kind: 'projectile', fx: 'frost', color: 0x9fe6ff, light: 6, scale: 'mag', desc: 'An ice lance: slows 50 % and leaves foes Soaked and Chilled.', e: { slow: 0.5, slowDur: 3, soak: 6, chill: 4 } }),
  mk({ id: 'ventus', cls: 'mage', slot: 4, unlock: 8, name: 'VENTUS', title: 'Gale of the Open Sky', element: 'wind', incantation: 'Wind without a master, scatter them.', castTime: 0.4, cooldown: 10, mana: 20, range: 0, radius: 6.5, power: 1.4, kind: 'nova', fx: 'gale', color: 0xc8ffe8, light: 4, scale: 'mag', desc: 'A blast of wind that throws foes away. Fans Burning foes into a firestorm.', e: { knock: 5 } }),
  mk({ id: 'meteor', cls: 'mage', slot: 6, unlock: 12, ult: true, name: 'CAELUM RUENS', title: 'The Falling Heaven', element: 'fire', incantation: 'Stars that watched the Tower rise, fall now, and let the sky itself be my answer.', castTime: 2.2, cooldown: 75, mana: 60, range: 34, radius: 9, power: 5.2, kind: 'strike', fx: 'meteor', color: 0xff7a2a, light: 18, scale: 'mag', desc: 'ULTIMATE · Call down a meteor on the target area.', e: { burn: true, dot: 0.35, dotDur: 4, knock: 3 } }),
  mk({ id: 'infernus', cls: 'mage', slot: 5, unlock: 20, adv: 'archmage', name: 'INFERNUS', title: 'Archmage Firestorm', element: 'fire', incantation: 'Every flame I have ever spoken, answer together.', castTime: 1.4, cooldown: 22, mana: 40, range: 32, radius: 6.5, power: 3.0, kind: 'strike', fx: 'ignis', color: 0xff3a10, light: 14, scale: 'mag', desc: 'ADVANCED · A burning storm that keeps scorching for 6 s.', e: { burn: true, dot: 0.6, dotDur: 6 } }),
  mk({ id: 'tempus', cls: 'mage', slot: 5, unlock: 20, adv: 'chronomancer', name: 'TEMPUS', title: 'Hour of Stillness', element: 'time', incantation: 'Hold, seconds. Hold, heartbeat. Hold, world.', castTime: 0.8, cooldown: 28, mana: 35, range: 0, radius: 13, power: 0.8, kind: 'nova', fx: 'ring', color: 0xd8c8ff, light: 8, scale: 'mag', desc: 'ADVANCED · Foes nearby move 70 % slower for 5 s; your party is hastened.', e: { slow: 0.7, slowDur: 5, party: true, buff: { spd: 0.2, dur: 8 } } }),

  // ---------------------------------------------------------------- ARCHER (precision · bow)
  mk({ id: 'pierce', cls: 'archer', slot: 1, unlock: 1, name: 'PIERCING ARROW', title: 'Heart of the Hunt', element: 'physical', incantation: '', castTime: 0.5, cooldown: 4, mana: 10, range: 36, radius: 1.4, power: 1.9, kind: 'projectile', fx: 'arrow', color: 0xfff0c0, light: 2, scale: 'atk', desc: 'A charged shot that pierces armour.' }),
  mk({ id: 'arrowrain', cls: 'archer', slot: 2, unlock: 3, name: 'RAIN OF ARROWS', title: 'Hundred Feathers', element: 'wind', incantation: '', castTime: 0.6, cooldown: 10, mana: 18, range: 30, radius: 5, power: 1.6, kind: 'strike', fx: 'rain', color: 0xe8f0d0, light: 3, scale: 'atk', desc: 'Arrows rain on an area and slow everything in it.', e: { slow: 0.35, slowDur: 3 } }),
  mk({ id: 'huntmark', cls: 'archer', slot: 3, unlock: 6, name: "HUNTER'S MARK", title: 'Mark of the Forest', element: 'wind', incantation: '', castTime: 0.2, cooldown: 14, mana: 12, range: 36, radius: 1.6, power: 0.4, kind: 'strike', fx: 'ring', color: 0x9dff7a, light: 3, scale: 'atk', desc: 'Mark a foe: it takes 25 % more damage for 10 s.', e: { mark: 0.25, markDur: 10 } }),
  mk({ id: 'evade', cls: 'archer', slot: 4, unlock: 9, name: 'EVASIVE SHOT', title: 'Wind Step', element: 'wind', incantation: '', castTime: 0.1, cooldown: 11, mana: 14, range: 0, radius: 4.5, power: 1.2, kind: 'dash', fx: 'gale', color: 0xc8ffe8, light: 3, scale: 'atk', desc: 'Leap back 7 m, blasting and slowing whatever was chasing you.', e: { dash: -7, iframes: 0.3, slow: 0.4, slowDur: 3 } }),
  mk({ id: 'centum', cls: 'archer', slot: 6, unlock: 12, ult: true, name: 'VENTUS CENTUM', title: 'Storm of the Hundred Skies', element: 'wind', incantation: 'Every wind under every sky, carry my arrows home.', castTime: 1.4, cooldown: 60, mana: 40, range: 32, radius: 8, power: 4.4, kind: 'strike', fx: 'rain', color: 0xd8fff0, light: 10, scale: 'atk', desc: 'ULTIMATE · A storm of arrows over a wide area.', e: { slow: 0.5, slowDur: 4 } }),
  mk({ id: 'heartseeker', cls: 'archer', slot: 5, unlock: 20, adv: 'sniper', name: 'HEARTSEEKER', title: 'Sniper Shot', element: 'wind', incantation: '', castTime: 1.5, cooldown: 18, mana: 25, range: 52, radius: 1.5, power: 4.2, kind: 'projectile', fx: 'arrow', color: 0xffffff, light: 6, scale: 'atk', desc: 'ADVANCED · One perfect long-range shot.', e: { mark: 0.15, markDur: 6 } }),
  mk({ id: 'snare', cls: 'archer', slot: 5, unlock: 20, adv: 'ranger', name: 'THORN SNARE', title: 'Ranger Trap', element: 'earth', incantation: 'Roots, hold them.', castTime: 0.5, cooldown: 20, mana: 22, range: 26, radius: 4.5, power: 1.5, kind: 'strike', fx: 'quake', color: 0x7ad050, light: 4, scale: 'atk', desc: 'ADVANCED · Roots hold foes in place for 3 s while thorns cut them.', e: { root: 3, dot: 0.4, dotDur: 4 } }),

  // ---------------------------------------------------------------- ASSASSIN (burst · daggers)
  mk({ id: 'shadowstep', cls: 'assassin', slot: 1, unlock: 1, name: 'SHADOWSTEP', title: 'Step Through Night', element: 'darkness', incantation: '', castTime: 0.1, cooldown: 7, mana: 12, range: 12, radius: 2.6, power: 1.6, kind: 'dash', fx: 'shadow', color: 0x9a6aff, light: 4, scale: 'atk', desc: 'Vanish and reappear next to your target, striking it.', e: { dash: 10, iframes: 0.25 } }),
  mk({ id: 'venom', cls: 'assassin', slot: 2, unlock: 3, name: 'VENOM FANG', title: 'Twin Venom Cut', element: 'darkness', incantation: '', castTime: 0.15, cooldown: 6, mana: 12, range: 3.2, radius: 3.2, arc: 1.4, power: 1.3, kind: 'cone', fx: 'slash', color: 0x8aff6a, light: 3, scale: 'atk', desc: 'A poisoned double cut that keeps bleeding for 6 s.', e: { dot: 0.45, dotDur: 6 } }),
  mk({ id: 'smoke', cls: 'assassin', slot: 3, unlock: 6, name: 'SMOKE VEIL', title: 'Veil of Ash', element: 'darkness', incantation: '', castTime: 0.1, cooldown: 16, mana: 16, range: 0, radius: 6, power: 0.3, kind: 'nova', fx: 'shadow', color: 0x6a5a8a, light: 2, scale: 'atk', desc: 'Blind foes around you (stun 1.8 s) and slip away 30 % faster.', e: { stun: 1.8, buff: { spd: 0.3, dur: 4 } } }),
  mk({ id: 'knives', cls: 'assassin', slot: 4, unlock: 9, name: 'FAN OF KNIVES', title: 'Thousand Glints', element: 'physical', incantation: '', castTime: 0.2, cooldown: 9, mana: 18, range: 0, radius: 6.5, power: 1.6, kind: 'nova', fx: 'ring', color: 0xe0e8ff, light: 3, scale: 'atk', desc: 'Throw a ring of knives at everything around you.' }),
  mk({ id: 'mille', cls: 'assassin', slot: 6, unlock: 12, ult: true, name: 'UMBRA MILLE', title: 'Thousand Cuts of Night', element: 'darkness', incantation: 'Let the night have a thousand edges, and every one of them be mine.', castTime: 0.6, cooldown: 55, mana: 40, range: 4, radius: 4, arc: 3.2, power: 5.4, kind: 'cone', fx: 'shadow', color: 0xb070ff, light: 10, scale: 'atk', desc: 'ULTIMATE · A storm of cuts around you. Critical strikes guaranteed.', e: { buff: { crit: 1, dur: 0.8 } } }),
  mk({ id: 'deathmark', cls: 'assassin', slot: 5, unlock: 20, adv: 'shadowblade', name: 'DEATH MARK', title: 'Shadowblade Sentence', element: 'darkness', incantation: 'Your shadow is already mine.', castTime: 0.3, cooldown: 24, mana: 22, range: 14, radius: 1.8, power: 2.2, kind: 'strike', fx: 'shadow', color: 0x8a2aff, light: 6, scale: 'atk', desc: 'ADVANCED · Strike and mark: the foe takes 40 % more damage for 8 s.', e: { mark: 0.4, markDur: 8 } }),
  mk({ id: 'voidblink', cls: 'assassin', slot: 5, unlock: 20, adv: 'phantom', name: 'VOID BLINK', title: 'Phantom Fold', element: 'space', incantation: 'Space, fold.', castTime: 0.05, cooldown: 14, mana: 18, range: 15, radius: 4, power: 1.9, kind: 'dash', fx: 'shadow', color: 0x40e0ff, light: 6, scale: 'atk', desc: 'ADVANCED · Fold space 14 m forward, untouchable, and burst at the exit.', e: { dash: 14, iframes: 0.4 } }),

  // ---------------------------------------------------------------- KNIGHT (guardian · sword)
  mk({ id: 'bash', cls: 'knight', slot: 1, unlock: 1, name: 'SHIELD BASH', title: 'Iron Rebuke', element: 'physical', incantation: '', castTime: 0.15, cooldown: 7, mana: 10, range: 3.2, radius: 3.2, arc: 1.3, power: 1.4, kind: 'cone', fx: 'slash', color: 0xd0e0ff, light: 3, scale: 'atk', desc: 'Bash the foe in front: 1.5 s stun.', e: { stun: 1.5 } }),
  mk({ id: 'guard', cls: 'knight', slot: 2, unlock: 3, name: 'HOLY GUARD', title: 'Oath Shield', element: 'light', incantation: 'My oath is my wall.', castTime: 0.2, cooldown: 16, mana: 16, range: 0, radius: 0, power: 0, kind: 'buff', fx: 'aura', color: 0xffe9a8, light: 5, scale: 'atk', desc: 'A shield that absorbs 30 % of your max HP for 8 s.', e: { shield: 0.3, shieldDur: 8 } }),
  mk({ id: 'roar', cls: 'knight', slot: 3, unlock: 6, name: 'CHALLENGE', title: 'Taunting Roar', element: 'physical', incantation: '', castTime: 0.2, cooldown: 14, mana: 14, range: 0, radius: 11, power: 0, kind: 'buff', fx: 'aura', color: 0xa0c0ff, light: 4, scale: 'atk', desc: 'Every monster nearby attacks you; +30 % defence for 8 s.', e: { taunt: true, buff: { def: 0.3, dur: 8 } } }),
  mk({ id: 'charge', cls: 'knight', slot: 4, unlock: 9, name: 'CHARGE', title: 'Lance of the Capital', element: 'physical', incantation: '', castTime: 0.1, cooldown: 10, mana: 16, range: 13, radius: 3, power: 1.5, kind: 'dash', fx: 'dash', color: 0xd8e8ff, light: 3, scale: 'atk', desc: 'Charge 12 m forward and knock foes aside.', e: { dash: 12, knock: 3, stun: 0.6 } }),
  mk({ id: 'aegis', cls: 'knight', slot: 6, unlock: 12, ult: true, name: 'SANCTUS MURUS', title: 'Aegis of the Capital', element: 'light', incantation: 'Walls of the first city, rise around the ones I swore to keep.', castTime: 1.0, cooldown: 70, mana: 45, range: 0, radius: 13, power: 0, kind: 'buff', fx: 'lux', color: 0xffe9a8, light: 12, scale: 'atk', desc: 'ULTIMATE · Party shield (40 % max HP) and +50 % defence for 10 s.', e: { party: true, shield: 0.4, shieldDur: 10, buff: { def: 0.5, dur: 10 } } }),
  mk({ id: 'judgment', cls: 'knight', slot: 5, unlock: 20, adv: 'paladin', name: 'JUDGMENT', title: 'Paladin Verdict', element: 'light', incantation: 'Light, weigh them.', castTime: 0.6, cooldown: 18, mana: 28, range: 22, radius: 4.5, power: 3.0, kind: 'strike', fx: 'lux', color: 0xfff2c0, light: 10, scale: 'atk', desc: 'ADVANCED · Holy strike; allies near the target are healed.', e: { heal: 0.6, party: true } }),
  mk({ id: 'unbreak', cls: 'knight', slot: 5, unlock: 20, adv: 'guardian', name: 'UNBREAKABLE', title: 'Guardian Stance', element: 'earth', incantation: '', castTime: 0.1, cooldown: 30, mana: 20, range: 0, radius: 0, power: 0, kind: 'buff', fx: 'aura', color: 0xc8a070, light: 5, scale: 'atk', desc: 'ADVANCED · +80 % defence for 6 s, cannot be stunned.', e: { buff: { def: 0.8, dur: 6 }, cleanse: true } }),

  // ---------------------------------------------------------------- SUMMONER (pacts · staff)
  mk({ id: 'spiritbolt', cls: 'summoner', slot: 1, unlock: 1, name: 'ANIMA', title: 'Spirit Bolt', element: 'space', incantation: 'Little spirit, fly.', castTime: 0.8, cooldown: 3, mana: 14, range: 32, radius: 1.8, power: 1.6, kind: 'projectile', fx: 'frost', color: 0x70e0ff, light: 5, scale: 'mag', desc: 'A homing spirit bolt.' }),
  mk({ id: 'wolf', cls: 'summoner', slot: 2, unlock: 1, name: 'LUPUS', title: 'Call the Wolf Spirit', element: 'wind', incantation: 'Brother of the Ancient Forest, run with me.', castTime: 1.2, cooldown: 14, mana: 30, range: 0, radius: 0, power: 0.9, kind: 'summon', fx: 'summon', color: 0x9fe8ff, light: 6, scale: 'mag', desc: 'Summon a wolf spirit that fights beside you for 25 s (max 2).', e: { summon: { kind: 'wolf', dur: 25, power: 0.9, max: 2 } } }),
  mk({ id: 'chains', cls: 'summoner', slot: 3, unlock: 5, name: 'VINCULA', title: 'Chains of the Pact', element: 'space', incantation: 'By the old pact, bind.', castTime: 0.7, cooldown: 12, mana: 20, range: 28, radius: 3.5, power: 0.9, kind: 'strike', fx: 'ring', color: 0x70e0ff, light: 5, scale: 'mag', desc: 'Spectral chains root foes for 2.5 s.', e: { root: 2.5 } }),
  mk({ id: 'golem', cls: 'summoner', slot: 4, unlock: 9, name: 'SAXUM', title: 'Wake the Stone Golem', element: 'earth', incantation: 'Sleeper in the stone, stand and guard me.', castTime: 1.5, cooldown: 30, mana: 40, range: 0, radius: 0, power: 1.4, kind: 'summon', fx: 'summon', color: 0xc8a070, light: 6, scale: 'mag', desc: 'A stone golem that taunts monsters and soaks hits for 30 s.', e: { summon: { kind: 'golem', dur: 30, power: 1.4, max: 1 } } }),
  mk({ id: 'ancient', cls: 'summoner', slot: 6, unlock: 12, ult: true, name: 'PORTA ANTIQUA', title: 'Gate of the Ancients', element: 'fire', incantation: 'Gate that was sealed before the Tower, open. Old one, I call you by your true name.', castTime: 2.0, cooldown: 80, mana: 60, range: 0, radius: 0, power: 2.6, kind: 'summon', fx: 'summon', color: 0xff8a3a, light: 14, scale: 'mag', desc: 'ULTIMATE · An ancient drake spirit fights for 18 s, breathing fire.', e: { summon: { kind: 'drake', dur: 18, power: 2.6, max: 1 } } }),
  mk({ id: 'pack', cls: 'summoner', slot: 5, unlock: 20, adv: 'spiritlord', name: 'PACK COMMAND', title: 'Spirit Lord Howl', element: 'wind', incantation: 'Hunt.', castTime: 0.3, cooldown: 25, mana: 20, range: 0, radius: 30, power: 0, kind: 'buff', fx: 'aura', color: 0x9fe8ff, light: 6, scale: 'mag', desc: 'ADVANCED · Your spirits deal +60 % damage and are fully healed.', e: { heal: 9, buff: { mag: 0.15, dur: 10 } } }),
  mk({ id: 'rift', cls: 'summoner', slot: 5, unlock: 20, adv: 'voidcaller', name: 'ABYSSUS', title: 'Void Rift', element: 'darkness', incantation: 'Open, mouth of nothing.', castTime: 1.0, cooldown: 22, mana: 35, range: 28, radius: 6, power: 2.2, kind: 'strike', fx: 'shadow', color: 0x7a2aff, light: 10, scale: 'mag', desc: 'ADVANCED · A rift that pulls in and devours for 5 s.', e: { dot: 0.55, dotDur: 5, slow: 0.5, slowDur: 5 } }),

  // ---------------------------------------------------------------- HEALER (light · staff)
  mk({ id: 'lux', cls: 'healer', slot: 1, unlock: 1, name: 'LUX', title: 'Sanctuary of the First Dawn', element: 'light', incantation: 'Light that was before the Tower, bloom within me. Mend the faithful, blind the wicked.', castTime: 1.2, cooldown: 12, mana: 30, range: 0, radius: 8, power: 1.2, kind: 'nova', fx: 'lux', color: 0xffe9a8, light: 7, scale: 'mag', desc: 'Heal everyone around you; blind (stun) foes 2.2 s.', e: { heal: 2.4, party: true, stun: 2.2 } }),
  mk({ id: 'mend', cls: 'healer', slot: 2, unlock: 1, name: 'SANA', title: 'Mending Light', element: 'light', incantation: 'Be whole.', castTime: 0.9, cooldown: 3, mana: 18, range: 26, radius: 0, power: 0, kind: 'heal', fx: 'heal', color: 0xfff2b0, light: 5, scale: 'mag', desc: 'A strong heal on your target ally (or yourself).', e: { heal: 3.2 } }),
  mk({ id: 'aqua', cls: 'healer', slot: 3, unlock: 5, name: 'AQUA SANCTA', title: 'Purifying Rain', element: 'water', incantation: 'Rain of the first spring, wash the wounds away.', castTime: 1.0, cooldown: 16, mana: 28, range: 0, radius: 11, power: 0.6, kind: 'nova', fx: 'heal', color: 0x8fd8ff, light: 5, scale: 'mag', desc: 'Party heals over 8 s and is cleansed; foes are Soaked.', e: { party: true, hot: 0.7, hotDur: 8, cleanse: true, soak: 6 } }),
  mk({ id: 'smite', cls: 'healer', slot: 4, unlock: 8, name: 'RADIUS', title: 'Smite of Dawn', element: 'light', incantation: 'Burn, shadow.', castTime: 0.7, cooldown: 5, mana: 16, range: 28, radius: 2.2, power: 1.7, kind: 'strike', fx: 'fulgur', color: 0xfff0a0, light: 10, scale: 'mag', desc: 'A ray of light that sears one foe.' }),
  mk({ id: 'renascor', cls: 'healer', slot: 6, unlock: 12, ult: true, name: 'RENASCOR', title: 'Resurrection Dawn', element: 'light', incantation: 'Morning, come back for them. Let none of mine stay fallen tonight.', castTime: 2.0, cooldown: 90, mana: 70, range: 0, radius: 15, power: 0, kind: 'nova', fx: 'lux', color: 0xfff6d0, light: 16, scale: 'mag', desc: 'ULTIMATE · Revive fallen allies, fully heal and shield the party.', e: { party: true, heal: 20, revive: true, shield: 0.25, shieldDur: 8 } }),
  mk({ id: 'barrier', cls: 'healer', slot: 5, unlock: 20, adv: 'saint', name: 'DIVINE BARRIER', title: 'Saint Ward', element: 'light', incantation: 'Nothing passes.', castTime: 0.6, cooldown: 25, mana: 35, range: 0, radius: 13, power: 0, kind: 'buff', fx: 'lux', color: 0xfff2c0, light: 9, scale: 'mag', desc: 'ADVANCED · Party shield worth 30 % max HP for 10 s.', e: { party: true, shield: 0.3, shieldDur: 10 } }),
  mk({ id: 'redux', cls: 'healer', slot: 5, unlock: 20, adv: 'oracle', name: 'TEMPUS REDUX', title: 'Oracle Rewind', element: 'time', incantation: 'Turn back, little hour.', castTime: 0.5, cooldown: 30, mana: 30, range: 26, radius: 0, power: 0, kind: 'heal', fx: 'ring', color: 0xd8c8ff, light: 8, scale: 'mag', desc: 'ADVANCED · Rewind an ally: big heal, cleanse, and their cooldowns tick 5 s.', e: { heal: 5, cleanse: true } }),
];

export const skillById = (id: string) => SKILLS.find((s) => s.id === id);
export const ADVANCED: Record<ClassId, { id: string; name: string; desc: string; bonus: Partial<Record<'atk' | 'mag' | 'def' | 'hp' | 'mp' | 'crit', number>> }[]> = {
  warrior: [{ id: 'berserker', name: 'Berserker', desc: 'Fury and lifesteal. Hits harder the lower you fall.', bonus: { atk: 0.15, crit: 0.05 } }, { id: 'warlord', name: 'Warlord', desc: 'Battlefield commander; buffs the whole party.', bonus: { def: 0.12, hp: 0.12 } }],
  mage: [{ id: 'archmage', name: 'Archmage', desc: 'Master of fire and storm; raw destruction.', bonus: { mag: 0.18 } }, { id: 'chronomancer', name: 'Chronomancer', desc: 'Bends Time and Space; control and haste.', bonus: { mag: 0.08, mp: 0.2 } }],
  archer: [{ id: 'sniper', name: 'Sniper', desc: 'Extreme range and critical shots.', bonus: { atk: 0.1, crit: 0.08 } }, { id: 'ranger', name: 'Ranger', desc: 'Traps, roots and the forest itself.', bonus: { atk: 0.08, hp: 0.1 } }],
  assassin: [{ id: 'shadowblade', name: 'Shadowblade', desc: 'Darkness marks and executions.', bonus: { atk: 0.14, crit: 0.06 } }, { id: 'phantom', name: 'Phantom', desc: 'Folds Space; untouchable mobility.', bonus: { atk: 0.08, def: 0.08 } }],
  knight: [{ id: 'paladin', name: 'Paladin', desc: 'Holy damage that heals allies.', bonus: { atk: 0.08, mag: 0.15 } }, { id: 'guardian', name: 'Guardian', desc: 'The wall nothing breaks.', bonus: { def: 0.2, hp: 0.15 } }],
  summoner: [{ id: 'spiritlord', name: 'Spirit Lord', desc: 'Commands a pack of spirits.', bonus: { mag: 0.12, hp: 0.08 } }, { id: 'voidcaller', name: 'Void Caller', desc: 'Calls on the Darkness between floors.', bonus: { mag: 0.16 } }],
  healer: [{ id: 'saint', name: 'Saint', desc: 'Barriers and the strongest heals.', bonus: { mag: 0.12, mp: 0.15 } }, { id: 'oracle', name: 'Oracle', desc: 'Time magic that undoes wounds.', bonus: { mag: 0.1, def: 0.08 } }],
};
export const ADVANCE_LEVEL = 20;
export const MAX_RANK = 5;

/** The skills a character of this class can see (5 class skills + both advanced options). */
export const classSkills = (cls: ClassId) => SKILLS.filter((s) => s.cls === cls);
/** The skill bound to a slot for this character (slot 5 depends on the advanced class). */
export function skillForSlot(cls: ClassId, slot: number, adv?: string | null): SkillDef | undefined {
  return SKILLS.find((s) => s.cls === cls && s.slot === slot && (slot !== 5 || s.adv === adv));
}
/** Rank-scaled numbers: +12 % power and −5 % cooldown per rank above 1. */
export function rankScale(s: SkillDef, rank: number) {
  const r = Math.max(1, Math.min(MAX_RANK, rank)) - 1;
  return { power: s.power * (1 + 0.12 * r), cooldown: s.cooldown * (1 - 0.05 * r), mana: Math.round(s.mana * (1 + 0.04 * r)) };
}

// ------------------------------------------------------------------ attributes (stat points)
export type Attr = 'str' | 'int' | 'vit' | 'agi' | 'spi';
export const ATTRS: { id: Attr; name: string; desc: string }[] = [
  { id: 'str', name: 'Strength', desc: '+2 attack per point' },
  { id: 'int', name: 'Intellect', desc: '+2 magic per point' },
  { id: 'vit', name: 'Vitality', desc: '+14 max HP and +0.6 defence per point' },
  { id: 'agi', name: 'Agility', desc: '+0.6 % critical chance and +0.4 % move speed per point' },
  { id: 'spi', name: 'Spirit', desc: '+9 max mana and faster mana regen per point' },
];
export const STAT_POINTS_PER_LEVEL = 3;
export const SKILL_POINTS_PER_LEVEL = 1;
export const pointsEarned = (level: number) => ({ stat: (level - 1) * STAT_POINTS_PER_LEVEL, skill: (level - 1) * SKILL_POINTS_PER_LEVEL });

// ------------------------------------------------------------------ weapon mastery
export const masteryLevel = (xp: number) => Math.min(20, Math.floor(Math.sqrt(Math.max(0, xp) / 12)));
export const masteryBonus = (xp: number) => 1 + 0.015 * masteryLevel(xp);

// ------------------------------------------------------------------ titles
export interface TitleDef { id: string; name: string; desc: string; bonus?: string }
export const TITLES: TitleDef[] = [
  { id: 'newcomer', name: 'Newcomer of the Gate', desc: 'Enter the world.' },
  { id: 'first_blood', name: 'First Blood', desc: 'Defeat your first monster.' },
  { id: 'slayer', name: 'Slayer', desc: 'Defeat 100 monsters.' },
  { id: 'reaper', name: 'Reaper of the Hollow', desc: 'Defeat 500 monsters.' },
  { id: 'seasoned', name: 'Seasoned Adventurer', desc: 'Reach level 10.' },
  { id: 'ascendant', name: 'Ascendant', desc: 'Choose an advanced class.' },
  { id: 'iron_wall', name: 'Iron Wall', desc: 'Parry 25 attacks.' },
  { id: 'wind_dancer', name: 'Wind Dancer', desc: 'Dodge 50 attacks.' },
  { id: 'combo_artist', name: 'Combo Artist', desc: 'Land a 10-hit combo.' },
  { id: 'undying', name: 'The Undying', desc: 'Fall 10 times and keep going.' },
  { id: 'bossbreaker', name: 'Bossbreaker', desc: 'Defeat a field boss.' },
  { id: 'weapon_master', name: 'Weapon Master', desc: 'Reach mastery 10 with a weapon.' },
  { id: 'friend_capital', name: 'Friend of the Capital', desc: 'Reach Honored with the Capital.' },
  { id: 'climber', name: 'Climber', desc: 'Clear floor 10 of the Hundredth Tower.' },
  { id: 'storm_caller', name: 'Storm-Caller', desc: 'Cast lightning in a storm.' },
  { id: 'elementalist', name: 'Elementalist', desc: 'Trigger 10 elemental combos.' },
];
export const titleById = (id: string) => TITLES.find((t) => t.id === id);

// ------------------------------------------------------------------ reputation
export const FACTIONS: { id: string; name: string; region: string }[] = [
  { id: 'capital', name: 'The Capital', region: 'capital' },
  { id: 'wardens', name: 'Forest Wardens', region: 'forest' },
  { id: 'mountain', name: 'Mountain Kingdom', region: 'mountain' },
  { id: 'nomads', name: 'Sand Nomads', region: 'desert' },
  { id: 'clans', name: 'Frost Clans', region: 'frozen' },
  { id: 'veil', name: 'Order of the Veil', region: 'forbidden' },
  { id: 'climbers', name: 'Tower Climbers', region: 'tower' },
];
export const REP_RANKS = [
  { name: 'Hostile', min: -1e9 }, { name: 'Neutral', min: 0 }, { name: 'Friendly', min: 300 }, { name: 'Honored', min: 1000 }, { name: 'Revered', min: 3000 }, { name: 'Exalted', min: 8000 },
];
export function repRank(v: number) { let r = REP_RANKS[0]; for (const x of REP_RANKS) if (v >= x.min) r = x; return r.name; }

// ------------------------------------------------------------------ combos
export const COMBO_WINDOW = 1.7;           // seconds between hits to keep a combo
/** Basic attack chain: every third hit is a finisher; long chains add damage. */
export function comboPower(n: number) {
  const finisher = n > 0 && n % 3 === 0;
  return { mul: (finisher ? 1.8 : 1) * (1 + Math.min(0.3, n * 0.02)), finisher };
}
/** Elemental reactions on a target's statuses. */
export function reaction(el: Element, st: { soaked?: boolean; burning?: boolean; chilled?: boolean }): { mul: number; name: string } | null {
  if (el === 'lightning' && st.soaked) return { mul: 1.6, name: 'CONDUCTED' };
  if (el === 'wind' && st.burning) return { mul: 1.5, name: 'FIRESTORM' };
  if ((el === 'earth' || el === 'physical') && st.chilled) return { mul: 1.4, name: 'SHATTER' };
  if (el === 'fire' && st.chilled) return { mul: 1.3, name: 'MELT' };
  if (el === 'light' && st.burning) return { mul: 1.25, name: 'RADIANCE' };
  return null;
}

/** Summoned spirits (models are monster rigs drawn as glowing translucent spirits). */
export const SUMMONS: Record<string, { name: string; model: string; hp: number; range: number; cd: number; speed: number; ranged: boolean; tint: number; scale: number; el: Element }> = {
  wolf: { name: 'Wolf Spirit', model: 'Skeleton_Minion', hp: 0.45, range: 2.2, cd: 1.1, speed: 5.2, ranged: false, tint: 0x9fe8ff, scale: 0.85, el: 'wind' },
  golem: { name: 'Stone Golem', model: 'Skeleton_Warrior', hp: 1.4, range: 2.6, cd: 1.8, speed: 3.2, ranged: false, tint: 0xc8a070, scale: 1.45, el: 'earth' },
  drake: { name: 'Ancient Drake', model: 'Skeleton_Mage', hp: 1.0, range: 14, cd: 1.6, speed: 5.0, ranged: true, tint: 0xff8a3a, scale: 1.7, el: 'fire' },
};
