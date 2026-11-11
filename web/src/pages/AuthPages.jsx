import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field } from '../components/UI.jsx';

const GOOGLE_ERRORS = { google_cancelled: 'Google sign-in was cancelled.', google_failed: 'Google sign-in did not work. Please try again.', google_unverified: 'Google says that email address is not verified.',
  google_not_configured: 'Google sign-in is not set up yet.', account_inactive: 'This account is not active.' };

// "Continue with Google" appears only when the server has Google credentials.
function GoogleButton() {
  const [on, setOn] = useState(false);
  useEffect(() => { api('/auth/providers').then((r) => setOn(!!r.google)).catch(() => {}); }, []);
  if (!on) return null;
  return <><div className="or"><span>or</span></div>
    <a className="gbtn" href="/api/v1/auth/google"><span className="gbtn-logo" aria-hidden="true"><svg viewBox="0 0 48 48" width="20" height="20"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></span><span>Continue with Google</span></a></>;
}

// Live "is this ID free?" check, shared by the sign-up form and the Google "choose your ID" page.
function useAvail(name) {
  const [avail, setAvail] = useState(null); // {available, suggestions} | 'invalid'
  useEffect(() => {
    const u = name.trim().toLowerCase();
    if (!u) return setAvail(null);
    if (!/^[a-z0-9_]{3,20}$/.test(u)) return setAvail('invalid');
    const t = setTimeout(() => api(`/auth/username-available?u=${u}`).then(setAvail).catch(() => setAvail(null)), 350);
    return () => clearTimeout(t);
  }, [name]);
  return [avail, setAvail];
}
// The line under the ID box: the rule, "available", or "taken" followed by three suggestions in one row.
const idHint = (avail, name, free, pick) => avail === 'invalid' ? '3–20 characters: letters, numbers, underscore' : avail?.available ? `@${name.toLowerCase()} is available`
  : avail ? <>That ID is taken. Try one of these:<span className="sugg">{avail.suggestions.slice(0, 3).map((s) => <button type="button" key={s} className="chip" onClick={() => pick(s)}>@{s}</button>)}</span></> : free;

export function ChooseId() {
  const { user, refresh } = useAuth(); const nav = useNavigate();
  const [info, setInfo] = useState(null); const [gone, setGone] = useState(false); const [name, setName] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [avail, setAvail] = useAvail(name);
  useEffect(() => { api('/auth/google/pending').then(setInfo).catch(() => setGone(true)); }, []);
  if (user) return <Navigate to="/dashboard" replace />;
  if (gone) return <div className="center"><div className="card narrow stack"><h2>That sign-in expired</h2><p>Please start again.</p><Link className="btn" to="/login">Back to log in</Link></div></div>;
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api('/auth/google/complete', { method: 'POST', body: { username: name } }); await refresh(); nav('/dashboard'); }
    catch (x) { if (x.message === 'username_taken') setAvail({ available: false, suggestions: x.body.suggestions }); setErr(x.message === 'signup_expired' ? 'That sign-in expired. Please start again.' : errorText(x)); } finally { setBusy(false); }
  }
  return <div className="center"><form className="card narrow" onSubmit={submit} noValidate>
    <h2>One last step</h2><p className="muted">{info ? <>Signed in with Google as <b>{info.email}</b>.</> : 'Loading…'} Choose your User ID: it is your public name on SkillSwap, and nobody else can have the same one.</p>
    <Alert>{err}</Alert>
    <Field id="gu" label="Choose your User ID" hint={idHint(avail, name, 'This is your public ID: skillswap.app/u/yourid', setName)} hintKind={avail?.available ? 'ok' : avail ? 'err' : ''}>
      <input id="gu" required autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck="false" />
    </Field>
    <button className="btn" style={{ display: 'flex', margin: '16px auto 0' }} disabled={busy || !info || avail?.available !== true}>{busy ? 'Creating…' : 'Create my account'}</button>
  </form></div>;
}

function Resend({ identifier }) {
  const [state, setState] = useState('');
  const go = () => { setState('busy'); api('/auth/resend-verification', { method: 'POST', body: { identifier } }).then(() => setState('sent')).catch(() => setState('err')); };
  if (state === 'sent') return <p className="hint" role="status">Sent again. Check spam too; it can take a minute.</p>;
  return <p className="hint">No email? <button type="button" className="linkbtn" style={{ marginLeft: 0 }} disabled={state === 'busy'} onClick={go}>{state === 'busy' ? 'Sending…' : 'Send it again'}</button>{state === 'err' && ' Could not send. Try again shortly.'}</p>;
}

