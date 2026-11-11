import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { hashPassword, verifyPassword, newToken, sha256, signSocketToken, signPayload, readPayload } from './crypto.js';
import { sendMail, actionMail } from './mail.js';
import { COOKIE, requireAuth } from './middleware.js';
import { google, configured as googleConfigured, authUrl as googleAuthUrl } from './google.js';

export const router = Router();
if (process.env.NODE_ENV !== 'test') {
  router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false }));
}

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/, '3-20 chars: a-z, 0-9, _');
const password = z.string().min(8).max(128);
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const parse = (schema, data, res) => {
  const r = schema.safeParse(data);
  if (!r.success) { res.status(400).json({ error: 'invalid_input', details: r.error.flatten().fieldErrors }); return null; }
  return r.data;
};
const webLink = (path, token) => `${process.env.WEB_ORIGIN}${path}?token=${token}`;
const verifyMail = (name, token) => actionMail({
  name, heading: 'Confirm your email address',
  intro: 'Welcome to SkillSwap! Please confirm your email address to activate your account and start learning and teaching. The link works for 48 hours.',
  button: 'Confirm email', link: webLink('/verify-email', token),
  note: "If you didn't create a SkillSwap account, you can safely ignore this email." });

async function issueEmailToken(userId, purpose, hours) {
  const token = newToken();
  await pool.query(
    'INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?,?,?, DATE_ADD(NOW(), INTERVAL ? HOUR))',
    [sha256(token), userId, purpose, hours]);
  return token;
}

async function startSession(res, userId) {
  const token = newToken();
  await pool.query('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?,?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
    [sha256(token), userId]);
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 864e5, path: '/',
  });
}

// Candidate alternatives for a taken ID; only free ones are returned.
async function suggest(base) {
  const stem = base.slice(0, 16);
  const cands = new Set([`${stem}_`, `the_${stem}`.slice(0, 20), `${stem}${new Date().getFullYear() % 100}`]);
  while (cands.size < 10) cands.add(`${stem}${Math.floor(10 + Math.random() * 990)}`.slice(0, 20));
  const list = [...cands].filter((c) => /^[a-z0-9_]{3,20}$/.test(c));
  const [rows] = await pool.query('SELECT username FROM users WHERE username IN (?)', [list]);
  const taken = new Set(rows.map((r) => r.username.toLowerCase()));
  return list.filter((c) => !taken.has(c)).slice(0, 3);
}

// ---- Sign in with Google ----
const GSTATE = 'g_state', GPENDING = 'g_pending', GPATH = '/api/v1/auth/google';
router.get('/providers', (_req, res) => res.json({ google: googleConfigured() }));

router.get('/google', (_req, res) => {
  if (!googleConfigured()) return res.redirect('/login?error=google_not_configured');
  const state = newToken();
  res.cookie(GSTATE, state, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60e3, path: GPATH });
  res.redirect(googleAuthUrl(state));
});

router.get('/google/callback', wrap(async (req, res) => {
  const fail = (e) => res.redirect(`/login?error=${e}`);
  const state = req.cookies?.[GSTATE]; res.clearCookie(GSTATE, { path: GPATH });
  if (req.query.error) return fail('google_cancelled');
  if (!state || state !== req.query.state || typeof req.query.code !== 'string') return fail('google_failed'); // state ties the answer to the browser that asked
  let c; try { c = await google.exchange(req.query.code); } catch (e) { console.error('[google] sign-in failed:', e.message); return fail('google_failed'); }
  if (!c.email_verified || !c.email || !c.sub) return fail('google_unverified');
  const email = c.email.toLowerCase();
  let [[u]] = await pool.query('SELECT id, status FROM users WHERE google_sub = ?', [c.sub]);
  if (!u) {
    [[u]] = await pool.query('SELECT id, status, google_sub, email_verified_at FROM users WHERE email = ?', [email]);
    if (u?.google_sub) return fail('google_failed'); // that address is already tied to another Google account
    if (u) { // Google vouches for this address: link it. An account nobody ever verified may have been registered by someone else, so its password is voided.
      await pool.query('UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, NOW()), password_hash = CASE WHEN email_verified_at IS NULL THEN ? ELSE password_hash END WHERE id = ?',
        [c.sub, hashPassword(newToken()), u.id]);
      if (!u.email_verified_at) await pool.query('DELETE FROM auth_sessions WHERE user_id = ?', [u.id]);
    }
  }
  if (!u) { // a new person: nothing is created until they pick their own unique ID on /choose-id
    res.cookie(GPENDING, signPayload('google-signup', { sub: c.sub, email, name: String(c.name || '').slice(0, 100) }, 15 * 60),
      { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 15 * 60e3, path: GPATH });
    return res.redirect('/choose-id');
  }
  if (u.status !== 'active') return fail('account_inactive');
  await startSession(res, u.id);
  res.redirect('/dashboard');
}));

