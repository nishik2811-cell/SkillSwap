import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { Alert } from '../components/UI.jsx';
import { rupees } from '../lib.js';
import './admin.css';

const TABS = [['overview', 'Overview'], ['users', 'People'], ['reports', 'Reports'], ['payments', 'Payments'], ['disputes', 'Disputes'], ['payouts', 'Payouts'], ['catalog', 'Skills'], ['settings', 'Settings'], ['audit', 'Audit log']];
const when = (d) => (d ? new Date(d).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** GET once and again after every write. Errors show in the page banner. */
function useLoad(path, setErr) {
  const [data, setData] = useState(null);
  const load = useCallback(() => api(path).then((d) => { setData(d); setErr(''); }).catch((x) => setErr(errorText(x))), [path, setErr]);
  useEffect(() => { setData(null); load(); }, [load]);
  return [data, load];
}
/** POST/PATCH/PUT/DELETE, then reload. `ask` collects a note with a prompt (kept simple on purpose). */
function useAct(setErr, reload) {
  return async (path, method, body, ask) => {
    let note;
    if (ask) { note = window.prompt(ask); if (note === null) return; }
    try { await api(path, { method, body: ask ? { ...body, [body?.noteKey || 'note']: note } : body }); setErr(''); await reload(); } catch (x) { setErr(errorText(x)); }
  };
}

export default function Admin() {
  const [sp, setSp] = useSearchParams(); const tab = TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'overview';
  const [err, setErr] = useState('');
  const Body = { overview: Overview, users: Users, reports: Reports, payments: Payments, disputes: Disputes, payouts: Payouts, catalog: Catalog, settings: Settings, audit: Audit }[tab];
  return <div className="wrap admin">
    <h2>Admin</h2>
    <div className="admin-tabs" role="tablist" aria-label="Admin sections">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setErr(''); setSp({ tab: k }); }}>{l}</button>)}</div>
    <Alert>{err}</Alert>
    <Body setErr={setErr} />
  </div>;
}

const Stat = ({ label, value, warn }) => <div className={`card stat ${warn ? 'warn' : ''}`}><div className="hint">{label}</div><b>{value}</b></div>;
const Empty = ({ children }) => <p className="hint">{children}</p>;

function Overview({ setErr }) {
  const [o] = useLoad('/admin/overview', setErr), [a] = useLoad('/admin/analytics', setErr);
  if (!o) return <div className="skeleton" />;
  const max = Math.max(1, ...(a?.signups.map((x) => x.n) || [1]));
  return <div className="stack">
    <div className="grid">
      <Stat label="People" value={o.users} /><Stat label="Active" value={o.activeUsers} /><Stat label="Suspended" value={o.suspendedUsers} warn={o.suspendedUsers > 0} />
      <Stat label="Upcoming sessions" value={o.upcomingSessions} /><Stat label="Completed sessions" value={o.completedSessions} />
      <Stat label="Open reports" value={o.openReports} warn={o.openReports > 0} /><Stat label="Open disputes" value={o.openDisputes} warn={o.openDisputes > 0} /><Stat label="Payouts waiting" value={o.pendingPayouts} warn={o.pendingPayouts > 0} />
      <Stat label="Gross payments" value={rupees(o.grossPaise)} /><Stat label="Platform fees" value={rupees(o.platformFeesPaise)} /><Stat label="Refunded" value={rupees(o.refundedPaise)} /><Stat label="Failed refunds" value={o.failedRefunds} warn={o.failedRefunds > 0} />
    </div>
    {a && <div className="card"><h3>Sign-ups, last 30 days</h3>
      {a.signups.length ? <div className="bars" role="img" aria-label="Sign-ups per day">{a.signups.map((x) => <i key={x.d} title={`${x.d}: ${x.n}`} style={{ height: `${(x.n / max) * 100}%` }} />)}</div> : <Empty>No sign-ups yet.</Empty>}
      <h3>Most-taught skills</h3>
      {a.topSkills.length ? <ol className="top">{a.topSkills.map((s) => <li key={s.name}><span>{s.name}</span><b>{s.n}</b></li>)}</ol> : <Empty>No sessions yet.</Empty>}
    </div>}
  </div>;
}

