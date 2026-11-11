import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import * as gw from './razorpay.js';
import * as pay from './service.js';
import { payoutMethodOf } from '../people/routes.js';

export const router = Router();
router.use(['/payments', '/earnings', '/payouts'], requireAuth);
for (const name of ['id']) router.param(name, (req, res, next, v) => (/^\d{1,18}$/.test(v) ? next() : res.status(404).json({ error: 'not_found' })));

// Money endpoints are rate limited per user (each Pay click creates a gateway order; a payout is a human task).
const limit = process.env.NODE_ENV === 'test' ? (_q, _s, n) => n() : rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: (req) => String(req.user?.id), standardHeaders: true, legacyHeaders: false });
const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e instanceof gw.GatewayError) {
      if (e.code === 'NOT_CONFIGURED') return res.status(503).json({ error: 'payments_not_configured', message: 'Online payments are not set up on this server yet.' });
      console.error('gateway error', e.code, e.message);
      return res.status(502).json({ error: 'gateway_error', message: 'The payment provider could not complete the request. Please try again.' });
    }
    next(e);
  }
};
const bad = (res, err) => res.status(400).json({ error: 'invalid_input', details: err.flatten().fieldErrors });
const iso = (d) => d && new Date(d).toISOString();
const receiptNo = (p) => `SS-${new Date(p.paid_at || p.created_at).toISOString().slice(0, 10).replace(/-/g, '')}-${String(p.id).padStart(6, '0')}`;

router.get('/payments/config', handle(async (_req, res) => res.json({ enabled: gw.configured(), keyId: gw.publicKeyId(), webhookConfigured: gw.webhookConfigured() })));

// Start (or resume) payment for an accepted paid booking. The amount is read from the database, never from the request.
router.post('/bookings/:id/pay', requireAuth, limit, handle(async (req, res) => {
  const o = await pay.createOrderForBooking(req.user, Number(req.params.id));
  res.json({ ...o, keyId: gw.publicKeyId() });
}));

router.post('/payments/verify', limit, handle(async (req, res) => {
  const p = z.object({ razorpay_order_id: z.string().min(5).max(64), razorpay_payment_id: z.string().min(5).max(64), razorpay_signature: z.string().min(10).max(200) }).safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  res.json(await pay.verifyCheckout(req.user, { orderId: p.data.razorpay_order_id, paymentId: p.data.razorpay_payment_id, signature: p.data.razorpay_signature }));
}));

// ---------- webhook (no session: authenticated by signature over the raw body) ----------
export const webhookHandler = handle(async (req, res) => {
  if (!gw.webhookConfigured()) return res.status(503).json({ error: 'webhook_not_configured' });
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!gw.verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) return res.status(400).json({ error: 'invalid_signature' });
  let evt; try { evt = JSON.parse(raw); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  const eventId = req.get('x-razorpay-event-id') || `${evt.event}:${evt.payload?.payment?.entity?.id || evt.payload?.refund?.entity?.id || evt.created_at}`;
  try { await pool.query('INSERT INTO webhook_events (event_id, type) VALUES (?,?)', [eventId, String(evt.event).slice(0, 60)]); }
  catch (e) { if (e.code === 'ER_DUP_ENTRY') return res.json({ ok: true, duplicate: true }); throw e; }
  try {
    const pe = evt.payload?.payment?.entity, re = evt.payload?.refund?.entity;
    if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && pe) await pay.finalizePaid({ orderId: pe.order_id, paymentId: pe.id, amountPaise: pe.amount, currency: pe.currency, method: pe.method });
    else if (evt.event === 'payment.failed' && pe) await pay.markFailed(pe.order_id, pe.error_description);
    else if (evt.event === 'refund.processed' && re) await pay.applyRefundEvent(re, false);
    else if (evt.event === 'refund.failed' && re) await pay.applyRefundEvent(re, true);
  } catch (e) {
    await pool.query('DELETE FROM webhook_events WHERE event_id = ?', [eventId]).catch(() => {}); // let the gateway retry this one
    throw e;
  }
  res.json({ ok: true });
});

