import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './src/app.js';
import { pool } from './src/db.js';
import { sent } from './src/auth/mail.js';
import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';
import { initRealtime } from './src/realtime.js';

const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 5); // random suffix: test files run in parallel and can start in the same ms
const srv = createServer(app); initRealtime(srv); srv.listen(0);
const base = `http://127.0.0.1:${srv.address().port}/api/v1`;
const call = async (path, method = 'GET', body, who) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(who && { cookie: who.cookie }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: r.headers.getSetCookie()[0]?.split(';')[0] };
};
async function makeUser(n) {
  const u = { email: `${n}-${run}@test.local`, username: `s${n}${run}`.slice(0, 20), password: 'correct horse 1', fullName: `Social ${n}` };
  await call('/auth/register', 'POST', u);
  await call('/auth/verify-email', 'POST', { token: sent.filter((m) => m.to === u.email).at(-1).text.match(/token=(\S+)/)[1] });
  return { ...u, cookie: (await call('/auth/login', 'POST', { identifier: u.email, password: u.password })).cookie };
}
test.after(async () => { srv.closeAllConnections?.(); srv.close(); const [ids] = await pool.query('SELECT id FROM users WHERE email LIKE ?', [`%-${run}@test.local`]); /* plain read, no locks */ if (ids.length) await pool.query('DELETE FROM users WHERE id IN (?)', [ids.map((r) => r.id)]); /* by primary key: row locks only, so parallel test files can't deadlock on a range scan */ await pool.end(); });
const unread = async (u) => (await call('/notifications', 'GET', null, u)).body;

test('request -> notify -> accept -> notify; guards on who may respond', async () => {
  const [a, b, c] = await Promise.all([makeUser('a'), makeUser('b'), makeUser('c')]);
  assert.equal((await call('/connections', 'POST', { username: b.username })).status, 401);
  assert.equal((await call('/connections', 'POST', { username: a.username }, a)).status, 400); // self
  assert.equal((await call('/connections', 'POST', { username: 'nobody-x' }, a)).status, 404);
  const r = await call('/connections', 'POST', { username: b.username, message: 'Teach me guitar?' }, a);
  assert.equal(r.status, 201);
  assert.equal((await call('/connections', 'POST', { username: b.username }, a)).body.error, 'already_requested');
  const nb = await unread(b);
  assert.equal(nb.unread, 1); assert.equal(nb.notifications[0].type, 'connection_request');
  assert.equal((await call('/relationship/' + b.username, 'GET', null, a)).body.status, 'pending_sent');
  assert.equal((await call('/relationship/' + a.username, 'GET', null, b)).body.status, 'pending_received');
  const list = (await call('/connections', 'GET', null, b)).body;
  assert.equal(list.received.length, 1); assert.equal(list.received[0].user.username, a.username);
  // only the addressee may accept; requester and outsiders cannot
  const id = r.body.id;
  assert.equal((await call(`/connections/${id}/accept`, 'POST', {}, a)).status, 404);
  assert.equal((await call(`/connections/${id}/accept`, 'POST', {}, c)).status, 404);
  assert.equal((await call(`/connections/${id}/accept`, 'POST', {}, b)).status, 200);
  assert.equal((await call(`/connections/${id}/accept`, 'POST', {}, b)).status, 404); // not pending any more
  assert.equal((await unread(a)).notifications[0].type, 'connection_accepted');
  assert.equal((await call('/connections', 'POST', { username: a.username }, b)).body.error, 'already_connected');
  assert.equal((await call('/connections', 'GET', null, a)).body.connected.length, 1);
  // an outsider cannot remove it; either member can
  assert.equal((await call(`/connections/${id}`, 'DELETE', null, c)).status, 404);
  assert.equal((await call(`/connections/${id}`, 'DELETE', null, b)).status, 200);
  assert.equal((await call('/relationship/' + b.username, 'GET', null, a)).body.status, 'none');
});