function Users({ setErr }) {
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const path = `/admin/users?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`;
  const [d, reload] = useLoad(path, setErr), act = useAct(setErr, reload);
  return <div className="stack">
    <div className="row"><input type="search" placeholder="Search name, ID or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search people" />
      <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deactivated">Deactivated</option></select></div>
    {!d ? <div className="skeleton" /> : d.users.length === 0 ? <Empty>Nobody matches.</Empty> : <div className="table-wrap"><table className="atable">
      <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Rating</th><th>Reports</th><th>Joined</th><th /></tr></thead>
      <tbody>{d.users.map((u) => <tr key={u.id}>
        <td><b>{u.fullName}</b><div className="hint">@{u.username} · {u.email}{u.verified ? '' : ' · unverified'}</div></td><td>{u.role}</td><td><span className={`chip static ${u.status !== 'active' ? 'bad' : ''}`}>{u.status}</span></td>
        <td>{u.rating == null ? '–' : `${u.rating.toFixed(1)} (${u.ratingCount})`}</td><td>{u.reportsAgainst || 0}</td><td>{when(u.createdAt)}</td>
        <td>{u.role !== 'admin' && (u.status === 'active'
          ? <button className="btn small ghost" onClick={() => act(`/admin/users/${u.id}`, 'PATCH', { status: 'suspended' }, 'Reason for suspending (optional):')}>Suspend</button>
          : <button className="btn small ghost" onClick={() => act(`/admin/users/${u.id}`, 'PATCH', { status: 'active' })}>Reactivate</button>)}</td></tr>)}</tbody></table></div>}
    <div className="row"><button className="btn small ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span className="hint">Page {page}</span><button className="btn small ghost" disabled={!d || d.users.length < 25} onClick={() => setPage(page + 1)}>Next</button></div>
  </div>;
}

const StatusSeg = ({ value, set, options }) => <div className="seg" role="group">{options.map((o) => <button key={o} aria-pressed={value === o} onClick={() => set(o)}>{o}</button>)}</div>;

function Reports({ setErr }) {
  const [st, setSt] = useState('open'); const [d, reload] = useLoad(`/admin/reports?status=${st}`, setErr), act = useAct(setErr, reload);
  return <div className="stack"><StatusSeg value={st} set={setSt} options={['open', 'resolved', 'dismissed']} />
    {!d ? <div className="skeleton" /> : d.reports.length === 0 ? <Empty>Nothing here.</Empty> : d.reports.map((r) => <article key={r.id} className="card">
      <div className="row between"><div><b>{r.reason}</b> <span className="hint">· {when(r.createdAt)}</span></div><span className={`chip static ${r.target.status !== 'active' ? 'bad' : ''}`}>{r.target.fullName} (@{r.target.username}) · {r.target.status}</span></div>
      {r.details && <p>{r.details}</p>}<div className="hint">Reported by @{r.reporter.username}{r.session ? ` · session: ${r.session.title}` : ''}{r.resolutionNote ? ` · note: ${r.resolutionNote}` : ''}</div>
      {st === 'open' && <div className="row">
        <button className="btn small" onClick={() => act(`/admin/reports/${r.id}/resolve`, 'POST', { outcome: 'resolved', suspendTarget: true }, 'Note (the person will be suspended):')}>Resolve and suspend</button>
        <button className="btn small ghost" onClick={() => act(`/admin/reports/${r.id}/resolve`, 'POST', { outcome: 'resolved' }, 'Resolution note (optional):')}>Resolve</button>
        <button className="btn small ghost" onClick={() => act(`/admin/reports/${r.id}/resolve`, 'POST', { outcome: 'dismissed' }, 'Why dismissed? (optional):')}>Dismiss</button></div>}
    </article>)}</div>;
}

function Payments({ setErr }) {
  const [st, setSt] = useState(''); const [d, reload] = useLoad(`/admin/payments${st ? `?status=${st}` : ''}`, setErr), act = useAct(setErr, reload);
  return <div className="stack"><StatusSeg value={st || 'all'} set={(v) => setSt(v === 'all' ? '' : v)} options={['all', 'paid', 'created', 'failed', 'refunded']} />
    {!d ? <div className="skeleton" /> : d.payments.length === 0 ? <Empty>No payments.</Empty> : <div className="table-wrap"><table className="atable">
      <thead><tr><th>Session</th><th>Learner → Mentor</th><th>Amount</th><th>Fee</th><th>Status</th><th>When</th><th /></tr></thead>
      <tbody>{d.payments.map((p) => <tr key={p.id}><td>{p.session.title}<div className="hint">#{p.id}{p.gatewayPaymentId ? ` · ${p.gatewayPaymentId}` : ''}</div></td><td>@{p.learner} → @{p.mentor}</td>
        <td>{rupees(p.amountPaise)}{p.refundedPaise > 0 && <div className="hint">refunded {rupees(p.refundedPaise)}</div>}</td><td>{rupees(p.platformFeePaise)}</td><td><span className="chip static">{p.status}</span></td><td>{when(p.paidAt || p.createdAt)}</td>
        <td>{p.status === 'paid' && p.refundedPaise < p.amountPaise && <button className="btn small ghost" onClick={() => act(`/admin/payments/${p.id}/refund`, 'POST', { noteKey: 'reason' }, 'Reason for the full refund:')}>Refund</button>}</td></tr>)}</tbody></table></div>}</div>;
}

