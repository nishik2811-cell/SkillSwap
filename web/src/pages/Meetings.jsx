import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { Alert } from '../components/UI.jsx';

export default function Meetings() {
  const nav = useNavigate(); const [title, setTitle] = useState(''); const [waiting, setWaiting] = useState(true); const [code, setCode] = useState(''); const [rooms, setRooms] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/rooms').then((r) => setRooms(r.rooms)).catch(() => setRooms([])); }, []);
  async function start(e) { e.preventDefault(); setErr(''); try { const r = await api('/rooms', { method: 'POST', body: { title: title || 'Meeting', waitingRoom: waiting } }); nav(`/room/${r.code}`); } catch (x) { setErr(errorText(x)); } }
  function join(e) { e.preventDefault(); const c = code.trim().toLowerCase().split('/').pop(); if (c) nav(`/room/${c}`); } // accepts a pasted invite link too
  return <div className="wrap stack" style={{ padding: '32px 16px', maxWidth: 800 }}>
    <h2>Meeting rooms</h2><Alert>{err}</Alert>
    <div className="grid">
      <form className="card stack" onSubmit={start}><h3>Start a meeting</h3>
        <input aria-label="Meeting title" placeholder="Title (optional)" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={waiting} onChange={(e) => setWaiting(e.target.checked)} /> Waiting room: I approve who joins</label>
        <div><button className="btn accent">Start now</button></div></form>
      <form className="card stack" onSubmit={join}><h3>Join with a code</h3>
        <input aria-label="Meeting code or invite link" placeholder="abc-defg-hij or invite link" value={code} onChange={(e) => setCode(e.target.value)} />
        <div><button className="btn" disabled={!code.trim()}>Join</button></div></form>
    </div>
    <section><h3>History</h3>{!rooms && <div className="skeleton" />}{rooms?.length === 0 && <p className="muted">No meetings yet. Sessions you teach or attend show up here once you open their room.</p>}
      {rooms?.map((r) => <div key={r.code} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', padding: '8px 0' }}>
        <div><b>{r.title}</b> <span className="hint">{r.code} · {r.role} · {r.scheduledAt ? `scheduled ${new Date(r.scheduledAt).toLocaleString()}` : new Date(r.createdAt).toLocaleString()}</span></div>
        {r.status === 'open' ? <Link className="btn small" to={`/room/${r.code}`}>Open</Link> : <span className="chip static">Ended</span>}</div>)}</section>
  </div>;
}
