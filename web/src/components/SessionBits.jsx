import { Link } from 'react-router-dom';
import { rupees } from '../lib.js';

export const when = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const priceOf = (s) => (s.pricing === 'free' ? 'Free' : `${rupees(s.pricePaise)} / person`);
export const STATUS_TEXT = { requested: 'Waiting for mentor', awaiting_payment: 'Accepted · awaiting payment', confirmed: 'Confirmed', rejected: 'Declined', cancelled: 'Cancelled', completed: 'Completed' };

export function Stars({ value, onChange }) {
  return <div role={onChange ? 'radiogroup' : 'img'} aria-label={`Rating ${value || 0} of 5`} className="row" style={{ gap: 2 }}>
    {[1, 2, 3, 4, 5].map((n) => onChange
      ? <button type="button" key={n} role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="star" data-on={n <= value} onClick={() => onChange(n)}>★</button>
      : <span key={n} className="star" data-on={n <= Math.round(value)}>★</span>)}
  </div>;
}

export function SessionCard({ s, showMentor = true }) {
  return <article className="card">
    <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
      <div><span className={`tag ${s.kind === 'group' ? 'learner' : 'mentor'}`}>{s.kind === 'group' ? `Group · ${s.capacity} seats` : 'One-on-one'}</span>
        {new Date(s.startsAt) <= new Date() && s.status === 'scheduled' && <span className="tag live">● Live now</span>}{s.visibility === 'private' && <span className="tag">Private</span>}
        <h3 style={{ margin: '4px 0' }}><Link to={`/sessions/${s.id}`}>{s.title}</Link></h3></div>
      <b>{priceOf(s)}</b>
    </div>
    <div className="muted">{when(s.startsAt)} · {s.durationMin} min · {s.skill}</div>
    {showMentor && s.mentor && <div className="hint">with <Link to={`/u/${s.mentor.username}`}>{s.mentor.fullName}</Link>{s.mentor.rating?.count ? ` · ★ ${s.mentor.rating.avg.toFixed(1)} (${s.mentor.rating.count})` : ''}</div>}
    <div className="row" style={{ marginTop: 8 }}>
      {s.seatsLeft != null && <span className="chip static">{s.seatsLeft} seat{s.seatsLeft === 1 ? '' : 's'} left</span>}
      {s.bookingStatus && <span className="chip static">{STATUS_TEXT[s.bookingStatus]}</span>}
      {s.pendingRequests > 0 && <span className="badge">{s.pendingRequests} request{s.pendingRequests > 1 ? 's' : ''}</span>}
      {s.status === 'cancelled' && <span className="chip static">Cancelled</span>}
      {s.autoAccept && s.seatsLeft != null && <span className="hint">Instant booking</span>}
    </div>
  </article>;
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/* One session as a row in a setlist: date, details, price. The whole row is clickable through the title link. */
export function SessionRow({ s, showMentor = true }) {
  const d = new Date(s.startsAt);
  return <article className="srow">
    <div className="srow-date"><b>{String(d.getDate()).padStart(2, '0')}</b><span>{MON[d.getMonth()]} · {DOW[d.getDay()]}<br />{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
    <div className="srow-main">
      <span className={`tag ${s.kind === 'group' ? 'learner' : 'mentor'}`}>{s.kind === 'group' ? `Group · ${s.capacity} seats` : 'One-on-one'}</span>
      <h3><Link className="srow-title" to={`/sessions/${s.id}`}>{s.title}</Link></h3>
      <p className="srow-meta">{s.skill} · {s.durationMin} min{showMentor && s.mentor ? <> · with <Link to={`/u/${s.mentor.username}`}>{s.mentor.fullName}</Link>{s.mentor.rating?.count ? ` · ★ ${s.mentor.rating.avg.toFixed(1)}` : ''}</> : null}</p>
      <div className="srow-chips">
        {s.bookingStatus && <span className="chip static">{STATUS_TEXT[s.bookingStatus]}</span>}
        {s.pendingRequests > 0 && <span className="badge">{s.pendingRequests} request{s.pendingRequests > 1 ? 's' : ''}</span>}
        {s.status === 'cancelled' && <span className="chip static">Cancelled</span>}
        {s.autoAccept && s.seatsLeft != null && <span className="chip static">Instant booking</span>}
      </div>
    </div>
    <div className="srow-price"><b>{priceOf(s)}</b>{s.seatsLeft != null && <span>{s.seatsLeft} seat{s.seatsLeft === 1 ? '' : 's'} left</span>}</div>
  </article>;
}
