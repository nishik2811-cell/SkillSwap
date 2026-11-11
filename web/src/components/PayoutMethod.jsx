import { useEffect, useState } from 'react';
import { api, errorText } from '../api.js';
import { Alert } from './UI.jsx';

export const describePayout = (m) => !m ? '' : m.kind === 'upi' ? `UPI · ${m.upiId}` : `Bank · ${m.accountName} · ••••${m.accountNumber.slice(-4)} · ${m.ifsc}`;
const EMPTY = { kind: 'upi', upiId: '', accountName: '', accountNumber: '', ifsc: '' };

/** Where a mentor's earnings are sent: a UPI ID or a bank account. Loads and saves on its own (no <form>, so it can sit inside other forms). */
export default function PayoutMethod({ onSaved }) {
  const [m, setM] = useState(undefined); const [edit, setEdit] = useState(false); const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/me/payout-method').then((r) => { setM(r.method); setEdit(!r.method); }).catch(() => { setM(null); setEdit(true); }); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setErr(''); setOk(''); setBusy(true);
    try {
      const body = f.kind === 'upi' ? { kind: 'upi', upiId: f.upiId } : { kind: 'bank', accountName: f.accountName, accountNumber: f.accountNumber.replace(/\s/g, ''), ifsc: f.ifsc };
      const r = await api('/me/payout-method', { method: 'PUT', body }); setM(r.method); setEdit(false); setOk('Saved.'); onSaved?.(r.method);
    } catch (x) { const d = x.body?.details; setErr(d && Object.values(d).flat()[0] ? `${Object.values(d).flat()[0]}.` : errorText(x)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('Remove your payout details?')) return;
    try { await api('/me/payout-method', { method: 'DELETE' }); setM(null); setF(EMPTY); setEdit(true); setOk(''); } catch (x) { setErr(errorText(x)); }
  }
  if (m === undefined) return <p className="hint">Loading…</p>;
  if (!edit) return <div className="stack" style={{ gap: 8 }}>
    <div className="row payout-saved"><b>{describePayout(m)}</b>
      <span className="row" style={{ gap: 8 }}><button type="button" className="btn small ghost" onClick={() => { setF({ ...EMPTY, ...m }); setEdit(true); setOk(''); }}>Change</button>
        <button type="button" className="btn small ghost" onClick={remove}>Remove</button></span></div>
    <Alert kind="ok">{ok}</Alert></div>;
  return <div className="stack" style={{ gap: 10 }}>
    <div className="row" role="radiogroup" aria-label="Payout method" style={{ gap: 8 }}>
      <button type="button" className="chip" role="radio" aria-checked={f.kind === 'upi'} aria-pressed={f.kind === 'upi'} onClick={() => setF({ ...f, kind: 'upi' })}>UPI ID</button>
      <button type="button" className="chip" role="radio" aria-checked={f.kind === 'bank'} aria-pressed={f.kind === 'bank'} onClick={() => setF({ ...f, kind: 'bank' })}>Bank account</button>
    </div>
    {f.kind === 'upi'
      ? <input aria-label="UPI ID" placeholder="yourname@okbank" autoComplete="off" autoCapitalize="none" value={f.upiId} onChange={set('upiId')} />
      : <>
        <input aria-label="Account holder name" placeholder="Account holder name" autoComplete="name" value={f.accountName} onChange={set('accountName')} />
        <input aria-label="Account number" placeholder="Account number" inputMode="numeric" autoComplete="off" value={f.accountNumber} onChange={set('accountNumber')} />
        <input aria-label="IFSC code" placeholder="IFSC, e.g. SBIN0001234" autoComplete="off" style={{ textTransform: 'uppercase' }} maxLength={11} value={f.ifsc} onChange={set('ifsc')} />
      </>}
    <p className="hint" style={{ margin: 0 }}>Used only to send you your earnings. Only you and the SkillSwap team can see it.</p>
    <Alert>{err}</Alert>
    <div className="row" style={{ gap: 8 }}><button type="button" className="btn small accent" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save payout details'}</button>
      {m && <button type="button" className="btn small ghost" onClick={() => { setEdit(false); setErr(''); }}>Cancel</button>}</div>
  </div>;
}
