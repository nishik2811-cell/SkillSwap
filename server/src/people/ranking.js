// Best Match engine: weighted, normalised, explainable. Pure functions (no DB) so it is easy to test
// and to swap for a learned model later: anything that returns the same result shape can replace scoreCandidate().
export const DEFAULT_WEIGHTS = { skill: 0.30, level: 0.10, price: 0.20, availability: 0.12, language: 0.08, style: 0.07, rating: 0.08, completeness: 0.05 };
const LV = { none: 0, beginner: 1, intermediate: 2, advanced: 3, expert: 4 };
const GROUPISH = new Set(['group', 'workshop', 'interactive']);
const RATING_PRIOR = { mean: 4.0, weight: 5 }; // few reviews can't dominate: Bayesian shrinkage

// ---- time: compare availability in UTC so different time zones line up ----
export function tzOffsetMin(tz, at = new Date()) {
  if (!tz) return 0;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(at).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch { return 0; }
}
const mins = (t) => { const [h, m] = String(t).split(':'); return +h * 60 + +m; };
const WEEK = 10080;
function intervals(p, fallbackTz) {
  const off = tzOffsetMin(p.timezone || fallbackTz); // unknown zone: assume the other person's, so missing data never hurts
  return p.slots.map((s) => { const len = mins(s.end_time) - mins(s.start_time); const st = (((s.weekday * 1440 + mins(s.start_time) - off) % WEEK) + WEEK) % WEEK; return [st, st + len]; });
}
export function overlapMinutes(a, b) {
  const A = intervals(a, b.timezone), B = intervals(b, a.timezone); let total = 0;
  for (const [s1, e1] of A) for (const [s2, e2] of B) for (const k of [-WEEK, 0, WEEK]) total += Math.max(0, Math.min(e1, e2 + k) - Math.max(s1, s2 + k));
  return total;
}

// ---- pricing: a Learner's preference vs a Mentor's skill offer ----
export function priceFit(M, L) {
  const free = M.pricing === 'free' || M.pricing === 'both';
  const paidOk = M.pricing !== 'free' && (L.max_price_paise == null || M.price_min_paise <= L.max_price_paise);
  if (L.prefers === 'free') return free ? { fit: 'free', score: 1 } : { fit: 'over_budget', score: 0 };
  if (free) return { fit: 'free', score: L.prefers === 'paid' ? 0.9 : 1 };
  if (paidOk) return { fit: 'in_budget', score: L.max_price_paise == null ? 0.8 : 0.95 };
  return { fit: 'over_budget', score: 0 };
}
function levelFit(M, L) {
  const ml = LV[M.level];
  if (L.desired_level) return Math.min(1, ml / LV[L.desired_level]);
  const d = ml - LV[L.current_level];
  return d >= 1 ? 1 : d === 0 ? 0.5 : 0;
}
function styleFit(M, L) {
  if (!L.learning_style) return null;
  if (M.teaching_style === L.learning_style) return 1;
  return GROUPISH.has(M.teaching_style) && GROUPISH.has(L.learning_style) ? 0.7 : 0.3;
}
const SYNTH_L = { current_level: 'none', prefers: 'either', max_price_paise: null, learning_style: null, desired_level: null };

/** viewer/cand: { timezone, rating_avg, rating_count, avatar, bio, location, mentor[], learner[], slots[], languages[] }
 *  opts: { direction:'mentor'|'learner', focus:number[]|null (skill ids), strict:boolean }
 *  Returns null (not a candidate) or { score, components, reasons, priceFit, matched[], offer } */
