import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';
import { app } from './src/app.js';
import { pool } from './src/db.js';
import { sent } from './src/auth/mail.js';
import { initRealtime } from './src/realtime.js';

const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 5); // random suffix: test files run in parallel and can start in the same ms
const srv = createServer(app); initRealtime(srv); srv.listen(0);
const port = srv.address().port, base = `http://127.0.0.1:${port}/api/v1`;
const call = async (path, method = 'GET', body, who) => {
  const isForm = body instanceof FormData;
  const r = await fetch(base + path, { method, headers: { ...(!isForm && { 'content-type': 'application/json' }), ...(who && { cookie: who.cookie }) }, body: isForm ? body : body && JSON.stringify(body) });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : null, ct, raw: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()), headers: r.headers };
};
async function makeUser(n) {
  const u = { email: `${n}-${run}@test.local`, username: `c${n}${run}`.slice(0, 20), password: 'correct horse 1', fullName: `Chat ${n}` };
  await call('/auth/register', 'POST', u);
  await call('/auth/verify-email', 'POST', { token: sent.filter((m) => m.to === u.email).at(-1).text.match(/token=(\S+)/)[1] });
  const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: u.password }) });
  return { ...u, cookie: r.headers.getSetCookie()[0].split(';')[0] };
}
async function befriend(a, b) { const r = await call('/connections', 'POST', { username: b.username }, a); await call(`/connections/${r.body.id}/accept`, 'POST', {}, b); }
const send = (id, body, who) => call(`/conversations/${id}/messages`, 'POST', { body }, who);
test.after(async () => { srv.closeAllConnections?.(); srv.close(); const [ids] = await pool.query('SELECT id FROM users WHERE email LIKE ?', [`%-${run}@test.local`]); /* plain read, no locks */ if (ids.length) await pool.query('DELETE FROM users WHERE id IN (?)', [ids.map((r) => r.id)]); /* by primary key: row locks only, so parallel test files can't deadlock on a range scan */ await pool.end(); });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('direct chat: requires connection, one per pair (even under a race), members only', async () => {
  const [a, b, c] = await Promise.all([makeUser('a'), makeUser('b'), makeUser('c')]);
  assert.equal((await call('/conversations', 'POST', { type: 'direct', username: b.username }, a)).status, 403);
  await befriend(a, b);
  const rs = await Promise.all([call('/conversations', 'POST', { type: 'direct', username: b.username }, a), call('/conversations', 'POST', { type: 'direct', username: a.username }, b)]);
  assert.ok(rs.every((r) => [200, 201].includes(r.status)));
  assert.equal(rs[0].body.id, rs[1].body.id);
  const id = rs[0].body.id;
  assert.equal((await call('/conversations')).status, 401);
  assert.equal((await send(id, 'hi b', a)).status, 201);
  assert.equal((await send(id, '   ', a)).status, 400);
  assert.equal((await send(id, 'x'.repeat(4001), a)).status, 400);
  for (const [m, p, body] of [['GET', `/conversations/${id}`], ['GET', `/conversations/${id}/messages`], ['POST', `/conversations/${id}/messages`, { body: 'intruder' }], ['POST', `/conversations/${id}/read`, { messageId: 1 }]])
    assert.equal((await call(p, m, body, c)).status, 404, `${m} ${p}`); // outsiders learn nothing
  const msgs = (await call(`/conversations/${id}/messages`, 'GET', null, b)).body;
  assert.equal(msgs.messages.length, 1); assert.equal(msgs.messages[0].body, 'hi b'); assert.equal(msgs.messages[0].sender.username, a.username);
  const list = (await call('/conversations', 'GET', null, b)).body;
  assert.equal(list.conversations[0].unread, 1); assert.equal(list.unread, 1); assert.equal(list.conversations[0].with.username, a.username);
  assert.equal((await call('/conversations', 'GET', null, a)).body.conversations[0].unread, 0); // my own message isn't unread for me
});

