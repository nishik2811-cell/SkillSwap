import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { Alert, Avatar } from '../components/UI.jsx';
import { useSocial } from '../social.jsx';
import RoomButton from '../components/RoomButton.jsx';
import InviteConnections from '../components/InviteConnections.jsx';
import WhenPicker from '../components/WhenPicker.jsx';
import PayButton from '../components/PayButton.jsx';
import './sessiondetail.css';
import { when, priceOf, STATUS_TEXT, Stars } from '../components/SessionBits.jsx';
import { usePayConfig, windowText, feesFor, rupees as inr } from '../lib.js';

const ERR = { full: 'This session is full.', already_booked: 'You already have a booking.', previously_declined: 'The mentor declined your earlier request.', not_bookable: 'This session is no longer open for booking.',
  not_started_yet: 'You can mark it completed once a third of the session has passed.', must_be_in_future: 'Pick a time at least 5 minutes from now.', overlaps_another_session: 'You have another session at that time.', capacity_below_bookings: 'Fewer seats than people already booked.', not_started_yet: "You can complete a session once it has started.", not_reviewable: "Reviews open after the session is completed." };
const msg = (x) => ERR[x.message] || errorText(x);

export default function SessionDetail() {
  const cfg = usePayConfig();
  const { id } = useParams(); const [s, setS] = useState(null); const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/sessions/${id}`).then(setS).catch((x) => setErr(x.status === 404 ? 'Session not found.' : msg(x))), [id]);
  useEffect(() => { load(); }, [load]);
  const { socket } = useSocial();
  useEffect(() => { // a booking, cancellation or reschedule for this session refreshes the page live
    if (!socket) return; const h = (n) => { if (n.link === `/sessions/${id}`) load(); };
    socket.on('notification', h); return () => socket.off('notification', h);
  }, [socket, id, load]);
  const act = async (fn) => { setErr(''); setBusy(true); try { await fn(); await load(); } catch (x) { setErr(msg(x)); } finally { setBusy(false); } };
  if (!s) return <div className="wrap" style={{ padding: 32 }}><Alert>{err}</Alert>{!err && <div className="skeleton" />}</div>;
  const t0 = new Date(s.startsAt).getTime(), now = Date.now();
  const started = t0 <= now, open = s.status === 'scheduled' && now < t0 + s.durationMin * 60e3, b = s.myBooking; // a live session can still be joined until it ends
  const completable = now >= t0 + (s.durationMin * 60e3) / 3; // the mentor is paid once a third of the session has passed
  return <div className="wrap stack sdetail">
    <header className="sd-head">
      <div className="sd-date"><b>{String(new Date(s.startsAt).getDate()).padStart(2, '0')}</b><span>{new Date(s.startsAt).toLocaleDateString([], { month: 'short', weekday: 'short' }).toUpperCase()}<br />{new Date(s.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div className="sd-main">
        <p className="sd-kicker">{s.visibility === 'private' ? 'Private · ' : ''}{s.kind === 'group' ? `Group · ${s.capacity} seats` : 'One-on-one'} · {s.skill} · {s.durationMin} min{s.status !== 'scheduled' ? ` · ${s.status}` : ''}</p>
        <h1>{s.title}</h1>
        <div className="row sd-mentor"><Avatar user={s.mentor} /><div>with <Link to={`/u/${s.mentor.username}`}><b>{s.mentor.fullName}</b></Link>{s.mentor.rating.count > 0 && <div className="hint">★ {s.mentor.rating.avg.toFixed(1)} · {s.mentor.rating.count} reviews</div>}</div></div>
      </div>
      <div className="sd-price"><b>{priceOf(s)}</b>
        {s.pricing === 'paid' && cfg && !s.isMentor && <span>+ {inr(feesFor(s.pricePaise, cfg).fee)} fee + {inr(feesFor(s.pricePaise, cfg).gst)} GST</span>}
        {s.seatsLeft != null && <span>{s.seatsLeft} seat{s.seatsLeft === 1 ? '' : 's'} left</span>}</div>
    </header>
    {s.description && <p style={{ whiteSpace: 'pre-wrap' }}>{s.description}</p>}
    {s.status === 'scheduled' && <div><a className="btn small ghost" href={`/api/v1/sessions/${id}/calendar.ics`} download>Add to calendar</a></div>}
    {s.status === 'cancelled' && <Alert>This session was cancelled{s.cancelReason ? `: ${s.cancelReason}` : '.'}</Alert>}
    <Alert>{err}</Alert>

    {!s.isMentor && <section className="card stack">
      {b && <div className="row" style={{ gap: 10 }}><b>Your booking</b><span className={`tag bk-${b.status}`}>{STATUS_TEXT[b.status]}</span></div>}
      {(!b || b.status === 'cancelled') && open && s.seatsLeft > 0 && <>
        <input aria-label="Note to the mentor" placeholder="Note to the mentor (optional)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        <div><button className="btn accent" disabled={busy} onClick={() => act(() => api(`/sessions/${id}/book`, { method: 'POST', body: { note } }))}>{s.autoAccept ? (s.pricing === 'free' ? 'Book your seat' : 'Reserve a seat') : 'Request to join'}</button><p className="hint" style={{ margin: '10px 0 0' }}>{s.seatsLeft} seat{s.seatsLeft === 1 ? '' : 's'} left{s.autoAccept ? ' · instant booking' : ' · the mentor approves requests'}</p></div></>}
      {(!b || b.status === 'cancelled') && open && s.seatsLeft === 0 && <div className="muted">This session is full.</div>}
      {b?.status === 'confirmed' && s.status === 'scheduled' && <RoomButton sessionId={s.id} />}
      {b?.status === 'awaiting_payment' && open && <PayButton bookingId={b.id} title={s.title} amountPaise={s.pricePaise} onPaid={load} />}
      {b?.status === 'confirmed' && s.pricing === 'paid' && <div className="hint">Paid. <Link to="/wallet">See receipt</Link> · Full refund if you cancel at least {windowText(cfg?.refundWindowMinutes ?? 45)} before the start. <Link to="/refunds">Refund policy</Link></div>}
      {b && ['requested', 'awaiting_payment', 'confirmed'].includes(b.status) && open && <div><button className="btn small ghost" disabled={busy} onClick={() => window.confirm(b.status === 'confirmed' && s.pricing === 'paid' ? `Cancel your booking? You get a full refund only if the session starts in ${windowText(cfg?.refundWindowMinutes ?? 45)} or more.` : 'Cancel your booking?') && act(() => api(`/bookings/${b.id}/cancel`, { method: 'POST', body: {} }))}>Cancel booking</button></div>}
      {b?.status === 'completed' && !b.reviewed && <ReviewForm bookingId={b.id} who={s.mentor.fullName} onDone={load} />}
      {b?.reviewed && <div className="hint ok">Thanks for your review.</div>}
    </section>}

    {s.isMentor && <>
      <section className="card stack"><h3>Bookings · {s.capacity - s.seatsLeft}/{s.capacity} seats taken</h3>
        {s.bookings.length === 0 && <p className="muted">No one has booked yet.</p>}
        {s.bookings.map((x) => <div key={x.id} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row"><Avatar user={x.learner} /><div><Link to={`/u/${x.learner.username}`}><b>{x.learner.fullName}</b></Link><div className="hint">{STATUS_TEXT[x.status]}{x.note ? ` · “${x.note}”` : ''}</div></div></div>
            <div className="row">
              {x.status === 'requested' && open && <><button className="btn small accent" disabled={busy} onClick={() => act(() => api(`/bookings/${x.id}/accept`, { method: 'POST', body: {} }))}>Accept</button><button className="btn small ghost" disabled={busy} onClick={() => act(() => api(`/bookings/${x.id}/reject`, { method: 'POST', body: {} }))}>Decline</button></>}
              {['awaiting_payment', 'confirmed'].includes(x.status) && open && <button className="btn small ghost" disabled={busy} onClick={() => window.confirm(`Remove ${x.learner.fullName}?`) && act(() => api(`/bookings/${x.id}/cancel`, { method: 'POST', body: {} }))}>Remove</button>}
            </div></div>
          {x.status === 'completed' && !x.reviewed && <ReviewForm bookingId={x.id} who={x.learner.fullName} onDone={load} />}
        </div>)}
      </section>
      {s.status === 'scheduled' && <section className="card stack"><h3>Invite connections</h3>
        <p className="hint" style={{ marginTop: 0 }}>{s.visibility === 'private' ? 'Only people you invite can see and book this session.' : 'They get a notification with a link to book.'}</p>
        <InviteConnections url={`/sessions/${s.id}/invites`} /></section>}
      {s.status === 'scheduled' && <section className="card stack"><h3>Manage</h3>
        <RoomButton sessionId={s.id} host />
        <Reschedule s={s} act={act} busy={busy} />
        <div className="row">
          <button className="btn" disabled={busy || !completable} title={completable ? '' : 'Available once a third of the session has passed'} onClick={() => window.confirm('Mark this session as completed?') && act(() => api(`/sessions/${id}/complete`, { method: 'POST', body: {} }))}>Mark as completed</button>
          <button className="btn ghost" disabled={busy} onClick={() => { const reason = window.prompt('Reason for cancelling (shared with learners):', ''); if (reason !== null) act(() => api(`/sessions/${id}/cancel`, { method: 'POST', body: { reason } })); }}>Cancel session</button>
        </div>{!completable && <p className="hint">You can mark it completed (and get paid) once a third of the session has passed.</p>}</section>}
    </>}
  </div>;
}

function Reschedule({ s, act, busy }) {
  const [v, setV] = useState('');
  return <div className="stack" style={{ gap: 8 }}><label htmlFor="rs" style={{ margin: 0 }}>Reschedule to</label>
    <div className="row" style={{ flexWrap: 'nowrap' }}><div style={{ flex: 1, maxWidth: 300 }}><WhenPicker id="rs" placeholder="Pick a new time" value={v} onChange={setV} required={false} /></div>
      <button className="btn small" disabled={busy || !v} onClick={() => act(() => api(`/sessions/${s.id}`, { method: 'PATCH', body: { startsAt: new Date(v).toISOString() } }))}>Move</button></div>
    <p className="hint" style={{ margin: 0 }}>Booked learners are notified.</p></div>;
}

function ReviewForm({ bookingId, who, onDone }) {
  const [rating, setRating] = useState(0); const [comment, setComment] = useState(''); const [err, setErr] = useState('');
  async function submit(e) { e.preventDefault(); setErr(''); try { await api(`/bookings/${bookingId}/review`, { method: 'POST', body: { rating, comment: comment || undefined } }); onDone(); } catch (x) { setErr(msg(x)); } }
  return <form className="stack" onSubmit={submit}><b>Review {who}</b><Alert>{err}</Alert><Stars value={rating} onChange={setRating} />
    <textarea aria-label="Review comment" rows={2} maxLength={1000} placeholder="How did it go? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
    <div><button className="btn small" disabled={!rating}>Submit review</button></div></form>;
}
