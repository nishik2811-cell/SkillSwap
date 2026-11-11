# SkillSwap

**Teach what you know. Learn what you don't.**

SkillSwap is a peer-to-peer skill exchange. Everyone is both a **Mentor** (what they can teach) and a **Learner** (what they want to learn), and chooses how value moves: free, paid, or a straight swap. Find people with a ranked **Best Match** list, connect, chat, book a **Learning Session**, pay, and meet in a built-in **Meeting Room** with screen sharing.

**Live:** https://skillswap-eight-chi.vercel.app (the API runs on a free tier and sleeps when idle, so the first request after a quiet spell can take about a minute)

![Node 22+](https://img.shields.io/badge/node-22%2B-3c873a) ![PostgreSQL 14+](https://img.shields.io/badge/postgresql-14%2B-336791) ![Tests 58](https://img.shields.io/badge/tests-58%20passing-2ea44f)

## Contents

[Features](#features) · [Tech stack](#tech-stack) · [Quick start](#quick-start) · [Configuration](#configuration) · [Scripts](#scripts) · [How it works](#how-it-works) · [Project layout](#project-layout) · [Testing](#testing) · [Deployment](#deployment) · [Status and limits](#status-and-limits)

## Features

| Area | What it does |
|---|---|
| **Accounts** | Register, email verification, log in by email or user ID, password reset, four-step onboarding, public profile at `/u/<id>` |
| **Discover** | Best Match ranking by default (skill fit, level, price, time-zone availability, language, teaching style, rating, profile completeness). Filters and other sorts. Weights are editable by an admin |
| **Connections** | Requests, accept or decline, block, report. Live notifications |
| **Chat** | Direct and group chats, read receipts, typing, presence, attachments, edit your own messages, emoji reactions, search within a chat, and **schedule a meeting** straight from a conversation |
| **Sessions** | One-on-one and group Learning Sessions, capacity enforced under a row lock, approval or instant booking, weekly repeat (up to 12 weeks), add-to-calendar file, cancel and reschedule, reminders, two-way reviews that feed ratings |
| **Payments** | Razorpay checkout, signature-verified webhooks, refund policy, receipts, mentor earnings and payout requests |
| **Meeting Rooms** | Video, audio, screen share, waiting room, host and co-host controls, hand raise, in-room chat, and **invite your connections** from inside the room (LiveKit) |
| **Admin** | Overview and charts, people, reports, payments and refunds, disputes, payouts, skills, platform settings and ranking weights, audit log |
| **Landing page** | A WebGL ray-traced vinyl record: scrolling flies a camera into a groove, pulls back and flips to Side B, then a cassette timeline explains how a swap goes. Falls back to a CSS record without WebGL2, and respects reduced-motion |

Light and dark themes, and a layout that works on phones (screen sharing is a desktop-browser feature).

## Tech stack

- **Server:** Node 22, Express, PostgreSQL (`pg`), Socket.IO, Zod, Nodemailer, Multer
- **Web:** React 19, Vite, React Router, plain CSS
- **Video:** LiveKit (LiveKit Cloud in production, `livekit-server --dev` locally)
- **Payments:** Razorpay (use **test** keys while building)
- **Email:** any SMTP service (Brevo has a free plan)
- **Hosting (free):** Vercel (web) + Render (API) + Neon (database). See [DEPLOY.md](DEPLOY.md)

## Quick start

You need Node 22+, PostgreSQL 14+ (the `citext` extension ships with it) and, for video rooms, a LiveKit server.

```bash
git clone <this repo> && cd SkillSwap
npm install
cp .env.example .env     # then set DATABASE_URL and JWT_SECRET (see Configuration)
npm run migrate          # creates the tables and the skill catalogue
npm run seed             # optional: 10 demo people and 6 sessions (never on a real site)
npm run dev              # API on :4000, web on :5173
```

Open http://localhost:5173. With no SMTP configured, emails (verification, password reset) are printed in the API console instead of being sent. Demo accounts from `npm run seed` share the password printed at the end of the seed run.

**Video rooms locally:** run `livekit-server --dev` and set `LIVEKIT_URL=ws://127.0.0.1:7880`, `LIVEKIT_API_KEY=devkey` and its matching secret. Those dev keys are public defaults: never use them on a real server.

**Your first admin:** register, verify, then:

```bash
npm run make-admin -w server -- <your-id>
```

An **Admin** link then appears in the top bar.

## Configuration

Copy `.env.example` to `.env`. Never commit `.env`, and never put secrets in source files or in the web app: the Razorpay key secret and every server credential stay on the server.

| Variable | Needed | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://user:pass@host/db`. On Neon, use the string with `?sslmode=require` |
| `JWT_SECRET` | yes | 16+ characters. Signs the short-lived live-socket token |
| `WEB_ORIGIN` | in production | Your site's URL with no trailing slash: used for CORS and links in emails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | for real email | `MAIL_FROM` must be a sender your SMTP service has verified, or mail is silently dropped |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | for paid sessions | Webhook URL: `https://<api-host>/api/v1/webhooks/razorpay` |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | for Meeting Rooms | `LIVEKIT_URL` is the `wss://…` address; key and secret must be from the same LiveKit project |
| `FILE_STORE=db` | on hosts with an ephemeral disk | Also keeps avatars and attachments in Postgres |
| `UPLOAD_DIR`, `TRUST_PROXY` | optional | Upload folder, and how many proxies sit in front of the API |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API and web together, with reload |
| `npm test` | Server test suite (needs `DATABASE_URL` for a scratch database and a LiveKit server on 7880) |
| `npm run migrate` | Applies `server/migrations/*.sql` in order, once each (also runs on API startup) |
| `npm run seed` | Demo data. Re-runnable. Refuses to run with `NODE_ENV=production` |
| `npm run make-admin -w server -- <id>` | Makes an existing account an admin |
| `npm run build -w web` | Production build of the site into `web/dist` |

## How it works

```
Browser ──► Vercel (React site)
              ├─ /api/*, /uploads/*  ── rewrite ──►  Render (Express + Socket.IO + jobs) ──► Neon (PostgreSQL)
              └─ everything else → index.html
Browser ──► wss://API       live chat and notifications (short-lived signed token)
Browser ──► LiveKit         video rooms           Razorpay ──► API webhook
```

Design choices worth knowing:

- **Sessions, not JWT.** Login sets an httpOnly cookie that maps to a server-side session, so a suspended person is signed out immediately. A signed token authenticates the live socket across origins.
- **Money is careful.** Amounts are integers in paise. Booking a seat, taking a payment and refunding all run in transactions with row locks. Razorpay webhooks are idempotent, and a lost refund reply is safe to retry.
- **Ranking is explainable.** Each Best Match card lists its reasons. Missing data is skipped rather than penalised, and the weights live in the database.
- **Everything privileged is checked on the server.** The Admin page hides itself from other people, but every `/admin` call checks the role again.
- **Auth endpoints don't leak accounts.** Forgot-password and resend-verification answer the same way whether or not the account exists.

## Project layout

```
server/
  src/
    app.js, index.js     Express app, HTTP + Socket.IO server, background jobs
    db.js                PostgreSQL pool, transactions with deadlock retry
    auth/ people/ social/ chat/ sessions/ payments/ meetings/ admin/    one folder per area
    people/ranking.js    Best Match scoring
    files.js             durable upload store (FILE_STORE=db)
  migrations/            SQL schema and seed catalogue
  scripts/               seed and make-admin
web/src/
  pages/                 one file per screen (plus its CSS)
  components/            shared UI; Record3D is the landing record, CassetteTimeline the how-it-works tape
render.yaml              Render blueprint for the API
web/vercel.json          Vercel rewrites to the API
DEPLOY.md  CHECKLIST.md  hosting steps, and what is built and what still needs a manual check
```

## Testing

`npm test` runs 58 tests against a real database: auth, onboarding and ranking, connections, chat, sessions and bookings (including concurrent seat races), payments against a fake gateway with real signatures, meeting-room access and invites, admin, and durable uploads. Meeting-room tests also call a real LiveKit server.

## Deployment

The free stack (Vercel + Render + Neon) is described step by step in [DEPLOY.md](DEPLOY.md): the database string, Render environment variables, the Vercel root directory, the first admin and the Razorpay webhook. Pushing to `main` redeploys both hosts.

## Status and limits

Built and tested: everything in the feature table above, against local PostgreSQL and LiveKit.

Still needs a manual check on the live site (see [CHECKLIST.md](CHECKLIST.md)):

- A real Razorpay payment, webhook and refund (payments are tested against a fake gateway only)
- A two-person video call and screen share on production
- Email delivery to a real inbox

Known limits:

- One API instance: presence and job timers are held in memory.
- Free hosting sleeps when idle, so reminders only run while the API is awake.
- Uploads are kept in Postgres when `FILE_STORE=db`, which suits avatars and small attachments, not large media.
- Payouts to mentors are sent by an admin by hand, then marked paid.
- Screen sharing is not available in phone browsers.
- Scheduled meetings send no reminder at the start time.

## History

SkillSwap began as a single-file prototype (`archive/index_1.html`) with mock data and client-side matching. This repository is the full-stack rebuild.
