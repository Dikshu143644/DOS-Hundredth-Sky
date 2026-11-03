import * as THREE from 'three';
import type { GameClient } from './client';
import type { CharacterSummary, NetEntity, QuestView, SelfState } from '../../shared/protocol';
import { SpellDef, classById } from '../../shared/combat';
import { skillForSlot, rankScale, SKILLS } from '../../shared/skills';
import type { ProgressView } from '../../shared/protocol';
import { NPCS } from '../../server/core/npcdefs';
import { buildZone, POIS, poiAt, LAKE, ROADS, TOWER, heightAt, REGION, WATER_LEVEL } from '../../shared/world';
import { settings } from '../settings';
import { openSettings } from '../ui/settings';
import { audio } from '../audio';

const el = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function spellIcon(sp: SpellDef | 'attack', size = 64): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  const col = sp === 'attack' ? '#e8e0c8' : '#' + sp.color.toString(16).padStart(6, '0');
  const bg = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 1.4);
  bg.addColorStop(0, col); bg.addColorStop(0.45, 'rgba(20,20,30,.9)'); bg.addColorStop(1, '#05070c');
  g.fillStyle = bg; g.fillRect(0, 0, size, size);
  g.strokeStyle = col; g.lineWidth = 2.5; g.shadowColor = col; g.shadowBlur = 10; g.translate(size / 2, size / 2);
  if (sp === 'attack') { g.beginPath(); g.moveTo(-14, 14); g.lineTo(14, -14); g.moveTo(8, -16); g.lineTo(16, -8); g.moveTo(-16, 8); g.lineTo(-8, 16); g.stroke(); }
  else if (sp.id === 'ignis') { g.beginPath(); for (let i = 0; i < 3; i++) { g.moveTo(-10 + i * 10, 16); g.quadraticCurveTo(-18 + i * 12, -2, -4 + i * 6, -18 + i * 4); } g.stroke(); g.beginPath(); g.arc(0, 6, 9, 0, Math.PI * 2); g.stroke(); }
  else if (sp.id === 'fulgur' || sp.fx === 'fulgur') { g.beginPath(); g.moveTo(6, -20); g.lineTo(-6, 0); g.lineTo(4, 0); g.lineTo(-6, 20); g.stroke(); }
  else if (sp.fx === 'slash') { g.beginPath(); g.arc(-4, 6, 18, -1.4, 0.2); g.stroke(); g.beginPath(); g.arc(4, -2, 14, -1.2, 0.4); g.stroke(); }
  else if (sp.fx === 'arrow' || sp.fx === 'rain') { const n = sp.fx === 'rain' ? 3 : 1; for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * 10; g.beginPath(); g.moveTo(-14 + o, 14); g.lineTo(12 + o, -12); g.moveTo(12 + o, -12); g.lineTo(4 + o, -12); g.moveTo(12 + o, -12); g.lineTo(12 + o, -4); g.stroke(); } }
  else if (sp.fx === 'quake') { g.beginPath(); g.moveTo(-20, 8); g.lineTo(-8, 2); g.lineTo(-2, 12); g.lineTo(6, 0); g.lineTo(20, 6); g.moveTo(-6, -14); g.lineTo(0, -4); g.lineTo(6, -14); g.stroke(); }
  else if (sp.fx === 'dash' || sp.fx === 'shadow') { for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-18, -8 + i * 8); g.lineTo(6, -8 + i * 8); g.stroke(); } g.beginPath(); g.moveTo(8, -14); g.lineTo(18, 0); g.lineTo(8, 14); g.stroke(); }
  else if (sp.fx === 'aura' || sp.kind === 'buff') { g.beginPath(); g.moveTo(0, -18); g.lineTo(14, -10); g.lineTo(12, 8); g.lineTo(0, 18); g.lineTo(-12, 8); g.lineTo(-14, -10); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(0, -8); g.lineTo(0, 8); g.moveTo(-7, 0); g.lineTo(7, 0); g.stroke(); }
  else if (sp.fx === 'heal') { g.lineWidth = 5; g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 14); g.moveTo(-14, 0); g.lineTo(14, 0); g.stroke(); }
  else if (sp.fx === 'summon') { g.beginPath(); g.arc(0, 0, 15, 0, Math.PI * 2); g.stroke(); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2, b = ((i + 2) / 5) * Math.PI * 2 - Math.PI / 2; g.moveTo(Math.cos(a) * 15, Math.sin(a) * 15); g.lineTo(Math.cos(b) * 15, Math.sin(b) * 15); } g.stroke(); }
  else if (sp.fx === 'frost') { for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI; g.beginPath(); g.moveTo(Math.cos(a) * 18, Math.sin(a) * 18); g.lineTo(-Math.cos(a) * 18, -Math.sin(a) * 18); g.stroke(); } }
  else if (sp.fx === 'gale' || sp.fx === 'ring') { for (let i = 1; i <= 3; i++) { g.beginPath(); g.arc(0, 0, i * 6, 0.3 * i, Math.PI * 1.6 + 0.3 * i); g.stroke(); } }
  else if (sp.fx === 'meteor') { g.beginPath(); g.arc(6, 6, 9, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(-1, -1); g.lineTo(-18, -18); g.moveTo(4, -4); g.lineTo(-10, -20); g.moveTo(-4, 4); g.lineTo(-20, -10); g.stroke(); }
  else { g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.stroke(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.moveTo(Math.cos(a) * 13, Math.sin(a) * 13); g.lineTo(Math.cos(a) * 20, Math.sin(a) * 20); } g.stroke(); }
  return c;
}

