import { pool, inTx } from '../db.js';
import { notify } from '../notify.js';
import * as gw from './razorpay.js';

export const httpErr = (status, error) => Object.assign(new Error(error), { http: status });
export const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export async function getSetting(key, fallback) {
  const [[r]] = await pool.query('SELECT value FROM platform_settings WHERE `key` = ?', [key]);
  return r ? r.value : fallback;
}
/** The mentor keeps their whole price; the learner pays a platform fee on top, plus GST on that fee. All in paise, rounded to the nearest paisa. */
export const feesFor = (pricePaise, feePercent, gstPercent) => { const fee = Math.round((pricePaise * Number(feePercent)) / 100), gst = Math.round((fee * Number(gstPercent)) / 100); return { fee, gst, total: pricePaise + fee + gst }; };
export const feeSettings = async () => ({ feePercent: Number(await getSetting('commission_percent', '10')), gstPercent: Number(await getSetting('gst_percent', '18')) });

// ---------- order creation ----------
export async function createOrderForBooking(user, bookingId) {
  const [[b]] = await pool.query(
    `SELECT b.id, b.status, b.learner_id, s.id session_id, s.mentor_id, s.title, s.pricing, s.price_paise, s.status s_status, s.starts_at
     FROM bookings b JOIN learning_sessions s ON s.id = b.session_id WHERE b.id = ?`, [bookingId]);
  if (!b || b.learner_id !== user.id) throw httpErr(404, 'not_found');
  if (b.status !== 'awaiting_payment') throw httpErr(409, 'not_awaiting_payment');
  if (b.pricing !== 'paid' || b.s_status !== 'scheduled' || new Date(b.starts_at) <= new Date()) throw httpErr(409, 'not_payable');
  const price = b.price_paise; // from the database; there is no amount parameter for a client to tamper with

  // retrying a failed/unfinished attempt reuses the same gateway order
  const [[prev]] = await pool.query("SELECT * FROM payments WHERE booking_id = ? AND status IN ('created','failed') ORDER BY id DESC LIMIT 1", [b.id]);
  if (prev) {
    // ...but only if that order still exists for the keys in use now: after switching Razorpay keys (a new account, or test -> live)
    // an old order id makes Checkout fail with "Something went wrong". No money moved on it, so drop it and start a fresh order.
    const alive = await gw.fetchOrder(prev.gateway_order_id).then(() => true, (e) => { if (e.status >= 400 && e.status < 500) return false; throw e; });
    if (alive) return { paymentId: prev.id, orderId: prev.gateway_order_id, amountPaise: prev.amount_paise, currency: prev.currency, title: b.title, pricePaise: prev.mentor_net_paise, feePaise: prev.platform_fee_paise, gstPaise: prev.gst_paise };
    await pool.query("DELETE FROM payments WHERE id = ? AND status IN ('created','failed')", [prev.id]);
  }

  const { feePercent: pct, gstPercent } = await feeSettings(); const { fee, gst, total: amount } = feesFor(price, pct, gstPercent);
  const order = await gw.createOrder({ amountPaise: amount, receipt: `bk${b.id}-${Date.now().toString(36)}`, notes: { booking_id: String(b.id), session_id: String(b.session_id) } });
  if (order.amount !== amount || order.currency !== 'INR') throw httpErr(502, 'gateway_amount_mismatch');
  let r;
  try {
    [r] = await pool.query(
      'INSERT INTO payments (booking_id, learner_id, mentor_id, amount_paise, commission_percent, platform_fee_paise, gst_paise, mentor_net_paise, gateway_order_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [b.id, user.id, b.mentor_id, amount, pct, fee, gst, price, order.id]);
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY' || !String(e.sqlMessage).includes('uq_one_open_payment')) throw e;
    // a simultaneous click won the race: use its order (our extra gateway order is simply never paid)
    const [[won]] = await pool.query("SELECT * FROM payments WHERE booking_id = ? AND status IN ('created','failed') ORDER BY id DESC LIMIT 1", [b.id]);
    return { paymentId: won.id, orderId: won.gateway_order_id, amountPaise: won.amount_paise, currency: won.currency, title: b.title, pricePaise: won.mentor_net_paise, feePaise: won.platform_fee_paise, gstPaise: won.gst_paise };
  }
  return { paymentId: r.insertId, orderId: order.id, amountPaise: amount, currency: 'INR', title: b.title, pricePaise: price, feePaise: fee, gstPaise: gst };
}

// ---------- confirming a payment (called by BOTH the checkout verification and the webhook; idempotent) ----------
export async function finalizePaid({ orderId, paymentId, amountPaise, currency, method }) {
  let out = { found: false }, info;
  await inTx(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM payments WHERE gateway_order_id = ? FOR UPDATE', [orderId]);
    if (!p) return;
    out = { found: true, paymentRowId: p.id };
    if (p.status === 'paid' || p.status === 'refunded') { out.already = true; return; }
    if (amountPaise !== p.amount_paise || (currency || 'INR') !== p.currency) { // paid something other than what we asked for: never confirm
      await conn.query("UPDATE payments SET status = 'failed', failure_reason = 'amount_mismatch' WHERE id = ?", [p.id]);
      out.mismatch = true; return;
    }
    const [[s0]] = await conn.query('SELECT s.id, s.status, s.title FROM bookings b JOIN learning_sessions s ON s.id = b.session_id WHERE b.id = ?', [p.booking_id]);
    await conn.query('SELECT id FROM learning_sessions WHERE id = ? FOR UPDATE', [s0.id]); // same order as booking code: session, then booking
    const [[b]] = await conn.query('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [p.booking_id]);
    await conn.query("UPDATE payments SET status = 'paid', gateway_payment_id = ?, method = ?, paid_at = NOW(), failure_reason = NULL WHERE id = ?", [paymentId, method || null, p.id]);
    const live = b.status === 'awaiting_payment' && s0.status === 'scheduled';
    if (live) await conn.query("UPDATE bookings SET status = 'confirmed' WHERE id = ?", [b.id]);
    out.confirmed = live; out.needsRefund = !live; // money arrived for a seat that no longer exists: give it back
    info = { p, title: s0.title, bookingId: b.id, sessionId: s0.id };
  });
  if (info) {
    const { p, title, sessionId } = info;
    if (out.confirmed) {
      await notify(p.learner_id, { type: 'payment_success', title: `Payment received: ${rupees(p.amount_paise)}`, body: `You're booked: “${title}”`, link: '/wallet' });
      await notify(p.mentor_id, { type: 'booking_confirmed', title: `A learner paid for “${title}”`, link: `/sessions/${sessionId}` });
    } else {
      await refund(p.id, { reason: 'Seat no longer available when payment arrived', initiatedBy: 'system' }).catch((e) => console.error('auto-refund failed', e.message));
    }
  }
  return out;
}

export async function markFailed(orderId, reason) {
  const [r] = await pool.query("UPDATE payments SET status = 'failed', failure_reason = ? WHERE gateway_order_id = ? AND status = 'created'", [String(reason || 'payment_failed').slice(0, 300), orderId]);
  if (r.affectedRows) {
    const [[p]] = await pool.query('SELECT learner_id, amount_paise FROM payments WHERE gateway_order_id = ?', [orderId]);
    await notify(p.learner_id, { type: 'payment_failed', title: `Payment of ${rupees(p.amount_paise)} failed`, body: reason || null, link: '/wallet' });
  }
  return r.affectedRows > 0;
}

// ---------- client-side checkout completion: verify the signature AND ask the gateway ----------
export async function verifyCheckout(user, { orderId, paymentId, signature }) {
  const [[p]] = await pool.query('SELECT * FROM payments WHERE gateway_order_id = ?', [orderId]);
  if (!p || p.learner_id !== user.id) throw httpErr(404, 'not_found');
  if (!gw.verifyCheckoutSignature({ orderId, paymentId, signature })) throw httpErr(400, 'invalid_signature');
  if (p.status === 'paid') return { status: 'paid', already: true };
  if (p.status === 'refunded') return { status: 'refunded', already: true };
  let pay = await gw.fetchPayment(paymentId); // never trust the browser alone: confirm with the gateway
  if (pay.order_id !== orderId) throw httpErr(400, 'order_mismatch');
  if (pay.status === 'authorized') pay = await gw.capturePayment(paymentId, p.amount_paise);
  if (pay.status === 'failed') { await markFailed(orderId, pay.error_description || 'payment_failed'); throw httpErr(402, 'payment_failed'); }
  if (pay.status !== 'captured') throw httpErr(409, 'payment_pending');
  const r = await finalizePaid({ orderId, paymentId, amountPaise: pay.amount, currency: pay.currency, method: pay.method });
  if (r.mismatch) throw httpErr(409, 'amount_mismatch');
  return { status: 'paid', confirmed: !!r.confirmed, refunded: !!r.needsRefund };
}

// ---------- refunds ----------
export async function refund(paymentId, { reason, initiatedBy, amountPaise } = {}) {
  let row, pay;
  await inTx(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [paymentId]);
    if (!p || p.status !== 'paid') return;
    const [[{ taken }]] = await conn.query("SELECT COALESCE(SUM(amount_paise),0) taken FROM refunds WHERE payment_id = ? AND status IN ('pending','processed')", [p.id]);
    const remaining = p.amount_paise - taken, amt = amountPaise ?? remaining;
    if (amt <= 0 || amt > remaining) return; // nothing left to refund
    const [r] = await conn.query('INSERT INTO refunds (payment_id, amount_paise, reason, initiated_by) VALUES (?,?,?,?)', [p.id, amt, reason, initiatedBy]);
    row = { id: r.insertId, amount_paise: amt, payment_id: p.id }; pay = p;
  });
  return row ? execRefund(row, pay) : null;
}

