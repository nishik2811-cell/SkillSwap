import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { Alert } from '../components/UI.jsx';
import PersonCard from '../components/PersonCard.jsx';
import { LEVELS, LANGUAGES, DAYS, cap, useSkills, sessionGet, sessionSet } from '../lib.js';
import './discover.css';

const SORTS = [['best', 'Best match'], ['rating', 'Highest rated'], ['price_asc', 'Lowest price'], ['price_desc', 'Highest price'], ['skills', 'Most relevant skills'], ['active', 'Recently active']];
const FORMATS = { one_on_one: 'One-on-one', group: 'Group / workshop' };

export default function Discover() {
  const [sp, setSp] = useSearchParams(); const skills = useSkills();
  // Best Match is the default. A manual choice is remembered only for this browsing session (sessionStorage).
  const sort = sp.get('sort') || sessionGet('ss.sort', 'best');
  const role = sp.get('role') || 'mentor';
  const [q, setQ] = useState(sp.get('q') || '');
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null); const [err, setErr] = useState(''); const [more, setMore] = useState([]); const [page, setPage] = useState(1);
  const active = ['skillId', 'pricing', 'level', 'language', 'weekday', 'format', 'minRating', 'maxPrice'].filter((k) => sp.get(k));
  const set = (k, v) => { const n = new URLSearchParams(sp); v === '' || v == null ? n.delete(k) : n.set(k, v); setSp(n, { replace: true }); };
  const key = sp.toString();
  const label = (k, v) => ({ skillId: skills.find((s) => String(s.id) === v)?.name || 'Skill', pricing: cap(v), level: cap(v), language: v, weekday: DAYS[v], format: FORMATS[v], minRating: `${v}+ ★`, maxPrice: `Up to ₹${v}` })[k];

  useEffect(() => { const t = setTimeout(() => set('q', q.trim()), 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line
  useEffect(() => {
    let live = true; setData(null); setErr(''); setMore([]); setPage(1);
    const p = new URLSearchParams(sp); p.set('sort', sort); p.set('role', role);
    if (p.get('maxPrice')) p.set('maxPrice', String(Math.round(Number(p.get('maxPrice')) * 100)));
    api(`/discover?${p}`).then((d) => live && setData(d)).catch((x) => live && setErr(errorText(x)));
    return () => { live = false; };
  }, [key, sort, role]); // eslint-disable-line

  async function loadMore() {
    const p = new URLSearchParams(sp); p.set('sort', sort); p.set('role', role); p.set('page', page + 1);
    if (p.get('maxPrice')) p.set('maxPrice', String(Math.round(Number(p.get('maxPrice')) * 100)));
    try { const d = await api(`/discover?${p}`); setMore((m) => [...m, ...d.users]); setPage(page + 1); } catch (x) { setErr(errorText(x)); }
  }
  const users = data ? [...data.users, ...more] : [];
  const sel = (k, opts, ph) => <select aria-label={ph} value={sp.get(k) || ''} onChange={(e) => set(k, e.target.value)}><option value="">{ph}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  const clear = () => { setQ(''); setSp(sort === 'best' ? {} : { sort }, { replace: true }); };

  return (
    <div className="wrap discover">
      <div className="dc-corner"><span>SkillSwap Records</span><span>Now playing · {users.length} {users.length === 1 ? 'release' : 'releases'}</span></div>
      <div className="dc-head">
        <div><p className="dc-kicker">Side {role === 'mentor' ? 'A' : 'B'} · {role === 'mentor' ? 'Mentors' : 'Learners'}</p><h2>Discover</h2></div>
        <div className="seg" role="group" aria-label="Who are you looking for?">
          <button aria-pressed={role === 'mentor'} onClick={() => set('role', 'mentor')}>Mentors</button>
          <button aria-pressed={role === 'learner'} onClick={() => set('role', 'learner')}>Learners</button>
        </div>
      </div>

      <input className="dc-search" type="search" aria-label="Search people or skills" placeholder="Search a skill or a person" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="dc-bar">
        {role === 'mentor' && <>
          <button className="chip" aria-pressed={sp.get('pricing') === 'free'} onClick={() => set('pricing', sp.get('pricing') === 'free' ? '' : 'free')}>Free</button>
          <button className="chip" aria-pressed={sp.get('pricing') === 'paid'} onClick={() => set('pricing', sp.get('pricing') === 'paid' ? '' : 'paid')}>Paid</button>
        </>}
        <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide filters' : 'More filters'}{active.length ? ` · ${active.length}` : ''}</button>
        <span className="grow" />
        <label className="dc-sort"><span>Sort</span>
          <select aria-label="Sort by" value={sort} onChange={(e) => { sessionSet('ss.sort', e.target.value); set('sort', e.target.value === 'best' ? '' : e.target.value); }}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{v === 'best' ? '★ Best match' : l}</option>)}
          </select></label>
      </div>

      {open && (
        <div className="filters dc-panel">
          {sel('skillId', skills.map((s) => [s.id, s.name]), 'Any skill')}
          {role === 'mentor' && <input type="number" min={0} aria-label="Max price per session in rupees" placeholder="Max ₹ / session" value={sp.get('maxPrice') || ''} onChange={(e) => set('maxPrice', e.target.value)} />}
          {role === 'mentor' && sel('level', LEVELS.map((l) => [l, cap(l)]), 'Any proficiency')}
          {sel('language', LANGUAGES.map((l) => [l, l]), 'Any language')}
          {sel('weekday', DAYS.map((d, i) => [i, d]), 'Any day')}
          {sel('format', Object.entries(FORMATS), 'Any format')}
          {role === 'mentor' && sel('minRating', [[4.5, '4.5+ ★'], [4, '4+ ★'], [3, '3+ ★']], 'Any rating')}
        </div>
      )}

      {(active.length > 0 || q) && (
        <div className="dc-active" aria-label="Active filters">
          {active.filter((k) => k !== 'pricing').map((k) => <button key={k} className="chip" onClick={() => set(k, '')} aria-label={`Remove ${label(k, sp.get(k))}`}>{label(k, sp.get(k))} ×</button>)}
          <button className="linkbtn" onClick={clear}>Clear all</button>
        </div>
      )}

      <Alert>{err}</Alert>
      {data?.hint === 'add_skills' && <Alert kind="ok">Add skills to your profile in <a href="/settings">Settings</a> and we'll rank people by how well they fit you.</Alert>}
      {!data && !err && <div className="crate">{[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 300 }} />)}</div>}
      {data && users.length === 0 && <div className="empty"><h3>No matches yet</h3><p>Try removing a filter, or check back as more people join.</p></div>}
      <div className="crate">{users.map((u) => <PersonCard key={u.username} u={u} role={role} />)}</div>
      {data && data.total > users.length && <div className="row" style={{ justifyContent: 'center', marginTop: 28 }}><button className="btn ghost" onClick={loadMore}>Show more</button></div>}
      {data?.outOfBudget?.length > 0 && <>
        <h3 className="section-title">Good matches outside {role === 'mentor' ? 'your budget' : 'their budget'}</h3>
        <p className="muted">These fit your skills but cost more than you said you'd pay. They're shown separately so nothing is hidden.</p>
        <div className="crate">{data.outOfBudget.map((u) => <PersonCard key={u.username} u={u} role={role} dim />)}</div>
      </>}
    </div>
  );
}
