# SkillSwap checklist

Terminology: Mentor / Learner / Learning Session / Meeting Room everywhere (code, DB, API, docs).

- [x] Phase 0: monorepo, Express health check, MySQL migration runner, Vite + React shell, `.env.example`
- [x] Phase 1: identity schema, auth (register, login by email or username, verify, reset, logout, username availability + suggestions), 7 tests. Server-side sessions in httpOnly cookie (no JWT). SMTP unset = link logged to server console.
- [x] Phase 2: onboarding (4 steps), settings, public profile `/u/:username`, avatar upload, Best Match discovery
  - Ranking: `server/src/people/ranking.js`, weights in `platform_settings.ranking_weights` (admin UI in Phase 8). Default sort = Best Match, computed server-side on every request. Out-of-budget Mentors listed separately. Missing data is skipped, not penalised. Blocked users excluded.
  - Pending inside Phase 2 scope: Connect/request button on cards (needs Phase 3), ratings/reviews data (Phase 5), location is display-only (time zone drives availability matching).
- [x] Phase 3: connections (send, accept, reject, cancel, remove, auto-accept on mutual request), block, report, persistent + live notifications (Socket.IO). Report review UI = Phase 8. Message/booking/payment notifications are added with their phases.
- [x] Phase 4: messaging (direct + group chats, receipts, typing, presence, attachments, message notifications). Added later: edit your own message, emoji reactions, search within a chat (migration 003).
- [x] Phase 5: learning sessions (individual + group), booking with mentor approval or instant booking, capacity enforced under a row lock, cancel/reschedule/complete, reminders, two-way reviews feeding ratings. Paid sessions stop at awaiting_payment until Phase 6. Added later: weekly repeat (one transaction, all or nothing) and a calendar (.ics) file per session.
- [x] Phase 6: payments (Razorpay) built + tested against a FAKE gateway (real HMAC signatures). NOT verified against real Razorpay: needs your test keys + a public webhook URL. Payouts: mentor request side done; admin "mark paid" screen = Phase 8.
- [x] Phase 7: meeting rooms on LiveKit (installed locally in .tools/, dev keys): rooms, waiting room, host/co-host, mute/remove/end, screen share, hand raise, data-channel chat, device pickers. Verified: real LiveKit server accepts tokens; one participant joined in the browser. NOT verified: multi-user live video/screen-share (this browser pane blocks camera/mic).
- [x] Phase 8: admin panel (`/admin`): overview and sign-up chart, people (suspend/reactivate), reports (resolve, dismiss, resolve and suspend), payments and refunds, disputes, payouts (mark paid / decline), skills and categories, platform settings with Best Match weights, audit log. The server re-checks the admin role on every call. Notes are collected with simple prompts.
- [x] Phase 9: design system + polish. Mind of Akira-style look app-wide, light and dark themes, WebGL ray-traced landing record with scroll camera (CSS fallback), mobile layouts checked at 375px for every screen (full-screen meeting room, icon controls).
- [x] Phase 10: README, `npm run seed`, durable uploads (`FILE_STORE=db`), 57 server tests. Free-stack deploy files (Neon, Render, Vercel).

## Still to do (needs you)

- [x] Deployed: Neon + Render + Vercel.
- [ ] Razorpay TEST keys and webhook, then one real test payment and refund.
- [ ] Email: set Render `MAIL_FROM` to a Brevo-verified sender, then confirm a verification email arrives.
- [ ] LiveKit Cloud keys, then a real two-person video and screen-share test (browser pane used here blocks camera and mic).
- [ ] Create your first admin: `npm run make-admin -w server -- <your-id>`.
- [ ] Turn off the old Railway/MySQL project once the Render deploy works.
- [ ] Real-phone check of touch scratching on the landing record.

## Deliberately not built

Automatic payouts (needs RazorpayX and real money; an admin pays by hand and marks it paid); multi-instance scaling (presence and timers are in memory, would need Redis).
