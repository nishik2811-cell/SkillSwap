# Deploying SkillSwap: website on Vercel, backend on a Node host

```
Browser ──► Vercel (React site)
              ├─ /api/*, /uploads/*  ── rewrite ──►  API host (Express + Socket.IO + jobs) ──► MySQL
              └─ everything else → index.html
Browser ──► wss://API host   (live chat/notifications, logs in with a short-lived signed token)
Browser ──► LiveKit Cloud    (video rooms)        Razorpay ──► API host /api/v1/webhooks/razorpay
```

Why two hosts: the API keeps WebSocket connections open, runs minute-by-minute jobs (reminders, releasing unpaid seats,
refund retries), stores uploads on disk and receives payment webhooks. Those need a normal, always-on process.
Vercel proxies `/api` so the login cookie stays first-party on your Vercel domain.

## 1. MySQL
Any hosted MySQL 8 (Railway MySQL, Aiven, PlanetScale-compatible, RDS...). Create an empty database and a user.

## 2. API host (Railway, Render or Fly.io)
Deploy this repo with the root `Dockerfile`. On start it applies migrations, then runs the server.

| Variable | Value |
|---|---|
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | your MySQL |
| `JWT_SECRET` | random, 16+ chars (`openssl rand -hex 32`) |
| `WEB_ORIGIN` | your Vercel URL, e.g. `https://skillswap.vercel.app` (CORS + links in emails) |
| `TRUST_PROXY` | `2` (Vercel + the host's proxy); `1` if you call the API host directly |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | your email provider. Without it, verification links are only logged. |
| `RAZORPAY_KEY_ID` `RAZORPAY_KEY_SECRET` `RAZORPAY_WEBHOOK_SECRET` | Razorpay **test** keys first |
| `LIVEKIT_URL` `LIVEKIT_API_KEY` `LIVEKIT_API_SECRET` | LiveKit Cloud project (`wss://...livekit.cloud`) |

Also:
- **Persistent volume** mounted at `/data` (uploads go to `/data/uploads`). Without a volume, avatars and attachments disappear on every deploy.
- **Health check path:** `/api/v1/health`. **Port:** `4000` (or whatever `PORT` the host sets).
- Run **exactly one instance**. Presence and the job timers live in memory, so a second instance would double-send reminders.
- First admin: open a shell on the host and run `node server/scripts/make-admin.js <username>` (the account must exist and be verified).

## 3. Razorpay webhook
Dashboard > Settings > Webhooks > add `https://<API HOST>/api/v1/webhooks/razorpay`, set a secret (same value as
`RAZORPAY_WEBHOOK_SECRET`), events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.
Point it at the API host directly, not at Vercel.

## 4. Vercel (website)
1. Import the repo. **Root Directory: `web`**. Framework: Vite (auto-detected).
2. Edit `web/vercel.json`: replace both `YOUR-API-HOST.example.com` with your API host (no scheme in the placeholder, keep `https://`). Commit.
3. Environment variable: `VITE_REALTIME_URL` = `https://<API HOST>` (the live socket connects here directly).
4. Deploy. Open the site, register, check the verification email, log in.

## 5. Quick checks after deploying
- `https://<site>/api/v1/health` returns `{"ok":true,"db":"up"}` (proves the Vercel rewrite and the database).
- Send a message between two accounts in two browsers: it should arrive instantly (proves the socket token login).
- A paid booking with Razorpay test keys: pay, then see the booking become *Confirmed* (proves the webhook).
- Upload an avatar, redeploy the API, check it is still there (proves the volume).

## Known limits
- Single API instance (see above). Scaling out needs a Redis adapter for Socket.IO and a job lock.
- Uploads use local disk on a volume, not object storage.
- Razorpay payouts to mentors are manual (admin marks them paid).
- The `Dockerfile` has not been built in my environment (no Docker available there); the server itself was started in production mode.
