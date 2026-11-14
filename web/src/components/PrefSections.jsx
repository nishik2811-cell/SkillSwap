import { useState } from 'react';
import { api, errorText } from '../api.js';
import { Field, Avatar } from './UI.jsx';
import { LEVELS, STYLES, DAYS, PARTS, LANGUAGES, cap, useSkills } from '../lib.js';

function SkillPicker({ skills, selected, onToggle, tone }) {
  const [q, setQ] = useState(''); const needle = q.trim().toLowerCase();
  const shown = needle ? skills.filter((s) => `${s.name} ${s.category}`.toLowerCase().includes(needle)) : skills;
  const cats = [...new Set(shown.map((s) => s.category))];
  return <div className="stack"><input type="search" aria-label="Search skills" placeholder={`Search ${skills.length} skills…`} value={q} onChange={(e) => setQ(e.target.value)} />
    {needle && !cats.length && <p className="hint">No skill matches "{q.trim()}". Ask an admin to add it.</p>}
    {cats.map((c) => <div key={c}><div className="tag muted">{c}</div><div className="row" style={{ marginTop: 6 }}>
    {shown.filter((s) => s.category === c).map((s) => <button type="button" key={s.id} className="chip" aria-pressed={selected.includes(String(s.id))} onClick={() => onToggle(s.id)}>{s.name}</button>)}
  </div></div>)}</div>;
}
const sel = (v, set, opts) => <select value={v} onChange={(e) => set(e.target.value)}>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
const lvlOpts = LEVELS.map((l) => [l, cap(l)]);
const styleOpts = Object.entries(STYLES);

export function AboutSection({ f, setF }) {
  const [msg, setMsg] = useState('');
  async function removePhoto() {
    setMsg('');
    try { await api('/me/avatar', { method: 'DELETE' }); setF((st) => ({ ...st, avatarUrl: null })); } catch (x) { setMsg(errorText(x)); }
  }
  async function upload(e) {
    const file = e.target.files[0]; if (!file) return; setMsg('');
    const form = new FormData(); form.append('avatar', file);
    try { const r = await api('/me/avatar', { method: 'POST', form }); setF((s) => ({ ...s, avatarUrl: r.avatarUrl })); } catch (x) { setMsg(x.body?.message || errorText(x)); }
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return <div className="stack">
    <div className="row"><Avatar user={{ avatarUrl: f.avatarUrl, fullName: f.fullName }} big />
      <div><label htmlFor="av">Album cover photo</label><input id="av" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} /><div className="hint err">{msg}</div><div className="hint">Your photo becomes your album cover. Square photos look best. PNG, JPEG or WebP, up to 2 MB</div>{f.avatarUrl && <button type="button" className="btn small ghost" style={{ marginTop: 8 }} onClick={removePhoto}>Remove photo</button>}</div></div>
    <Field id="f-name" label="Full name"><input id="f-name" value={f.fullName} onChange={set('fullName')} /></Field>
    <Field id="f-bio" label="About you"><textarea id="f-bio" rows={3} maxLength={500} value={f.bio} onChange={set('bio')} placeholder="What makes you a good Mentor or Learner?" /></Field>
    <div className="filters">
      <Field id="f-age" label="Age"><input id="f-age" type="number" min={13} max={120} value={f.age} onChange={set('age')} /></Field>
      <Field id="f-loc" label="Location"><input id="f-loc" value={f.location} onChange={set('location')} placeholder="City, Country" /></Field>
      <Field id="f-tz" label="Time zone"><input id="f-tz" value={f.timezone} onChange={set('timezone')} /></Field>
    </div>
  </div>;
}

export function LearnSection({ f, setF }) {
  const skills = useSkills(); const byId = Object.fromEntries(skills.map((s) => [s.id, s]));
  const toggle = (id) => setF((s) => { const l = { ...s.learner }; if (l[id]) delete l[id]; else l[id] = { currentLevel: 'none', desiredLevel: '', prefers: 'either', maxRupees: '', learningStyle: 'one_on_one' }; return { ...s, learner: l }; });
  const patch = (id, k, v) => setF((s) => ({ ...s, learner: { ...s.learner, [id]: { ...s.learner[id], [k]: v } } }));
  return <div className="stack">
    <SkillPicker skills={skills} selected={Object.keys(f.learner)} onToggle={toggle} />
    {Object.entries(f.learner).map(([id, s]) => <div className="skill-row" key={id}>
      <strong><span className="tag learner">Learning</span> {byId[id]?.name}</strong>
      <Field id={`l-cl${id}`} label="Your level now">{sel(s.currentLevel, (v) => patch(id, 'currentLevel', v), [['none', 'Complete beginner'], ...lvlOpts.slice(0, 3)])}</Field>
      <Field id={`l-dl${id}`} label="Level you want to reach">{sel(s.desiredLevel, (v) => patch(id, 'desiredLevel', v), [['', 'No target'], ...lvlOpts])}</Field>
      <Field id={`l-pf${id}`} label="Free or paid?">{sel(s.prefers, (v) => patch(id, 'prefers', v), [['free', 'Free only'], ['paid', 'Happy to pay'], ['either', 'Either']])}</Field>
      {s.prefers !== 'free' && <Field id={`l-mx${id}`} label="Max budget per session (₹)"><input type="number" min={0} value={s.maxRupees} onChange={(e) => patch(id, 'maxRupees', e.target.value)} /></Field>}
      <Field id={`l-st${id}`} label="Preferred style">{sel(s.learningStyle, (v) => patch(id, 'learningStyle', v), styleOpts)}</Field>
    </div>)}
  </div>;
}

