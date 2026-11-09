import { Router } from 'express';
import { z } from 'zod';
import { pool, inTx } from '../db.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { notify } from '../notify.js';
import { disconnectUser } from '../realtime.js';
import { refund } from '../payments/service.js';
import { _resetWeightsCache } from '../people/routes.js';
import { DEFAULT_WEIGHTS } from '../people/ranking.js';

export const router = Router();
router.use('/admin', requireAuth, requireAdmin); // every /admin route: logged in AND role = admin, checked on the server
for (const name of ['id']) router.param(name, (req, res, next, v) => (/^\d{1,18}$/.test(v) ? next() : res.status(404).json({ error: 'not_found' })));
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { if (e.http) return res.status(e.http).json({ error: e.message }); next(e); } };
const err = (status, error) => Object.assign(new Error(error), { http: status });
const bad = (res, e) => res.status(400).json({ error: 'invalid_input', details: e.flatten().fieldErrors });
const iso = (d) => d && new Date(d).toISOString();
const log = (adminId, action, type, id, note, conn = pool) => conn.query('INSERT INTO admin_actions (admin_id, action, target_type, target_id, note) VALUES (?,?,?,?,?)', [adminId, action, type, id ?? null, note ? String(note).slice(0, 500) : null]);

// ---------- overview & analytics ----------
router.get('/admin/overview', wrap(async (_req, res) => {
  const one = async (sql) => Object.values((await pool.query(sql))[0][0])[0];
  res.json({
    users: await one("SELECT COUNT(*) FROM users"), activeUsers: await one("SELECT COUNT(*) FROM users WHERE status = 'active'"), suspendedUsers: await one("SELECT COUNT(*) FROM users WHERE status = 'suspended'"),
    upcomingSessions: await one("SELECT COUNT(*) FROM learning_sessions WHERE status = 'scheduled' AND starts_at > UTC_TIMESTAMP()"), completedSessions: await one("SELECT COUNT(*) FROM learning_sessions WHERE status = 'completed'"),
    openReports: await one("SELECT COUNT(*) FROM reports WHERE status = 'open'"), openDisputes: await one("SELECT COUNT(*) FROM disputes WHERE status = 'open'"), pendingPayouts: await one("SELECT COUNT(*) FROM payouts WHERE status = 'requested'"),
    grossPaise: Number(await one("SELECT COALESCE(SUM(amount_paise),0) FROM payments WHERE status = 'paid'")), platformFeesPaise: Number(await one("SELECT COALESCE(SUM(platform_fee_paise),0) FROM payments WHERE status = 'paid'")),
    refundedPaise: Number(await one("SELECT COALESCE(SUM(amount_paise),0) FROM refunds WHERE status IN ('pending','processed')")), failedRefunds: await one("SELECT COUNT(*) FROM refunds WHERE status = 'failed'"),
  });
}));
router.get('/admin/analytics', wrap(async (_req, res) => {
  const [signups] = await pool.query("SELECT DATE(created_at AT TIME ZONE 'UTC') d, COUNT(*) n FROM users WHERE created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) GROUP BY d ORDER BY d");
  const [sessions] = await pool.query("SELECT DATE(starts_at AT TIME ZONE 'UTC') d, COUNT(*) n FROM learning_sessions WHERE starts_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) AND status <> 'cancelled' GROUP BY d ORDER BY d");
  const [revenue] = await pool.query("SELECT DATE(paid_at AT TIME ZONE 'UTC') d, SUM(amount_paise) gross, SUM(platform_fee_paise) fees FROM payments WHERE status = 'paid' AND paid_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) GROUP BY d ORDER BY d");
  const [topSkills] = await pool.query("SELECT s.name, COUNT(*) n FROM learning_sessions ls JOIN skills s ON s.id = ls.skill_id GROUP BY s.id ORDER BY n DESC LIMIT 8");
  const day = (x) => ({ ...x, d: new Date(x.d).toISOString().slice(0, 10) });
  res.json({ signups: signups.map(day), sessions: sessions.map(day), revenue: revenue.map((r) => ({ ...day(r), gross: Number(r.gross), fees: Number(r.fees) })), topSkills });
}));

