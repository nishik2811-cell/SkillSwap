import { Router } from 'express';
import { z } from 'zod';
import { pool, inTx } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { notify } from '../notify.js';
import { refundForBooking, refundForLearnerCancel } from '../payments/service.js';

export const router = Router();
router.use(['/sessions', '/bookings'], requireAuth);
// Non-numeric ids are simply "not found", never a SQL error.
for (const name of ['id', 'mid']) router.param(name, (req, res, next, v) => (/^\d{1,18}$/.test(v) ? next() : res.status(404).json({ error: 'not_found' })));
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const bad = (res, err) => res.status(400).json({ error: 'invalid_input', details: err.flatten().fieldErrors });
const MIN_LEAD_MS = 5 * 60_000;
const MAX_SCHEDULED = 50;
const SEAT_STATUSES = "('confirmed','awaiting_payment','completed')"; // statuses that occupy a seat
const who = (u, p = '') => ({ username: u[p + 'username'], fullName: u[p + 'full_name'], avatarUrl: u[p + 'avatar_path'] && `/uploads/${u[p + 'avatar_path']}` });
const iso = (d) => new Date(d).toISOString();

// ---------- helpers ----------
const lockSession = async (conn, id) => (await conn.query('SELECT * FROM learning_sessions WHERE id = ? FOR UPDATE', [id]))[0][0];
const seatsTaken = async (conn, sid) => (await conn.query(`SELECT COUNT(*) n FROM bookings WHERE session_id = ? AND status IN ${SEAT_STATUSES}`, [sid]))[0][0].n;
const isBlocked = async (a, b) => !!(await pool.query('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', [a, b, b, a]))[0][0];
const err = (status, error) => Object.assign(new Error(error), { http: status });
const handle = (fn) => wrap(async (req, res) => { try { await fn(req, res); } catch (e) { if (e.http) return res.status(e.http).json({ error: e.message }); throw e; } });

const shape = (s, extra = {}) => ({
  id: s.id, title: s.title, description: s.description, startsAt: iso(s.starts_at), endsAt: iso(new Date(s.starts_at).getTime() + s.duration_min * 60_000), durationMin: s.duration_min,
  capacity: s.capacity, kind: s.capacity > 1 ? 'group' : 'individual', pricing: s.pricing, pricePaise: s.price_paise, autoAccept: !!s.auto_accept, status: s.status,
  cancelReason: s.cancel_reason, skill: s.skill, skillId: s.skill_id, ...extra,
});

// ---------- create / browse ----------
const createSchema = z.object({
  title: z.string().trim().min(3).max(120), description: z.string().trim().max(2000).optional(), skillId: z.number().int().positive(),
  startsAt: z.string().datetime(), durationMin: z.number().int().min(15).max(480), capacity: z.number().int().min(1).max(100).default(1),
  pricing: z.enum(['free', 'paid']).default('free'), pricePaise: z.number().int().min(100).max(10_000_000).optional(), autoAccept: z.boolean().default(false),
}).refine((s) => (s.pricing === 'paid') === (s.pricePaise != null), { message: 'paid sessions need a price; free sessions cannot have one', path: ['pricePaise'] });

async function mentorOverlap(conn, mentorId, startsAt, durationMin, exceptId = 0) {
  const [[o]] = await conn.query(
    "SELECT id FROM learning_sessions WHERE mentor_id = ? AND status = 'scheduled' AND id <> ? AND starts_at < DATE_ADD(?, INTERVAL ? MINUTE) AND DATE_ADD(starts_at, INTERVAL duration_min MINUTE) > ? LIMIT 1",
    [mentorId, exceptId, startsAt, durationMin, startsAt]);
  return !!o;
}

