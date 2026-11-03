import { describe, it, expect } from 'vitest';
import { makeGame, joinAs, sleep } from './helpers';
import { validateNpcOutput, npcSystemPrompt, scheduleAt, NPC_OUTPUT_SCHEMA } from '../../src/shared/npcai';
import { NPCS, AI_NPCS } from '../../src/server/core/npcdefs';
import { generateBoard, canTake, STORY, SIDE, HIDDEN, QRANKS } from '../../src/shared/questdata';
import { ZONE_IDS } from '../../src/shared/regions';

const npcEnt = (game: any, key: string) => [...game.ents.values()].find((e: any) => e.type === 'n' && e.def.key === key);
const standBy = (p: any, n: any) => { p.zone = n.zone; p.s.x = n.s.x + 1; p.s.z = n.s.z + 1; };

describe('NPC AI schema', () => {
  it('accepts a valid reply and sanitizes', () => {
    const v = validateNpcOutput({ say: 'Welcome, climber.', emotion: 'happy', action: { type: 'give_quest', arg: 'story2' }, remember: 'They came from the Capital.', trust: 1 }, ['none', 'give_quest']);
    expect(v.ok).toBe(true); expect(v.value.action).toEqual({ type: 'give_quest', arg: 'story2' }); expect(v.value.trust).toBe(1);
  });
  it('rejects unknown and disallowed actions, bad emotions, missing speech — and stays safe', () => {
    const a = validateNpcOutput({ say: 'Die.', emotion: 'furious', action: { type: 'attack_target' } }, ['none', 'warn']);
    expect(a.ok).toBe(false); expect(a.value.action.type).toBe('none'); expect(a.value.emotion).toBe('neutral');
    expect(a.errors.join(' ')).toMatch(/not allowed/); expect(a.errors.join(' ')).toMatch(/emotion/);
    const b = validateNpcOutput({ action: { type: 'launch_nukes' } }, ['none']);
    expect(b.ok).toBe(false); expect(b.value.say).toBe('…'); expect(b.errors.join(' ')).toMatch(/not a known action/);
    expect(validateNpcOutput('hello', ['none']).ok).toBe(false);
    expect(validateNpcOutput({ say: 'x', emotion: 'sad', action: 'none', trust: 9 }, ['none']).value.trust).toBe(2);
  });
  it('the JSON schema and the prompt name every field', () => {
    expect(NPC_OUTPUT_SCHEMA.required).toEqual(['say', 'emotion', 'action']);
    const sys = npcSystemPrompt(AI_NPCS()[0].ai!);
    for (const w of ['Personality', 'Goals', 'You know', 'Speech', 'Allowed actions', 'JSON']) expect(sys).toContain(w);
  });
  it('at least one AI NPC in every region, each with a complete profile and a 24 h schedule', () => {
    const ai = AI_NPCS();
    expect(ai.length).toBeGreaterThanOrEqual(8);
    for (const z of ZONE_IDS) expect(ai.some((n) => (n.zone ?? 'capital') === z), z).toBe(true);
    for (const n of ai) {
      const p = n.ai!;
      expect(p.identity.name && p.personality.traits.length && p.goals.short.length && p.knowledge.length && p.allowedActions.length && p.dialogueStyle.maxWords).toBeTruthy();
      for (let h = 0; h < 24; h += 0.5) expect(scheduleAt(n.schedule ?? p.schedule, h), `${n.key} at ${h}`).toBeTruthy();
    }
    // every region town has people
    for (const z of ZONE_IDS) expect(NPCS.filter((n) => (n.zone ?? 'capital') === z).length, z).toBeGreaterThanOrEqual(2);
  });
});

