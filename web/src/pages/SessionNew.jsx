import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { Alert, Field } from '../components/UI.jsx';

const ERR = { must_be_in_future: 'Pick a start time at least 5 minutes from now.', not_a_mentor_skill: 'Add this skill to your Mentor skills in Settings first.', overlaps_another_session: 'You already have a session at that time.' };

export default function SessionNew() {
  const nav = useNavigate(); const [mine, setMine] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ title: '', description: '', skillId: '', start: '', durationMin: 60, capacity: 1, pricing: 'free', rupees: '', autoAccept: false });
  useEffect(() => { api('/me/profile').then((p) => { setMine(p.mentorSkills); if (p.mentorSkills[0]) setF((s) => ({ ...s, skillId: p.mentorSkills[0].skillId })); }).catch((x) => setErr(errorText(x))); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api('/sessions', { method: 'POST', body: { title: f.title, description: f.description || undefined, skillId: Number(f.skillId), startsAt: new Date(f.start).toISOString(),
        durationMin: Number(f.durationMin), capacity: Number(f.capacity), pricing: f.pricing, pricePaise: f.pricing === 'paid' ? Math.round(Number(f.rupees) * 100) : undefined, autoAccept: f.autoAccept } });
      nav(`/sessions/${r.id}`);
    } catch (x) { setErr(ERR[x.message] || (x.message === 'invalid_input' ? 'Check the title (3+ characters), time, and price.' : errorText(x))); setBusy(false); }
  }
  if (mine && !mine.length) return <div className="center"><div className="card narrow stack"><h2>Add a Mentor skill first</h2><p>Sessions are tied to a skill you mentor.</p><a className="btn" href="/settings">Open settings</a></div></div>;
  return <div className="wrap" style={{ padding: '32px 16px', maxWidth: 640 }}><form className="card" onSubmit={submit}>
    <h2>Create a Learning Session</h2><Alert>{err}</Alert>
    <Field id="s-t" label="Title"><input id="s-t" required minLength={3} maxLength={120} value={f.title} onChange={set('title')} placeholder="e.g. Guitar chords for beginners" /></Field>
    <Field id="s-d" label="Description"><textarea id="s-d" rows={3} maxLength={2000} value={f.description} onChange={set('description')} /></Field>
    <div className="filters">
      <Field id="s-sk" label="Skill"><select id="s-sk" value={f.skillId} onChange={set('skillId')}>{mine?.map((m) => <option key={m.skillId} value={m.skillId}>{m.skill}</option>)}</select></Field>
      <Field id="s-st" label="Starts (your local time)"><input id="s-st" type="datetime-local" required value={f.start} onChange={set('start')} /></Field>
      <Field id="s-du" label="Duration (minutes)"><input id="s-du" type="number" min={15} max={480} step={5} required value={f.durationMin} onChange={set('durationMin')} /></Field>
      <Field id="s-ca" label="Seats" hint={f.capacity > 1 ? 'Group session' : 'One-on-one'}><input id="s-ca" type="number" min={1} max={100} required value={f.capacity} onChange={set('capacity')} /></Field>
      <Field id="s-pr" label="Free or paid?"><select id="s-pr" value={f.pricing} onChange={set('pricing')}><option value="free">Free</option><option value="paid">Paid</option></select></Field>
      {f.pricing === 'paid' && <Field id="s-ru" label="Price per person (₹)"><input id="s-ru" type="number" min={1} required value={f.rupees} onChange={set('rupees')} /></Field>}
    </div>
    <label className="row" style={{ marginBottom: 16, fontWeight: 400 }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={f.autoAccept} onChange={set('autoAccept')} /> Accept bookings automatically until the session is full</label>
    <button className="btn accent" disabled={busy}>{busy ? 'Creating…' : 'Create session'}</button>
  </form></div>;
}
