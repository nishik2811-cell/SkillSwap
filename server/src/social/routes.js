import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { notify } from '../notify.js';

export const router = Router();
router.use(['/connections', '/relationship', '/blocks', '/reports', '/notifications'], requireAuth); // scoped so unknown paths still 404
// Non-numeric ids are simply "not found", never a SQL error.
for (const name of ['id', 'mid']) router.param(name, (req, res, next, v) => (/^\d{1,18}$/.test(v) ? next() : res.status(404).json({ error: 'not_found' })));
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const bad = (res, err) => res.status(400).json({ error: 'invalid_input', details: err.flatten().fieldErrors });
const MAX_PENDING_SENT = 50;

const findUser = async (username) => (await pool.query(
  "SELECT id, username, full_name, avatar_path FROM users WHERE username = ? AND status = 'active' AND email_verified_at IS NOT NULL", [String(username).toLowerCase()]))[0][0];
const isBlocked = async (a, b) => !!(await pool.query(
  'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1', [a, b, b, a]))[0][0];
const person = (u, p = '') => ({ username: u[p + 'username'], fullName: u[p + 'full_name'], avatarUrl: u[p + 'avatar_path'] && `/uploads/${u[p + 'avatar_path']}` });
const myName = (req) => req.user.full_name;

// ---------- connections ----------
router.post('/connections', wrap(async (req, res) => {
  const p = z.object({ username: z.string().min(1).max(40), message: z.string().trim().max(300).optional() }).safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const me = req.user.id, t = await findUser(p.data.username);
  if (!t || (await isBlocked(me, t.id))) return res.status(404).json({ error: 'not_found' }); // never reveal blocks
  if (t.id === me) return res.status(400).json({ error: 'cannot_connect_to_self' });
  const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM connections WHERE requester_id = ? AND status = 'pending'", [me]);
  if (n >= MAX_PENDING_SENT) return res.status(429).json({ error: 'too_many_pending_requests' });

  const sendRequestNotice = () => notify(t.id, { type: 'connection_request', title: `${myName(req)} wants to connect`, body: p.data.message || null, link: '/connections' });
  try {
    const [r] = await pool.query('INSERT INTO connections (requester_id, addressee_id, message) VALUES (?,?,?)', [me, t.id, p.data.message || null]);
    await sendRequestNotice();
    return res.status(201).json({ id: r.insertId, status: 'pending' });
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
  }
  // a row for this pair already exists (one per pair is a DB constraint)
  const [[row]] = await pool.query('SELECT * FROM connections WHERE user_lo = LEAST(?,?) AND user_hi = GREATEST(?,?)', [me, t.id, me, t.id]);
  if (row.status === 'accepted') return res.status(409).json({ error: 'already_connected' });
  if (row.status === 'pending') {
    if (row.requester_id === me) return res.status(409).json({ error: 'already_requested' });
    // they already asked me: sending a request back means "yes"
    const [u] = await pool.query("UPDATE connections SET status = 'accepted', responded_at = NOW() WHERE id = ? AND status = 'pending'", [row.id]);
    if (u.affectedRows) await notify(t.id, { type: 'connection_accepted', title: `${myName(req)} accepted your request`, link: `/u/${req.user.username}` });
    return res.json({ id: row.id, status: 'accepted' });
  }
  if (row.requester_id === me) return res.status(409).json({ error: 'previously_declined' });
  await pool.query("UPDATE connections SET requester_id = ?, addressee_id = ?, status = 'pending', message = ?, created_at = NOW(), responded_at = NULL WHERE id = ?", [me, t.id, p.data.message || null, row.id]);
  await sendRequestNotice();
  res.status(201).json({ id: row.id, status: 'pending' });
}));

router.get('/connections', wrap(async (req, res) => {
  const me = req.user.id;
  const [rows] = await pool.query(
    `SELECT c.id, c.status, c.message, c.created_at, c.requester_id, o.username, o.full_name, o.avatar_path
     FROM connections c JOIN users o ON o.id = CASE WHEN c.requester_id = ? THEN c.addressee_id ELSE c.requester_id END
     WHERE (c.requester_id = ? OR c.addressee_id = ?) AND c.status <> 'rejected'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = o.id AND b.blocked_id = ?) OR (b.blocker_id = ? AND b.blocked_id = o.id))
     ORDER BY c.created_at DESC`, [me, me, me, me, me]);
  const row = (r) => ({ id: r.id, message: r.message, createdAt: r.created_at, user: person(r) });
  res.json({
    received: rows.filter((r) => r.status === 'pending' && r.requester_id !== me).map(row),
    sent: rows.filter((r) => r.status === 'pending' && r.requester_id === me).map(row),
    connected: rows.filter((r) => r.status === 'accepted').map(row),
  });
}));

