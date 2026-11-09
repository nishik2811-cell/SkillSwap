import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { useSocial, MessageButton } from '../social.jsx';
import { Alert, Avatar } from '../components/UI.jsx';

export default function Connections() {
  const { conn, refreshConnections } = useSocial(); const [tab, setTab] = useState('received'); const [err, setErr] = useState('');
  const act = async (path, method = 'POST') => { setErr(''); try { await api(path, { method, body: method === 'POST' ? {} : undefined }); await refreshConnections(); } catch (x) { setErr(errorText(x)); } };
  const tabs = [['received', 'Requests for you'], ['sent', 'Sent by you'], ['connected', 'Connections']];
  const rows = conn[tab];
  return <div className="wrap" style={{ padding: '32px 16px', maxWidth: 800 }}>
    <h2>Connections</h2>
    <div className="seg" role="group" aria-label="Connection lists">{tabs.map(([k, l]) => <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l} ({conn[k].length})</button>)}</div>
    <Alert>{err}</Alert>
    {rows.length === 0 && <div className="empty"><p>{tab === 'received' ? 'No pending requests.' : tab === 'sent' ? "You haven't sent any requests." : 'No connections yet.'}</p><Link className="btn small" to="/discover">Find people</Link></div>}
    <div className="stack" style={{ marginTop: 16 }}>{rows.map((c) => <div key={c.id} className="card row" style={{ justifyContent: 'space-between' }}>
      <div className="row"><Avatar user={c.user} /><div><Link to={`/u/${c.user.username}`}><b>{c.user.fullName}</b></Link><div className="hint">@{c.user.username}</div>{c.message && <div className="muted">“{c.message}”</div>}</div></div>
      <div className="row">
        {tab === 'received' && <><button className="btn small accent" onClick={() => act(`/connections/${c.id}/accept`)}>Accept</button><button className="btn small ghost" onClick={() => act(`/connections/${c.id}/reject`)}>Decline</button></>}
        {tab === 'sent' && <button className="btn small ghost" onClick={() => act(`/connections/${c.id}`, 'DELETE')}>Cancel request</button>}
        {tab === 'connected' && <><MessageButton username={c.user.username} /><button className="btn small ghost" onClick={() => window.confirm(`Remove ${c.user.fullName} from your connections?`) && act(`/connections/${c.id}`, 'DELETE')}>Remove</button></>}
      </div></div>)}</div>
  </div>;
}
