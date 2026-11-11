import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { keep, forget } from '../files.js';
import { pool } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { setStatus } from '../realtime.js';
import { scoreCandidate, sortResults, DEFAULT_WEIGHTS } from './ranking.js';

export const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const bad = (res, err) => res.status(400).json({ error: 'invalid_input', details: err.flatten().fieldErrors });

// Uploads dir: UPLOAD_DIR env wins; on Vercel only /tmp is writable (and it is NOT persistent: use object storage for real uploads).
const envDir = process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/uploads' : null);
export const UPLOAD_DIR = envDir ? envDir.replace(/\/?$/, '/') : new URL('../../uploads/', import.meta.url).pathname;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const upload = multer({
  dest: UPLOAD_DIR + 'tmp/', limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_r, f, cb) => cb(null, f.mimetype in EXT),
});

// ---------- loaders ----------
async function loadSkillSets(ids) {
  const out = new Map(ids.map((id) => [id, { mentor: [], learner: [], days: [], languages: [], slots: [] }]));
  if (!ids.length) return out;
  const [m] = await pool.query(
    `SELECT ms.*, s.name skill FROM mentor_skills ms JOIN skills s ON s.id = ms.skill_id WHERE ms.user_id IN (?)`, [ids]);
  const [l] = await pool.query(
    `SELECT ls.*, s.name skill FROM learner_skills ls JOIN skills s ON s.id = ls.skill_id WHERE ls.user_id IN (?)`, [ids]);
  const [a] = await pool.query('SELECT user_id, weekday, start_time, end_time FROM availability_slots WHERE user_id IN (?)', [ids]);
  const [g] = await pool.query('SELECT user_id, language FROM user_languages WHERE user_id IN (?)', [ids]);
  m.forEach((r) => out.get(r.user_id).mentor.push(r));
  l.forEach((r) => out.get(r.user_id).learner.push(r));
  a.forEach((r) => { const o = out.get(r.user_id); o.slots.push(r); if (!o.days.includes(r.weekday)) o.days.push(r.weekday); });
  g.forEach((r) => out.get(r.user_id).languages.push(r.language));
  return out;
}

const card = (u, sets) => ({
  username: u.username, fullName: u.full_name, avatarUrl: u.avatar_path && `/uploads/${u.avatar_path}`,
  bio: u.bio, location: u.location,
  mentorSkills: sets.mentor.map((s) => ({ skillId: s.skill_id, skill: s.skill, level: s.level, pricing: s.pricing, priceMinPaise: s.price_min_paise, priceMaxPaise: s.price_max_paise, teachingStyle: s.teaching_style, yearsExperience: s.years_experience })),
  learnerSkills: sets.learner.map((s) => ({ skillId: s.skill_id, skill: s.skill, currentLevel: s.current_level, desiredLevel: s.desired_level, prefers: s.prefers, maxPricePaise: s.max_price_paise, learningStyle: s.learning_style })),
  languages: sets.languages, availability: (sets.slots || []).map((s) => ({ weekday: s.weekday, start: String(s.start_time).slice(0, 5), end: String(s.end_time).slice(0, 5) })),
});

// ---------- skills ----------
router.get('/skills', wrap(async (_req, res) => {
  const [rows] = await pool.query('SELECT s.id, s.name, c.name category FROM skills s JOIN categories c ON c.id = s.category_id ORDER BY c.name, s.name');
  res.json({ skills: rows });
}));

