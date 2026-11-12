import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './src/app.js';
import { pool } from './src/db.js';
import { sent } from './src/auth/mail.js';
import { sendReminders } from './src/sessions/routes.js';

const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 5); // random suffix: test files run in parallel and can start in the same ms
const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}/api/v1`;
const call = async (path, method = 'GET', body, who) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(who && { cookie: who.cookie }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
async function makeUser(n, { mentors = true } = {}) {
  const u = { email: `${n}-${run}@test.local`, username: `q${n}${run}`.slice(0, 20), password: 'correct horse 1', fullName: `Sess ${n}` };
  await call('/auth/register', 'POST', u);
  await call('/auth/verify-email', 'POST', { token: sent.filter((m) => m.to === u.email).at(-1).text.match(/token=(\S+)/)[1] });
  const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: u.password }) });
  const me = { ...u, cookie: r.headers.getSetCookie()[0].split(';')[0] };
  if (mentors) await call('/me/preferences', 'PUT', { mentorSkills: [{ skillId: GUITAR, level: 'expert', pricing: 'both', priceMinPaise: 20000, priceMaxPaise: 50000 }], learnerSkills: [], availability: [], languages: [], finishOnboarding: true }, me);
  return me;
}
let GUITAR;
test.before(async () => { GUITAR = (await pool.query("SELECT id FROM skills WHERE name = 'Guitar'"))[0][0].id; });
test.after(async () => { srv.close(); const [ids] = await pool.query('SELECT id FROM users WHERE email LIKE ?', [`%-${run}@test.local`]); /* plain read, no locks */ if (ids.length) await pool.query('DELETE FROM users WHERE id IN (?)', [ids.map((r) => r.id)]); /* by primary key: row locks only, so parallel test files can't deadlock on a range scan */ await pool.end(); });
const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const mk = (o = {}) => ({ title: 'Guitar basics', skillId: GUITAR, startsAt: inHours(48), durationMin: 60, capacity: 1, pricing: 'free', ...o });
const notes = async (u) => (await call('/notifications', 'GET', null, u)).body.notifications.map((n) => n.type);
const makeSession = async (m, o) => (await call('/sessions', 'POST', mk(o), m)).body.id;

test('create: validation, mentor-skill rule, future-only, no overlap', async () => {
  GUITAR ??= (await pool.query("SELECT id FROM skills WHERE name = 'Guitar'"))[0][0].id;
  const [m, l] = await Promise.all([makeUser('m1'), makeUser('l1', { mentors: false })]);
  assert.equal((await call('/sessions', 'POST', mk(), undefined)).status, 401);
  assert.equal((await call('/sessions', 'POST', mk({ title: 'x' }), m)).status, 400);
  assert.equal((await call('/sessions', 'POST', mk({ pricing: 'paid' }), m)).status, 400); // paid needs a price
  assert.equal((await call('/sessions', 'POST', mk({ pricing: 'free', pricePaise: 500 }), m)).status, 400);
  assert.equal((await call('/sessions', 'POST', mk({ startsAt: inHours(0.01) }), m)).body.error, 'must_be_in_future');
  assert.equal((await call('/sessions', 'POST', mk(), l)).body.error, 'not_a_mentor_skill'); // l doesn't mentor guitar
  assert.equal((await call('/sessions', 'POST', mk({ capacity: 0 }), m)).status, 400);
  assert.equal((await call('/sessions', 'POST', mk(), m)).status, 201);
  assert.equal((await call('/sessions', 'POST', mk({ startsAt: inHours(48.5) }), m)).body.error, 'overlaps_another_session');
  assert.equal((await call('/sessions', 'POST', mk({ startsAt: inHours(72), pricing: 'paid', pricePaise: 30000 }), m)).status, 201);
});

test('free individual flow: request -> notify -> accept -> confirmed -> complete -> reviews & rating', async () => {
  const [m, l, x] = await Promise.all([makeUser('m2'), makeUser('l2', { mentors: false }), makeUser('x2', { mentors: false })]);
  const id = await makeSession(m);
  const book = await call(`/sessions/${id}/book`, 'POST', { note: 'Beginner here' }, l);
  assert.equal(book.body.status, 'requested');
  assert.ok((await notes(m)).includes('booking_request'));
  assert.equal((await call(`/sessions/${id}/book`, 'POST', {}, l)).body.error, 'already_booked');
  assert.equal((await call(`/sessions/${id}/book`, 'POST', {}, m)).body.error, 'cannot_book_own_session');
  const det = (await call(`/sessions/${id}`, 'GET', null, m)).body;
  assert.equal(det.bookings.length, 1); assert.equal(det.isMentor, true);
  assert.equal((await call(`/sessions/${id}`, 'GET', null, x)).body.bookings, undefined); // others never see who booked
  const bid = det.bookings[0].id;
  assert.equal((await call(`/bookings/${bid}/accept`, 'POST', {}, l)).status, 404); // learner can't accept
  assert.equal((await call(`/bookings/${bid}/accept`, 'POST', {}, x)).status, 404);
  assert.equal((await call(`/bookings/${bid}/accept`, 'POST', {}, m)).body.status, 'confirmed');
  assert.ok((await notes(l)).includes('booking_confirmed'));
  assert.equal((await call(`/sessions/${id}/book`, 'POST', {}, x)).body.error, 'full'); // capacity 1
  assert.equal((await call(`/bookings/${bid}/review`, 'POST', { rating: 5 }, l)).body.error, 'not_reviewable'); // not held yet
  assert.equal((await call(`/sessions/${id}/complete`, 'POST', {}, m)).body.error, 'not_started_yet');
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE), duration_min = 60 WHERE id = ?', [id]); // started, but under a third done
  assert.equal((await call(`/sessions/${id}/complete`, 'POST', {}, m)).body.error, 'not_started_yet');
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_SUB(NOW(), INTERVAL 21 MINUTE) WHERE id = ?', [id]); // past a third of 60 minutes
  assert.equal((await call(`/sessions/${id}/complete`, 'POST', {}, l)).status, 404);
  assert.equal((await call(`/sessions/${id}/complete`, 'POST', {}, m)).status, 200);
  assert.ok((await notes(l)).includes('session_completed'));
  assert.equal((await call(`/bookings/${bid}/review`, 'POST', { rating: 6 }, l)).status, 400);
  assert.equal((await call(`/bookings/${bid}/review`, 'POST', { rating: 4, comment: 'Great' }, x)).status, 404);
  assert.equal((await call(`/bookings/${bid}/review`, 'POST', { rating: 5, comment: 'Great mentor' }, l)).status, 201);
  assert.equal((await call(`/bookings/${bid}/review`, 'POST', { rating: 1 }, l)).body.error, 'already_reviewed');
  assert.equal((await call(`/bookings/${bid}/review`, 'POST', { rating: 4 }, m)).status, 201); // mentors review learners too
  // the Mentor's review of the Learner is Learner reputation: it must NOT touch the Learner's Mentor rating
  const [[lrow]] = await pool.query('SELECT rating_avg, rating_count FROM users WHERE username = ?', [l.username]);
  assert.equal(lrow.rating_avg, null); assert.equal(lrow.rating_count, 0);
  const lrev = (await call(`/users/${l.username}/reviews`)).body;
  assert.equal(lrev.count, 0); assert.equal(lrev.asLearner.count, 1); assert.equal(lrev.asLearner.avg, 4);
  const mnote = (await call('/notifications', 'GET', null, m)).body.notifications.find((n) => n.type === 'review_received');
  assert.equal(mnote.link, `/u/${m.username}`); // links to your own profile, where the review lives
  const rv = (await call(`/users/${m.username}/reviews`)).body;
  assert.equal(rv.count, 1); assert.equal(rv.avg, 5); assert.equal(rv.reviews[0].reviewer.username, l.username);
  const prof = (await call(`/users/${m.username}`)).body; assert.ok(prof);
  const [[row]] = await pool.query('SELECT rating_avg, rating_count FROM users WHERE username = ?', [m.username]); assert.equal(Number(row.rating_avg), 5);
  assert.deepEqual((await call('/sessions/mine?role=learner&when=past', 'GET', null, l)).body.sessions.map((s) => s.bookingStatus), ['completed']);
});

test('capacity race: concurrent bookings and concurrent accepts never overbook', async () => {
  const mentor = await makeUser('m3'), learners = await Promise.all([1, 2, 3, 4].map((i) => makeUser('lr' + i, { mentors: false })));
  const auto = await makeSession(mentor, { capacity: 2, autoAccept: true, startsAt: inHours(24) });
  const rs = await Promise.all(learners.map((l) => call(`/sessions/${auto}/book`, 'POST', {}, l)));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 201, 409, 409]);
  const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM bookings WHERE session_id = ? AND status = 'confirmed'", [auto]); assert.equal(n, 2);
  // manual approval: 2 requests for 1 seat, mentor accepts both at once => exactly one wins
  const s2 = await makeSession(mentor, { capacity: 2, startsAt: inHours(96) });
  await pool.query('UPDATE learning_sessions SET capacity = 3 WHERE id = ?', [s2]); // allow three requests...
  for (const l of learners.slice(0, 3)) await call(`/sessions/${s2}/book`, 'POST', {}, l);
  await pool.query('UPDATE learning_sessions SET capacity = 1 WHERE id = ?', [s2]); // ...then shrink to one seat
  const bs = (await call(`/sessions/${s2}`, 'GET', null, mentor)).body.bookings;
  const acc = await Promise.all(bs.map((b) => call(`/bookings/${b.id}/accept`, 'POST', {}, mentor)));
  assert.deepEqual(acc.map((r) => r.status).sort(), [200, 409, 409]);
});

test('reject, cancel, reschedule, mentor-cancel notify the right people; paid => awaiting_payment', async () => {
  const [m, a, b] = await Promise.all([makeUser('m4'), makeUser('a4', { mentors: false }), makeUser('b4', { mentors: false })]);
  const id = await makeSession(m, { capacity: 3, pricing: 'paid', pricePaise: 25000 });
  await call(`/sessions/${id}/book`, 'POST', {}, a); await call(`/sessions/${id}/book`, 'POST', {}, b);
  const bk = (await call(`/sessions/${id}`, 'GET', null, m)).body.bookings;
  assert.equal((await call(`/bookings/${bk[0].id}/accept`, 'POST', {}, m)).body.status, 'awaiting_payment'); // not confirmed until paid (Phase 6)
  assert.equal((await call(`/bookings/${bk[1].id}/reject`, 'POST', {}, m)).status, 200);
  assert.ok((await notes(b)).includes('booking_rejected'));
  assert.equal((await call(`/sessions/${id}/book`, 'POST', {}, b)).body.error, 'previously_declined');
  // reschedule notifies active bookers only; overlap and past are refused
  assert.equal((await call(`/sessions/${id}`, 'PATCH', { startsAt: inHours(0.01) }, m)).body.error, 'must_be_in_future');
  assert.equal((await call(`/sessions/${id}`, 'PATCH', { capacity: 0 }, m)).status, 400);
  assert.equal((await call(`/sessions/${id}`, 'PATCH', { startsAt: inHours(120) }, a)).status, 404);
  assert.equal((await call(`/sessions/${id}`, 'PATCH', { startsAt: inHours(120) }, m)).status, 200);
  assert.ok((await notes(a)).includes('session_rescheduled')); assert.ok(!(await notes(b)).includes('session_rescheduled'));
  // learner cancels -> mentor notified; seat freed
  assert.equal((await call(`/bookings/${bk[0].id}/cancel`, 'POST', {}, a)).status, 200);
  assert.ok((await notes(m)).includes('booking_cancelled'));
  assert.equal((await call(`/bookings/${bk[0].id}/cancel`, 'POST', {}, a)).body.error, 'not_cancellable');
  assert.equal((await call(`/sessions/${id}/book`, 'POST', {}, a)).status, 201); // may rebook after cancelling
  // mentor cancels the whole session
  assert.equal((await call(`/sessions/${id}/cancel`, 'POST', { reason: 'Ill' }, b)).status, 404);
  assert.equal((await call(`/sessions/${id}/cancel`, 'POST', { reason: 'Ill' }, m)).status, 200);
  assert.ok((await notes(a)).includes('session_cancelled'));
  assert.equal((await call(`/sessions/${id}/book`, 'POST', {}, b)).body.error, 'not_bookable');
  assert.equal((await call(`/sessions/${id}/cancel`, 'POST', {}, m)).body.error, 'not_cancellable');
});

test('browse: filters, hides full/own/blocked, validation', async () => {
  const [m, v, blocker] = await Promise.all([makeUser('m5'), makeUser('v5', { mentors: false }), makeUser('k5')]);
  const free = await makeSession(m, { title: `Unique ${run} free`, startsAt: inHours(30) });
  const paid = await makeSession(m, { title: `Unique ${run} paid`, startsAt: inHours(40), pricing: 'paid', pricePaise: 10000, capacity: 5 });
  const find = async (qs, who) => (await call(`/sessions?q=Unique ${run}&${qs}`, 'GET', null, who)).body.sessions.map((s) => s.id);
  assert.deepEqual(await find('', v), [free, paid]); // soonest first
  assert.deepEqual(await find('pricing=paid', v), [paid]);
  assert.deepEqual(await find('kind=group', v), [paid]);
  assert.deepEqual(await find('', m), []); // not your own
  await call(`/sessions/${free}/book`, 'POST', {}, v); const bid = (await call(`/sessions/${free}`, 'GET', null, m)).body.bookings[0].id;
  await call(`/bookings/${bid}/accept`, 'POST', {}, m);
  assert.deepEqual(await find('', blocker), [paid]); // the full one is gone
  await call('/blocks', 'POST', { username: m.username }, blocker);
  assert.deepEqual(await find('', blocker), []);
  assert.equal((await call(`/sessions/${paid}`, 'GET', null, blocker)).status, 404);
  assert.equal((await call('/sessions?pricing=bogus', 'GET', null, v)).status, 400);
  for (const bad of ['abc', '1e3', '-1', '99999999999999999999']) assert.equal((await call(`/sessions/${bad}`, 'GET', null, v)).status, 404, bad); // bad ids are 404, never a SQL 500
  assert.equal((await call('/conversations/abc', 'GET', null, v)).status, 404);
  assert.equal((await call('/bookings/abc/accept', 'POST', {}, v)).status, 404);
});

test('running sessions can change duration; scheduled-session cap per mentor', async () => {
  const m = await makeUser('m7');
  const id = await makeSession(m);
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE) WHERE id = ?', [id]); // already started
  assert.equal((await call(`/sessions/${id}`, 'PATCH', { durationMin: 90 }, m)).status, 200);
  assert.equal((await call(`/sessions/${id}`, 'PATCH', { startsAt: inHours(0.01) }, m)).body.error, 'must_be_in_future');
  const [[{ uid }]] = await pool.query('SELECT id uid FROM users WHERE username = ?', [m.username]);
  const rows = Array.from({ length: 49 }, (_, i) => [uid, GUITAR, `Filler ${i}`, new Date(Date.now() + (500 + i * 2) * 3600_000), 30]);
  await pool.query("INSERT INTO learning_sessions (mentor_id, skill_id, title, starts_at, duration_min) VALUES ?", [rows]);
  assert.equal((await call('/sessions', 'POST', mk({ startsAt: inHours(900) }), m)).status, 429); // 50 scheduled already
});

test('reminders fire once for sessions starting within 30 minutes', async () => {
  const [m, l] = await Promise.all([makeUser('m6'), makeUser('l6', { mentors: false })]);
  const id = await makeSession(m, { startsAt: inHours(24), autoAccept: true });
  await call(`/sessions/${id}/book`, 'POST', {}, l);
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_ADD(NOW(), INTERVAL 20 MINUTE) WHERE id = ?', [id]);
  await sendReminders(); await sendReminders();
  assert.equal((await notes(l)).filter((t) => t === 'session_reminder').length, 1);
  assert.equal((await notes(m)).filter((t) => t === 'session_reminder').length, 1);
});

test('repeat weekly: creates the series or nothing; calendar file', async () => {
  const m = await makeUser('m9'), l = await makeUser('l9', { mentors: false });
  const r = await call('/sessions', 'POST', mk({ title: 'Chords; part 1, intro', startsAt: inHours(48), weeks: 3 }), m);
  assert.equal(r.status, 201); assert.equal(r.body.ids.length, 3); assert.equal(r.body.id, r.body.ids[0]);
  const starts = await Promise.all(r.body.ids.map(async (id) => new Date((await call(`/sessions/${id}`, 'GET', null, m)).body.startsAt).getTime()));
  assert.deepEqual(starts.map((t) => t - starts[0]), [0, 7 * 86_400_000, 14 * 86_400_000]);
  // week 2 of a new series would land on week 3 of the first: nothing is created
  assert.equal((await call('/sessions', 'POST', mk({ startsAt: inHours(48 + 7 * 24), weeks: 2 }), m)).body.error, 'overlaps_another_session');
  assert.equal((await call('/sessions/mine', 'GET', null, m)).body.sessions.length, 3);
  assert.equal((await call('/sessions', 'POST', mk({ startsAt: inHours(72), weeks: 13 }), m)).status, 400);

  const ics = await fetch(`${base}/sessions/${r.body.id}/calendar.ics`, { headers: { cookie: l.cookie } });
  assert.equal(ics.status, 200); assert.match(ics.headers.get('content-type'), /text\/calendar/);
  const text = await ics.text();
  assert.match(text, /^BEGIN:VCALENDAR\r\n/); assert.ok(text.includes('SUMMARY:Chords\\; part 1\\, intro\r\n'));
  assert.ok(text.includes(`DTSTART:${new Date(starts[0]).toISOString().replace(/[-:]|\.\d{3}/g, '')}\r\n`));
  assert.equal((await fetch(`${base}/sessions/${r.body.id}/calendar.ics`)).status, 401);
});

test('private sessions: only invited connections see and book them; live sessions can be joined while running', async () => {
  const [m, friend, stranger] = await Promise.all([makeUser('pv1'), makeUser('pv2', { mentors: false }), makeUser('pv3', { mentors: false })]);
  const idOf = async (u) => (await pool.query('SELECT id FROM users WHERE username = ?', [u.username]))[0][0].id;
  await pool.query("INSERT INTO connections (requester_id, addressee_id, status) VALUES (?,?,'accepted')", [await idOf(m), await idOf(friend)]);
  const made = await call('/sessions', 'POST', mk({ title: 'Private jam', startsAt: inHours(30), visibility: 'private', invite: [friend.username, stranger.username], capacity: 3, autoAccept: true }), m);
  assert.equal(made.status, 201); assert.equal(made.body.invited, 1); // the stranger isn't a connection, so is skipped
  const sid = made.body.id;
  assert.ok((await notes(friend)).includes('session_invite')); assert.ok(!(await notes(stranger)).includes('session_invite'));
  const browse = async (u, q = '') => (await call(`/sessions?skillId=${GUITAR}${q}`, 'GET', null, u)).body.sessions.map((s) => s.id);
  assert.ok((await browse(friend)).includes(sid)); assert.ok(!(await browse(stranger)).includes(sid));
  assert.equal((await call(`/sessions/${sid}`, 'GET', null, stranger)).status, 404);
  assert.equal((await call(`/sessions/${sid}/calendar.ics`, 'GET', null, stranger)).status, 404);
  assert.equal((await call(`/sessions/${sid}/book`, 'POST', {}, stranger)).status, 404);
  assert.equal((await call(`/sessions/${sid}`, 'GET', null, friend)).body.visibility, 'private');
  assert.equal((await call(`/sessions/${sid}/book`, 'POST', {}, friend)).body.status, 'confirmed');
  assert.equal((await call(`/sessions/${sid}/invites`, 'POST', { usernames: [stranger.username] }, friend)).status, 403); // only the mentor invites
  // live now: once it has started it shows under when=live and can still be joined until it ends
  const pub = await makeSession(m, { title: 'Open jam', startsAt: inHours(60), capacity: 5, autoAccept: true });
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE) WHERE id = ?', [pub]);
  assert.ok((await browse(stranger, '&when=live')).includes(pub)); assert.ok(!(await browse(stranger)).includes(pub));
  assert.equal((await call(`/sessions/${pub}/book`, 'POST', {}, stranger)).body.status, 'confirmed');
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR) WHERE id = ?', [pub]);
  assert.equal((await call(`/sessions/${pub}/book`, 'POST', {}, friend)).body.error, 'not_bookable'); // over
});

test('delete account: code by email, wrong code refused, blocked while booked, then anonymised and re-registrable', async () => {
  const [m, l] = await Promise.all([makeUser('da1'), makeUser('da2', { mentors: false })]);
  const codeFor = (u) => sent.filter((x) => x.to === u.email && /deletion code/.test(x.subject)).at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
  // l has a confirmed seat in m's upcoming session: neither can delete yet
  const sid = await makeSession(m, { title: 'Before goodbye', startsAt: inHours(40), autoAccept: true });
  assert.equal((await call(`/sessions/${sid}/book`, 'POST', {}, l)).body.status, 'confirmed');
  assert.equal((await call('/me/delete/request', 'POST', {}, l)).body.error, 'has_upcoming_bookings');
  assert.equal((await call('/me/delete/request', 'POST', {}, m)).body.error, 'has_booked_sessions');
  await call(`/sessions/${sid}/cancel`, 'POST', { reason: 'test' }, m);
  // now l can: request a code, a wrong one fails, the right one deletes
  const req = await call('/me/delete/request', 'POST', {}, l); assert.equal(req.status, 200); assert.match(req.body.to, /•••@/);
  const code = codeFor(l); assert.ok(code);
  assert.equal((await call('/me/delete/confirm', 'POST', { code: code === '123456' ? '654321' : '123456' }, l)).body.error, 'invalid_code');
  assert.equal((await call('/me/delete/confirm', 'POST', { code }, l)).status, 200);
  assert.equal((await call('/me/delete/confirm', 'POST', { code }, l)).status, 401); // signed out everywhere
  const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: l.email, password: l.password }) });
  assert.equal(login.status, 401);
  assert.equal((await call(`/users/${l.username}`, 'GET', null, m)).status, 404);
  // the email is free again
  const again = await call('/auth/register', 'POST', { email: l.email, username: `r${l.username}`.slice(0, 20), password: 'correct horse 1', fullName: 'Back again' });
  assert.equal(again.status, 201);
});
