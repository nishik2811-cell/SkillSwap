import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert } from '../components/UI.jsx';
import CoverPreview from '../components/CoverPreview.jsx';
import PayoutMethod from '../components/PayoutMethod.jsx';
import { AboutSection, LearnSection, MentorSection, WhenSection, validatePrefs } from '../components/PrefSections.jsx';
import { fromProfile, toPayloads } from '../lib.js';
import './onboarding.css';

const STEPS = [
  ['Label info', 'About you', "Let's start with the basics. Who are we meeting?"],
  ['Side B', 'Learn', 'What do you want to learn? Pick as many as you like.'],
  ['Side A', 'Mentor', 'What can you share with others? You can mentor and learn at the same time.'],
  ['Credits', 'When and how', 'When are you around, and which languages do you speak?'],
];

export default function Onboarding() {
  const { user, refresh } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState(null); const [step, setStep] = useState(0); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [payStep, setPayStep] = useState(false);
  useEffect(() => { api('/me/profile').then((p) => setF(fromProfile(p))).catch((x) => setErr(errorText(x))); }, []);
  if (!f) return <div className="center"><Alert>{err}</Alert>{!err && <p>Loading…</p>}</div>;

  async function next() {
    setErr('');
    if (step === 0 && !f.fullName.trim()) return setErr('Please enter your name.');
    if (step < STEPS.length - 1) return setStep(step + 1);
    const bad = validatePrefs(f); if (bad) return setErr(bad);
    if (!Object.keys(f.learner).length && !Object.keys(f.mentor).length) return setErr('Pick at least one skill to learn or to mentor, so we can match you.');
    setBusy(true);
    try {
      const { profile, prefs } = toPayloads(f, true);
      await api('/me/profile', { method: 'PATCH', body: profile });
      await api('/me/preferences', { method: 'PUT', body: prefs });
      setPayStep(true); // record pressed: offer the optional payout step before the dashboard
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }
  const finish = async () => { await refresh(); nav('/dashboard'); };
  if (payStep) return (
    <div className="wrap onb">
      <aside className="onb-cover"><CoverPreview f={f} username={user?.username} /><p className="onb-hint">Your record is pressed.</p></aside>
      <div className="onb-main">
        <p className="onb-kicker">Bonus track · optional</p>
        <h1>Get paid</h1>
        <p className="onb-lede">Planning to run paid sessions? Tell us where to send your earnings. You can skip this and add it any time in Settings.</p>
        <PayoutMethod onSaved={finish} />
        <div className="onb-nav"><span /><button className="btn ghost" onClick={finish}>Skip for now</button></div>
      </div>
    </div>
  );
  const Section = [AboutSection, LearnSection, MentorSection, WhenSection][step];
  return (
    <div className="wrap onb">
      <aside className="onb-cover"><CoverPreview f={f} username={user?.username} /><p className="onb-hint">Your cover updates as you go.</p></aside>
      <div className="onb-main">
        <p className="onb-kicker">Track {step + 1} of {STEPS.length} · {STEPS[step][0]}</p>
        <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Onboarding progress">{STEPS.map((_, i) => <i key={i} className={i <= step ? 'done' : ''} />)}</div>
        <h1>{STEPS[step][1]}</h1>
        <p className="onb-lede">{STEPS[step][2]}</p>
        <Alert>{err}</Alert>
        <Section f={f} setF={setF} />
        <div className="onb-nav">
          <button className="btn ghost" onClick={() => setStep(step - 1)} disabled={step === 0 || busy}>Back</button>
          <button className="btn accent" onClick={next} disabled={busy}>{step === STEPS.length - 1 ? (busy ? 'Pressing…' : 'Press my record') : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