// ---------- my profile / preferences ----------
const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(100).optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  age: z.number().int().min(13).max(120).nullable().optional(),
  location: z.string().trim().max(100).nullable().optional(),
  timezone: z.string().trim().max(64).nullable().optional(),
  preferredLanguage: z.string().trim().max(40).nullable().optional(),
});
const level = ['beginner', 'intermediate', 'advanced', 'expert'];
const style = ['one_on_one', 'group', 'workshop', 'interactive'];
const mentorSkill = z.object({
  skillId: z.number().int().positive(), level: z.enum(level), yearsExperience: z.number().int().min(0).max(80).nullable().optional(),
  pricing: z.enum(['free', 'paid', 'both']), priceMinPaise: z.number().int().min(0).nullable().optional(),
  priceMaxPaise: z.number().int().min(0).nullable().optional(), teachingStyle: z.enum(style).default('one_on_one'),
}).refine((m) => m.pricing === 'free'
  ? m.priceMinPaise == null && m.priceMaxPaise == null
  : m.priceMinPaise != null && m.priceMaxPaise != null && m.priceMinPaise <= m.priceMaxPaise,
{ message: 'free skills take no price; paid/both need min <= max' });
const learnerSkill = z.object({
  skillId: z.number().int().positive(), currentLevel: z.enum(['none', ...level.slice(0, 3)]).default('none'),
  desiredLevel: z.enum(level).nullable().optional(), prefers: z.enum(['free', 'paid', 'either']).default('either'), maxPricePaise: z.number().int().min(0).nullable().optional(),
  learningStyle: z.enum(style).default('one_on_one'),
});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const prefsSchema = z.object({
  mentorSkills: z.array(mentorSkill).max(30), learnerSkills: z.array(learnerSkill).max(30),
  availability: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: hhmm, end: hhmm }).refine((s) => s.start < s.end)).max(28),
  languages: z.array(z.string().trim().min(2).max(40)).max(10),
  finishOnboarding: z.boolean().optional(),
}).refine((p) => new Set(p.mentorSkills.map((s) => s.skillId)).size === p.mentorSkills.length
  && new Set(p.learnerSkills.map((s) => s.skillId)).size === p.learnerSkills.length, { message: 'duplicate skill' });

async function myProfile(userId) {
  const [[u]] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
  const sets = (await loadSkillSets([userId])).get(userId);
  return { ...card(u, sets), email: u.email, age: u.age, timezone: u.timezone, preferredLanguage: u.preferred_language, onboardingDone: !!u.onboarding_done };
}

router.get('/me/profile', requireAuth, wrap(async (req, res) => res.json(await myProfile(req.user.id))));

// Discord-style status: what the people you chat with see next to your name while you're connected
router.patch('/me/status', requireAuth, wrap(async (req, res) => {
  const p = z.object({ status: z.enum(['online', 'away', 'busy', 'invisible']) }).safeParse(req.body); if (!p.success) return bad(res, p.error);
  await pool.query('UPDATE users SET presence_status = ? WHERE id = ?', [p.data.status, req.user.id]);
  setStatus(req.user.id, req.user.username, p.data.status);
  res.json({ status: p.data.status });
}));

router.patch('/me/profile', requireAuth, wrap(async (req, res) => {
  const p = profileSchema.safeParse(req.body); if (!p.success) return bad(res, p.error);
  const map = { fullName: 'full_name', bio: 'bio', age: 'age', location: 'location', timezone: 'timezone', preferredLanguage: 'preferred_language' };
  const sets = Object.keys(p.data).filter((k) => map[k]);
  if (sets.length) await pool.query(`UPDATE users SET ${sets.map((k) => `${map[k]} = ?`).join(', ')} WHERE id = ?`, [...sets.map((k) => p.data[k]), req.user.id]);
  res.json(await myProfile(req.user.id));
}));

