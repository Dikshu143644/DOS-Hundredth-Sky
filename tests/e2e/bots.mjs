// Scripted headless multiplayer clients: register, create a character, join, move, cast, chat.
// Usage: node tests/e2e/bots.mjs ws://localhost:8787/ws 3
import WebSocket from 'ws';
const url = process.argv[2] || 'ws://localhost:8787/ws';
const N = Number(process.argv[3] || 3);
const results = [];
function client(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const user = 'bot_' + Math.random().toString(36).slice(2, 8) + i;
    const st = { id: 0, seen: new Set(), snaps: 0, rtts: [], pos: null, chats: 0, fx: 0, seq: 0 };
    const send = (m) => ws.send(JSON.stringify(m));
    ws.on('open', () => send({ type: 'register', user, pass: 'secret123' }));
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.type === 'auth' && m.ok) send({ type: 'createChar', name: 'Tester' + Math.random().toString(36).slice(2, 6), cls: ['mage', 'knight', 'archer'][i % 3], appearance: { tint: 0xffffff, accent: 0x33ccff, headgear: true, cape: true, scale: 1 } });
      if (m.type === 'chars' && m.list.length) send({ type: 'join', charId: m.list[0].id });
      if (m.type === 'joined') {
        st.id = m.id;
        let t = 0;
        const iv = setInterval(() => {
          t++;
          // walk in a circle; cast now and then; ping
          send({ type: 'input', seq: ++st.seq, mx: 0, mz: 1, yaw: t * 0.02 + i, jump: t % 90 === 0, sprint: false, walk: false, dt: 1 / 60 });
          if (t % 60 === 0) send({ type: 'ping', t: performance.now() });
          if (t % 150 === 0) send({ type: 'cast', spell: ['ignis', 'fulgur', 'lux'][i % 3], yaw: 0 });
          if (t === 200) send({ type: 'chat', text: 'hello from scripted client ' + i });
        }, 1000 / 60);
        setTimeout(() => { clearInterval(iv); ws.close(); resolve({ i, ...st, seen: st.seen.size }); }, 9000);
      }
      if (m.type === 'snap') { st.snaps++; for (const e of m.ents) if (e.t === 'p') st.seen.add(e.id); st.pos = m.me; }
      if (m.type === 'pong') st.rtts.push(performance.now() - m.t);
      if (m.type === 'chat') st.chats++;
      if (m.type === 'fx') st.fx++;
    });
  });
}
const out = await Promise.all(Array.from({ length: N }, (_, i) => client(i)));
for (const r of out) console.log(`client ${r.i}: id=${r.id} snapshots=${r.snaps} otherPlayersSeen=${r.seen} avgRTT=${(r.rtts.reduce((a, b) => a + b, 0) / Math.max(1, r.rtts.length)).toFixed(1)}ms chats=${r.chats} fx=${r.fx} pos=(${r.pos?.x.toFixed(1)}, ${r.pos?.z.toFixed(1)})`);
const ok = out.every((r) => r.snaps > 100 && r.seen >= N - 1);
console.log(ok ? 'MULTIPLAYER OK' : 'MULTIPLAYER FAIL');
process.exit(ok ? 0 : 1);