// ---------- history & receipts ----------
const shape = (p, viewerId, refunds = []) => {
  const mine = p.learner_id === viewerId;
  return {
    id: p.id, receiptNo: ['paid', 'refunded'].includes(p.status) ? receiptNo(p) : null, status: p.status, amountPaise: p.amount_paise, currency: p.currency, method: p.method,
    paidAt: iso(p.paid_at), createdAt: iso(p.created_at), failureReason: mine ? p.failure_reason : undefined, gatewayPaymentId: p.gateway_payment_id,
    session: { id: p.session_id, title: p.title, startsAt: iso(p.starts_at) }, bookingId: p.booking_id,
    learner: { username: p.l_username, fullName: p.l_full_name }, mentor: { username: p.m_username, fullName: p.m_full_name },
    // the platform fee and the mentor's net are the mentor's business, not the learner's
    ...(!mine ? { platformFeePaise: p.platform_fee_paise, mentorNetPaise: p.mentor_net_paise, commissionPercent: Number(p.commission_percent) } : {}),
    refunds: refunds.map((r) => ({ id: r.id, amountPaise: r.amount_paise, status: r.status, reason: r.reason, createdAt: iso(r.created_at), processedAt: iso(r.processed_at) })),
  };
};
const PAY_SELECT = `SELECT p.*, s.id session_id, s.title, s.starts_at, l.username l_username, l.full_name l_full_name, m.username m_username, m.full_name m_full_name
  FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN learning_sessions s ON s.id = b.session_id JOIN users l ON l.id = p.learner_id JOIN users m ON m.id = p.mentor_id`;
const refundsFor = async (ids) => (ids.length ? (await pool.query('SELECT * FROM refunds WHERE payment_id IN (?) ORDER BY id', [ids]))[0] : []);

router.get('/payments', handle(async (req, res) => {
  const [rows] = await pool.query(`${PAY_SELECT} WHERE p.learner_id = ? AND p.status <> 'created' ORDER BY p.id DESC LIMIT 100`, [req.user.id]);
  const refunds = await refundsFor(rows.map((r) => r.id));
  res.json({ payments: rows.map((p) => shape(p, req.user.id, refunds.filter((r) => r.payment_id === p.id))) });
}));

router.get('/payments/:id', handle(async (req, res) => {
  const [[p]] = await pool.query(`${PAY_SELECT} WHERE p.id = ?`, [Number(req.params.id)]);
  if (!p || (p.learner_id !== req.user.id && p.mentor_id !== req.user.id)) return res.status(404).json({ error: 'not_found' }); // only the two parties
  res.json(shape(p, req.user.id, await refundsFor([p.id])));
}));

// a learner can ask for a human review of a payment (outside the automatic refund policy)
router.post('/payments/:id/dispute', handle(async (req, res) => {
  const p = z.object({ reason: z.string().trim().min(10).max(1000) }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const [[pay]] = await pool.query("SELECT id, status FROM payments WHERE id = ? AND learner_id = ?", [Number(req.params.id), req.user.id]);
  if (!pay) return res.status(404).json({ error: 'not_found' });
  if (pay.status !== 'paid') return res.status(409).json({ error: 'not_disputable' });
  try { await pool.query('INSERT INTO disputes (payment_id, opened_by, reason) VALUES (?,?,?)', [pay.id, req.user.id, p.data.reason]); }
  catch (e) { if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'already_disputed' }); throw e; }
  res.status(201).json({ ok: true });
}));

// ---------- earnings & payouts ----------
router.get('/earnings', handle(async (req, res) => {
  const summary = await pay.earnings(req.user.id);
  const [sales] = await pool.query(`${PAY_SELECT} WHERE p.mentor_id = ? AND p.status IN ('paid','refunded') ORDER BY p.id DESC LIMIT 50`, [req.user.id]);
  const [payouts] = await pool.query('SELECT id, amount_paise, destination, status, admin_note, requested_at, processed_at FROM payouts WHERE mentor_id = ? ORDER BY id DESC LIMIT 50', [req.user.id]);
  res.json({ summary: { ...summary, minPayoutPaise: Number(await pay.getSetting('min_payout_paise', '10000')) },
    sales: sales.map((p) => shape(p, req.user.id)),
    payouts: payouts.map((x) => ({ id: x.id, amountPaise: x.amount_paise, destination: x.destination, status: x.status, adminNote: x.admin_note, requestedAt: iso(x.requested_at), processedAt: iso(x.processed_at) })) });
}));

router.post('/payouts', limit, handle(async (req, res) => {
  const p = z.object({ amountPaise: z.number().int().positive().max(100_000_000), destination: z.string().trim().min(3).max(120).optional() }).safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  let dest = p.data.destination;
  if (!dest) { // no one-off destination: send it to the saved payout method, written out so the admin can act on it
    const m = await payoutMethodOf(req.user.id);
    if (!m) return res.status(400).json({ error: 'no_payout_method' });
    dest = m.kind === 'upi' ? `UPI ${m.upiId}` : `Bank · ${m.accountName} · ${m.accountNumber} · ${m.ifsc}`;
  }
  const id = await pay.requestPayout(req.user, p.data.amountPaise, dest);
  res.status(201).json({ id });
}));
