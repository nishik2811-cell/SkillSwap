import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './src/app.js';
import { pool } from './src/db.js';
import { sent } from './src/auth/mail.js';
import { google } from './src/auth/google.js';

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

test('resend verification: new working link, same answer for unknown or verified accounts; WEB_ORIGIN has no trailing slash', async () => {
  const u = U('rs'); await call('/register', 'POST', u);
  const first = tokenFor(u.email), n = sent.length;
  assert.equal((await call('/resend-verification', 'POST', { identifier: u.username })).status, 200);
  assert.equal(sent.length, n + 1);
  assert.ok(!/[^:]\/\//.test(sent.at(-1).text.split('://')[1]), 'no double slash in the link');
  assert.notEqual(tokenFor(u.email), first);
  assert.equal((await call('/verify-email', 'POST', { token: tokenFor(u.email) })).status, 200);
  assert.equal((await call('/resend-verification', 'POST', { identifier: u.email })).status, 200);       // already verified
  assert.equal((await call('/resend-verification', 'POST', { identifier: 'nobody-' + run })).status, 200);
  assert.equal(sent.length, n + 1);
});

test('Google sign-in: state check, new account, relinking, hijack protection, suspended', async () => {
  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'cid.apps.test', GOOGLE_CLIENT_SECRET: 'x', WEB_ORIGIN: 'http://localhost:5173' });
  const root = base.replace('/auth', '');
  const hit = async (path, cookie) => { const r = await fetch(root + path, { redirect: 'manual', headers: cookie ? { cookie } : {} }); return { status: r.status, loc: r.headers.get('location'), cookies: r.headers.getSetCookie().map((c) => c.split(';')[0]) }; };
  assert.equal((await call('/providers')).body.google, true);
  const start = await hit('/auth/google'); assert.equal(start.status, 302);
  const url = new URL(start.loc), state = url.searchParams.get('state');
  assert.equal(url.searchParams.get('client_id'), 'cid.apps.test');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:5173/api/v1/auth/google/callback');
  assert.equal(start.cookies[0], `g_state=${state}`);
  const claims = (email, sub, extra = {}) => { google.exchange = async () => ({ sub, email, email_verified: true, name: 'Gee Ogle', ...extra }); };
  const cb = (st = state, ck = `g_state=${state}`) => hit(`/auth/google/callback?code=abc&state=${st}`, ck);
  assert.equal((await cb('wrong')).loc, '/login?error=google_failed'); // state mismatch
  assert.equal((await hit(`/auth/google/callback?code=abc&state=${state}`)).loc, '/login?error=google_failed'); // no state cookie
  assert.equal((await hit('/auth/google/callback?error=access_denied')).loc, '/login?error=google_cancelled');

  // new person: account is created verified, signed in, can reach /me
  const email = `g1-${run}@test.local`; claims(email, `sub1-${run}`);
  const ok = await cb(); assert.equal(ok.loc, '/dashboard');
  const sess = ok.cookies.find((c) => c.startsWith('ss_') || !c.startsWith('g_state'));
  const me = await call('/me', 'GET', undefined, sess); assert.equal(me.status, 200); assert.equal(me.body.user.email, email);
  assert.equal((await cb()).loc, '/dashboard'); // same Google account again: same user
  const [[n]] = await pool.query('SELECT COUNT(*) c, COUNT(email_verified_at) v FROM users WHERE email = ?', [email]); assert.equal(Number(n.c), 1); assert.equal(Number(n.v), 1);

  // existing password account with the same email gets linked; an UNVERIFIED one loses its password (pre-hijack protection)
  const u = U('gh'); await call('/register', 'POST', u);
  claims(u.email, `sub2-${run}`); assert.equal((await cb()).loc, '/dashboard');
  assert.equal((await call('/login', 'POST', { identifier: u.email, password: u.password })).status, 401);
  assert.equal((await pool.query('SELECT google_sub FROM users WHERE email = ?', [u.email]))[0][0].google_sub, `sub2-${run}`);

  // someone else's Google account on an already-linked address is refused; unverified Google emails are refused; suspended people are refused
  claims(u.email, `other-${run}`); assert.equal((await cb()).loc, '/login?error=google_failed');
  claims(`g3-${run}@test.local`, `sub3-${run}`, { email_verified: false }); assert.equal((await cb()).loc, '/login?error=google_unverified');
  await pool.query("UPDATE users SET status = 'suspended' WHERE email = ?", [email]); claims(email, `sub1-${run}`);
  assert.equal((await cb()).loc, '/login?error=account_inactive');

  delete process.env.GOOGLE_CLIENT_ID; assert.equal((await call('/providers')).body.google, false);
  assert.equal((await hit('/auth/google')).loc, '/login?error=google_not_configured');
});
