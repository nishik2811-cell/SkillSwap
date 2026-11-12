import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { SocialProvider } from './social.jsx';
const Wallet = lazy(() => import('./pages/Wallet.jsx'));
const Receipt = lazy(() => import('./pages/Receipt.jsx'));
const Meetings = lazy(() => import('./pages/Meetings.jsx'));
const Room = lazy(() => import('./pages/Room.jsx'));
const Sessions = lazy(() => import('./pages/Sessions.jsx'));
const SessionNew = lazy(() => import('./pages/SessionNew.jsx'));
const SessionDetail = lazy(() => import('./pages/SessionDetail.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const Connections = lazy(() => import('./pages/Connections.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
import { Nav } from './components/UI.jsx';
const Landing = lazy(() => import('./pages/Landing.jsx'));
import { Register, Login, ChooseId, VerifyEmail, ForgotPassword, ResetPassword } from './pages/AuthPages.jsx';
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Discover = lazy(() => import('./pages/Discover.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
import { Terms, Privacy, Refunds, Contact } from './pages/Legal.jsx';

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
  return <BrowserRouter><AuthProvider><SocialProvider><Nav /><Suspense fallback={<div className="center"><p>Loading…</p></div>}><Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/register" element={<Register />} /><Route path="/login" element={<Login />} /><Route path="/choose-id" element={<ChooseId />} />
    <Route path="/verify-email" element={<VerifyEmail />} /><Route path="/forgot-password" element={<ForgotPassword />} /><Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/onboarding" element={P(<Onboarding />)} /><Route path="/dashboard" element={P(<Dashboard />)} />
    <Route path="/discover" element={P(<Discover />)} /><Route path="/u/:username" element={P(<Profile />)} /><Route path="/wallet" element={P(<Wallet />)} /><Route path="/receipts/:id" element={P(<Receipt />)} /><Route path="/meetings" element={P(<Meetings />)} /><Route path="/room/:code" element={P(<Room />)} /><Route path="/sessions" element={P(<Sessions />)} /><Route path="/sessions/new" element={P(<SessionNew />)} /><Route path="/sessions/:id" element={P(<SessionDetail />)} /><Route path="/messages" element={P(<Messages />)} /><Route path="/messages/:id" element={P(<Messages />)} /><Route path="/connections" element={P(<Connections />)} /><Route path="/notifications" element={P(<Notifications />)} /><Route path="/settings" element={P(<Settings />)} />
    <Route path="/admin" element={P(<AdminOnly><Admin /></AdminOnly>)} />
    <Route path="/terms" element={<Terms />} /><Route path="/privacy" element={<Privacy />} /><Route path="/refunds" element={<Refunds />} /><Route path="/contact" element={<Contact />} />
    <Route path="*" element={<div className="center"><h2>Page not found</h2></div>} />
  </Routes></Suspense></SocialProvider></AuthProvider></BrowserRouter>;
}
