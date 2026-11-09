import { useEffect, useState } from 'react';
import { sound } from '../sound.js';

export const gateSeen = () => { try { return sessionStorage.getItem('ss.gate') === '1'; } catch { return false; } };

/** Entry screen, after the reference: pick sound or silence, then the record starts. Shown once per browser session. */
export default function Gate({ onEnter }) {
  const [open, setOpen] = useState(() => !gateSeen()); const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const esc = (e) => { if (e.key === 'Escape') enter(false); };
    addEventListener('keydown', esc); return () => { removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [open]); // eslint-disable-line
  function enter(withSound) {
    try { sessionStorage.setItem('ss.gate', '1'); } catch { /* fine */ }
    onEnter?.();
    if (withSound) sound.enable(); // this click is the user gesture browsers require for audio
    setLeaving(true); setTimeout(() => setOpen(false), 900);
  }
  if (!open) return null;
  return (
    <div className={`gate ${leaving ? 'out' : ''}`} role="dialog" aria-modal="true" aria-label="Welcome to SkillSwap">
      <div className="gate-top moa-mono"><span>SSW 001</span><span>Side A / Side B</span><span>© 2026</span></div>
      <div className="gate-mid">
        <div className="gate-disc" aria-hidden="true" />
        <h1>Skill<br />Swap</h1>
        <p className="moa-mono">Best experienced with sound on</p>
        <div className="gate-actions">
          <button className="gate-btn solid" autoFocus onClick={() => enter(true)}>Enter with sound ♪</button>
          <button className="gate-btn line" onClick={() => enter(false)}>Enter without sound</button>
        </div>
        <p className="moa-mono dim">Record cued. Needle's down when you are.</p>
      </div>
      <div className="gate-bot moa-mono"><span>Mentors and Learners</span></div>
    </div>
  );
}
