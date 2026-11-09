/** The flat, top-down record after the dive: ring text, a diamond glyph, and the pitch in one paragraph. */
export default function AboutRecord({ record = true }) {
  const ring = 'SKILLSWAP ✦ '.repeat(5);
  return (
    <section className="about" aria-labelledby="about-h">
      {record && <div className="about-record" aria-hidden="true">
        <svg viewBox="0 0 1000 1000">
          <defs><path id="aring" d="M500 500 m-400 0 a400 400 0 1 1 800 0 a400 400 0 1 1 -800 0" /></defs>
          <circle cx="500" cy="500" r="490" className="ab-disc" />
          {[455, 360, 300, 250].map((r) => <circle key={r} cx="500" cy="500" r={r} className="ab-groove" />)}
          <text className="ab-ring"><textPath href="#aring" textLength="2490" lengthAdjust="spacing">{ring}</textPath></text>
          <circle cx="500" cy="500" r="190" className="ab-label" />
          <text x="500" y="486" textAnchor="middle" className="ab-lbl">MENTOR ✦</text>
          <text x="500" y="540" textAnchor="middle" className="ab-lbl">LEARNER</text>
          <circle cx="500" cy="500" r="9" fill="#050407" />
        </svg>
      </div>}
      <div className="about-copy">
        <p className="moa-mono"><i className="dot" /> Open to new Mentors and Learners</p>
        <p className="about-lead">Visuals for people who learn out loud.</p>
        <p className="moa-mono">About</p>
        <h2 id="about-h" className="about-h">A community where <em>mentors</em>, <em>learners</em> and <em>everyone in between</em> trade what they know, for free, for pay, or skill for skill.</h2>
      </div>
    </section>
  );
}