router.put('/me/preferences', requireAuth, wrap(async (req, res) => {
  const p = prefsSchema.safeParse(req.body); if (!p.success) return bad(res, p.error);
  const d = p.data, uid = req.user.id, conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const t of ['mentor_skills', 'learner_skills', 'availability_slots', 'user_languages']) await conn.query(`DELETE FROM ${t} WHERE user_id = ?`, [uid]);
    for (const m of d.mentorSkills) await conn.query('INSERT INTO mentor_skills (user_id, skill_id, level, years_experience, pricing, price_min_paise, price_max_paise, teaching_style) VALUES (?,?,?,?,?,?,?,?)',
      [uid, m.skillId, m.level, m.yearsExperience ?? null, m.pricing, m.priceMinPaise ?? null, m.priceMaxPaise ?? null, m.teachingStyle]);
    for (const l of d.learnerSkills) await conn.query('INSERT INTO learner_skills (user_id, skill_id, current_level, desired_level, prefers, max_price_paise, learning_style) VALUES (?,?,?,?,?,?,?)',
      [uid, l.skillId, l.currentLevel, l.desiredLevel ?? null, l.prefers, l.maxPricePaise ?? null, l.learningStyle]);
    for (const s of d.availability) await conn.query('INSERT INTO availability_slots (user_id, weekday, start_time, end_time) VALUES (?,?,?,?)', [uid, s.weekday, s.start, s.end]);
    for (const g of new Set(d.languages)) await conn.query('INSERT INTO user_languages (user_id, language) VALUES (?,?)', [uid, g]);
    if (d.finishOnboarding) await conn.query('UPDATE users SET onboarding_done = TRUE WHERE id = ?', [uid]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'unknown_skill' });
    throw e;
  } finally { conn.release(); }
  res.json(await myProfile(uid));
}));

router.post('/me/avatar', requireAuth, upload.single('avatar'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'invalid_file', message: 'PNG, JPEG or WebP up to 2MB' });
  await mkdir(UPLOAD_DIR + 'avatars', { recursive: true });
  const name = `avatars/${randomBytes(12).toString('hex')}.${EXT[req.file.mimetype]}`;
  await rename(req.file.path, UPLOAD_DIR + name);
  await keep(name, UPLOAD_DIR + name, req.file.mimetype);
  const [[prev]] = await pool.query('SELECT avatar_path FROM users WHERE id = ?', [req.user.id]);
  await pool.query('UPDATE users SET avatar_path = ? WHERE id = ?', [name, req.user.id]);
  await dropAvatarFile(prev?.avatar_path); // the replaced photo is no longer referenced
  res.json({ avatarUrl: `/uploads/${name}` });
}));

// Only ever deletes files this server named itself (avatars/<hex>.<ext>); a missing file is fine.
async function dropAvatarFile(path) {
  if (!path || !/^avatars\/[0-9a-f]{24}\.(png|jpg|webp)$/.test(path)) return;
  await unlink(UPLOAD_DIR + path).catch(() => {});
  await forget(path);
}

router.delete('/me/avatar', requireAuth, wrap(async (req, res) => {
  const [[u]] = await pool.query('SELECT avatar_path FROM users WHERE id = ?', [req.user.id]);
  await pool.query('UPDATE users SET avatar_path = NULL WHERE id = ?', [req.user.id]);
  await dropAvatarFile(u?.avatar_path);
  res.json({ avatarUrl: null });
}));