describe('quests', () => {
  it('board offers one bounty per rank F → SSS in every region', () => {
    for (const z of ZONE_IDS) { const b = generateBoard(z, 42); expect(b.map((q) => q.rank)).toEqual(QRANKS.slice(0, 9)); }
    expect(canTake('F', 'E')).toBe(true); expect(canTake('F', 'D')).toBe(false); expect(canTake('S', 'SSS')).toBe(false);
  });
  it('story has 7 chapters across all regions, every region has side quests and a hidden chain', () => {
    expect(STORY.length).toBe(7); expect(new Set(STORY.map((s) => s.region)).size).toBe(7);
    for (const z of ZONE_IDS) { expect(SIDE.filter((s) => s.region === z).length, z).toBeGreaterThanOrEqual(2); expect(HIDDEN.some((h) => h.quest.region === z), z).toBe(true); }
  });
  it('the board gates by rank and caps active bounties', async () => {
    const { game } = makeGame();
    const { c, p } = await joinAs(game, 'mage');
    expect(p.char.quests.some((q: any) => q.id === 'story1')).toBe(true);
    await c.send({ type: 'board' });
    const b = await c.wait('board');
    expect(b.rank).toBe('F'); expect(b.list.length).toBe(9);
    const sss = b.list.find((x: any) => x.rank === 'SSS');
    expect(sss.can).toBe(false);
    await c.send({ type: 'boardTake', id: sss.id });
    expect(p.char.quests.some((q: any) => q.id === sss.id)).toBe(false);
    const f = b.list.find((x: any) => x.rank === 'F'), e = b.list.find((x: any) => x.rank === 'E');
    await c.send({ type: 'boardTake', id: f.id }); await c.send({ type: 'boardTake', id: e.id });
    expect(p.char.quests.filter((q: any) => q.kind === 'board').length).toBe(2);
  });
  it('finishing a chapter opens the next one and pays rank points', async () => {
    const { game, adv } = makeGame();
    const { p } = await joinAs(game, 'warrior');
    const g = game as any;
    const q = p.char.quests.find((x: any) => x.id === 'story1')!;
    g.advance(p, (s: any) => s.type === 'talk' && s.target === 'mina');
    g.advance(p, (s: any) => s.type === 'kill' && s.target === 'minion', 4);
    const before = p.char.advPts ?? 0;
    g.advance(p, (s: any) => s.type === 'talk' && s.target === 'lyra');
    expect(q.complete).toBe(true); expect((p.char.advPts ?? 0) - before).toBeGreaterThan(0);
    expect(p.char.quests.some((x: any) => x.id === 'story2')).toBe(true);
    adv(1);
  });
});

describe('AI NPCs with a mock LLM', () => {
  it('a valid reply speaks, remembers and gives a quest through the schema', async () => {
    let calls = 0;
    const { game, adv } = makeGame({ llm: async (msgs: any[]) => { calls++; expect(msgs[0].content).toContain('Sylwen'); return JSON.stringify({ say: 'The roots remember you already.', emotion: 'curious', action: { type: 'give_quest', arg: 'story2' }, remember: 'asked about the wolves', trust: 1 }); } });
    const { c, p } = await joinAs(game, 'mage');
    // story2 needs chapter 1 done first
    const q1 = p.char.quests.find((x: any) => x.id === 'story1')!; q1.complete = true;
    const n = npcEnt(game, 'sylwen'); standBy(p, n); adv(2);
    await c.send({ type: 'talk', npc: n.id, text: 'Why are the wolves mad?' });
    const m = await c.wait('npcSay');
    expect(calls).toBe(1); expect(m.source).toBe('llm'); expect(m.text).toMatch(/roots/); expect(m.valid).toBe(true);
    expect(m.actionText).toBe('gave you a quest');
    expect(p.char.quests.some((x: any) => x.id === 'story2')).toBe(true);
    expect((game as any).data.npcMemory.sylwen[p.char.id].long).toContain('asked about the wolves');
  });
  it('a disallowed action is refused; garbage falls back to a scripted line', async () => {
    let reply = JSON.stringify({ say: 'I will strike you down.', emotion: 'angry', action: { type: 'attack_target' } });
    const { game, adv } = makeGame({ llm: async () => reply });
    const { c, p } = await joinAs(game, 'mage');
    const n = npcEnt(game, 'thrain'); standBy(p, n); adv(2);
    const hp = p.hp;
    await c.send({ type: 'talk', npc: n.id, text: 'Fight me.' });
    const m = await c.wait('npcSay');
    expect(m.source).toBe('llm'); expect(m.valid).toBe(false); expect(m.actionText).toBeUndefined(); expect(p.hp).toBe(hp);
    reply = 'lol not json at all'; adv(2);
    await c.send({ type: 'talk', npc: n.id, text: 'Hello again, forge-lord.' });
    const m2 = await c.wait('npcSay');
    expect(m2.source).toBe('scripted'); expect(m2.text.length).toBeGreaterThan(3);
  });
  it('trust opens a hidden ??? chain', async () => {
    const { game, adv } = makeGame({ llm: async () => JSON.stringify({ say: 'Very well. My brother… I will tell you.', emotion: 'sad', action: { type: 'reveal_secret' } }) });
    const { c, p } = await joinAs(game, 'knight');
    const n = npcEnt(game, 'aldric'); standBy(p, n);
    for (let i = 0; i < 3; i++) { adv(2); await c.send({ type: 'talk', npc: n.id, text: 'Tell me about your family ' + i }); await c.wait('npcSay'); }
    const h = p.char.quests.find((x: any) => x.id === 'hid_cap')!;
    expect(h).toBeTruthy(); expect(h.hidden).toBe(true); expect(h.rank).toBe('???');
  });
});

