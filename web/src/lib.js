import { useEffect, useState } from 'react';
import { api } from './api.js';

export const LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'];
export const STYLES = { one_on_one: 'One-on-one', group: 'Group', workshop: 'Workshop', interactive: 'Interactive' };
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const PARTS = { morning: ['08:00', '12:00', 'Morning'], afternoon: ['12:00', '17:00', 'Afternoon'], evening: ['17:00', '21:00', 'Evening'] };
export const LANGUAGES = ['English', 'Hindi', 'Spanish', 'French', 'German', 'Tamil', 'Bengali', 'Marathi', 'Punjabi', 'Japanese'];
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function priceLabel(o) {
  if (!o) return '';
  if (o.pricing === 'free') return 'Free';
  const range = o.priceMinPaise === o.priceMaxPaise ? rupees(o.priceMinPaise) : `${rupees(o.priceMinPaise)}–${rupees(o.priceMaxPaise)}`;
  return o.pricing === 'both' ? `Free or ${range} / session` : `${range} / session`;
}

let skillsCache;
export function useSkills() {
  const [skills, setSkills] = useState(skillsCache || []);
  useEffect(() => { if (!skillsCache) api('/skills').then((r) => { skillsCache = r.skills; setSkills(r.skills); }).catch(() => {}); }, []);
  return skills;
}

export const sessionGet = (k, d) => { try { return sessionStorage.getItem(k) ?? d; } catch { return d; } };
export const sessionSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* storage unavailable: fine */ } };

// ---- preference form state <-> API payload ----
export function fromProfile(p) {
  const slots = new Set();
  for (const s of p.availability || []) for (const [k, [a, b]] of Object.entries(PARTS)) if (s.start === a && s.end === b) slots.add(`${s.weekday}-${k}`);
  return {
    fullName: p.fullName || '', bio: p.bio || '', age: p.age ?? '', location: p.location || '', timezone: p.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    learner: Object.fromEntries((p.learnerSkills || []).map((s) => [s.skillId, { currentLevel: s.currentLevel, desiredLevel: s.desiredLevel || '', prefers: s.prefers, maxRupees: s.maxPricePaise == null ? '' : s.maxPricePaise / 100, learningStyle: s.learningStyle }])),
    mentor: Object.fromEntries((p.mentorSkills || []).map((s) => [s.skillId, { level: s.level, yearsExperience: s.yearsExperience ?? '', pricing: s.pricing, minRupees: s.priceMinPaise == null ? '' : s.priceMinPaise / 100, maxRupees: s.priceMaxPaise == null ? '' : s.priceMaxPaise / 100, teachingStyle: s.teachingStyle }])),
    slots, languages: p.languages || [], avatarUrl: p.avatarUrl || null,
  };
}
const toPaise = (v) => Math.round(Number(v) * 100);
export function toPayloads(f, finish) {
  return {
    profile: { fullName: f.fullName.trim(), bio: f.bio.trim() || null, age: f.age === '' ? null : Number(f.age), location: f.location.trim() || null, timezone: f.timezone || null },
    prefs: {
      learnerSkills: Object.entries(f.learner).map(([id, s]) => ({ skillId: +id, currentLevel: s.currentLevel, desiredLevel: s.desiredLevel || null, prefers: s.prefers, maxPricePaise: s.prefers !== 'free' && s.maxRupees !== '' ? toPaise(s.maxRupees) : null, learningStyle: s.learningStyle })),
      mentorSkills: Object.entries(f.mentor).map(([id, s]) => ({ skillId: +id, level: s.level, yearsExperience: s.yearsExperience === '' ? null : Number(s.yearsExperience), pricing: s.pricing, priceMinPaise: s.pricing === 'free' ? null : toPaise(s.minRupees || 0), priceMaxPaise: s.pricing === 'free' ? null : toPaise(s.maxRupees || s.minRupees || 0), teachingStyle: s.teachingStyle })),
      availability: [...f.slots].map((k) => { const [d, part] = k.split('-'); return { weekday: +d, start: PARTS[part][0], end: PARTS[part][1] }; }),
      languages: f.languages, finishOnboarding: !!finish,
    },
  };
}
