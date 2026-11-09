import { useEffect, useMemo, useRef } from 'react';

const FALLBACK = ['Guitar', 'Python', 'Photography', 'Hindi', 'Cooking', 'UI/UX Design', 'Piano', 'Spanish', 'Fitness', 'JavaScript', 'Video Editing', 'English'];

/* The record is drawn in code: grooves as resolution-independent CSS gradients (they stay sharp at any zoom), a fixed sheen, and a spinning label.
   Spin is one rAF loop touching a single transform. Drag to scratch it. 33 1/3 rpm = 200 deg/s. */
export default function VinylRecord({ skills, side, onScratch }) {
  const spinner = useRef(), disc = useRef();
  const names = useMemo(() => (skills?.length ? skills.map((s) => s.name) : FALLBACK).map((n) => n.toUpperCase()), [skills]);

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let angle = 0, speed = reduce ? 0 : 200, drag = null, last = performance.now(), raf;
    const el = spinner.current, base = reduce ? 0 : 200;
    const frame = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (!drag) { speed += (base - speed) * Math.min(1, dt * 2.2); angle += speed * dt; }
      el.style.transform = `rotate(${angle}deg)`; raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const d = disc.current;
    const down = (e) => { drag = { x: e.clientX, t: performance.now() }; speed = 0; d.setPointerCapture(e.pointerId); d.classList.add('scratching'); onScratch?.(true); };
    const move = (e) => { if (!drag) return; const now = performance.now(), dx = e.clientX - drag.x; angle += dx * 0.9; speed = (dx * 0.9) / Math.max(0.008, (now - drag.t) / 1000); drag = { x: e.clientX, t: now }; };
    const up = () => { if (!drag) return; drag = null; d.classList.remove('scratching'); speed = Math.max(-1200, Math.min(1200, speed)); onScratch?.(false); };
    d.addEventListener('pointerdown', down); d.addEventListener('pointermove', move); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
    return () => { cancelAnimationFrame(raf); d.removeEventListener('pointerdown', down); d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up); };
  }, [onScratch]);

  const ring = names.join('   ·   ') + '   ·   ';
  const A = side === 'A';
  return (
    <div className="vinyl-stage">
      <div className="vinyl-tilt">
        <div className="vinyl-rim" />
        <div className="vinyl-disc" ref={disc} role="img" aria-label="A vinyl record. Drag it to scratch.">
          <div className="vinyl-spin" ref={spinner}>
            <div className="vinyl-grooves" aria-hidden="true" />
            <svg viewBox="0 0 1000 1000" className="vinyl-art" aria-hidden="true">
              <defs><path id="ring" d="M500 500 m-330 0 a330 330 0 1 1 660 0 a330 330 0 1 1 -660 0" /><path id="lring" d="M500 500 m-140 0 a140 140 0 1 1 280 0 a140 140 0 1 1 -280 0" /></defs>
              <text className="ring-text"><textPath href="#ring" textLength="2070" lengthAdjust="spacing">{ring}</textPath></text>
              <circle cx="500" cy="500" r="175" className={A ? 'label a' : 'label b'} />
              <circle cx="500" cy="500" r="175" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="2" />
              <text className="label-ring"><textPath href="#lring" textLength="870" lengthAdjust="spacing">{`SKILLSWAP · SIDE ${side} · ${A ? 'I CAN TEACH' : 'I WANT TO LEARN'} · 33⅓ RPM · `}</textPath></text>
              <text x="500" y="520" textAnchor="middle" className="label-big">{A ? 'TEACH' : 'LEARN'}</text>
              <text x="500" y="590" textAnchor="middle" className="label-small">{`SIDE ${side}`}</text>
              <circle cx="500" cy="500" r="11" fill="#050407" />
            </svg>
          </div>
          <div className="vinyl-sheen" aria-hidden="true" />
        </div>
      </div>
      <div className="vinyl-shadow" aria-hidden="true" />
    </div>
  );
}
