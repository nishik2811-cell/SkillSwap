import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { Alert } from '../components/UI.jsx';
import { rupees } from '../lib.js';

const dt = (d) => new Date(d).toLocaleString([], { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Receipt() {
  const { id } = useParams(); const [p, setP] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { api(`/payments/${id}`).then(setP).catch((x) => setErr(x.status === 404 ? 'Receipt not found.' : errorText(x))); }, [id]);
  if (!p) return <div className="wrap" style={{ padding: 32 }}><Alert>{err}</Alert></div>;
  if (!p.receiptNo) return <div className="wrap" style={{ padding: 32 }}><Alert>A receipt is only issued for completed payments.</Alert></div>;
  return <div className="wrap receipt" style={{ padding: '32px 16px', maxWidth: 640 }}>
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Receipt</h2><b>{p.receiptNo}</b></div>
      <div className="hint">SkillSwap · Paid {dt(p.paidAt)}</div>
      <table className="rtable"><tbody>
        <tr><td>Session</td><td>{p.session.title}</td></tr>
        <tr><td>Mentor</td><td>{p.mentor.fullName} (@{p.mentor.username})</td></tr>
        <tr><td>Learner</td><td>{p.learner.fullName} (@{p.learner.username})</td></tr>
        <tr><td>Session time</td><td>{dt(p.session.startsAt)}</td></tr>
        <tr><td>Payment method</td><td>{(p.method || '—').toUpperCase()}</td></tr>
        <tr><td>Reference</td><td>{p.gatewayPaymentId}</td></tr>
        <tr><td><b>Total paid</b></td><td><b>{rupees(p.amountPaise)}</b> {p.currency}</td></tr>
        {p.platformFeePaise != null && <><tr><td>Platform fee ({p.commissionPercent}%)</td><td>{rupees(p.platformFeePaise)}</td></tr><tr><td>Mentor earnings</td><td>{rupees(p.mentorNetPaise)}</td></tr></>}
        {p.refunds.map((r) => <tr key={r.id}><td>Refund ({r.status})</td><td>− {rupees(r.amountPaise)}</td></tr>)}
      </tbody></table>
      <div className="no-print"><button className="btn small" onClick={() => window.print()}>Print or save as PDF</button></div>
    </div></div>;
}