async function execRefund(row, pay, { retry = false } = {}) {
  try {
    // On a retry the first attempt may actually have reached the gateway (we only lost the reply): adopt that refund instead of paying out twice.
    const resp = (retry && (await gw.findRefund(pay.gateway_payment_id, row.id))) || await gw.refundPayment(pay.gateway_payment_id, row.amount_paise, { refund_row: String(row.id) });
    const done = resp.status === 'processed';
    await pool.query('UPDATE refunds SET gateway_refund_id = ?, status = ?, failure_reason = NULL, attempts = attempts + 1, processed_at = CASE WHEN ? THEN NOW() ELSE NULL END WHERE id = ?', [resp.id, done ? 'processed' : 'pending', done, row.id]);
    await syncRefundedStatus(pay.id);
    await notify(pay.learner_id, { type: done ? 'refund_processed' : 'refund_initiated', title: `Refund of ${rupees(row.amount_paise)} ${done ? 'processed' : 'started'}`, body: 'It can take 5–7 working days to reach your account.', link: '/wallet' });
    return { id: row.id, status: done ? 'processed' : 'pending' };
  } catch (e) {
    // money is still with us: keep the row as 'failed' so retryFailedRefunds()/an admin can finish it; never lose track
    await pool.query("UPDATE refunds SET status = 'failed', failure_reason = ?, attempts = attempts + 1 WHERE id = ?", [String(e.message).slice(0, 300), row.id]);
    console.error('refund failed', row.id, e.message);
    return { id: row.id, status: 'failed' };
  }
}