export function scoreCandidate(viewer, cand, { direction, focus = null, strict = true }, W = DEFAULT_WEIGHTS) {
  const seeking = direction === 'mentor'; // viewer wants a Mentor => cand's mentor skills vs viewer's learner skills
  const candSkills = seeking ? cand.mentor : cand.learner;
  const mine = seeking ? viewer.learner : viewer.mentor;
  const mineBy = new Map(mine.map((s) => [s.skill_id, s]));
  let pool = focus?.length ? candSkills.filter((s) => focus.includes(s.skill_id)) : candSkills;
  let pairs = pool.filter((s) => mineBy.has(s.skill_id));
  if (!pairs.length) {
    // no overlap with the viewer's own list: allowed only for an explicit search, or a viewer with nothing listed yet
    if (strict && !focus?.length && mine.length) return null;
    if (!pool.length) return null;
    pairs = pool;
  }
  const overlapCount = pool.filter((s) => mineBy.has(s.skill_id)).length;
  const pairObjs = pairs.map((c) => {
    const M = seeking ? c : mineBy.get(c.skill_id) || { level: 'intermediate', pricing: 'both', price_min_paise: 0, teaching_style: null };
    const L = seeking ? mineBy.get(c.skill_id) || SYNTH_L : c;
    const pf = priceFit(M, L), lv = levelFit(M, L), st = styleFit(M, L);
    return { c, M, L, pf, lv, st, q: 0.5 * pf.score + 0.3 * lv + 0.2 * (st ?? 0.5) };
  });
  const best = pairObjs.reduce((a, b) => (b.q > a.q ? b : a));

  const comp = {
    skill: mine.length || focus?.length ? (focus?.length ? (overlapCount ? 1 : 0.6) : Math.min(1, overlapCount / Math.max(1, seeking ? mine.length : Math.min(candSkills.length, 3)))) : null,
    level: best.lv, price: best.pf.score, style: best.st,
    language: viewer.languages.length && cand.languages.length ? (viewer.languages.some((x) => cand.languages.includes(x)) ? 1 : 0) : null,
    availability: viewer.slots.length && cand.slots.length ? Math.min(1, overlapMinutes(viewer, cand) / 120) : null,
    rating: seeking && cand.rating_count > 0 ? ((cand.rating_avg * cand.rating_count + RATING_PRIOR.mean * RATING_PRIOR.weight) / (cand.rating_count + RATING_PRIOR.weight) - 1) / 4 : null,
    completeness: [cand.avatar, cand.bio, cand.location, cand.slots.length, cand.languages.length, cand.mentor.length + cand.learner.length].filter(Boolean).length / 6,
  };
  let num = 0, den = 0; // missing data is skipped and weights renormalised, so it never counts against anyone
  for (const k of Object.keys(W)) if (comp[k] != null) { num += W[k] * comp[k]; den += W[k]; }
  const score = den ? Math.round((num / den) * 100) : 0;

  const names = pairs.map((p) => p.skill);
  const reasons = [];
  reasons.push(seeking ? `Teaches ${names.slice(0, 3).join(', ')}` : `Wants to learn ${names.slice(0, 3).join(', ')}`);
  if (comp.level >= 1) reasons.push(seeking ? 'Matches your learning level' : 'Right level for what you teach');
  if (best.pf.fit === 'free') reasons.push('Offers free sessions');
  else if (best.pf.fit === 'in_budget') reasons.push('Fits your budget');
  if (comp.availability >= 0.5) reasons.push('Available at times that work for you');
  else if (comp.availability > 0) reasons.push('Some availability overlap');
  if (comp.language === 1) reasons.push('Shares your language');
  if (comp.style >= 1) reasons.push('Same session style as you');
  if (seeking && cand.rating_count >= 3) reasons.push(`Rated ${Number(cand.rating_avg).toFixed(1)} by ${cand.rating_count} people`);
  const offer = seeking ? best.M : best.M; // Mentor's offer shown on the card
  return { score, components: comp, reasons, priceFit: best.pf.fit, matched: names, matchedSkillIds: pairs.map((p) => p.skill_id), overlapMinutes: comp.availability == null ? null : Math.round(comp.availability * 120), offer };
}

const priceMin = (r) => (r.offer.pricing === 'free' || r.offer.pricing === 'both' ? 0 : r.offer.price_min_paise ?? 0);
const priceMax = (r) => (r.offer.pricing === 'free' ? 0 : r.offer.price_max_paise ?? 0);
const t = (r) => +new Date(r.user.last_active_at || 0);
export const SORTS = {
  best: (a, b) => b.rankKey - a.rankKey,
  rating: (a, b) => (b.user.rating_avg ?? -1) - (a.user.rating_avg ?? -1) || b.rankKey - a.rankKey,
  price_asc: (a, b) => priceMin(a) - priceMin(b) || b.rankKey - a.rankKey,
  price_desc: (a, b) => priceMax(b) - priceMax(a) || b.rankKey - a.rankKey,
  skills: (a, b) => (b.components.skill ?? 0) - (a.components.skill ?? 0) || b.matched.length - a.matched.length || b.rankKey - a.rankKey,
  active: (a, b) => t(b) - t(a) || b.rankKey - a.rankKey,
};
export const sortResults = (items, sort = 'best') => items.sort((a, b) => (SORTS[sort] || SORTS.best)(a, b) || a.user.id - b.user.id);
