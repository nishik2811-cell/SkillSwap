import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert } from '../components/UI.jsx';
import PersonCard from '../components/PersonCard.jsx';

export default function Dashboard() {
  const { user } = useAuth(); const [rec, setRec] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/recommendations').then(setRec).catch((x) => setErr(errorText(x))); }, []);
  return <div className="wrap page">
    <header className="page-head"><p className="page-kicker">Your matches</p>
      <h1>Hi {user.fullName.split(' ')[0]}, here's who fits you best</h1>
      <p className="lede">Ranked by skills, level, budget, time and language. Not seeing good matches? <Link to="/settings">Edit your skills</Link>.</p>
      <div className="page-actions"><Link className="btn accent" to="/discover">Find a Mentor</Link><Link className="btn ghost" to="/discover?role=learner">Find Learners</Link></div>
    </header>
    <Alert>{err}</Alert>
    {!rec && !err && <div className="grid">{[1, 2, 3].map((i) => <div key={i} className="skeleton" />)}</div>}
    {rec?.matches.length === 0 && <div className="empty"><h3>No matches yet</h3><p>Add skills you want to learn in Settings, or check back as more people join.</p></div>}
    <div className="crate" style={{ marginTop: 0 }}>{rec?.matches.map((u) => <PersonCard key={u.username} u={u} />)}</div>
  </div>;
}