async function syncRefundedStatus(paymentId) { // payment becomes 'refunded' once the whole amount has been accepted by the gateway
  await pool.query(`UPDATE payments p SET status = 'refunded' WHERE p.id = ? AND p.status = 'paid'
    AND (SELECT COALESCE(SUM(amount_paise),0) FROM refunds r WHERE r.payment_id = p.id AND r.status IN ('pending','processed') AND r.gateway_refund_id IS NOT NULL) >= p.amount_paise`, [paymentId]);
}

export async function refundForBooking(bookingId, opts) {
  try {
    const [[p]] = await pool.query("SELECT id FROM payments WHERE booking_id = ? AND status = 'paid'", [bookingId]);
    return p ? await refund(p.id, opts) : null;
  } catch (e) { console.error('refundForBooking failed', bookingId, e.message); return null; } // cancellation must still succeed; the failure is logged and retried
}

export async function retryFailedRefunds() {
  // Explicit, aliased columns: joining payments with p.* silently overwrote the REFUND's amount with the payment's amount.
  const [rows] = await pool.query(
    `SELECT r.id refund_id, r.amount_paise refund_amount, p.id payment_id, p.gateway_payment_id, p.learner_id
     FROM refunds r JOIN payments p ON p.id = r.payment_id
     WHERE r.attempts < 5 AND r.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND (r.status = 'failed' OR (r.status = 'pending' AND r.gateway_refund_id IS NULL AND r.created_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)))`); // the second case = we crashed between saving the refund and calling the gateway
  for (const r of rows) await execRefund({ id: r.refund_id, amount_paise: r.refund_amount }, { id: r.payment_id, gateway_payment_id: r.gateway_payment_id, learner_id: r.learner_id }, { retry: true });
  return rows.length;
}

/** A refund event from the gateway (webhook): the source of truth for final state. */
export async function applyRefundEvent(entity, failed = false) {
  const [[row]] = await pool.query('SELECT * FROM refunds WHERE gateway_refund_id = ?', [entity.id]);
  if (!row) { // refund made directly in the Razorpay dashboard: record it so books stay right
    const [[p]] = await pool.query('SELECT id FROM payments WHERE gateway_payment_id = ?', [entity.payment_id]);
    if (!p) return false;
    await pool.query("INSERT IGNORE INTO refunds (payment_id, amount_paise, status, gateway_refund_id, reason, initiated_by, processed_at) VALUES (?,?,?,?,?,'admin','Refunded in the payment gateway dashboard', CASE WHEN ? THEN NOW() END)", [p.id, entity.amount, failed ? 'failed' : 'processed', entity.id, !failed]);
    await syncRefundedStatus(p.id); return true;
  }
  if (row.status === 'processed' && !failed) return true; // already known
  await pool.query('UPDATE refunds SET status = ?, processed_at = CASE WHEN ? THEN NOW() ELSE processed_at END WHERE id = ?', [failed ? 'failed' : 'processed', !failed, row.id]);
  if (!failed) {
    await syncRefundedStatus(row.payment_id);
    const [[p]] = await pool.query('SELECT learner_id FROM payments WHERE id = ?', [row.payment_id]);
    await notify(p.learner_id, { type: 'refund_processed', title: `Refund of ${rupees(row.amount_paise)} processed`, link: '/wallet' });
  }
  return true;
}

