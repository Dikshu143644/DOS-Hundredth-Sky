import type { ClassId } from './combat';

export const PROTOCOL_VERSION = 3;
export const SERVER_TICK = 20;           // snapshots per second
export const INTERP_DELAY_MS = 110;      // remote entity interpolation delay

export interface Appearance { tint: number; accent: number; headgear: boolean; cape: boolean; scale: number }
export interface CharacterSummary { id: string; name: string; cls: ClassId; level: number; appearance: Appearance; zone: string; created: number }

/** Entity in a snapshot (compact field names keep packets small). */
export interface NetEntity {
  id: number;
  t: 'p' | 'm' | 'n' | 'b';     // player, monster, npc, bot player
  x: number; y: number; z: number; r: number; // r = yaw
  a: string;                    // animation state
  hp: number; mhp: number;
  n?: string;                   // name (sent on first sight)
  k?: string;                   // model / class / kind
  ap?: Appearance;
  lv?: number;
  tg?: number;                  // current target id
  c?: string;                   // casting spell id
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
  | { type: 'input'; seq: number; mx: number; mz: number; yaw: number; jump: boolean; sprint: boolean; walk: boolean; dt: number }
  | { type: 'attack'; yaw: number; target?: number }
  | { type: 'cast'; spell: string; target?: number; yaw: number; aimX?: number; aimY?: number; aimZ?: number }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number; rtt?: number }
  | { type: 'talk'; npc: number; text: string }
  | { type: 'interact'; target: number }
  | { type: 'respawn' };

export interface SelfState { hp: number; mhp: number; mp: number; mmp: number; xp: number; xpNext: number; level: number; cds: Record<string, number>; gold: number }

export type S2C =
  | { type: 'welcome'; v: number; server: string; mode: 'online' | 'offline'; llm: boolean; motd: string }
  | { type: 'auth'; ok: boolean; error?: string; token?: string; user?: string }
  | { type: 'chars'; list: CharacterSummary[] }
  | { type: 'charError'; error: string }
  | { type: 'joined'; id: number; t: number; worldTime: number; weather: string; char: CharacterSummary; self: SelfState; inventory: { item: string; rarity: string; n: number }[]; quests: QuestView[] }
  | { type: 'snap'; t: number; ack: number; me: { x: number; y: number; z: number; vx: number; vy: number; vz: number; g: boolean; sw: boolean; yaw: number }; ents: NetEntity[]; gone: number[]; self: SelfState; worldTime: number; weather: string }
  | { type: 'pong'; t: number; st: number }
  | { type: 'chat'; from: string; text: string; channel: 'say' | 'system' | 'npc' | 'world' }
  | { type: 'fx'; kind: 'cast' | 'spell' | 'hit' | 'death' | 'levelup' | 'attack' | 'loot' | 'heal' | 'castfail'; src?: number; dst?: number; spell?: string; x?: number; y?: number; z?: number; amount?: number; crit?: boolean; weak?: boolean; text?: string; tx?: number; ty?: number; tz?: number }
  | { type: 'loot'; items: { item: string; rarity: string }[]; gold: number }
  | { type: 'npcSay'; npc: number; name: string; text: string; mood?: string; source: 'llm' | 'scripted' }
  | { type: 'quest'; quest: QuestView; event: 'discovered' | 'progress' | 'complete' | 'step' }
  | { type: 'notice'; text: string; style?: 'info' | 'rank' | 'levelup' | 'warn' }
  | { type: 'died'; by: string }
  | { type: 'kick'; reason: string };

export interface QuestStepView { text: string; done: boolean; progress?: string }
export interface QuestView { id: string; rank: string; title: string; hook: string; steps: QuestStepView[]; current: number; hidden: boolean; complete: boolean; reward: string; source: 'llm' | 'procedural' }

export const sanitizeName = (s: string) => s.replace(/[^A-Za-z0-9 _\-'\u00C0-\u024F]/g, '').trim().slice(0, 16);
export const sanitizeChat = (s: string) => s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 160);
