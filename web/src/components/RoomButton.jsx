import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { Alert } from './UI.jsx';

/** Opens the session's meeting room. The Mentor creates it on first use; learners only get in with a confirmed booking (enforced by the server). */
export default function RoomButton({ sessionId, host }) {
  const nav = useNavigate(); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr('');
    try { const r = await api(`/sessions/${sessionId}/room`, { method: 'POST', body: {} }); nav(`/room/${r.code}`); }
    catch (x) { setErr(errorText(x)); setBusy(false); }
  }
  return <div><Alert>{err}</Alert><button className="btn accent" disabled={busy} onClick={go}>{host ? 'Open meeting room' : 'Join meeting room'}</button><p className="hint" style={{ margin: '10px 0 0' }}>The room opens 15 minutes before the start.</p></div>;
}
