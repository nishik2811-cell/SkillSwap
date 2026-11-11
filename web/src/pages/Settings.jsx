import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert } from '../components/UI.jsx';
import CoverPreview from '../components/CoverPreview.jsx';
import PayoutMethod from '../components/PayoutMethod.jsx';
import DeleteAccount from '../components/DeleteAccount.jsx';
import { AboutSection, LearnSection, MentorSection, WhenSection, validatePrefs } from '../components/PrefSections.jsx';
import { fromProfile, toPayloads } from '../lib.js';
import './onboarding.css';

export default function Settings() {
  const { user } = useAuth();
  const [f, setF] = useState(null); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/me/profile').then((p) => setF(fromProfile(p))).catch((x) => setErr(errorText(x))); }, []);
  const loaded = !!f;
  useEffect(() => { if (loaded && window.location.hash === '#payout') document.getElementById('payout')?.scrollIntoView({ block: 'start' }); }, [loaded]); // the Wallet's "Change" link lands here
  if (!f) return <div className="wrap"><Alert>{err}</Alert></div>;
  async function save() {
    setErr(''); setOk(''); const bad = validatePrefs(f); if (bad) return setErr(bad); setBusy(true);
    try { const { profile, prefs } = toPayloads(f, false); await api('/me/profile', { method: 'PATCH', body: profile }); await api('/me/preferences', { method: 'PUT', body: prefs }); setOk('Saved. Your matches update right away.'); }
    catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }
  return <div className="wrap onb settings">
    <aside className="onb-cover"><CoverPreview f={f} username={user?.username} />
      <div className="onb-side"><button className="btn accent" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button><Link className="btn ghost small" to="/wallet">Wallet &amp; earnings</Link></div></aside>
    <div className="onb-main">
      <p className="onb-kicker">Settings · @{user?.username}</p>
      <h1>Your record</h1>
      <Alert>{err}</Alert><Alert kind="ok">{ok}</Alert>
      <section className="set-sec"><h2>Label info</h2><AboutSection f={f} setF={setF} /></section>
      <section className="set-sec"><h2>Side B · Wants to learn</h2><LearnSection f={f} setF={setF} /></section>
      <section className="set-sec"><h2>Side A · Can mentor</h2><MentorSection f={f} setF={setF} /></section>
      <section className="set-sec"><h2>Credits</h2><WhenSection f={f} setF={setF} /></section>
      <section className="set-sec" id="payout"><h2>Payment details</h2><p className="hint">Where we send your earnings from paid sessions. This saves on its own.</p><PayoutMethod /></section>
      <section className="set-sec danger-zone"><h2>Delete account</h2><DeleteAccount /></section>
      <div className="onb-nav"><button className="btn accent" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
    </div>
  </div>;
}
