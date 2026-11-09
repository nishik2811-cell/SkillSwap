import { useEffect, useRef } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useSocial } from '../social.jsx';
import { useTheme } from '../theme.js';

export const Alert = ({ kind = 'err', children }) => children ? <div className={`alert ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>{children}</div> : null;
export const Field = ({ label, hint, hintKind, children, id }) => (
  <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <div className={`hint ${hintKind || ''}`} aria-live="polite">{hint}</div>}</div>
);
export const Avatar = ({ user, big }) => user?.avatarUrl
  ? <img className={`avatar ${big ? 'big' : ''}`} src={user.avatarUrl} alt="" loading="lazy" />
  : <div className={`avatar ${big ? 'big' : ''}`} aria-hidden="true">{(user?.fullName || '?')[0]}</div>;

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
          <NavLink to="/dashboard">Dashboard</NavLink><NavLink to="/discover">Discover</NavLink><NavLink to="/sessions">Sessions</NavLink><NavLink to="/messages">Chats{(social?.chatUnread || 0) > 0 && <span className="badge" aria-label={`${social.chatUnread} unread chats`}>{social.chatUnread}</span>}</NavLink><NavLink to="/connections">People{req > 0 && <span className="badge" aria-label={`${req} requests`}>{req}</span>}</NavLink><NavLink to="/notifications">Alerts{n > 0 && <span className="badge" aria-label={`${n} unread`}>{n}</span>}</NavLink><NavLink to="/settings">Settings</NavLink>
        </nav>
        {themeBtn}<button className="btn ghost small" onClick={logout}>Log out</button>
      </> : <>
        <span style={{ flex: 1 }} />{themeBtn}<Link className="btn ghost small" to="/login">Log in</Link><Link className="btn small" to="/register">Join</Link>
      </>}
    </div></header>
  );
}
