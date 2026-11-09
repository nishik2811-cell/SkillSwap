/** Side B: a silver sunburst label inside a wide dark rim with giant ring text. Flipped to by scroll. */
export default function SideB() {
  const rays = Array.from({ length: 96 }, (_, i) => i * (360 / 96));
  return (
    <div className="sideb" aria-hidden="true">
      <svg viewBox="0 0 1000 1000">
        <defs><path id="bring" d="M500 500 m-395 0 a395 395 0 1 1 790 0 a395 395 0 1 1 -790 0" /><path id="bsm" d="M500 500 m-168 0 a168 168 0 1 1 336 0 a168 168 0 1 1 -336 0" /></defs>
        <circle cx="500" cy="500" r="494" className="sb-disc" /><circle cx="500" cy="500" r="318" className="sb-rim" />
        <text className="sb-ring"><textPath href="#bring" textLength="2440" lengthAdjust="spacing">{'SKILLSWAP ✦ '.repeat(4)}</textPath></text>
        <circle cx="500" cy="500" r="262" className="sb-label" />
        {rays.map((a) => <line key={a} x1="500" y1="500" x2="500" y2="246" transform={`rotate(${a} 500 500)`} className="sb-ray" />)}
        <circle cx="500" cy="500" r="124" className="sb-inner" />
        <text className="sb-small"><textPath href="#bsm" textLength="1020" lengthAdjust="spacing">{'MENTOR · LEARNER · FREE · PAID · SWAP · '}</textPath></text>
        <text x="500" y="520" textAnchor="middle" className="sb-big">SWAP</text>
        <circle cx="500" cy="500" r="10" fill="#050407" />
      </svg>
    </div>
  );
}
