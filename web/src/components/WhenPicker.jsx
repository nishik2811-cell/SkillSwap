/** A readable date-and-time field: shows "Wed, 12 Nov, 05:30 PM" (or a prompt), with the native picker invisible on top so any click or tap opens it. */
const nowLocal = (aheadMin = 5) => { const d = new Date(Date.now() + aheadMin * 60e3); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };

export default function WhenPicker({ id, value, onChange, placeholder = 'Choose a date and time', required = true }) {
  return <div className="when-pick">
    <span className={value ? '' : 'muted'}>{value ? new Date(value).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : placeholder}</span>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
    <input id={id} type="datetime-local" aria-label="Date and time" required={required} min={nowLocal()} value={value}
      onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* the native control still opens on tap */ } }} onChange={(e) => onChange(e.target.value)} />
  </div>;
}
