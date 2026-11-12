import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorText } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useSocial } from '../social.jsx';
import { Alert, Avatar, STATUS_LABEL } from '../components/UI.jsx';
import WhenPicker from '../components/WhenPicker.jsx';
import PaymentRequest from '../components/PaymentRequest.jsx';
import './chat.css';

// "📅 Title / When: … / Join: …/room/<code>" messages (sent by the schedule form) render as a card with a Join button
const meetingOf = (t) => { const m = /^📅 (.+)\r?\nWhen: (.+)\r?\nJoin: \S+\/room\/([a-z]{3}-[a-z]{4}-[a-z]{3})\s*$/u.exec(t || ''); return m && { title: m[1], when: m[2], code: m[3] }; };
const linkify = (t) => t.split(/(https?:\/\/\S+)/).map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : p));
const hm = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (d) => new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// "₹ Title / When: … / Price: … / Pay: …/sessions/<id>" messages (sent by the payment request) render as a card with a Pay & book button
const payReqOf = (t) => { const m = /^₹ (.+)\r?\nWhen: (.+)\r?\nPrice: (.+)\r?\nPay: \S+\/sessions\/(\d+)\s*$/u.exec(t || ''); return m && { title: m[1], when: m[2], price: m[3], sid: m[4] }; };
const preview = (m) => !m ? 'No messages yet' : m.deleted ? 'Message deleted' : (meetingOf(m.body) ? `📅 ${meetingOf(m.body).title}` : payReqOf(m.body) ? `₹ ${payReqOf(m.body).title}` : m.body) || (m.attachments.length ? '📎 Attachment' : '');

export default function Messages() {
  const { id } = useParams(); const nav = useNavigate();
  const { socket, refreshChatUnread } = useSocial();
  const [convs, setConvs] = useState(null); const [err, setErr] = useState(''); const [composing, setComposing] = useState(false);
  const load = useCallback(() => api('/conversations').then((r) => { setConvs(r.conversations); refreshChatUnread(); }).catch((x) => setErr(errorText(x))), [refreshChatUnread]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!socket) return;
    const on = (ev, fn) => { socket.on(ev, fn); return () => socket.off(ev, fn); };
    const offs = [on('message', load), on('conversations_changed', load), on('conversation_updated', load),
      on('presence', (p) => setConvs((l) => l && l.map((c) => (c.with?.username === p.username ? { ...c, with: { ...c.with, online: p.online, status: p.status ?? null } } : c))))];
    socket.on('connect', load);
    return () => { offs.forEach((f) => f()); socket.off('connect', load); };
  }, [socket, load]);

  return (
    <div className={`chat ${id ? 'has-thread' : ''}`}>
      <aside className="chat-list" aria-label="Conversations">
        <div className="row" style={{ justifyContent: 'space-between', padding: 12 }}><h2 style={{ margin: 0, fontSize: '1.4rem' }}>Chats</h2><button className="btn small accent" onClick={() => setComposing(true)}>New</button></div>
        <Alert>{err}</Alert>
        {!convs && <div className="skeleton" style={{ margin: 12, height: 80 }} />}
        {convs?.length === 0 && <div className="empty"><p>No conversations yet.</p><p className="hint">Connect with someone, then message them.</p></div>}
        {convs?.map((c) => (
          <Link key={c.id} to={`/messages/${c.id}`} className="conv" aria-current={String(c.id) === id ? 'true' : undefined}>
            <Avatar user={c.with || { fullName: c.title }} status={c.with ? c.with.status ?? null : undefined} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><b className="clip">{c.type === 'group' ? `👥 ${c.title}` : c.title}</b><span className="hint">{c.lastMessage && hm(c.lastMessage.createdAt)}</span></div>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><span className="clip hint">{preview(c.lastMessage)}</span>{c.unread > 0 && <span className="badge">{c.unread}</span>}</div>
            </div>
          </Link>))}
      </aside>
      <section className="chat-main">
        {id ? <Thread key={id} id={id} onGone={() => nav('/messages')} onChanged={load} /> : <div className="empty" style={{ margin: 'auto' }}><h3>Pick a conversation</h3><p>Or start a new one with a connection.</p></div>}
      </section>
      {composing && <NewChat onClose={() => setComposing(false)} onCreated={(cid) => { setComposing(false); load(); nav(`/messages/${cid}`); }} />}
    </div>
  );
}

