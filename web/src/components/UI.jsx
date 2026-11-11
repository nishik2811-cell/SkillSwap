import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useSocial } from '../social.jsx';
import { useTheme } from '../theme.js';

export const Alert = ({ kind = 'err', children }) => children ? <div className={`alert ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>{children}</div> : null;
export const Field = ({ label, hint, hintKind, children, id }) => (
  <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <div className={`hint ${hintKind || ''}`} aria-live="polite">{hint}</div>}</div>
);
export const STATUS_LABEL = { online: 'Online', away: 'Away', busy: 'Do not disturb', invisible: 'Invisible' };
// status: undefined = no dot; null = offline (grey); otherwise the person's picked status, Discord-style
export const Avatar = ({ user, big, status }) => {
  const face = user?.avatarUrl
    ? <img className={`avatar ${big ? 'big' : ''}`} src={user.avatarUrl} alt="" loading="lazy" />
    : <div className={`avatar ${big ? 'big' : ''}`} aria-hidden="true">{(user?.fullName || '?')[0]}</div>;
  if (status === undefined) return face;
  return <span className="av-wrap">{face}<i className={`sdot ${status || 'offline'}`} title={status ? STATUS_LABEL[status] : 'Offline'} /></span>;
};

// Your own status, set from the top bar. Others see it next to your name in chats while you're online.
function StatusPicker() {
  const { user } = useAuth(); const [s, setS] = useState(user.status || 'online');
  const change = (v) => { const old = s; setS(v); api('/me/status', { method: 'PATCH', body: { status: v } }).catch(() => setS(old)); };
  return <label className="status-pick" title={`Your status: ${STATUS_LABEL[s]}`}><i className={`sdot ${s === 'invisible' ? 'offline' : s}`} aria-hidden="true" />
    <select aria-label="Your status" value={s} onChange={(e) => change(e.target.value)}>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>;
}

export function Nav() {
  const { user, logout } = useAuth(); const social = useSocial();
  const [theme, toggleTheme] = useTheme();
  const navEl = useRef();
  useEffect(() => {   // the header wraps to two rows on phones: publish its real height so full-height screens (chat, meeting room) fit exactly
    const el = navEl.current; if (!el) return;
    const set = () => document.documentElement.style.setProperty('--nav-h', `${el.getBoundingClientRect().height}px`);
    const ro = new ResizeObserver(set); ro.observe(el); set(); return () => ro.disconnect();
  }, []);
  const themeBtn = <button className="theme-pill" onClick={toggleTheme} aria-pressed={theme === 'light'}>Theme <i /></button>;
  const n = social?.unread || 0, req = social?.conn.received.length || 0;
  return (
    <header className="nav" ref={navEl}><div className="wrap">
      <Link to="/" className="logo">skill<b>swap</b></Link>
      {user ? <>
        <nav className="nav-links" aria-label="Main">
          <NavLink to="/dashboard">Dashboard</NavLink><NavLink to="/discover">Discover</NavLink><NavLink to="/sessions">Sessions</NavLink><NavLink to="/meetings">Meetings</NavLink><NavLink to="/messages">Chats{(social?.chatUnread || 0) > 0 && <span className="badge" aria-label={`${social.chatUnread} unread chats`}>{social.chatUnread}</span>}</NavLink><NavLink to="/connections">People{req > 0 && <span className="badge" aria-label={`${req} requests`}>{req}</span>}</NavLink><NavLink to="/notifications">Alerts{n > 0 && <span className="badge" aria-label={`${n} unread`}>{n}</span>}</NavLink><NavLink to="/settings">Settings</NavLink>
        {user.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}</nav>
        <StatusPicker />{themeBtn}<button className="btn ghost small logout-btn" onClick={logout} aria-label="Log out" title="Log out"><span className="lo-text">Log out</span><svg className="lo-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 17l5-5-5-5M21 12H9" /></svg></button>
      </> : <>
        <span style={{ flex: 1 }} />{themeBtn}<Link className="btn ghost small" to="/login">Log in</Link><Link className="btn small" to="/register">Join</Link>
      </>}
    </div></header>
  );
}