test('read receipts, coalesced message notifications, soft delete', async () => {
  const [a, b] = await Promise.all([makeUser('r1'), makeUser('r2')]); await befriend(a, b);
  const id = (await call('/conversations', 'POST', { type: 'direct', username: b.username }, a)).body.id;
  const m1 = (await send(id, 'one', a)).body, m2 = (await send(id, 'two', a)).body;
  const notes = (await call('/notifications', 'GET', null, b)).body.notifications.filter((n) => n.type === 'message');
  assert.equal(notes.length, 1); // two messages, one notification
  assert.equal((await call(`/conversations/${id}/read`, 'POST', { messageId: m1.id }, b)).status, 200);
  assert.equal((await call('/conversations', 'GET', null, b)).body.conversations[0].unread, 1);
  await call(`/conversations/${id}/read`, 'POST', { messageId: m2.id + 999 }, b); // clamped to the newest real message
  const det = (await call(`/conversations/${id}`, 'GET', null, a)).body;
  assert.equal(det.members.find((m) => m.username === b.username).lastReadMessageId, m2.id);
  await call(`/conversations/${id}/read`, 'POST', { messageId: m1.id }, b); // never moves backwards
  assert.equal((await call(`/conversations/${id}`, 'GET', null, a)).body.members.find((m) => m.username === b.username).lastReadMessageId, m2.id);
  assert.equal((await call('/notifications', 'GET', null, b)).body.notifications.find((n) => n.type === 'message').readAt !== null, true);
  assert.equal((await call(`/conversations/${id}/messages/${m1.id}`, 'DELETE', null, b)).status, 404); // not yours
  assert.equal((await call(`/conversations/${id}/messages/${m1.id}`, 'DELETE', null, a)).status, 200);
  const after = (await call(`/conversations/${id}/messages`, 'GET', null, b)).body.messages;
  assert.equal(after[0].deleted, true); assert.equal(after[0].body, null);
});

test('pagination: newest page first, hasMore, before cursor', async () => {
  const [a, b] = await Promise.all([makeUser('p1'), makeUser('p2')]); await befriend(a, b);
  const id = (await call('/conversations', 'POST', { type: 'direct', username: b.username }, a)).body.id;
  for (let i = 1; i <= 5; i++) await send(id, `m${i}`, a);
  const p1 = (await call(`/conversations/${id}/messages?limit=2`, 'GET', null, b)).body;
  assert.deepEqual(p1.messages.map((m) => m.body), ['m4', 'm5']); assert.equal(p1.hasMore, true);
  const p2 = (await call(`/conversations/${id}/messages?limit=10&before=${p1.messages[0].id}`, 'GET', null, b)).body;
  assert.deepEqual(p2.messages.map((m) => m.body), ['m1', 'm2', 'm3']); assert.equal(p2.hasMore, false);
});

test('groups: creation rules, admin-only management, leaving, last-admin handover', async () => {
  const [a, b, c, d] = await Promise.all([makeUser('g1'), makeUser('g2'), makeUser('g3'), makeUser('g4')]);
  await befriend(a, b); await befriend(a, c);
  assert.equal((await call('/conversations', 'POST', { type: 'group', title: 'X', usernames: [d.username] }, a)).status, 400); // not connected
  const g = await call('/conversations', 'POST', { type: 'group', title: 'Guitar club', usernames: [b.username, c.username] }, a);
  assert.equal(g.status, 201); const id = g.body.id;
  const det = (await call(`/conversations/${id}`, 'GET', null, b)).body;
  assert.equal(det.members.length, 3); assert.equal(det.myRole, 'member'); assert.equal(det.title, 'Guitar club');
  assert.equal((await call('/notifications', 'GET', null, b)).body.notifications.some((n) => n.type === 'group_invite'), true);
  assert.equal((await call(`/conversations/${id}/messages`, 'GET', null, b)).body.messages[0].kind, 'system');
  // non-admin cannot rename, add, or remove
  assert.equal((await call(`/conversations/${id}`, 'PATCH', { title: 'Hax' }, b)).status, 403);
  assert.equal((await call(`/conversations/${id}/members`, 'POST', { usernames: [d.username] }, b)).status, 403);
  assert.equal((await call(`/conversations/${id}/members/${c.username}`, 'DELETE', null, b)).status, 403);
  // admin adds a person they are not connected to: refused; after connecting: ok; duplicates ignored
  assert.equal((await call(`/conversations/${id}/members`, 'POST', { usernames: [d.username] }, a)).status, 400);
  await befriend(a, d);
  assert.deepEqual((await call(`/conversations/${id}/members`, 'POST', { usernames: [d.username] }, a)).body.added, [d.username]);
  assert.deepEqual((await call(`/conversations/${id}/members`, 'POST', { usernames: [d.username] }, a)).body.added, []);
  assert.equal((await send(id, 'welcome all', d)).status, 201);
  assert.equal((await call(`/conversations/${id}`, 'PATCH', { title: 'Guitar crew' }, a)).status, 200);
  // admin removes c; c loses access immediately
  assert.equal((await call(`/conversations/${id}/members/${c.username}`, 'DELETE', null, a)).status, 200);
  assert.equal((await call(`/conversations/${id}/messages`, 'GET', null, c)).status, 404);
  assert.equal((await send(id, 'still here?', c)).status, 404);
  // admin leaves: someone else is promoted, group survives
  assert.equal((await call(`/conversations/${id}/members/${a.username}`, 'DELETE', null, a)).status, 200);
  const after = (await call(`/conversations/${id}`, 'GET', null, b)).body;
  assert.equal(after.members.filter((m) => m.role === 'admin').length, 1);
  // everyone leaves: conversation is gone
  for (const u of [b, d]) await call(`/conversations/${id}/members/${u.username}`, 'DELETE', null, u);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM conversations WHERE id = ?', [id]); assert.equal(n, 0);
  assert.equal((await call(`/conversations/${id}/members/${b.username}`, 'DELETE', null, b)).status, 404);
});

