import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './src/app.js';
import { pool } from './src/db.js';
import { sent } from './src/auth/mail.js';

const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 5); // random suffix: test files run in parallel and can start in the same ms
const U = (n) => ({ email: `${n}-${run}@test.local`, username: `t${n}${run}`.slice(0, 20), password: 'correct horse 1', fullName: 'Test User' });
const call = async (path, method = 'GET', body, cookie) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: r.headers.getSetCookie()[0]?.split(';')[0] };
};
const tokenFor = (email) => sent.filter((m) => m.to === email).at(-1).text.match(/token=(\S+)/)[1];

const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}/api/v1/auth`;
test.after(async () => { srv.close(); const [ids] = await pool.query('SELECT id FROM users WHERE email LIKE ?', [`%-${run}@test.local`]); /* plain read, no locks */ if (ids.length) await pool.query('DELETE FROM users WHERE id IN (?)', [ids.map((r) => r.id)]); /* by primary key: row locks only, so parallel test files can't deadlock on a range scan */ await pool.end(); });

test('register validates input', async () => {
  assert.equal((await call('/register', 'POST', { ...U('a'), password: 'short' })).status, 400);
  assert.equal((await call('/register', 'POST', { ...U('a'), username: 'Bad Name!' })).status, 400);
  assert.equal((await call('/register', 'POST', { ...U('a'), email: 'nope' })).status, 400);
});

test('duplicate username -> 409 with free suggestions, case-insensitive', async () => {
  const u = U('dup');
  assert.equal((await call('/register', 'POST', u)).status, 201);
  const r = await call('/register', 'POST', { ...U('dup2'), username: u.username.toUpperCase() });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'username_taken');
  assert.ok(r.body.suggestions.length > 0 && !r.body.suggestions.includes(u.username));
  const a = await call(`/username-available?u=${u.username}`);
  assert.equal(a.body.available, false);
  assert.equal((await call('/username-available?u=zz' + run)).body.available, true);
});

test('duplicate email -> 409', async () => {
  const u = U('em'); await call('/register', 'POST', u);
  assert.equal((await call('/register', 'POST', { ...U('em2'), email: u.email })).body.error, 'email_taken');
});

test('concurrent registration of one username: exactly one wins', async () => {
  const name = `race${run}`.slice(0, 20);
  const rs = await Promise.all([1, 2, 3, 4].map((i) => call('/register', 'POST', { ...U('r' + i), username: name })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409, 409]);
});

test('login blocked until verified; works by email and username; bad creds rejected', async () => {
  const u = U('lg'); await call('/register', 'POST', u);
  assert.equal((await call('/login', 'POST', { identifier: u.email, password: u.password })).body.error, 'email_not_verified');
  assert.equal((await call('/verify-email', 'POST', { token: 'x'.repeat(20) })).status, 400);
  assert.equal((await call('/verify-email', 'POST', { token: tokenFor(u.email) })).status, 200);
  assert.equal((await call('/verify-email', 'POST', { token: tokenFor(u.email) })).status, 400); // single use
  assert.equal((await call('/login', 'POST', { identifier: u.email, password: 'wrong-password' })).status, 401);
  assert.equal((await call('/login', 'POST', { identifier: 'nobody@x.io', password: 'whatever12' })).status, 401);
  const byEmail = await call('/login', 'POST', { identifier: u.email, password: u.password });
  assert.equal(byEmail.status, 200);
  const byName = await call('/login', 'POST', { identifier: u.username, password: u.password });
  assert.equal(byName.status, 200);
  assert.equal((await call('/me')).status, 401);
  assert.equal((await call('/me', 'GET', null, byEmail.cookie)).body.user.username, u.username);
  await call('/logout', 'POST', {}, byEmail.cookie);
  assert.equal((await call('/me', 'GET', null, byEmail.cookie)).status, 401);
  assert.equal((await call('/me', 'GET', null, byName.cookie)).status, 200); // other session unaffected
});

test('password reset: single use, invalidates sessions, old password dead', async () => {
  const u = U('pw'); await call('/register', 'POST', u);
  await call('/verify-email', 'POST', { token: tokenFor(u.email) });
  const s = await call('/login', 'POST', { identifier: u.email, password: u.password });
  const before = sent.length;
  assert.equal((await call('/forgot-password', 'POST', { email: `ghost-${run}@test.local` })).status, 200);
  assert.equal(sent.length, before); // no mail for unknown email, same response
  await call('/forgot-password', 'POST', { email: u.email });
  const t = tokenFor(u.email);
  assert.equal((await call('/reset-password', 'POST', { token: t, password: 'short' })).status, 400);
  assert.equal((await call('/reset-password', 'POST', { token: t, password: 'brand new pass 2' })).status, 200);
  assert.equal((await call('/reset-password', 'POST', { token: t, password: 'another pass 33' })).status, 400);
  assert.equal((await call('/me', 'GET', null, s.cookie)).status, 401);
  assert.equal((await call('/login', 'POST', { identifier: u.email, password: u.password })).status, 401);
  assert.equal((await call('/login', 'POST', { identifier: u.email, password: 'brand new pass 2' })).status, 200);
});
