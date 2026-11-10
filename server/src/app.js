import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pool } from './db.js';
import { router as auth } from './auth/routes.js';
import { router as people, UPLOAD_DIR } from './people/routes.js';
import { load } from './files.js';
import { router as social } from './social/routes.js';
import { router as chat } from './chat/routes.js';
import { router as sessions } from './sessions/routes.js';
import { router as payments, webhookHandler } from './payments/routes.js';
import { router as meetings } from './meetings/routes.js';
import { router as admin } from './admin/routes.js';
import { loadUser } from './auth/middleware.js';

// one place: a trailing slash (easy to paste from the browser) would break CORS origin matching and double the slash in emailed links
if (process.env.WEB_ORIGIN) process.env.WEB_ORIGIN = process.env.WEB_ORIGIN.trim().replace(/\/+$/, '');
export const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1)); // behind the host's proxy (and Vercel's): real client IPs for rate limiting, correct https for secure cookies
app.use(helmet());
app.use(cors({ origin: process.env.WEB_ORIGIN, credentials: true }));
// the webhook signature covers the RAW bytes, so this route must be parsed as raw before express.json touches anything
app.post('/api/v1/webhooks/razorpay', express.raw({ type: '*/*', limit: '256kb' }), webhookHandler);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => loadUser(req, res, next).catch(next));

app.get('/api/v1/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

app.use('/api/v1/auth', auth);
app.use('/api/v1', people);
app.use('/api/v1', social);
app.use('/api/v1', chat);
app.use('/api/v1', sessions);
app.use('/api/v1', payments);
app.use('/api/v1', meetings);
app.use('/api/v1', admin);
app.use('/uploads', express.static(UPLOAD_DIR, { index: false, dotfiles: 'deny' }));
app.use('/uploads', async (req, res, next) => {   // not on disk (fresh deploy)? serve the durable copy
  try {
    const rel = decodeURIComponent(req.path.slice(1)), f = await load(rel, UPLOAD_DIR + rel);
    if (!f) return next();
    res.type(f.mime || 'application/octet-stream').set('Cache-Control', 'public, max-age=86400').send(f.data);
  } catch (e) { next(e); }
});

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

export default app; // Vercel imports this (no listen); local dev and Docker use src/index.js, which adds Socket.IO and the timers