// ---------- users ----------
router.get('/admin/users', wrap(async (req, res) => {
  const q = z.object({ q: z.string().trim().max(60).optional(), status: z.enum(['active', 'suspended', 'deactivated']).optional(), page: z.coerce.number().int().min(1).default(1) }).safeParse(req.query);
  if (!q.success) return bad(res, q.error);
  const where = ['1=1'], args = [];
  if (q.data.q) { where.push('(username LIKE ? OR email LIKE ? OR full_name LIKE ?)'); args.push(...Array(3).fill(`%${q.data.q}%`)); }
  if (q.data.status) { where.push('status = ?'); args.push(q.data.status); }
  const [rows] = await pool.query(`SELECT id, username, email, full_name, role, status, email_verified_at, created_at, last_active_at, rating_avg, rating_count,
    (SELECT COUNT(*) FROM reports r WHERE r.target_user_id = users.id) reports_against FROM users WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 25 OFFSET ?`, [...args, (q.data.page - 1) * 25]);
  res.json({ users: rows.map((u) => ({ id: u.id, username: u.username, email: u.email, fullName: u.full_name, role: u.role, status: u.status, verified: !!u.email_verified_at, createdAt: iso(u.created_at), lastActiveAt: iso(u.last_active_at), rating: u.rating_avg == null ? null : Number(u.rating_avg), ratingCount: u.rating_count, reportsAgainst: u.reports_against })) });
}));
router.patch('/admin/users/:id', wrap(async (req, res) => {
  const p = z.object({ status: z.enum(['active', 'suspended', 'deactivated']), note: z.string().trim().max(300).optional() }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const id = Number(req.params.id); if (id === req.user.id) throw err(400, 'cannot_modify_self');
  const [[u]] = await pool.query('SELECT id, role, status FROM users WHERE id = ?', [id]); if (!u) throw err(404, 'not_found');
  if (u.role === 'admin') throw err(403, 'cannot_modify_admin');
  await pool.query('UPDATE users SET status = ? WHERE id = ?', [p.data.status, id]);
  if (p.data.status !== 'active') { await pool.query('DELETE FROM auth_sessions WHERE user_id = ?', [id]); disconnectUser(id); } // kicked out right now, everywhere
  await log(req.user.id, `user_${p.data.status}`, 'user', id, p.data.note);
  res.json({ ok: true });
}));

// ---------- reports (people and sessions) ----------
router.get('/admin/reports', wrap(async (req, res) => {
  const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
  const [rows] = await pool.query(`SELECT r.*, a.username reporter, a.full_name reporter_name, t.username target, t.full_name target_name, t.status target_status, s.title session_title
    FROM reports r JOIN users a ON a.id = r.reporter_id JOIN users t ON t.id = r.target_user_id LEFT JOIN learning_sessions s ON s.id = r.session_id WHERE r.status = ? ORDER BY r.id DESC LIMIT 100`, [status]);
  res.json({ reports: rows.map((r) => ({ id: r.id, reason: r.reason, details: r.details, status: r.status, createdAt: iso(r.created_at), resolutionNote: r.resolution_note,
    reporter: { username: r.reporter, fullName: r.reporter_name }, target: { username: r.target, fullName: r.target_name, status: r.target_status }, session: r.session_id ? { id: r.session_id, title: r.session_title } : null })) });
}));
router.post('/admin/reports/:id/resolve', wrap(async (req, res) => {
  const p = z.object({ outcome: z.enum(['resolved', 'dismissed']), note: z.string().trim().max(400).optional(), suspendTarget: z.boolean().optional() }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const id = Number(req.params.id);
  const [r] = await pool.query("UPDATE reports SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ? AND status = 'open'", [p.data.outcome, p.data.note || null, req.user.id, id]);
  if (!r.affectedRows) throw err(404, 'not_found');
  const [[rep]] = await pool.query('SELECT target_user_id FROM reports WHERE id = ?', [id]);
  if (p.data.suspendTarget && p.data.outcome === 'resolved') {
    const [[t]] = await pool.query('SELECT role FROM users WHERE id = ?', [rep.target_user_id]);
    if (t.role !== 'admin') { await pool.query("UPDATE users SET status = 'suspended' WHERE id = ?", [rep.target_user_id]); await pool.query('DELETE FROM auth_sessions WHERE user_id = ?', [rep.target_user_id]); disconnectUser(rep.target_user_id); await log(req.user.id, 'user_suspended', 'user', rep.target_user_id, `via report ${id}`); }
  }
  await log(req.user.id, `report_${p.data.outcome}`, 'report', id, p.data.note);
  res.json({ ok: true });
}));

// ---------- transactions, refunds, disputes ----------
router.get('/admin/payments', wrap(async (req, res) => {
  const status = ['created', 'paid', 'failed', 'refunded'].includes(req.query.status) ? req.query.status : null;
  const [rows] = await pool.query(`SELECT p.*, s.title, s.id session_id, l.username l_username, m.username m_username,
    (SELECT COALESCE(SUM(amount_paise),0) FROM refunds r WHERE r.payment_id = p.id AND r.status IN ('pending','processed')) refunded
    FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN learning_sessions s ON s.id = b.session_id JOIN users l ON l.id = p.learner_id JOIN users m ON m.id = p.mentor_id
    ${status ? 'WHERE p.status = ?' : ''} ORDER BY p.id DESC LIMIT 100`, status ? [status] : []);
  res.json({ payments: rows.map((p) => ({ id: p.id, status: p.status, amountPaise: p.amount_paise, platformFeePaise: p.platform_fee_paise, mentorNetPaise: p.mentor_net_paise, refundedPaise: Number(p.refunded), method: p.method, gatewayPaymentId: p.gateway_payment_id,
    paidAt: iso(p.paid_at), createdAt: iso(p.created_at), session: { id: p.session_id, title: p.title }, learner: p.l_username, mentor: p.m_username })) });
}));
router.post('/admin/payments/:id/refund', wrap(async (req, res) => {
  const p = z.object({ reason: z.string().trim().min(3).max(200), amountPaise: z.number().int().positive().optional() }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const r = await refund(Number(req.params.id), { reason: p.data.reason, initiatedBy: 'admin', amountPaise: p.data.amountPaise });
  if (!r) throw err(409, 'nothing_to_refund');
  await log(req.user.id, 'refund', 'payment', Number(req.params.id), `${p.data.reason}${p.data.amountPaise ? ` (${p.data.amountPaise} paise)` : ''} -> ${r.status}`);
  res.json({ refund: r });
}));
router.get('/admin/disputes', wrap(async (req, res) => {
  const status = ['open', 'refunded', 'rejected'].includes(req.query.status) ? req.query.status : 'open';
  const [rows] = await pool.query(`SELECT d.*, p.amount_paise, p.status pay_status, u.username, s.title FROM disputes d JOIN payments p ON p.id = d.payment_id JOIN users u ON u.id = d.opened_by
    JOIN bookings b ON b.id = p.booking_id JOIN learning_sessions s ON s.id = b.session_id WHERE d.status = ? ORDER BY d.id DESC LIMIT 100`, [status]);
  res.json({ disputes: rows.map((d) => ({ id: d.id, paymentId: d.payment_id, amountPaise: d.amount_paise, paymentStatus: d.pay_status, reason: d.reason, status: d.status, adminNote: d.admin_note, openedBy: d.username, sessionTitle: d.title, createdAt: iso(d.created_at) })) });
}));
router.post('/admin/disputes/:id/resolve', wrap(async (req, res) => {
  const p = z.object({ outcome: z.enum(['refund', 'reject']), note: z.string().trim().min(3).max(400) }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const id = Number(req.params.id); const [[d]] = await pool.query("SELECT * FROM disputes WHERE id = ? AND status = 'open'", [id]); if (!d) throw err(404, 'not_found');
  if (p.data.outcome === 'refund') { const r = await refund(d.payment_id, { reason: `Dispute #${id}: ${p.data.note}`, initiatedBy: 'admin' }); if (!r) throw err(409, 'nothing_to_refund'); }
  await pool.query('UPDATE disputes SET status = ?, admin_note = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ?', [p.data.outcome === 'refund' ? 'refunded' : 'rejected', p.data.note, req.user.id, id]);
  await notify(d.opened_by, { type: 'dispute_resolved', title: p.data.outcome === 'refund' ? 'Your dispute was approved: a refund is on its way' : 'Your dispute was reviewed and declined', body: p.data.note, link: '/wallet' });
  await log(req.user.id, `dispute_${p.data.outcome}`, 'dispute', id, p.data.note);
  res.json({ ok: true });
}));

// ---------- payouts ----------
router.get('/admin/payouts', wrap(async (req, res) => {
  const status = ['requested', 'paid', 'rejected'].includes(req.query.status) ? req.query.status : 'requested';
  const [rows] = await pool.query('SELECT p.*, u.username, u.full_name FROM payouts p JOIN users u ON u.id = p.mentor_id WHERE p.status = ? ORDER BY p.id DESC LIMIT 100', [status]);
  res.json({ payouts: rows.map((x) => ({ id: x.id, amountPaise: x.amount_paise, destination: x.destination, status: x.status, adminNote: x.admin_note, requestedAt: iso(x.requested_at), mentor: { username: x.username, fullName: x.full_name } })) });
}));
const payoutAction = (status) => wrap(async (req, res) => {
  const p = z.object({ note: z.string().trim().max(300).optional() }).safeParse(req.body || {}); if (!p.success) return bad(res, p.error);
  const id = Number(req.params.id);
  const [r] = await pool.query("UPDATE payouts SET status = ?, admin_note = ?, processed_at = NOW() WHERE id = ? AND status = 'requested'", [status, p.data.note || null, id]);
  if (!r.affectedRows) throw err(409, 'not_pending'); // can't pay or reject twice
  const [[x]] = await pool.query('SELECT mentor_id, amount_paise FROM payouts WHERE id = ?', [id]);
  await notify(x.mentor_id, { type: `payout_${status}`, title: status === 'paid' ? `Payout of ₹${x.amount_paise / 100} was sent` : `Payout of ₹${x.amount_paise / 100} was declined`, body: p.data.note || null, link: '/wallet?tab=earnings' });
  await log(req.user.id, `payout_${status}`, 'payout', id, p.data.note);
  res.json({ ok: true });
});
router.post('/admin/payouts/:id/pay', payoutAction('paid'));
router.post('/admin/payouts/:id/reject', payoutAction('rejected'));

// ---------- platform settings (commission, policies, ranking weights) ----------
const SETTINGS = z.object({
  commission_percent: z.number().min(0).max(50).optional(), refund_window_hours: z.number().int().min(0).max(720).optional(),
  unpaid_hold_hours: z.number().int().min(1).max(168).optional(), min_payout_paise: z.number().int().min(100).max(10_000_000).optional(),
  ranking_weights: z.object(Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, z.number().min(0).max(1)]))).refine((w) => Object.values(w).some((v) => v > 0), 'at least one weight must be above 0').optional(),
}).strict();
router.get('/admin/settings', wrap(async (_req, res) => {
  const [rows] = await pool.query('SELECT `key`, value FROM platform_settings'); const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({ commission_percent: Number(m.commission_percent ?? 10), refund_window_hours: Number(m.refund_window_hours ?? 24), unpaid_hold_hours: Number(m.unpaid_hold_hours ?? 24), min_payout_paise: Number(m.min_payout_paise ?? 10000),
    ranking_weights: m.ranking_weights ? JSON.parse(m.ranking_weights) : DEFAULT_WEIGHTS, defaults: DEFAULT_WEIGHTS });
}));
router.put('/admin/settings', wrap(async (req, res) => {
  const p = SETTINGS.safeParse(req.body); if (!p.success) return bad(res, p.error);
  for (const [k, v] of Object.entries(p.data)) await pool.query('INSERT INTO platform_settings (`key`, value) VALUES (?,?) ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value', [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  _resetWeightsCache(); await log(req.user.id, 'settings_changed', 'settings', null, Object.keys(p.data).join(', '));
  res.json({ ok: true });
}));

// ---------- subjects & categories ----------
router.get('/admin/catalog', wrap(async (_req, res) => {
  const [c] = await pool.query('SELECT id, name FROM categories ORDER BY name');
  const [s] = await pool.query(`SELECT s.id, s.name, s.category_id, (SELECT COUNT(*) FROM mentor_skills m WHERE m.skill_id = s.id) mentors, (SELECT COUNT(*) FROM learner_skills l WHERE l.skill_id = s.id) learners,
    (SELECT COUNT(*) FROM learning_sessions x WHERE x.skill_id = s.id) sessions FROM skills s ORDER BY s.name`);
  res.json({ categories: c.map((x) => ({ ...x, skills: s.filter((k) => k.category_id === x.id).map((k) => ({ id: k.id, name: k.name, mentors: k.mentors, learners: k.learners, sessions: k.sessions })) })) });
}));
const name = z.string().trim().min(2).max(80);
const dup = (e) => { if (e.code === 'ER_DUP_ENTRY') throw err(409, 'name_taken'); throw e; };
router.post('/admin/categories', wrap(async (req, res) => { const p = z.object({ name }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const [r] = await pool.query('INSERT INTO categories (name) VALUES (?)', [p.data.name]).catch(dup); await log(req.user.id, 'category_created', 'category', r.insertId, p.data.name); res.status(201).json({ id: r.insertId }); }));
router.patch('/admin/categories/:id', wrap(async (req, res) => { const p = z.object({ name }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const [r] = await pool.query('UPDATE categories SET name = ? WHERE id = ?', [p.data.name, Number(req.params.id)]).catch(dup); if (!r.affectedRows) throw err(404, 'not_found'); await log(req.user.id, 'category_renamed', 'category', Number(req.params.id), p.data.name); res.json({ ok: true }); }));
router.delete('/admin/categories/:id', wrap(async (req, res) => {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM skills WHERE category_id = ?', [Number(req.params.id)]); if (n) throw err(409, 'category_not_empty');
  const [r] = await pool.query('DELETE FROM categories WHERE id = ?', [Number(req.params.id)]); if (!r.affectedRows) throw err(404, 'not_found'); await log(req.user.id, 'category_deleted', 'category', Number(req.params.id)); res.json({ ok: true }); }));
router.post('/admin/skills', wrap(async (req, res) => { const p = z.object({ name, categoryId: z.number().int().positive() }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const [r] = await pool.query('INSERT INTO skills (category_id, name) VALUES (?,?)', [p.data.categoryId, p.data.name]).catch((e) => { if (e.code === 'ER_NO_REFERENCED_ROW_2') throw err(400, 'unknown_category'); return dup(e); });
  await log(req.user.id, 'skill_created', 'skill', r.insertId, p.data.name); res.status(201).json({ id: r.insertId }); }));
router.patch('/admin/skills/:id', wrap(async (req, res) => { const p = z.object({ name: name.optional(), categoryId: z.number().int().positive().optional() }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const [[s]] = await pool.query('SELECT * FROM skills WHERE id = ?', [Number(req.params.id)]); if (!s) throw err(404, 'not_found');
  await pool.query('UPDATE skills SET name = ?, category_id = ? WHERE id = ?', [p.data.name ?? s.name, p.data.categoryId ?? s.category_id, s.id]).catch((e) => { if (e.code === 'ER_NO_REFERENCED_ROW_2') throw err(400, 'unknown_category'); return dup(e); });
  await log(req.user.id, 'skill_updated', 'skill', s.id, p.data.name); res.json({ ok: true }); }));
router.delete('/admin/skills/:id', wrap(async (req, res) => {
  try { const [r] = await pool.query('DELETE FROM skills WHERE id = ?', [Number(req.params.id)]); if (!r.affectedRows) throw err(404, 'not_found'); }
  catch (e) { if (e.code === 'ER_ROW_IS_REFERENCED_2') throw err(409, 'skill_in_use'); throw e; } // never orphan people's skills or sessions
  await log(req.user.id, 'skill_deleted', 'skill', Number(req.params.id)); res.json({ ok: true }); }));

router.get('/admin/audit', wrap(async (_req, res) => {
  const [rows] = await pool.query('SELECT a.*, u.username FROM admin_actions a JOIN users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT 100');
  res.json({ actions: rows.map((a) => ({ id: a.id, admin: a.username, action: a.action, targetType: a.target_type, targetId: a.target_id, note: a.note, at: iso(a.created_at) })) });
}));