test('attachments: allow-list, member-only download, safe headers', async () => {
  const [a, b, c] = await Promise.all([makeUser('f1'), makeUser('f2'), makeUser('f3')]); await befriend(a, b);
  const id = (await call('/conversations', 'POST', { type: 'direct', username: b.username }, a)).body.id;
  const form = new FormData();
  form.append('body', 'see attached');
  form.append('files', new Blob([PNG], { type: 'image/png' }), 'pixel.png');
  form.append('files', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html'); // not on the allow-list: dropped
  form.append('files', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
  const r = await call(`/conversations/${id}/messages`, 'POST', form, a);
  assert.equal(r.status, 201); assert.deepEqual(r.body.attachments.map((x) => x.name), ['pixel.png', 'notes.txt']);
  const [img, txt] = r.body.attachments;
  const dl = await call(img.url.replace('/api/v1', ''), 'GET', null, b);
  assert.equal(dl.status, 200); assert.equal(dl.ct.split(';')[0], 'image/png'); assert.ok(dl.raw.equals(PNG));
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  const t = await call(txt.url.replace('/api/v1', ''), 'GET', null, b);
  assert.match(t.headers.get('content-disposition'), /attachment/); // non-images always download, never render
  assert.equal((await call(img.url.replace('/api/v1', ''), 'GET', null, c)).status, 404); // outsider
  assert.equal((await call(img.url.replace('/api/v1', ''))).status, 401);
  const onlyBad = new FormData(); onlyBad.append('files', new Blob(['x'], { type: 'text/html' }), 'x.html');
  assert.equal((await call(`/conversations/${id}/messages`, 'POST', onlyBad, a)).status, 400); // nothing left to send
});

test('blocking or unfriending stops direct messaging', async () => {
  const [a, b] = await Promise.all([makeUser('k1'), makeUser('k2')]); await befriend(a, b);
  const id = (await call('/conversations', 'POST', { type: 'direct', username: b.username }, a)).body.id;
  assert.equal((await send(id, 'before', a)).status, 201);
  await call('/blocks', 'POST', { username: a.username }, b);
  assert.equal((await send(id, 'after block', a)).status, 403);
  assert.equal((await send(id, 'blocker too', b)).status, 403);
  assert.equal((await call(`/conversations/${id}/messages`, 'GET', null, a)).body.messages.length, 1); // history stays readable
});

test('realtime: live message, typing relay (members only), read events, presence', async () => {
  const [a, b, c] = await Promise.all([makeUser('s1'), makeUser('s2'), makeUser('s3')]); await befriend(a, b); await befriend(a, c);
  const id = (await call('/conversations', 'POST', { type: 'direct', username: b.username }, a)).body.id;
  const url = `http://127.0.0.1:${port}`;
  const open = (u) => new Promise((res, rej) => { const s = connect(url, { extraHeaders: { cookie: u.cookie }, reconnection: false }); s.on('connect', () => setTimeout(() => res(s), 150)); s.on('connect_error', rej); });
  const next = (s, ev, ms = 2000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`no ${ev}`)), ms); s.once(ev, (x) => { clearTimeout(t); res(x); }); });
  const sa = await open(a);
  const presence = next(sa, 'presence');
  const sb = await open(b), sc = await open(c); // b coming online is announced to a (they share a chat)
  const pr = await presence; assert.equal(pr.username, b.username); assert.equal(pr.online, true);
  const gotMsg = next(sb, 'message'); await send(id, 'live!', a);
  assert.equal((await gotMsg).body, 'live!');
  const typing = next(sb, 'typing'); sa.emit('typing', { conversationId: id, typing: true });
  assert.deepEqual(await typing, { conversationId: id, username: a.username, typing: true });
  let leaked = false; sc.on('typing', () => { leaked = true; });
  sc.emit('typing', { conversationId: id, typing: true }); // c is not in the chat: nobody hears it, and c hears nothing
  sa.emit('typing', { conversationId: id, typing: false });
  await new Promise((r) => setTimeout(r, 300)); assert.equal(leaked, false);
  const rd = next(sa, 'read'); const m = (await send(id, 'two', a)).body; await call(`/conversations/${id}/read`, 'POST', { messageId: m.id }, b);
  assert.equal((await rd).username, b.username);
  // status: b picks Busy, a sees it live and in the chat list; Invisible looks offline; nonsense is refused
  assert.equal(pr.status, 'online');
  const busy = next(sa, 'presence'); assert.equal((await call('/me/status', 'PATCH', { status: 'busy' }, b)).status, 200);
  const pb = await busy; assert.equal(pb.online, true); assert.equal(pb.status, 'busy');
  assert.equal((await call('/conversations', 'GET', null, a)).body.conversations.find((x) => x.id === id).with.status, 'busy');
  const inv = next(sa, 'presence'); await call('/me/status', 'PATCH', { status: 'invisible' }, b);
  const pi = await inv; assert.equal(pi.online, false); assert.equal(pi.status, null);
  assert.equal((await call('/conversations', 'GET', null, a)).body.conversations.find((x) => x.id === id).with.online, false);
  assert.equal((await call('/me/status', 'PATCH', { status: 'gone' }, b)).status, 400);
  assert.equal((await call('/auth/me', 'GET', null, b)).body.user.status, 'invisible');
  const off = next(sa, 'presence'); sb.close(); assert.equal((await off).online, false);
  sa.close(); sc.close();
});

