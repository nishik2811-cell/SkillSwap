import { useNavigate } from 'react-router-dom';
import { useSocial } from '../social.jsx';
import './notifications.css';

const ago = (d) => { const s = (Date.now() - new Date(d)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(d).toLocaleDateString([], { day: '2-digit', month: 'short' }); };

export default function Notifications() {
  const { notes, unread, markRead, markAllRead } = useSocial(); const nav = useNavigate();
  return <div className="wrap notes">
    <div className="nt-head">
      <div><p className="nt-kicker">Inbox · {unread > 0 ? `${unread} unread` : 'all caught up'}</p><h2>Notifications</h2></div>
      {unread > 0 && <button className="btn small ghost" onClick={markAllRead}>Mark all read</button>}
    </div>
    {notes.length === 0 && <div className="empty"><h3>Nothing yet</h3><p>Requests, bookings and updates will show up here.</p></div>}
    <ol className="nt-list">{notes.map((n) => (
      <li key={n.id}>
        <button className="nt-row" data-unread={!n.readAt} onClick={() => { markRead(n.id); if (n.link) nav(n.link); }}>
          <span className="nt-time">{ago(n.createdAt)}</span>
          <span className="nt-main"><b>{n.title}</b>{n.body && <span>{n.body}</span>}</span>
          <span className="nt-go" aria-hidden="true">{n.link ? 'Open →' : ''}</span>
        </button>
      </li>))}</ol>
  </div>;
}
