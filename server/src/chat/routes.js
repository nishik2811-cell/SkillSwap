import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { pool } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { UPLOAD_DIR } from '../people/routes.js';
import { notify } from '../notify.js';
import { emitToConversation, emitToUser, joinConversation, leaveConversation, isOnline } from '../realtime.js';

export const router = Router();
router.use(['/conversations', '/attachments'], requireAuth);
// Non-numeric ids are simply "not found", never a SQL error.
for (const name of ['id', 'mid']) router.param(name, (req, res, next, v) => (/^\d{1,18}$/.test(v) ? next() : res.status(404).json({ error: 'not_found' })));
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const bad = (res, err) => res.status(400).json({ error: 'invalid_input', details: err.flatten().fieldErrors });
const cid = (req) => Number(req.params.id);

// Attachment allow-list: extension is derived from our table, never from the client's file name.
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt', 'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx' };
const CHAT_DIR = UPLOAD_DIR + 'chat/';
const upload = multer({ dest: UPLOAD_DIR + 'tmp/', limits: { fileSize: 10 * 1024 * 1024, files: 5 }, fileFilter: (_r, f, cb) => cb(null, f.mimetype in TYPES) });
const sendLimit = process.env.NODE_ENV === 'test' ? (_q, _s, n) => n() : rateLimit({ windowMs: 60_000, limit: 60, keyGenerator: (req) => String(req.user?.id), standardHeaders: true, legacyHeaders: false });

// ---------- helpers ----------
async function membership(conversationId, userId) {
  const [[m]] = await pool.query('SELECT m.*, c.type, c.title FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id WHERE m.conversation_id = ? AND m.user_id = ?', [conversationId, userId]);
  return m;
}
const areConnected = async (a, b) => !!(await pool.query("SELECT 1 FROM connections WHERE user_lo = LEAST(?,?) AND user_hi = GREATEST(?,?) AND status = 'accepted'", [a, b, a, b]))[0][0];
const hasBlock = async (a, b) => !!(await pool.query('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', [a, b, b, a]))[0][0];
const canChatWith = async (a, b) => (await areConnected(a, b)) && !(await hasBlock(a, b));
const userByName = async (u) => (await pool.query("SELECT id, username, full_name, avatar_path FROM users WHERE username = ? AND status = 'active' AND email_verified_at IS NOT NULL", [String(u).toLowerCase()]))[0][0];
const who = (u) => ({ username: u.username, fullName: u.full_name, avatarUrl: u.avatar_path && `/uploads/${u.avatar_path}` });

async function shapeMessages(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [att] = await pool.query('SELECT * FROM attachments WHERE message_id IN (?)', [ids]);
  const [senders] = await pool.query('SELECT id, username, full_name, avatar_path FROM users WHERE id IN (?)', [[...new Set(rows.map((r) => r.sender_id))]]);
  const sMap = new Map(senders.map((s) => [s.id, who(s)]));
  return rows.map((r) => ({
    id: r.id, conversationId: r.conversation_id, kind: r.kind, sender: sMap.get(r.sender_id), createdAt: r.created_at,
    body: r.deleted_at ? null : r.body, deleted: !!r.deleted_at,
    attachments: r.deleted_at ? [] : att.filter((a) => a.message_id === r.id).map((a) => ({ id: a.id, name: a.original_name, mime: a.mime, size: a.size, url: `/api/v1/attachments/${a.id}` })),
  }));
}
async function systemMessage(conn, conversationId, senderId, text) {
  const [r] = await conn.query("INSERT INTO messages (conversation_id, sender_id, kind, body) VALUES (?,?,'system',?)", [conversationId, senderId, text]);
  await conn.query('UPDATE conversations SET last_message_at = NOW() WHERE id = ?', [conversationId]);
  return r.insertId;
}
async function broadcastNew(messageId) {
  const [[row]] = await pool.query('SELECT * FROM messages WHERE id = ?', [messageId]);
  const [msg] = await shapeMessages([row]);
  emitToConversation(row.conversation_id, 'message', msg);
  return msg;
}

