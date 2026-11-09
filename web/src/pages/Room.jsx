import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Room as LkRoom, RoomEvent, Track, DisconnectReason } from 'livekit-client';
import { api, errorText } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useSocial } from '../social.jsx';
import { Alert } from '../components/UI.jsx';

const ERR = { not_open_yet: 'This room opens 15 minutes before the session starts.', not_allowed: "You don't have access to this room. Paid sessions need a confirmed booking.", meeting_ended: 'This meeting has ended.',
  meetings_not_configured: 'Video meetings are not set up on this server yet.', not_found: 'No meeting with that code.' };
const msgOf = (x) => ERR[x.message] || errorText(x);
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));

function Tile({ p, big, hand }) {
  const vid = useRef(); const pub = p.getTrackPublication(Track.Source.ScreenShare) || p.getTrackPublication(Track.Source.Camera);
  const track = pub?.track; const mic = p.getTrackPublication(Track.Source.Microphone);
  useEffect(() => { const el = vid.current; if (track && el) { track.attach(el); return () => { track.detach(el); }; } }, [track]);
  return <div className={`tile ${p.isSpeaking ? 'speaking' : ''} ${big ? 'big' : ''}`}>
    {track && !pub.isMuted ? <video ref={vid} autoPlay playsInline muted={p.isLocal} className={pub.source === Track.Source.ScreenShare ? 'contain' : ''} /> : <div className="noviz">{(p.name || p.identity)[0]}</div>}
    <div className="tag-line">{hand && '✋ '}{p.name || p.identity}{p.isLocal ? ' (you)' : ''}{mic?.isMuted !== false && ' 🔇'}</div>
  </div>;
}

