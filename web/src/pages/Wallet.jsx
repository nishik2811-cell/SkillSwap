import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { Alert } from '../components/UI.jsx';
import { rupees } from '../lib.js';
import { describePayout } from '../components/PayoutMethod.jsx';

const when = (d) => new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const CHIP = { paid: 'Paid', failed: 'Failed', refunded: 'Refunded', created: 'Unfinished', requested: 'Requested', rejected: 'Rejected', pending: 'Refund pending', processed: 'Refunded' };
const Stat = ({ label, value, hint }) => <div className="card"><div className="hint">{label}</div><div style={{ font: '800 1.7rem var(--font-display)' }}>{value}</div>{hint && <div className="hint">{hint}</div>}</div>;

export default function Wallet() {
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') || 'payments';
  return <div className="wrap page narrow-page">
    <header className="page-head"><p className="page-kicker">Money</p><h1>Wallet</h1></header>
    <div className="seg" role="group" aria-label="Wallet sections" style={{ marginBottom: 20 }}>
      <button aria-pressed={tab === 'payments'} onClick={() => setSp({})}>My payments</button>
      <button aria-pressed={tab === 'earnings'} onClick={() => setSp({ tab: 'earnings' })}>My earnings</button>
    </div>
    {tab === 'payments' ? <Payments /> : <Earnings />}
  </div>;
}

function Payments() {
  const [list, setList] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api('/payments').then((r) => setList(r.payments)).catch((x) => setErr(errorText(x))); }, []);
  return <>
    <Alert>{err}</Alert>
    {!list && !err && <div className="skeleton" />}
    {list?.length === 0 && <div className="empty"><h3>No payments yet</h3><p>Paid sessions you book will show up here with receipts.</p><Link className="btn small" to="/sessions">Browse sessions</Link></div>}
    <div className="stack">{list?.map((p) => (
      <article key={p.id} className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><Link to={`/sessions/${p.session.id}`}><b>{p.session.title}</b></Link><div className="hint">with {p.mentor.fullName} · {when(p.paidAt || p.createdAt)}{p.method ? ` · ${p.method.toUpperCase()}` : ''}</div></div>
          <div style={{ textAlign: 'right' }}><b>{rupees(p.amountPaise)}</b><div><span className="chip static">{CHIP[p.status]}</span></div></div>
        </div>
        {p.failureReason && p.status === 'failed' && <div className="hint err">{p.failureReason}</div>}
        {p.refunds.map((r) => <div key={r.id} className="hint">Refund {rupees(r.amountPaise)} · {CHIP[r.status] || r.status} · {r.reason}</div>)}
        {p.receiptNo && <div style={{ marginTop: 8 }}><Link className="btn small ghost" to={`/receipts/${p.id}`}>Receipt {p.receiptNo}</Link></div>}
      </article>))}</div>
  </>;
}

function Earnings() {
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const [amount, setAmount] = useState(''); const [dest, setDest] = useState(''); const [busy, setBusy] = useState(false);
  const [pm, setPm] = useState(undefined);
  const load = () => api('/earnings').then(setD).catch((x) => setErr(errorText(x)));
  useEffect(() => { load(); api('/me/payout-method').then((r) => setPm(r.method)).catch(() => setPm(null)); }, []);
  async function request(e) {
    e.preventDefault(); setErr(''); setOk(''); setBusy(true);
    try { await api('/payouts', { method: 'POST', body: { amountPaise: Math.round(Number(amount) * 100), destination: pm ? undefined : dest } }); setOk('Payout requested. The SkillSwap team will send it and mark it paid.'); setAmount(''); await load(); }
    catch (x) { setErr({ insufficient_balance: "That's more than your available balance.", below_minimum: `The minimum payout is ${rupees(d.summary.minPayoutPaise)}.` }[x.message] || errorText(x)); }
    finally { setBusy(false); }
  }
  if (!d) return <><Alert>{err}</Alert>{!err && <div className="skeleton" />}</>;
  const s = d.summary;
  return <div className="stack">
    <Alert>{err}</Alert><Alert kind="ok">{ok}</Alert>
    <div className="grid stats">
      <Stat label="Available to withdraw" value={rupees(s.balancePaise)} hint="From sessions you've completed" />
      <Stat label="Coming up" value={rupees(s.pendingPaise)} hint="Paid, session not held yet" />
      <Stat label="Paid out" value={rupees(s.paidOutPaise)} hint={s.requestedPaise ? `${rupees(s.requestedPaise)} requested` : undefined} />
      <Stat label="Platform fees" value={rupees(s.feesPaise)} hint={`on ${rupees(s.grossPaise)} collected`} />
    </div>
    <form className="card stack" onSubmit={request}>
      <h3>Request a payout</h3>
      <div className="filters">
        <div><label htmlFor="po-a">Amount (₹)</label><input id="po-a" type="number" min={s.minPayoutPaise / 100} step="1" required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        {pm ? <div><label>Paid to</label><p style={{ margin: '10px 0 0' }}><b>{describePayout(pm)}</b> · <Link to="/settings#payout">Change</Link></p></div>
          : <div><label htmlFor="po-d">UPI ID or bank reference</label><input id="po-d" required minLength={3} maxLength={120} value={dest} onChange={(e) => setDest(e.target.value)} placeholder="name@upi" />
            <div className="hint">Or <Link to="/settings#payout">save your payout details</Link> once.</div></div>}
      </div>
      <div><button className="btn" disabled={busy || s.balancePaise < s.minPayoutPaise}>{busy ? 'Requesting…' : 'Request payout'}</button>
        <p className="hint" style={{ margin: '10px 0 0' }}>Minimum {rupees(s.minPayoutPaise)}. Payouts are sent by the team, usually within a few working days.</p></div>
    </form>
    <section><h3>Sales</h3>{d.sales.length === 0 && <p className="muted">No paid bookings yet.</p>}
      {d.sales.map((p) => <div key={p.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
        <div><Link to={`/sessions/${p.session.id}`}>{p.session.title}</Link><div className="hint">{p.learner.fullName} · {when(p.paidAt)} · <span className="chip static">{CHIP[p.status]}</span></div></div>
        <div style={{ textAlign: 'right' }}><b>{rupees(p.mentorNetPaise)}</b><div className="hint">of {rupees(p.amountPaise)} · fee {rupees(p.platformFeePaise)}</div></div></div>)}</section>
    <section><h3>Payouts</h3>{d.payouts.length === 0 && <p className="muted">No payouts yet.</p>}
      {d.payouts.map((x) => <div key={x.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
        <div>{rupees(x.amountPaise)} <span className="hint">to {x.destination} · {when(x.requestedAt)}</span>{x.adminNote && <div className="hint">{x.adminNote}</div>}</div><span className="chip static">{CHIP[x.status]}</span></div>)}</section>
  </div>;
}