// ---------- list / create ----------
router.get('/conversations', wrap(async (req, res) => {
  const me = req.user.id;
  const [convs] = await pool.query(
    `SELECT c.id, c.type, c.title, c.last_message_at, c.created_at, m.last_read_message_id,
       (SELECT COUNT(*) FROM messages x WHERE x.conversation_id = c.id AND x.id > COALESCE(m.last_read_message_id, 0) AND x.sender_id <> ? AND x.kind = 'text' AND x.deleted_at IS NULL) unread,
       (SELECT MAX(x.id) FROM messages x WHERE x.conversation_id = c.id) last_id
     FROM conversation_members m JOIN conversations c ON c.id = m.conversation_id WHERE m.user_id = ?
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`, [me, me]);
  if (!convs.length) return res.json({ conversations: [], unread: 0 });
  const [members] = await pool.query(
    `SELECT m.conversation_id, m.role, m.last_read_message_id, u.id, u.username, u.full_name, u.avatar_path, u.last_active_at FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id IN (?)`, [convs.map((c) => c.id)]);
  const lastIds = convs.map((c) => c.last_id).filter(Boolean);
  const lastMsgs = new Map((await shapeMessages(lastIds.length ? (await pool.query('SELECT * FROM messages WHERE id IN (?)', [lastIds]))[0] : [])).map((m) => [m.id, m]));
  const out = convs.map((c) => {
    const ms = members.filter((m) => m.conversation_id === c.id);
    const other = c.type === 'direct' ? ms.find((m) => m.id !== me) : null;
    return { id: c.id, type: c.type, title: c.type === 'direct' ? other?.full_name : c.title, unread: c.unread, lastMessage: lastMsgs.get(c.last_id) || null,
      lastMessageAt: c.last_message_at || c.created_at, memberCount: ms.length,
      with: other ? { ...who(other), online: isOnline(other.id), lastActiveAt: other.last_active_at } : null };
  });
  res.json({ conversations: out, unread: out.reduce((n, c) => n + Number(c.unread), 0) });
}));

const createSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('direct'), username: z.string().min(1).max(40) }),
  z.object({ type: z.literal('group'), title: z.string().trim().min(1).max(80), usernames: z.array(z.string().min(1).max(40)).min(1).max(49) }),
]);
router.post('/conversations', wrap(async (req, res) => {
  const p = createSchema.safeParse(req.body); if (!p.success) return bad(res, p.error);
  const me = req.user.id;
  if (p.data.type === 'direct') {
    const t = await userByName(p.data.username);
    if (!t || t.id === me || !(await canChatWith(me, t.id))) return res.status(403).json({ error: 'cannot_message' });
    const key = `${Math.min(me, t.id)}:${Math.max(me, t.id)}`;
    const find = async () => (await pool.query('SELECT id FROM conversations WHERE direct_key = ?', [key]))[0][0];
    let row = await find(), created = false;
    if (!row) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [r] = await conn.query("INSERT INTO conversations (type, created_by, direct_key) VALUES ('direct', ?, ?)", [me, key]);
        await conn.query('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?,?,?), (?,?,?)', [r.insertId, me, 'member', r.insertId, t.id, 'member']);
        await conn.commit(); row = { id: r.insertId }; created = true;
      } catch (e) { await conn.rollback(); if (e.code !== 'ER_DUP_ENTRY') throw e; row = await find(); } finally { conn.release(); }
    }
    if (created) { joinConversation([me, t.id], row.id); emitToUser(t.id, 'conversations_changed', {}); }
    return res.status(created ? 201 : 200).json({ id: row.id });
  }
  const names = [...new Set(p.data.usernames.map((u) => u.toLowerCase()))].filter((u) => u !== req.user.username);
  const users = await Promise.all(names.map(userByName));
  const rejects = names.filter((_, i) => !users[i]);
  for (const u of users.filter(Boolean)) if (!(await canChatWith(me, u.id))) rejects.push(u.username);
  if (rejects.length || !names.length) return res.status(400).json({ error: 'not_connected', usernames: rejects });
  const conn = await pool.getConnection(); let id;
  try {
    await conn.beginTransaction();
    [{ insertId: id }] = await conn.query("INSERT INTO conversations (type, title, created_by) VALUES ('group', ?, ?)", [p.data.title, me]);
    await conn.query('INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ?', [[[id, me, 'admin'], ...users.map((u) => [id, u.id, 'member'])]]);
    await systemMessage(conn, id, me, `${req.user.full_name} created the group`);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  joinConversation([me, ...users.map((u) => u.id)], id);
  for (const u of users) { await notify(u.id, { type: 'group_invite', title: `${req.user.full_name} added you to “${p.data.title}”`, link: `/messages/${id}` }); emitToUser(u.id, 'conversations_changed', {}); }
  res.status(201).json({ id });
}));

// ---------- one conversation ----------
router.get('/conversations/:id', wrap(async (req, res) => {
  const m = await membership(cid(req), req.user.id); if (!m) return res.status(404).json({ error: 'not_found' });
  const [members] = await pool.query('SELECT m.role, m.last_read_message_id, u.username, u.full_name, u.avatar_path, u.id FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ?', [cid(req)]);
  res.json({ id: cid(req), type: m.type, title: m.type === 'group' ? m.title : members.find((x) => x.username !== req.user.username)?.full_name, myRole: m.role,
    members: members.map((x) => ({ ...who(x), role: x.role, lastReadMessageId: x.last_read_message_id, online: isOnline(x.id) })) });
}));