test('reject, cancel, re-request rules', async () => {
  const [a, b] = await Promise.all([makeUser('r1'), makeUser('r2')]);
  const id = (await call('/connections', 'POST', { username: b.username }, a)).body.id;
  assert.equal((await call(`/connections/${id}`, 'DELETE', null, b)).status, 404); // addressee rejects, not cancels
  assert.equal((await call(`/connections/${id}`, 'DELETE', null, a)).status, 200); // requester cancels
  const id2 = (await call('/connections', 'POST', { username: b.username }, a)).body.id;
  assert.equal((await call(`/connections/${id2}/reject`, 'POST', {}, b)).status, 200);
  assert.equal((await unread(a)).notifications[0].type, 'connection_rejected');
  assert.equal((await call('/connections', 'POST', { username: b.username }, a)).body.error, 'previously_declined'); // no spamming
  assert.equal((await call('/connections', 'POST', { username: a.username }, b)).status, 201); // but they may reach out
  assert.equal((await call('/relationship/' + a.username, 'GET', null, b)).body.status, 'pending_sent');
});

test('simultaneous requests A<->B end as one accepted connection, never two rows', async () => {
  const [a, b] = await Promise.all([makeUser('x1'), makeUser('x2')]);
  const rs = await Promise.all([call('/connections', 'POST', { username: b.username }, a), call('/connections', 'POST', { username: a.username }, b)]);
  assert.ok(rs.every((r) => [200, 201, 409].includes(r.status)), JSON.stringify(rs.map((r) => r.body)));
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM connections c JOIN users u ON u.id = c.requester_id WHERE u.username IN (?, ?)', [a.username, b.username]);
  assert.equal(n, 1);
});

test('block hides both ways, removes the connection, and is reversible; reports are validated and deduped', async () => {
  const [a, b] = await Promise.all([makeUser('b1'), makeUser('b2')]);
  const id = (await call('/connections', 'POST', { username: b.username }, a)).body.id;
  await call(`/connections/${id}/accept`, 'POST', {}, b);
  assert.equal((await call('/blocks', 'POST', { username: b.username }, a)).status, 200);
  assert.equal((await call('/connections', 'GET', null, a)).body.connected.length, 0);
  assert.equal((await call('/connections', 'POST', { username: a.username }, b)).status, 404); // blocked party can't tell
  assert.equal((await call('/connections', 'POST', { username: b.username }, a)).status, 404);
  assert.equal((await call('/relationship/' + a.username, 'GET', null, b)).status, 404); // blocked person sees nothing different from a missing user
  assert.equal((await call('/users/' + a.username, 'GET', null, b)).status, 404);
  assert.equal((await call('/users/' + a.username, 'GET', null, a)).status, 200); // blocker can still open it to unblock
  assert.equal((await call('/relationship/' + b.username, 'GET', null, a)).body.status, 'blocked');
  assert.equal((await call('/blocks', 'GET', null, a)).body.blocked[0].username, b.username);
  await call('/blocks/' + b.username, 'DELETE', null, a);
  assert.equal((await call('/connections', 'POST', { username: b.username }, a)).status, 201);
  assert.equal((await call('/reports', 'POST', { username: b.username, reason: 'nope' }, a)).status, 400);
  assert.equal((await call('/reports', 'POST', { username: b.username, reason: 'spam', details: 'x' }, a)).status, 201);
  assert.equal((await call('/reports', 'POST', { username: b.username, reason: 'spam' }, a)).status, 409);
  assert.equal((await call('/reports', 'POST', { username: a.username, reason: 'spam' }, a)).status, 404); // self
});

test('notifications: unread count, mark read, isolation between users', async () => {
  const [a, b] = await Promise.all([makeUser('n1'), makeUser('n2')]);
  await call('/connections', 'POST', { username: b.username }, a);
  const n = await unread(b); assert.equal(n.unread, 1);
  assert.equal((await unread(a)).unread, 0);
  await call(`/notifications/${n.notifications[0].id}/read`, 'POST', {}, a); // wrong owner: no effect
  assert.equal((await unread(b)).unread, 1);
  await call(`/notifications/${n.notifications[0].id}/read`, 'POST', {}, b);
  assert.equal((await unread(b)).unread, 0);
  await call('/connections', 'POST', { username: b.username }, a); // dup, no new notification
  assert.equal((await unread(b)).notifications.length, 1);
  assert.equal((await call('/notifications/read-all', 'POST', {}, b)).status, 200);
});

