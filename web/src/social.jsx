import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { api, errorText } from './api.js';
import { useAuth } from './auth.jsx';

const Ctx = createContext(null);
export const useSocial = () => useContext(Ctx);

/** Connections + notifications state, kept live through one socket per logged-in user. */
export function SocialProvider({ children }) {
  const { user } = useAuth();
  const [conn, setConn] = useState({ received: [], sent: [], connected: [] });
  const [socket, setSocket] = useState(null); const [chatUnread, setChatUnread] = useState(0);
  const [notes, setNotes] = useState([]); const [unread, setUnread] = useState(0); const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  const refreshConnections = useCallback(() => api('/connections').then(setConn).catch(() => {}), []);
  const refreshChatUnread = useCallback(() => api('/conversations').then((r) => setChatUnread(r.unread)).catch(() => {}), []);
  const refreshNotes = useCallback(() => api('/notifications').then((r) => { setNotes(r.notifications); setUnread(r.unread); }).catch(() => {}), []);

  useEffect(() => {
    if (!user) { setConn({ received: [], sent: [], connected: [] }); setNotes([]); setUnread(0); return; }
    refreshConnections(); refreshNotes(); refreshChatUnread();
    // Live push runs on the API host (a long-lived process). Website and API are different origins in production, where the
    // login cookie is not sent to the socket, so it logs in with a short-lived signed token (fetched again on every reconnect).
    // VITE_REALTIME_URL is the API origin. Without it in production we skip the socket and the app works without instant updates.
    const rt = import.meta.env.VITE_REALTIME_URL;
    if (import.meta.env.PROD && !rt) return;
    const socket = io(rt || undefined, rt
      ? { auth: (cb) => api('/auth/socket-token').then((r) => cb({ token: r.token })).catch(() => cb({})) }
      : { withCredentials: true });
    setSocket(socket);
    socket.on('message', (m) => { if (m.sender.username !== user.username) refreshChatUnread(); });
    socket.on('read', (r) => { if (r.username === user.username) refreshChatUnread(); });
    socket.on('conversations_changed', refreshChatUnread);
    socket.on('notification', (n) => {
      setNotes((l) => [n, ...l]); setUnread((c) => c + 1);
      if (n.type.startsWith('connection_')) refreshConnections();
      setToast(n); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 5000);
    });
    socket.on('connect', () => { refreshNotes(); refreshConnections(); refreshChatUnread(); }); // catch up after a dropped connection
    return () => { socket.close(); setSocket(null); };
  }, [user?.id]); // eslint-disable-line

  const markRead = (id) => {
    if (!notes.some((n) => n.id === id && !n.readAt)) return;
    setNotes((l) => l.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnread((c) => Math.max(0, c - 1)); // outside the updater: updaters may run twice in StrictMode
    api(`/notifications/${id}/read`, { method: 'POST', body: {} }).catch(() => {});
  };
  const markAllRead = async () => { await api('/notifications/read-all', { method: 'POST', body: {} }); setNotes((l) => l.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))); setUnread(0); };
  const statusOf = (username) => {
    for (const k of ['connected', 'sent', 'received']) { const c = conn[k].find((x) => x.user.username === username); if (c) return { status: { connected: 'connected', sent: 'pending_sent', received: 'pending_received' }[k], id: c.id }; }
    return { status: 'none' };
  };
  return <Ctx.Provider value={{ socket, chatUnread, refreshChatUnread, conn, notes, unread, statusOf, refreshConnections, markRead, markAllRead }}>
    {children}
    <div aria-live="polite" className="toast-region">{toast && <div className="toast">{toast.title}</div>}</div>
  </Ctx.Provider>;
}

export function ConnectButton({ username, status: forced, onChange }) {
  const { statusOf, refreshConnections } = useSocial();
  const cur = forced ? { status: forced.status, id: forced.id } : statusOf(username);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); await refreshConnections(); onChange?.(); } catch (x) { setErr(errorText(x)); } finally { setBusy(false); } };
  const connect = () => run(() => api('/connections', { method: 'POST', body: { username } }));
  const act = (path, method = 'POST') => run(() => api(path, { method, body: method === 'POST' ? {} : undefined }));
  const MSG = { previously_declined: "They declined earlier, so you can't send another request.", already_requested: 'Request already sent.', too_many_pending_requests: 'Too many pending requests. Wait for replies first.' };
  const e = err && <div className="hint err" role="alert">{MSG[err] || err}</div>;
  let btn;
  if (cur.status === 'connected') btn = <span className="row"><span className="chip static mentor" style={{ background: 'var(--learner-soft)' }}>✓ Connected</span><MessageButton username={username} /></span>;
  else if (cur.status === 'pending_sent') btn = <button className="btn small ghost" disabled={busy} onClick={() => act(`/connections/${cur.id}`, 'DELETE')}>Requested · Cancel</button>;
  else if (cur.status === 'pending_received') btn = <span className="row"><button className="btn small accent" disabled={busy} onClick={() => act(`/connections/${cur.id}/accept`)}>Accept</button><button className="btn small ghost" disabled={busy} onClick={() => act(`/connections/${cur.id}/reject`)}>Decline</button></span>;
  else if (cur.status === 'self' || cur.status === 'unavailable') return null;
  else btn = <button className="btn small accent" disabled={busy} onClick={connect}>{busy ? 'Sending…' : 'Connect'}</button>;
  return <div>{btn}{e}</div>;
}

export function MessageButton({ username }) {
  const nav = useNavigate(); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { const r = await api('/conversations', { method: 'POST', body: { type: 'direct', username } }); nav(`/messages/${r.id}`); } catch { setBusy(false); } };
  return <button className="btn small" disabled={busy} onClick={go}>Message</button>;
}
