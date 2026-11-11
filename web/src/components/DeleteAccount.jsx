import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert } from './UI.jsx';

const WHY = {
  admin_cannot_delete: "Admin accounts can't be deleted here. Make someone else an admin first.",
  has_booked_sessions: <>You have upcoming sessions that people have booked. Cancel them first from <Link to="/sessions?tab=mentoring">Sessions</Link>; anyone who paid is refunded automatically.</>,
  has_upcoming_bookings: <>You're booked into upcoming sessions. Cancel those bookings first from <Link to="/sessions?tab=learning">Sessions</Link>.</>,
  has_balance: <>You still have earnings on SkillSwap. Request a payout in <Link to="/wallet?tab=earnings">Wallet</Link> first; once it's paid you can delete your account.</>,
  invalid_code: "That code is wrong or has expired. Check the email, or send a new code.",
};

/** Delete my account: send a 6-digit code to my email, then confirm it. */
export default function DeleteAccount() {
  const { logout } = useAuth(); const nav = useNavigate();
  const [step, setStep] = useState('idle'); const [to, setTo] = useState(''); const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const fail = (x) => setErr(WHY[x.message] || errorText(x));
  async function send() {
    setErr(''); setBusy(true);
    try { const r = await api('/me/delete/request', { method: 'POST', body: {} }); setTo(r.to); setStep('code'); setCode(''); } catch (x) { fail(x); } finally { setBusy(false); }
  }
  async function confirm(e) {
    e?.preventDefault(); setErr(''); setBusy(true);
    try { await api('/me/delete/confirm', { method: 'POST', body: { code } }); nav('/', { replace: true }); logout(); /* leave the protected page first, then forget the user */ } catch (x) { fail(x); setBusy(false); }
  }
  if (step === 'idle') return <div className="stack" style={{ gap: 10 }}>
    <p className="hint" style={{ margin: 0 }}>This removes your profile, skills, connections and payout details, and signs you out everywhere. Your messages stay in other people's chats as "Deleted user". Payment records are kept, as the law requires. This can't be undone.</p>
    <Alert>{err}</Alert>
    <div><button type="button" className="btn small danger" disabled={busy} onClick={send}>{busy ? 'Sending code…' : 'Delete my account'}</button></div>
  </div>;
  return <div className="stack" style={{ gap: 10 }}>
    <p style={{ margin: 0 }}>We sent a 6-digit code to <b>{to}</b>. Enter it to delete your account for good. The code works for 15 minutes.</p>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <input aria-label="Deletion code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) confirm(e); }} />
      <button type="button" className="btn small danger" disabled={busy || code.length !== 6} onClick={confirm}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
    </div>
    <Alert>{err}</Alert>
    <div className="row" style={{ gap: 8 }}><button type="button" className="btn small ghost" disabled={busy} onClick={send}>Send a new code</button>
      <button type="button" className="btn small ghost" disabled={busy} onClick={() => { setStep('idle'); setErr(''); }}>Keep my account</button></div>
  </div>;
}
