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
2. Set `DATABASE_URL` (Neon string), `WEB_ORIGIN` (your Vercel URL). `JWT_SECRET` is generated for you.
   Optional: SMTP, Razorpay test keys, LiveKit (see `.env.example`).
3. After deploy, `https://<service>.onrender.com/api/v1/health` should return `{"ok":true,"db":"up"}`.

Free-plan limits (check Render's current terms): the service sleeps after idle time and wakes on the next request, so
reminders/refund retries only run while it is awake, live connections drop when it sleeps, and there is no persistent disk,
so avatars and chat attachments disappear on redeploy. A free uptime pinger hitting `/api/v1/health` every 10 minutes
keeps it awake but may exceed free hours; use object storage for uploads before real use.

## 3. Vercel (website)
1. Import the repo, **Root Directory `web`**.
2. Edit `web/vercel.json`: replace `YOUR-API-HOST.example.com` with `<service>.onrender.com`. Commit and push.
3. Environment variable `VITE_REALTIME_URL` = `https://<service>.onrender.com`.

## 4. First admin
Register an account, then run `node server/scripts/make-admin.js <username>` against the same `DATABASE_URL`
(Render shell, or locally with `DATABASE_URL` set).

## 5. Razorpay webhook
Dashboard > Settings > Webhooks: `https://<service>.onrender.com/api/v1/webhooks/razorpay`, a secret (= `RAZORPAY_WEBHOOK_SECRET`),
events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.

## Local development
Any PostgreSQL 14+ with the `citext` extension: set `DATABASE_URL`, run `npm run migrate`, `npm run dev`, `npm test`.

## Known limits
Single API instance (presence and job timers are in memory). Uploads on local disk. Payouts are marked paid by an admin by hand.
Not yet verified on the real Neon/Render/Vercel combination: it passes all 53 tests against a local PostgreSQL 18.