router.get('/conversations/:id/messages', wrap(async (req, res) => {
  if (!(await membership(cid(req), req.user.id))) return res.status(404).json({ error: 'not_found' });
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER, limit = Math.min(Number(req.query.limit) || 30, 100);
  const [rows] = await pool.query('SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?', [cid(req), before, limit + 1]);
  const page = rows.slice(0, limit).reverse();
  res.json({ messages: await shapeMessages(page), hasMore: rows.length > limit });
}));

router.post('/conversations/:id/messages', sendLimit, upload.array('files', 5), wrap(async (req, res) => {
  const files = req.files || [], cleanup = () => Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
  const p = z.object({ body: z.string().max(4000).optional() }).safeParse(req.body || {});
  const body = p.success ? (p.data.body || '').trim() : '';
  if (!p.success || (!body && !files.length)) { await cleanup(); return res.status(400).json({ error: 'invalid_input' }); }
  const m = await membership(cid(req), req.user.id);
  if (!m) { await cleanup(); return res.status(404).json({ error: 'not_found' }); }
  if (m.type === 'direct') { // direct chats need a live connection and no block, checked at send time too
    const [[o]] = await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?', [cid(req), req.user.id]);
    if (!o || !(await canChatWith(req.user.id, o.user_id))) { await cleanup(); return res.status(403).json({ error: 'cannot_message' }); }
  }
  await mkdir(CHAT_DIR, { recursive: true });
  const conn = await pool.getConnection(); let id; const stored = [];
  try {
    await conn.beginTransaction();
    [{ insertId: id }] = await conn.query("INSERT INTO messages (conversation_id, sender_id, body) VALUES (?,?,?)", [cid(req), req.user.id, body || null]);
    for (const f of files) {
      const name = `${randomBytes(16).toString('hex')}.${TYPES[f.mimetype]}`;
      await rename(f.path, CHAT_DIR + name); stored.push(CHAT_DIR + name);
      await conn.query('INSERT INTO attachments (message_id, original_name, stored_path, mime, size) VALUES (?,?,?,?,?)', [id, Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 200), `chat/${name}`, f.mimetype, f.size]);
    }
    await conn.query('UPDATE conversations SET last_message_at = NOW() WHERE id = ?', [cid(req)]);
    await conn.query('UPDATE conversation_members SET last_read_message_id = ? WHERE conversation_id = ? AND user_id = ?', [id, cid(req), req.user.id]); // my own message is read by me
    await conn.commit();
  } catch (e) { await conn.rollback(); await Promise.all(stored.map((s) => unlink(s).catch(() => {}))); await cleanup(); throw e; } finally { conn.release(); }
  const msg = await broadcastNew(id);
  // one persistent notification per conversation until it is read, so a busy chat doesn't flood the bell
  const [others] = await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?', [cid(req), req.user.id]);
  for (const o of others) {
    const link = `/messages/${cid(req)}`;
    const [[dup]] = await pool.query("SELECT 1 x FROM notifications WHERE user_id = ? AND type = 'message' AND link = ? AND read_at IS NULL", [o.user_id, link]);
    if (!dup) await notify(o.user_id, { type: 'message', title: `New message from ${req.user.full_name}`, body: m.type === 'group' ? m.title : null, link });
  }
  res.status(201).json(msg);
}));

router.delete('/conversations/:id/messages/:mid', wrap(async (req, res) => {
  const [r] = await pool.query("UPDATE messages SET deleted_at = NOW() WHERE id = ? AND conversation_id = ? AND sender_id = ? AND kind = 'text' AND deleted_at IS NULL", [Number(req.params.mid), cid(req), req.user.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'not_found' });
  emitToConversation(cid(req), 'message_deleted', { conversationId: cid(req), id: Number(req.params.mid) });
  res.json({ ok: true });
}));

