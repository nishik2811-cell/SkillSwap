const TERMS = [
  ['01', 'Free', 'Teach for the love of it, or learn from someone who does.'],
  ['02', 'Paid', 'Set your own price. Book and pay securely on SkillSwap.'],
  ['03', 'Swap', 'Trade skill for skill: you teach guitar, they teach Python.'],
];

/** Same sleeve-note look as the skills list below it: mono label, wide heading, ruled rows. */
export default function About() {
  return (
    <section className="sleeve about" aria-labelledby="about-h">
      <h2 id="about-h">Teach what you know. Learn what you don't.</h2>
      <ul className="about-terms">{TERMS.map(([n, name, line]) => <li key={n}><span className="moa-mono">{n}</span><b>{name}</b><span className="about-line">{line}</span></li>)}</ul>
    </section>
  );
}
