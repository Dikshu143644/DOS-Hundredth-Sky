/** Minimal behaviour-tree runtime for ordinary NPCs (no LLM involved). */
export type Status = 'success' | 'failure' | 'running';
export interface BTNode<C> { tick(ctx: C, dt: number): Status }

export class Selector<C> implements BTNode<C> {
  constructor(public children: BTNode<C>[]) {}
  tick(c: C, dt: number): Status {
    for (const ch of this.children) { const s = ch.tick(c, dt); if (s !== 'failure') return s; }
    return 'failure';
  }
}
export class Sequence<C> implements BTNode<C> {
  constructor(public children: BTNode<C>[]) {}
  tick(c: C, dt: number): Status {
    for (const ch of this.children) { const s = ch.tick(c, dt); if (s !== 'success') return s; }
    return 'success';
  }
}
export class Cond<C> implements BTNode<C> {
  constructor(public fn: (c: C) => boolean) {}
  tick(c: C): Status { return this.fn(c) ? 'success' : 'failure'; }
}
export class Act<C> implements BTNode<C> {
  constructor(public fn: (c: C, dt: number) => Status) {}
  tick(c: C, dt: number): Status { return this.fn(c, dt); }
}
