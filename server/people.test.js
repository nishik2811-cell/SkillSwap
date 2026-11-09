import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './src/app.js';
import { pool } from './src/db.js';
import { sent } from './src/auth/mail.js';
import { scoreCandidate, overlapMinutes, sortResults } from './src/people/ranking.js';

const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 5); // random suffix: test files run in parallel and can start in the same ms
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}/api/v1`;
const call = async (path, method = 'GET', body, cookie) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: r.headers.getSetCookie()[0]?.split(';')[0] };
};
async function makeUser(n) {
  const u = { email: `${n}-${run}@test.local`, username: `p${n}${run}`.slice(0, 20), password: 'correct horse 1', fullName: `Person ${n}` };
  await call('/auth/register', 'POST', u);
  await call('/auth/verify-email', 'POST', { token: sent.filter((m) => m.to === u.email).at(-1).text.match(/token=(\S+)/)[1] });
  return { ...u, cookie: (await call('/auth/login', 'POST', { identifier: u.email, password: u.password })).cookie };
}
test.after(async () => { srv.close(); const [ids] = await pool.query('SELECT id FROM users WHERE email LIKE ?', [`%-${run}@test.local`]); /* plain read, no locks */ if (ids.length) await pool.query('DELETE FROM users WHERE id IN (?)', [ids.map((r) => r.id)]); /* by primary key: row locks only, so parallel test files can't deadlock on a range scan */ await pool.end(); });

const skillId = async (name) => (await pool.query('SELECT id FROM skills WHERE name = ?', [name]))[0][0].id;

const prof = (o = {}) => ({ timezone: 'Asia/Kolkata', rating_avg: null, rating_count: 0, avatar: 'a', bio: 'b', location: 'c', mentor: [], learner: [], slots: [], languages: [], ...o });
const M = (skill_id, o = {}) => ({ skill_id, skill: 'S' + skill_id, level: 'advanced', pricing: 'free', price_min_paise: null, teaching_style: 'one_on_one', ...o });
const L = (skill_id, o = {}) => ({ skill_id, skill: 'S' + skill_id, current_level: 'beginner', prefers: 'either', max_price_paise: null, learning_style: 'one_on_one', desired_level: null, ...o });

test('ranking: compatibility beats popularity; missing data is not penalised; budget partitions', () => {
  const me = prof({ learner: [L(1, { prefers: 'free' })] });
  const niche = prof({ mentor: [M(1)], rating_count: 0 });                          // unrated but perfect fit
  const popular = prof({ mentor: [M(2)], rating_avg: 5, rating_count: 900 });        // not relevant
  const popularRelevantPaid = prof({ mentor: [M(1, { pricing: 'paid', price_min_paise: 90000 })], rating_avg: 5, rating_count: 900 });
  const a = scoreCandidate(me, niche, { direction: 'mentor' });
  assert.ok(a.score >= 80 && a.priceFit === 'free');
  assert.equal(scoreCandidate(me, popular, { direction: 'mentor' }), null);          // irrelevant never shows up in Best Match
  assert.equal(scoreCandidate(me, popularRelevantPaid, { direction: 'mentor' }).priceFit, 'over_budget'); // free-only learner can't afford it
  const budget = prof({ learner: [L(1, { prefers: 'paid', max_price_paise: 50000 })] });
  assert.equal(scoreCandidate(budget, popularRelevantPaid, { direction: 'mentor' }).priceFit, 'over_budget');
  assert.equal(scoreCandidate(budget, prof({ mentor: [M(1, { pricing: 'paid', price_min_paise: 30000, price_max_paise: 40000 })] }), { direction: 'mentor' }).priceFit, 'in_budget');
  // adding sparse info (no slots/languages) must not lower the score vs. a profile that has them but no overlap
  const noInfo = scoreCandidate(me, prof({ mentor: [M(1)], slots: [], languages: [] }), { direction: 'mentor' });
  const mismatch = scoreCandidate(prof({ ...me, languages: ['English'] }), prof({ mentor: [M(1)], languages: ['Hindi'] }), { direction: 'mentor' });
  assert.ok(noInfo.score > mismatch.score);
});

test('ranking: learner direction, availability across time zones, sorts', () => {
  const day = (w, s, e) => ({ weekday: w, start_time: s, end_time: e });
  // Mon 09:00-11:00 IST == Mon 03:30-05:30 UTC; viewer in UTC available then
  const mentor = prof({ timezone: 'Asia/Kolkata', mentor: [M(1)], slots: [day(0, '09:00', '11:00')] });
  const viewer = prof({ timezone: 'UTC', learner: [L(1)], slots: [day(0, '03:30', '05:30')] });
  assert.equal(overlapMinutes(viewer, mentor), 120);
  const noTz = prof({ timezone: null, learner: [L(1)], slots: [day(0, '09:00', '11:00')] });
  assert.equal(overlapMinutes(noTz, mentor), 120); // unknown zone is not treated as UTC
  const lonely = prof({ timezone: 'UTC', slots: [day(3, '03:30', '05:30')] });
  assert.equal(overlapMinutes(lonely, mentor), 0);
  // viewer is a Mentor looking for Learners
  const meMentor = prof({ mentor: [M(1)] });
  const r = scoreCandidate(meMentor, prof({ learner: [L(1)] }), { direction: 'learner' });
  assert.ok(r && r.reasons[0].startsWith('Wants to learn'));
  assert.equal(scoreCandidate(meMentor, prof({ learner: [L(9)] }), { direction: 'learner' }), null);
  const items = [{ rankKey: 50, user: { id: 1, rating_avg: 4.9, last_active_at: 1 }, offer: M(1, { pricing: 'paid', price_min_paise: 900, price_max_paise: 900 }), components: { skill: 1 }, matched: [] },
    { rankKey: 90, user: { id: 2, rating_avg: null, last_active_at: 5 }, offer: M(1), components: { skill: 1 }, matched: [] }];
  assert.equal(sortResults([...items], 'best')[0].user.id, 2);
  assert.equal(sortResults([...items], 'rating')[0].user.id, 1);
  assert.equal(sortResults([...items], 'price_asc')[0].user.id, 2);
  assert.equal(sortResults([...items], 'price_desc')[0].user.id, 1);
  assert.equal(sortResults([...items], 'active')[0].user.id, 2);
});

test('preferences: validation, DB constraints, persistence, discovery, recommendations', async () => {
  const [a, b] = await Promise.all([makeUser('a'), makeUser('b')]);
  const [guitar, python] = [await skillId('Guitar'), await skillId('Python')];
  assert.equal((await call('/me/preferences', 'PUT', {}, undefined)).status, 401);
  const base0 = { learnerSkills: [], availability: [], languages: [] };
  // paid with min > max, free with price, and duplicate skills are all rejected
  for (const bad of [
    { skillId: guitar, level: 'expert', pricing: 'paid', priceMinPaise: 9000, priceMaxPaise: 1000 },
    { skillId: guitar, level: 'expert', pricing: 'free', priceMinPaise: 100, priceMaxPaise: 200 },
    { skillId: 99999, level: 'expert', pricing: 'free' },
  ]) {
    const r = await call('/me/preferences', 'PUT', { ...base0, mentorSkills: [bad] }, a.cookie);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('/me/preferences', 'PUT', { ...base0, mentorSkills: [{ skillId: guitar, level: 'expert', pricing: 'free' }, { skillId: guitar, level: 'beginner', pricing: 'free' }] }, a.cookie)).status, 400);
  // a mentors Guitar (both, 300-800 INR), wants Python
  const ra = await call('/me/preferences', 'PUT', {
    mentorSkills: [{ skillId: guitar, level: 'expert', pricing: 'both', priceMinPaise: 30000, priceMaxPaise: 80000, yearsExperience: 6 }],
    learnerSkills: [{ skillId: python, prefers: 'either' }],
    availability: [{ weekday: 2, start: '18:00', end: '20:00' }], languages: ['English'], finishOnboarding: true,
  }, a.cookie);
  assert.equal(ra.status, 200); assert.equal(ra.body.onboardingDone, true);
  assert.equal(ra.body.mentorSkills[0].priceMaxPaise, 80000);
  // b mentors Python free, wants Guitar
  await call('/me/preferences', 'PUT', {
    mentorSkills: [{ skillId: python, level: 'advanced', pricing: 'free' }],
    learnerSkills: [{ skillId: guitar, prefers: 'either' }], availability: [{ weekday: 2, start: '17:00', end: '19:00' }], languages: ['English'], finishOnboarding: true,
  }, b.cookie);
  // discovery as b: find Guitar mentors, filters
  const found = await call(`/discover?role=mentor&skillId=${guitar}`, 'GET', null, b.cookie);
  assert.ok(found.body.users.some((u) => u.username === a.username));
  assert.ok(!found.body.users.some((u) => u.username === b.username)); // never self
  assert.equal((await call(`/discover?role=mentor&skillId=${guitar}&pricing=paid&maxPrice=10000`, 'GET', null, b.cookie)).body.users.filter((u) => u.username === a.username).length, 0);
  assert.equal((await call(`/discover?role=mentor&skillId=${guitar}&pricing=paid&maxPrice=40000`, 'GET', null, b.cookie)).body.users.filter((u) => u.username === a.username).length, 1);
  assert.ok((await call(`/discover?q=guit&role=mentor&level=expert&weekday=2&language=English`, 'GET', null, b.cookie)).body.users.some((u) => u.username === a.username));
  assert.equal((await call(`/discover?role=learner&skillId=${python}`, 'GET', null, b.cookie)).body.users.some((u) => u.username === a.username), true);
  assert.equal((await call('/discover?level=godlike', 'GET', null, b.cookie)).status, 400);
  assert.equal((await call('/discover')).status, 401);
  // recommendations: two-way match scores high
  const rec = (await call('/recommendations', 'GET', null, b.cookie)).body.matches.find((m) => m.username === a.username);
  assert.ok(rec && rec.score >= 70 && rec.reasons.length >= 2);
  // Best Match is the default sort, and the order is by score
  const d = (await call(`/discover?role=mentor`, 'GET', null, b.cookie)).body;
  assert.equal(d.sort, 'best');
  assert.deepEqual(d.users.map((u) => u.score), [...d.users.map((u) => u.score)].sort((x, y) => y - x));
  // blocked users never appear (either direction)
  await pool.query('INSERT INTO blocks (blocker_id, blocked_id) SELECT x.id, y.id FROM users x, users y WHERE x.username = ? AND y.username = ?', [a.username, b.username]);
  assert.equal((await call('/discover?role=mentor', 'GET', null, b.cookie)).body.users.some((u) => u.username === a.username), false);
  assert.equal((await call('/recommendations', 'GET', null, b.cookie)).body.matches.some((u) => u.username === a.username), false);
  // public profile, no private fields
  const pub = await call(`/users/${a.username}`);
  assert.equal(pub.status, 200); assert.equal(pub.body.email, undefined);
  assert.equal((await call('/users/nobody-here')).status, 404);
  // profile patch validates
  assert.equal((await call('/me/profile', 'PATCH', { age: 5 }, a.cookie)).status, 400);
  assert.equal((await call('/me/profile', 'PATCH', { bio: 'Hi', age: 25 }, a.cookie)).body.bio, 'Hi');
});

test('avatar: removing a photo clears it and deletes the file; needs login', async () => {
  const u = await makeUser('av');
  assert.equal((await call('/me/avatar', 'DELETE')).status, 401);
  const name = `avatars/${'a1'.repeat(12)}.png`;
  const { writeFile, mkdir, access } = await import('node:fs/promises');
  const { UPLOAD_DIR } = await import('./src/people/routes.js');
  await mkdir(UPLOAD_DIR + 'avatars', { recursive: true }); await writeFile(UPLOAD_DIR + name, 'x');
  await pool.query('UPDATE users SET avatar_path = ? WHERE username = ?', [name, u.username]);
  assert.equal((await call('/me/profile', 'GET', null, u.cookie)).body.avatarUrl, `/uploads/${name}`);
  const r = await call('/me/avatar', 'DELETE', undefined, u.cookie);
  assert.equal(r.status, 200); assert.equal(r.body.avatarUrl, null);
  assert.equal((await call('/me/profile', 'GET', null, u.cookie)).body.avatarUrl, null);
  await assert.rejects(access(UPLOAD_DIR + name)); // file is gone
  assert.equal((await call('/me/avatar', 'DELETE', undefined, u.cookie)).status, 200); // removing twice is harmless
});
