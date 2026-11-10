import { Router } from 'express';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { pool, inTx } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { notify } from '../notify.js';
import { emitToUser } from '../realtime.js';
import * as lk from './livekit.js';

export const router = Router();
router.use(['/rooms', '/sessions/:id/room'], requireAuth);
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { if (e.http) return res.status(e.http).json({ error: e.message }); next(e); } };
const err = (status, error) => Object.assign(new Error(error), { http: status });
const bad = (res, e) => res.status(400).json({ error: 'invalid_input', details: e.flatten().fieldErrors });
const who = (u) => ({ username: u.username, fullName: u.full_name, avatarUrl: u.avatar_path && `/uploads/${u.avatar_path}` });
const LETTERS = 'abcdefghjkmnpqrstuvwxyz'; // no lookalikes (i, l, o)
const newCode = () => { const g = (n) => Array.from({ length: n }, () => LETTERS[randomInt(LETTERS.length)]).join(''); return `${g(3)}-${g(4)}-${g(3)}`; };
const OPEN_BEFORE_MIN = 15, OPEN_AFTER_MIN = 120; // a session's room accepts people from 15 min before the start until 2 h after the end

async function createRoom(conn, { hostId, title, sessionId = null, waitingRoom = true, startsAt = null }) {
  for (let i = 0; i < 5; i++) {
    await conn.query('SAVEPOINT room_try'); // in PostgreSQL a failed INSERT aborts the whole transaction unless it is rolled back to a savepoint
    try {
      const [r] = await conn.query('INSERT INTO meeting_rooms (code, session_id, host_id, title, waiting_room, scheduled_at) VALUES (?,?,?,?,?,?)', [newCode(), sessionId, hostId, title, waitingRoom, startsAt]);
      await conn.query("INSERT INTO meeting_participants (room_id, user_id, role, status) VALUES (?,?, 'host', 'left')", [r.insertId, hostId]);
      return r.insertId;
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY' || String(e.sqlMessage).includes('uq_room_session')) throw e;
      await conn.query('ROLLBACK TO SAVEPOINT room_try'); // code collision: pick another
    }
  }
  throw err(500, 'could_not_create_room');
}

// ---- rooms ----
router.post('/rooms', wrap(async (req, res) => {
  const p = z.object({ title: z.string().trim().min(1).max(120).default('Meeting'), waitingRoom: z.boolean().default(true), startsAt: z.string().datetime({ offset: true }).optional() }).safeParse(req.body || {}); if (!p.success) return bad(res, p.error);
  const id = await inTx((c) => createRoom(c, { hostId: req.user.id, ...p.data }));
  const [[r]] = await pool.query('SELECT code FROM meeting_rooms WHERE id = ?', [id]);
  res.status(201).json({ code: r.code, link: `${process.env.WEB_ORIGIN}/room/${r.code}` });
}));

// the room for a Learning Session: created on demand by its Mentor
router.post('/sessions/:id/room', wrap(async (req, res) => {
  const [[s]] = await pool.query('SELECT id, mentor_id, title, status FROM learning_sessions WHERE id = ?', [Number(req.params.id)]);
  if (!s) throw err(404, 'not_found');
  if (s.status === 'cancelled') throw err(409, 'session_cancelled');
  if (s.mentor_id !== req.user.id) { // a learner only looks up an EXISTING room, and only with a confirmed booking; they never create one
    const [[ok]] = await pool.query("SELECT r.code FROM meeting_rooms r JOIN bookings b ON b.session_id = r.session_id AND b.learner_id = ? AND b.status IN ('confirmed','completed') WHERE r.session_id = ?", [req.user.id, s.id]);
    if (!ok) throw err(404, 'not_found');
    return res.json({ code: ok.code });
  }
  let [[r]] = await pool.query('SELECT code FROM meeting_rooms WHERE session_id = ?', [s.id]);
  if (!r) { try { await inTx((c) => createRoom(c, { hostId: s.mentor_id, title: s.title, sessionId: s.id, waitingRoom: false })); } catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; } [[r]] = await pool.query('SELECT code FROM meeting_rooms WHERE session_id = ?', [s.id]); }
  res.json({ code: r.code });
}));

