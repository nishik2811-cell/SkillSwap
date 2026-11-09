import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { Alert, Avatar } from '../components/UI.jsx';
import { priceLabel, STYLES, cap, DAYS } from '../lib.js';
import { Stars } from '../components/SessionBits.jsx';
import { ConnectButton, useSocial } from '../social.jsx';
import { useState as useS } from 'react';
import { coverOf } from '../cover.js';
import '../components/person.css';
import './profile.css';

const REASONS = [['spam', 'Spam'], ['harassment', 'Harassment'], ['inappropriate', 'Inappropriate content'], ['fake_profile', 'Fake profile'], ['scam', 'Scam'], ['other', 'Something else']];

function ReviewList({ data }) {
  if (!data) return <p className="muted">Loading…</p>;
  if (data.count === 0) return <p className="muted">No reviews yet.</p>;
  return <>
    <div className="row"><Stars value={data.avg} /><b>{data.avg.toFixed(1)}</b><span className="muted">({data.count})</span></div>
    {data.reviews.map((r) => <div key={r.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}><div className="row"><Stars value={r.rating} /><b>{r.reviewer.fullName}</b><span className="hint">on “{r.sessionTitle}”</span></div>{r.comment && <p style={{ margin: '4px 0 0' }}>{r.comment}</p>}</div>)}
  </>;
}

function Safety({ username, blocked, onChange }) {
  const [open, setOpen] = useS(false); const [reason, setReason] = useS('spam'); const [details, setDetails] = useS(''); const [msg, setMsg] = useS(''); const [err, setErr] = useS('');
  async function report(e) { e.preventDefault(); setErr(''); try { await api('/reports', { method: 'POST', body: { username, reason, details: details || undefined } }); setMsg('Thanks. Our team will review this report.'); setOpen(false); } catch (x) { setErr(x.message === 'already_reported' ? 'You already reported this person. We are reviewing it.' : errorText(x)); } }
  async function block() { if (!window.confirm(`Block @${username}? You will no longer see each other, and any connection is removed.`)) return; await api('/blocks', { method: 'POST', body: { username } }); onChange(); }
  async function unblock() { await api(`/blocks/${username}`, { method: 'DELETE' }); onChange(); }
  return <div className="row">
    {blocked ? <button className="btn small ghost" onClick={unblock}>Unblock</button> : <button className="btn small ghost" onClick={block}>Block</button>}
    <button className="btn small ghost" onClick={() => setOpen(!open)}>Report</button>
    {msg && <span className="hint ok" role="status">{msg}</span>}
    {open && <form className="card stack" onSubmit={report} style={{ flexBasis: '100%' }}><Alert>{err}</Alert>
      <select aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <textarea aria-label="Details" rows={3} maxLength={1000} placeholder="What happened? (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
      <div><button className="btn small">Submit report</button></div></form>}
  </div>;
}

export default function Profile() {
  const { username } = useParams(); const [u, setU] = useState(null); const [err, setErr] = useState(''); const [rel, setRel] = useState(null); const [rev, setRev] = useState(null);
  const { refreshConnections } = useSocial();
  const loadRel = () => api(`/relationship/${username}`).then(setRel).catch(() => {});
  useEffect(() => { loadRel(); setU(null); setRev(null); api(`/users/${username}/reviews`).then(setRev).catch(() => {}); api(`/users/${username}`).then(setU).catch((x) => setErr(x.status === 404 ? 'No one with that User ID.' : errorText(x))); }, [username]);
  if (err) return <div className="wrap" style={{ padding: 32 }}><Alert>{err}</Alert></div>;
  if (!u) return <div className="wrap" style={{ padding: 32 }}><div className="skeleton" /></div>;
  const { bg, cat } = coverOf(u.username);
  const mentoring = u.mentorSkills.map((m) => m.skill);
  const days = [...new Set(u.availability.map((s) => s.weekday))].sort().map((d) => DAYS[d]).join(' ');
  return <div className="wrap profile">
    <aside className="pf-cover">
      <div className="cd" style={{ '--cover': bg }}>
        <div className="cd-disc" aria-hidden="true" />
        <div className="cd-case"><section className={`cd-face cd-front${u.avatarUrl ? ' has-photo' : ''}`} style={u.avatarUrl ? { '--photo': `url(${u.avatarUrl})` } : undefined} aria-label={`${u.fullName}, cover`}>
          <div className="cd-spine" aria-hidden="true"><span>{u.username} · {cat}</span></div>
          <div className="cd-art">
            <div className="cd-top"><span>SkillSwap Records</span><span>{cat}</span></div>
            <div className="cd-initial" aria-hidden="true">{u.fullName[0]}</div>
            <div className="cd-sticker"><b>{rev?.avg ? rev.avg.toFixed(1) : 'NEW'}</b><span>{rev?.avg ? 'rating' : 'artist'}</span></div>
            <div className="cd-title"><h3>{u.fullName}</h3><p>{mentoring.slice(0, 3).join(' / ') || 'Learner'}</p></div>
          </div>
        </section></div>
      </div>
      {rel && rel.status !== 'self' && <div className="pf-actions">{rel.status !== 'blocked' && <ConnectButton username={u.username} onChange={loadRel} />}{rel.declinedByThem && rel.status === 'none' && <div className="hint">They declined an earlier request.</div>}</div>}
    </aside>

    <div className="pf-notes">
      <p className="pf-kicker">Liner notes · {cat}</p>
      <h1>{u.fullName}</h1>
      <p className="pf-handle">@{u.username}{u.location ? ` · ${u.location}` : ''}</p>
      {u.bio && <p className="pf-bio">{u.bio}</p>}

      <section aria-labelledby="pf-a"><h2 id="pf-a" className="pf-h">Side A · Tracklist</h2>
        {u.mentorSkills.length === 0 ? <p className="muted">Not mentoring any skills yet.</p> : <ol className="pf-tracks">{u.mentorSkills.map((s, i) => (
          <li key={s.skillId}><span className="pf-n">{String(i + 1).padStart(2, '0')}</span>
            <div><b>{s.skill}</b><small>{cap(s.level)}{s.yearsExperience != null ? ` · ${s.yearsExperience} yrs` : ''} · {STYLES[s.teachingStyle]}</small></div><em>{priceLabel(s)}</em></li>))}</ol>}</section>

      <section aria-labelledby="pf-b"><h2 id="pf-b" className="pf-h">Side B · Wants to learn</h2>
        {u.learnerSkills.length === 0 ? <p className="muted">Nothing listed yet.</p> : <div className="pf-chips">{u.learnerSkills.map((s) => <span key={s.skillId} className="chip static learner">{s.skill}</span>)}</div>}</section>

      <section aria-labelledby="pf-c"><h2 id="pf-c" className="pf-h">Credits</h2>
        <dl className="pf-credits"><dt>Free</dt><dd>{days || 'Not set'}</dd><dt>Languages</dt><dd>{u.languages.join(', ') || 'Not set'}</dd></dl></section>

      <section aria-labelledby="pf-r"><h2 id="pf-r" className="pf-h">Reviews as a Mentor</h2><ReviewList data={rev} />
        {rev?.asLearner.count > 0 && <><h2 className="pf-h" style={{ marginTop: 28 }}>Reviews as a Learner</h2><ReviewList data={rev.asLearner} /></>}</section>

      {rel && rel.status !== 'self' && <section className="pf-safety"><Safety username={u.username} blocked={rel.status === 'blocked'} onChange={() => { loadRel(); refreshConnections(); }} /></section>}
    </div>
  </div>;
}