// ---------- public profile ----------
router.get('/users/:username', wrap(async (req, res) => {
  const [[u]] = await pool.query("SELECT * FROM users WHERE username = ? AND status = 'active' AND email_verified_at IS NOT NULL", [String(req.params.username)]);
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (req.user) { // hidden from anyone they have blocked
    const [[b]] = await pool.query('SELECT 1 x FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [u.id, req.user.id]);
    if (b) return res.status(404).json({ error: 'not_found' });
  }
  res.json(card(u, (await loadSkillSets([u.id])).get(u.id)));
}));

// ---------- discovery & recommendations (Best Match is the default sort everywhere) ----------
let weightsCache = { at: 0, w: DEFAULT_WEIGHTS };
async function getWeights() { // configurable via platform_settings.ranking_weights; falls back to defaults
  if (Date.now() - weightsCache.at < 60_000) return weightsCache.w;
  let w = DEFAULT_WEIGHTS;
  try {
    const [[r]] = await pool.query("SELECT value FROM platform_settings WHERE `key` = 'ranking_weights'");
    const parsed = r && JSON.parse(r.value);
    if (parsed && Object.keys(DEFAULT_WEIGHTS).every((k) => typeof parsed[k] === 'number' && parsed[k] >= 0)) w = parsed;
  } catch { /* keep defaults */ }
  weightsCache = { at: Date.now(), w };
  return w;
}
export const _resetWeightsCache = () => { weightsCache.at = 0; };

async function loadProfiles(users) {
  const sets = await loadSkillSets(users.map((u) => u.id));
  return new Map(users.map((u) => [u.id, { ...sets.get(u.id), user: u, id: u.id, timezone: u.timezone, rating_avg: u.rating_avg, rating_count: u.rating_count, avatar: u.avatar_path, bio: u.bio, location: u.location }]));
}

const FORMAT = { one_on_one: "('one_on_one')", group: "('group','workshop','interactive')" };
const discoverQuery = z.object({
  q: z.string().trim().max(60).optional(), skillId: z.coerce.number().int().positive().optional(),
  role: z.enum(['mentor', 'learner']).default('mentor'), sort: z.enum(['best', 'rating', 'price_asc', 'price_desc', 'skills', 'active']).default('best'),
  pricing: z.enum(['free', 'paid']).optional(), minPrice: z.coerce.number().int().min(0).optional(), maxPrice: z.coerce.number().int().min(0).optional(),
  level: z.enum(level).optional(), language: z.string().trim().max(40).optional(), weekday: z.coerce.number().int().min(0).max(6).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(), format: z.enum(['one_on_one', 'group']).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(24).default(12),
});

const result = (r, p) => ({
  ...card(p.user, p), score: r.score, reasons: r.reasons, matchedSkills: r.matched, priceFit: r.priceFit,
  offer: { skill: r.matched[0] && r.offer.skill, pricing: r.offer.pricing, priceMinPaise: r.offer.price_min_paise ?? null, priceMaxPaise: r.offer.price_max_paise ?? null },
  rating: { avg: p.rating_avg == null ? null : Number(p.rating_avg), count: p.rating_count }, lastActiveAt: p.user.last_active_at,
  breakdown: r.components,
});

async function discover(viewerUser, f, { track = false } = {}) {
  const seeking = f.role === 'mentor', tbl = seeking ? 'mentor_skills' : 'learner_skills';
  const vp = (await loadProfiles([viewerUser])).get(viewerUser.id);
  let focus = f.skillId ? [f.skillId] : null;
  if (!focus && f.q) { const [r] = await pool.query('SELECT id FROM skills WHERE name LIKE ?', [`%${f.q}%`]); if (r.length) focus = r.map((x) => x.id); }
  const mineIds = (seeking ? vp.learner : vp.mentor).map((x) => x.skill_id);

  // --- SQL: hard filters + safety (blocked users either way, inactive, unverified) ---
  const inner = ['x.user_id = u.id'], ia = [];
  const wanted = focus || (!f.q && mineIds.length ? mineIds : null);
  if (wanted) { inner.push('x.skill_id IN (?)'); ia.push(wanted); }
  if (seeking) {
    const freeOk = f.pricing === 'paid' ? '' : "x.pricing IN ('free','both') OR "; // a paid-only search must not be satisfied by a free option
    if (f.pricing) inner.push(f.pricing === 'free' ? "x.pricing IN ('free','both')" : "x.pricing IN ('paid','both')");
    if (f.minPrice != null) { inner.push(`(${freeOk}x.price_max_paise >= ?)`); ia.push(f.minPrice); }
    if (f.maxPrice != null) { inner.push(`(${freeOk}x.price_min_paise <= ?)`); ia.push(f.maxPrice); }
    if (f.level) { inner.push('x.level = ?'); ia.push(f.level); }
  }
  if (f.format) inner.push(`x.${seeking ? 'teaching_style' : 'learning_style'} IN ${FORMAT[f.format]}`);
  const where = ["u.status = 'active'", 'u.email_verified_at IS NOT NULL', 'u.onboarding_done', 'u.id <> ?',
    'NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = ?) OR (b.blocker_id = ? AND b.blocked_id = u.id))',
    `EXISTS (SELECT 1 FROM ${tbl} x WHERE ${inner.join(' AND ')})`];
  const args = [viewerUser.id, viewerUser.id, viewerUser.id, ...ia];
  if (f.q) { where.push(`(u.full_name LIKE ? OR u.username LIKE ? OR EXISTS (SELECT 1 FROM ${tbl} y JOIN skills sk ON sk.id = y.skill_id WHERE y.user_id = u.id AND sk.name LIKE ?))`); args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  if (f.language) { where.push('EXISTS (SELECT 1 FROM user_languages g WHERE g.user_id = u.id AND g.language = ?)'); args.push(f.language); }
  if (f.weekday != null) { where.push('EXISTS (SELECT 1 FROM availability_slots a WHERE a.user_id = u.id AND a.weekday = ?)'); args.push(f.weekday); }
  if (f.minRating != null) { where.push('u.rating_avg >= ?'); args.push(f.minRating); }
  const [users] = await pool.query(`SELECT u.* FROM users u WHERE ${where.join(' AND ')} ORDER BY u.last_active_at DESC NULLS LAST, u.id LIMIT 500`, args);

  // --- ranking (in the backend, recomputed on every request so profile edits apply immediately) ---
  const W = await getWeights(), profiles = await loadProfiles(users);
  let seen = new Map();
  if (track && users.length) { const [rows] = await pool.query('SELECT user_id, shown_count FROM discovery_impressions WHERE viewer_id = ? AND user_id IN (?)', [viewerUser.id, users.map((u) => u.id)]); seen = new Map(rows.map((r) => [r.user_id, r.shown_count])); }
  const ranked = [];
  for (const u of users) {
    const p = profiles.get(u.id), r = scoreCandidate(vp, p, { direction: f.role, focus, strict: !f.q }, W);
    if (!r) continue;
    // rotate repeats gently: at most a 10% nudge, so a clearly better match still wins
    ranked.push({ ...r, user: u, profile: p, rankKey: r.score * Math.max(0.9, 0.98 ** (seen.get(u.id) || 0)) });
  }
  // unaffordable options are never mixed above affordable ones; they are listed separately
  const within = sortResults(ranked.filter((r) => r.priceFit !== 'over_budget'), f.sort);
  const over = sortResults(ranked.filter((r) => r.priceFit === 'over_budget'), 'best');
  const start = (f.page - 1) * f.pageSize, pageItems = within.slice(start, start + f.pageSize);
  if (track && pageItems.length) await pool.query(`INSERT INTO discovery_impressions (viewer_id, user_id) VALUES ? ON CONFLICT (viewer_id, user_id) DO UPDATE SET shown_count = discovery_impressions.shown_count + 1, last_shown_at = NOW()`, [pageItems.map((r) => [viewerUser.id, r.user.id])]);
  return {
    sort: f.sort, page: f.page, pageSize: f.pageSize, total: within.length,
    users: pageItems.map((r) => result(r, r.profile)),
    outOfBudget: f.page === 1 ? over.slice(0, 6).map((r) => result(r, r.profile)) : [],
    hint: !mineIds.length && !focus ? 'add_skills' : undefined, // cold start: nothing to personalise on yet
  };
}

router.get('/discover', requireAuth, wrap(async (req, res) => {
  const p = discoverQuery.safeParse(req.query); if (!p.success) return bad(res, p.error);
  const [[me]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json(await discover(me, p.data));
}));

router.get('/recommendations', requireAuth, wrap(async (req, res) => {
  const [[me]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const out = await discover(me, discoverQuery.parse({ role: req.query.role || 'mentor', pageSize: 8 }), { track: true });
  res.json({ matches: out.users, hint: out.hint });
}));
