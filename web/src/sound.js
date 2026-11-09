// Vinyl ambience synthesised with WebAudio: no audio files to download or license.
// Hiss (filtered pink-ish noise), motor hum, random dust clicks. Starts only after a user gesture; scratching opens the filter.
import { useSyncExternalStore } from 'react';

let ctx = null, master = null, nodes = null, timer = 0, clickBuf = null, state = { on: false };
const subs = new Set(); const emit = (o) => { state = { ...state, ...o }; subs.forEach((f) => f()); };
const store = (v) => { try { sessionStorage.setItem('ss.sound', v); } catch { /* storage unavailable */ } };

function pink(c, secs) {
  const b = c.createBuffer(1, c.sampleRate * secs, c.sampleRate), d = b.getChannelData(0); let l = 0;
  for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; }
  return b;
}
function build() {
  master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination); master.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
  const n = ctx.createBufferSource(); n.buffer = pink(ctx, 3); n.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800;
  const g = ctx.createGain(); g.gain.value = 0.05; n.connect(lp).connect(g).connect(master); n.start();
  const o = ctx.createOscillator(); o.frequency.value = 50; const og = ctx.createGain(); og.gain.value = 0.012; o.connect(og).connect(master); o.start(); // turntable motor
  nodes = { n, o, lp, g };
  clickBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.004), ctx.sampleRate);
  const cd = clickBuf.getChannelData(0); for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / cd.length);
  const click = () => {
    if (!state.on || !ctx) return;
    const s = ctx.createBufferSource(); s.buffer = clickBuf; const cg = ctx.createGain(); cg.gain.value = 0.1 + Math.random() * 0.3; s.connect(cg).connect(master); s.start();
    timer = setTimeout(click, 60 + Math.random() * 700);
  };
  emit({ on: true }); click();
}

export const sound = {
  async enable() {
    if (state.on) return;
    try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume(); build(); store('1'); } catch { emit({ on: false }); }
  },
  disable() {
    if (!state.on || !ctx) { store('0'); return; }
    clearTimeout(timer); master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    const old = nodes; setTimeout(() => { try { old.n.stop(); old.o.stop(); } catch { /* already stopped */ } }, 600);
    nodes = null; emit({ on: false }); store('0');
  },
  toggle() { return state.on ? sound.disable() : sound.enable(); },
  scratch(on) { if (!nodes) return; nodes.lp.frequency.setTargetAtTime(on ? 6500 : 2800, ctx.currentTime, 0.05); nodes.g.gain.setTargetAtTime(on ? 0.18 : 0.05, ctx.currentTime, 0.05); },
};
export const useSound = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state).on;
