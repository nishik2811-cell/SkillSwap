import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './src/app.js';
import { pool } from './src/db.js';
import { sent } from './src/auth/mail.js';
import * as gw from './src/payments/razorpay.js';

process.env.RAZORPAY_KEY_ID = 'rzp_test_admin'; process.env.RAZORPAY_KEY_SECRET = 'secret_admin'; process.env.RAZORPAY_WEBHOOK_SECRET = 'wh_admin';
const refunds = [];
gw.setTransport(async ({ method, url, body }) => { // fake gateway: accepts every refund instantly
  if (method === 'POST' && /\/refund$/.test(url)) { const r = { id: `rfnd_a${refunds.length + 1}${run}`, status: 'processed', amount: body.amount }; refunds.push(r); return { status: 200, json: r }; }
  return { status: 404, json: {} };
});
const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}/api/v1`;
const call = async (path, method = 'GET', body, who) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(who && { cookie: who.cookie }) }, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
let GUITAR; const created = { cats: [], skills: [] };
async function makeUser(n, { mentor = false, admin = false } = {}) {
  const u = { email: `${n}-${run}@test.local`, username: `d${n}${run}`.slice(0, 20), password: 'correct horse 1', fullName: `Adm ${n}` };
  await call('/auth/register', 'POST', u);
  await call('/auth/verify-email', 'POST', { token: sent.filter((m) => m.to === u.email).at(-1).text.match(/token=(\S+)/)[1] });
  if (admin) await pool.query("UPDATE users SET role = 'admin' WHERE username = ?", [u.username]);
  const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: u.password }) });
  const me = { ...u, cookie: r.headers.getSetCookie()[0].split(';')[0] };
  me.id = (await pool.query('SELECT id FROM users WHERE username = ?', [u.username]))[0][0].id;
  if (mentor) await call('/me/preferences', 'PUT', { mentorSkills: [{ skillId: GUITAR, level: 'expert', pricing: 'both', priceMinPaise: 20000, priceMaxPaise: 50000 }], learnerSkills: [], availability: [], languages: [], finishOnboarding: true }, me);
  return me;
}
const notes = async (u) => (await call('/notifications', 'GET', null, u)).body.notifications.map((n) => n.type);
// a paid, confirmed booking with a paid payment, set up directly in the DB (the payment flow itself is covered in payments.test.js)
async function paidBooking(mentor, learner, extraHours = 0) {
  const sid = (await call('/sessions', 'POST', { title: 'Admin test class', skillId: GUITAR, startsAt: new Date(Date.now() + (72 + extraHours) * 3600e3).toISOString(), durationMin: 60, capacity: 2, pricing: 'paid', pricePaise: 50000, autoAccept: true }, mentor)).body.id;
  await call(`/sessions/${sid}/book`, 'POST', {}, learner);
  const [[b]] = await pool.query('SELECT id FROM bookings WHERE session_id = ? AND learner_id = ?', [sid, learner.id]);
  await pool.query("UPDATE bookings SET status = 'confirmed' WHERE id = ?", [b.id]);
  const [r] = await pool.query("INSERT INTO payments (booking_id, learner_id, mentor_id, amount_paise, commission_percent, platform_fee_paise, mentor_net_paise, status, gateway_order_id, gateway_payment_id, method, paid_at) VALUES (?,?,?,50000,10,5000,45000,'paid',?,?, 'upi', UTC_TIMESTAMP())", [b.id, learner.id, mentor.id, `order_a${run}${b.id}`, `pay_a${run}${b.id}`]);
  return { sid, bookingId: b.id, paymentId: r.insertId };
}
test.before(async () => { GUITAR = (await pool.query("SELECT id FROM skills WHERE name = 'Guitar'"))[0][0].id; });
test.after(async () => {
  srv.close(); gw.setTransport(null);
  for (const id of created.skills) await pool.query('DELETE FROM skills WHERE id = ?', [id]).catch(() => {}); for (const id of created.cats) await pool.query('DELETE FROM categories WHERE id = ?', [id]).catch(() => {});
  const [ids] = await pool.query('SELECT id FROM users WHERE email LIKE ?', [`%-${run}@test.local`]);
  if (ids.length) { const u = ids.map((r) => r.id); // financial + audit rows are RESTRICTed on purpose, so clean children first
    await pool.query('DELETE FROM disputes WHERE opened_by IN (?)', [u]); await pool.query('DELETE FROM refunds WHERE payment_id IN (SELECT id FROM payments WHERE learner_id IN (?) OR mentor_id IN (?))', [u, u]);
    await pool.query('DELETE FROM payments WHERE learner_id IN (?) OR mentor_id IN (?)', [u, u]); await pool.query('DELETE FROM payouts WHERE mentor_id IN (?)', [u]); await pool.query('DELETE FROM admin_actions WHERE admin_id IN (?)', [u]);
    await pool.query('DELETE FROM users WHERE id IN (?)', [u]); }
  await pool.end();
});

test('every admin route is closed to logged-out and non-admin users', async () => {
  const user = await makeUser('u0');
  for (const [m, p] of [['GET', '/admin/overview'], ['GET', '/admin/users'], ['PATCH', '/admin/users/1'], ['GET', '/admin/reports'], ['GET', '/admin/payments'], ['POST', '/admin/payments/1/refund'], ['GET', '/admin/disputes'],
    ['GET', '/admin/payouts'], ['POST', '/admin/payouts/1/pay'], ['GET', '/admin/settings'], ['PUT', '/admin/settings'], ['GET', '/admin/catalog'], ['POST', '/admin/skills'], ['DELETE', '/admin/skills/1'], ['GET', '/admin/audit'], ['GET', '/admin/analytics']]) {
    assert.equal((await call(p, m, {})).status, 401, `${m} ${p} logged out`);
    assert.equal((await call(p, m, {}, user)).status, 403, `${m} ${p} as user`);
  }
});

test('overview + analytics for an admin; user moderation takes effect immediately and is audited', async () => {
  const [admin, other, victim, boss] = await Promise.all([makeUser('a1', { admin: true }), makeUser('o1'), makeUser('v1'), makeUser('a2', { admin: true })]);
  const ov = (await call('/admin/overview', 'GET', null, admin)).body; assert.ok(ov.users >= 4 && typeof ov.grossPaise === 'number');
  assert.ok(Array.isArray((await call('/admin/analytics', 'GET', null, admin)).body.signups));
  assert.ok((await call(`/admin/users?q=${victim.username}`, 'GET', null, admin)).body.users.some((u) => u.username === victim.username));
  assert.equal((await call('/auth/me', 'GET', null, victim)).status, 200);
  assert.equal((await call(`/admin/users/${victim.id}`, 'PATCH', { status: 'suspended', note: 'spam' }, admin)).status, 200);
  assert.equal((await call('/auth/me', 'GET', null, victim)).status, 401); // logged out on the spot
  assert.equal((await call('/auth/login', 'POST', { identifier: victim.email, password: victim.password })).body.error, 'account_inactive');
  assert.equal((await call(`/admin/users/${victim.id}`, 'PATCH', { status: 'active' }, admin)).status, 200);
  assert.equal((await call('/auth/login', 'POST', { identifier: victim.email, password: victim.password })).status, 200);
  assert.equal((await call(`/admin/users/${admin.id}`, 'PATCH', { status: 'suspended' }, admin)).body.error, 'cannot_modify_self');
  assert.equal((await call(`/admin/users/${boss.id}`, 'PATCH', { status: 'suspended' }, admin)).body.error, 'cannot_modify_admin');
  assert.equal((await call(`/admin/users/${victim.id}`, 'PATCH', { status: 'banned' }, admin)).status, 400);
  assert.equal((await call('/admin/users/abc', 'PATCH', { status: 'active' }, admin)).status, 404);
  assert.ok((await call('/admin/audit', 'GET', null, admin)).body.actions.some((a) => a.action === 'user_suspended' && a.targetId === victim.id && a.admin === admin.username));
});

test('reports on people and on sessions: review, dismiss, resolve + suspend', async () => {
  const [admin, mentor, rep] = await Promise.all([makeUser('a3', { admin: true }), makeUser('m3', { mentor: true }), makeUser('r3')]);
  const sid = (await call('/sessions', 'POST', { title: 'Questionable class', skillId: GUITAR, startsAt: new Date(Date.now() + 48 * 3600e3).toISOString(), durationMin: 60, capacity: 1, pricing: 'free' }, mentor)).body.id;
  assert.equal((await call(`/sessions/${sid}/report`, 'POST', { reason: 'scam', details: 'asks for money off-platform' }, rep)).status, 201);
  assert.equal((await call(`/sessions/${sid}/report`, 'POST', { reason: 'scam' }, rep)).status, 409);
  assert.equal((await call(`/sessions/${sid}/report`, 'POST', { reason: 'scam' }, mentor)).status, 404); // not your own
  const list = (await call('/admin/reports', 'GET', null, admin)).body.reports; const mine = list.find((r) => r.session?.id === sid);
  assert.ok(mine && mine.reporter.username === rep.username && mine.target.username === mentor.username);
  assert.equal((await call(`/admin/reports/${mine.id}/resolve`, 'POST', { outcome: 'dismissed', note: 'not enough' }, rep)).status, 403);
  assert.equal((await call(`/admin/reports/${mine.id}/resolve`, 'POST', { outcome: 'resolved', note: 'confirmed', suspendTarget: true }, admin)).status, 200);
  assert.equal((await call('/auth/me', 'GET', null, mentor)).status, 401); // the reported mentor is suspended
  assert.equal((await call(`/admin/reports/${mine.id}/resolve`, 'POST', { outcome: 'resolved' }, admin)).status, 404); // already handled
  await call('/reports', 'POST', { username: rep.username, reason: 'spam' }, mentor).catch(() => {});
  assert.ok(!(await call('/admin/reports', 'GET', null, admin)).body.reports.some((r) => r.id === mine.id));
});

test('refunds, learner disputes, and the transaction list', async () => {
  const [admin, mentor, learner, stranger] = await Promise.all([makeUser('a4', { admin: true }), makeUser('m4', { mentor: true }), makeUser('l4'), makeUser('s4')]);
  const a = await paidBooking(mentor, learner), b = await paidBooking(mentor, learner, 5); // different time slots: a mentor can't double-book
  assert.ok((await call('/admin/payments?status=paid', 'GET', null, admin)).body.payments.some((p) => p.id === a.paymentId));
  // disputes: only the payer, only paid payments, one open at a time
  assert.equal((await call(`/payments/${a.paymentId}/dispute`, 'POST', { reason: 'The mentor never showed up.' }, stranger)).status, 404);
  assert.equal((await call(`/payments/${a.paymentId}/dispute`, 'POST', { reason: 'short' }, learner)).status, 400);
  assert.equal((await call(`/payments/${a.paymentId}/dispute`, 'POST', { reason: 'The mentor never showed up.' }, learner)).status, 201);
  assert.equal((await call(`/payments/${a.paymentId}/dispute`, 'POST', { reason: 'The mentor never showed up.' }, learner)).body.error, 'already_disputed');
  assert.equal((await call(`/payments/${b.paymentId}/dispute`, 'POST', { reason: 'Quality was far below the description.' }, learner)).status, 201);
  const ds = (await call('/admin/disputes', 'GET', null, admin)).body.disputes; const da = ds.find((d) => d.paymentId === a.paymentId), db = ds.find((d) => d.paymentId === b.paymentId);
  assert.equal((await call(`/admin/disputes/${da.id}/resolve`, 'POST', { outcome: 'refund', note: 'No show confirmed' }, learner)).status, 403);
  assert.equal((await call(`/admin/disputes/${da.id}/resolve`, 'POST', { outcome: 'refund', note: 'No show confirmed' }, admin)).status, 200);
  assert.equal((await pool.query('SELECT status FROM payments WHERE id = ?', [a.paymentId]))[0][0].status, 'refunded');
  assert.ok(refunds.some((r) => r.amount === 50000)); assert.ok((await notes(learner)).includes('dispute_resolved'));
  assert.equal((await call(`/admin/disputes/${da.id}/resolve`, 'POST', { outcome: 'reject', note: 'again' }, admin)).status, 404); // can't resolve twice
  assert.equal((await call(`/admin/disputes/${db.id}/resolve`, 'POST', { outcome: 'reject', note: 'Class matched its description' }, admin)).status, 200);
  assert.equal((await pool.query('SELECT status FROM payments WHERE id = ?', [b.paymentId]))[0][0].status, 'paid'); // rejected: money stays
  // direct admin refunds: partial, then the rest; never more than was paid
  assert.equal((await call(`/admin/payments/${b.paymentId}/refund`, 'POST', { reason: 'goodwill', amountPaise: 10000 }, admin)).status, 200);
  assert.equal((await call(`/admin/payments/${b.paymentId}/refund`, 'POST', { reason: 'too much', amountPaise: 45000 }, admin)).body.error, 'nothing_to_refund');
  assert.equal((await call(`/admin/payments/${b.paymentId}/refund`, 'POST', { reason: 'rest' }, admin)).status, 200);
  assert.equal((await pool.query('SELECT status FROM payments WHERE id = ?', [b.paymentId]))[0][0].status, 'refunded');
  assert.equal((await call(`/admin/payments/${b.paymentId}/refund`, 'POST', { reason: 'again' }, admin)).body.error, 'nothing_to_refund');
  assert.ok((await call('/admin/audit', 'GET', null, admin)).body.actions.some((x) => x.action === 'refund' && x.targetId === b.paymentId));
});

test('payouts: pay once, reject once, mentor is told', async () => {
  const [admin, mentor] = await Promise.all([makeUser('a5', { admin: true }), makeUser('m5', { mentor: true })]);
  const ins = async (amt) => (await pool.query("INSERT INTO payouts (mentor_id, amount_paise, destination) VALUES (?,?, 'm@upi')", [mentor.id, amt]))[0].insertId;
  const p1 = await ins(20000), p2 = await ins(30000);
  assert.ok((await call('/admin/payouts', 'GET', null, admin)).body.payouts.some((p) => p.id === p1 && p.mentor.username === mentor.username));
  assert.equal((await call(`/admin/payouts/${p1}/pay`, 'POST', { note: 'UTR 123' }, mentor)).status, 403);
  assert.equal((await call(`/admin/payouts/${p1}/pay`, 'POST', { note: 'UTR 123' }, admin)).status, 200);
  assert.equal((await call(`/admin/payouts/${p1}/pay`, 'POST', {}, admin)).body.error, 'not_pending');
  assert.equal((await call(`/admin/payouts/${p1}/reject`, 'POST', {}, admin)).body.error, 'not_pending'); // a paid payout can't be rejected
  assert.equal((await call(`/admin/payouts/${p2}/reject`, 'POST', { note: 'bank details look wrong' }, admin)).status, 200);
  const t = await notes(mentor); assert.ok(t.includes('payout_paid') && t.includes('payout_rejected'));
  const e = (await call('/earnings', 'GET', null, mentor)).body; assert.deepEqual(e.payouts.map((x) => x.status).sort(), ['paid', 'rejected']);
});

test('settings are validated; catalog management protects data in use', async () => {
  const admin = await makeUser('a6', { admin: true });
  const cur = (await call('/admin/settings', 'GET', null, admin)).body;
  assert.equal((await call('/admin/settings', 'PUT', { commission_percent: 90 }, admin)).status, 400);
  assert.equal((await call('/admin/settings', 'PUT', { refund_window_hours: -1 }, admin)).status, 400);
  assert.equal((await call('/admin/settings', 'PUT', { surprise: 1 }, admin)).status, 400); // unknown keys are refused
  assert.equal((await call('/admin/settings', 'PUT', { ranking_weights: { ...cur.defaults, skill: 0, level: 0, price: 0, availability: 0, language: 0, style: 0, rating: 0, completeness: 0 } }, admin)).status, 400);
  assert.equal((await call('/admin/settings', 'PUT', { commission_percent: cur.commission_percent, ranking_weights: cur.ranking_weights }, admin)).status, 200); // same values: proves the write path without disturbing parallel tests
  // catalog
  const cname = `Cat ${run}`, sname = `Skill ${run}`;
  const c = await call('/admin/categories', 'POST', { name: cname }, admin); assert.equal(c.status, 201); created.cats.push(c.body.id);
  assert.equal((await call('/admin/categories', 'POST', { name: cname }, admin)).body.error, 'name_taken');
  const s = await call('/admin/skills', 'POST', { name: sname, categoryId: c.body.id }, admin); assert.equal(s.status, 201); created.skills.push(s.body.id);
  assert.equal((await call('/admin/skills', 'POST', { name: sname, categoryId: c.body.id }, admin)).body.error, 'name_taken');
  assert.equal((await call('/admin/skills', 'POST', { name: 'X Y', categoryId: 99999999 }, admin)).body.error, 'unknown_category');
  assert.ok((await call('/skills')).body.skills.some((x) => x.name === sname)); // visible to everyone straight away
  assert.equal((await call(`/admin/skills/${s.body.id}`, 'PATCH', { name: `${sname} 2` }, admin)).status, 200);
  assert.equal((await call(`/admin/categories/${c.body.id}`, 'DELETE', null, admin)).body.error, 'category_not_empty');
  assert.equal((await call(`/admin/skills/${GUITAR}`, 'DELETE', null, admin)).body.error, 'skill_in_use'); // people teach it: never orphaned
  assert.equal((await call(`/admin/skills/${s.body.id}`, 'DELETE', null, admin)).status, 200);
  assert.equal((await call(`/admin/categories/${c.body.id}`, 'DELETE', null, admin)).status, 200);
  assert.ok((await call('/admin/catalog', 'GET', null, admin)).body.categories.length > 0);
});