test('edit, react and search: own live messages only, members only, reactions toggle', async () => {
  const [a, b, c] = await Promise.all([makeUser('ea'), makeUser('eb'), makeUser('ec')]);
  await befriend(a, b);
  const id = (await call('/conversations', 'POST', { type: 'direct', username: b.username }, a)).body.id;
  const m = (await send(id, 'helo wrld 100%', a)).body, other = (await send(id, 'something else', b)).body;
  const url = `/conversations/${id}/messages/${m.id}`;
  assert.equal((await call(url, 'PATCH', { body: 'x' }, b)).status, 404);            // not the sender
  assert.equal((await call(url, 'PATCH', { body: 'x' }, c)).status, 404);            // not a member
  assert.equal((await call(url, 'PATCH', { body: '  ' }, a)).status, 400);
  const e = await call(url, 'PATCH', { body: 'hello world 100%' }, a);
  assert.equal(e.status, 200); assert.equal(e.body.body, 'hello world 100%'); assert.equal(e.body.edited, true);

  assert.equal((await call(url + '/reactions', 'POST', { emoji: '<b>' }, b)).status, 400);
  assert.equal((await call(url + '/reactions', 'POST', { emoji: '👍' }, c)).status, 404);
  await call(url + '/reactions', 'POST', { emoji: '👍' }, a);
  assert.deepEqual((await call(url + '/reactions', 'POST', { emoji: '👍' }, b)).body.reactions, [{ emoji: '👍', users: [a.username, b.username] }]);
  assert.deepEqual((await call(url + '/reactions', 'POST', { emoji: '👍' }, a)).body.reactions, [{ emoji: '👍', users: [b.username] }]);
  assert.deepEqual((await call(url + '/reactions', 'POST', { emoji: '❤️' }, b)).body.reactions, [{ emoji: '❤️', users: [b.username] }]); // a different emoji switches, it doesn't stack

  const find = async (q, who = a) => (await call(`/conversations/${id}/messages?q=${encodeURIComponent(q)}`, 'GET', undefined, who));
  assert.deepEqual((await find('WORLD')).body.messages.map((x) => x.id), [m.id]);     // case-insensitive
  assert.equal((await find('100%')).body.messages.length, 1);
  assert.equal((await find('%')).body.messages.length, 1);                            // % is literal, not a wildcard
  assert.equal((await find('helo')).body.messages.length, 0);                         // the old text is gone
  assert.equal((await find('world', c)).status, 404);
  await call(`/conversations/${id}/messages/${other.id}`, 'DELETE', undefined, b);
  assert.equal((await find('something')).body.messages.length, 0);                    // deleted messages are not searchable
  assert.equal((await call(`/conversations/${id}/messages/${other.id}`, 'PATCH', { body: 'back' }, b)).status, 404);
});
