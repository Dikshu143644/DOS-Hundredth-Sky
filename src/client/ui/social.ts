/** Phase 4 · M6: the Social panel (O): Party · Guild · Arena · Events. Reads the client's social state
 *  (kept fresh by the server's party / guild / arena / worldboss messages) and sends `social` ops. */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const CLS: Record<string, string> = { warrior: 'Warrior', mage: 'Mage', archer: 'Archer', knight: 'Knight', rogue: 'Rogue', cleric: 'Cleric', healer: 'Healer', berserker: 'Berserker', summoner: 'Summoner' };
export interface SocialState { party: any; guild: any; list: any[]; arena: any; wb: any; raid: any; myId: number; inventory: { item: string; n: number }[]; itemName: (id: string) => string; gold: number; clock: () => number }
const mmss = (s: number) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const until = (at: number) => `<span data-until="${at}"></span>`;

export function socialPanel(o: { state: () => SocialState; send: (m: any) => void; onClose: () => void; tab?: string }) {
  const d = document.createElement('div');
  d.className = 'modal inv-modal'; d.id = 'social';
  document.getElementById('ui')!.appendChild(d);
  let tab = o.tab ?? 'party';
  const close = () => { d.remove(); window.removeEventListener('keydown', key, true); clearInterval(iv); o.onClose(); };
  const key = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } if ((e.target as HTMLElement)?.tagName === 'INPUT') e.stopPropagation(); };
  window.addEventListener('keydown', key, true);
  const op = (op: string, a: Record<string, unknown> = {}) => o.send({ type: 'social', op, ...a });
  const val = (sel: string) => (d.querySelector(sel) as HTMLInputElement | null)?.value?.trim() ?? '';

  const partyTab = (S: SocialState) => {
    const P = S.party;
    const invite = `<div class="so-row"><input class="so-in" data-inv placeholder="Player name" maxlength="16"><button class="btn primary" data-act="invite">Invite to party</button></div>`;
    if (!P) return `<p class="so-sub">You are adventuring alone. Invite up to 7 others: party members share XP from nearby kills (half XP even if they never landed a hit), see each other's health, and can enter the Eclipse raid together (4–8). Party chat: <b>/p message</b>.</p>${invite}`;
    const lead = P.leader === S.myId;
    return `<p class="so-sub">Party of ${P.members.length}/8 · ${lead ? 'you lead' : 'led by ' + esc(P.members.find((m: any) => m.id === P.leader)?.name)} · chat with <b>/p message</b></p>
      <div class="so-list">${P.members.map((m: any) => `<div class="so-mem ${m.dead ? 'dead' : ''}"><div class="so-nm">${m.id === P.leader ? '<span class="so-crown">♛</span>' : ''}${esc(m.name)} <small>Lv ${m.level} ${esc(CLS[m.cls] ?? m.cls)}${m.zone ? ' · ' + esc(m.zone) : ''}</small></div>
        <div class="so-hp"><i style="width:${Math.round((100 * m.hp) / Math.max(1, m.mhp))}%"></i></div>
        ${lead && m.id !== S.myId ? `<div class="so-acts"><button class="btn small ghost" data-act="promote" data-id="${m.id}">Make leader</button><button class="btn small ghost" data-act="kick" data-id="${m.id}">Remove</button></div>` : ''}</div>`).join('')}</div>
      ${lead && P.members.length < 8 ? invite : ''}<div class="so-foot"><button class="btn ghost" data-act="leave">Leave party</button></div>`;
  };
  const guildTab = (S: SocialState) => {
    const G = S.guild;
    if (!G) {
      return `<p class="so-sub">Found a guild (500 gold) or join one. Guilds share a chat (<b>/g message</b>) and a bank of gold and items: anyone may deposit, the leader and officers withdraw.</p>
        <div class="so-card"><h4>Found a guild</h4><div class="so-row"><input class="so-in" data-gname placeholder="Guild name" maxlength="24"><input class="so-in tag" data-gtag placeholder="TAG" maxlength="4"><button class="btn primary" data-act="gcreate" ${S.gold < 500 ? 'disabled' : ''}>Found · 500 g</button></div></div>
        <div class="so-card"><h4>Guilds</h4>${S.list.length ? `<div class="so-list">${S.list.map((g: any) => `<div class="so-mem"><div class="so-nm"><span class="so-tag">${esc(g.tag)}</span> ${esc(g.name)} <small>${g.members} member${g.members === 1 ? '' : 's'}</small></div><div class="so-acts">${g.open ? `<button class="btn small" data-act="gjoin" data-id="${esc(g.id)}">Join</button>` : '<small class="so-dim">invite only</small>'}</div></div>`).join('')}</div>` : '<p class="so-dim">No guilds yet. Be the first.</p>'}</div>`;
    }
    const mgr = G.role !== 'member', lead = G.role === 'leader';
    const inv = S.inventory.filter((e) => e.n > 0);
    return `<div class="so-ghead"><span class="so-tag big">${esc(G.tag)}</span><div><b>${esc(G.name)}</b><small>${G.members.length} members · you are ${G.role} · ${G.open ? 'open recruitment' : 'invite only'}</small></div>
        ${lead ? `<button class="btn small ghost" data-act="gopen" data-open="${G.open ? 0 : 1}">${G.open ? 'Close recruitment' : 'Open recruitment'}</button>` : ''}</div>
      <div class="so-cols"><div class="so-card"><h4>Members</h4><div class="so-list">${G.members.map((m: any) => `<div class="so-mem"><div class="so-nm"><i class="so-dot ${m.online ? 'on' : ''}"></i>${m.role === 'leader' ? '<span class="so-crown">♛</span>' : m.role === 'officer' ? '<span class="so-crown">✦</span>' : ''}${esc(m.name)} <small>${esc(CLS[m.cls] ?? m.cls)}</small></div>
          ${m.id !== G.me && ((lead && m.role !== 'leader') || (mgr && m.role === 'member')) ? `<div class="so-acts">${lead ? (m.role === 'officer' ? `<button class="btn small ghost" data-act="gdemote" data-id="${esc(m.id)}">Demote</button>` : `<button class="btn small ghost" data-act="gpromote" data-id="${esc(m.id)}">Officer</button>`) : ''}<button class="btn small ghost" data-act="gkick" data-id="${esc(m.id)}">Remove</button></div>` : ''}</div>`).join('')}</div>
          ${mgr ? `<div class="so-row"><input class="so-in" data-ginv placeholder="Invite by name" maxlength="16"><button class="btn small primary" data-act="ginvite">Invite</button></div>` : ''}</div>
        <div class="so-card"><h4>Guild bank <span class="so-gold">${G.bank.gold.toLocaleString()} g</span></h4>
          <div class="so-row"><input class="so-in num" data-dg type="number" min="1" placeholder="Gold"><button class="btn small" data-act="depgold">Deposit</button>${mgr ? `<button class="btn small ghost" data-act="wdgold">Withdraw</button>` : ''}</div>
          <div class="so-row"><select class="so-in" data-di>${inv.map((e) => `<option value="${esc(e.item)}">${esc(S.itemName(e.item))} ×${e.n}</option>`).join('')}</select><button class="btn small" data-act="depitem" ${inv.length ? '' : 'disabled'}>Deposit item</button></div>
          <div class="so-list bank">${G.bank.items.length ? G.bank.items.map((e: any) => `<div class="so-mem"><div class="so-nm">${esc(S.itemName(e.item))} <small>×${e.n}</small></div>${mgr ? `<div class="so-acts"><button class="btn small ghost" data-act="wditem" data-id="${esc(e.item)}">Take 1</button></div>` : ''}</div>`).join('') : '<p class="so-dim">The vault is empty.</p>'}</div></div></div>
      <div class="so-card"><h4>Guild chat & log</h4><div class="so-log">${G.log.map((l: string) => `<div>${esc(l)}</div>`).join('')}</div>
        <div class="so-row"><input class="so-in" data-gchat placeholder="Message your guild (or /g in chat)" maxlength="200"><button class="btn small primary" data-act="gchat">Send</button></div></div>
      <div class="so-foot"><button class="btn ghost" data-act="gleave">Leave guild</button></div>`;
  };
  const arenaTab = (S: SocialState) => {
    const A = S.arena ?? { rating: 1000, wins: 0, losses: 0, board: [] };
    return `<div class="so-ghead"><span class="so-tag big">⚔</span><div><b>The Crimson Ring</b><small>Ranked 1v1 · rating ${A.rating} · ${A.wins}W ${A.losses}L</small></div>
        ${A.inMatch ? '<span class="so-pill">In a match</span>' : A.queued ? '<button class="btn ghost" data-act="aleave">Leave queue</button>' : '<button class="btn primary" data-act="ajoin">Queue for a match</button>'}</div>
      <p class="so-sub">You are pulled into the Ring when an opponent is found; you both start at full health and the bell rings after 5 seconds. A knockout or the higher health after 3 minutes wins. Nothing is lost in the Ring: no XP, gold or items. Ratings use Elo (start 1000).</p>
      <div class="so-card"><h4>Top gladiators</h4>${A.board?.length ? `<table class="so-t"><tr><th>#</th><th>Name</th><th>Class</th><th>Rating</th><th>W–L</th></tr>${A.board.map((r: any, i: number) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(CLS[r.cls] ?? r.cls)}</td><td><b>${r.rating}</b></td><td>${r.wins}–${r.losses}</td></tr>`).join('')}</table>` : '<p class="so-dim">No matches fought yet.</p>'}</div>`;
  };
  const eventsTab = (S: SocialState) => {
    const W = S.wb;
    const wb = !W || W.state === 'idle' ? `<p class="so-sub">The next world boss: <b>${esc(W?.name ?? '…')}</b> at ${esc(W?.where ?? '')}${W ? ` (${esc(W.region)}), in ${until(W.at)}` : ''}.</p>`
      : W.state === 'soon' ? `<p class="so-sub"><b>${esc(W.name)}</b> rises at ${esc(W.where)} (${esc(W.region)}) in <b>${until(W.at)}</b>. Everyone who fights it shares the spoils.</p>`
      : `<p class="so-sub"><b>${esc(W.name)}</b> is loose at ${esc(W.where)} (${esc(W.region)})! ${until(W.at)} left.</p><div class="so-hp big"><i style="width:${Math.round((100 * W.hp) / Math.max(1, W.mhp))}%"></i></div>`;
    const P = S.party, lead = P && P.leader === S.myId, n = P?.members.length ?? 1;
    return `<div class="so-card"><h4>World boss · every 20 minutes</h4>${wb}</div>
      <div class="so-card"><h4>Raid · The Eclipse Throne</h4><p class="so-sub">Kaelthar, the Eclipse Dragon (Lv 55). A party of 4–8 enters together from the Capital or the Foot of the Tower: three phases (shades at 66 %, enrage at 33 %) and an 8-minute eclipse. Every member is rewarded: an Epic piece, enchant stones, 1,500 gold and a chance at the Eclipse Scale Mantle (guaranteed on your first clear).</p>
        <div class="so-row">${S.raid?.k ? '<span class="so-pill">Raid in progress</span>' : `<button class="btn primary" data-act="raid" ${lead && n >= 4 ? '' : 'disabled'}>Enter the Eclipse Throne</button><small class="so-dim">${!P ? 'You need a party of 4–8.' : !lead ? 'Only your party leader can start it.' : n < 4 ? `Party of ${n}: you need ${4 - n} more.` : 'Ready.'}</small>`}</div></div>`;
  };
  let last = '';
  const tick = () => { const now = o.state().clock(); d.querySelectorAll<HTMLElement>('[data-until]').forEach((e) => { e.textContent = mmss(Number(e.dataset.until) - now); }); };
  const render = () => {
    const S = o.state();
    const body = tab === 'party' ? partyTab(S) : tab === 'guild' ? guildTab(S) : tab === 'arena' ? arenaTab(S) : eventsTab(S);
    if (body + tab === last) return; // nothing changed: keep the DOM (and whatever the pointer is on)
    last = body + tab;
    const focus = document.activeElement as HTMLInputElement | null, fsel = focus && d.contains(focus) && focus.dataset ? Object.keys(focus.dataset)[0] : null, fval = focus?.value;
    d.innerHTML = `<div class="inv-box so-box"><div class="inv-head"><div class="t"><span>Social</span></div><button class="x" data-close aria-label="Close">✕</button></div>
      <div class="mk-tabs"><div class="seg so-tabs">${[['party', 'Party'], ['guild', 'Guild'], ['arena', 'Arena'], ['events', 'Events']].map(([k, n]) => `<button class="${k === tab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div></div>
      <div class="so-body">${body}</div></div>`;
    if (fsel) { const f = d.querySelector(`[data-${fsel}]`) as HTMLInputElement | null; if (f) { f.value = fval ?? ''; f.focus(); } }
    d.querySelector('[data-close]')!.addEventListener('click', close);
    d.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab!; op('state'); render(); }));
    d.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act!, id = b.dataset.id;
      if (a === 'invite') { const n = val('[data-inv]'); if (n) op('invite', { name: n }); }
      else if (a === 'promote' || a === 'kick') op(a, { id: Number(id) });
      else if (a === 'leave') op('leave');
      else if (a === 'gcreate') op('gcreate', { name: val('[data-gname]'), tag: val('[data-gtag]') });
      else if (a === 'gjoin') op('gjoin', { id });
      else if (a === 'ginvite') { const n = val('[data-ginv]'); if (n) op('ginvite', { name: n }); }
      else if (a === 'gleave') op('gleave');
      else if (a === 'gopen') op('gop', { sub: 'open', open: b.dataset.open === '1' });
      else if (a === 'gpromote') op('gop', { sub: 'promote', id });
      else if (a === 'gdemote') op('gop', { sub: 'demote', id });
      else if (a === 'gkick') op('gop', { sub: 'kick', id });
      else if (a === 'depgold') op('gop', { sub: 'deposit', gold: Number(val('[data-dg]')) || 0 });
      else if (a === 'wdgold') op('gop', { sub: 'withdraw', gold: Number(val('[data-dg]')) || 0 });
      else if (a === 'depitem') op('gop', { sub: 'deposit', item: val('[data-di]'), n: 1 });
      else if (a === 'wditem') op('gop', { sub: 'withdraw', item: id, n: 1 });
      else if (a === 'gchat') { const t = val('[data-gchat]'); if (t) { op('gchat', { text: t }); (d.querySelector('[data-gchat]') as HTMLInputElement).value = ''; } }
      else if (a === 'ajoin') op('arenaJoin');
      else if (a === 'aleave') op('arenaLeave');
      else if (a === 'raid') { op('raid'); close(); }
    }));
    tick();
  };
  render();
  op('state');
  const iv = setInterval(tick, 1000);
  return { close, update: () => { const t = document.activeElement as HTMLElement | null; if (t && d.contains(t) && t.tagName !== 'BUTTON') return; render(); } };
}

/** A glass prompt for a party / guild invite. */
export function socialInvite(text: string, accept: () => void, decline: () => void) {
  const t = document.createElement('div');
  t.className = 'mk-invite so-invite';
  t.innerHTML = `${text}<div><button class="btn small primary" data-a>Accept</button><button class="btn small ghost" data-d>Decline</button></div>`;
  document.getElementById('ui')!.appendChild(t);
  const done = () => t.remove();
  (t.querySelector('[data-a]') as HTMLElement).onclick = () => { done(); accept(); };
  (t.querySelector('[data-d]') as HTMLElement).onclick = () => { done(); decline(); };
  setTimeout(done, 55000);
}
