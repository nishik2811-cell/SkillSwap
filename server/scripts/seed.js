// Demo data so Discover, sessions and the admin panel have something to show.
// Usage: npm run seed -w server            (all accounts share one demo password, printed at the end)
//        SEED_PASSWORD=... npm run seed -w server
// Safe to re-run: existing usernames are skipped. Refuses to run with NODE_ENV=production unless you pass --force.
import { pool, inTx } from '../src/db.js';
import { hashPassword } from '../src/auth/crypto.js';

if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) { console.error('Refusing to seed a production database. Pass --force if you really mean it.'); process.exit(1); }
const PASSWORD = process.env.SEED_PASSWORD || 'demo-pass-123';
const pw = hashPassword(PASSWORD);
const paise = (r) => r * 100;

// [username, full name, location, languages, bio, mentoring[], learning[]]
// mentoring: [skill, level, pricing, minRs, maxRs, style]    learning: [skill, level wanted, prefers, maxRs]
const PEOPLE = [
  ['asha_rao', 'Asha Rao', 'Pune', ['English', 'Hindi'], 'Backend engineer. I like explaining things with small, real projects.', [['Python', 'expert', 'paid', 400, 700, 'one_on_one'], ['JavaScript', 'advanced', 'both', 300, 500, 'group']], [['Guitar', 'beginner', 'either', 500]]],
  ['dev_menon', 'Dev Menon', 'Bengaluru', ['English', 'Tamil'], 'Product designer. Figma, systems, and critique that is kind but honest.', [['UI/UX Design', 'expert', 'paid', 500, 900, 'interactive']], [['Python', 'beginner', 'either', 400], ['Photography', 'beginner', 'free', 0]]],
  ['meera_iyer', 'Meera Iyer', 'Chennai', ['English', 'Tamil', 'Hindi'], 'Carnatic vocalist turned piano teacher. Patient with absolute beginners.', [['Piano', 'advanced', 'paid', 300, 500, 'one_on_one']], [['Spanish', 'beginner', 'free', 0]]],
  ['rohan_k', 'Rohan Kapoor', 'Delhi', ['English', 'Hindi', 'Punjabi'], 'Wedding and street photographer. Weekend workshops around the city.', [['Photography', 'advanced', 'paid', 400, 600, 'workshop'], ['Video Editing', 'intermediate', 'free', null, null, 'group']], [['Cooking', 'beginner', 'either', 300]]],
  ['sofia_m', 'Sofia Martinez', 'Madrid', ['Spanish', 'English'], 'Native Spanish speaker. Conversation first, grammar when you need it.', [['Spanish', 'expert', 'both', 250, 450, 'interactive'], ['English', 'advanced', 'free', null, null, 'one_on_one']], [['Hindi', 'beginner', 'free', 0], ['Guitar', 'beginner', 'either', 400]]],
  ['arjun_p', 'Arjun Patel', 'Ahmedabad', ['English', 'Hindi'], 'Frontend developer. React, CSS, and making things feel fast.', [['JavaScript', 'expert', 'paid', 350, 600, 'one_on_one'], ['UI/UX Design', 'intermediate', 'free', null, null, 'group']], [['Piano', 'beginner', 'either', 300]]],
  ['nisha_b', 'Nisha Banerjee', 'Kolkata', ['English', 'Bengali', 'Hindi'], 'Home cook. Bengali and Mughlai, from scratch, no shortcuts.', [['Cooking', 'expert', 'paid', 200, 400, 'workshop']], [['Photography', 'beginner', 'free', 0], ['Python', 'beginner', 'free', 0]]],
  ['vikram_s', 'Vikram Singh', 'Jaipur', ['English', 'Hindi'], 'Fitness coach. Strength basics, mobility, and not hurting yourself.', [['Fitness', 'advanced', 'paid', 300, 500, 'one_on_one']], [['Video Editing', 'beginner', 'either', 300]]],
  ['lena_w', 'Lena Weber', 'Berlin', ['German', 'English'], 'Data analyst. SQL and Python for people who hate spreadsheets.', [['Data Analysis', 'expert', 'paid', 450, 800, 'one_on_one'], ['English', 'advanced', 'both', 300, 500, 'interactive']], [['Hindi', 'beginner', 'free', 0]]],
  ['kabir_j', 'Kabir Joshi', 'Mumbai', ['English', 'Hindi', 'Marathi'], 'Acoustic guitarist. Chords, rhythm, and your first three songs.', [['Guitar', 'advanced', 'both', 250, 450, 'one_on_one']], [['Cooking', 'beginner', 'free', 0], ['JavaScript', 'beginner', 'either', 300]]],
];
const SESSIONS = [
  ['asha_rao', 'Python for absolute beginners', 'Variables, loops, and a tiny project. Bring a laptop.', 'Python', 3, 60, 8, 'paid', 349, true],
  ['meera_iyer', 'Piano: your first song in an hour', 'Read two hands, play a simple melody. Keyboard or piano.', 'Piano', 5, 60, 1, 'paid', 299, false],
  ['sofia_m', 'Spanish conversation circle', 'Relaxed, in Spanish, all levels. We correct gently.', 'Spanish', 2, 45, 12, 'free', null, true],
  ['rohan_k', 'Golden-hour photo walk', 'Light, framing and candid portraits. Camera or phone.', 'Photography', 7, 120, 10, 'paid', 499, false],
  ['arjun_p', 'CSS layout without the pain', 'Grid and flexbox, live. Questions welcome.', 'JavaScript', 4, 60, 20, 'free', null, true],
  ['lena_w', 'SQL for spreadsheet people', 'Turn a messy table into answers. Free first session.', 'Data Analysis', 6, 90, 6, 'free', null, false],
];

