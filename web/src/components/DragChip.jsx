import { useEffect, useRef } from 'react';

/** A round "DRAG" chip that replaces the cursor over the record (fine pointers only; touch users just drag). */
export default function DragChip() {
  const chip = useRef();
  useEffect(() => {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    document.body.classList.add('has-chip');
    let raf = 0, x = 0, y = 0;
    const place = () => { raf = 0; chip.current.style.transform = `translate(${x - 29}px, ${y - 29}px)`; };
    // the chip never shows over the zoomed record
    const move = (e) => { x = e.clientX; y = e.clientY; const on = !document.querySelector('.zoom-track.zoomed') && !!e.target.closest?.('.vinyl-disc'); chip.current.classList.toggle('show', on); if (!raf) raf = requestAnimationFrame(place); };
    const down = (e) => { if (e.target.closest?.('.vinyl-disc')) chip.current.dataset.t = 'SCRATCH'; };
    const up = () => { chip.current.dataset.t = 'DRAG'; };
    addEventListener('pointermove', move, { passive: true }); addEventListener('pointerdown', down); addEventListener('pointerup', up);
    return () => { document.body.classList.remove('has-chip'); removeEventListener('pointermove', move); removeEventListener('pointerdown', down); removeEventListener('pointerup', up); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return <div ref={chip} className="drag-chip" data-t="DRAG" aria-hidden="true" />;
}