function Disputes({ setErr }) {
  const [st, setSt] = useState('open'); const [d, reload] = useLoad(`/admin/disputes?status=${st}`, setErr), act = useAct(setErr, reload);
  return <div className="stack"><StatusSeg value={st} set={setSt} options={['open', 'refunded', 'rejected']} />
    {!d ? <div className="skeleton" /> : d.disputes.length === 0 ? <Empty>No disputes.</Empty> : d.disputes.map((x) => <article key={x.id} className="card">
      <div className="row between"><b>{x.sessionTitle}</b><span>{rupees(x.amountPaise)} · {x.paymentStatus}</span></div><p>{x.reason}</p><div className="hint">Opened by @{x.openedBy} · {when(x.createdAt)}{x.adminNote ? ` · decision: ${x.adminNote}` : ''}</div>
      {st === 'open' && <div className="row"><button className="btn small" onClick={() => act(`/admin/disputes/${x.id}/resolve`, 'POST', { outcome: 'refund' }, 'Note to the learner (refund approved):')}>Approve refund</button>
        <button className="btn small ghost" onClick={() => act(`/admin/disputes/${x.id}/resolve`, 'POST', { outcome: 'reject' }, 'Note to the learner (declined):')}>Decline</button></div>}</article>)}</div>;
}

function Payouts({ setErr }) {
  const [st, setSt] = useState('requested'); const [d, reload] = useLoad(`/admin/payouts?status=${st}`, setErr), act = useAct(setErr, reload);
  return <div className="stack"><StatusSeg value={st} set={setSt} options={['requested', 'paid', 'rejected']} />
    {!d ? <div className="skeleton" /> : d.payouts.length === 0 ? <Empty>No payouts.</Empty> : d.payouts.map((p) => <article key={p.id} className="card">
      <div className="row between"><b>{p.mentor.fullName} (@{p.mentor.username})</b><b>{rupees(p.amountPaise)}</b></div><div className="hint">Send to: {p.destination} · requested {when(p.requestedAt)}{p.adminNote ? ` · ${p.adminNote}` : ''}</div>
      {st === 'requested' && <div className="row"><button className="btn small" onClick={() => act(`/admin/payouts/${p.id}/pay`, 'POST', {}, 'Transfer reference (optional). Only click OK after you have sent the money:')}>Mark as paid</button>
        <button className="btn small ghost" onClick={() => act(`/admin/payouts/${p.id}/reject`, 'POST', {}, 'Why declined?')}>Decline</button></div>}</article>)}</div>;
}

function Catalog({ setErr }) {
  const [d, reload] = useLoad('/admin/catalog', setErr);
  const [cat, setCat] = useState('');
  const ask = async (msg, fn) => { const v = window.prompt(msg); if (v && v.trim()) await fn(v.trim()); };
  const call = (path, method, body) => api(path, { method, body }).then(reload).then(() => setErr('')).catch((x) => setErr(x.message === 'category_not_empty' ? 'Move or delete its skills first.' : x.message === 'skill_in_use' ? 'People or sessions still use this skill.' : x.message === 'name_taken' ? 'That name already exists.' : errorText(x)));
  if (!d) return <div className="skeleton" />;
  return <div className="stack">
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (cat.trim()) call('/admin/categories', 'POST', { name: cat.trim() }).then(() => setCat('')); }}>
      <input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="New category" aria-label="New category" /><button className="btn small">Add category</button></form>
    {d.categories.map((c) => <article key={c.id} className="card">
      <div className="row between"><h3>{c.name}</h3><span className="row">
        <button className="btn small ghost" onClick={() => ask('Add a skill to ' + c.name, (name) => call('/admin/skills', 'POST', { name, categoryId: c.id }))}>Add skill</button>
        <button className="btn small ghost" onClick={() => ask('Rename category', (name) => call(`/admin/categories/${c.id}`, 'PATCH', { name }))}>Rename</button>
        <button className="btn small ghost" onClick={() => window.confirm(`Delete "${c.name}"?`) && call(`/admin/categories/${c.id}`, 'DELETE')}>Delete</button></span></div>
      {c.skills.length === 0 ? <Empty>No skills.</Empty> : <ul className="skills">{c.skills.map((s) => <li key={s.id}><span>{s.name}</span><span className="hint">{s.mentors} mentors · {s.learners} learners · {s.sessions} sessions</span>
        <button className="btn small ghost" onClick={() => ask('Rename skill', (name) => call(`/admin/skills/${s.id}`, 'PATCH', { name }))}>Rename</button>
        <button className="btn small ghost" onClick={() => window.confirm(`Delete "${s.name}"?`) && call(`/admin/skills/${s.id}`, 'DELETE')}>Delete</button></li>)}</ul>}
    </article>)}
  </div>;
}