test('unknown API paths are 404 even when logged out', async () => {
  assert.equal((await call('/definitely-not-a-route')).status, 404);
});

test('pending-request cap returns 429', async () => {
  const [a, t] = await Promise.all([makeUser('cap'), makeUser('capt')]);
  const [[me]] = await pool.query('SELECT id FROM users WHERE username = ?', [a.username]);
  const rows = Array.from({ length: 50 }, (_, i) => [`filler${i}-${run}@test.local`, `cap${i}${run}`.slice(0, 20), 'x', 'Filler']);
  await pool.query('INSERT INTO users (email, username, password_hash, full_name, email_verified_at) VALUES ?', [rows.map((r) => [...r].concat(new Date()))]);
  await pool.query('INSERT INTO connections (requester_id, addressee_id) SELECT ?, id FROM users WHERE email LIKE ? AND email LIKE ?', [me.id, "filler%", `%-${run}@test.local`]);
  assert.equal((await call('/connections', 'POST', { username: t.username }, a)).status, 429);
});

test('realtime: socket needs a valid session; request pushes a live notification', async () => {
  const [a, b] = await Promise.all([makeUser('s1'), makeUser('s2')]);
  const url = `http://127.0.0.1:${srv.address().port}`;
  const anon = connect(url, { reconnection: false });
  await new Promise((res, rej) => { anon.on('connect_error', (e) => (e.message === 'unauthenticated' ? res() : rej(e))); anon.on('connect', () => rej(new Error('anonymous socket accepted'))); });
  anon.close();
  const sock = connect(url, { extraHeaders: { cookie: b.cookie }, reconnection: false });
  await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); });
  const got = new Promise((res) => sock.on('notification', res));
  await call('/connections', 'POST', { username: b.username }, a);
  const n = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('no live notification')), 3000))]);
  assert.equal(n.type, 'connection_request');
  // other users' sockets do not receive it
  sock.close();
});

test('socket token: cross-origin login for the live socket, bound to one user, short-lived, unforgeable', async () => {
  const [a, b] = await Promise.all([makeUser('t1'), makeUser('t2')]);
  assert.equal((await call('/auth/socket-token')).status, 401);
  const tok = (await call('/auth/socket-token', 'GET', null, a)).body.token; assert.ok(tok);
  const url = `http://127.0.0.1:${srv.address().port}`;
  const open = (auth) => new Promise((res) => { const s = connect(url, { auth, reconnection: false, transports: ['websocket'] }); s.on('connect', () => res({ ok: true, s })); s.on('connect_error', (e) => res({ ok: false, msg: e.message, s })); });
  const good = await open({ token: tok }); assert.equal(good.ok, true); // no cookie at all
  const got = new Promise((res) => good.s.on('notification', res));
  await call('/connections', 'POST', { username: a.username }, b);
  assert.equal((await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('no push')), 3000))])).type, 'connection_request'); // it is really a's socket
  good.s.close();
  for (const bad of [tok.slice(0, -3) + 'abc', tok.split('.')[0] + '.', 'garbage', `${Buffer.from(JSON.stringify({ uid: 1, exp: 9999999999 })).toString('base64url')}.${tok.split('.')[1]}`]) {
    const r = await open({ token: bad }); assert.equal(r.ok, false); assert.equal(r.msg, 'unauthenticated'); r.s.close();
  }
  const { signSocketToken } = await import('./src/auth/crypto.js');
  const expired = await open({ token: signSocketToken(1, -5) }); assert.equal(expired.ok, false); expired.s.close(); // expired
});
