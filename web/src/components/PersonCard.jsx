import { useState } from 'react';
import { Link } from 'react-router-dom';
import { priceLabel, DAYS } from '../lib.js';
import { ConnectButton } from '../social.jsx';
import { coverOf } from '../cover.js';
import './person.css';

/* A CD jewel case. Front: typographic cover with the details printed on it. Back (flip): the tracklist.
   The disc slides out of the side on hover. Cover colour and catalogue number come from the username, so each person is stable. */
export default function PersonCard({ u, role = 'mentor', dim }) {
  const [flip, setFlip] = useState(false);
  const { bg, cat } = coverOf(u.username);
  const days = [...new Set((u.availability || []).map((s) => s.weekday))].sort().map((d) => DAYS[d]).join(' ');
  const skills = u.matchedSkills || (role === 'mentor' ? u.mentorSkills : u.learnerSkills).map((s) => s.skill);
  const why = u.reasons || [];
  const inert = (on) => (on ? { inert: true } : {}); // React 19 takes a real boolean
  return (
    <div className={`cd person${dim ? ' dim' : ''}${flip ? ' flipped' : ''}`} style={{ '--cover': bg }}>
      <div className="cd-disc" aria-hidden="true" />
      <div className="cd-case">
        <section className={`cd-face cd-front${u.avatarUrl ? ' has-photo' : ''}`} style={u.avatarUrl ? { '--photo': `url(${u.avatarUrl})` } : undefined} aria-label={`${u.fullName}, front cover`} {...inert(flip)}>
          <div className="cd-spine" aria-hidden="true"><span>{u.username} · {cat}</span></div>
          <div className="cd-art">
            <div className="cd-top"><span>SkillSwap Records</span><span>{cat}</span></div>
            <div className="cd-initial" aria-hidden="true">{u.fullName[0]}</div>
            {u.score != null && <div className="cd-sticker" title="Compatibility with your profile"><b>{u.score}%</b><span>match</span></div>}
            <div className="cd-title">
              <h3><Link to={`/u/${u.username}`}>{u.fullName}</Link></h3>
              <p>{skills.slice(0, 3).join(' / ')}{skills.length > 3 ? ` +${skills.length - 3}` : ''}</p>
            </div>
            <div className="cd-strip">
              <ConnectButton username={u.username} />
              <button className="cd-flip" onClick={() => setFlip(true)} aria-label={`Back cover for ${u.fullName}`}>Tracklist ↻</button>
            </div>
          </div>
        </section>
        <section className="cd-face cd-back" aria-label={`${u.fullName}, back cover`} {...inert(!flip)}>
          <div className="cd-top"><span>Tracklist</span><span>{cat}</span></div>
          <ol>{why.slice(0, 5).map((r, i) => <li key={r}><span>{String(i + 1).padStart(2, '0')}</span>{r}</li>)}</ol>
          <dl>
            {u.offer && <><dt>Price</dt><dd>{u.offer.skill ? `${u.offer.skill}: ` : ''}{priceLabel(u.offer)}</dd></>}
            <dt>Rating</dt><dd>{u.rating?.count ? `★ ${u.rating.avg.toFixed(1)} (${u.rating.count})` : 'No reviews yet'}</dd>
            {days && <><dt>Free</dt><dd>{days}</dd></>}
            {u.languages?.length > 0 && <><dt>Languages</dt><dd>{u.languages.join(', ')}</dd></>}
          </dl>
          <div className="cd-strip"><Link className="btn small ghost" to={`/u/${u.username}`}>View profile</Link><button className="cd-flip" onClick={() => setFlip(false)}>Front ↻</button></div>
        </section>
      </div>
    </div>
  );
}