const roomByCode = async (code) => (await pool.query('SELECT r.*, s.starts_at, s.duration_min, s.status s_status FROM meeting_rooms r LEFT JOIN learning_sessions s ON s.id = r.session_id WHERE r.code = ?', [String(code).toLowerCase()]))[0][0];
const myPart = async (roomId, userId) => (await pool.query('SELECT * FROM meeting_participants WHERE room_id = ? AND user_id = ?', [roomId, userId]))[0][0];
const isStaff = (p) => p && (p.role === 'host' || p.role === 'cohost');

/** Who may enter a Learning Session's room: its Mentor, and learners whose booking is CONFIRMED (for paid sessions that means the server saw the payment). */
async function sessionAccess(room, userId) {
  if (room.host_id === userId) return true;
  const [[b]] = await pool.query("SELECT 1 x FROM bookings WHERE session_id = ? AND learner_id = ? AND status IN ('confirmed','completed')", [room.session_id, userId]);
  return !!b;
}
function windowOpen(room) {
  if (!room.session_id) return true;
  const start = new Date(room.starts_at).getTime(), end = start + room.duration_min * 60_000;
  return Date.now() >= start - OPEN_BEFORE_MIN * 60_000 && Date.now() <= end + OPEN_AFTER_MIN * 60_000;
}

router.get('/rooms/:code', wrap(async (req, res) => {
  const room = await roomByCode(req.params.code); if (!room) throw err(404, 'not_found');
  const me = await myPart(room.id, req.user.id);
  const [[h]] = await pool.query('SELECT username, full_name, avatar_path FROM users WHERE id = ?', [room.host_id]);
  res.json({ code: room.code, title: room.title, status: room.status, waitingRoom: !!room.waiting_room, sessionId: room.session_id, host: who(h), myRole: me?.role || null, myStatus: me?.status || null,
    canEnterNow: room.status === 'open' && windowOpen(room), opensAt: room.session_id ? new Date(new Date(room.starts_at).getTime() - OPEN_BEFORE_MIN * 60_000).toISOString() : null });
}));

router.post('/rooms/:code/join', wrap(async (req, res) => {
  const room = await roomByCode(req.params.code); if (!room) throw err(404, 'not_found');
  if (room.status === 'ended') throw err(410, 'meeting_ended');
  if (!windowOpen(room)) throw err(403, 'not_open_yet');
  const me = await myPart(room.id, req.user.id), staff = isStaff(me);
  if (me?.status === 'denied' || me?.status === 'removed') throw err(403, 'not_allowed');
  if (room.session_id && !(await sessionAccess(room, req.user.id))) throw err(403, 'not_allowed'); // booking (and payment) decides access, not the client
  if (!lk.configured()) throw err(503, 'meetings_not_configured');

  const needsApproval = !!room.waiting_room && !room.session_id && !staff && me?.status !== 'admitted';
  if (needsApproval) {
    await pool.query("INSERT INTO meeting_participants (room_id, user_id, status) VALUES (?,?, 'waiting') ON CONFLICT (room_id, user_id) DO UPDATE SET status = CASE WHEN meeting_participants.status = 'admitted' THEN meeting_participants.status ELSE 'waiting' END, requested_at = NOW()", [room.id, req.user.id]);
    emitToUser(room.host_id, 'room_waiting', { code: room.code, username: req.user.username, fullName: req.user.full_name });
    return res.json({ status: 'waiting' });
  }
  const role = staff ? me.role : 'participant';
  await pool.query("INSERT INTO meeting_participants (room_id, user_id, role, status, first_joined_at) VALUES (?,?,?, 'admitted', NOW()) ON CONFLICT (room_id, user_id) DO UPDATE SET status = 'admitted', first_joined_at = COALESCE(meeting_participants.first_joined_at, NOW())", [room.id, req.user.id, role]);
  res.json({ status: 'admitted', role, url: lk.publicUrl(), token: await lk.joinToken({ room: room.code, identity: req.user.username, name: req.user.full_name, admin: role !== 'participant' }) });
}));