describe('companion agent + AI status', () => {
  it('Rin joins, follows across a zone change, fights, heals the leader, and leaves', async () => {
    const { game, adv } = makeGame();
    const { c, p } = await joinAs(game, 'archer');
    const g = game as any;
    const rin = npcEnt(game, 'rin'); standBy(p, rin); adv(2);
    await c.send({ type: 'talk', npc: rin.id, text: 'Join me, let us climb together.' });
    const m = await c.wait('npcSay'); expect(m.actionText).toBe('joined your party');
    expect(p.char.companion).toBe('rin');
    const comp = () => [...g.ents.values()].find((e: any) => e.type === 's' && e.owner === p.id && e.kind === 'rin');
    expect(comp()).toBeTruthy();
    // follows: teleport the leader away and tick
    p.s.x += 12; for (let i = 0; i < 60; i++) { adv(0.05); g.tick(); }
    const cc: any = comp(); expect(Math.hypot(cc.s.x - p.s.x, cc.s.z - p.s.z)).toBeLessThan(8);
    // fights: a monster nearby becomes its target
    const mon = g.spawnMonster('minion', p.s.x + 3, p.s.z, p.zone);
    for (let i = 0; i < 40; i++) { adv(0.05); g.tick(); }
    expect((comp() as any).target === mon.id || mon.hp < mon.mhp || mon.dead).toBe(true);
    // protects: heal when the leader is low
    p.hp = p.mhp * 0.2; for (let i = 0; i < 20; i++) { adv(0.05); g.tick(); }
    expect(p.hp).toBeGreaterThan(p.mhp * 0.3);
    // zone change: comes along
    g.zones.move(p, 'forest', 0, -150, 0, 'test'); for (let i = 0; i < 20; i++) { adv(0.05); g.tick(); }
    expect((comp() as any)?.zone).toBe('forest');
    await c.send({ type: 'companion', op: 'dismiss' }); expect(comp()).toBeUndefined(); expect(p.char.companion).toBeUndefined();
  });
  it('AI status is offline without a model, online with one, degraded after failures', async () => {
    expect(makeGame().game.quests.aiStatus().status).toBe('offline');
    let ok = true;
    const { game, adv } = makeGame({ llm: async () => (ok ? '{"say":"Hi.","emotion":"happy","action":{"type":"none"}}' : null) });
    expect(game.quests.aiStatus().status).toBe('online');
    expect(game.quests.aiStatus().npcs).toBeGreaterThanOrEqual(8);
    ok = false; adv(1); await game.llm.ask('u', [{ role: 'user', content: 'x' }]);
    expect(game.quests.aiStatus().status).toBe('online'); // POLISH-1: the pill stays "AI online" while enabled
    expect(game.quests.aiStatus().detail).toMatch(/busy/);
    await sleep(1);
  });
});
