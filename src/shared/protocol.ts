import type { ClassId } from './combat';

export const PROTOCOL_VERSION = 5;
export const SERVER_TICK = 20;           // snapshots per second
export const INTERP_DELAY_MS = 110;      // remote entity interpolation delay

export interface Appearance { tint: number; accent: number; headgear: boolean; cape: boolean; scale: number; body?: 'm' | 'f' }
export interface CharacterSummary { id: string; name: string; cls: ClassId; level: number; appearance: Appearance; zone: string; created: number }

/** Entity in a snapshot (compact field names keep packets small). */
export interface NetEntity {
  id: number;
  t: 'p' | 'm' | 'n' | 'b' | 's'; // player, monster, npc, bot player, summon
  x: number; y: number; z: number; r: number; // r = yaw
  a: string;                    // animation state
  hp: number; mhp: number;
  n?: string;                   // name (sent on first sight)
  k?: string;                   // model / class / kind
  ap?: Appearance;
  w?: string;            // equipped weapon item id (players/bots) — drawn in their hand
  lv?: number;
  tg?: number;                  // current target id
  c?: string;                   // casting spell id
  ti?: string;                  // displayed title (players)
  sf?: string;                  // status flags: stun,root,slow,mark,soak,burn,chill,dot,shield,buff,weak
  bs?: boolean;                 // boss
}

export type C2S =
  | { type: 'hello'; v: number }
  | { type: 'register'; user: string; pass: string }
  | { type: 'login'; user: string; pass: string }
  | { type: 'resume'; token: string }
  | { type: 'chars' }
  | { type: 'createChar'; name: string; cls: ClassId; appearance: Appearance }
  | { type: 'deleteChar'; id: string }
  | { type: 'join'; charId: string }
  | { type: 'input'; seq: number; mx: number; mz: number; yaw: number; jump: boolean; sprint: boolean; walk: boolean; dt: number; dodge?: boolean }
  | { type: 'parry' }
  | { type: 'resync' }
  | { type: 'allocStat'; attr: string; n?: number }
  | { type: 'resetStats' }
  | { type: 'rankSkill'; skill: string }
  | { type: 'advance'; adv: string }
  | { type: 'setTitle'; title: string | null }
  | { type: 'attack'; yaw: number; target?: number }
  | { type: 'cast'; spell: string; target?: number; yaw: number; aimX?: number; aimY?: number; aimZ?: number }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number; rtt?: number }
  | { type: 'talk'; npc: number; text: string }
  | { type: 'interact'; target: number }
  | { type: 'respawn' }
  | { type: 'equip'; item: string }
  | { type: 'unequip'; slot: string };

export interface SelfState { hp: number; mhp: number; mp: number; mmp: number; xp: number; xpNext: number; level: number; cds: Record<string, number>; gold: number;
  /** movement multiplier the server applies (slows, buffs, class speed) so prediction matches */ sm?: number; sf?: string; sh?: number; combo?: number; zone?: string }
export interface ProgressView {
  attrs: Record<'str' | 'int' | 'vit' | 'agi' | 'spi', number>; statPoints: number; skillPoints: number; ranks: Record<string, number>; adv: string | null;
  titles: string[]; title: string | null; rep: Record<string, number>; mastery: Record<string, number>; counters: Record<string, number>;
  stats: { maxHp: number; maxMp: number; atk: number; mag: number; def: number; crit: number; spd: number; mpRegen: number }; deaths: number; kills: number;
}

export type S2C =
  | { type: 'welcome'; v: number; server: string; mode: 'online' | 'offline'; llm: boolean; motd: string }
  | { type: 'auth'; ok: boolean; error?: string; token?: string; user?: string }
  | { type: 'chars'; list: CharacterSummary[] }
  | { type: 'charError'; error: string }
  | { type: 'joined'; id: number; t: number; worldTime: number; weather: string; char: CharacterSummary; self: SelfState; inventory: { item: string; rarity: string; n: number }[]; quests: QuestView[]; equipment?: Record<string, string> }
  | { type: 'snap'; t: number; ack: number; me: { x: number; y: number; z: number; vx: number; vy: number; vz: number; g: boolean; sw: boolean; yaw: number; dg?: number; dc?: number; ddx?: number; ddz?: number }; ents: NetEntity[]; gone: number[]; self: SelfState; worldTime: number; weather: string }
  | { type: 'pong'; t: number; st: number }
  | { type: 'chat'; from: string; text: string; channel: 'say' | 'system' | 'npc' | 'world' }
  | { type: 'fx'; kind: 'cast' | 'spell' | 'hit' | 'death' | 'levelup' | 'attack' | 'loot' | 'heal' | 'castfail' | 'combo' | 'dodge' | 'parry' | 'parrystance' | 'react' | 'status' | 'dash' | 'buff'; src?: number; dst?: number; spell?: string; x?: number; y?: number; z?: number; amount?: number; crit?: boolean; weak?: boolean; text?: string; tx?: number; ty?: number; tz?: number }
  | { type: 'loot'; items: { item: string; rarity: string }[]; gold: number }
  | { type: 'npcSay'; npc: number; name: string; text: string; mood?: string; source: 'llm' | 'scripted' }
  | { type: 'quest'; quest: QuestView; event: 'discovered' | 'progress' | 'complete' | 'step' }
  | { type: 'notice'; text: string; style?: 'info' | 'rank' | 'levelup' | 'warn' }
  | { type: 'died'; by: string; xpLost?: number; goldLost?: number; at?: string; wait?: number }
  | { type: 'progress'; p: ProgressView }
  | { type: 'kick'; reason: string }
  | { type: 'equipment'; equipment: Record<string, string>; inventory: { item: string; rarity: string; n: number }[]; ok: boolean; error?: string };

export interface QuestStepView { text: string; done: boolean; progress?: string }
export interface QuestView { id: string; rank: string; title: string; hook: string; steps: QuestStepView[]; current: number; hidden: boolean; complete: boolean; reward: string; source: 'llm' | 'procedural' }

export const sanitizeName = (s: string) => s.replace(/[^A-Za-z0-9 _\-'\u00C0-\u024F]/g, '').trim().slice(0, 16);
export const sanitizeChat = (s: string) => s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 160);
