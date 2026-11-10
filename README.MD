# SkillSwap

A peer-to-peer skill exchange platform. Everyone is both a **Mentor** (what they can teach) and a **Learner** (what they want to learn), and chooses how value moves: free, paid, or a straight swap. Find people with a ranked **Best Match** list, connect, chat, book a **Learning Session**, pay, and meet in a built-in **Meeting Room** with screen sharing.

Express + PostgreSQL on the server, React + Vite on the web. Free to host (Vercel + Render + Neon): see [DEPLOY.md](DEPLOY.md).

## What's in it

| Area | What it does |
|---|---|
| Accounts | Register, email verification, log in by email or user ID, password reset, onboarding in four steps, public profile at `/u/<id>` |
| Discover | Best Match ranking by default (skill fit, level, price, time-zone availability, language, teaching style, rating, profile completeness). Filters and other sorts. Weights are editable by an admin |
| Connections | Requests, accept/reject, block, report. Live notifications |
| Chat | Direct and group chats, read receipts, typing, presence, attachments, edit your own messages, emoji reactions, search within a chat |
| Sessions | One-on-one and group Learning Sessions, capacity enforced under a row lock, approval or instant booking, weekly repeat (up to 12 weeks), add-to-calendar file, cancel and reschedule, reminders, two-way reviews that feed ratings |
| Payments | Razorpay checkout, signature-verified webhooks, refund policy, receipts, mentor earnings and payout requests |
| Meeting Rooms | Video, audio, screen share, waiting room, host and co-host controls, hand raise, in-room chat (LiveKit) |
| Admin | Overview and charts, people, reports, payments and refunds, disputes, payouts, skills, platform settings and ranking weights, audit log |

The landing page is a WebGL ray-traced vinyl record: scrolling flies a camera down into a groove, pulls back and flips to Side B. It falls back to a CSS record when WebGL2 is unavailable.

## Run it locally

You need Node 22+, PostgreSQL 14+ (with the `citext` extension, which ships with PostgreSQL), and for video rooms a LiveKit server.

```bash
npm install
cp .env.example .env          # then set DATABASE_URL and JWT_SECRET (see below)
npm run migrate               # creates the tables and the skill catalogue
npm run seed                  # optional: 10 demo people and 6 sessions
npm run dev                   # API on :4000, web on :5173
```

Open http://localhost:5173. With no SMTP configured, emails (verification, password reset) are printed in the API console instead of being sent.

Your first admin: register, verify, then `npm run make-admin -w server -- <your-id>`. An **Admin** link appears in the top bar.

### Environment (`.env`)

| Variable | Needed | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://user:pass@host/db`. On Neon, use the string with `?sslmode=require` |
| `JWT_SECRET` | yes | 16+ characters. Signs the short-lived live-socket token |
| `WEB_ORIGIN` | in production | Your site's URL: CORS and links in emails |
| `SMTP_*`, `MAIL_FROM` | for real email | Any SMTP service (Brevo has a free plan) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | for paid sessions | Use **test** keys while building |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | for Meeting Rooms | Local: `livekit-server --dev` gives `ws://127.0.0.1:7880`, key `devkey`. Production: LiveKit Cloud |
| `FILE_STORE=db` | on hosts with an ephemeral disk | Also keeps avatars and attachments in Postgres |
| `UPLOAD_DIR`, `TRUST_PROXY` | optional | Upload folder, and how many proxies sit in front of the API |

### Scripts

| Command | |
|---|---|
| `npm run dev` | API and web together with reload |
| `npm test` | Server test suite (needs `DATABASE_URL` for a scratch database and a LiveKit server on 7880) |
| `npm run migrate` | Applies `server/migrations/*.sql` in order, once each |
| `npm run seed` | Demo data. Re-runnable. Refuses to run with `NODE_ENV=production` |
| `npm run build -w web` | Production build of the site into `web/dist` |

## How it is put together

```
server/src/
  app.js, index.js     Express app, HTTP + Socket.IO server, background jobs
  db.js                PostgreSQL pool, transactions with deadlock retry
  auth/ people/ social/ chat/ sessions/ payments/ meetings/ admin/    one folder per area: routes (+ service)
  people/ranking.js    Best Match scoring
  files.js             durable upload store (FILE_STORE=db)
server/migrations/     SQL schema and seed catalogue
web/src/pages/         one file per screen; components/ shared UI; Record3D.jsx is the landing record
```

Design choices worth knowing:

- **Sessions, not JWT.** Login sets an httpOnly cookie that maps to a server-side session, so a suspended person is signed out immediately. A signed token authenticates the live socket across origins.
- **Money is careful.** Amounts are integers in paise. Booking a seat, taking a payment and refunding all run in transactions with row locks. Razorpay webhooks are idempotent, and a lost refund reply is safe to retry.
- **Ranking is explainable.** Each Best Match card lists the reasons. Missing data is skipped rather than penalised, and the weights live in the database.
- **Everything privileged is checked on the server.** The Admin page hides itself from other people, but every `/admin` API call checks the role again.

## Testing

`npm test` runs 57 tests against a real database: auth, onboarding and ranking, connections, chat, sessions and bookings (including concurrent seat races), payments against a fake gateway with real signatures, meeting-room access, admin, and durable uploads. Payments have not been run against the real Razorpay gateway, and multi-person video has not been exercised end to end. See [CHECKLIST.md](CHECKLIST.md).

## Known limits

- One API instance: presence and job timers are held in memory.
- Free hosting sleeps when idle, so reminders only run while the API is awake.
- Uploads are kept in Postgres when `FILE_STORE=db`, which suits avatars and small attachments, not large media.
- Payouts to mentors are sent by an admin by hand, then marked paid.
- Screen sharing is not available in phone browsers.

## History

SkillSwap began as a single-file prototype (`archive/index_1.html`) with mock data and client-side matching. This repository is the full-stack rebuild.