export default function Room() {
  const { code } = useParams(); const nav = useNavigate(); const { user } = useAuth(); const { socket } = useSocial();
  const [info, setInfo] = useState(null); const [phase, setPhase] = useState('lobby'); const [err, setErr] = useState(''); const [pre, setPre] = useState({ mic: true, cam: true });
  const roomRef = useRef(null); const audioBox = useRef(); const [, tick] = useState(0); const rerender = () => tick((n) => n + 1);
  const [chat, setChat] = useState([]); const [text, setText] = useState(''); const [hands, setHands] = useState({}); const [panel, setPanel] = useState(null);
  const [waiters, setWaiters] = useState([]); const [banner, setBanner] = useState(''); const [devs, setDevs] = useState({ audioinput: [], videoinput: [], audiooutput: [] }); const [myRole, setMyRole] = useState(null);
  const connecting = useRef(false); const staff = myRole === 'host' || myRole === 'cohost';

  useEffect(() => { api(`/rooms/${code}`).then((i) => { setInfo(i); setMyRole(i.myRole); if (i.status === 'ended') setPhase('ended'); }).catch((x) => { setErr(msgOf(x)); setPhase('error'); }); }, [code]);

  const connect = useCallback(async (j) => {
    if (connecting.current) return; connecting.current = true;
    const room = new LkRoom({ adaptiveStream: true, dynacast: true }); roomRef.current = room;
    const upd = () => rerender();
    [RoomEvent.ParticipantConnected, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished].forEach((e) => room.on(e, upd));
    room.on(RoomEvent.ParticipantDisconnected, (p) => { setHands((h) => { const n = { ...h }; delete n[p.identity]; return n; }); rerender(); });
    room.on(RoomEvent.TrackSubscribed, (t) => { if (t.kind === 'audio') audioBox.current?.appendChild(t.attach()); rerender(); });
    room.on(RoomEvent.TrackUnsubscribed, (t) => { t.detach().forEach((el) => el.remove()); rerender(); });
    room.on(RoomEvent.DataReceived, (payload, p, _k, topic) => {
      let m; try { m = JSON.parse(new TextDecoder().decode(payload)); } catch { return; } const from = p?.identity; if (!from) return;
      if (topic === 'chat' && typeof m.text === 'string') setChat((c) => [...c, { from: p.name || from, text: m.text.slice(0, 2000), at: Date.now() }]);
      if (topic === 'hand') setHands((h) => ({ ...h, [from]: !!m.on }));
    });
    room.on(RoomEvent.Reconnecting, () => setBanner('Connection lost. Trying to reconnect…'));
    room.on(RoomEvent.Reconnected, () => setBanner(''));
    room.on(RoomEvent.MediaDevicesError, () => setErr('Camera or microphone is blocked. Allow access in your browser, then toggle it on again.'));
    room.on(RoomEvent.Disconnected, (reason) => { setBanner(''); connecting.current = false; setPhase(reason === DisconnectReason.PARTICIPANT_REMOVED ? 'removed' : reason === DisconnectReason.ROOM_DELETED ? 'ended' : 'dropped'); });
    try {
      await room.connect(j.url, j.token);
      await room.localParticipant.setMicrophoneEnabled(pre.mic).catch(() => setErr('Microphone is blocked or unavailable.'));
      await room.localParticipant.setCameraEnabled(pre.cam).catch(() => setErr('Camera is blocked or unavailable.'));
      setMyRole(j.role); setPhase('in'); rerender();
      const list = async (k) => { try { return (await LkRoom.getLocalDevices(k)).map((d) => ({ id: d.deviceId, label: d.label || k })); } catch { return []; } };
      setDevs({ audioinput: await list('audioinput'), videoinput: await list('videoinput'), audiooutput: await list('audiooutput') });
    } catch (x) { connecting.current = false; setErr('Could not connect to the meeting. Check your network and try again.'); setPhase('lobby'); }
  }, [pre]);

  const join = useCallback(async () => {
    setErr('');
    try { const j = await api(`/rooms/${code}/join`, { method: 'POST', body: {} }); if (j.status === 'waiting') setPhase('waiting'); else await connect(j); }
    catch (x) { setErr(msgOf(x)); if (x.message === 'meeting_ended') setPhase('ended'); }
  }, [code, connect]);

  // waiting room: wake on the server's push, with a slow poll as a safety net
  useEffect(() => {
    if (phase !== 'waiting') return;
    const go = () => join(); const t = setInterval(go, 5000);
    const denied = (d) => d.code === code && (setPhase('denied'));
    socket?.on('room_admitted', go); socket?.on('room_denied', denied);
    return () => { clearInterval(t); socket?.off('room_admitted', go); socket?.off('room_denied', denied); };
  }, [phase, socket, code, join]);

  // staff: see who is waiting
  const loadWaiters = useCallback(() => api(`/rooms/${code}/waiting`).then((r) => setWaiters(r.waiting)).catch(() => {}), [code]);
  useEffect(() => {
    if (phase !== 'in' || !staff) return; loadWaiters();
    socket?.on('room_waiting', loadWaiters); const t = setInterval(loadWaiters, 8000);
    return () => { socket?.off('room_waiting', loadWaiters); clearInterval(t); };
  }, [phase, staff, socket, loadWaiters]);
  useEffect(() => { const f = (r) => r.code === code && setMyRole(r.role); socket?.on('room_role', f); return () => socket?.off('room_role', f); }, [socket, code]);
  useEffect(() => () => { roomRef.current?.disconnect(); }, []);

  const room = roomRef.current, lp = room?.localParticipant;
  const act = (path, body) => api(`/rooms/${code}/${path}`, { method: 'POST', body: body || {} }).catch((x) => setErr(msgOf(x)));
  const toggle = async (what) => { try { if (what === 'mic') await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled); if (what === 'cam') await lp.setCameraEnabled(!lp.isCameraEnabled); if (what === 'screen') await lp.setScreenShareEnabled(!lp.isScreenShareEnabled); } catch { setErr(what === 'screen' ? 'Screen sharing was cancelled or is not allowed.' : 'Could not access that device.'); } rerender(); };
  const raise = () => { const on = !hands[user.username]; setHands((h) => ({ ...h, [user.username]: on })); lp.publishData(enc({ on }), { reliable: true, topic: 'hand' }); };
  const send = (e) => { e.preventDefault(); const t = text.trim(); if (!t) return; lp.publishData(enc({ text: t }), { reliable: true, topic: 'chat' }); setChat((c) => [...c, { from: 'You', text: t, at: Date.now(), me: true }]); setText(''); };
  const leave = async () => { roomRef.current?.disconnect(); await act('leave'); nav('/meetings'); };
  const endAll = async () => { if (window.confirm('End the meeting for everyone?')) { await act('end'); roomRef.current?.disconnect(); nav('/meetings'); } };
  const swap = (kind, id) => room.switchActiveDevice(kind, id).catch(() => setErr('Could not switch to that device.'));

  if (phase === 'error' || phase === 'ended' || phase === 'denied' || phase === 'removed') return <div className="center"><div className="card narrow stack"><h2>{{ error: 'Cannot open this room', ended: 'Meeting ended', denied: 'Not admitted', removed: 'You were removed' }[phase]}</h2><p>{err || { ended: 'Thanks for joining.', denied: 'The host did not admit you.', removed: 'The host removed you from this meeting.' }[phase]}</p><button className="btn" onClick={() => nav('/meetings')}>Back to meetings</button></div></div>;
  if (phase === 'lobby' || phase === 'waiting' || phase === 'dropped') return <div className="center"><div className="card narrow stack">
    <h2>{info?.title || 'Meeting'}</h2><p className="muted">Hosted by {info?.host.fullName} · <code>{code}</code></p><Alert>{err}</Alert>
    {phase === 'dropped' && <Alert>You were disconnected from the meeting.</Alert>}
    {phase === 'waiting' ? <><p><b>Waiting for the host to let you in…</b></p><p className="hint">You'll join automatically.</p><button className="btn ghost" onClick={() => nav('/meetings')}>Cancel</button></> : <>
      <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={pre.mic} onChange={(e) => setPre({ ...pre, mic: e.target.checked })} /> Microphone on</label>
      <label className="row" style={{ fontWeight: 400 }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={pre.cam} onChange={(e) => setPre({ ...pre, cam: e.target.checked })} /> Camera on</label>
      <button className="btn accent" onClick={join}>{phase === 'dropped' ? 'Rejoin' : 'Join meeting'}</button></>}
  </div></div>;

  // ---- in the meeting ----
  const all = room ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  const sharer = all.find((p) => p.getTrackPublication(Track.Source.ScreenShare)?.track);
  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;   // phone browsers cannot share a screen
  return <div className="meet">
    <div ref={audioBox} hidden />
    {banner && <div className="alert err" role="status" style={{ margin: 8 }}>{banner}</div>}{err && <div className="alert err" role="alert" style={{ margin: 8 }}>{err} <button className="linkbtn" onClick={() => setErr('')}>Dismiss</button></div>}
    <div className="stage-wrap">
      <div className={`stage ${sharer ? 'with-share' : ''}`}>
        {sharer && <Tile p={sharer} big />}
        <div className="strip">{all.map((p) => <Tile key={p.identity} p={p} hand={hands[p.identity]} />)}</div>
      </div>
      {panel && <aside className="side" aria-label={panel === 'chat' ? 'Chat' : 'Participants'}>
        {panel === 'chat' ? <>
          <div className="msgs-lite" role="log">{chat.length === 0 && <p className="hint">Chat is visible to everyone in the meeting and is not saved.</p>}{chat.map((m, i) => <div key={i} className={m.me ? 'me' : ''}><b>{m.from}</b> <span style={{ overflowWrap: 'anywhere' }}>{m.text}</span></div>)}</div>
          <form onSubmit={send} className="row" style={{ flexWrap: 'nowrap', padding: 8 }}><input aria-label="Chat message" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message everyone" /><button className="btn small">Send</button></form></>
        : <div className="stack" style={{ padding: 12 }}>
          {staff && waiters.length > 0 && <div><div className="tag mentor">Waiting to join</div>{waiters.map((w) => <div key={w.username} className="row" style={{ justifyContent: 'space-between' }}><span>{w.fullName}</span><span className="row"><button className="btn small accent" onClick={async () => { await act('admit', { username: w.username }); loadWaiters(); }}>Admit</button><button className="btn small ghost" onClick={async () => { await act('deny', { username: w.username }); loadWaiters(); }}>Deny</button></span></div>)}</div>}
          <div className="tag muted">In the meeting ({all.length})</div>
          {all.map((p) => <div key={p.identity} className="row" style={{ justifyContent: 'space-between' }}><span>{hands[p.identity] && '✋ '}{p.name || p.identity}{p.isLocal && ' (you)'}</span>
            {staff && !p.isLocal && <span className="row"><button className="btn small ghost" onClick={() => act('mute', { username: p.identity })}>Mute</button>{myRole === 'host' && <button className="btn small ghost" onClick={() => act('cohost', { username: p.identity, cohost: true })}>Co-host</button>}<button className="btn small ghost" onClick={() => window.confirm(`Remove ${p.name || p.identity}?`) && act('remove', { username: p.identity })}>Remove</button></span>}</div>)}
          {staff && <button className="btn small ghost" onClick={() => act('mute')}>Mute everyone</button>}
          <details><summary>Devices</summary>{[['audioinput', 'Microphone'], ['videoinput', 'Camera'], ['audiooutput', 'Speaker']].map(([k, l]) => devs[k].length > 0 && <div key={k} className="field"><label>{l}</label><select onChange={(e) => swap(k, e.target.value)} defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...devs[k].map((d) => <option key={d.id} value={d.id}>{d.label}</option>)]}</select></div>)}</details>
          <p className="hint">Invite link: {location.origin}/room/{code}</p>
        </div>}
      </aside>}
    </div>
    <div className="controls" role="toolbar" aria-label="Meeting controls">
      <button className="ctl" aria-label={lp?.isMicrophoneEnabled ? 'Mute' : 'Unmute'} aria-pressed={!!lp?.isMicrophoneEnabled} onClick={() => toggle('mic')}><span aria-hidden="true">{lp?.isMicrophoneEnabled ? '🎤' : '🔇'}</span><span className="lbl"> {lp?.isMicrophoneEnabled ? 'Mute' : 'Unmute'}</span></button>
      <button className="ctl" aria-label={lp?.isCameraEnabled ? 'Stop video' : 'Start video'} aria-pressed={!!lp?.isCameraEnabled} onClick={() => toggle('cam')}><span aria-hidden="true">{lp?.isCameraEnabled ? '📷' : '🚫'}</span><span className="lbl"> {lp?.isCameraEnabled ? 'Stop video' : 'Start video'}</span></button>
      {canShare && <button className="ctl" aria-label={lp?.isScreenShareEnabled ? 'Stop sharing' : 'Share screen'} aria-pressed={!!lp?.isScreenShareEnabled} onClick={() => toggle('screen')}><span aria-hidden="true">🖥</span><span className="lbl"> {lp?.isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}</span></button>}
      <button className="ctl" aria-label={hands[user.username] ? 'Lower hand' : 'Raise hand'} aria-pressed={!!hands[user.username]} onClick={raise}><span aria-hidden="true">✋</span><span className="lbl"> {hands[user.username] ? 'Lower hand' : 'Raise hand'}</span></button>
      <button className="ctl" aria-label="Chat" aria-pressed={panel === 'chat'} onClick={() => setPanel(panel === 'chat' ? null : 'chat')}><span aria-hidden="true">💬</span><span className="lbl"> Chat</span></button>
      <button className="ctl" aria-label="People" aria-pressed={panel === 'people'} onClick={() => setPanel(panel === 'people' ? null : 'people')}><span aria-hidden="true">👥</span><span className="lbl"> People</span>{staff && waiters.length > 0 ? ` (${waiters.length})` : ''}</button>
      <button className="ctl danger" onClick={leave}>Leave</button>{myRole === 'host' && <button className="ctl danger" onClick={endAll}>End<span className="lbl"> for all</span></button>}
    </div>
  </div>;
}