export function Register() {
  const { user } = useAuth();
  const [f, setF] = useState({ fullName: '', email: '', username: '', password: '' });
  const [err, setErr] = useState(''); const [fieldErrs, setFieldErrs] = useState({}); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [avail, setAvail] = useAvail(f.username);

  async function submit(e) {
    e.preventDefault(); setErr(''); setFieldErrs({}); setBusy(true);
    try { await api('/auth/register', { method: 'POST', body: f }); setDone(true); }
    catch (x) {
      if (x.message === 'username_taken') setAvail({ available: false, suggestions: x.body.suggestions });
      else if (x.message === 'invalid_input') setFieldErrs(x.body.details || {});
      setErr(errorText(x));
    } finally { setBusy(false); }
  }
  if (user && !done) return <Navigate to="/dashboard" replace />;   // already signed in
  if (done) return <div className="center"><div className="card narrow stack"><h2>Check your inbox</h2><p>We sent a verification link to <b>{f.email}</b>. Open it, then log in to finish setting up.</p><Resend identifier={f.email} /><Link className="btn" to="/login">Go to log in</Link></div></div>;
  const hint = idHint(avail, f.username, 'This is your public ID: skillswap.app/u/yourid', (s) => setF({ ...f, username: s }));
  return (
    <div className="center"><form className="card narrow" onSubmit={submit} noValidate>
      <h2>Join SkillSwap</h2><p className="muted">Teach what you know. Learn what you don't.</p>
      <Alert>{err}</Alert>
      <Field id="fn" label="Full name" hint={fieldErrs.fullName?.[0]}><input id="fn" required value={f.fullName} onChange={set('fullName')} autoComplete="name" /></Field>
      <Field id="em" label="Email" hint={fieldErrs.email?.[0]}><input id="em" type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></Field>
      <Field id="un" label="Choose your User ID" hint={hint} hintKind={avail?.available ? 'ok' : avail ? 'err' : ''}>
        <input id="un" required value={f.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" spellCheck="false" />
      </Field>
      <Field id="pw" label="Password" hint={fieldErrs.password?.[0] || 'At least 8 characters'} hintKind={fieldErrs.password ? 'err' : ''}><input id="pw" type="password" required minLength={8} value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
      <button className="btn" disabled={busy || avail?.available === false}>{busy ? 'Creating…' : 'Create account'}</button>
      <GoogleButton />
      <p className="hint" style={{ marginTop: 16 }}>Already a member? <Link to="/login">Log in</Link></p>
    </form></div>
  );
}

export function Login() {
  const { user, refresh } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState({ identifier: '', password: '' }); const [q] = useSearchParams(); const [err, setErr] = useState(GOOGLE_ERRORS[q.get('error')] || ''); const [unverified, setUnverified] = useState(false); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  async function submit(e) {
    e.preventDefault(); setErr(''); setUnverified(false); setBusy(true);
    try { await api('/auth/login', { method: 'POST', body: f }); await refresh(); nav('/dashboard'); }
    catch (x) { setErr(errorText(x)); setUnverified(x.message === 'email_not_verified'); } finally { setBusy(false); }
  }
  return (
    <div className="center"><form className="card narrow" onSubmit={submit}>
      <h2>Welcome back</h2><Alert>{err}</Alert>{unverified && <Resend identifier={f.identifier} />}
      <Field id="id" label="Email or User ID"><input id="id" required value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} autoComplete="username" autoCapitalize="none" /></Field>
      <Field id="pw" label="Password"><input id="pw" type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" /></Field>
      <button className="btn" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      <GoogleButton />
      <p className="hint" style={{ marginTop: 16 }}><Link to="/forgot-password">Forgot password?</Link> · <Link to="/register">Create account</Link></p>
    </form></div>
  );
}

export function VerifyEmail() {
  const [q] = useSearchParams(); const [state, setState] = useState('loading');
  const sent = useRef('');   // a token is single-use: send it once even when React's dev StrictMode runs this effect twice
  useEffect(() => { const token = q.get('token') || ''; if (sent.current === token) return; sent.current = token; api('/auth/verify-email', { method: 'POST', body: { token } }).then(() => setState('ok')).catch(() => setState('bad')); }, [q]);
  return <div className="center"><div className="card narrow stack">
    {state === 'loading' && <p>Verifying…</p>}
    {state === 'ok' && <><h2>Email verified</h2><Link className="btn" to="/login">Log in</Link></>}
    {state === 'bad' && <><h2>Link not valid</h2><p>It may have expired or already been used.</p><Link className="btn" to="/login">Back to log in</Link></>}
  </div></div>;
}

export function ForgotPassword() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [err, setErr] = useState('');
  async function submit(e) { e.preventDefault(); setErr(''); try { await api('/auth/forgot-password', { method: 'POST', body: { email } }); setSent(true); } catch (x) { setErr(errorText(x)); } }
  return <div className="center"><form className="card narrow" onSubmit={submit}>
    <h2>Reset password</h2><Alert>{err}</Alert>
    {sent ? <Alert kind="ok">If that email has an account, a reset link is on its way.</Alert> : <>
      <Field id="em" label="Email"><input id="em" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field><button className="btn">Send reset link</button></>}
  </form></div>;
}

export function ResetPassword() {
  const [q] = useSearchParams(); const nav = useNavigate();
  const [pw, setPw] = useState(''); const [err, setErr] = useState('');
  async function submit(e) { e.preventDefault(); setErr(''); try { await api('/auth/reset-password', { method: 'POST', body: { token: q.get('token') || '', password: pw } }); nav('/login'); } catch (x) { setErr(errorText(x)); } }
  return <div className="center"><form className="card narrow" onSubmit={submit}>
    <h2>Choose a new password</h2><Alert>{err}</Alert>
    <Field id="pw" label="New password" hint="At least 8 characters"><input id="pw" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
    <button className="btn">Update password</button>
  </form></div>;
}
