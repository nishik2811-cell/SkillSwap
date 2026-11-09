import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert } from '../components/UI.jsx';
import PersonCard from '../components/PersonCard.jsx';

export default function Dashboard() {
  const { user } = useAuth(); const [rec, setRec] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/recommendations').then(setRec).catch((x) => setErr(errorText(x))); }, []);
  return <div className="wrap" style={{ padding: '32px 16px' }}>
    <h2>Hi {user.fullName.split(' ')[0]}, here's who fits you best</h2>
    <div className="row"><Link className="btn" to="/discover">Find a Mentor</Link><Link className="btn ghost" to="/discover?role=learner">Find Learners</Link><Link className="btn ghost" to="/settings">Edit my skills</Link><Link className="btn ghost" to="/meetings">Meetings</Link><Link className="btn ghost" to="/wallet">Wallet</Link></div>
    <Alert>{err}</Alert>
    {!rec && !err && <div className="grid" style={{ marginTop: 24 }}>{[1, 2, 3].map((i) => <div key={i} className="skeleton" />)}</div>}
    {rec?.matches.length === 0 && <div className="empty"><h3>No matches yet</h3><p>Add skills you want to learn in Settings, or check back as more people join.</p></div>}
    <div className="grid" style={{ marginTop: 24 }}>{rec?.matches.map((u) => <PersonCard key={u.username} u={u} />)}</div>
  </div>;
}
