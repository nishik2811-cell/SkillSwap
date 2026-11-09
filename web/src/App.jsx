import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { SocialProvider } from './social.jsx';
import Wallet from './pages/Wallet.jsx';
import Receipt from './pages/Receipt.jsx';
import Meetings from './pages/Meetings.jsx';
import Room from './pages/Room.jsx';
import Sessions from './pages/Sessions.jsx';
import SessionNew from './pages/SessionNew.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import Messages from './pages/Messages.jsx';
import Connections from './pages/Connections.jsx';
import Notifications from './pages/Notifications.jsx';
import { Nav } from './components/UI.jsx';
import Landing from './pages/Landing.jsx';
import { Register, Login, VerifyEmail, ForgotPassword, ResetPassword } from './pages/AuthPages.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Discover from './pages/Discover.jsx';
import Profile from './pages/Profile.jsx';
import Settings from './pages/Settings.jsx';
import Admin from './pages/Admin.jsx';

function Protected({ children }) {
  const { user } = useAuth(); const loc = useLocation();
  if (user === undefined) return <div className="center"><p>Loading…</p></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.onboardingDone && loc.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return children;
}
// the server enforces admin on every /admin API call; this only hides the page from everyone else
function AdminOnly({ children }) { const { user } = useAuth(); return user?.role === 'admin' ? children : <div className="center"><h2>Page not found</h2></div>; }
const P = (el) => <Protected>{el}</Protected>;

export default function App() {
  return <BrowserRouter><AuthProvider><SocialProvider><Nav /><Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/register" element={<Register />} /><Route path="/login" element={<Login />} />
    <Route path="/verify-email" element={<VerifyEmail />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/onboarding" element={P(<Onboarding />)} /><Route path="/dashboard" element={P(<Dashboard />)} />
    <Route path="/discover" element={P(<Discover />)} /><Route path="/u/:username" element={P(<Profile />)} /><Route path="/wallet" element={P(<Wallet />)} /><Route path="/receipts/:id" element={P(<Receipt />)} /><Route path="/meetings" element={P(<Meetings />)} /><Route path="/room/:code" element={P(<Room />)} /><Route path="/sessions" element={P(<Sessions />)} /><Route path="/sessions/new" element={P(<SessionNew />)} /><Route path="/sessions/:id" element={P(<SessionDetail />)} /><Route path="/messages" element={P(<Messages />)} /><Route path="/messages/:id" element={P(<Messages />)} /><Route path="/connections" element={P(<Connections />)} /><Route path="/notifications" element={P(<Notifications />)} /><Route path="/settings" element={P(<Settings />)} />
    <Route path="/admin" element={P(<AdminOnly><Admin /></AdminOnly>)} />
    <Route path="*" element={<div className="center"><h2>Page not found</h2></div>} />
  </Routes></SocialProvider></AuthProvider></BrowserRouter>;
}