export function MentorSection({ f, setF }) {
  const skills = useSkills(); const byId = Object.fromEntries(skills.map((s) => [s.id, s]));
  const toggle = (id) => setF((s) => { const m = { ...s.mentor }; if (m[id]) delete m[id]; else m[id] = { level: 'intermediate', yearsExperience: '', pricing: 'free', minRupees: '', maxRupees: '', teachingStyle: 'one_on_one' }; return { ...s, mentor: m }; });
  const patch = (id, k, v) => setF((s) => ({ ...s, mentor: { ...s.mentor, [id]: { ...s.mentor[id], [k]: v } } }));
  return <div className="stack">
    <SkillPicker skills={skills} selected={Object.keys(f.mentor)} onToggle={toggle} />
    {Object.entries(f.mentor).map(([id, s]) => <div className="skill-row" key={id}>
      <strong><span className="tag mentor">Mentoring</span> {byId[id]?.name}</strong>
      <Field id={`m-lv${id}`} label="Your proficiency">{sel(s.level, (v) => patch(id, 'level', v), lvlOpts)}</Field>
      <Field id={`m-ye${id}`} label="Years of experience"><input type="number" min={0} max={80} value={s.yearsExperience} onChange={(e) => patch(id, 'yearsExperience', e.target.value)} /></Field>
      <Field id={`m-pr${id}`} label="Mentoring">{sel(s.pricing, (v) => patch(id, 'pricing', v), [['free', 'For free'], ['paid', 'For payment'], ['both', 'Free or paid']])}</Field>
      {s.pricing !== 'free' && <><Field id={`m-mn${id}`} label="Min price / session (₹)"><input type="number" min={0} value={s.minRupees} onChange={(e) => patch(id, 'minRupees', e.target.value)} /></Field>
        <Field id={`m-mx${id}`} label="Max price / session (₹)" hint={s.minRupees !== '' && s.maxRupees !== '' && +s.minRupees > +s.maxRupees ? 'Max must be at least the minimum' : ''} hintKind="err"><input type="number" min={0} value={s.maxRupees} onChange={(e) => patch(id, 'maxRupees', e.target.value)} /></Field></>}
      <Field id={`m-st${id}`} label="Teaching style">{sel(s.teachingStyle, (v) => patch(id, 'teachingStyle', v), styleOpts)}</Field>
    </div>)}
  </div>;
}

export function WhenSection({ f, setF }) {
  const toggleSlot = (k) => setF((s) => { const n = new Set(s.slots); n.has(k) ? n.delete(k) : n.add(k); return { ...s, slots: n }; });
  const toggleLang = (l) => setF((s) => ({ ...s, languages: s.languages.includes(l) ? s.languages.filter((x) => x !== l) : [...s.languages, l] }));
  return <div className="stack">
    <div><h3>When are you free?</h3><div className="slots" role="group" aria-label="Weekly availability">
      <span />{Object.values(PARTS).map(([, , l]) => <strong key={l} className="hint">{l}</strong>)}
      {DAYS.map((d, i) => [<strong key={d}>{d}</strong>, ...Object.keys(PARTS).map((p) => <button type="button" key={`${i}-${p}`} className="chip" aria-label={`${d} ${p}`} aria-pressed={f.slots.has(`${i}-${p}`)} onClick={() => toggleSlot(`${i}-${p}`)}>{f.slots.has(`${i}-${p}`) ? '✓' : '·'}</button>)])}
    </div></div>
    <div><h3>Languages you speak</h3><div className="row">{LANGUAGES.map((l) => <button type="button" key={l} className="chip" aria-pressed={f.languages.includes(l)} onClick={() => toggleLang(l)}>{l}</button>)}</div></div>
  </div>;
}

// Mirrors server prefs/profile schemas (server/src/people/routes.js): HTML min/max on number inputs isn't enforced without a form submit.
const intIn = (v, lo, hi) => v === '' || (Number.isInteger(+v) && +v >= lo && +v <= hi);
export function validatePrefs(f) {
  for (const s of Object.values(f.mentor)) {
    if (s.pricing !== 'free' && (s.minRupees === '' || s.maxRupees === '' || +s.minRupees < 0 || +s.minRupees > +s.maxRupees)) return 'Set a valid price range (min ≤ max) for each paid skill.';
    if (!intIn(s.yearsExperience, 0, 80)) return 'Years of experience must be a whole number from 0 to 80.';
  }
  for (const s of Object.values(f.learner)) if (s.prefers !== 'free' && s.maxRupees !== '' && +s.maxRupees < 0) return 'Max budget can’t be negative.';
  if (!f.fullName.trim()) return 'Please enter your name.';
  if (f.fullName.trim().length > 100) return 'Name can be at most 100 characters.';
  if (!intIn(f.age, 13, 120)) return 'Age must be a whole number from 13 to 120.';
  if (f.location.trim().length > 100) return 'Location can be at most 100 characters.';
  return '';
}
