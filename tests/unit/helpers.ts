import { Game } from '../../src/server/core/game';
import type { S2C } from '../../src/shared/protocol';

export function makeGame(o: { bots?: number; llm?: any } = {}) {
  let t = 1000;
  const mem = { data: null as any };
  const game = new Game({
    store: { load: () => mem.data, save: (d: any) => { mem.data = d; } } as any,
    hasher: { hash: async (p: string) => 'h:' + p, verify: async (p: string, h: string) => h === 'h:' + p, token: () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) },
    llm: o.llm ?? null, now: () => t, mode: 'offline', bots: o.bots ?? 0, dev: true, serverName: 'test',
  });
  return { game, adv: (s: number) => { t += s; }, now: () => t, mem };
}
let nextConn = 100;
export function client(game: Game) {
  const id = nextConn++;
  const inbox: S2C[] = [];
  game.connect({ id, send: (m: S2C) => inbox.push(m) } as any);
  const wait = async (type: string, pred: (m: any) => boolean = () => true) => { for (let i = 0; i < 100; i++) { const m = inbox.find((x) => x.type === type && pred(x)); if (m) { inbox.splice(inbox.indexOf(m), 1); return m as any; } await new Promise((r) => setTimeout(r, 2)); } throw new Error('no ' + type); };
  return { id, inbox, wait, send: (m: any) => game.handle(id, m) };
}
/** Register, create a character of `cls` and join; returns the client and the server's Player. */
export async function joinAs(game: Game, cls: string, name = 'Hero' + Math.floor(Math.random() * 1e5), o: { prologue?: boolean } = {}) {
  const c = client(game);
  await c.send({ type: 'register', user: name.toLowerCase(), pass: 'secret-pass' });
  await c.wait('auth');
  await c.send({ type: 'createChar', name, cls, appearance: { tint: 0xffffff, accent: 0xffffff, headgear: false, cape: false, scale: 1 } });
  const chars = await c.wait('chars');
  await c.send({ type: 'join', charId: chars.list[0].id });
  await c.wait('joined');
  const p = [...game.players.values()].find((x) => x.name === name)!;
  // most tests are about the world, not the void between worlds: stand the hero in it right away
  if (!o.prologue) (p as any).hidden = false;
  return { c, p };
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Put a monster right in front of a player (facing -Z at yaw 0). */
export function monsterAt(game: Game, kind: string, x: number, z: number) {
  const m = game.spawnMonster(kind, x, z, 'capital');
  return m;
}
