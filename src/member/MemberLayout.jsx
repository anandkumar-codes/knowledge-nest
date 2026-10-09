import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useMember } from './MemberAuth.jsx';
import { changeMemberPassword } from '../api/memberPortal.js';
import { LogoMark } from '../components/Logo.jsx';
import PasswordForm from '../components/PasswordForm.jsx';
import Logo from '../components/Logo.jsx';
import { useToast } from '../components/Toast.jsx';
import { CardIcon, GridIcon, LogoutIcon, UsersIcon } from '../components/Icons.jsx';
import '../styles/memberPortal.css';

const NAV = [
  { to: '/member', label: 'Home', icon: GridIcon, end: true },
  { to: '/member/payments', label: 'Payments', icon: CardIcon },
  { to: '/member/profile', label: 'Profile', icon: UsersIcon },
];

export default function MemberLayout() {
  const { member, portal, loading, error, logout, setMember } = useMember();
  const navigate = useNavigate();
  const toast = useToast();

  if (loading) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;
  if (!member) {
    return error ? <div className="page"><div className="alert">{error}</div></div> : <Navigate to="/member/login" replace />;
  }

  const signOut = () => {
    logout();
    navigate('/member/login');
  };

  // The front desk set this password: replace it before anything else (the API enforces this too).
  if (member.mustChangePassword) {
    return (
      <main className="standalone">
        <div className="standalone-card">
          <Logo tone="dark" size={40} tagline="Member portal" />
          <h1>Choose your password</h1>
          <p className="standalone-sub">
            Hi {member.name.split(' ')[0]}, the front desk gave you a one-time password. Pick one only you know.
          </p>
          <PasswordForm
            currentLabel="One-time password"
            submitLabel="Save and continue"
            changeFn={changeMemberPassword}
            onDone={(s) => {
              setMember(s);
              toast('Password saved. Welcome to Knowledge Nest!');
            }}
          />
          <button type="button" className="link standalone-signout" onClick={signOut}>Not you? Sign out</button>
        </div>
      </main>
    );
  }

  const due = portal.bookings.reduce((t, b) => t + Math.max(b.balance, 0), 0);

  return (
    <div className="member-shell">
      <header className="member-top">
        <div className="member-top-inner">
          <div className="member-brand">
            <LogoMark size={34} bg="#c9bf9e" fg="#1d5470" />
            <span className="member-brand-text">
              <span>Knowledge <em>Nest</em></span>
              <small>Member portal</small>
            </span>
          </div>
          <nav className="member-nav" aria-label="Member portal">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `member-nav-item${isActive ? ' active' : ''}`}>
                <n.icon width={18} height={18} />
                <span>{n.label}</span>
                {n.label === 'Payments' && due > 0 && <i className="nav-dot" aria-label="Payment due" />}
              </NavLink>
            ))}
          </nav>
          <div className="member-user">
            <span className="member-user-name">{member.name}</span>
            <button className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out"><LogoutIcon /></button>
          </div>
        </div>
      </header>
      <main className="member-main">
        <Outlet />
      </main>
    </div>
  );
}
