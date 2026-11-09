import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field } from '../components/UI.jsx';

export function Register() {
  const [f, setF] = useState({ fullName: '', email: '', username: '', password: '' });
  const [avail, setAvail] = useState(null); // {available, suggestions} | 'invalid'
  const [err, setErr] = useState(''); const [fieldErrs, setFieldErrs] = useState({}); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const timer = useRef();
  useEffect(() => {
    clearTimeout(timer.current);
    const u = f.username.trim().toLowerCase();
    if (!u) return setAvail(null);
    if (!/^[a-z0-9_]{3,20}$/.test(u)) return setAvail('invalid');
    timer.current = setTimeout(() => api(`/auth/username-available?u=${u}`).then(setAvail).catch(() => setAvail(null)), 350);
    return () => clearTimeout(timer.current);
  }, [f.username]);

  async function submit(e) {
    e.preventDefault(); setErr(''); setFieldErrs({}); setBusy(true);
    try { await api('/auth/register', { method: 'POST', body: f }); setDone(true); }
    catch (x) {
      if (x.message === 'username_taken') setAvail({ available: false, suggestions: x.body.suggestions });
      else if (x.message === 'invalid_input') setFieldErrs(x.body.details || {});
      setErr(errorText(x));
    } finally { setBusy(false); }
  }
  if (done) return <div className="center"><div className="card narrow stack"><h2>Check your inbox</h2><p>We sent a verification link to <b>{f.email}</b>. Open it, then log in to finish setting up.</p><Link className="btn" to="/login">Go to log in</Link></div></div>;
  const hint = avail === 'invalid' ? '3–20 characters: letters, numbers, underscore' : avail?.available ? `@${f.username.toLowerCase()} is available` : avail && !avail.available ? 'That ID is taken. Try one of these:' : 'This is your public ID: skillswap.app/u/yourid';
  return (
    <div className="center"><form className="card narrow" onSubmit={submit} noValidate>
      <h2>Join SkillSwap</h2><p className="muted">Teach what you know. Learn what you don't.</p>
      <Alert>{err}</Alert>
      <Field id="fn" label="Full name" hint={fieldErrs.fullName?.[0]}><input id="fn" required value={f.fullName} onChange={set('fullName')} autoComplete="name" /></Field>
      <Field id="em" label="Email" hint={fieldErrs.email?.[0]}><input id="em" type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></Field>
      <Field id="un" label="Choose your User ID" hint={hint} hintKind={avail?.available ? 'ok' : avail ? 'err' : ''}>
        <input id="un" required value={f.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" spellCheck="false" />
        {avail && avail !== 'invalid' && !avail.available && <div className="row" style={{ marginTop: 8 }}>{avail.suggestions.map((s) => <button type="button" key={s} className="chip" onClick={() => setF({ ...f, username: s })}>@{s}</button>)}</div>}
      </Field>
      <Field id="pw" label="Password" hint={fieldErrs.password?.[0] || 'At least 8 characters'} hintKind={fieldErrs.password ? 'err' : ''}><input id="pw" type="password" required minLength={8} value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
      <button className="btn" disabled={busy || avail?.available === false}>{busy ? 'Creating…' : 'Create account'}</button>
      <p className="hint" style={{ marginTop: 16 }}>Already a member? <Link to="/login">Log in</Link></p>
    </form></div>
  );
}

export function Login() {
  const { user, refresh } = useAuth(); const nav = useNavigate();
  const [f, setF] = useState({ identifier: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api('/auth/login', { method: 'POST', body: f }); await refresh(); nav('/dashboard'); }
    catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  }
  return (
    <div className="center"><form className="card narrow" onSubmit={submit}>
      <h2>Welcome back</h2><Alert>{err}</Alert>
      <Field id="id" label="Email or User ID"><input id="id" required value={f.identifier} onChange={(e) => setF({ ...f, identifier: e.target.value })} autoComplete="username" autoCapitalize="none" /></Field>
      <Field id="pw" label="Password"><input id="pw" type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" /></Field>
      <button className="btn" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      <p className="hint" style={{ marginTop: 16 }}><Link to="/forgot-password">Forgot password?</Link> · <Link to="/register">Create account</Link></p>
    </form></div>
  );
}

export function VerifyEmail() {
  const [q] = useSearchParams(); const [state, setState] = useState('loading');
  useEffect(() => { api('/auth/verify-email', { method: 'POST', body: { token: q.get('token') || '' } }).then(() => setState('ok')).catch(() => setState('bad')); }, [q]);
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
