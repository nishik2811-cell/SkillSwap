import { useEffect, useRef } from 'react';

/* The hero record, rendered for real: a 12" disc ray-traced per pixel in a fragment shader (WebGL2).
   Grooves are a true spiral whose walls wobble with a waveform; light comes from studio softboxes.
   Scrolling flies a camera down into a single groove, pulls back out and flips the record to its etched B-side.
   If WebGL2 is missing the old CSS record stays (this component never adds the `gl` class). */

const TAU = Math.PI * 2, RPM33 = (100 / 3) * TAU / 60, RPM45 = 45 * TAU / 60;
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  mix: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* Camera path over scroll progress s (0..1): hover above the record, dive into a groove (x355), hold, pull out, flip to Side B. */
const T0 = [0, 0, 0.05], D0 = 4.8, DIR0 = v3.norm([0, 1, 0.9]);
const DIVE = [0.52, 0, 0.47], DR = Math.hypot(DIVE[0], DIVE[2]), TAN = [-DIVE[2] / DR, 0, DIVE[0] / DR];
const DIR1 = v3.norm(v3.add(v3.mul(TAN, -1), [0, 0.14, 0])), D1 = 0.0127;
const DIRF = v3.norm([0, 1, 0.55]), DF = 4.8;
export const HOLD = [0.5, 0.6];       // scroll range where the camera rests inside the groove
export function cameraAt(s, aspect = 1.6, mx = 0, my = 0) {
  let tgt, dist, dir, flip = 0, up = 0;
  if (s < 0.5) {
    const e = ease(smooth(0.04, 0.5, s));
    tgt = v3.mix(T0, DIVE, smooth(0, 0.45, e)); dist = Math.exp(Math.log(D0) + (Math.log(D1) - Math.log(D0)) * e); dir = v3.norm(v3.mix(DIR0, DIR1, Math.pow(e, 2.2)));
  } else if (s < 0.6) { tgt = DIVE; dist = D1; dir = DIR1; }
  else {
    const e = ease(smooth(0.6, 0.86, s));
    tgt = v3.mix(DIVE, [0, 0, 0], smooth(0.1, 0.8, e)); dist = Math.exp(Math.log(D1) + (Math.log(DF) - Math.log(D1)) * e); dir = v3.norm(v3.mix(DIR1, DIRF, Math.pow(e, 0.5)));
    flip = ease(smooth(0.7, 0.92, s)) * Math.PI;
  }
  const o = Math.min(1, dist / 1.5), ay = mx * 0.2 * o, ax = my * 0.1 * o, cy = Math.cos(ay), sy = Math.sin(ay);   // a little orbit with the pointer, fading out up close
  dir = v3.norm([dir[0] * cy + dir[2] * sy, dir[1] + ax, -dir[0] * sy + dir[2] * cy]);
  const fit = Math.max(1, 4.2 / aspect / D0), d2 = dist * (1 + (fit - 1) * clamp01(dist / 3));       // narrow screens: back off so the whole record fits
  up = 0.15 * (1 - smooth(0.02, 0.2, s)) * (1 - smooth(0.88, 0.97, s)); // hero: sit the record in the upper part of the frame
  return { cam: v3.add(tgt, v3.mul(dir, d2)), tgt, dist, flip, off: up };
}
export const magAt = (s) => D0 / cameraAt(s).dist;

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes, uLight; uniform float uRot, uFlip, uSide, uOff, uDive;
uniform vec3 uCam, uTgt, uBg, uAcc;
uniform sampler2D uTexA, uTexL, uTexB;
const float TAU = 6.2831853;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
vec3 env(vec3 d){                                   // the little studio the record reflects
  vec3 c = mix(vec3(0.008), vec3(0.05, 0.05, 0.058), smoothstep(-0.3, 1.0, d.y));
  vec3 k = normalize(vec3(uLight.x, 0.85, uLight.y));
  c += vec3(1.0, 0.96, 0.9) * smoothstep(0.95, 0.985, dot(d, k)) * 3.2;                       // key softbox
  c += vec3(0.85, 0.9, 1.0) * smoothstep(0.07, 0.02, abs(d.x - 0.62 * d.y + 0.15)) * smoothstep(0.05, 0.4, d.y) * 1.2;  // strip light
  c += uAcc * 0.5 * smoothstep(0.88, 0.97, dot(d, normalize(vec3(0.7, 0.25, -0.65))));       // accent kicker
  return c;
}
float wav(float th, float r){                       // groove wobble: integer harmonics only, so there is no seam at +-pi
  return 0.5 * sin(th * 95.0 + sin(th * 2.0) * 3.0) + 0.3 * sin(th * 410.0 + r * 60.0) + 0.14 * sin(th * 1500.0);
}
vec3 tone(vec3 c){ c = c / (1.0 + c); return pow(c, vec3(1.0 / 2.2)); }
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y; uv.y -= uOff;
  vec3 f = normalize(uTgt - uCam), rr = normalize(cross(f, vec3(0.0, 1.0, 0.0))), up = cross(rr, f);
  vec3 rd = normalize(f * 1.85 + uv.x * rr + uv.y * up);
  vec3 bg = mix(uBg, vec3(0.045, 0.045, 0.055), uDive) * (1.0 - 0.18 * dot(uv, uv));   // inside the groove the world goes dark, whatever the theme
  vec3 N = vec3(0.0, cos(uFlip), sin(uFlip)), U = vec3(1.0, 0.0, 0.0), V = vec3(0.0, -sin(uFlip), cos(uFlip));
  float den = dot(rd, N);
  float t = -dot(uCam, N) / den;
  bool ok = t > 0.0 && abs(den) > 1e-5; if (!ok) t = 1.0;             // no early return: derivatives below need uniform flow
  vec3 P = uCam + rd * t;
  float a = dot(P, U), b = dot(P, V), r = length(vec2(a, b));
  float fw = fwidth(r);
  float cover = ok ? smoothstep(1.0 + fw, 1.0 - fw, r) * smoothstep(0.0235 - fw, 0.0235 + fw, r) : 0.0;
  bool front = den < 0.0;
  vec3 Nf = front ? N : -N;
  vec3 Er = (U * a + V * b) / max(r, 1e-4), Et = cross(Nf, Er);
  float cs = cos(uRot), sn = sin(uRot);
  vec2 q = vec2(cs * a + sn * b, -sn * a + cs * b);
  float th = atan(q.y, q.x);
  vec3 Vv = -rd, L = normalize(vec3(uLight.x, 1.1, uLight.y)), H = normalize(L + Vv);
  vec3 col, n = Nf, base = vec3(0.011, 0.010, 0.014), diff = base;
  float ao = 1.0, gloss = 1.0, aniso = 0.0;
  if (r < 0.333) {                                                    // paper label
    vec2 lq = q;
    vec2 luv = lq * (0.5 / 0.333) + 0.5;
    vec2 buv = vec2(lq.x, -lq.y) * 0.5 + 0.5;
    vec3 lab = front ? mix(texture(uTexA, luv).rgb, texture(uTexL, luv).rgb, uSide) : texture(uTexB, buv).rgb;
    lab = pow(lab, vec3(2.2));
    float nd = max(dot(Nf, L), 0.0);
    col = lab * (0.2 + 0.95 * nd) + lab * env(reflect(-Vv, Nf)) * 0.05 + pow(max(dot(Nf, H), 0.0), 30.0) * 0.06;
  } else {
    if (front && r <= 0.39) {                                         // run-out: one wide spiral and the locked groove
      float g = fract(r / 0.012 + th / TAU), x = (g - 0.5) / 0.08;
      float s = abs(x) < 1.0 ? clamp(x * 4.0, -1.0, 1.0) : 0.0;
      s += smoothstep(0.003, 0.0, abs(r - 0.352)) * sign(r - 0.352);
      n = normalize(Nf - Er * s * 0.9);
    } else if (front && r < 0.98) {                                   // the music: a spiral groove with track gaps
      float gaps = min(min(abs(r - 0.52), abs(r - 0.64)), min(abs(r - 0.75), abs(r - 0.87)));
      float inGap = smoothstep(0.0045, 0.003, gaps);
      float pitch = 0.00085, w = fw / pitch;
      float ph = r / pitch + th / TAU + wav(th, r) * 0.26 * (1.0 - inGap);
      float x = (fract(ph) - 0.5) / 0.38;
      float s = abs(x) < 1.0 ? clamp(x * 7.0, -1.0, 1.0) : 0.0;
      float res = smoothstep(0.75, 0.2, w) * (1.0 - inGap);          // sub-pixel grooves fade into a smooth anisotropic sheen
      n = normalize(Nf - Er * s * res);
      ao = mix(1.0, mix(0.55, 1.0, abs(x)), res * step(abs(x), 1.0));
      aniso = (1.0 - smoothstep(0.75, 0.2, w)) * (1.0 - inGap * 0.7);
    } else if (!front && r < 0.98) {                                  // Side B: frosted etching on mirror black
      vec2 euv = vec2(q.x, -q.y) * 0.5 + 0.5;
      float m = texture(uTexB, euv).r;
      gloss = 1.0 - m * 0.92;
      diff = mix(base, vec3(0.11, 0.11, 0.12) * (0.85 + 0.3 * hash(floor(q * 900.0))), m);
    }
    n = normalize(n + Er * smoothstep(0.988, 1.0, r) * 1.6);          // bevelled lead-in edge
    float ndv = max(dot(n, Vv), 0.0), fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-Vv, n), Hn = normalize(L + Vv);
    vec3 spec = env(R) * fres * gloss + vec3(pow(max(dot(n, Hn), 0.0), 600.0) * 4.0) * fres * gloss;
    float tdh = dot(Et, Hn), kk = pow(sqrt(max(0.0, 1.0 - tdh * tdh)), 220.0);     // radial streaks of light across a spinning record
    float tdh2 = dot(Et, normalize(normalize(vec3(-0.6, 0.6, 0.4)) + Vv)), kk2 = pow(sqrt(max(0.0, 1.0 - tdh2 * tdh2)), 160.0);
    float tdh3 = dot(Et, normalize(normalize(vec3(0.7, 0.8, -0.3)) + Vv)), kk3 = pow(sqrt(max(0.0, 1.0 - tdh3 * tdh3)), 14.0);   // broad soft wedges: the satin look of real vinyl
    spec += aniso * (vec3(1.0, 0.97, 0.92) * kk * 0.9 + vec3(0.8, 0.85, 1.0) * kk2 * 0.35 + vec3(0.75, 0.8, 0.95) * kk3 * 0.13) * (0.3 + fres);
    float band = 0.5 + 0.5 * sin(r * 3300.0 + th * 0.0), bw = smoothstep(0.45, 0.1, fw * 3300.0 / TAU);   // fine ring banding, only where the eye can resolve it
    spec *= 1.0 + 0.35 * (band - 0.5) * bw * (1.0 - aniso * 0.0);
    ao *= mix(0.62, 1.0, smoothstep(0.333, 0.5, r)) * mix(1.0, 0.8, smoothstep(0.9, 0.985, r));   // shade at the label and the rim
    col = (diff * (0.25 + max(dot(n, L), 0.0)) + diff * env(n) * 0.6 + spec) * ao;
  }
  // a real 2 mm slab: the lower rim shows under the near edge, and the record casts a soft shadow on the surface it rests on
  float sg = front ? 1.0 : -1.0;
  float t2 = (-0.03 * sg - dot(uCam, N)) / den;
  vec3 P2 = uCam + rd * (t2 > 0.0 ? t2 : 1.0);
  vec2 ab2 = vec2(dot(P2, U), dot(P2, V)); float r2 = length(ab2), fw2 = fwidth(r2);
  float edgeM = (t2 > 0.0 ? smoothstep(1.0 + fw2, 1.0 - fw2, r2) : 0.0) * (1.0 - cover);
  vec3 Eo = (U * ab2.x + V * ab2.y) / max(r2, 1e-4);
  vec3 edgeC = tone(vec3(0.018) + env(reflect(-Vv, Eo)) * 0.5 + vec3(0.5) * pow(max(dot(Eo, L), 0.0), 3.0) * 0.25);
  float tf = (-0.07 * sg - dot(uCam, N)) / den;
  vec3 Pf = uCam + rd * (tf > 0.0 ? tf : 1.0);
  float rf = length(vec2(dot(Pf, U), dot(Pf, V)));
  float rs = length(vec2(dot(Pf, U) + uLight.x * 0.16, dot(Pf, V) + uLight.y * 0.16));
  float lum = dot(bg, vec3(0.33));
  vec3 bgF = bg + vec3(0.04) * (1.0 - lum) * smoothstep(2.6, 0.5, rf);                 // a faint pool of light under the record ...
  bgF *= 1.0 - mix(0.8, 0.3, lum) * smoothstep(1.4, 0.9, rs) * (tf > 0.0 ? 1.0 : 0.0);               // ... and the shadow it throws
  vec3 outc = mix(bgF, edgeC, edgeM);
  outc = mix(outc, tone(col), cover);
  outc += (hash(gl_FragCoord.xy) - 0.5) * 0.004;
  o = vec4(outc, 1.0);
}`;

/* ---------- textures drawn once on 2D canvases ---------- */
function ringText(x, text, cx, cy, rad, size, start = -Math.PI / 2) {
  const step = TAU / text.length; x.save(); x.translate(cx, cy);
  for (let i = 0; i < text.length; i++) { x.save(); x.rotate(start + i * step); x.translate(0, -rad); x.textAlign = 'center'; x.fillText(text[i], 0, 0); x.restore(); }
  x.restore();
}
function labelTex(font, bg, fg, big, side, sub) {
  const S = 1024, c = Object.assign(document.createElement('canvas'), { width: S, height: S }), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, S, S);
  x.fillStyle = fg; x.textBaseline = 'middle';
  x.font = `600 40px ${font}`; ringText(x, `SKILLSWAP · SIDE ${side} · ${sub} · 33 1/3 RPM · `.repeat(1).padEnd(60, ' ').slice(0, 60), S / 2, S / 2, 392, 40);
  x.textAlign = 'center'; x.font = `800 190px ${font}`; x.fillText(big, S / 2, S / 2 - 6);
  x.font = `500 52px ${font}`; x.fillText(`SIDE ${side}`, S / 2, S / 2 + 140);
  return c;
}
function backTex(font) {
  const S = 1024, c = Object.assign(document.createElement('canvas'), { width: S, height: S }), x = c.getContext('2d'), C = S / 2, R = S / 2;
  x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
  x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.textBaseline = 'middle';
  x.font = `800 ${0.11 * R * 2}px ${font}`; ringText(x, 'SKILLSWAP ✦ SKILLSWAP ✦ SKILLSWAP ✦ SKILLSWAP ✦ ', C, C, 0.8 * R, 0);
  x.lineWidth = 2; for (const rr of [0.96, 0.62]) { x.beginPath(); x.arc(C, C, rr * R, 0, TAU); x.stroke(); }
  x.fillStyle = '#d9d6cb'; x.beginPath(); x.arc(C, C, 0.333 * R, 0, TAU); x.fill();           // silver label
  x.strokeStyle = 'rgba(10,10,12,.5)'; x.lineWidth = 2.4;
  for (let i = 0; i < 96; i++) { const a = (i / 96) * TAU; x.beginPath(); x.moveTo(C + Math.cos(a) * 0.14 * R, C + Math.sin(a) * 0.14 * R); x.lineTo(C + Math.cos(a) * 0.3 * R, C + Math.sin(a) * 0.3 * R); x.stroke(); }
  x.fillStyle = '#d9d6cb'; x.beginPath(); x.arc(C, C, 0.13 * R, 0, TAU); x.fill();
  x.fillStyle = '#0b0b0e'; x.textAlign = 'center'; x.font = `800 ${0.09 * R * 2}px ${font}`; x.fillText('SWAP', C, C + 4);
  return c;
}
const rgb = (css) => {                                  // '#rrggbb' or 'rgb(r, g, b)'
  const h = /^#([\da-f]{6})$/i.exec(css.trim());
  if (h) { const n = parseInt(h[1], 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
  const m = css.match(/[\d.]+/g) || [12, 11, 15]; return [m[0] / 255, m[1] / 255, m[2] / 255];
};

export default function Record3D({ side, theme, rpm = 33, onScratch }) {
  const cv = useRef(), live = useRef({ side, theme, rpm });
  live.current = { side, theme, rpm };

  useEffect(() => {
    const canvas = cv.current, root = canvas.closest('.moa-root'), track = canvas.closest('.zoom-track');
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) return;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; } return s; };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG); if (!vs || !fs) return;
    const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; for (const k of ['uRes', 'uLight', 'uRot', 'uFlip', 'uSide', 'uOff', 'uDive', 'uCam', 'uTgt', 'uBg', 'uAcc', 'uTexA', 'uTexL', 'uTexB']) U[k] = gl.getUniformLocation(prog, k);
    const tex = [0, 1, 2].map((i) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(U[['uTexA', 'uTexL', 'uTexB'][i]], i); return t; });
    const upload = (i, c) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[i]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); };
    let bg = [0.05, 0.05, 0.06], acc = [0.35, 0.42, 1];
    const build = () => {
      const cs = getComputedStyle(root), font = cs.getPropertyValue('--display').trim() || 'sans-serif', accent = cs.getPropertyValue('--accent').trim() || '#5b6bff';
      bg = rgb(cs.getPropertyValue('--bg') || '#0c0b0f');   // the variable, not the computed background: that one is still fading when the theme flips const a = new Option().style; a.color = accent; acc = rgb(a.color || 'rgb(91,107,255)');
      upload(0, labelTex(font, accent, '#f4f3ff', 'TEACH', 'A', 'I CAN TEACH'));
      upload(1, labelTex(font, '#e9e4d4', '#15141a', 'LEARN', 'B', 'I WANT TO LEARN'));
      upload(2, backTex(font));
    };
    let builtFor = '';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.dataset.gl = '1';

    let W = 1, H = 1, scale = 1, sMix = live.current.side === 'B' ? 1 : 0, s = 0, visible = true, rot = 0, omega = reduce ? 0 : RPM33, dragging = false, lastX = 0, lastT = 0, mx = 0, my = 0, smx = 0, smy = 0, cur = cameraAt(0), raf = 0, slowFrames = 0, last = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * scale; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
    const progress = () => { if (reduce || !track) return 0; const r = track.getBoundingClientRect(), span = r.height - innerHeight; return span > 0 ? clamp01(-r.top / span) : 0; };
    // is the pointer on the record? (ray -> record plane, same maths as the shader)
    const onRecord = (px, py) => {
      const c = cameraAt(s, W / H, 0, 0), f = v3.norm(v3.sub(c.tgt, c.cam)), rr = v3.norm(v3.cross(f, [0, 1, 0])), up = v3.cross(rr, f);
      const u = (px - W / 2) / H, v = -(py - H / 2) / H - c.off, rd = v3.norm(v3.add(v3.add(v3.mul(f, 1.85), v3.mul(rr, u)), v3.mul(up, v)));
      const N = [0, Math.cos(c.flip), Math.sin(c.flip)], den = v3.dot(rd, N); if (Math.abs(den) < 1e-5) return false;
      const t = -v3.dot(c.cam, N) / den; if (t <= 0) return false; const P = v3.add(c.cam, v3.mul(rd, t)); return Math.hypot(P[0], P[1], P[2]) < 1;
    };
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const move = (e) => {
      const [px, py] = local(e); mx = px / W * 2 - 1; my = py / H * 2 - 1;
      canvas.classList.toggle('over', s < 0.04 && onRecord(px, py));
      if (dragging) { const now = performance.now(), dx = e.clientX - lastX; rot += dx * 0.012; omega = (dx * 0.012) / Math.max(0.008, (now - lastT) / 1000); lastX = e.clientX; lastT = now; }
    };
    const down = (e) => { const [px, py] = local(e); if (s > 0.04 || !onRecord(px, py)) return; dragging = true; lastX = e.clientX; lastT = performance.now(); omega = 0; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } onScratch?.(true); };
    const up = () => { if (!dragging) return; dragging = false; omega = Math.max(-14, Math.min(14, omega)); onScratch?.(false); };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { mx = my = 0; canvas.classList.remove('over'); });
    const io = new IntersectionObserver((en) => { visible = en[0].isIntersecting; }); io.observe(canvas);

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      if (!visible) return;
      const key = live.current.theme; if (builtFor !== key) { builtFor = key; build(); }
      if (!dragging) omega += ((reduce ? 0 : live.current.rpm === 45 ? RPM45 : RPM33) - omega) * Math.min(1, dt * 2.6);
      s = progress(); smx += (mx - smx) * Math.min(1, dt * 3); smy += (my - smy) * Math.min(1, dt * 3);
      sMix += ((live.current.side === 'B' ? 1 : 0) - sMix) * Math.min(1, dt * 8);
      cur = cameraAt(s, W / H, smx, smy);
      rot += omega * dt * Math.max(0.004, Math.min(1, cur.dist / D0));     // slow the platter as we close in, so the needle's-eye view drifts instead of smearing
      gl.uniform2f(U.uRes, canvas.width, canvas.height); gl.uniform1f(U.uRot, rot); gl.uniform1f(U.uFlip, cur.flip); gl.uniform1f(U.uSide, sMix); gl.uniform1f(U.uOff, cur.off);
      const dive = smooth(0.08, 0.22, s) * (1 - smooth(0.6, 0.7, s)); gl.uniform1f(U.uDive, dive); root.style.setProperty('--dive', dive.toFixed(3));   // the page text reads --dive to stay legible over the dark groove field
      gl.uniform3fv(U.uCam, cur.cam); gl.uniform3fv(U.uTgt, cur.tgt); gl.uniform3fv(U.uBg, bg); gl.uniform3fv(U.uAcc, acc); gl.uniform2f(U.uLight, -0.55 + smx * 0.6, 0.35 + smy * 0.5);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // a slow GPU? render at lower resolution rather than stutter
      if (dt > 0.034) { if (++slowFrames > 20 && scale > 0.5) { scale *= 0.8; slowFrames = 0; resize(); } } else slowFrames = Math.max(0, slowFrames - 1);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); delete root.dataset.gl; root.style.removeProperty('--dive'); };
  }, [onScratch]);

  return <canvas ref={cv} className="rec3d" role="img" aria-label="A vinyl record. Scroll to dive into its groove. Drag it to scratch." />;
}
