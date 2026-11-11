import { useEffect, useState } from 'react';
import { api, errorText } from '../api.js';

/** Tick connections to invite. With `url`, a Send button posts { usernames } there; without it the parent keeps the picks (value / onChange). */
export default function InviteConnections({ url, value, onChange }) {
  const [list, setList] = useState(null); const [own, setOwn] = useState([]); const [msg, setMsg] = useState('');
  const pick = value ?? own, setPick = onChange ?? setOwn;
  useEffect(() => { api('/connections').then((r) => setList(r.connected)).catch(() => setList([])); }, []);
  const send = async () => {
    try { const r = await api(url, { method: 'POST', body: { usernames: pick } }); setMsg(`Invited ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.`); setPick([]); }
    catch (x) { setMsg(errorText(x)); }
  };
  if (!list) return <p className="hint">Loading your connections…</p>;
  if (!list.length) return <p className="hint">You have no connections yet. Connect with people first, then invite them.</p>;
  return <div className="stack" style={{ gap: 6 }}>
    {list.map(({ user }) => <label key={user.username} className="row" style={{ fontWeight: 400, gap: 10 }}>
      <input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={pick.includes(user.username)}
        onChange={(e) => setPick(e.target.checked ? [...pick, user.username].slice(0, 20) : pick.filter((u) => u !== user.username))} />
      {user.fullName} <span className="hint" style={{ margin: 0 }}>@{user.username}</span></label>)}
    {url && <div><button type="button" className="btn small" disabled={!pick.length} onClick={send}>Send invite</button></div>}
    {msg && <p className="hint" role="status">{msg}</p>}
  </div>;
}
