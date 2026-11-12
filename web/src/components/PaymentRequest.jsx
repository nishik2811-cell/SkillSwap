import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { rupees } from '../lib.js';
import { Alert } from './UI.jsx';
import WhenPicker from './WhenPicker.jsx';

const ERR = {
  not_a_mentor_skill: 'Pick a skill you mentor. You can add it in Settings.',
  must_be_in_future: 'Pick a time at least 5 minutes from now.',
  overlaps_another_session: 'You already have a session at that time.',
};

/** "₹ Request payment" in a direct chat: makes a private one-on-one paid session for this person (so checkout, fees,
 *  refunds, receipts and payouts all work as usual) and hands back the chat message that links to it. */
export default function PaymentRequest({ to, onSend, onClose }) {
  const [skills, setSkills] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ skillId: '', title: '', rupees: '', when: '', durationMin: 60 });
  useEffect(() => { api('/me/profile').then((p) => { setSkills(p.mentorSkills); if (p.mentorSkills[0]) setF((x) => ({ ...x, skillId: String(p.mentorSkills[0].skillId) })); }).catch(() => setSkills([])); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const price = Math.round(Number(f.rupees) * 100);
  const skillName = skills?.find((s) => String(s.skillId) === f.skillId)?.skill || 'Session';

  async function submit(e) {
    e.preventDefault(); setErr(''); if (!f.when || price < 100) return setErr('Add a price of at least ₹1 and a time.');
    setBusy(true);
    try {
      const title = f.title.trim() || `${skillName} session`, at = new Date(f.when);
      const r = await api('/sessions', { method: 'POST', body: { title, skillId: Number(f.skillId), startsAt: at.toISOString(), durationMin: Number(f.durationMin), capacity: 1,
        pricing: 'paid', pricePaise: price, autoAccept: true, visibility: 'private', invite: [to] } });
      const when = at.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      await onSend(`₹ ${title}\nWhen: ${when} · ${f.durationMin} min\nPrice: ${rupees(price)} + fees\nPay: ${window.location.origin}/sessions/${r.id}`);
      onClose();
    } catch (x) { setErr(ERR[x.message] || errorText(x)); } finally { setBusy(false); }
  }

  if (skills && !skills.length) return <div className="panel stack"><b>Request a payment</b>
    <p className="hint" style={{ margin: 0 }}>Payments are for sessions you teach. Add a skill you mentor in <Link to="/settings">Settings</Link> first.</p>
    <div><button type="button" className="btn small ghost" onClick={onClose}>Close</button></div></div>;
  return <form className="panel stack" onSubmit={submit}><b>Request a payment</b>
    <div className="pay-req-grid">
      <label className="field" style={{ margin: 0 }}>Skill<select value={f.skillId} onChange={set('skillId')}>{skills?.map((s) => <option key={s.skillId} value={s.skillId}>{s.skill}</option>)}</select></label>
      <label className="field" style={{ margin: 0 }}>Your price (₹)<input type="number" inputMode="decimal" min="1" step="1" placeholder="e.g. 500" value={f.rupees} onChange={set('rupees')} /></label>
      <label className="field" style={{ margin: 0 }}>When<WhenPicker placeholder="Pick a time" value={f.when} onChange={(when) => setF((x) => ({ ...x, when }))} /></label>
      <label className="field" style={{ margin: 0 }}>Length<select value={f.durationMin} onChange={set('durationMin')}>{[30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n} min</option>)}</select></label>
    </div>
    <label className="field" style={{ margin: 0 }}>Title (optional)<input maxLength={120} placeholder={`${skillName} session`} value={f.title} onChange={set('title')} /></label>
    <Alert>{err}</Alert>
    <div className="row"><button className="btn small accent" disabled={busy || !skills}>{busy ? 'Sending…' : 'Send payment request'}</button><button type="button" className="btn small ghost" onClick={onClose}>Cancel</button></div>
  </form>;
}
