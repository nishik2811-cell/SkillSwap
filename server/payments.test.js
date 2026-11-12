import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './src/app.js';
import { pool } from './src/db.js';
import { sent } from './src/auth/mail.js';
import * as gw from './src/payments/razorpay.js';
import { expireUnpaidBookings, retryFailedRefunds } from './src/payments/service.js';

// These tests inject their own fake gateway and keys. Never let a developer's real .env keys leak in (or let this suite reach the real gateway).
for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) delete process.env[k];

const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}/api/v1`;
const KEY = 'secret_test_key', WH = 'whsec_test';
let GUITAR;

// ---- a fake Razorpay: only the HTTP side is faked, the signature maths is the real thing ----
const G = { orders: new Map(), payments: new Map(), refunds: [], refundMode: 'processed', n: 0 };
gw.setTransport(async ({ method, url, body }) => {
  const path = url.replace('https://api.razorpay.com/v1', '');
  if (method === 'POST' && path === '/orders') { const o = { id: `order_${run}${++G.n}`, amount: body.amount, currency: body.currency, status: 'created' }; G.orders.set(o.id, o); return { status: 200, json: o }; }
  let m;
  if (method === 'GET' && (m = path.match(/^\/orders\/(.+)$/))) { const o = G.orders.get(m[1]); return o ? { status: 200, json: o } : { status: 400, json: { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } } }; }
  if (method === 'GET' && (m = path.match(/^\/payments\/(.+)\/refunds/))) return { status: 200, json: { items: G.refunds.filter((r) => r.payment_id === m[1]) } };
  if (method === 'GET' && (m = path.match(/^\/payments\/(.+)$/))) { const p = G.payments.get(m[1]); return p ? { status: 200, json: p } : { status: 404, json: { error: { description: 'not found' } } }; }
  if (method === 'POST' && (m = path.match(/^\/payments\/(.+)\/capture$/))) { const p = G.payments.get(m[1]); p.status = 'captured'; return { status: 200, json: p }; }
  if (method === 'POST' && (m = path.match(/^\/payments\/(.+)\/refund$/))) {
    if (G.refundMode === 'down') return { status: 500, json: { error: { description: 'gateway down' } } };
    const r = { id: `rfnd_${run}${++G.n}`, payment_id: m[1], amount: body.amount, status: G.refundMode === 'lose' ? 'processed' : G.refundMode, notes: body.notes }; G.refunds.push(r);
    if (G.refundMode === 'lose') throw new Error('socket hang up'); // gateway accepted it, we never saw the reply
    return { status: 200, json: r };
  }
  return { status: 404, json: {} };
});
const customerPays = (orderId, { amount, status = 'captured' } = {}) => {
  const o = G.orders.get(orderId), id = `pay_${run}${++G.n}`;
  G.payments.set(id, { id, order_id: orderId, amount: amount ?? o.amount, currency: 'INR', status, method: 'upi', error_description: status === 'failed' ? 'bank declined' : undefined });
  return { razorpay_order_id: orderId, razorpay_payment_id: id, razorpay_signature: gw._sign.checkout(orderId, id, KEY) }; // what Checkout hands the browser
};

const call = async (path, method = 'GET', body, who, raw) => {
  const r = await fetch(base + path, { method, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(who && { cookie: who.cookie }), ...(raw?.headers) }, body: raw ? raw.body : body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const webhook = (event, entity, { sign = true, id = `evt_${run}${++G.n}` } = {}) => {
  const body = JSON.stringify({ event, payload: entity.refund_id ? { refund: { entity: entity.refund_id } } : { payment: { entity } } });
  return call('/webhooks/razorpay', 'POST', null, null, { body, headers: { 'content-type': 'application/json', 'x-razorpay-event-id': id, 'x-razorpay-signature': sign ? gw._sign.webhook(body, WH) : 'deadbeef'.repeat(8) } });
};
async function makeUser(n, mentors = false) {
  const u = { email: `${n}-${run}@test.local`, username: `y${n}${run}`.slice(0, 20), password: 'correct horse 1', fullName: `Pay ${n}` };
  await call('/auth/register', 'POST', u);
  await call('/auth/verify-email', 'POST', { token: sent.filter((m) => m.to === u.email).at(-1).text.match(/token=(\S+)/)[1] });
  const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: u.password }) });
  const me = { ...u, cookie: r.headers.getSetCookie()[0].split(';')[0] };
  if (mentors) await call('/me/preferences', 'PUT', { mentorSkills: [{ skillId: GUITAR, level: 'expert', pricing: 'both', priceMinPaise: 20000, priceMaxPaise: 80000 }], learnerSkills: [], availability: [], languages: [], finishOnboarding: true }, me);
  return me;
}
const hrs = (h) => new Date(Date.now() + h * 3600_000).toISOString();
// a paid, instant-booking session at ₹500 with the learner already at awaiting_payment
async function setup(n, { hours = 48, learners = 1 } = {}) {
  const mentor = await makeUser(`m${n}`, true), ls = [];
  const sid = (await call('/sessions', 'POST', { title: `Paid ${n}`, skillId: GUITAR, startsAt: hrs(hours), durationMin: 60, capacity: 3, pricing: 'paid', pricePaise: 50000, autoAccept: true }, mentor)).body.id;
  for (let i = 0; i < learners; i++) { const l = await makeUser(`l${n}${i}`); assert.equal((await call(`/sessions/${sid}/book`, 'POST', {}, l)).body.status, 'awaiting_payment'); ls.push(l); }
  const bid = async (l) => (await call(`/sessions/${sid}`, 'GET', null, l)).body.myBooking.id;
  const bstatus = async (l) => (await call(`/sessions/${sid}`, 'GET', null, l)).body.myBooking.status;
  return { mentor, learner: ls[0], ls, sid, bid, bstatus };
}
const startPay = async (l, bookingId) => (await call(`/bookings/${bookingId}/pay`, 'POST', {}, l));
const row = async (sql, a) => (await pool.query(sql, a))[0][0];
const notes = async (u) => (await call('/notifications', 'GET', null, u)).body.notifications.map((n) => n.type);

test.before(async () => { GUITAR = (await pool.query("SELECT id FROM skills WHERE name = 'Guitar'"))[0][0].id; });
test.after(async () => { srv.close(); gw.setTransport(null); const [ids] = await pool.query('SELECT id FROM users WHERE email LIKE ?', [`%-${run}@test.local`]); if (ids.length) { const u = ids.map((r) => r.id); await pool.query('DELETE FROM refunds WHERE payment_id IN (SELECT id FROM payments WHERE learner_id IN (?) OR mentor_id IN (?))', [u, u]); await pool.query('DELETE FROM payments WHERE learner_id IN (?) OR mentor_id IN (?)', [u, u]); await pool.query('DELETE FROM payouts WHERE mentor_id IN (?)', [u]); await pool.query('DELETE FROM users WHERE id IN (?)', [u]); } await pool.end(); });

test('without credentials everything fails loudly; nothing is faked', async () => {
  assert.equal(gw.configured(), false);
  const { learner, bid } = await setup('a');
  const cfg = await call('/payments/config', 'GET', null, learner); assert.equal(cfg.body.enabled, false);
  const r = await startPay(learner, await bid(learner));
  assert.equal(r.status, 503); assert.equal(r.body.error, 'payments_not_configured');
  assert.equal((await webhook('payment.captured', { id: 'x' })).status, 503);
  process.env.RAZORPAY_KEY_ID = 'rzp_test_abc'; process.env.RAZORPAY_KEY_SECRET = KEY; process.env.RAZORPAY_WEBHOOK_SECRET = WH; // from here on: configured
});

test('happy path: amount from the DB, tamper-proof, verified with the gateway, confirmed once', async () => {
  const { mentor, learner, sid, bid, bstatus } = await setup('b'); const other = await makeUser('lbx');
  const b = await bid(learner);
  assert.equal((await startPay(other, b)).status, 404); assert.equal((await startPay(mentor, b)).status, 404); // only the booking's learner
  const o = await call(`/bookings/${b}/pay`, 'POST', { amountPaise: 1, amount: 1 }, learner); // a client-supplied amount is simply ignored
  assert.equal(o.status, 200); assert.equal(o.body.amountPaise, 55900); /* ₹500 price + ₹50 fee + ₹9 GST */ assert.deepEqual([o.body.pricePaise, o.body.feePaise, o.body.gstPaise], [50000, 5000, 900]); assert.equal(o.body.keyId, 'rzp_test_abc'); assert.equal(G.orders.get(o.body.orderId).amount, 55900);
  assert.equal((await startPay(learner, b)).body.orderId, o.body.orderId); // resuming reuses the order
  G.orders.delete(o.body.orderId); // the keys changed (another Razorpay account): that order no longer exists there
  const fresh = (await startPay(learner, b)).body; assert.notEqual(fresh.orderId, o.body.orderId); assert.ok(G.orders.has(fresh.orderId));
  o.body = fresh; // the rest of this test pays the fresh order
  const proof = customerPays(o.body.orderId);
  assert.equal((await call('/payments/verify', 'POST', { ...proof, razorpay_signature: 'f'.repeat(64) }, learner)).body.error, 'invalid_signature');
  assert.equal(await bstatus(learner), 'awaiting_payment'); // a forged callback grants nothing
  assert.equal((await call('/payments/verify', 'POST', proof, other)).status, 404); // someone else's order
  const ok = await call('/payments/verify', 'POST', proof, learner);
  assert.equal(ok.status, 200); assert.equal(ok.body.confirmed, true);
  assert.equal(await bstatus(learner), 'confirmed');
  const p = await row('SELECT * FROM payments WHERE gateway_order_id = ?', [o.body.orderId]);
  assert.deepEqual([p.status, p.amount_paise, p.platform_fee_paise, p.gst_paise, p.mentor_net_paise, Number(p.commission_percent)], ['paid', 55900, 5000, 900, 50000, 10]); // the mentor keeps the whole price
  assert.ok((await notes(learner)).includes('payment_success')); assert.ok((await notes(mentor)).includes('booking_confirmed'));
  assert.equal((await call('/payments/verify', 'POST', proof, learner)).body.already, true); // idempotent
  const dup = await webhook('payment.captured', G.payments.get(proof.razorpay_payment_id), { id: 'evt_same' });
  const dup2 = await webhook('payment.captured', G.payments.get(proof.razorpay_payment_id), { id: 'evt_same' });
  assert.equal(dup.status, 200); assert.equal(dup2.body.duplicate, true);
  const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM payments WHERE booking_id = ? AND status = 'paid'", [b]); assert.equal(n, 1);
  // DB-level guard: even a buggy code path cannot mark a second payment paid for the same booking
  await assert.rejects(pool.query("INSERT INTO payments (booking_id, learner_id, mentor_id, amount_paise, commission_percent, platform_fee_paise, gst_paise, mentor_net_paise, status, gateway_order_id) SELECT booking_id, learner_id, mentor_id, amount_paise, 10, platform_fee_paise, gst_paise, mentor_net_paise, 'paid', 'order_dup' FROM payments WHERE id = ?", [p.id]), /Duplicate/);
  // history + receipts: the learner sees price + fee + GST; the mentor sees only what they receive; outsiders see nothing
  const hist = (await call('/payments', 'GET', null, learner)).body.payments; assert.equal(hist[0].receiptNo.startsWith('SS-'), true);
  assert.deepEqual([hist[0].pricePaise, hist[0].platformFeePaise, hist[0].gstPaise, hist[0].mentorNetPaise], [50000, 5000, 900, undefined]);
  const asMentor = (await call(`/payments/${p.id}`, 'GET', null, mentor)).body; assert.deepEqual([asMentor.mentorNetPaise, asMentor.platformFeePaise, asMentor.gstPaise], [50000, undefined, undefined]);
  assert.equal((await call(`/payments/${p.id}`, 'GET', null, other)).status, 404);
  assert.equal((await call('/payments/abc', 'GET', null, learner)).status, 404);
});

test('gateway truth wins: wrong amount, unpaid, authorized->captured, failed then retried', async () => {
  const { learner, bid, bstatus } = await setup('c'); const b = await bid(learner);
  const o = (await startPay(learner, b)).body;
  assert.equal((await call('/payments/verify', 'POST', customerPays(o.orderId, { amount: 100 }), learner)).body.error, 'amount_mismatch'); // paid ₹1 for a ₹500 seat
  assert.equal(await bstatus(learner), 'awaiting_payment');
  assert.equal((await row('SELECT status, failure_reason FROM payments WHERE gateway_order_id = ?', [o.orderId])).failure_reason, 'amount_mismatch');
  const o2 = (await startPay(learner, b)).body; assert.equal(o2.orderId, o.orderId); // same order is reused for a retry
  // a recorded gateway status of 'created' is not money
  const p1 = customerPays(o2.orderId, { status: 'created' });
  assert.equal((await call('/payments/verify', 'POST', p1, learner)).body.error, 'payment_pending');
  const p2 = customerPays(o2.orderId, { status: 'failed' });
  assert.equal((await call('/payments/verify', 'POST', p2, learner)).body.error, 'payment_failed');
  assert.equal(await bstatus(learner), 'awaiting_payment');
  const p3 = customerPays(o2.orderId, { status: 'authorized' }); // gets captured by us, then confirmed
  assert.equal((await call('/payments/verify', 'POST', p3, learner)).status, 200);
  assert.equal(await bstatus(learner), 'confirmed');
});

test('webhooks: forged signature rejected; webhook alone confirms; failed event notifies; verify+webhook race confirms once', async () => {
  const s = await setup('d'); const b = await s.bid(s.learner); const o = (await startPay(s.learner, b)).body;
  const fake = { id: `pay_${run}w1`, order_id: o.orderId, amount: 55900, currency: 'INR', status: 'captured', method: 'card' };
  assert.equal((await webhook('payment.captured', fake, { sign: false })).body.error, 'invalid_signature');
  assert.equal(await s.bstatus(s.learner), 'awaiting_payment');
  const failed = { ...fake, id: `pay_${run}w0`, status: 'failed', error_description: 'insufficient funds' };
  assert.equal((await webhook('payment.failed', failed)).status, 200);
  assert.ok((await notes(s.learner)).includes('payment_failed')); assert.equal((await row('SELECT status FROM payments WHERE gateway_order_id = ?', [o.orderId])).status, 'failed');
  // the customer retries on the same order, and the browser callback and the webhook arrive together
  G.payments.set(fake.id, fake);
  const proof = { razorpay_order_id: o.orderId, razorpay_payment_id: fake.id, razorpay_signature: gw._sign.checkout(o.orderId, fake.id, KEY) };
  const rs = await Promise.all([call('/payments/verify', 'POST', proof, s.learner), webhook('payment.captured', fake), webhook('order.paid', fake), call('/payments/verify', 'POST', proof, s.learner)]);
  assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.body)));
  assert.equal(await s.bstatus(s.learner), 'confirmed');
  assert.equal((await notes(s.learner)).filter((t) => t === 'payment_success').length, 1); // one confirmation, not four
  assert.equal((await row("SELECT COUNT(*) n FROM payments WHERE booking_id = ? AND status = 'paid'", [b])).n, 1);
  assert.equal((await webhook('payment.captured', { id: 'pay_unknown', order_id: 'order_unknown', amount: 1, currency: 'INR' })).status, 200); // unknown orders are ignored, not errors
});

test('refund policy: learner cancel inside/outside window, mentor cancel, mentor removal', async () => {
  const pay = async (l, s) => { const o = (await startPay(l, await s.bid(l))).body; assert.equal((await call('/payments/verify', 'POST', customerPays(o.orderId), l)).status, 200); return o; };
  // >24h ahead: full refund
  let s = await setup('e'); await pay(s.learner, s);
  let c = await call(`/bookings/${await s.bid(s.learner)}/cancel`, 'POST', {}, s.learner);
  assert.equal(c.body.refund.refunded, true);
  let p = await row("SELECT p.* FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.session_id = ?", [s.sid]);
  assert.equal(p.status, 'refunded'); assert.equal((await row('SELECT amount_paise, status FROM refunds WHERE payment_id = ?', [p.id])).amount_paise, 55900); // fee and GST come back too
  assert.ok(G.refunds.some((r) => r.payment_id === p.gateway_payment_id && r.amount === 55900));
  assert.ok((await notes(s.learner)).includes('refund_processed'));
  // 46 minutes ahead: still inside the 45-minute window, full refund
  s = await setup('f2', { hours: 48 }); await pay(s.learner, s);
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 46 MINUTE) WHERE id = ?', [s.sid]);
  assert.equal((await call(`/bookings/${await s.bid(s.learner)}/cancel`, 'POST', {}, s.learner)).body.refund.refunded, true);
  // 44 minutes ahead: too late, no refund (policy), money stays with the mentor side
  s = await setup('f', { hours: 48 }); await pay(s.learner, s);
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 44 MINUTE) WHERE id = ?', [s.sid]);
  c = await call(`/bookings/${await s.bid(s.learner)}/cancel`, 'POST', {}, s.learner);
  assert.equal(c.body.refund.refunded, false);
  assert.equal((await row("SELECT p.status FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.session_id = ?", [s.sid])).status, 'paid');
  // mentor cancels the session: every paid learner is refunded in full, whatever the timing
  s = await setup('g', { learners: 2 }); for (const l of s.ls) await pay(l, s);
  assert.equal((await call(`/sessions/${s.sid}/cancel`, 'POST', { reason: 'ill' }, s.mentor)).status, 200);
  const prs = (await pool.query("SELECT p.status FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.session_id = ?", [s.sid]))[0]; assert.deepEqual(prs.map((x) => x.status), ['refunded', 'refunded']);
  // mentor removes one learner
  s = await setup('h', { learners: 2 }); for (const l of s.ls) await pay(l, s);
  await call(`/bookings/${await s.bid(s.ls[1])}/cancel`, 'POST', {}, s.mentor);
  assert.deepEqual((await pool.query("SELECT p.status FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.session_id = ? ORDER BY p.id", [s.sid]))[0].map((x) => x.status), ['paid', 'refunded']);
});

test('refund failures are never lost; pending refunds finish via webhook; double refunds are impossible', async () => {
  const s = await setup('i'); const o = (await startPay(s.learner, await s.bid(s.learner))).body;
  await call('/payments/verify', 'POST', customerPays(o.orderId), s.learner);
  const pid = (await row('SELECT id, gateway_payment_id FROM payments WHERE gateway_order_id = ?', [o.orderId]));
  G.refundMode = 'down';
  await call(`/bookings/${await s.bid(s.learner)}/cancel`, 'POST', {}, s.mentor); // mentor removal => refund attempt while the gateway is down
  assert.equal((await row('SELECT status, failure_reason FROM refunds WHERE payment_id = ?', [pid.id])).status, 'failed');
  assert.equal((await row('SELECT status FROM payments WHERE id = ?', [pid.id])).status, 'paid'); // not marked refunded: the money has not moved
  assert.equal((await row("SELECT COUNT(*) n FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.id = ? AND b.status = 'cancelled'", [pid.id])).n, 1); // but the booking cancellation still went through
  G.refundMode = 'pending'; await retryFailedRefunds();
  assert.equal((await row('SELECT status FROM refunds WHERE payment_id = ?', [pid.id])).status, 'pending');
  assert.equal((await row('SELECT status FROM payments WHERE id = ?', [pid.id])).status, 'refunded');
  const rf = await row('SELECT gateway_refund_id FROM refunds WHERE payment_id = ?', [pid.id]);
  assert.equal((await webhook('refund.processed', { refund_id: { id: rf.gateway_refund_id, payment_id: pid.gateway_payment_id, amount: 55900, status: 'processed' } })).status, 200);
  assert.equal((await row('SELECT status FROM refunds WHERE payment_id = ?', [pid.id])).status, 'processed');
  const before = G.refunds.length; await retryFailedRefunds(); assert.equal(G.refunds.length, before); // nothing is refunded twice
  G.refundMode = 'processed';
});

test('late payment for a seat that is gone is refunded automatically; unpaid seats expire', async () => {
  const s = await setup('j'); const b = await s.bid(s.learner); const o = (await startPay(s.learner, b)).body;
  await call(`/bookings/${b}/cancel`, 'POST', {}, s.learner); // cancels while the payment window is still open
  const proof = customerPays(o.orderId);
  const r = await call('/payments/verify', 'POST', proof, s.learner);
  assert.equal(r.status, 200); assert.equal(r.body.refunded, true);
  assert.equal(await s.bstatus(s.learner), 'cancelled'); // payment does NOT resurrect the booking
  assert.equal((await row('SELECT status FROM payments WHERE gateway_order_id = ?', [o.orderId])).status, 'refunded');
  // expiry
  const t = await setup('k'); const tb = await t.bid(t.learner);
  await pool.query('UPDATE bookings SET updated_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 HOUR) WHERE id = ?', [tb]);
  assert.ok((await expireUnpaidBookings()) >= 1);
  assert.equal(await t.bstatus(t.learner), 'cancelled'); assert.ok((await notes(t.learner)).includes('booking_expired'));
});

test('earnings: pending until the session is held; payouts bounded by balance, even under concurrency', async () => {
  const s = await setup('m'); const o = (await startPay(s.learner, await s.bid(s.learner))).body;
  await call('/payments/verify', 'POST', customerPays(o.orderId), s.learner);
  let e = (await call('/earnings', 'GET', null, s.mentor)).body.summary;
  assert.deepEqual([e.netPaise, e.pendingPaise, e.availablePaise, e.balancePaise], [50000, 50000, 0, 0]);
  assert.equal((await call('/payouts', 'POST', { amountPaise: 20000, destination: 'me@upi' }, s.mentor)).body.error, 'insufficient_balance'); // session not held yet
  assert.equal((await call('/earnings', 'GET', null, s.learner)).body.summary.netPaise, 0); // learners earn nothing here
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR) WHERE id = ?', [s.sid]);
  assert.equal((await call(`/sessions/${s.sid}/complete`, 'POST', {}, s.mentor)).status, 200);
  e = (await call('/earnings', 'GET', null, s.mentor)).body.summary; assert.deepEqual([e.availablePaise, e.pendingPaise, e.balancePaise], [50000, 0, 50000]);
  assert.equal((await call('/payouts', 'POST', { amountPaise: 60000, destination: 'me@upi' }, s.mentor)).body.error, 'insufficient_balance'); // no minimum any more, only the balance limits it
  assert.equal((await call('/payouts', 'POST', { amountPaise: 20000, destination: 'x' }, s.mentor)).status, 400);
  const rs = await Promise.all([1, 2, 3].map(() => call('/payouts', 'POST', { amountPaise: 30000, destination: 'me@upi' }, s.mentor)));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409]); // a 50000 balance cannot fund three 30000 requests
  e = (await call('/earnings', 'GET', null, s.mentor)).body; assert.equal(e.summary.balancePaise, 20000); assert.equal(e.summary.requestedPaise, 30000);
  assert.equal(e.payouts.length, 1); assert.deepEqual([e.sales[0].mentorNetPaise, e.sales[0].platformFeePaise], [50000, undefined]);
});

test('money-safety regressions: concurrent Pay clicks, partial-refund retry amount, lost refund reply', async () => {
  const s = await setup('r');
  const b = await s.bid(s.learner);
  const rs = await Promise.all([1, 2, 3, 4].map(() => startPay(s.learner, b)));
  assert.equal(new Set(rs.map((r) => r.body.orderId)).size, 1); // four simultaneous clicks, one order
  assert.equal((await row("SELECT COUNT(*) n FROM payments WHERE booking_id = ?", [b])).n, 1);
  const o = rs[0].body; await call('/payments/verify', 'POST', customerPays(o.orderId), s.learner);
  const pay = await row('SELECT id, gateway_payment_id FROM payments WHERE gateway_order_id = ?', [o.orderId]);
  const { refund, retryFailedRefunds: retry } = await import('./src/payments/service.js').then((m) => ({ refund: m.refund, retryFailedRefunds: m.retryFailedRefunds }));
  // a PARTIAL refund that fails and is retried must refund the partial amount, not the whole payment
  G.refundMode = 'down'; await refund(pay.id, { reason: 'goodwill', initiatedBy: 'admin', amountPaise: 10000 });
  G.refundMode = 'processed'; const before = G.refunds.length; await retry();
  assert.equal(G.refunds.at(-1).amount, 10000); assert.equal(G.refunds.length, before + 1);
  assert.equal((await row('SELECT status FROM payments WHERE id = ?', [pay.id])).status, 'paid'); // still only partly refunded
  // gateway accepted a refund but the reply was lost: retry must adopt it, never refund twice
  G.refundMode = 'lose'; await refund(pay.id, { reason: 'goodwill 2', initiatedBy: 'admin', amountPaise: 5000 });
  assert.equal((await row("SELECT status FROM refunds WHERE payment_id = ? AND amount_paise = 5000", [pay.id])).status, 'failed');
  const n = G.refunds.length; G.refundMode = 'processed'; await retry();
  assert.equal(G.refunds.length, n); // no second refund at the gateway
  assert.equal((await row("SELECT status FROM refunds WHERE payment_id = ? AND amount_paise = 5000", [pay.id])).status, 'processed');
  // financial records can't be deleted away from under us
  await assert.rejects(pool.query('DELETE FROM payments WHERE id = ?', [pay.id]), /foreign key/i);
});

test('payout method: validated, owner only, never on a public profile, used by payout requests', async () => {
  const [a, b] = await Promise.all([makeUser('pm1'), makeUser('pm2')]);
  const put = (body, u) => call('/me/payout-method', 'PUT', body, u);
  assert.equal((await put({ kind: 'upi', upiId: 'not-an-upi' }, a)).status, 400);
  assert.equal((await put({ kind: 'bank', accountName: 'Mentor One', accountNumber: '12345', ifsc: 'SBIN0001234' }, a)).status, 400); // too short
  assert.equal((await put({ kind: 'bank', accountName: 'Mentor One', accountNumber: '123456789012', ifsc: 'bad' }, a)).status, 400);
  assert.deepEqual((await put({ kind: 'bank', accountName: 'Mentor One', accountNumber: '123456789012', ifsc: 'sbin0001234' }, a)).body.method,
    { kind: 'bank', accountName: 'Mentor One', accountNumber: '123456789012', ifsc: 'SBIN0001234' });
  assert.deepEqual((await put({ kind: 'upi', upiId: 'Mentor.One@okbank' }, a)).body.method, { kind: 'upi', upiId: 'mentor.one@okbank' }); // switching replaces it
  assert.equal((await call('/me/payout-method', 'GET', null, b)).body.method, null); // b only ever sees their own
  assert.ok(!JSON.stringify((await call(`/users/${a.username}`, 'GET', null, b)).body).includes('okbank'));
  assert.equal((await call('/payouts', 'POST', { amountPaise: 1_000_000 }, b)).body.error, 'no_payout_method');
  assert.equal((await call('/payouts', 'POST', { amountPaise: 1_000_000 }, a)).body.error, 'insufficient_balance'); // got past the method: it's on file
  assert.equal((await call('/me/payout-method', 'DELETE', null, a)).status, 200);
  assert.equal((await call('/me/payout-method', 'GET', null, a)).body.method, null);
});