router.post('/sessions', handle(async (req, res) => {
  const p = createSchema.safeParse(req.body); if (!p.success) return bad(res, p.error);
  const d = p.data, start = new Date(d.startsAt);
  if (start.getTime() < Date.now() + MIN_LEAD_MS) return res.status(400).json({ error: 'must_be_in_future' });
  const [[ms]] = await pool.query('SELECT 1 x FROM mentor_skills WHERE user_id = ? AND skill_id = ?', [req.user.id, d.skillId]);
  if (!ms) return res.status(400).json({ error: 'not_a_mentor_skill' }); // you can only run sessions for skills on your Mentor profile
  const id = await inTx(async (conn) => {
    const [[{ n }]] = await conn.query("SELECT COUNT(*) n FROM learning_sessions WHERE mentor_id = ? AND status = 'scheduled'", [req.user.id]);
    if (n >= MAX_SCHEDULED) throw err(429, 'too_many_sessions'); // keeps one account from flooding Browse
    if (await mentorOverlap(conn, req.user.id, start, d.durationMin)) throw err(409, 'overlaps_another_session');
    const [r] = await conn.query('INSERT INTO learning_sessions (mentor_id, skill_id, title, description, starts_at, duration_min, capacity, pricing, price_paise, auto_accept) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [req.user.id, d.skillId, d.title, d.description || null, start, d.durationMin, d.capacity, d.pricing, d.pricePaise ?? null, d.autoAccept]);
    return r.insertId;
  });
  res.status(201).json({ id });
}));

const sessionSelect = (cols = '') => `SELECT s.*, ${cols}sk.name skill, m.username m_username, m.full_name m_full_name, m.avatar_path m_avatar_path, m.rating_avg m_rating_avg, m.rating_count m_rating_count,
  (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ${SEAT_STATUSES}) seats
  FROM learning_sessions s JOIN skills sk ON sk.id = s.skill_id JOIN users m ON m.id = s.mentor_id`;
const SESSION_SELECT = sessionSelect();
const mentorOf = (s) => ({ ...who(s, 'm_'), rating: { avg: s.m_rating_avg == null ? null : Number(s.m_rating_avg), count: s.m_rating_count } });

router.get('/sessions', handle(async (req, res) => {
  const q = z.object({ skillId: z.coerce.number().int().positive().optional(), pricing: z.enum(['free', 'paid']).optional(), kind: z.enum(['individual', 'group']).optional(),
    q: z.string().trim().max(60).optional(), page: z.coerce.number().int().min(1).default(1) }).safeParse(req.query);
  if (!q.success) return bad(res, q.error);
  const f = q.data, where = ["s.status = 'scheduled'", 's.starts_at > NOW()', 's.mentor_id <> ?', "m.status = 'active'",
    'NOT EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id = s.mentor_id AND bl.blocked_id = ?) OR (bl.blocker_id = ? AND bl.blocked_id = s.mentor_id))'], args = [req.user.id, req.user.id, req.user.id];
  if (f.skillId) { where.push('s.skill_id = ?'); args.push(f.skillId); }
  if (f.pricing) { where.push('s.pricing = ?'); args.push(f.pricing); }
  if (f.kind) where.push(f.kind === 'group' ? 's.capacity > 1' : 's.capacity = 1');
  if (f.q) { where.push('(s.title LIKE ? OR sk.name LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`); }
  const [rows] = await pool.query(`${SESSION_SELECT} WHERE ${where.join(' AND ')} HAVING seats < s.capacity ORDER BY s.starts_at LIMIT 20 OFFSET ?`, [...args, (f.page - 1) * 20]);
  res.json({ sessions: rows.map((s) => shape(s, { seatsLeft: s.capacity - s.seats, mentor: mentorOf(s) })), page: f.page });
}));

router.get('/sessions/mine', handle(async (req, res) => {
  const q = z.object({ role: z.enum(['mentor', 'learner']).default('mentor'), when: z.enum(['upcoming', 'past']).default('upcoming') }).safeParse(req.query);
  if (!q.success) return bad(res, q.error);
  const { role, when } = q.data, upcoming = when === 'upcoming';
  const cond = upcoming ? "s.status = 'scheduled' AND DATE_ADD(s.starts_at, INTERVAL s.duration_min MINUTE) > NOW()" : "(s.status <> 'scheduled' OR DATE_ADD(s.starts_at, INTERVAL s.duration_min MINUTE) <= NOW())";
  const order = upcoming ? 'ASC' : 'DESC';
  if (role === 'mentor') {
    const [rows] = await pool.query(`${SESSION_SELECT} WHERE s.mentor_id = ? AND ${cond} ORDER BY s.starts_at ${order} LIMIT 100`, [req.user.id]);
    const ids = rows.map((r) => r.id);
    const [pend] = ids.length ? await pool.query("SELECT session_id, COUNT(*) n FROM bookings WHERE session_id IN (?) AND status = 'requested' GROUP BY session_id", [ids]) : [[]];
    return res.json({ sessions: rows.map((s) => shape(s, { seatsTaken: s.seats, pendingRequests: pend.find((x) => x.session_id === s.id)?.n || 0, mentor: mentorOf(s) })) });
  }
  const [rows] = await pool.query(`${sessionSelect('mb.id booking_id, mb.status booking_status, ')} JOIN bookings mb ON mb.session_id = s.id AND mb.learner_id = ? WHERE ${cond} AND mb.status NOT IN ('rejected') ${upcoming ? "AND mb.status <> 'cancelled'" : ''} ORDER BY s.starts_at ${order} LIMIT 100`, [req.user.id]);
  res.json({ sessions: rows.map((s) => shape(s, { bookingId: s.booking_id, bookingStatus: s.booking_status, mentor: mentorOf(s) })) });
}));

router.get('/sessions/:id', handle(async (req, res) => {
  const [[s]] = await pool.query(`${SESSION_SELECT} WHERE s.id = ?`, [Number(req.params.id)]);
  if (!s || (s.mentor_id !== req.user.id && (await isBlocked(req.user.id, s.mentor_id)))) return res.status(404).json({ error: 'not_found' });
  const isMentor = s.mentor_id === req.user.id;
  const [[mine]] = await pool.query('SELECT id, status, note FROM bookings WHERE session_id = ? AND learner_id = ?', [s.id, req.user.id]);
  let bookings;
  if (isMentor) {
    const [rows] = await pool.query(`SELECT b.id, b.status, b.note, b.created_at, u.username, u.full_name, u.avatar_path,
      (SELECT COUNT(*) FROM reviews r WHERE r.booking_id = b.id AND r.reviewer_id = ?) reviewed FROM bookings b JOIN users u ON u.id = b.learner_id WHERE b.session_id = ? ORDER BY b.created_at`, [req.user.id, s.id]);
    bookings = rows.map((b) => ({ id: b.id, status: b.status, note: b.note, createdAt: iso(b.created_at), learner: who(b), reviewed: !!b.reviewed }));
  }
  let reviewed = false;
  if (mine) reviewed = !!(await pool.query('SELECT 1 FROM reviews WHERE booking_id = ? AND reviewer_id = ?', [mine.id, req.user.id]))[0][0];
  res.json(shape(s, { mentor: mentorOf(s), isMentor, seatsLeft: Math.max(0, s.capacity - s.seats), myBooking: mine ? { id: mine.id, status: mine.status, note: mine.note, reviewed } : null, bookings }));
}));

// ---------- manage (mentor) ----------
const sessionFor = async (req, conn = pool) => { const [[s]] = await conn.query('SELECT * FROM learning_sessions WHERE id = ? AND mentor_id = ?', [Number(req.params.id), req.user.id]); return s; };
const activeBookers = async (conn, sid) => (await conn.query("SELECT id, learner_id FROM bookings WHERE session_id = ? AND status IN ('requested','awaiting_payment','confirmed')", [sid]))[0];

router.patch('/sessions/:id', handle(async (req, res) => {
  const p = z.object({ title: z.string().trim().min(3).max(120).optional(), description: z.string().trim().max(2000).nullable().optional(), startsAt: z.string().datetime().optional(),
    durationMin: z.number().int().min(15).max(480).optional(), capacity: z.number().int().min(1).max(100).optional(), autoAccept: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const d = p.data; let moved = false, learners = [];
  await inTx(async (conn) => {
    const s = await lockSession(conn, Number(req.params.id));
    if (!s || s.mentor_id !== req.user.id) throw err(404, 'not_found');
    if (s.status !== 'scheduled') throw err(409, 'not_editable');
    const start = d.startsAt ? new Date(d.startsAt) : new Date(s.starts_at), dur = d.durationMin ?? s.duration_min;
    if (d.startsAt && start.getTime() < Date.now() + MIN_LEAD_MS) throw err(400, 'must_be_in_future'); // only when the start moves; editing duration of a running session is fine
    if (d.capacity != null && d.capacity < (await seatsTaken(conn, s.id))) throw err(409, 'capacity_below_bookings');
    if ((d.startsAt || d.durationMin) && (await mentorOverlap(conn, s.mentor_id, start, dur, s.id))) throw err(409, 'overlaps_another_session');
    moved = !!d.startsAt && start.getTime() !== new Date(s.starts_at).getTime();
    await conn.query('UPDATE learning_sessions SET title = ?, description = ?, starts_at = ?, duration_min = ?, capacity = ?, auto_accept = ?, reminder_sent = ? WHERE id = ?',
      [d.title ?? s.title, d.description === undefined ? s.description : d.description, start, dur, d.capacity ?? s.capacity, d.autoAccept ?? s.auto_accept, moved ? false : s.reminder_sent, s.id]);
    if (moved) learners = await activeBookers(conn, s.id);
  });
  for (const b of learners) await notify(b.learner_id, { type: 'session_rescheduled', title: 'A session you booked was rescheduled', body: `New time: ${new Date(d.startsAt).toUTCString()}`, link: `/sessions/${req.params.id}` });
  res.json({ ok: true });
}));

router.post('/sessions/:id/cancel', handle(async (req, res) => {
  const p = z.object({ reason: z.string().trim().max(300).optional() }).safeParse(req.body || {}); if (!p.success) return bad(res, p.error);
  let learners = [], title;
  await inTx(async (conn) => {
    const s = await lockSession(conn, Number(req.params.id));
    if (!s || s.mentor_id !== req.user.id) throw err(404, 'not_found');
    if (s.status !== 'scheduled') throw err(409, 'not_cancellable');
    title = s.title; learners = await activeBookers(conn, s.id);
    await conn.query("UPDATE learning_sessions SET status = 'cancelled', cancel_reason = ? WHERE id = ?", [p.data.reason || null, s.id]);
    await conn.query("UPDATE bookings SET status = 'cancelled' WHERE session_id = ? AND status IN ('requested','awaiting_payment','confirmed')", [s.id]);
  });
  for (const b of learners) {
    await refundForBooking(b.id, { reason: 'Session cancelled by the mentor', initiatedBy: 'mentor' }); // paid learners always get everything back
    await notify(b.learner_id, { type: 'session_cancelled', title: `“${title}” was cancelled`, body: p.data.reason || null, link: `/sessions/${req.params.id}` });
  }
  res.json({ ok: true });
}));

router.post('/sessions/:id/complete', handle(async (req, res) => {
  let learners = [], title;
  await inTx(async (conn) => {
    const s = await lockSession(conn, Number(req.params.id));
    if (!s || s.mentor_id !== req.user.id) throw err(404, 'not_found');
    if (s.status !== 'scheduled') throw err(409, 'not_completable');
    if (new Date(s.starts_at).getTime() > Date.now()) throw err(409, 'not_started_yet');
    title = s.title;
    learners = (await conn.query("SELECT learner_id FROM bookings WHERE session_id = ? AND status = 'confirmed'", [s.id]))[0];
    await conn.query("UPDATE bookings SET status = 'completed' WHERE session_id = ? AND status = 'confirmed'", [s.id]);
    await conn.query("UPDATE bookings SET status = 'cancelled' WHERE session_id = ? AND status IN ('requested','awaiting_payment')", [s.id]); // never confirmed => never attended
    await conn.query("UPDATE learning_sessions SET status = 'completed' WHERE id = ?", [s.id]);
  });
  for (const b of learners) await notify(b.learner_id, { type: 'session_completed', title: `“${title}” is complete`, body: 'How did it go? Leave a review.', link: `/sessions/${req.params.id}` });
  res.json({ ok: true });
}));

// ---------- booking (learner) ----------
router.post('/sessions/:id/book', handle(async (req, res) => {
  const p = z.object({ note: z.string().trim().max(300).optional() }).safeParse(req.body || {}); if (!p.success) return bad(res, p.error);
  let status, mentorId, title;
  await inTx(async (conn) => {
    const s = await lockSession(conn, Number(req.params.id)); // row lock serialises concurrent bookings for this session
    if (!s || (await isBlocked(req.user.id, s.mentor_id))) throw err(404, 'not_found');
    if (s.mentor_id === req.user.id) throw err(400, 'cannot_book_own_session');
    if (s.status !== 'scheduled' || new Date(s.starts_at).getTime() <= Date.now()) throw err(409, 'not_bookable');
    const [[existing]] = await conn.query('SELECT id, status FROM bookings WHERE session_id = ? AND learner_id = ? FOR UPDATE', [s.id, req.user.id]);
    if (existing && !['cancelled'].includes(existing.status)) throw err(409, existing.status === 'rejected' ? 'previously_declined' : 'already_booked');
    if ((await seatsTaken(conn, s.id)) >= s.capacity) throw err(409, 'full');
    status = s.auto_accept ? (s.pricing === 'free' ? 'confirmed' : 'awaiting_payment') : 'requested';
    if (existing) await conn.query('UPDATE bookings SET status = ?, note = ? WHERE id = ?', [status, p.data.note || null, existing.id]);
    else await conn.query('INSERT INTO bookings (session_id, learner_id, status, note) VALUES (?,?,?,?)', [s.id, req.user.id, status, p.data.note || null]);
    mentorId = s.mentor_id; title = s.title;
  });
  await notify(mentorId, { type: status === 'requested' ? 'booking_request' : 'booking_confirmed', title: status === 'requested' ? `${req.user.full_name} requested “${title}”` : `${req.user.full_name} joined “${title}”`, body: p.data.note || null, link: `/sessions/${req.params.id}` });
  if (status !== 'requested') await notify(req.user.id, { type: status === 'confirmed' ? 'booking_confirmed' : 'booking_awaiting_payment', title: status === 'confirmed' ? `You're booked: “${title}”` : `Complete payment to secure “${title}”`, link: `/sessions/${req.params.id}` });
  res.status(201).json({ status });
}));

async function loadBookingFor(conn, id, user, role) {
  const [[b]] = await conn.query('SELECT b.*, s.mentor_id, s.title, s.status s_status, s.starts_at, s.pricing, s.capacity FROM bookings b JOIN learning_sessions s ON s.id = b.session_id WHERE b.id = ? FOR UPDATE', [id]);
  if (!b) return null;
  if (role === 'mentor' && b.mentor_id !== user.id) return null;
  if (role === 'learner' && b.learner_id !== user.id) return null;
  return b;
}

router.post('/bookings/:id/accept', handle(async (req, res) => {
  let b, status;
  await inTx(async (conn) => {
    const peek = (await conn.query('SELECT session_id FROM bookings WHERE id = ?', [Number(req.params.id)]))[0][0];
    if (!peek) throw err(404, 'not_found');
    await lockSession(conn, peek.session_id); // same lock order as booking: session first
    b = await loadBookingFor(conn, Number(req.params.id), req.user, 'mentor');
    if (!b) throw err(404, 'not_found');
    if (b.status !== 'requested' || b.s_status !== 'scheduled') throw err(409, 'not_pending');
    if ((await seatsTaken(conn, b.session_id)) >= b.capacity) throw err(409, 'full'); // capacity is enforced under the lock, not by the UI
    status = b.pricing === 'free' ? 'confirmed' : 'awaiting_payment';
    await conn.query('UPDATE bookings SET status = ? WHERE id = ?', [status, b.id]);
  });
  await notify(b.learner_id, { type: status === 'confirmed' ? 'booking_confirmed' : 'booking_awaiting_payment', title: status === 'confirmed' ? `You're booked: “${b.title}”` : `Accepted: complete payment to secure “${b.title}”`, link: `/sessions/${b.session_id}` });
  res.json({ status });
}));

router.post('/bookings/:id/reject', handle(async (req, res) => {
  let b;
  await inTx(async (conn) => {
    b = await loadBookingFor(conn, Number(req.params.id), req.user, 'mentor');
    if (!b) throw err(404, 'not_found');
    if (b.status !== 'requested') throw err(409, 'not_pending');
    await conn.query("UPDATE bookings SET status = 'rejected' WHERE id = ?", [b.id]);
  });
  await notify(b.learner_id, { type: 'booking_rejected', title: `Your request for “${b.title}” was declined`, link: `/sessions/${b.session_id}` });
  res.json({ ok: true });
}));

// the learner cancels their own booking, or the mentor removes one (any time before the session is over)
router.post('/bookings/:id/cancel', handle(async (req, res) => {
  let b, byMentor;
  await inTx(async (conn) => {
    b = await loadBookingFor(conn, Number(req.params.id), req.user, null);
    if (!b || (b.learner_id !== req.user.id && b.mentor_id !== req.user.id)) throw err(404, 'not_found');
    byMentor = b.mentor_id === req.user.id;
    if (!['requested', 'awaiting_payment', 'confirmed'].includes(b.status) || b.s_status !== 'scheduled') throw err(409, 'not_cancellable');
    await conn.query("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [b.id]);
  });
  let refund = null;
  if (byMentor) { await refundForBooking(b.id, { reason: 'Removed from the session by the mentor', initiatedBy: 'mentor' }); if (b.pricing === 'paid') refund = { refunded: true }; }
  else if (b.status === 'confirmed' && b.pricing === 'paid') refund = await refundForLearnerCancel(b.id, b.starts_at); // paid? the policy decides; free bookings have nothing to refund
  await notify(byMentor ? b.learner_id : b.mentor_id, { type: 'booking_cancelled', title: byMentor ? `Your booking for “${b.title}” was cancelled by the mentor` : `${req.user.full_name} cancelled their booking for “${b.title}”`, link: `/sessions/${b.session_id}` });
  res.json({ ok: true, refund });
}));

// ---------- reviews ----------
router.post('/bookings/:id/review', handle(async (req, res) => {
  const p = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  let reviewee, role;
  await inTx(async (conn) => {
    const [[b]] = await conn.query('SELECT b.*, s.mentor_id, s.status s_status FROM bookings b JOIN learning_sessions s ON s.id = b.session_id WHERE b.id = ?', [Number(req.params.id)]);
    if (!b || (b.learner_id !== req.user.id && b.mentor_id !== req.user.id)) throw err(404, 'not_found');
    if (b.status !== 'completed' || b.s_status !== 'completed') throw err(409, 'not_reviewable'); // only people who actually took part, after it happened
    reviewee = b.learner_id === req.user.id ? b.mentor_id : b.learner_id;
    role = reviewee === b.mentor_id ? 'mentor' : 'learner';
    try { await conn.query('INSERT INTO reviews (booking_id, reviewer_id, reviewee_id, reviewee_role, rating, comment) VALUES (?,?,?,?,?,?)', [b.id, req.user.id, reviewee, role, p.data.rating, p.data.comment || null]); }
    catch (e) { if (e.code === 'ER_DUP_ENTRY') throw err(409, 'already_reviewed'); throw e; }
    if (role === 'mentor') // Mentor reputation only: being a good Learner must not move a Mentor's rating or ranking
      await conn.query("UPDATE users SET rating_avg = (SELECT AVG(rating) FROM reviews WHERE reviewee_id = ? AND reviewee_role = 'mentor'), rating_count = (SELECT COUNT(*) FROM reviews WHERE reviewee_id = ? AND reviewee_role = 'mentor') WHERE id = ?", [reviewee, reviewee, reviewee]);
  });
  const [[rv]] = await pool.query('SELECT username FROM users WHERE id = ?', [reviewee]); const revieweeName = rv.username; // link to your own profile, where the review is shown
  await notify(reviewee, { type: 'review_received', title: `${req.user.full_name} left you a ${p.data.rating}★ review`, link: `/u/${revieweeName}` });
  res.status(201).json({ ok: true });
}));

router.get('/users/:username/reviews', handle(async (req, res) => {
  const [[u]] = await pool.query("SELECT id, rating_avg, rating_count FROM users WHERE username = ? AND status = 'active'", [String(req.params.username).toLowerCase()]);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const list = async (role) => {
    const [rows] = await pool.query(`SELECT r.id, r.rating, r.comment, r.created_at, s.title, a.username, a.full_name, a.avatar_path FROM reviews r JOIN users a ON a.id = r.reviewer_id
      JOIN bookings b ON b.id = r.booking_id JOIN learning_sessions s ON s.id = b.session_id WHERE r.reviewee_id = ? AND r.reviewee_role = ? ORDER BY r.id DESC LIMIT 50`, [u.id, role]);
    return rows.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, createdAt: iso(r.created_at), sessionTitle: r.title, reviewer: who(r) }));
  };
  const [[la]] = await pool.query("SELECT AVG(rating) avg, COUNT(*) n FROM reviews WHERE reviewee_id = ? AND reviewee_role = 'learner'", [u.id]);
  // top level = as a Mentor (what ranking uses); asLearner = reputation as a Learner, kept separate
  res.json({ avg: u.rating_avg == null ? null : Number(u.rating_avg), count: u.rating_count, reviews: await list('mentor'),
    asLearner: { avg: la.avg == null ? null : Number(la.avg), count: la.n, reviews: await list('learner') } });
}));

// ---------- reminders (called on a timer by index.js) ----------
export async function sendReminders() {
  const [due] = await pool.query("SELECT id, mentor_id, title FROM learning_sessions WHERE status = 'scheduled' AND reminder_sent = FALSE AND starts_at > NOW() AND starts_at <= DATE_ADD(NOW(), INTERVAL 30 MINUTE)");
  for (const s of due) {
    const [r] = await pool.query('UPDATE learning_sessions SET reminder_sent = TRUE WHERE id = ? AND reminder_sent = FALSE', [s.id]); // claim: two app instances won't both notify
    if (!r.affectedRows) continue;
    const [learners] = await pool.query("SELECT learner_id FROM bookings WHERE session_id = ? AND status = 'confirmed'", [s.id]);
    for (const id of [s.mentor_id, ...learners.map((l) => l.learner_id)]) await notify(id, { type: 'session_reminder', title: `Starting soon: “${s.title}”`, link: `/sessions/${s.id}` });
  }
  return due.length;
}
