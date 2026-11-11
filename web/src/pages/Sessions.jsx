import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { Alert } from '../components/UI.jsx';
import { SessionRow } from '../components/SessionBits.jsx';
import { useSkills } from '../lib.js';
import './sessions.css';

const TABS = [['browse', 'Browse'], ['learning', 'My learning'], ['mentoring', 'My mentoring']];

export default function Sessions() {
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') || 'browse'; const skills = useSkills();
  const [data, setData] = useState(null); const [err, setErr] = useState(''); const [past, setPast] = useState(false); const [open, setOpen] = useState(false);
  const set = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  useEffect(() => {
    setData(null); setErr('');
    const p = new URLSearchParams();
    let path;
    if (tab === 'browse') { for (const k of ['q', 'skillId', 'pricing', 'kind', 'when']) if (sp.get(k)) p.set(k, sp.get(k)); path = `/sessions?${p}`; }
    else path = `/sessions/mine?role=${tab === 'mentoring' ? 'mentor' : 'learner'}&when=${past ? 'past' : 'upcoming'}`;
    let live = true; api(path).then((d) => live && setData(d.sessions)).catch((x) => live && setErr(errorText(x)));
    return () => { live = false; };
  }, [sp.toString(), past]); // eslint-disable-line
  const toggle = (k, v) => set(k, sp.get(k) === v ? '' : v);
  return <div className="wrap sessions">
    <div className="ss-head">
      <div><p className="ss-kicker">Tracklist · {TABS.find(([k]) => k === tab)[1]}</p><h2>Learning Sessions</h2></div>
      <Link className="btn accent" to="/sessions/new">Create a session</Link>
    </div>
    <div className="seg ss-tabs" role="group" aria-label="Sessions view">
      {TABS.map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => set('tab', k === 'browse' ? '' : k)}>{l}</button>)}
    </div>

    {tab === 'browse' ? <>
      <input className="ss-search" type="search" aria-label="Search sessions" placeholder="Search sessions" value={sp.get('q') || ''} onChange={(e) => set('q', e.target.value)} />
      <div className="ss-bar">
        <button className="chip" aria-pressed={sp.get('when') === 'live'} onClick={() => toggle('when', 'live')}>● Live now</button>
        <button className="chip" aria-pressed={sp.get('pricing') === 'free'} onClick={() => toggle('pricing', 'free')}>Free</button>
        <button className="chip" aria-pressed={sp.get('pricing') === 'paid'} onClick={() => toggle('pricing', 'paid')}>Paid</button>
        <button className="chip" aria-pressed={sp.get('kind') === 'individual'} onClick={() => toggle('kind', 'individual')}>One-on-one</button>
        <button className="chip" aria-pressed={sp.get('kind') === 'group'} onClick={() => toggle('kind', 'group')}>Group</button>
        <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide skills' : 'By skill'}{sp.get('skillId') ? ' · 1' : ''}</button>
      </div>
      {open && <div className="ss-skills">{skills.map((s) => <button key={s.id} className="chip" aria-pressed={sp.get('skillId') === String(s.id)} onClick={() => toggle('skillId', String(s.id))}>{s.name}</button>)}</div>}
    </> : (
      <div className="ss-bar"><button className="chip" aria-pressed={!past} onClick={() => setPast(false)}>Upcoming</button><button className="chip" aria-pressed={past} onClick={() => setPast(true)}>Past</button></div>
    )}

    <Alert>{err}</Alert>
    {!data && !err && <div className="srows">{[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 110, margin: '12px 0' }} />)}</div>}
    {data?.length === 0 && <div className="empty"><h3>{tab === 'browse' ? 'No open sessions match' : 'Nothing here yet'}</h3><p>{tab === 'mentoring' ? 'Create a session to share what you know.' : 'Browse open sessions and book a seat.'}</p></div>}
    <div className="srows">{data?.map((s) => <SessionRow key={s.id} s={s} showMentor={tab !== 'mentoring'} />)}</div>
  </div>;
}
