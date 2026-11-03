export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export interface QualityPreset {
  pixelRatio: number; shadows: boolean; shadowSize: number; shadowRange: number; ao: boolean; bloom: boolean; godrays: boolean;
  grass: number; treeNear: number; treeFar: number; terrainSeg: number; spellShadows: boolean; maxLights: number; smaa: boolean; drawDist: number; rain: number; clouds: boolean;
}
export const PRESETS: Record<Quality, QualityPreset> = {
  low:    { pixelRatio: 0.7, shadows: false, shadowSize: 1024, shadowRange: 40, ao: false, bloom: false, godrays: false, grass: 0,     treeNear: 35,  treeFar: 220, terrainSeg: 160, spellShadows: false, maxLights: 2, smaa: false, drawDist: 1200, rain: 1500, clouds: false },
  medium: { pixelRatio: 1.0, shadows: true,  shadowSize: 2048, shadowRange: 55, ao: false, bloom: true,  godrays: false, grass: 14000, treeNear: 55,  treeFar: 330, terrainSeg: 256, spellShadows: false, maxLights: 4, smaa: false, drawDist: 2600, rain: 3500, clouds: true },
  high:   { pixelRatio: 1.0, shadows: true,  shadowSize: 2048, shadowRange: 70, ao: true,  bloom: true,  godrays: true,  grass: 30000, treeNear: 75,  treeFar: 420, terrainSeg: 320, spellShadows: true,  maxLights: 6, smaa: true,  drawDist: 6000, rain: 6000, clouds: true },
  ultra:  { pixelRatio: 1.5, shadows: true,  shadowSize: 4096, shadowRange: 90, ao: true,  bloom: true,  godrays: true,  grass: 52000, treeNear: 110, treeFar: 520, terrainSeg: 400, spellShadows: true,  maxLights: 8, smaa: true,  drawDist: 6000, rain: 9000, clouds: true },
};

export const DEFAULT_BINDINGS: Record<string, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', walk: 'KeyC',
  spell1: 'Digit1', spell2: 'Digit2', spell3: 'Digit3', spell4: 'Digit4', spell5: 'Digit5', ult: 'KeyR', dodge: 'KeyQ', parry: 'KeyV', hero: 'KeyP', status: 'KeyU', ranks: 'KeyL', fusion1: 'KeyG', fusion2: 'KeyH', fusion3: 'KeyN', attack: 'KeyF', interact: 'KeyE', target: 'Tab', chat: 'Enter', map: 'KeyM', quests: 'KeyJ', inventory: 'KeyI', armory: 'KeyK', menu: 'Escape',
};
export const BINDING_LABELS: Record<string, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump', sprint: 'Sprint', walk: 'Walk toggle',
  spell1: 'Skill 1', spell2: 'Skill 2', spell3: 'Skill 3', spell4: 'Skill 4', spell5: 'Advanced-class skill', ult: 'Ultimate', dodge: 'Dodge roll (i-frames)', parry: 'Parry (time it on the swing)', hero: 'Hero panel: stats, skills, titles', status: 'Status window & skill fusion', ranks: 'Rankings (adventurer rank, power leaderboard)', fusion1: 'Fusion skill 1', fusion2: 'Fusion skill 2', fusion3: 'Fusion skill 3', attack: 'Basic attack (chain = combo)', interact: 'Talk / interact', target: 'Cycle target', chat: 'Chat', map: 'World map & fast travel', quests: 'Quest log', inventory: 'Inventory & equipment', armory: 'Legendary armory', menu: 'Menu',
};

export interface Settings {
  quality: Quality; renderScale: number; fov: number; showFps: boolean; master: number; music: number; sfx: number; voice: number; chantVoice: boolean;
  sensitivity: number; invertY: boolean; bindings: Record<string, string>; timeOverride: number | null;
}
const KEY = 'dos.settings.v2';
export function detectQuality(): Quality {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  if (mobile) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? 'high' : 'medium';
}
export function loadSettings(): Settings {
  const def: Settings = { quality: detectQuality(), renderScale: 1, fov: 60, showFps: true, master: 0.8, music: 0.55, sfx: 0.8, voice: 0.8, chantVoice: true, sensitivity: 1, invertY: false, bindings: { ...DEFAULT_BINDINGS }, timeOverride: null };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) return { ...def, ...s, bindings: { ...DEFAULT_BINDINGS, ...(s.bindings || {}) } };
  } catch { /* ignore */ }
  const q = new URLSearchParams(location.search).get('quality') as Quality | null;
  if (q && PRESETS[q]) def.quality = q;
  return def;
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }
export const settings = loadSettings();
{
  const q = new URLSearchParams(location.search).get('quality') as Quality | null;
  if (q && PRESETS[q]) settings.quality = q;
}
