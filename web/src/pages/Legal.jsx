import { Link } from 'react-router-dom';
import './legal.css';

// One place for the public contact address: set VITE_SUPPORT_EMAIL in Vercel (and .env for local) and every page picks it up.
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || '';
const UPDATED = '11 November 2026';
const Mail = () => (SUPPORT_EMAIL ? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> : <Link to="/contact">our Contact page</Link>);

function Doc({ title, children }) {
  return <main className="legal">
    <p className="legal-kicker">SkillSwap · Last updated {UPDATED}</p>
    <h1>{title}</h1>
    {children}
    <nav className="legal-links" aria-label="Policies"><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/refunds">Refunds &amp; cancellations</Link><Link to="/contact">Contact</Link></nav>
  </main>;
}

export function Terms() {
  return <Doc title="Terms of use">
    <p>SkillSwap is a place where people teach what they know and learn from each other. Everyone can be a Mentor, a Learner, or both. By creating an account you agree to these terms.</p>
    <h2>Your account</h2>
    <ul>
      <li>Give accurate details and keep your password private. You are responsible for what happens on your account.</li>
      <li>You must be at least 18, or have a parent's or guardian's permission, to use SkillSwap and to make payments.</li>
      <li>One account per person. Your User ID is public and unique.</li>
    </ul>
    <h2>How sessions work</h2>
    <ul>
      <li>Mentors create Learning Sessions: free, paid, or as a skill swap. Mentors decide what they teach and are responsible for its quality and accuracy.</li>
      <li>Learners book seats. Some sessions confirm instantly; others need the Mentor to accept.</li>
      <li>Sessions take place in SkillSwap's built-in video rooms or however the two of you agree.</li>
    </ul>
    <h2>Payments and fees</h2>
    <ul>
      <li>Payments are processed by Razorpay. SkillSwap never sees or stores your card or UPI PIN details.</li>
      <li>The price is shown before you pay. SkillSwap keeps a platform fee (currently 10%) and the rest goes to the Mentor.</li>
      <li>Mentors are paid out to the payout details they save in Settings, after the session has taken place.</li>
      <li>Refunds follow our <Link to="/refunds">Refunds &amp; cancellations policy</Link>.</li>
    </ul>
    <h2>Behaving well</h2>
    <p>Be respectful. No harassment, hate, spam, scams, illegal content, or sharing other people's private information. Don't use SkillSwap to arrange payments outside the platform to avoid fees or refunds. You can block or report anyone, and we review reports.</p>
    <h2>Suspension</h2>
    <p>We may suspend or close accounts that break these terms or put others at risk. If that stops a paid session from happening, the Learner can open a dispute and we will refund them.</p>
    <h2>Limits</h2>
    <p>SkillSwap connects people and provides the tools; we do not guarantee any particular result from a session. To the extent the law allows, our liability for any claim is limited to the amount you paid for the session concerned.</p>
    <h2>Changes</h2>
    <p>We may update these terms. If the change is significant we will tell you in the app before it applies. These terms are governed by the laws of India.</p>
    <p>Questions? Write to <Mail />.</p>
  </Doc>;
}

export function Privacy() {
  return <Doc title="Privacy policy">
    <p>This explains what SkillSwap collects, why, and what you can do about it. We don't sell your data and we don't show ads.</p>
    <h2>What we collect</h2>
    <ul>
      <li><b>Account:</b> your name, email, User ID and a securely hashed password (or your Google account's name and email if you sign in with Google).</li>
      <li><b>Profile:</b> what you add yourself, such as bio, photo, location, languages, availability and the skills you teach and want to learn.</li>
      <li><b>Activity:</b> connections, chat messages and files you send, sessions you create or book, reviews and reports.</li>
      <li><b>Payments:</b> amounts and Razorpay order and payment IDs. Card and UPI details are handled by Razorpay, not by us.</li>
      <li><b>Payout details:</b> if you are a Mentor and add them, your UPI ID or bank account, used only to send you your earnings.</li>
      <li><b>Technical:</b> one login cookie to keep you signed in, and your IP address for security and rate limiting.</li>
    </ul>
    <h2>Who can see what</h2>
    <ul>
      <li>Your public profile (name, User ID, photo, bio, skills, location and availability) is visible to other members. Your email, age and payout details are not.</li>
      <li>Chat messages are visible to the people in that chat. Your online status is visible only to people you chat with.</li>
      <li>SkillSwap administrators can see what they need to run the service, such as reports, payments and payout requests.</li>
    </ul>
    <h2>Services we use</h2>
    <p>Hosting and database (Vercel, Render, Neon), email delivery (Brevo), video rooms (LiveKit), payments (Razorpay) and optional Google sign-in. Each receives only what it needs to do its job.</p>
    <h2>Your choices</h2>
    <ul>
      <li>Edit your profile and payout details any time in Settings.</li>
      <li>Delete your account any time from Settings: we email you a code to confirm it. Your profile and personal details are removed straight away; payment records are kept as the law requires.</li>
      <li>For a copy of your data, write to <Mail />.</li>
    </ul>
    <h2>Cookies</h2>
    <p>We use a single essential cookie to keep you logged in. No advertising or tracking cookies.</p>
  </Doc>;
}

export function Refunds() {
  return <Doc title="Refunds & cancellations">
    <p>These rules apply to paid Learning Sessions. Refunds are automatic in the cases below; you don't need to ask.</p>
    <h2>If you are the Learner</h2>
    <ul>
      <li><b>Cancel at least 24 hours before the start:</b> full refund.</li>
      <li><b>Cancel less than 24 hours before the start:</b> no automatic refund, because the Mentor has kept that time for you.</li>
      <li><b>Booking not paid in time:</b> an accepted booking that stays unpaid is released and nothing is charged.</li>
    </ul>
    <h2>If the Mentor cancels</h2>
    <ul>
      <li>If the Mentor cancels the session, declines your booking, or removes you, you get a full refund.</li>
    </ul>
    <h2>Something went wrong?</h2>
    <p>If the session didn't happen as described, open a dispute from your receipt in Wallet, or write to <Mail />. A person reviews every dispute and can issue a refund outside the rules above.</p>
    <h2>How refunds are paid</h2>
    <p>Refunds go back to the original payment method through Razorpay. Banks usually take 5 to 7 working days to show them. You can follow each refund's status in Wallet.</p>
    <h2>Rescheduling</h2>
    <p>If a Mentor moves a session, you are told in the app. If the new time doesn't suit you, cancel and the timing rules above apply from the new start time; if you cancel because of the change, write to us and we will refund you in full.</p>
  </Doc>;
}

export function Contact() {
  return <Doc title="Contact us">
    <p>We're a small team and read every message.</p>
    {SUPPORT_EMAIL && <p className="legal-big">Email: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>}
    <ul>
      <li><b>Problem with a payment:</b> open a dispute from the receipt in your Wallet{SUPPORT_EMAIL ? ', or email us' : ''}.</li>
      <li><b>Someone behaving badly:</b> use Report on their profile or session. You can also block them.</li>
      <li><b>Account or privacy requests:</b> {SUPPORT_EMAIL ? <>email us from the address on your account.</> : <>use Report, and we will get back to you.</>}</li>
    </ul>
    <p>We aim to reply within 2 working days.</p>
  </Doc>;
}
