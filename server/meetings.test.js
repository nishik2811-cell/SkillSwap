import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomServiceClient } from 'livekit-server-sdk';
import { app } from './src/app.js';
import { pool } from './src/db.js';
import { sent } from './src/auth/mail.js';
import * as lk from './src/meetings/livekit.js';

const run = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}/api/v1`;
const calls = [];
lk.setRoomService({ removeParticipant: async (r, i) => { calls.push(['remove', r, i]); }, deleteRoom: async (r) => { calls.push(['end', r]); },
  getParticipant: async () => ({ tracks: [{ type: 0, sid: 'TR_1', muted: false }] }), mutePublishedTrack: async (r, i, sid) => { calls.push(['mute', r, i, sid]); },
  listParticipants: async () => [{ identity: 'a' }, { identity: 'b' }] });
const call = async (path, method = 'GET', body, who) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(who && { cookie: who.cookie }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
let GUITAR;
async function makeUser(n, mentors = false) {
  const u = { email: `${n}-${run}@test.local`, username: `v${n}${run}`.slice(0, 20), password: 'correct horse 1', fullName: `Room ${n}` };
  await call('/auth/register', 'POST', u);
  await call('/auth/verify-email', 'POST', { token: sent.filter((m) => m.to === u.email).at(-1).text.match(/token=(\S+)/)[1] });
  const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: u.email, password: u.password }) });
  const me = { ...u, cookie: r.headers.getSetCookie()[0].split(';')[0] };
  if (mentors) await call('/me/preferences', 'PUT', { mentorSkills: [{ skillId: GUITAR, level: 'expert', pricing: 'both', priceMinPaise: 20000, priceMaxPaise: 50000 }], learnerSkills: [], availability: [], languages: [], finishOnboarding: true }, me);
  return me;
}
const jwt = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
test.before(async () => { GUITAR = (await pool.query("SELECT id FROM skills WHERE name = 'Guitar'"))[0][0].id; });
test.after(async () => { srv.close(); lk.setRoomService(null); const [ids] = await pool.query('SELECT id FROM users WHERE email LIKE ?', [`%-${run}@test.local`]); if (ids.length) await pool.query('DELETE FROM users WHERE id IN (?)', [ids.map((r) => r.id)]); await pool.end(); });

test('unconfigured LiveKit says so (rooms can still be created)', async () => {
  const saved = { ...process.env }; process.env.LIVEKIT_URL = ''; process.env.LIVEKIT_API_KEY = ''; process.env.LIVEKIT_API_SECRET = '';
  const h = await makeUser('h0'); const r = await call('/rooms', 'POST', { title: 'x' }, h); assert.equal(r.status, 201);
  assert.equal((await call(`/rooms/${r.body.code}/join`, 'POST', {}, h)).body.error, 'meetings_not_configured');
  Object.assign(process.env, { LIVEKIT_URL: saved.LIVEKIT_URL, LIVEKIT_API_KEY: saved.LIVEKIT_API_KEY, LIVEKIT_API_SECRET: saved.LIVEKIT_API_SECRET });
});

test('the real LiveKit server accepts our credentials and our tokens carry the right grants', async () => {
  assert.ok(lk.configured());
  const rooms = await new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^ws/, 'http'), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET).listRooms(); // real network call
  assert.ok(Array.isArray(rooms));
  const t = await lk.joinToken({ room: 'abc-defg-hij', identity: 'someone', name: 'Some One', admin: false });
  const g = jwt(t).video; assert.deepEqual([g.room, g.roomJoin, g.canPublish, g.canSubscribe, g.canPublishData, !!g.roomAdmin], ['abc-defg-hij', true, true, true, true, false]);
});

test('ad-hoc meeting: waiting room, admit/deny, co-host, remove, mute, end', async () => {
  const [host, g1, g2, g3, outsider] = await Promise.all(['h1', 'g1', 'g2', 'g3', 'o1'].map((n) => makeUser(n)));
  assert.equal((await call('/rooms', 'POST', {})).status, 401);
  const room = await call('/rooms', 'POST', { title: 'Open office hours' }, host); assert.match(room.body.code, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  const code = room.body.code;
  const hj = await call(`/rooms/${code}/join`, 'POST', {}, host);
  assert.equal(hj.body.status, 'admitted'); const hg = jwt(hj.body.token); assert.equal(hg.sub, host.username); assert.equal(hg.video.roomAdmin, true); assert.equal(hj.body.url, process.env.LIVEKIT_URL);
  for (const g of [g1, g2, g3]) assert.equal((await call(`/rooms/${code}/join`, 'POST', {}, g)).body.status, 'waiting'); // nobody walks in without approval
  assert.equal((await call(`/rooms/${code}/waiting`, 'GET', null, g1)).status, 403);
  assert.equal((await call(`/rooms/${code}/waiting`, 'GET', null, host)).body.waiting.length, 3);
  assert.equal((await call(`/rooms/${code}/admit`, 'POST', { username: g1.username }, g2)).status, 403); // a waiting guest can't admit anyone
  assert.equal((await call(`/rooms/${code}/admit`, 'POST', { username: g1.username }, host)).status, 200);
  const j1 = await call(`/rooms/${code}/join`, 'POST', {}, g1); assert.equal(j1.body.status, 'admitted'); assert.equal(jwt(j1.body.token).video.roomAdmin, false);
  assert.equal((await call(`/rooms/${code}/admit`, 'POST', { username: g1.username }, host)).body.error, 'not_waiting');
  assert.equal((await call(`/rooms/${code}/deny`, 'POST', { username: g3.username }, host)).status, 200);
  assert.equal((await call(`/rooms/${code}/join`, 'POST', {}, g3)).body.error, 'not_allowed'); // denied stays out
  // co-host powers: can admit, cannot remove the host or end the meeting; only the host promotes
  assert.equal((await call(`/rooms/${code}/cohost`, 'POST', { username: g1.username, cohost: true }, g1)).status, 403);
  assert.equal((await call(`/rooms/${code}/cohost`, 'POST', { username: g1.username, cohost: true }, host)).status, 200);
  assert.equal(jwt((await call(`/rooms/${code}/join`, 'POST', {}, g1)).body.token).video.roomAdmin, true);
  assert.equal((await call(`/rooms/${code}/admit`, 'POST', { username: g2.username }, g1)).status, 200);
  assert.equal((await call(`/rooms/${code}/remove`, 'POST', { username: host.username }, g1)).status, 403);
  assert.equal((await call(`/rooms/${code}/end`, 'POST', {}, g1)).status, 403);
  // host removes a participant (kicked at LiveKit too) and mutes people
  assert.equal((await call(`/rooms/${code}/remove`, 'POST', { username: g2.username }, host)).status, 200);
  assert.ok(calls.some((c) => c[0] === 'remove' && c[2] === g2.username));
  assert.equal((await call(`/rooms/${code}/join`, 'POST', {}, g2)).body.error, 'not_allowed');
  await call(`/rooms/${code}/mute`, 'POST', { username: g1.username }, host); assert.ok(calls.some((c) => c[0] === 'mute' && c[2] === g1.username));
  const before = calls.length; assert.equal((await call(`/rooms/${code}/mute`, 'POST', {}, host)).status, 200); assert.ok(calls.length > before); // mute all
  assert.equal((await call(`/rooms/${code}/mute`, 'POST', { username: g1.username }, outsider)).status, 403);
  // history, then end
  assert.ok((await call('/rooms', 'GET', null, g1)).body.rooms.some((r) => r.code === code));
  assert.equal((await call(`/rooms/${code}/end`, 'POST', {}, host)).status, 200); assert.ok(calls.some((c) => c[0] === 'end' && c[1] === code));
  assert.equal((await call(`/rooms/${code}/join`, 'POST', {}, host)).status, 410);
  assert.equal((await call('/rooms/zzz-zzzz-zzz', 'GET', null, host)).status, 404);
});

test('a session room is gated by a CONFIRMED booking and by time; the client cannot talk its way in', async () => {
  const [mentor, paid, free, stranger] = await Promise.all([makeUser('m2', true), makeUser('p2'), makeUser('f2'), makeUser('s2')]);
  const mk = async (o) => (await call('/sessions', 'POST', { title: 'Class', skillId: GUITAR, startsAt: new Date(Date.now() + 48 * 3600e3 + (o.off || 0)).toISOString(), durationMin: 60, capacity: 3, autoAccept: true, ...o.body }, mentor)).body.id;
  const sid = await mk({ body: { pricing: 'paid', pricePaise: 30000 } });
  assert.equal((await call(`/sessions/${sid}/room`, 'POST', {}, paid)).status, 404); // nobody but the Mentor creates it
  const code = (await call(`/sessions/${sid}/room`, 'POST', {}, mentor)).body.code;
  assert.equal((await call(`/sessions/${sid}/room`, 'POST', {}, mentor)).body.code, code); // one room per session
  await call(`/sessions/${sid}/book`, 'POST', {}, paid);   // paid session => awaiting_payment
  await call(`/sessions/${sid}/book`, 'POST', {}, stranger); // also unpaid
  assert.equal((await call(`/sessions/${sid}/room`, 'POST', {}, paid)).status, 404); // booked but unpaid: can't even learn the code
  // too early for everyone
  assert.equal((await call(`/rooms/${code}/join`, 'POST', {}, mentor)).body.error, 'not_open_yet');
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) WHERE id = ?', [sid]);
  assert.equal((await call(`/rooms/${code}/join`, 'POST', {}, mentor)).body.status, 'admitted');
  assert.equal((await call(`/rooms/${code}/join`, 'POST', {}, paid)).body.error, 'not_allowed'); // booked but NOT paid: no access
  assert.equal((await call(`/rooms/${code}/join`, 'POST', {}, free)).body.error, 'not_allowed'); // never booked
  await pool.query("UPDATE bookings SET status = 'confirmed' WHERE session_id = ? AND learner_id = (SELECT id FROM users WHERE username = ?)", [sid, paid.username]); // what the payment webhook does
  assert.equal((await call(`/sessions/${sid}/room`, 'POST', {}, paid)).body.code, code); // confirmed learner can look it up
  assert.equal((await call(`/sessions/${sid}/room`, 'POST', {}, stranger)).status, 404);
  const ok = await call(`/rooms/${code}/join`, 'POST', {}, paid); assert.equal(ok.body.status, 'admitted'); assert.equal(jwt(ok.body.token).video.roomAdmin, false); // session rooms skip the waiting room: the booking IS the approval
  // long after it ended: closed again
  await pool.query('UPDATE learning_sessions SET starts_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 6 HOUR) WHERE id = ?', [sid]);
  assert.equal((await call(`/rooms/${code}/join`, 'POST', {}, paid)).body.error, 'not_open_yet');
});

test('a host invites only their connections; the room can carry a start time', async () => {
  const [h, f, s] = [await makeUser('i1'), await makeUser('i2'), await makeUser('i3')];
  const id = async (u) => (await pool.query('SELECT id FROM users WHERE username = ?', [u.username]))[0][0].id;
  await pool.query("INSERT INTO connections (requester_id, addressee_id, status) VALUES (?,?,'accepted')", [await id(h), await id(f)]);
  const startsAt = new Date(Date.now() + 3600e3).toISOString();
  const r = await call('/rooms', 'POST', { title: 'Study group', startsAt }, h); assert.equal(r.status, 201);
  assert.equal((await call('/rooms', 'GET', undefined, h)).body.rooms.find((x) => x.code === r.body.code).scheduledAt, startsAt);
  assert.equal((await call('/rooms', 'POST', { startsAt: 'tomorrow' }, h)).status, 400);
  const inv = await call(`/rooms/${r.body.code}/invite`, 'POST', { usernames: [f.username, s.username] }, h);
  assert.equal(inv.body.sent, 1); // the stranger is skipped
  const note = (await pool.query("SELECT link FROM notifications WHERE user_id = ? AND type = 'meeting_invite'", [await id(f)]))[0];
  assert.equal(note.length, 1); assert.equal(note[0].link, `/room/${r.body.code}`);
  assert.equal((await pool.query("SELECT 1 FROM notifications WHERE user_id = ? AND type = 'meeting_invite'", [await id(s)]))[0].length, 0);
  assert.equal((await call(`/rooms/${r.body.code}/invite`, 'POST', { usernames: [h.username] }, f)).body.error, 'not_allowed'); // only host or co-host
  assert.equal((await call(`/rooms/${r.body.code}/invite`, 'POST', { usernames: [] }, h)).status, 400);
});
