import { Server } from 'socket.io';
import { parseCookie } from 'cookie';
import { pool } from './db.js';
import { sha256, verifySocketToken } from './auth/crypto.js';
import { COOKIE } from './auth/middleware.js';

let io = null;
const online = new Map(); // userId -> number of open sockets (one user may have several tabs)
const chosen = new Map(); // userId -> the status they picked ('online' | 'away' | 'busy' | 'invisible'), for connected users
export const isOnline = (userId) => online.has(userId);
/** What others see: the picked status while connected, null (offline) otherwise. Invisible looks offline. */
export const presenceOf = (userId) => { const s = chosen.get(userId) || 'online'; return online.has(userId) && s !== 'invisible' ? s : null; };

async function coMembers(userId) {
  const [rows] = await pool.query('SELECT DISTINCT b.user_id FROM conversation_members a JOIN conversation_members b ON b.conversation_id = a.conversation_id WHERE a.user_id = ? AND b.user_id <> ?', [userId, userId]);
  return rows.map((r) => r.user_id);
}
async function broadcastPresence(userId, username) {
  const status = presenceOf(userId);
  for (const id of await coMembers(userId)) io.to(`user:${id}`).emit('presence', { username, online: !!status, status, at: new Date().toISOString() });
}
/** The person picked a new status: remember it and tell the people they chat with. */
export function setStatus(userId, username, status) {
  chosen.set(userId, status);
  if (io && online.has(userId)) broadcastPresence(userId, username).catch(() => {});
}

export function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: process.env.WEB_ORIGIN, credentials: true } });
  io.use(async (socket, next) => {
    try {
      // Cross-origin (website and API on different hosts): a signed token from /auth/socket-token. Same-origin dev: the session cookie.
      const tokenUid = socket.handshake.auth?.token ? verifySocketToken(socket.handshake.auth.token) : null;
      if (socket.handshake.auth?.token && !tokenUid) return next(new Error('unauthenticated'));
      const sid = tokenUid ? null : parseCookie(socket.handshake.headers.cookie || '')[COOKIE];
      const [[u]] = tokenUid
        ? await pool.query("SELECT id, username, presence_status FROM users WHERE id = ? AND status = 'active'", [tokenUid])
        : sid ? await pool.query(
          `SELECT u.id, u.username, u.presence_status FROM auth_sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.status = 'active'`, [sha256(sid)]) : [[]];
      if (!u) return next(new Error('unauthenticated'));
      socket.data.userId = u.id; socket.data.username = u.username; chosen.set(u.id, u.presence_status || 'online');
      next();
    } catch (e) { next(e); }
  });
  io.on('connection', async (socket) => {
    const { userId, username } = socket.data;
    socket.join(`user:${userId}`);
    const [convs] = await pool.query('SELECT conversation_id FROM conversation_members WHERE user_id = ?', [userId]);
    convs.forEach((c) => socket.join(`conv:${c.conversation_id}`));
    online.set(userId, (online.get(userId) || 0) + 1);
    if (online.get(userId) === 1) broadcastPresence(userId, username).catch(() => {});

    // Typing is ephemeral: relayed only into rooms this socket really belongs to, never stored.
    socket.on('typing', ({ conversationId, typing } = {}) => {
      const room = `conv:${Number(conversationId)}`;
      if (socket.rooms.has(room)) socket.to(room).emit('typing', { conversationId: Number(conversationId), username, typing: !!typing });
    });
    socket.on('disconnect', () => {
      const n = (online.get(userId) || 1) - 1;
      if (n <= 0) { online.delete(userId); broadcastPresence(userId, username).catch(() => {}); } else online.set(userId, n);
    });
  });
  return io;
}

/** All of these are no-ops when realtime isn't running (tests, scripts); the DB is always the source of truth. */
export const emitToUser = (userId, event, payload) => io?.to(`user:${userId}`).emit(event, payload);
export const emitToConversation = (cid, event, payload) => io?.to(`conv:${cid}`).emit(event, payload);
export const joinConversation = (userIds, cid) => userIds.forEach((id) => io?.in(`user:${id}`).socketsJoin(`conv:${cid}`));
export const leaveConversation = (userId, cid) => io?.in(`user:${userId}`).socketsLeave(`conv:${cid}`);
export const disconnectUser = (userId) => io?.in(`user:${userId}`).disconnectSockets(true); // used when an account is suspended
