import { pool } from '../db.js';
import { sha256 } from './crypto.js';

export const COOKIE = 'sid';

export async function loadUser(req, _res, next) {
  const sid = req.cookies?.[COOKIE];
  if (sid) {
    const [[u]] = await pool.query(
      `SELECT u.id, u.email, u.username, u.full_name, u.role, u.status, u.onboarding_done
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.status = 'active'`, [sha256(sid)]);
    req.user = u || null;
    if (u) pool.query('UPDATE users SET last_active_at = NOW() WHERE id = ? AND (last_active_at IS NULL OR last_active_at < NOW() - INTERVAL 5 MINUTE)', [u.id]).catch(() => {});
  }
  next();
}

export const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'unauthenticated' });

export const requireAdmin = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'forbidden' });
