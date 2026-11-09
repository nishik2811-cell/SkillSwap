import { useEffect, useRef } from 'react';

/** The stylus-eye view: wavy parallel ridges, a bright groove edge and a noisy lead-in band, drawn once on a canvas,
 *  then laid flat in perspective by CSS so scrolling can drift it. */
export default function Macro() {
  const cv = useRef();
  useEffect(() => {
    const c = cv.current, W = (c.width = 1600), H = (c.height = 1400), x = c.getContext('2d');
    x.fillStyle = '#18181c'; x.fillRect(0, 0, W, H);
    const rows = 100;
    for (let i = 0; i < rows; i++) {
      const y0 = (i / rows) * H, l = 38 + ((i * 37) % 17) * 3;
      x.beginPath();
      for (let px = 0; px <= W; px += 8) { const y = y0 + Math.sin(px * 0.011 + i * 0.33) * 10 + Math.sin(px * 0.029 + i * 1.7) * 3.5; px ? x.lineTo(px, y) : x.moveTo(px, y); }
      x.strokeStyle = `rgba(${l + 50},${l + 50},${l + 56},.55)`; x.lineWidth = 3.4; x.stroke();
      x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = 1.2; x.translate(0, 4); x.stroke(); x.translate(0, -4);
    }
    // lead-in band: a lighter diagonal strip full of dust
    x.save(); x.translate(W * 0.62, 0); x.rotate(0.35);
    const g = x.createLinearGradient(0, 0, 220, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.45, 'rgba(255,255,255,.28)'); g.addColorStop(.55, 'rgba(255,255,255,.1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, -300, 220, H * 1.5);
    for (let k = 0; k < 2600; k++) { x.fillStyle = `rgba(255,255,255,${Math.random() * .25})`; x.fillRect(Math.random() * 220, -300 + Math.random() * H * 1.5, 1.4, 1.4); }
    x.restore();
  }, []);
  return <div className="macro2" aria-hidden="true"><div className="macro2-plane"><canvas ref={cv} /></div><div className="macro2-horizon" /></div>;
}
