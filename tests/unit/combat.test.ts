import { describe, it, expect } from 'vitest';
import { SPELLS, spellById, xpToNext, grantXp, canCast, rollLoot, statsFor, computeDamage, CLASSES } from '../../src/shared/combat';

describe('spells', () => {
  it('has three named spells with incantations, including IGNIS', () => {
    expect(SPELLS.length).toBe(3);
    for (const s of SPELLS) { expect(s.incantation.length).toBeGreaterThan(10); expect(s.castTime).toBeGreaterThan(0); expect(s.mana).toBeGreaterThan(0); }
    expect(spellById('ignis')!.name).toBe('IGNIS');
  });
  it('gates casting on mana and cooldown', () => {
    const ig = spellById('ignis')!;
    expect(canCast(0, 1000, ig, {}).ok).toBe(true);
    expect(canCast(0, 0, ig, {}).reason).toBe('mana');
    expect(canCast(1, 1000, ig, { ignis: 5 }).reason).toBe('cooldown');
  });
});

describe('progression', () => {
  it('xp curve is increasing', () => { for (let l = 1; l < 30; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l)); });
  it('levels up and carries overflow xp', () => {
    const r = grantXp(1, 0, xpToNext(1) + 5);
    expect(r.level).toBe(2); expect(r.xp).toBe(5);
  });
  it('stats grow with level for every class', () => {
    for (const c of CLASSES) expect(statsFor(c.id, 10).maxHp).toBeGreaterThan(statsFor(c.id, 1).maxHp);
  });
});

describe('damage and loot', () => {
  it('damage is positive and defence reduces it', () => {
    const base = { atk: 50, power: 1.2, element: 'fire' as const, roll: 0.5, critRoll: 0.9 };
    const a = computeDamage({ ...base, def: 5 } as any), b = computeDamage({ ...base, def: 40 } as any);
    expect(a.dmg).toBeGreaterThan(b.dmg); expect(b.dmg).toBeGreaterThan(0);
  });
  it('loot rolls respect chances', () => {
    expect(rollLoot('magus', [0, 0, 0]).length).toBe(3);
    expect(rollLoot('magus', [1, 1, 1]).length).toBe(0);
  });
});