function NewChat({ onClose, onCreated }) {
  const { conn } = useSocial(); const [mode, setMode] = useState('direct'); const [title, setTitle] = useState(''); const [picked, setPicked] = useState([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const people = conn.connected.map((c) => c.user);
  async function go(username) {
    setBusy(true); setErr('');
    try {
      const body = mode === 'direct' ? { type: 'direct', username } : { type: 'group', title, usernames: picked };
      onCreated((await api('/conversations', { method: 'POST', body })).id);
    } catch (x) { setErr(x.message === 'invalid_input' ? 'Add a group name and at least one person.' : errorText(x)); setBusy(false); }
  }
  return <div className="modal" role="dialog" aria-modal="true" aria-label="New chat"><div className="card stack mid">
    <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>New chat</h3><button className="btn small ghost" onClick={onClose}>Close</button></div>
    <div className="seg"><button aria-pressed={mode === 'direct'} onClick={() => setMode('direct')}>One-to-one</button><button aria-pressed={mode === 'group'} onClick={() => setMode('group')}>Group</button></div>
    <Alert>{err}</Alert>
    {mode === 'group' && <input aria-label="Group name" placeholder="Group name" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />}
    {people.length === 0 && <p className="muted">You can message people you're connected with. <Link to="/discover" onClick={onClose}>Find people</Link></p>}
    <div className="stack" style={{ maxHeight: 320, overflow: 'auto' }}>{people.map((u) => (
      <div key={u.username} className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row"><Avatar user={u} /><div><b>{u.fullName}</b><div className="hint">@{u.username}</div></div></div>
        {mode === 'direct' ? <button className="btn small" disabled={busy} onClick={() => go(u.username)}>Message</button>
          : <button className="chip" aria-pressed={picked.includes(u.username)} onClick={() => setPicked((p) => p.includes(u.username) ? p.filter((x) => x !== u.username) : [...p, u.username])}>{picked.includes(u.username) ? 'Added' : 'Add'}</button>}
      </div>))}</div>
    {mode === 'group' && <button className="btn accent" disabled={busy || !title.trim() || !picked.length} onClick={() => go()}>Create group ({picked.length})</button>}
  </div></div>;
}

const REACTIONS = ['👍', '❤️', '😂', '🎉', '🙏', '👀'];   // same list as the server

function Thread({ id, onGone, onChanged }) {
  const { user } = useAuth(); const { socket } = useSocial();
  const [info, setInfo] = useState(null); const [msgs, setMsgs] = useState([]); const [hasMore, setHasMore] = useState(false); const [err, setErr] = useState('');
  const [text, setText] = useState(''); const [files, setFiles] = useState([]); const [busy, setBusy] = useState(false); const [typers, setTypers] = useState({}); const [showInfo, setShowInfo] = useState(false);
  const [sched, setSched] = useState(null); const [payReq, setPayReq] = useState(false); const [edit, setEdit] = useState(null); const [pick, setPick] = useState(0); const [q, setQ] = useState(null); const [found, setFound] = useState(null);   // edit: {id, text}; pick: message with the emoji row open; q: null = search closed
  const bottom = useRef(); const box = useRef(); const lastTyping = useRef(0); const stick = useRef(true);

  const loadInfo = useCallback(() => api(`/conversations/${id}`).then(setInfo), [id]);
  const loadLatest = useCallback(() => api(`/conversations/${id}/messages`).then((r) => { setMsgs(r.messages); setHasMore(r.hasMore); }), [id]);
  useEffect(() => { Promise.all([loadInfo(), loadLatest()]).catch((x) => { if (x.status === 404) onGone(); else setErr(errorText(x)); }); }, [loadInfo, loadLatest]); // eslint-disable-line

  const markRead = useCallback((list) => { const last = list.at(-1); if (last && document.visibilityState === 'visible') api(`/conversations/${id}/read`, { method: 'POST', body: { messageId: last.id } }).then(onChanged).catch(() => {}); }, [id, onChanged]);
  useEffect(() => { if (msgs.length) markRead(msgs); }, [msgs.at(-1)?.id]); // eslint-disable-line
  const msgsRef = useRef(msgs); msgsRef.current = msgs;
  useEffect(() => { // coming back to the tab counts as reading what arrived meanwhile
    const back = () => { if (document.visibilityState === 'visible' && msgsRef.current.length) markRead(msgsRef.current); };
    document.addEventListener('visibilitychange', back); window.addEventListener('focus', back);
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); };
  }, [markRead]);

  useEffect(() => {
    if (!socket) return;
    const h = {
      message: (m) => { if (m.conversationId === Number(id)) setMsgs((l) => (l.some((x) => x.id === m.id) ? l : [...l, m])); },
      message_deleted: (d) => { if (d.conversationId === Number(id)) setMsgs((l) => l.map((m) => (m.id === d.id ? { ...m, deleted: true, body: null, attachments: [] } : m))); },
      message_updated: (m) => { if (m.conversationId !== Number(id)) return; const swap = (l) => l && l.map((x) => (x.id === m.id ? m : x)); setMsgs(swap); setFound(swap); },
      read: (r) => { if (r.conversationId === Number(id)) setInfo((i) => i && { ...i, members: i.members.map((m) => (m.username === r.username ? { ...m, lastReadMessageId: Math.max(m.lastReadMessageId || 0, r.messageId) } : m)) }); },
      typing: (t) => { if (t.conversationId !== Number(id)) return; setTypers((x) => ({ ...x, [t.username]: t.typing ? Date.now() : 0 })); },
      presence: (p) => setInfo((i) => i && { ...i, members: i.members.map((m) => (m.username === p.username ? { ...m, online: p.online, status: p.status ?? null } : m)) }),
      conversation_updated: (u) => { if (u.id === Number(id)) loadInfo(); },
      conversations_changed: () => loadInfo().catch(() => onGone()),
      connect: () => { loadLatest().catch(() => {}); loadInfo().catch(() => {}); }, // resync after a network drop
    };
    Object.entries(h).forEach(([e, f]) => socket.on(e, f));
    const t = setInterval(() => setTypers((x) => Object.fromEntries(Object.entries(x).filter(([, ts]) => ts && Date.now() - ts < 4000))), 1000);
    return () => { Object.entries(h).forEach(([e, f]) => socket.off(e, f)); clearInterval(t); };
  }, [socket, id, loadInfo, loadLatest, onGone]);

  useEffect(() => { if (stick.current) bottom.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, typers]);
  const onScroll = () => { const el = box.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };

  async function older() {
    const r = await api(`/conversations/${id}/messages?before=${msgs[0].id}`); stick.current = false;
    setMsgs((l) => [...r.messages, ...l]); setHasMore(r.hasMore);
  }
  function typing(v) {
    setText(v); if (!socket) return; const now = Date.now();
    if (now - lastTyping.current > 2000) { socket.emit('typing', { conversationId: Number(id), typing: true }); lastTyping.current = now; }
  }
  async function send(e) {
    e?.preventDefault(); if (busy || (!text.trim() && !files.length)) return; setBusy(true); setErr('');
    const form = new FormData(); form.append('body', text); files.forEach((f) => form.append('files', f));
    try {
      const m = await api(`/conversations/${id}/messages`, { method: 'POST', form });
      stick.current = true; setMsgs((l) => (l.some((x) => x.id === m.id) ? l : [...l, m])); setText(''); setFiles([]); lastTyping.current = 0;
      socket?.emit('typing', { conversationId: Number(id), typing: false }); onChanged();
    } catch (x) { setErr(x.message === 'cannot_message' ? "You can't message this person right now." : errorText(x)); } // text stays, so nothing is lost
    finally { setBusy(false); }
  }
  const fail = (x) => setErr(errorText(x));
  async function sendCard(body) { // posts a ready-made card message (payment request) and shows it straight away
    const form = new FormData(); form.append('body', body);
    const m = await api(`/conversations/${id}/messages`, { method: 'POST', form });
    stick.current = true; setMsgs((l) => (l.some((x) => x.id === m.id) ? l : [...l, m])); onChanged();
  }
  async function schedule(e) { // a room with a start time, then a normal chat message carrying the time and link
    e.preventDefault(); if (busy || !sched.when) return; setBusy(true); setErr('');
    try {
      const title = sched.title.trim() || 'Meeting', at = new Date(sched.when);
      const r = await api('/rooms', { method: 'POST', body: { title, waitingRoom: false, startsAt: at.toISOString() } });
      const form = new FormData(); form.append('body', `📅 ${title}\nWhen: ${at.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}\nJoin: ${r.link}`);
      const m = await api(`/conversations/${id}/messages`, { method: 'POST', form });
      stick.current = true; setMsgs((l) => (l.some((x) => x.id === m.id) ? l : [...l, m])); setSched(null); onChanged();
    } catch (x) { setErr(x.message === 'cannot_message' ? "You can't message this person right now." : errorText(x)); } finally { setBusy(false); }
  }
  const saveEdit = (e) => { e.preventDefault(); if (!edit.text.trim()) return; api(`/conversations/${id}/messages/${edit.id}`, { method: 'PATCH', body: { body: edit.text } }).then(() => setEdit(null)).catch(fail); };
  const react = (m, emoji) => { setPick(0); api(`/conversations/${id}/messages/${m.id}/reactions`, { method: 'POST', body: { emoji } }).catch(fail); };
  const search = (e) => { e.preventDefault(); if (!q.trim()) return setFound(null); api(`/conversations/${id}/messages?limit=100&q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.messages)).catch(fail); };
  const del = (m) => api(`/conversations/${id}/messages/${m.id}`, { method: 'DELETE' }).catch((x) => setErr(errorText(x)));

  if (!info) return <div style={{ padding: 16 }}><Alert>{err}</Alert>{!err && <div className="skeleton" />}</div>;
  const others = info.members.filter((m) => m.username !== user.username);
  const direct = info.type === 'direct' ? others[0] : null;
  const lastMine = [...msgs].reverse().find((m) => m.sender?.username === user.username && m.kind === 'text' && !m.deleted);
  const seenBy = lastMine ? others.filter((m) => (m.lastReadMessageId || 0) >= lastMine.id) : [];
  const typingNames = Object.keys(typers).filter((u) => typers[u] && u !== user.username);
  let prevDay = '';
  return (
    <div className="thread">
      <header className="thread-head row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <Link to="/messages" className="btn small ghost back" aria-label="Back to chats">←</Link>
          <Avatar user={direct || { fullName: info.title }} />
          <div><b>{info.type === 'group' ? info.title : <Link to={`/u/${direct?.username}`}>{info.title}</Link>}</b>
            <div className="hint">{direct ? (direct.status ? <span className={`st-${direct.status}`}>● {STATUS_LABEL[direct.status]}</span> : 'Offline') : `${info.members.length} members`}</div></div>
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <button className="btn small ghost icon-btn" aria-label="Search this chat" title="Search this chat" aria-pressed={q !== null} onClick={() => { setQ(q === null ? '' : null); setFound(null); }}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M16 16l4.5 4.5" /></svg></button>
          {info.type === 'group' && <button className="btn small ghost" onClick={() => setShowInfo(!showInfo)}>Members</button>}
        </div>
      </header>
      {q !== null && <form className="panel row" style={{ flexWrap: 'nowrap' }} onSubmit={search}>
        <input autoFocus type="search" aria-label="Search this chat" placeholder="Search this chat…" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button className="btn small">Find</button>
      </form>}
      {showInfo && <GroupPanel info={info} me={user.username} reload={() => { loadInfo(); onChanged(); }} onLeft={onGone} />}
      <div className="msgs" ref={box} onScroll={onScroll} role="log" aria-live="polite">
        {found && <div className="hint" style={{ alignSelf: 'center' }}>{found.length ? `${found.length}${found.length === 100 ? '+' : ''} matching message${found.length === 1 ? '' : 's'}` : 'Nothing found.'}</div>}
        {!found && hasMore && <button className="btn small ghost" style={{ alignSelf: 'center' }} onClick={older}>Load earlier messages</button>}
        {!found && msgs.length === 0 && <div className="empty">Say hello 👋</div>}
        {(found || msgs).map((m) => {
          const d = day(m.createdAt), sep = d !== prevDay ? <div className="daysep">{d}</div> : null; prevDay = d;
          if (m.kind === 'system') return <div key={m.id}>{sep}<div className="sys">{m.body}</div></div>;
          const mine = m.sender?.username === user.username;
          return <div key={m.id}>{sep}<div className={`msg ${mine ? 'mine' : ''}`}>
            {!mine && info.type === 'group' && <div className="hint"><b>{m.sender?.fullName}</b></div>}
            <div className="bubble">
              {m.deleted ? <i className="muted">Message deleted</i> : <>
                {edit?.id === m.id
                  ? <form className="stack" onSubmit={saveEdit}><textarea autoFocus aria-label="Edit message" rows={2} maxLength={4000} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setEdit(null)} />
                    <div className="row"><button className="btn small accent" disabled={!edit.text.trim()}>Save</button><button type="button" className="btn small ghost" onClick={() => setEdit(null)}>Cancel</button></div></form>
                  : m.body && (payReqOf(m.body) ? (({ title, when, price, sid }) => <div className="meet-card pay-card"><span className="mk">Payment request</span><b>{title}</b><span className="mw">{when}</span><span className="mw">{mine ? price.replace(/ \+ fees$/, '') : price}</span><Link className="btn small" to={`/sessions/${sid}`}>{mine ? 'View session' : 'Pay & book'}</Link></div>)(payReqOf(m.body)) : meetingOf(m.body) ? (({ title, when, code }) => <div className="meet-card"><span className="mk">Meeting</span><b>{title}</b><span className="mw">{when}</span><Link className="btn small" to={`/room/${code}`}>Join meeting</Link></div>)(meetingOf(m.body)) : <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{linkify(m.body)}</div>)}
                {m.attachments.map((a) => a.mime.startsWith('image/')
                  ? <a key={a.id} href={a.url} target="_blank" rel="noreferrer"><img className="att-img" src={a.url} alt={a.name} loading="lazy" /></a>
                  : <a key={a.id} className="att" href={a.url} download>📎 {a.name} <span className="hint">{size(a.size)}</span></a>)}</>}
              <div className="hint">{hm(m.createdAt)}{m.edited && ' · edited'}
                {!m.deleted && <button className="linkbtn" aria-expanded={pick === m.id} onClick={() => setPick(pick === m.id ? 0 : m.id)}>React</button>}
                {mine && !m.deleted && <><button className="linkbtn" onClick={() => setEdit({ id: m.id, text: m.body || '' })}>Edit</button><button className="linkbtn" onClick={() => window.confirm('Delete this message for everyone?') && del(m)}>Delete</button></>}</div>
            </div>
            {(pick === m.id || m.reactions?.length > 0) && <div className="rxs">
              {pick === m.id ? REACTIONS.map((e) => <button key={e} className="rx" aria-label={`React ${e}`} onClick={() => react(m, e)}>{e}</button>)
                : m.reactions.map((r) => <button key={r.emoji} className="rx" aria-pressed={r.users.includes(user.username)} title={r.users.join(', ')} onClick={() => react(m, r.emoji)}>{r.emoji} {r.users.length}</button>)}
            </div>}</div>
            {m.id === lastMine?.id && <div className="hint seen" style={{ textAlign: 'right' }}>{seenBy.length ? (direct ? 'Seen' : `Seen by ${seenBy.length}`) : 'Sent'}</div>}
          </div>;
        })}
        {typingNames.length > 0 && <div className="hint typing">{typingNames.join(', ')} {typingNames.length > 1 ? 'are' : 'is'} typing…</div>}
        <div ref={bottom} />
      </div>
      <Alert>{err}</Alert>
      {payReq && direct && <PaymentRequest to={direct.username} onSend={sendCard} onClose={() => setPayReq(false)} />}
      {sched && <form className="panel stack" onSubmit={schedule}><b>Schedule a meeting</b>
        <label className="field" style={{ margin: 0 }}>Title<input placeholder="e.g. Guitar basics (optional)" maxLength={120} value={sched.title} onChange={(e) => setSched({ ...sched, title: e.target.value })} /></label>
        <label className="field" style={{ margin: 0 }}>Date and time
          <WhenPicker value={sched.when} onChange={(when) => setSched({ ...sched, when })} /></label>
        <div className="row"><button className="btn small accent" disabled={busy || !sched.when}>Schedule and share</button><button type="button" className="btn small ghost" onClick={() => setSched(null)}>Cancel</button></div></form>}
      <form className="composer" onSubmit={send}>
        {files.length > 0 && <div className="row">{files.map((f, i) => <span key={i} className="chip static">{f.name} <button type="button" className="linkbtn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button></span>)}</div>}
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-end' }}>
          {direct && <button type="button" className="btn small ghost icon-btn rupee-btn" aria-label="Request a payment" title="Request a payment" aria-pressed={payReq} onClick={() => { setPayReq(!payReq); setSched(null); }}>₹</button>}
          <button type="button" className="btn small ghost icon-btn" aria-label="Schedule a meeting" title="Schedule a meeting" aria-pressed={!!sched} onClick={() => setSched(sched ? null : { title: '', when: '' })}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg></button>
          <label className="btn small ghost icon-btn" style={{ margin: 0 }} aria-label="Attach files" title="Attach files"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" /></svg><input type="file" multiple hidden onChange={(e) => setFiles([...files, ...e.target.files].slice(0, 5))} /></label>
          <textarea aria-label="Message" rows={1} maxLength={4000} placeholder="Message…" value={text} onChange={(e) => typing(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn small accent" disabled={busy || (!text.trim() && !files.length)}>{busy ? '…' : 'Send'}</button>
        </div>
      </form>
    </div>
  );
}

function GroupPanel({ info, me, reload, onLeft }) {
  const { conn } = useSocial(); const [err, setErr] = useState(''); const [title, setTitle] = useState(info.title);
  const admin = info.myRole === 'admin'; const inGroup = new Set(info.members.map((m) => m.username));
  const addable = conn.connected.map((c) => c.user).filter((u) => !inGroup.has(u.username));
  const run = async (fn) => { setErr(''); try { await fn(); reload(); } catch (x) { setErr(errorText(x)); } };
  return <div className="panel stack">
    <Alert>{err}</Alert>
    {admin && <div className="row"><input aria-label="Group name" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} /><button className="btn small" disabled={!title.trim() || title === info.title} onClick={() => run(() => api(`/conversations/${info.id}`, { method: 'PATCH', body: { title } }))}>Rename</button></div>}
    {info.members.map((m) => <div key={m.username} className="row" style={{ justifyContent: 'space-between' }}>
      <div className="row"><Avatar user={m} status={m.status ?? null} /><span><b>{m.fullName}</b> {m.role === 'admin' && <span className="tag mentor">admin</span>}</span></div>
      {admin && m.username !== me && <button className="btn small ghost" onClick={() => window.confirm(`Remove ${m.fullName}?`) && run(() => api(`/conversations/${info.id}/members/${m.username}`, { method: 'DELETE' }))}>Remove</button>}
    </div>)}
    {admin && addable.length > 0 && <div><div className="tag muted">Add from your connections</div><div className="row">{addable.map((u) => <button key={u.username} className="chip" onClick={() => run(() => api(`/conversations/${info.id}/members`, { method: 'POST', body: { usernames: [u.username] } }))}>+ {u.fullName}</button>)}</div></div>}
    <div><button className="btn small ghost" onClick={() => window.confirm('Leave this group?') && api(`/conversations/${info.id}/members/${me}`, { method: 'DELETE' }).then(onLeft).catch((x) => setErr(errorText(x)))}>Leave group</button></div>
  </div>;
}
