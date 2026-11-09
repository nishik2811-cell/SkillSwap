import { coverOf } from '../cover.js';
import { useSkills } from '../lib.js';
import './person.css';

/* A live CD cover that fills in as the form is filled in: your name, your mentor skills as the subtitle, track count on the sticker. */
export default function CoverPreview({ f, username }) {
  const skills = useSkills();
  const byId = Object.fromEntries(skills.map((s) => [String(s.id), s.name]));
  const mentor = Object.keys(f.mentor).map((id) => byId[id]).filter(Boolean);
  const learn = Object.keys(f.learner).length;
  const name = f.fullName.trim() || 'Your name';
  const { bg, cat } = coverOf(username || 'new');
  return (
    <div className="cd cd-preview" style={{ '--cover': bg }} role="img" aria-label={`Preview of your cover: ${name}`}>
      <div className="cd-disc" aria-hidden="true" />
      <div className="cd-case"><section className={`cd-face cd-front${f.avatarUrl ? ' has-photo' : ''}`} style={f.avatarUrl ? { '--photo': `url(${f.avatarUrl})` } : undefined}>
        <div className="cd-spine" aria-hidden="true"><span>{username || 'you'} · {cat}</span></div>
        <div className="cd-art">
          <div className="cd-top"><span>SkillSwap Records</span><span>{cat}</span></div>
          <div className="cd-initial" aria-hidden="true">{name[0]}</div>
          <div className="cd-sticker"><b>{mentor.length + learn}</b><span>tracks</span></div>
          <div className="cd-title"><h3>{name}</h3><p>{mentor.length ? mentor.slice(0, 3).join(' / ') : 'Add what you can mentor'}</p></div>
          <div className="cd-strip"><span className="cd-note">Side A · {mentor.length} mentor · Side B · {learn} learn</span></div>
        </div>
      </section></div>
    </div>
  );
}