router.post('/conversations/:id/read', wrap(async (req, res) => {
  const p = z.object({ messageId: z.number().int().positive() }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  if (!(await membership(cid(req), req.user.id))) return res.status(404).json({ error: 'not_found' });
  const [[mx]] = await pool.query('SELECT MAX(id) mx FROM messages WHERE conversation_id = ?', [cid(req)]);
  const upTo = Math.min(p.data.messageId, mx.mx || 0); // cannot "read" messages that don't exist yet
  await pool.query('UPDATE conversation_members SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), ?) WHERE conversation_id = ? AND user_id = ?', [upTo, cid(req), req.user.id]);
  await pool.query("UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND type = 'message' AND link = ? AND read_at IS NULL", [req.user.id, `/messages/${cid(req)}`]);
  emitToConversation(cid(req), 'read', { conversationId: cid(req), username: req.user.username, messageId: upTo });
  res.json({ ok: true });
}));

// ---------- group management ----------
const adminOf = async (req) => { const m = await membership(cid(req), req.user.id); return m && m.type === 'group' && m.role === 'admin' ? m : null; };

router.patch('/conversations/:id', wrap(async (req, res) => {
  const p = z.object({ title: z.string().trim().min(1).max(80) }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  if (!(await adminOf(req))) return res.status(403).json({ error: 'forbidden' });
  await pool.query('UPDATE conversations SET title = ? WHERE id = ?', [p.data.title, cid(req)]);
  emitToConversation(cid(req), 'conversation_updated', { id: cid(req), title: p.data.title });
  res.json({ ok: true });
}));

router.post('/conversations/:id/members', wrap(async (req, res) => {
  const p = z.object({ usernames: z.array(z.string().min(1).max(40)).min(1).max(20) }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  const m = await adminOf(req); if (!m) return res.status(403).json({ error: 'forbidden' });
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM conversation_members WHERE conversation_id = ?', [cid(req)]);
  const users = await Promise.all([...new Set(p.data.usernames.map((u) => u.toLowerCase()))].map(userByName));
  if (users.some((u) => !u) || n + users.length > 50) return res.status(400).json({ error: 'invalid_input' });
  const rejects = [];
  for (const u of users) if (!(await canChatWith(req.user.id, u.id))) rejects.push(u.username);
  if (rejects.length) return res.status(400).json({ error: 'not_connected', usernames: rejects });
  const conn = await pool.getConnection(); const added = [], sysIds = [];
  try {
    await conn.beginTransaction();
    for (const u of users) { const [r] = await conn.query('INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?,?)', [cid(req), u.id]); if (r.affectedRows) added.push(u); }
    for (const u of added) sysIds.push(await systemMessage(conn, cid(req), req.user.id, `${req.user.full_name} added ${u.full_name}`));
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  joinConversation(added.map((u) => u.id), cid(req));
  for (const id of sysIds) await broadcastNew(id);
  for (const u of added) { await notify(u.id, { type: 'group_invite', title: `${req.user.full_name} added you to “${m.title}”`, link: `/messages/${cid(req)}` }); emitToUser(u.id, 'conversations_changed', {}); }
  res.json({ added: added.map((u) => u.username) });
}));

// admin removes someone, or any member leaves (username = their own)
router.delete('/conversations/:id/members/:username', wrap(async (req, res) => {
  const mine = await membership(cid(req), req.user.id);
  if (!mine || mine.type !== 'group') return res.status(404).json({ error: 'not_found' });
  const target = await userByName(req.params.username); if (!target) return res.status(404).json({ error: 'not_found' });
  const self = target.id === req.user.id;
  if (!self && mine.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [cid(req), target.id]);
    if (!r.affectedRows) { await conn.rollback(); return res.status(404).json({ error: 'not_found' }); }
    const [[left]] = await conn.query('SELECT COUNT(*) n, COUNT(*) FILTER (WHERE role = \'admin\') admins FROM conversation_members WHERE conversation_id = ?', [cid(req)]);
    if (left.n === 0) await conn.query('DELETE FROM conversations WHERE id = ?', [cid(req)]);
    else {
      if (!Number(left.admins)) await conn.query("UPDATE conversation_members SET role = 'admin' WHERE (conversation_id, user_id) = (SELECT conversation_id, user_id FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at LIMIT 1)", [cid(req)]); // never leave a group without an admin
      await systemMessage(conn, cid(req), req.user.id, self ? `${req.user.full_name} left` : `${req.user.full_name} removed ${target.full_name}`);
    }
    await conn.commit();
    if (left.n) { const [[sys]] = await pool.query("SELECT MAX(id) id FROM messages WHERE conversation_id = ?", [cid(req)]); await broadcastNew(sys.id); }
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  leaveConversation(target.id, cid(req)); emitToUser(target.id, 'conversations_changed', {});
  res.json({ ok: true });
}));

// ---------- attachments: served only to conversation members ----------
router.get('/attachments/:id', wrap(async (req, res) => {
  const [[a]] = await pool.query('SELECT a.*, m.conversation_id, m.deleted_at FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = ?', [Number(req.params.id)]);
  if (!a || a.deleted_at || !(await membership(a.conversation_id, req.user.id))) return res.status(404).json({ error: 'not_found' });
  res.type(a.mime).set('Cache-Control', 'private, max-age=3600');
  if (!a.mime.startsWith('image/')) res.attachment(a.original_name);
  res.sendFile(UPLOAD_DIR + a.stored_path);
}));