// ---- host controls ----
const staffOnly = async (req) => {
  const room = await roomByCode(req.params.code); if (!room) throw err(404, 'not_found');
  const me = await myPart(room.id, req.user.id); if (!isStaff(me)) throw err(403, 'forbidden');
  return { room, me };
};
const target = async (room, username) => {
  const [[u]] = await pool.query('SELECT id, username, full_name FROM users WHERE username = ?', [String(username).toLowerCase()]);
  const t = u && await myPart(room.id, u.id); if (!t) throw err(404, 'not_found');
  return { u, t };
};
const body = z.object({ username: z.string().min(1).max(40) });

router.get('/rooms/:code/waiting', wrap(async (req, res) => {
  const { room } = await staffOnly(req);
  const [rows] = await pool.query("SELECT u.username, u.full_name, u.avatar_path, p.requested_at FROM meeting_participants p JOIN users u ON u.id = p.user_id WHERE p.room_id = ? AND p.status = 'waiting' ORDER BY p.requested_at", [room.id]);
  res.json({ waiting: rows.map((r) => ({ ...who(r), requestedAt: r.requested_at })) });
}));
router.post('/rooms/:code/admit', wrap(async (req, res) => {
  const p = body.safeParse(req.body); if (!p.success) return bad(res, p.error);
  const { room } = await staffOnly(req); const { u, t } = await target(room, p.data.username);
  if (t.status !== 'waiting') throw err(409, 'not_waiting');
  await pool.query("UPDATE meeting_participants SET status = 'admitted' WHERE room_id = ? AND user_id = ?", [room.id, u.id]);
  emitToUser(u.id, 'room_admitted', { code: room.code }); await notify(u.id, { type: 'meeting_admitted', title: `You're in: ${room.title}`, link: `/room/${room.code}` });
  res.json({ ok: true });
}));
router.post('/rooms/:code/deny', wrap(async (req, res) => {
  const p = body.safeParse(req.body); if (!p.success) return bad(res, p.error);
  const { room } = await staffOnly(req); const { u, t } = await target(room, p.data.username);
  if (t.status !== 'waiting') throw err(409, 'not_waiting');
  await pool.query("UPDATE meeting_participants SET status = 'denied' WHERE room_id = ? AND user_id = ?", [room.id, u.id]);
  emitToUser(u.id, 'room_denied', { code: room.code }); res.json({ ok: true });
}));
router.post('/rooms/:code/remove', wrap(async (req, res) => {
  const p = body.safeParse(req.body); if (!p.success) return bad(res, p.error);
  const { room, me } = await staffOnly(req); const { u, t } = await target(room, p.data.username);
  if (t.role === 'host' || (t.role === 'cohost' && me.role !== 'host')) throw err(403, 'forbidden'); // only the host removes co-hosts; nobody removes the host
  await pool.query("UPDATE meeting_participants SET status = 'removed' WHERE room_id = ? AND user_id = ?", [room.id, u.id]);
  await lk.removeFromRoom(room.code, u.username); res.json({ ok: true });
}));
router.post('/rooms/:code/mute', wrap(async (req, res) => {
  const p = z.object({ username: z.string().max(40).optional() }).safeParse(req.body || {}); if (!p.success) return bad(res, p.error);
  const { room, me } = await staffOnly(req);
  if (p.data.username) { const { u } = await target(room, p.data.username); await lk.muteParticipant(room.code, u.username); } else await lk.muteAll(room.code, req.user.username);
  res.json({ ok: true });
}));
router.post('/rooms/:code/cohost', wrap(async (req, res) => {
  const p = z.object({ username: z.string().min(1).max(40), cohost: z.boolean() }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const { room, me } = await staffOnly(req); if (me.role !== 'host') throw err(403, 'forbidden');
  const { u, t } = await target(room, p.data.username); if (t.role === 'host') throw err(400, 'invalid_input');
  await pool.query('UPDATE meeting_participants SET role = ? WHERE room_id = ? AND user_id = ?', [p.data.cohost ? 'cohost' : 'participant', room.id, u.id]);
  emitToUser(u.id, 'room_role', { code: room.code, role: p.data.cohost ? 'cohost' : 'participant' }); res.json({ ok: true });
}));
router.post('/rooms/:code/leave', wrap(async (req, res) => {
  const room = await roomByCode(req.params.code); if (!room) throw err(404, 'not_found');
  await pool.query("UPDATE meeting_participants SET status = 'left', last_left_at = NOW() WHERE room_id = ? AND user_id = ? AND status = 'admitted'", [room.id, req.user.id]); res.json({ ok: true });
}));
router.post('/rooms/:code/end', wrap(async (req, res) => {
  const { room, me } = await staffOnly(req); if (me.role !== 'host') throw err(403, 'forbidden');
  await pool.query("UPDATE meeting_rooms SET status = 'ended', ended_at = NOW() WHERE id = ? AND status = 'open'", [room.id]);
  await pool.query("UPDATE meeting_participants SET status = 'left', last_left_at = NOW() WHERE room_id = ? AND status = 'admitted'", [room.id]);
  await lk.endRoom(room.code); res.json({ ok: true });
}));

// ---- history ----
router.get('/rooms', wrap(async (req, res) => {
  const [rows] = await pool.query(`SELECT r.code, r.title, r.status, r.created_at, r.ended_at, r.scheduled_at, r.session_id, p.role FROM meeting_participants p JOIN meeting_rooms r ON r.id = p.room_id
    WHERE p.user_id = ? AND (p.first_joined_at IS NOT NULL OR p.role = 'host') ORDER BY r.created_at DESC LIMIT 50`, [req.user.id]);
  res.json({ rooms: rows.map((r) => ({ code: r.code, title: r.title, status: r.status, role: r.role, sessionId: r.session_id, scheduledAt: r.scheduled_at && new Date(r.scheduled_at).toISOString(), createdAt: new Date(r.created_at).toISOString(), endedAt: r.ended_at && new Date(r.ended_at).toISOString() })) });
}));

// The host or a co-host invites people they are connected with: each gets a notification that opens the room.
router.post('/rooms/:code/invite', wrap(async (req, res) => {
  const p = z.object({ usernames: z.array(z.string().trim().toLowerCase().min(1).max(40)).min(1).max(20) }).safeParse(req.body || {}); if (!p.success) return bad(res, p.error);
  const room = await roomByCode(req.params.code); if (!room) throw err(404, 'not_found');
  if (room.status !== 'open') throw err(409, 'meeting_ended');
  if (!isStaff(await myPart(room.id, req.user.id))) throw err(403, 'not_allowed');
  const [people] = await pool.query(
    `SELECT u.id FROM users u JOIN connections c ON c.user_lo = LEAST(u.id, ?) AND c.user_hi = GREATEST(u.id, ?) AND c.status = 'accepted'
     WHERE u.username IN (?) AND u.status = 'active' AND u.id <> ?
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = ?) OR (b.blocker_id = ? AND b.blocked_id = u.id))`,
    [req.user.id, req.user.id, p.data.usernames, req.user.id, req.user.id, req.user.id]);
  for (const u of people) await notify(u.id, { type: 'meeting_invite', title: `${req.user.full_name} invited you to "${room.title}"`.slice(0, 160), body: 'Tap to join the meeting.', link: `/room/${room.code}` });
  res.json({ sent: people.length });
}));
