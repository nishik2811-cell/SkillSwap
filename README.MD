# SkillSwap

A peer-to-peer skill exchange platform. Users can teach what they know and learn
what they want — and choose *how* value is exchanged, not just *what*.

Currently a single-file front-end prototype (`index_1.html`) with mock data and
client-side matching logic. No backend yet.

## Concept

Every user picks one of three exchange preferences:

| Type | Meaning |
|---|---|
| 💰 **Get Paid** | Wants to be paid for teaching |
| 💵 **Willing to Pay** | Wants to pay to learn |
| 🤝 **Skill Swap Only** | No money — pure skill-for-skill barter |

Matching respects this: a "Get Paid" user only matches with a "Willing to Pay"
user, and "Skill Swap Only" users only match each other. Within a compatible
pair, matches are ranked by:

- Two-way skill fit (they teach what you want, ideally you teach what they want)
- Availability overlap (Mornings / Afternoons / Evenings / Weekends)
- Budget overlap (for money/pay pairs)
- Shared interests
- Contact-method compatibility (Chat / Video / Either)
- Teacher rating

Each candidate gets a 0–100% fit score plus human-readable reason tags
(e.g. "Two-way skill match", "Budget fits", "Evenings overlap").

## Pages

- **Home** — pitch + entry points
- **Dashboard** — quick overview + top match preview
- **Explore** — searchable/filterable directory of all users, filter by exchange type
- **Profile** — set what you teach/want, your exchange preference, budget,
  availability, and contact method
- **Matches** — full ranked match list with scores and reasons
- **Sessions** — mock upcoming/completed session log

## Running it

It's a static file — no build step, no server required.

```bash
# open directly
xdg-open index_1.html   # or just double-click it

# or serve it (useful for testing)
python3 -m http.server 8934
# then visit http://localhost:8934/index_1.html
```

## Code structure (`index_1.html`)

Everything lives in one file: markup, styles, and a `<script>` block containing:

- `currentUser` / `USERS` — mock data. `currentUser` is the logged-in user
  whose preferences drive matching; `USERS` is the directory of everyone else.
- `scoreMatch(user, candidate)` — the matching algorithm. Returns `null` if
  the pair isn't exchange-compatible or shares no relevant skill, otherwise a
  score + reasons.
- `getRankedMatches(user, pool)` — scores and sorts a pool of candidates.
- `renderMatches()`, `renderExplore()`, `renderDashboardMatch()` — re-render
  the relevant page from current state.
- `setExchangeType()`, `setMessagePref()`, `toggleAvailability()`,
  `updateBudget()`, `savePreferences()` — profile preference handlers; all
  trigger a re-render so Matches/Explore/Dashboard stay in sync.

## Known limitations (prototype stage)

- All data is in-memory — nothing persists across a page reload.
- Single hardcoded `currentUser`; no real auth or multi-user accounts.
- No backend, database, messaging, or payment integration yet.

## Roadmap ideas

- Backend + persistent storage for users, skills, and preferences
- Real messaging between matched users
- Payment handling for money/pay exchange types
- Session scheduling tied to real calendars
