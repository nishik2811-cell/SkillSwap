import { pool } from './db.js';
import { emitToUser } from './realtime.js';

/** Persist a notification and push it live if the user is online. */
export async function notify(userId, { type, title, body = null, link = null }) {
  try { // best effort: a failed notification must never fail the action that caused it
  const [r] = await pool.query('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)', [userId, type, title, body, link]);
  emitToUser(userId, 'notification', { id: r.insertId, type, title, body, link, readAt: null, createdAt: new Date().toISOString() });
  } catch (e) { console.error('notify failed', e.message); }
}
