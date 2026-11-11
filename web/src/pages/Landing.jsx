import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useSkills } from '../lib.js';
import { useTheme } from '../theme.js';
import VinylRecord from '../components/VinylRecord.jsx';
import Record3D, { magAt } from '../components/Record3D.jsx';
import Macro from '../components/Macro.jsx';
import SideB from '../components/SideB.jsx';
import CassetteTimeline from '../components/CassetteTimeline.jsx';
import About from '../components/About.jsx';
import DragChip from '../components/DragChip.jsx';
import './landing-extra.css';
import './landing.css';
import './landing-motion.css';

const clock = () => { const d = new Date(), o = -d.getTimezoneOffset() / 60; return `${d.toTimeString().slice(0, 5)} GMT${o >= 0 ? '+' : '-'}${Math.abs(o)}`; };
const TRACKS = [
  ['01', 'Tell us two things', 'What you can share, and what you want to learn. Free, paid, or a straight swap. You are always both a Mentor and a Learner.', 'Setup'],
  ['02', 'Get ranked matches', 'Every person gets a compatibility score from skills, level, budget, time zone and language, with the reasons shown.', 'Match'],
  ['03', 'Meet in a room', 'Message, book a session, then join a built-in video room with screen sharing. No links to paste.', 'Meet'],
];

export default function Landing() {
  const { user, logout } = useAuth();
  const all = useSkills(); // the record and the sleeve show an even sample, not all of the catalogue
  const skills = useMemo(() => { const step = Math.ceil(all.length / 24) || 1; return all.filter((_, i) => i % step === 0); }, [all]);
  const [theme, toggleTheme] = useTheme();
  const [side, setSide] = useState('A');
  const [time, setTime] = useState(clock);
  const [scratch, setScratch] = useState(false);
  const [rpm, setRpm] = useState(33);   // 33 1/3 or 45, like the switch on a turntable
  const track = useRef(), mag = useRef();
  const [entered, setEntered] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true))); return () => cancelAnimationFrame(id); }, []); // the record rises in on load
  const onScratch = useCallback((v) => setScratch(v), []);
  useEffect(() => { const t = setInterval(() => setTime(clock()), 20000); return () => clearInterval(t); }, []);

  // One scroll listener scrubs the whole sequence by writing CSS variables (no React state, one rAF per frame).
  useEffect(() => {
    const el = track.current, root = el.parentElement;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.classList.add('nozoom'); return; }
    const ph = (p, a, b) => Math.max(0, Math.min(1, (p - a) / (b - a)));
    const KN = [[0, 0], [0.2, Math.log(14)], [0.45, Math.log(355)], [0.5, Math.log(355)], [0.62, 0]]; // readout in log space: x1 -> x22 -> x355, then back out
    const lnm = (p) => { for (let k = 1; k < KN.length; k++) if (p <= KN[k][0]) { const [p0, v0] = KN[k - 1], [p1, v1] = KN[k]; return v0 + (v1 - v0) * ph(p, p0, p1); } return 0; };
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect(), span = r.height - innerHeight;
      const p = Math.max(0, Math.min(1, span > 0 ? -r.top / span : 0));
      const a = ph(p, 0, 0.2), b = ph(p, 0.2, 0.45), c = ph(p, 0.5, 0.66), d = ph(p, 0.68, 0.76), f = ph(p, 0.76, 0.86);
      const set = (k, v) => el.style.setProperty(k, typeof v === 'number' ? v.toFixed(3) : v);
      set('--p', p.toFixed(4)); set('--a', a); set('--b', b);
      set('--scale', Math.exp(Math.log(14) * (a - c)));                         // one steady camera move: x1 -> x14 into the grooves, then back out
      set('--stageO', (p < 0.5 ? 1 - ph(p, 0.2, 0.27) : ph(p, 0.5, 0.58)) * (1 - ph(p, 0.745, 0.76)));
      set('--macroO', ph(p, 0.2, 0.27) * (1 - ph(p, 0.5, 0.58)));
      set('--waveO', ph(p, 0.44, 0.5) * (1 - ph(p, 0.56, 0.62)));
      set('--aY', 1 - 0.96 * d);                                               // Side A tips edge-on ...
      set('--bY', 0.04 + 0.76 * f); set('--bO', ph(p, 0.745, 0.76));          // ... and Side B tips up
      set('--capO', ph(p, 0.9, 0.95));
      el.classList.toggle('zoomed', p > 0.04);
      if (mag.current) { const m = magAt(p); mag.current.textContent = `×${m < 10 ? m.toFixed(1) : Math.round(m)}`; mag.current.parentElement.style.opacity = (ph(p, 0.03, 0.07) * (1 - ph(p, 0.6, 0.64))).toFixed(3); }
      const dh = document.documentElement.scrollHeight - innerHeight; root.style.setProperty('--sp', (dh > 0 ? scrollY / dh : 0).toFixed(4));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    update(); addEventListener('scroll', on, { passive: true }); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const half = Math.ceil((skills?.length || 0) / 2);
  const href = (s) => (user ? `/discover?skillId=${s.id}` : '/register');
  return (
    <div className={`moa-root ${entered ? '' : 'pre'}`} data-theme={theme}>
      <DragChip />
      <div className="zoom-track" ref={track}>
        <div className="zoom-bar" aria-hidden="true" />
        <div className="moa">
          <header className="moa-head">
            <Link to="/" className="moa-logo">SKILLSWAP<sup>©26</sup></Link>
            <nav className="moa-mono" aria-label="Main">
              {user ? <><Link to="/discover" className="hide-s">Discover</Link><Link to="/dashboard">Dashboard</Link><button onClick={logout} className="hide-s">Log out</button></>
                : <><Link to="/login" className="hide-s">Log in</Link><Link to="/register">Join</Link></>}
              <span className="hide-s">{time}</span>
              <button className="pill" onClick={toggleTheme} aria-pressed={theme === 'light'}>Theme <i /></button>
            </nav>
          </header>

          <div className="moa-row moa-mono fade"><span>Side {side}</span><span className="hide-s">Scroll to dive into the groove</span><span>Est. 2026</span></div>

          <VinylRecord skills={skills} side={side} rpm={rpm} onScratch={onScratch} />
          <Record3D side={side} theme={theme} rpm={rpm} onScratch={onScratch} />
          <Macro /><SideB />
          <p className="wave-copy" aria-hidden="true">Every groove is a waveform. Every swap starts the same way: needle down, then say hello.</p>
          <span className="flip-cap moa-mono" aria-hidden="true">Flip it. Side B is etched.</span>
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
            <button type="button" className="pill static rpm" onClick={() => setRpm((r) => (r === 33 ? 45 : 33))} aria-label={`Record speed ${rpm === 33 ? '33 and a third' : '45'} rpm. Switch speed.`}>{scratch ? 'Scratching' : `${rpm === 33 ? '33 1/3' : '45'} RPM`}</button>
          </div>
        </div>
      </div>

      <About />
      <CassetteTimeline />

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
          <p><Link className="cta line" to={user ? '/discover' : '/register'}>Browse all {all.length} skills</Link></p>
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
