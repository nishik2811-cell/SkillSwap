import { pool } from './db.js';

/** Of these usernames, the ids of active people `userId` is connected with and who haven't blocked (or been blocked by) them. */
export async function connectedIds(userId, usernames) {
  if (!usernames.length) return [];
  const [rows] = await pool.query(
    `SELECT u.id FROM users u JOIN connections c ON c.user_lo = LEAST(u.id, ?) AND c.user_hi = GREATEST(u.id, ?) AND c.status = 'accepted'
     WHERE u.username IN (?) AND u.status = 'active' AND u.id <> ?
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = ?) OR (b.blocker_id = ? AND b.blocked_id = u.id))`,
    [userId, userId, usernames, userId, userId, userId]);
  return rows.map((r) => r.id);
}
