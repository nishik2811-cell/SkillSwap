import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useSkills } from '../lib.js';
import { useTheme } from '../theme.js';
import VinylRecord from '../components/VinylRecord.jsx';
import Gate from '../components/Gate.jsx';
import DragChip from '../components/DragChip.jsx';
import AboutRecord from '../components/AboutRecord.jsx';
import { sound, useSound } from '../sound.js';
import './landing-extra.css';
import './landing.css';

const clock = () => { const d = new Date(), o = -d.getTimezoneOffset() / 60; return `${d.toTimeString().slice(0, 5)} GMT${o >= 0 ? '+' : '-'}${Math.abs(o)}`; };
const TRACKS = [
  ['01', 'Tell us two things', 'What you can share, and what you want to learn. Free, paid, or a straight swap. You are always both a Mentor and a Learner.', 'Setup'],
  ['02', 'Get ranked matches', 'Every person gets a compatibility score from skills, level, budget, time zone and language, with the reasons shown.', 'Match'],
  ['03', 'Meet in a room', 'Message, book a session, then join a built-in video room with screen sharing. No links to paste.', 'Meet'],
];

export default function Landing() {
  const { user, logout } = useAuth();
  const skills = useSkills();
  const [theme, toggleTheme] = useTheme();
  const [side, setSide] = useState('A');
  const [time, setTime] = useState(clock);
  const [scratch, setScratch] = useState(false);
  const track = useRef(), mag = useRef();
  const soundOn = useSound();
  const onScratch = useCallback((v) => { setScratch(v); sound.scratch(v); }, []);
  useEffect(() => { const t = setInterval(() => setTime(clock()), 20000); return () => clearInterval(t); }, []);

  // Scroll drives one CSS variable (--p, 0 to 1) for the zoom. No React state, one rAF per scroll frame.
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { track.current.classList.add('nozoom'); return; }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = track.current.getBoundingClientRect(), span = r.height - innerHeight;
      const p = Math.max(0, Math.min(1, span > 0 ? -r.top / span : 0));
      track.current.style.setProperty('--p', p.toFixed(4));
      track.current.classList.toggle('zoomed', p > 0.1);
      if (mag.current) { const m = Math.exp(p * Math.log(278)); mag.current.textContent = `×${m < 10 ? m.toFixed(1) : Math.round(m)}`; } // exponential, like a real macro lens: ×1 to ×278
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    update(); addEventListener('scroll', on, { passive: true }); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const half = Math.ceil((skills?.length || 0) / 2);
  const href = (s) => (user ? `/discover?skillId=${s.id}` : '/register');
  return (
    <div className="moa-root" data-theme={theme}>
      <Gate /><DragChip />
      <div className="zoom-track" ref={track}>
        <div className="zoom-bar" aria-hidden="true" />
        <div className="moa">
          <header className="moa-head">
            <Link to="/" className="moa-logo">SKILLSWAP<sup>©26</sup></Link>
            <nav className="moa-mono" aria-label="Main">
              {user ? <><Link to="/discover" className="hide-s">Discover</Link><Link to="/dashboard">Dashboard</Link><button onClick={logout} className="hide-s">Log out</button></>
                : <><Link to="/login" className="hide-s">Log in</Link><Link to="/register">Join</Link></>}
              <span className="hide-s">{time}</span>
              <button className="pill" onClick={() => sound.toggle()} aria-pressed={soundOn}>Sound <i /></button>
              <button className="pill" onClick={toggleTheme} aria-pressed={theme === 'light'}>Theme <i /></button>
            </nav>
          </header>

          <div className="moa-row moa-mono fade"><span>Side {side}</span><span className="hide-s">Scroll to dive into the groove</span><span>Est. 2026</span></div>

          <VinylRecord skills={skills} side={side} onScratch={onScratch} />
          <div className="vinyl-close" aria-hidden="true"><div className="close-label"><span>SkillSwap · Side {side}</span></div></div>

          <div className="macro" aria-hidden="true"><div className="macro-groove" /><span className="macro-tag">Stylus-eye view</span></div>
          <div className="readout moa-mono" aria-hidden="true"><span>Magnification</span><b ref={mag}>×1.0</b><span>Groove pitch = 0.1 mm</span></div>

          <div className="moa-copy fade">
            <h1>Teach one thing.<br />Learn another.</h1>
            <p>SkillSwap matches you with people to learn from and to teach, for free, for pay, or swapped.</p>
            <div className="moa-cta">
              <Link className="cta solid" to={user ? '/dashboard' : '/register'}>{user ? 'Open dashboard' : 'Join SkillSwap'}</Link>
              <Link className="cta line" to={user ? '/discover' : '/login'}>{user ? 'Find people' : 'Log in'}</Link>
            </div>
          </div>

          <div className="moa-foot moa-mono fade">
            <span className="hide-s">Drag the record to scratch it</span>
            <div className="seg" role="group" aria-label="Flip the record">
              <button aria-pressed={side === 'A'} onClick={() => setSide('A')}>Side A<span className="hide-s"> · Mentor</span></button>
              <button aria-pressed={side === 'B'} onClick={() => setSide('B')}>Side B<span className="hide-s"> · Learner</span></button>
            </div>
            <span className="pill static">{scratch ? 'Scratching' : '33⅓ RPM'}</span>
          </div>
        </div>
      </div>

      <AboutRecord />

      <section className="tracks" aria-labelledby="how">
        <p className="moa-mono">Tracklist</p>
        <h2 id="how" className="sr">How it works</h2>
        <ol>{TRACKS.map(([n, h, p, tag]) => (
          <li key={n}><span className="moa-mono">{n}</span><h3>{h}</h3><p>{p}</p><span className="moa-mono tag-r">{tag}</span></li>
        ))}</ol>
      </section>

      {skills?.length > 0 && (
        <section className="sleeve" aria-labelledby="sk">
          <p className="moa-mono">Back of the sleeve</p>
          <h2 id="sk">Every skill is a track</h2>
          <div className="sleeve-cols">
            {[['Side A', skills.slice(0, half)], ['Side B', skills.slice(half)]].map(([label, list], c) => (
              <div key={label}><p className="moa-mono">{label}</p>
                <ul>{list.map((s, i) => <li key={s.id}><Link to={href(s)}><span className="moa-mono">{String(c * half + i + 1).padStart(2, '0')}</span><b>{s.name}</b><span className="moa-mono">{s.category}</span></Link></li>)}</ul></div>
            ))}
          </div>
        </section>
      )}

      <footer className="end">
        <div className="end-cta"><h2>Drop the needle</h2>
          <Link className="cta solid" to={user ? '/dashboard' : '/register'}>{user ? 'Open dashboard' : 'Join SkillSwap'}</Link></div>
        <div className="wordmark" aria-hidden="true">SKILLSWAP</div>
        <p className="moa-mono">© 2026 SkillSwap · Mentors and Learners</p>
      </footer>
    </div>
  );
}
