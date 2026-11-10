# Deploying SkillSwap (free stack): Vercel + Render + Neon

```
Browser ──► Vercel (React site)
              ├─ /api/*, /uploads/*  ── rewrite ──►  Render (Express + Socket.IO + jobs) ──► Neon (PostgreSQL)
              └─ everything else → index.html
Browser ──► wss://Render   (live chat/notifications; logs in with a short-lived signed token)
Browser ──► LiveKit Cloud (video rooms)      Razorpay ──► Render /api/v1/webhooks/razorpay
```

## 1. Neon (database)
Create a project at neon.tech, copy the **connection string** (`postgresql://…?sslmode=require`). Nothing else to do:
the API creates the tables itself on startup (`server/migrations/001_schema.sql`, uses the built-in `citext` extension).

## 2. Render (API)
1. New > Blueprint > pick this repo (it reads `render.yaml`), or New > Web Service > Docker.
2. Set `DATABASE_URL` (Neon string), `WEB_ORIGIN` (your Vercel URL, no trailing slash). `JWT_SECRET` is generated for you.
   Optional: SMTP, Razorpay test keys, LiveKit (see `.env.example`). For email, `MAIL_FROM` must be an address your SMTP
   service has verified as a sender (Brevo: Senders, domains & dedicated IPs), e.g. `SkillSwap <you@yourdomain.com>`;
   mail from an unverified sender is silently dropped. New migrations are applied on every startup.
3. After deploy, `https://<service>.onrender.com/api/v1/health` should return `{"ok":true,"db":"up"}`.

Free-plan limits (check Render's current terms): the service sleeps after idle time and wakes on the next request, so
reminders/refund retries only run while it is awake, live connections drop when it sleeps, and there is no persistent disk,
so uploads would vanish on redeploy; `render.yaml` therefore sets `FILE_STORE=db`, which also keeps every avatar and chat attachment
in Postgres and serves it from there (fine for avatars and small files; use object storage for large media). A free uptime pinger
hitting `/api/v1/health` every 10 minutes keeps the API awake but may exceed free hours.

## 3. Vercel (website)
1. Import the repo, **Root Directory `web`**.
2. `web/vercel.json` sends `/api/*` and `/uploads/*` to the Render service. If your service URL differs, change the host there, commit and push.
3. Environment variable `VITE_REALTIME_URL` = `https://<service>.onrender.com`.

## 4. First admin
Register an account, then run `npm run make-admin -w server -- <your-id>` against the same `DATABASE_URL`
(Render shell, or locally with `DATABASE_URL` set). An **Admin** link then appears in the top bar.

Optional demo data: `npm run seed` (refuses to run when `NODE_ENV=production`; use it on a staging database).

## 5. Razorpay webhook
Dashboard > Settings > Webhooks: `https://<service>.onrender.com/api/v1/webhooks/razorpay`, a secret (= `RAZORPAY_WEBHOOK_SECRET`),
events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.

## Local development
Any PostgreSQL 14+ with the `citext` extension: set `DATABASE_URL`, run `npm run migrate`, `npm run dev`, `npm test`.

## Known limits
Single API instance (presence and job timers are in memory). Uploads are on disk, mirrored in Postgres when `FILE_STORE=db`. Payouts are marked paid by an admin by hand.
Deployed on Neon + Render + Vercel. The 57 tests run against a local PostgreSQL 18; a real Razorpay payment, real email delivery and two-person video still need a manual check.