router.get('/google/pending', (req, res) => {
  const p = readPayload('google-signup', req.cookies?.[GPENDING]);
  if (!p) return res.status(404).json({ error: 'no_pending_signup' });
  res.json({ email: p.email, name: p.name });
});

router.post('/google/complete', wrap(async (req, res) => {
  const p = readPayload('google-signup', req.cookies?.[GPENDING]);
  if (!p) return res.status(401).json({ error: 'signup_expired' });
  const d = parse(z.object({ username }), req.body, res); if (!d) return;
  let id;
  try {
    [{ insertId: id }] = await pool.query('INSERT INTO users (email, username, password_hash, full_name, email_verified_at, google_sub) VALUES (?,?,?,?,NOW(),?)',
      [p.email, d.username, hashPassword(newToken()), (p.name || p.email.split('@')[0]).slice(0, 100), p.sub]); // nobody knows this password; "Forgot password" can set one
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    if (String(e.sqlMessage).includes('uq_users_username')) return res.status(409).json({ error: 'username_taken', suggestions: await suggest(d.username) });
    return res.status(409).json({ error: 'already_registered' }); // this email or Google account got an account in the meantime: signing in with Google again links it
  }
  await startSession(res, id);
  res.clearCookie(GPENDING, { path: GPATH });
  void sendMail({ to: p.email, subject: 'Welcome to SkillSwap', ...actionMail({ // fire and forget: a slow mail server must not hold up the sign-in
    name: p.name, heading: 'Welcome to SkillSwap',
    intro: `Your account is ready. You signed in with Google, and your User ID is @${d.username}. We are glad you are here.`,
    steps: ['Add the skills you can teach and the ones you want to learn.', 'Browse your Best Matches and send a connection request.', 'Chat, book a session, and meet in the built-in video room.'],
    button: 'Open SkillSwap', link: `${String(process.env.WEB_ORIGIN || '').replace(/\/$/, '')}/dashboard`,
    note: "If you didn't create this account, you can ignore this email." }) });
  res.status(201).json({ ok: true });
}));

router.get('/username-available', wrap(async (req, res) => {
  const u = parse(username, req.query.u, res); if (u === null) return;
  const [[row]] = await pool.query('SELECT 1 FROM users WHERE username = ?', [u]);
  res.json(row ? { available: false, suggestions: await suggest(u) } : { available: true, suggestions: [] });
}));

router.post('/register', wrap(async (req, res) => {
  const d = parse(z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    username, password, fullName: z.string().trim().min(1).max(100),
  }), req.body, res); if (!d) return;
  let id;
  try {
    [{ insertId: id }] = await pool.query(
      'INSERT INTO users (email, username, password_hash, full_name) VALUES (?,?,?,?)',
      [d.email, d.username, hashPassword(d.password), d.fullName]);
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e; // DB unique keys are the source of truth, not a pre-check
    if (e.sqlMessage.includes('uq_users_username')) {
      return res.status(409).json({ error: 'username_taken', suggestions: await suggest(d.username) });
    }
    return res.status(409).json({ error: 'email_taken' });
  }
  const token = await issueEmailToken(id, 'verify_email', 48);
  await sendMail({ to: d.email, subject: 'Confirm your email to get started on SkillSwap', ...verifyMail(d.fullName, token) });
  res.status(201).json({ ok: true });
}));