const respond = (status) => wrap(async (req, res) => {
  const [r] = await pool.query("UPDATE connections SET status = ?, responded_at = NOW() WHERE id = ? AND addressee_id = ? AND status = 'pending'", [status, Number(req.params.id), req.user.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'not_found' });
  const [[c]] = await pool.query('SELECT requester_id FROM connections WHERE id = ?', [Number(req.params.id)]);
  if (status === 'accepted') await notify(c.requester_id, { type: 'connection_accepted', title: `${myName(req)} accepted your request`, link: `/u/${req.user.username}` });
  else await notify(c.requester_id, { type: 'connection_rejected', title: `${myName(req)} declined your request` });
  res.json({ ok: true, status });
});
router.post('/connections/:id/accept', respond('accepted'));
router.post('/connections/:id/reject', respond('rejected'));

// cancel (my pending request) or remove (accepted, either side)
router.delete('/connections/:id', wrap(async (req, res) => {
  const me = req.user.id;
  const [r] = await pool.query(
    "DELETE FROM connections WHERE id = ? AND ((status = 'pending' AND requester_id = ?) OR (status = 'accepted' AND (requester_id = ? OR addressee_id = ?)))", [Number(req.params.id), me, me, me]);
  if (!r.affectedRows) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
}));

router.get('/relationship/:username', wrap(async (req, res) => {
  const t = await findUser(req.params.username), me = req.user.id;
  if (!t) return res.status(404).json({ error: 'not_found' });
  if (t.id === me) return res.json({ status: 'self' });
  const [[blk]] = await pool.query('SELECT blocker_id FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1', [me, t.id, t.id, me]);
  if (blk) { // someone who has been blocked must not be able to tell: answer exactly as for a missing user
    if (blk.blocker_id !== me) return res.status(404).json({ error: 'not_found' });
    return res.json({ status: 'blocked' });
  }
  const [[c]] = await pool.query('SELECT id, status, requester_id FROM connections WHERE user_lo = LEAST(?,?) AND user_hi = GREATEST(?,?)', [me, t.id, me, t.id]);
  if (!c || c.status === 'rejected') return res.json({ status: 'none', declinedByThem: !!c && c.requester_id === me });
  if (c.status === 'accepted') return res.json({ status: 'connected', connectionId: c.id });
  res.json({ status: c.requester_id === me ? 'pending_sent' : 'pending_received', connectionId: c.id });
}));

// ---------- blocks & reports ----------
router.post('/blocks', wrap(async (req, res) => {
  const p = z.object({ username: z.string().min(1).max(40) }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const t = await findUser(p.data.username);
  if (!t || t.id === req.user.id) return res.status(404).json({ error: 'not_found' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?,?)', [req.user.id, t.id]);
    await conn.query('DELETE FROM connections WHERE user_lo = LEAST(?,?) AND user_hi = GREATEST(?,?)', [req.user.id, t.id, req.user.id, t.id]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  res.json({ ok: true });
}));
router.delete('/blocks/:username', wrap(async (req, res) => {
  const t = await findUser(req.params.username); if (!t) return res.status(404).json({ error: 'not_found' });
  await pool.query('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.id, t.id]);
  res.json({ ok: true });
}));
router.get('/blocks', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT u.username, u.full_name, u.avatar_path FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?', [req.user.id]);
  res.json({ blocked: rows.map((r) => person(r)) });
}));

router.post('/reports', wrap(async (req, res) => {
  const p = z.object({ username: z.string().min(1).max(40), reason: z.enum(['spam', 'harassment', 'inappropriate', 'fake_profile', 'scam', 'other']), details: z.string().trim().max(1000).optional() }).safeParse(req.body);
  if (!p.success) return bad(res, p.error);
  const t = await findUser(p.data.username);
  if (!t || t.id === req.user.id) return res.status(404).json({ error: 'not_found' });
  const [[dup]] = await pool.query("SELECT 1 FROM reports WHERE reporter_id = ? AND target_user_id = ? AND status = 'open'", [req.user.id, t.id]);
  if (dup) return res.status(409).json({ error: 'already_reported' });
  await pool.query('INSERT INTO reports (reporter_id, target_user_id, reason, details) VALUES (?,?,?,?)', [req.user.id, t.id, p.data.reason, p.data.details || null]);
  res.status(201).json({ ok: true });
}));

// ---------- notifications ----------
const note = (n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.read_at, createdAt: n.created_at });
router.get('/notifications', wrap(async (req, res) => {
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER, limit = Math.min(Number(req.query.limit) || 20, 50);
  const [rows] = await pool.query('SELECT * FROM notifications WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?', [req.user.id, before, limit]);
  const [[{ unread }]] = await pool.query('SELECT COUNT(*) unread FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.id]);
  res.json({ notifications: rows.map(note), unread });
}));
router.post('/notifications/read-all', wrap(async (req, res) => {
  await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [req.user.id]);
  res.json({ ok: true });
}));
router.post('/notifications/:id/read', wrap(async (req, res) => {
  await pool.query('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  res.json({ ok: true });
}));