const [skillRows] = await pool.query('SELECT id, name FROM skills');
const skill = Object.fromEntries(skillRows.map((s) => [s.name, s.id]));
const id = (name) => { if (!skill[name]) throw new Error(`Unknown skill "${name}". Run the migrations first.`); return skill[name]; };

let created = 0;
for (const [username, name, location, langs, bio, mentoring, learning] of PEOPLE) {
  const [[exists]] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) continue;
  await inTx(async (c) => {   // one person = one transaction: a typo can never leave a half-built account behind
    const [r] = await c.query(`INSERT INTO users (email, username, password_hash, full_name, bio, location, timezone, preferred_language, email_verified_at, onboarding_done, last_active_at)
      VALUES (?,?,?,?,?,?,?,?, NOW(), TRUE, NOW())`, [`${username}@example.com`, username, pw, name, bio, location, 'Asia/Kolkata', langs[0]]);
    const uid = r.insertId;
    for (const l of langs) await c.query('INSERT INTO user_languages (user_id, language) VALUES (?,?)', [uid, l]);
    for (const [s, level, pricing, lo, hi, style] of mentoring) await c.query('INSERT INTO mentor_skills (user_id, skill_id, level, years_experience, pricing, price_min_paise, price_max_paise, teaching_style) VALUES (?,?,?,?,?,?,?,?)',
      [uid, id(s), level, 3 + (uid % 8), pricing, pricing === 'free' ? null : paise(lo), pricing === 'free' ? null : paise(hi), style]);
    for (const [s, level, prefers, max] of learning) await c.query('INSERT INTO learner_skills (user_id, skill_id, current_level, desired_level, prefers, max_price_paise, learning_style) VALUES (?,?,?,?,?,?,?)',
      [uid, id(s), 'none', level, prefers, prefers === 'free' ? null : paise(max), 'one_on_one']);
    for (const wd of [1, 3, 5]) await c.query('INSERT INTO availability_slots (user_id, weekday, start_time, end_time) VALUES (?,?,?,?)', [uid, wd, '18:00', '21:00']);   // weekday evenings (IST)
    await c.query('INSERT INTO availability_slots (user_id, weekday, start_time, end_time) VALUES (?,?,?,?)', [uid, 5, '10:00', '13:00']);
  });
  created++;
}

let sessions = 0;
for (const [mentor, title, desc, s, inDays, dur, cap, pricing, price, auto] of SESSIONS) {
  const [[m]] = await pool.query('SELECT id FROM users WHERE username = ?', [mentor]); if (!m) continue;
  const [[dupe]] = await pool.query('SELECT id FROM learning_sessions WHERE mentor_id = ? AND title = ?', [m.id, title]); if (dupe) continue;
  await pool.query(`INSERT INTO learning_sessions (mentor_id, skill_id, title, description, starts_at, duration_min, capacity, pricing, price_paise, auto_accept)
    VALUES (?,?,?,?, date_trunc('day', NOW()) + (? * INTERVAL '1 day') + INTERVAL '13 hours', ?,?,?,?,?)`, [m.id, id(s), title, desc, inDays, dur, cap, pricing, price == null ? null : paise(price), auto]);   // 13:00 UTC = 18:30 IST
  sessions++;
}
console.log(`Seeded ${created} people and ${sessions} sessions (${PEOPLE.length - created} people already existed).`);
console.log(`Log in as any of them, e.g. "${PEOPLE[0][0]}", with the password "${PASSWORD}". Demo data: do not use this on a real site.`);
await pool.end();