const NICE = { commission_percent: ['Platform fee charged to learners (%)', 0, 50, 0.5], gst_percent: ['GST on the platform fee (%)', 0, 40, 0.5], refund_window_minutes: ['Full-refund window (minutes before a session)', 0, 10080, 5], unpaid_hold_hours: ['Hold an unpaid seat for (hours)', 1, 168, 1] };
function Settings({ setErr }) {
  const [d, reload] = useLoad('/admin/settings', setErr); const [f, setF] = useState(null); const [ok, setOk] = useState('');
  useEffect(() => { if (d) setF({ ...d, min_payout: d.min_payout_paise / 100 }); }, [d]);
  if (!f) return <div className="skeleton" />;
  const w = f.ranking_weights, sum = Object.values(w).reduce((a, b) => a + Number(b), 0) || 1;
  async function save(e) {
    e.preventDefault(); setOk(''); setErr('');
    try {
      await api('/admin/settings', { method: 'PUT', body: { commission_percent: Number(f.commission_percent), gst_percent: Number(f.gst_percent), refund_window_minutes: Number(f.refund_window_minutes), unpaid_hold_hours: Number(f.unpaid_hold_hours), min_payout_paise: Math.round(Number(f.min_payout) * 100), ranking_weights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Number(v)])) } });
      setOk('Saved. Best Match uses the new weights on the next search.'); reload();
    } catch (x) { setErr(errorText(x)); }
  }
  return <form className="stack" onSubmit={save}>
    <Alert kind="ok">{ok}</Alert>
    <div className="card stack"><h3>Money</h3>
      {Object.entries(NICE).map(([k, [label, min, max, step]]) => <div className="field" key={k}><label htmlFor={k}>{label}</label><input id={k} type="number" min={min} max={max} step={step} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}
      <div className="field"><label htmlFor="mp">Smallest payout (₹, 0 for none)</label><input id="mp" type="number" min="0" step="1" value={f.min_payout} onChange={(e) => setF({ ...f, min_payout: e.target.value })} /></div></div>
    <div className="card stack"><h3>Best Match weights</h3><p className="hint">How much each signal counts in the default ranking. They are scaled to add up to 100%, and signals with no data are skipped, not penalised.</p>
      {Object.keys(w).map((k) => <div className="field" key={k}><label htmlFor={`w-${k}`}>{k.replace(/_/g, ' ')} <b>{Math.round((Number(w[k]) / sum) * 100)}%</b></label>
        <input id={`w-${k}`} type="range" min="0" max="1" step="0.05" value={w[k]} onChange={(e) => setF({ ...f, ranking_weights: { ...w, [k]: e.target.value } })} /></div>)}
      <button type="button" className="btn small ghost" onClick={() => setF({ ...f, ranking_weights: { ...f.defaults } })}>Reset to defaults</button></div>
    <button className="btn">Save settings</button>
  </form>;
}

function Audit({ setErr }) {
  const [d] = useLoad('/admin/audit', setErr);
  if (!d) return <div className="skeleton" />;
  return d.actions.length === 0 ? <Empty>No admin actions yet.</Empty> : <div className="table-wrap"><table className="atable"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Note</th></tr></thead>
    <tbody>{d.actions.map((a) => <tr key={a.id}><td>{when(a.at)}</td><td>@{a.admin}</td><td>{a.action}</td><td>{a.targetType}{a.targetId ? ` #${a.targetId}` : ''}</td><td>{a.note}</td></tr>)}</tbody></table></div>;
}