/** Learner cancelled their own booking: full refund if far enough ahead, otherwise none (policy in platform_settings). */
export async function refundForLearnerCancel(bookingId, startsAt) {
  const windowMin = Number(await getSetting('refund_window_minutes', '45'));
  const minutesLeft = (new Date(startsAt).getTime() - Date.now()) / 60_000;
  if (minutesLeft >= windowMin) { await refundForBooking(bookingId, { reason: 'Cancelled by learner within the refund window', initiatedBy: 'learner' }); return { refunded: true, windowMinutes: windowMin }; }
  return { refunded: false, windowMinutes: windowMin };
}

/** Accepted-but-unpaid seats are released after a while so they don't block other learners. */
export async function expireUnpaidBookings() {
  await pool.query('DELETE FROM webhook_events WHERE received_at < DATE_SUB(NOW(), INTERVAL 30 DAY)'); // dedupe window; the table must not grow forever
  const hold = Number(await getSetting('unpaid_hold_hours', '24'));
  const [rows] = await pool.query("SELECT b.id, b.learner_id, b.session_id, s.title FROM bookings b JOIN learning_sessions s ON s.id = b.session_id WHERE b.status = 'awaiting_payment' AND b.updated_at < DATE_SUB(NOW(), INTERVAL ? HOUR)", [hold]);
  let n = 0;
  for (const b of rows) {
    const [r] = await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'awaiting_payment' AND updated_at < DATE_SUB(NOW(), INTERVAL ? HOUR)", [b.id, hold]);
    if (r.affectedRows) { n++; await notify(b.learner_id, { type: 'booking_expired', title: `Your seat in “${b.title}” was released`, body: 'Payment was not completed in time.', link: `/sessions/${b.session_id}` }); }
  }
  return n;
}

// ---------- earnings & payouts (mentor side) ----------
// Only payments whose booking is still active count. "Available" = session completed; "pending" = session not held yet.
const EARN_SQL = `SELECT
    COALESCE(SUM(p.amount_paise),0) gross, COALESCE(SUM(p.platform_fee_paise),0) fees, COALESCE(SUM(p.mentor_net_paise),0) net,
    COALESCE(SUM(CASE WHEN s.status = 'completed' THEN p.mentor_net_paise ELSE 0 END),0) available, COALESCE(SUM(CASE WHEN s.status = 'scheduled' THEN p.mentor_net_paise ELSE 0 END),0) pending, COUNT(*) sales
  FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN learning_sessions s ON s.id = b.session_id
  WHERE p.mentor_id = ? AND p.status = 'paid' AND b.status IN ('confirmed','completed')`;

async function balanceOf(conn, userId) {
  const [[e]] = await conn.query(EARN_SQL, [userId]);
  const [[o]] = await conn.query("SELECT COALESCE(SUM(CASE WHEN status IN ('requested','paid') THEN amount_paise ELSE 0 END),0) committed, COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_paise ELSE 0 END),0) paid_out, COALESCE(SUM(CASE WHEN status = 'requested' THEN amount_paise ELSE 0 END),0) requested FROM payouts WHERE mentor_id = ?", [userId]);
  const [[rf]] = await conn.query("SELECT COALESCE(SUM(amount_paise),0) refunded FROM payments WHERE mentor_id = ? AND status = 'refunded'", [userId]);
  return { grossPaise: Number(e.gross), feesPaise: Number(e.fees), netPaise: Number(e.net), pendingPaise: Number(e.pending), availablePaise: Number(e.available), sales: e.sales,
    paidOutPaise: Number(o.paid_out), requestedPaise: Number(o.requested), refundedPaise: Number(rf.refunded), balancePaise: Number(e.available) - Number(o.committed) };
}
export const earnings = (userId) => balanceOf(pool, userId);

export async function requestPayout(user, amountPaise, destination) {
  const min = Number(await getSetting('min_payout_paise', '0')); // 0 = no minimum
  if (amountPaise < min) throw httpErr(400, 'below_minimum');
  let id;
  await inTx(async (conn) => {
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]); // serialises this mentor's requests: two at once can't both spend the same balance
    const bal = await balanceOf(conn, user.id);
    if (amountPaise > bal.balancePaise) throw httpErr(409, 'insufficient_balance');
    [{ insertId: id }] = await conn.query('INSERT INTO payouts (mentor_id, amount_paise, destination) VALUES (?,?,?)', [user.id, amountPaise, destination]);
  });
  return id;
}