export class Hud {
  root: HTMLElement;
  private hpBar!: HTMLElement; private hpLag!: HTMLElement; private hpTxt!: HTMLElement; private mpBar!: HTMLElement; private mpTxt!: HTMLElement; private xpBar!: HTMLElement; private lvl!: HTMLElement;
  private pingEl!: HTMLElement; private pingTxt!: HTMLElement; private fpsEl!: HTMLElement; private clockEl!: HTMLElement;
  private skillEls = new Map<string, { root: HTMLElement; cd: HTMLElement; sp: SpellDef; rank: number; known: boolean }>();
  private castEl!: HTMLElement; private chantEl!: HTMLElement; private castFill!: HTMLElement;
  private chatLog!: HTMLElement; private chatInput!: HTMLInputElement;
  private questsEl!: HTMLElement; private quests = new Map<string, QuestView>();
  private noticeEl!: HTMLElement;
  private targetEl!: HTMLElement;
  private mm!: HTMLCanvasElement; private mmWrap!: HTMLElement; private mmLabel!: HTMLElement; private mmBase: HTMLCanvasElement | null = null;
  private dialogEl: HTMLElement | null = null; private dialogNpc = 0;
  private deathEl: HTMLElement | null = null;
  private hintEl!: HTMLElement;
  private chantTimer = 0;
  private menuOpen = false;
  inventory: { item: string; rarity: string; n: number }[] = [];
  private zoneShown = '';
  private skillsEl!: HTMLElement; private comboEl!: HTMLElement; private statusEl!: HTMLElement; private comboShown = 0;
  progress: ProgressView | null = null;
  level = 1;
  /** The 1–4, advanced (5) and ultimate (R) slots for this class, locked until learned. */
  fusions: string[] = [];
  setRank(r: string) { let b = this.root.querySelector('.adv-rank') as HTMLElement | null; if (!b) { b = el('div', 'adv-rank', ''); b.title = 'Adventurer rank (L for rankings)'; this.lvl.parentElement!.parentElement!.appendChild(b); } if (b.textContent !== r) { b.textContent = r; b.className = 'adv-rank r' + ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'].indexOf(r); } }
  setFusions(f: string[]) { if (f.join() !== this.fusions.join()) { this.fusions = [...f]; this.buildSkills(); } }
  buildSkills() {
    const g = this.g, cls = this.char.cls, adv = this.progress?.adv ?? null, lvl = this.level;
    this.skillsEl.innerHTML = '';
    this.skillEls.clear();
    const keyName = (a: string) => (settings.bindings[a] ?? '').replace(/^Key|^Digit/, '').replace('ShiftLeft', '⇧').replace('Space', '␣') || '·';
    const atk = el('div', 'skill attack', `<span class="key">${keyName('attack')}</span><div class="cd"></div><span class="nm">ATTACK</span>`);
    atk.prepend(spellIcon('attack')); atk.onclick = () => g.action('attack'); this.skillsEl.appendChild(atk);
    for (const slot of [1, 2, 3, 4, 5, 6]) {
      const sp = skillForSlot(cls, slot, adv) ?? (slot === 5 ? SKILLS.find((s) => s.cls === cls && s.slot === 5) : undefined);
      if (!sp) continue;
      const known = lvl >= sp.unlock && (slot !== 5 || sp.adv === adv);
      const rank = this.progress?.ranks[sp.id] ?? 1;
      const action = slot === 6 ? 'ult' : 'spell' + slot;
      const s = el('div', `skill ${known ? '' : 'locked'} ${slot === 6 ? 'ult' : ''} ${slot === 5 ? 'adv' : ''}`, `<span class="key">${keyName(action)}</span><div class="cd"></div><span class="nm">${sp.name}</span>${known ? (rank > 1 ? `<span class="rk">${'◆'.repeat(rank - 1)}</span>` : '') : `<span class="lock">${slot === 5 ? 'Lv 20 path' : 'Lv ' + sp.unlock}</span>`}`);
      s.prepend(spellIcon(sp)); s.title = `${sp.name} — ${sp.title}${sp.ult ? ' (ULTIMATE)' : ''}\n${sp.desc}\n${sp.mana} MP · ${sp.castTime}s cast · ${sp.cooldown}s cooldown${sp.incantation ? `\n“${sp.incantation}”` : ''}`;
      s.onclick = () => known && g.cast(sp.id);
      this.skillsEl.appendChild(s);
      this.skillEls.set(sp.id, { root: s, cd: s.querySelector('.cd')!, sp, rank, known });
    }
    // reincarnation: fused skills (G / H / N)
    this.fusions.forEach((fid, k) => {
      const sp = SKILLS.find((x) => x.id === fid); if (!sp) return;
      const s = el('div', 'skill fusion', `<span class="key">${keyName('fusion' + (k + 1))}</span><div class="cd"></div><span class="nm">${sp.name}</span>`);
      s.prepend(spellIcon(sp)); s.title = `${sp.name} — ${sp.title} (SKILL FUSION)\n${sp.desc}`;
      s.onclick = () => g.cast(sp.id);
      this.skillsEl.appendChild(s);
      this.skillEls.set(sp.id, { root: s, cd: s.querySelector('.cd')!, sp, rank: 1, known: true });
    });
    const dg = el('div', 'skill mini', `<span class="key">${keyName('dodge')}</span><span class="nm">DODGE</span>`); dg.onclick = () => g.action('dodge');
    const pr = el('div', 'skill mini', `<span class="key">${keyName('parry')}</span><span class="nm">PARRY</span>`); pr.onclick = () => g.action('parry');
    this.skillsEl.appendChild(dg); this.skillsEl.appendChild(pr);
  }
  setProgress(p: ProgressView) {
    const changed = !this.progress || this.progress.adv !== p.adv || JSON.stringify(this.progress.ranks) !== JSON.stringify(p.ranks);
    this.progress = p;
    if (changed) this.buildSkills();
    const dot = document.querySelector('.hero-btn .dot') as HTMLElement | null;
    if (dot) dot.style.display = p.statPoints > 0 || p.skillPoints > 0 || (this.level >= 20 && !p.adv) ? '' : 'none';
  }

  constructor(public g: GameClient, public char: CharacterSummary) {
    this.root = el('div'); this.root.id = 'hud';
    document.getElementById('ui')!.appendChild(this.root);
    const cls = classById(char.cls);
    const unit = el('div', 'unit panel', `<span class="crn tr"></span><span class="crn bl"></span><div class="lvl"><span>${char.level}</span></div><div><div class="nm">${esc(char.name)} <small style="color:var(--ink-dim);font-family:var(--ui);letter-spacing:.1em">${cls.name.toUpperCase()}</small></div>
      <div class="bar2 hp"><i class="lag"></i><i class="v"></i><b></b></div><div class="bar2 mp"><i class="v"></i><b></b></div><div class="bar2 xp"><i class="v"></i></div></div>`);
    this.root.appendChild(unit);
    this.lvl = unit.querySelector('.lvl span')!;
    [this.hpLag, this.hpBar] = Array.from(unit.querySelectorAll('.hp i')) as HTMLElement[];
    this.hpTxt = unit.querySelector('.hp b')!; this.mpBar = unit.querySelector('.mp i')!; this.mpTxt = unit.querySelector('.mp b')!; this.xpBar = unit.querySelector('.xp i')!;
    const net = el('div', 'net panel', `<span class="clock"></span><span class="ping q4"><i></i><i></i><i></i><i></i></span><span class="pt">— ms</span>`);
    this.root.appendChild(net);
    this.pingEl = net.querySelector('.ping')!; this.pingTxt = net.querySelector('.pt')!; this.clockEl = net.querySelector('.clock')!;
    this.fpsEl = el('div', 'fps panel'); this.root.appendChild(this.fpsEl);
    this.mmWrap = el('div', 'minimap'); this.mm = document.createElement('canvas'); this.mm.width = this.mm.height = 340; this.mmWrap.appendChild(this.mm); this.root.appendChild(this.mmWrap);
    this.mmLabel = el('div', 'mmlabel'); this.root.appendChild(this.mmLabel);
    this.questsEl = el('div', 'quests panel', '<h3>Quests</h3><div class="ql"></div>'); this.root.appendChild(this.questsEl);
    this.targetEl = el('div', 'target panel hidden', '<div class="nm"></div><div class="bar2 hp"><i class="v"></i><b></b></div>'); this.root.appendChild(this.targetEl);
    // skills (built per class; rebuilt when level / advanced class / ranks change)
    this.skillsEl = el('div', 'skills');
    this.root.appendChild(this.skillsEl);
    this.buildSkills();
    this.comboEl = el('div', 'combo hidden', '<b>0</b><span>COMBO</span>'); this.root.appendChild(this.comboEl);
    this.statusEl = el('div', 'statuses'); unit.appendChild(this.statusEl);
    this.castEl = el('div', 'castbar hidden', '<div class="chant"></div><div class="track"><i></i></div>');
    this.chantEl = this.castEl.querySelector('.chant')!; this.castFill = this.castEl.querySelector('i')!;
    this.root.appendChild(this.castEl);
    const chat = el('div', 'chat', '<div class="log"></div><input maxlength="160" placeholder="Press Enter to chat · /who · /where" />');
    this.chatLog = chat.querySelector('.log')!; this.chatInput = chat.querySelector('input')!;
    this.chatInput.addEventListener('focus', () => { g.input.typing = true; });
    this.chatInput.addEventListener('blur', () => { g.input.typing = false; });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = this.chatInput.value.trim(); if (t) g.net.send({ type: 'chat', text: t }); this.chatInput.value = ''; this.chatInput.blur(); }
      if (e.key === 'Escape') this.chatInput.blur();
    });
    this.root.appendChild(chat);
    this.noticeEl = el('div', 'notice'); this.root.appendChild(this.noticeEl);
    this.hintEl = el('div', 'hint hidden'); this.root.appendChild(this.hintEl);
    this.root.appendChild(el('div', 'crosshair'));
    const mb = el('button', 'menu-btn', '☰'); mb.onclick = () => this.toggleMenu(); this.root.appendChild(mb);
    const ib = el('button', 'inv-btn', '🎒'); ib.title = 'Inventory (I)'; ib.onclick = () => this.g.openInventory(); this.root.appendChild(ib);
    const ab = el('button', 'inv-btn ar', '⚔'); ab.title = 'Legendary armory (K)'; ab.onclick = () => this.g.action('armory'); this.root.appendChild(ab);
    const hb = el('button', 'inv-btn hero-btn', '✦<i class="dot" style="display:none"></i>'); hb.title = 'Hero: stats, skills, titles (P)'; hb.onclick = () => this.g.action('hero'); this.root.appendChild(hb);
    this.chat('System', `Welcome, ${char.name}. WASD move · mouse look · 1–4 skills · R ultimate · F attack (chain for combos) · Q dodge · V parry · P hero · E talk · Esc menu.`, 'system');
    if (g.net.mode === 'offline') this.chat('System', 'Offline world: the same server code runs in your browser, with AI adventurers for company.', 'system');
  }

  modalOpen() { return this.menuOpen || !!document.querySelector('.modal'); }
  toggleMenu() { const open = document.querySelector('.modal [data-close]') as HTMLElement | null; if (open) { open.click(); return; } this.menuOpen = true; document.exitPointerLock?.(); openSettings(this.g.engine, () => { this.menuOpen = false; this.g.input.rebind(); }); }
  focusChat() { this.chatInput.focus(); document.exitPointerLock?.(); }
  toggleMap() { this.mmWrap.classList.toggle('big'); }
  toggleQuests() { this.questsEl.classList.toggle('hidden'); }

  updateSelf(s: SelfState) {
    const hp = (s.hp / s.mhp) * 100;
    this.hpBar.style.width = hp + '%'; this.hpLag.style.width = hp + '%';
    this.hpTxt.textContent = `${s.hp} / ${s.mhp}`;
    this.mpBar.style.width = (s.mp / s.mmp) * 100 + '%'; this.mpTxt.textContent = `${s.mp} / ${s.mmp}`;
    this.xpBar.style.width = (s.xp / s.xpNext) * 100 + '%';
    this.lvl.textContent = String(s.level);
    if (s.level !== this.level) { this.level = s.level; this.buildSkills(); }
    const flags = (s.sf ?? '').split(',').filter(Boolean);
    const ICON: Record<string, string> = { stun: '💫', root: '🌿', slow: '🐌', mark: '🎯', soak: '💧', burn: '🔥', chill: '❄', dot: '☠', shield: '🛡', buff: '⬆', weak: '⬇' };
    const html = flags.map((f) => `<span title="${f}">${ICON[f] ?? '•'}</span>`).join('') + (s.sh ? `<span class="sh">${s.sh}</span>` : '');
    if (this.statusEl.innerHTML !== html) this.statusEl.innerHTML = html;
    const c = s.combo ?? 0;
    if (c !== this.comboShown) {
      this.comboShown = c;
      this.comboEl.classList.toggle('hidden', c < 2);
      if (c >= 2) { (this.comboEl.querySelector('b') as HTMLElement).textContent = String(c); this.comboEl.classList.remove('pop'); void this.comboEl.offsetWidth; this.comboEl.classList.add('pop'); }
    }
  }

  chat(from: string, text: string, ch: string) {
    const d = el('div', ch, ch === 'system' || ch === 'world' ? esc(text) : `<b>${esc(from)}:</b> ${esc(text)}`);
    this.chatLog.appendChild(d);
    while (this.chatLog.children.length > 60) this.chatLog.firstChild!.remove();
    this.chatLog.scrollTop = 1e6;
  }
  notice(text: string, style = 'info') {
    const d = el('div', style, esc(text));
    this.noticeEl.appendChild(d);
    setTimeout(() => d.remove(), 3900);
  }
  loot(items: { item: string; rarity: string }[], gold: number) {
    for (const it of items) { const ex = this.inventory.find((i) => i.item === it.item); if (ex) ex.n++; else this.inventory.push({ ...it, n: 1 }); }
    const txt = items.map((i) => `[${i.item}]`).join(' ');
    this.chat('Loot', `You loot ${gold} copper${txt ? ' and ' + txt : ''}.`, 'system');
  }
  setInventory(inv: { item: string; rarity: string; n: number }[]) { this.inventory = inv; }

  setQuest(q: QuestView, revealed: boolean) {
    this.quests.set(q.id, q);
    const ql = this.questsEl.querySelector('.ql')!;
    ql.innerHTML = '';
    const list = [...this.quests.values()].sort((a, b) => Number(a.complete) - Number(b.complete)).slice(0, 5);
    for (const v of list) {
      const d = el('div', 'quest');
      d.innerHTML = `<div class="qt"><span class="rk r-${v.rank}">${esc(v.rank)}</span>${esc(v.title)}${v.complete ? ' ✓' : ''}</div>` +
        (v.hidden ? `<div class="st on">${esc(v.hook)}</div>` : '') +
        v.steps.map((s, i) => `<div class="st ${s.done ? 'done' : i === v.current ? 'on' : ''}">${s.done ? '✓' : i === v.current ? '◆' : '·'} ${esc(s.text)}${s.progress && i === v.current ? ` (${s.progress})` : ''}</div>`).join('') +
        (v.id !== 'starter' ? `<div class="src">${v.source === 'llm' ? 'written by the AI Story Director' : 'woven by the Story Director'}</div>` : '');
      ql.appendChild(d);
    }
    if (revealed) { this.chat('World', `A hidden scenario has opened for you: Rank ${q.rank}. "${q.hook}"`, 'world'); }
  }

  startCast(sp: SpellDef) {
    this.castEl.classList.remove('hidden');
    this.castEl.style.setProperty('--c', '#' + sp.color.toString(16).padStart(6, '0'));
    const words = sp.incantation.split(' ');
    this.chantEl.innerHTML = `<span class="sp">${sp.name} · ${esc(sp.title)}</span><span class="w"></span>`;
    const w = this.chantEl.querySelector('.w')!;
    let i = 0;
    clearInterval(this.chantTimer);
    this.chantTimer = window.setInterval(() => { if (i >= words.length) { clearInterval(this.chantTimer); return; } w.textContent += (i ? ' ' : '') + words[i++]; }, (sp.castTime * 1000 * 0.95) / words.length);
  }
  castProgress(k: number) { this.castFill.style.width = Math.min(100, k * 100) + '%'; }
  endCast() { clearInterval(this.chantTimer); setTimeout(() => this.castEl.classList.add('hidden'), 450); }
  chantBubble(r: { plate: HTMLElement }, sp: SpellDef) {
    const t = r.plate.querySelector('.t') as HTMLElement | null;
    if (t) { t.textContent = `“${sp.name}!”`; setTimeout(() => { t.textContent = ''; }, sp.castTime * 1000 + 600); }
  }

  makePlate(e: NetEntity): HTMLElement {
    const npc = e.t === 'n' ? NPCS.find((n) => n.key === e.k) : undefined;
    const p = el('div', 'nameplate ' + e.t + (e.bs ? ' boss' : ''), `${npc?.important ? '<div class="bang">!</div>' : ''}<div class="n">${e.bs ? '☠ ' : ''}${esc(e.n ?? '')}${e.t === 'm' ? ` <small>Lv ${e.lv}</small>` : ''}</div><div class="t">${npc ? esc(npc.title) : e.ti ? '« ' + esc(e.ti) + ' »' : ''}</div>${e.t === 'm' || e.t === 'p' || e.t === 'b' || e.t === 's' ? '<div class="hb"><i></i></div>' : ''}<div class="sf"></div>`);
    this.root.appendChild(p);
    return p;
  }

  damageNumber(at: THREE.Vector3, amount: number, crit = false, weak = false, me = false, heal = false) {
    const v = at.clone().project(this.g.engine.camera);
    if (v.z > 1) return;
    const d = el('div', `dmg ${crit ? 'crit' : ''} ${weak ? 'weak' : ''} ${me ? 'me' : ''} ${heal ? 'heal' : ''}`, (heal ? '+' : '') + amount + (crit ? '!' : ''));
    d.style.left = (v.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 30 + 'px';
    d.style.top = (-v.y * 0.5 + 0.5) * innerHeight + 'px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1150);
  }

  floatWord(at: THREE.Vector3, text: string, color: number, big = false) {
    const v = at.clone().project(this.g.engine.camera);
    if (v.z > 1 || !text) return;
    const d = el('div', 'fword' + (big ? ' big' : ''), esc(text));
    d.style.color = '#' + color.toString(16).padStart(6, '0');
    d.style.left = (v.x * 0.5 + 0.5) * innerWidth + 'px';
    d.style.top = (-v.y * 0.5 + 0.5) * innerHeight + 'px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1150);
  }

  setHint(npc: { name: string } | null) {
    if (npc && !this.dialogEl) { this.hintEl.textContent = `[E] Talk to ${npc.name}`; this.hintEl.classList.remove('hidden'); }
    else this.hintEl.classList.add('hidden');
  }

  openDialog(npcId: number, name: string, key: string) {
    this.closeDialog();
    const def = NPCS.find((n) => n.key === key);
    this.dialogNpc = npcId;
    const d = el('div', 'dialog panel', `<span class="crn tr"></span><span class="crn bl"></span><div class="who">${esc(name)}<small>${esc(def?.title ?? '')}</small></div><div class="txt">…</div>
      <div class="opts"></div><div class="row"><input maxlength="160" placeholder="${def?.important ? 'Say anything — they remember you…' : 'Say something…'}" /><button class="btn" style="min-height:40px;padding:6px 18px">Say</button><button class="btn ghost" style="min-height:40px;padding:6px 14px">✕</button></div>${def?.important ? '<div class="ai" style="margin-top:8px"></div>' : ''}`);
    const input = d.querySelector('input')!;
    const send = (t: string) => { if (!t.trim()) return; this.g.net.send({ type: 'talk', npc: npcId, text: t.trim() }); (d.querySelector('.txt') as HTMLElement).textContent = '…'; input.value = ''; };
    const [say, close] = Array.from(d.querySelectorAll('button')) as HTMLButtonElement[];
    say.onclick = () => send(input.value);
    close.onclick = () => this.closeDialog();
    input.addEventListener('focus', () => { this.g.input.typing = true; });
    input.addEventListener('blur', () => { this.g.input.typing = false; });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') send(input.value); if (e.key === 'Escape') this.closeDialog(); });
    const opts = d.querySelector('.opts')!;
    const choices = def?.important ? (key === 'lyra' ? ['Tell me about the Tower.', 'What do you know about the Shrine?', 'Do you have work for me?'] : ['What is happening at the Ruins?', 'Do you have work for me?', 'Who are you, really?']) : ['Hello!', 'Any news?'];
    for (const c of choices) { const b = el('button', '', esc(c)); b.onclick = () => send(c); opts.appendChild(b); }
    this.root.appendChild(d);
    this.dialogEl = d;
    document.exitPointerLock?.();
  }
  closeDialog() { this.dialogEl?.remove(); this.dialogEl = null; this.dialogNpc = 0; this.g.input.typing = false; }
  npcSay(npc: number, name: string, text: string, source: string) {
    if (!this.dialogEl || this.dialogNpc !== npc) { this.chat(name, text, 'npc'); return; }
    const t = this.dialogEl.querySelector('.txt') as HTMLElement;
    t.textContent = '';
    let i = 0;
    const iv = setInterval(() => { t.textContent = text.slice(0, (i += 2)); if (i >= text.length) clearInterval(iv); }, 16);
    const ai = this.dialogEl.querySelector('.ai'); if (ai) ai.textContent = source === 'llm' ? '◆ AI dialogue · remembers you' : '◆ scripted line (AI offline or resting)';
    this.chat(name, text, 'npc');
  }

  showDeath(by: string, info: { xpLost?: number; goldLost?: number; at?: string; wait?: number; injury?: string; lostItem?: string; rankLost?: number } = {}) {
    const wait = info.wait ?? 0;
    this.deathEl = el('div', 'death', `<h1>YOU HAVE FALLEN</h1><p>Slain by ${esc(by)}. The Tower does not forget — but it forgives.</p>
      <div class="pen">${info.xpLost ? `<span>−${info.xpLost} XP</span>` : ''}${info.goldLost ? `<span>−${info.goldLost} gold</span>` : ''}<span>Soul-Weary for 60 s</span>${info.rankLost ? `<span>−${info.rankLost} rank pts</span>` : ''}</div>
      ${info.injury || info.lostItem ? `<div class="pen lasting">${info.injury ? `<span>Injury: ${esc(info.injury)}</span>` : ''}${info.lostItem ? `<span>Lost in the fall: ${esc(info.lostItem.replace(/_/g, ' '))}</span>` : ''}</div>` : ''}
      <button class="btn" style="margin-top:24px" ${wait ? 'disabled' : ''}>Rise at ${esc(info.at ?? 'the shrine')}${wait ? ` (${wait})` : ''}</button>`);
    const b = this.deathEl.querySelector('button')! as HTMLButtonElement;
    b.onclick = () => this.g.net.send({ type: 'respawn' });
    if (wait) { let t = wait; const iv = setInterval(() => { t--; if (t <= 0) { clearInterval(iv); b.disabled = false; b.textContent = `Rise at ${info.at ?? 'the shrine'}`; } else b.textContent = `Rise at ${info.at ?? 'the shrine'} (${t})`; }, 1000); }
    this.root.appendChild(this.deathEl);
    document.exitPointerLock?.();
  }
  hideDeath() { this.deathEl?.remove(); this.deathEl = null; }

  /** Phase 4: a new region streamed in — redraw the map. */
  invalidateMap() { this.mmBase = null; this.zoneShown = ''; }

  private drawMinimapBase() {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d')!;
    const S = 512 / 420; // world [-210, 210]
    const img = g.createImageData(512, 512);
    for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) {
      const x = i / S - 210, z = j / S - 210, h = heightAt(x, z);
      const k = (j * 512 + i) * 4;
      let r = 40 + h * 2, gg = 60 + h * 2.2, b = 38 + h;
      if (h < WATER_LEVEL) { r = 30; gg = 70; b = 90; }
      if (h > 30) { r = gg = b = 70 + h * 0.8; }
      // region tint (sand gold, snow white, forbidden violet …)
      if (REGION.id !== 'capital') { const tc = REGION.tints[0]; const L = 0.5 + h * 0.012; r = ((tc >> 16) & 255) * L; gg = ((tc >> 8) & 255) * L; b = (tc & 255) * L; }
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const P = (x: number, z: number): [number, number] => [(x + 210) * S, (z + 210) * S];
    g.strokeStyle = 'rgba(210,180,120,.8)'; g.lineWidth = 3;
    for (const road of ROADS) { g.beginPath(); road.forEach((p, i) => { const [a, b] = P(p.x, p.z); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke(); }
    g.fillStyle = '#8a8478';
    for (const c2 of buildZone().colliders) if (c2.kind === 'box' && (c2.tag === 'wall' || c2.tag === 'building' || c2.tag === 'tower')) { const [a, b] = P(c2.x - c2.hx, c2.z - c2.hz); g.fillRect(a, b, c2.hx * 2 * S, c2.hz * 2 * S); }
    g.fillStyle = 'rgba(30,60,30,.5)';
    for (const t of buildZone().trees) { const [a, b] = P(t.x, t.z); g.fillRect(a - 1, b - 1, 2.5, 2.5); }
    g.font = '600 13px Rajdhani'; g.textAlign = 'center';
    for (const p of POIS) { const [a, b] = P(p.x, p.z); g.fillStyle = '#000'; g.fillText(p.name, a + 1, b + 1); g.fillStyle = '#ffe3a8'; g.fillText(p.name, a, b); }
    void LAKE;
    // fast-travel shrines (blue diamonds) and region gates (gold arches)
    for (const s of REGION.shrines) { const [a, b] = P(s.x, s.z); g.fillStyle = '#7fd8ff'; g.beginPath(); g.moveTo(a, b - 7); g.lineTo(a + 5, b); g.lineTo(a, b + 7); g.lineTo(a - 5, b); g.closePath(); g.fill(); }
    for (const e of REGION.exits) { const [a, b] = P(e.x, e.z); g.strokeStyle = '#ffd36a'; g.lineWidth = 3; g.beginPath(); g.arc(a, b, 7, Math.PI, 0); g.stroke(); }
    this.mmBase = c;
  }

  private drawMinimap() {
    if (!this.mmBase) this.drawMinimapBase();
    const g = this.mm.getContext('2d')!;
    const W = this.mm.width, me = this.g.renderPos;
    const S = 512 / 420, zoom = this.mmWrap.classList.contains('big') ? 1.1 : 1.6;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0a0f18'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2);
    g.scale(zoom, zoom);
    g.drawImage(this.mmBase!, -(me.x + 210) * S, -(me.z + 210) * S);
    for (const r of this.g.remotes.values()) {
      const dx = (r.view.root.position.x - me.x) * S, dz = (r.view.root.position.z - me.z) * S;
      g.fillStyle = r.t === 'm' ? '#ff5a4f' : r.t === 'n' ? '#ffd36a' : '#5fe8ff';
      g.beginPath(); g.arc(dx, dz, r.t === 'n' ? 3 : 2.5, 0, Math.PI * 2); g.fill();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    // player arrow
    g.translate(W / 2, W / 2);
    g.rotate(-this.g.me.yaw);
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
    // tower bearing marker on the rim
    const ang = Math.atan2(TOWER.x - me.x, -(TOWER.z - me.z));
    g.fillStyle = '#5fe8ff'; g.font = '700 16px Cinzel'; g.textAlign = 'center';
    g.fillText('◆', W / 2 + Math.sin(ang) * (W / 2 - 14), W / 2 - Math.cos(ang) * (W / 2 - 14) + 6);
    g.fillStyle = '#d9b56b'; const na = 0;
    g.fillText('N', W / 2 + Math.sin(na) * (W / 2 - 14), W / 2 - Math.cos(na) * (W / 2 - 14) + 6);
  }

  update(dt: number) {
    const e = this.g.engine;
    // ping meter
    const q = this.g.ping.quality();
    this.pingEl.className = 'ping ' + (q === 'excellent' ? 'q4' : q === 'good' ? 'q3' : q === 'fair' ? 'q2' : 'q1');
    this.pingTxt.textContent = `${Math.round(this.g.ping.rtt)} ms${this.g.ping.jitter > 8 ? ` ±${Math.round(this.g.ping.jitter)}` : ''} · ${this.g.net.mode === 'online' ? 'ONLINE' : 'OFFLINE'}`;
    const h = settings.timeOverride ?? e.hours;
    this.clockEl.textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')} ${e.weather === 'clear' ? '☀' : e.weather === 'rain' ? '☂' : '⚡'}`;
    this.fpsEl.classList.toggle('hidden', !settings.showFps);
    this.fpsEl.textContent = `${Math.round(e.fps)} FPS · ${e.quality.toUpperCase()}`;
    // cooldowns
    const st = this.g.serverNow();
    for (const s of this.skillEls.values()) {
      const sp = s.sp, rs = rankScale(sp, s.rank);
      const ready = this.g.self.cds[sp.id] ?? 0;
      const left = ready - st;
      const total = rs.cooldown + sp.castTime;
      s.cd.style.setProperty('--p', left > 0 ? Math.min(100, (left / total) * 100) + '%' : '0%');
      s.cd.textContent = left > 0.05 ? (left > 3 ? Math.ceil(left) : left.toFixed(1)) + '' : '';
      s.root.classList.toggle('nomana', s.known && this.g.self.mp < rs.mana);
    }
    // target frame
    const t = this.g.targetId ? this.g.remotes.get(this.g.targetId) : undefined;
    this.targetEl.classList.toggle('hidden', !t);
    if (t) {
      (this.targetEl.querySelector('.nm') as HTMLElement).textContent = `${t.name}  ·  Lv ${t.lv}`;
      (this.targetEl.querySelector('i') as HTMLElement).style.width = (t.ent.hp / t.ent.mhp) * 100 + '%';
      (this.targetEl.querySelector('b') as HTMLElement).textContent = `${t.ent.hp} / ${t.ent.mhp}`;
    }
    // nameplates
    const cam = e.camera, v = new THREE.Vector3();
    for (const r of this.g.remotes.values()) {
      const d = r.view.root.position.distanceTo(this.g.renderPos);
      const show = d < (r.t === 'n' ? 22 : r.view.height > 3 ? 70 : 40) && r.view.root.visible;
      if (!show) { r.plate.style.display = 'none'; continue; }
      v.copy(r.view.root.position); v.y += r.view.height ? r.view.height + 0.45 : r.t === 'm' && r.key === 'warrior' ? 2.7 : 2.45;
      v.project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { r.plate.style.display = 'none'; continue; }
      r.plate.style.display = '';
      r.plate.style.left = (v.x * 0.5 + 0.5) * innerWidth + 'px';
      r.plate.style.top = (-v.y * 0.5 + 0.5) * innerHeight + 'px';
      r.plate.style.opacity = String(Math.min(1, (1 - d / 45) * 2));
      const hb = r.plate.querySelector('.hb i') as HTMLElement | null;
      if (hb) hb.style.width = Math.max(0, (r.ent.hp / r.ent.mhp) * 100) + '%';
      const sfe = r.plate.querySelector('.sf') as HTMLElement | null;
      const sfv = r.ent.sf ?? '';
      if (sfe && sfe.dataset.v !== sfv) { sfe.dataset.v = sfv; sfe.textContent = sfv.split(',').filter(Boolean).map((f) => ({ stun: '💫', root: '🌿', slow: '🐌', mark: '🎯', soak: '💧', burn: '🔥', chill: '❄', dot: '☠', shield: '🛡', buff: '⬆', weak: '⬇' } as Record<string, string>)[f] ?? '').join(''); }
      r.plate.style.outline = r.id === this.g.targetId ? '1px solid rgba(255,90,79,.6)' : '';
    }
    // zone title on entering a new area
    const poi = poiAt(this.g.renderPos.x, this.g.renderPos.z);
    const zname = poi?.name ?? REGION.name;
    this.mmLabel.textContent = zname;
    if (zname !== this.zoneShown) {
      this.zoneShown = zname;
      const z = el('div', 'zone-title', `<div class="a">${esc(zname)}</div><div class="b">${esc(REGION.name)} · Lv ${REGION.levels[0]}–${REGION.levels[1]}</div>`);
      this.root.appendChild(z); setTimeout(() => z.remove(), 5000);
    }
    this.drawMinimap();
    void dt; void audio;
  }
}