router.post('/resend-verification', wrap(async (req, res) => {
  const d = parse(z.object({ identifier: z.string().trim().toLowerCase().min(1).max(254) }), req.body, res); if (!d) return;
  const [[u]] = await pool.query("SELECT id, email, full_name FROM users WHERE (email = ? OR username = ?) AND status = 'active' AND email_verified_at IS NULL", [d.identifier, d.identifier]);
  if (u) {
    const token = await issueEmailToken(u.id, 'verify_email', 48);
    await sendMail({ to: u.email, subject: 'Confirm your email to get started on SkillSwap', ...verifyMail(u.full_name, token) });
  }
  res.json({ ok: true }); // same response whether or not the account exists or is already verified
}));

router.post('/verify-email', wrap(async (req, res) => {
  const d = parse(z.object({ token: z.string().min(10) }), req.body, res); if (!d) return;
  const [r] = await pool.query(
    `WITH t AS (UPDATE email_tokens SET used_at = NOW()
       WHERE token_hash = ? AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > NOW() RETURNING user_id)
     UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id IN (SELECT user_id FROM t)`,
    [sha256(d.token)]);
  if (!r.affectedRows) return res.status(400).json({ error: 'invalid_or_expired_token' });
  res.json({ ok: true });
}));

router.post('/login', wrap(async (req, res) => {
  const d = parse(z.object({ identifier: z.string().trim().toLowerCase().min(1), password: z.string().min(1) }), req.body, res);
  if (!d) return;
  const [[u]] = await pool.query('SELECT * FROM users WHERE email = ? OR username = ?', [d.identifier, d.identifier]);
  if (!verifyPassword(d.password, u?.password_hash)) return res.status(401).json({ error: 'invalid_credentials' });
  if (u.status !== 'active') return res.status(403).json({ error: 'account_inactive' });
  if (!u.email_verified_at) return res.status(403).json({ error: 'email_not_verified' });
  await startSession(res, u.id);
  res.json({ user: { id: u.id, username: u.username, fullName: u.full_name, role: u.role, onboardingDone: !!u.onboarding_done } });
}));

router.post('/logout', wrap(async (req, res) => {
  const sid = req.cookies?.[COOKIE];
  if (sid) await pool.query('DELETE FROM auth_sessions WHERE token_hash = ?', [sha256(sid)]);
  res.clearCookie(COOKIE, { path: '/' }).json({ ok: true });
}));

router.get('/socket-token', requireAuth, (req, res) => res.json({ token: signSocketToken(req.user.id) }));

router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({ user: { id: u.id, username: u.username, fullName: u.full_name, email: u.email, role: u.role, onboardingDone: !!u.onboarding_done } });
});

router.post('/forgot-password', wrap(async (req, res) => {
  const d = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body, res); if (!d) return;
  const [[u]] = await pool.query("SELECT id, full_name FROM users WHERE email = ? AND status = 'active'", [d.email]);
  if (u) {
    const token = await issueEmailToken(u.id, 'reset_password', 1);
    await sendMail({ to: d.email, subject: 'Reset your SkillSwap password', ...actionMail({
      name: u.full_name, heading: 'Reset your password',
      intro: 'We received a request to reset the password for your SkillSwap account. Use the button below to choose a new one. The link works for 1 hour.',
      button: 'Reset password', link: webLink('/reset-password', token),
      note: "If you didn't ask for this, you can ignore this email; your password won't change." }) });
  }
  res.json({ ok: true }); // same response whether or not the email exists
}));

router.post('/reset-password', wrap(async (req, res) => {
  const d = parse(z.object({ token: z.string().min(10), password }), req.body, res); if (!d) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query(
      `SELECT user_id FROM email_tokens WHERE token_hash = ? AND purpose = 'reset_password'
       AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`, [sha256(d.token)]);
    if (!t) { await conn.rollback(); return res.status(400).json({ error: 'invalid_or_expired_token' }); }
    await conn.query('UPDATE email_tokens SET used_at = NOW() WHERE token_hash = ?', [sha256(d.token)]);
    await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(d.password), t.user_id]);
    await conn.query('DELETE FROM auth_sessions WHERE user_id = ?', [t.user_id]); // log out everywhere
    await conn.commit();
    res.json({ ok: true });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));
