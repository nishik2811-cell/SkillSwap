import { useEffect, useRef, useState } from 'react';

const STEPS = [
  ['01', 'Say what you can teach', 'Pick your skills and decide: free, paid, or swap only. You are a Mentor and a Learner at once.'],
  ['02', 'Say what you want to learn', 'Add your level, budget, languages and when you are free. That is your whole profile.'],
  ['03', 'Get ranked matches', 'Every person gets a compatibility score, with the reasons shown. Fit beats popularity.'],
  ['04', 'Connect and talk', 'Send a request, then chat one-to-one or in groups with read receipts and typing.'],
  ['05', 'Book and meet', 'Book a session, pay securely if it is paid, then join the built-in video room with screen sharing.'],
  ['06', 'Review and repeat', 'Rate each other after the session. Then flip the record and swap roles.'],
];

/** "The story so far", as a cassette: scroll plays the tape. Pinned for 360vh; the reels turn, the year-style numeral rolls. */
export default function CassetteTimeline() {
  const root = useRef(); const [i, setI] = useState(0); const [flip, setFlip] = useState(0); const [still, setStill] = useState(false);
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setStill(true); return; }
    let raf = 0;
    const upd = () => {
      raf = 0; const r = root.current.getBoundingClientRect(), span = r.height - innerHeight;
      const q = Math.max(0, Math.min(1, span > 0 ? -r.top / span : 0));
      root.current.style.setProperty('--q', q.toFixed(4));
      const idx = Math.min(STEPS.length - 1, Math.floor(q * STEPS.length));
      setI((o) => { if (o !== idx) setFlip((f) => f + 1); return idx; });
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(upd); };
    upd(); addEventListener('scroll', on, { passive: true }); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, []);
  const [n, h, p] = STEPS[i];
  return (
    <section className={`tape-track ${still ? 'still' : ''}`} ref={root} aria-labelledby="tape-h">
      <div className="tape-pin">
        <h2 id="tape-h" className="sr">How SkillSwap works</h2>
        <div className="tape">
          <div className="cassette" aria-hidden="true">
            <div className="c-top"><b>SKILLSWAP</b><span>A · C90</span></div><div className="c-stripe" /><div className="c-sub">HOW A SWAP GOES · 01–06</div>
            <div className="c-window"><div className="reel l"><i>✱</i></div><div className="reel r"><i>✱</i></div></div>
            <div className="c-keys">{[0, 1, 2, 3, 4].map((k) => <u key={k} className={k === i % 5 ? 'on' : ''} />)}</div>
          </div>
          {still ? <ol className="tape-list">{STEPS.map(([k, hh, pp]) => <li key={k}><b>{k}</b>{hh}<p className="tape-p">{pp}</p></li>)}</ol> : <div className="tape-copy">
            <p className="moa-mono">Side A · How it works <span className="tape-n">{n}/06</span></p>
            <div className="tape-num" key={`n${flip}`} aria-live="polite">{n}</div>
            <h3 key={`h${flip}`}>{h}</h3><p key={`p${flip}`} className="tape-p">{p}</p>
          </div>}
        </div>
        <div className="tape-bar" aria-hidden="true"><i /><ol>{STEPS.map(([k], j) => <li key={k} className={j <= i ? 'on' : ''}>{k}</li>)}</ol></div>
      </div>
    </section>
  );
}
