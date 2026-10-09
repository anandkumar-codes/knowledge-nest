import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { LogoMark } from './Logo.jsx';
import {
  CalendarIcon, CardIcon, ChartIcon, CrownIcon, GridIcon, KeyIcon, LogoutIcon, MenuIcon, SeatIcon, UsersIcon,
} from './Icons.jsx';

// `perm` = any-of permissions needed to see the item; `superOnly` items are for the super admin. `soon` items are placeholders for upcoming modules.
const NAV = [
  { section: 'Overview' },
  { to: '/admin/dashboard', label: 'Dashboard', icon: GridIcon },
  { section: 'Reading room' },
  { to: '/admin/seats', label: 'Seats', icon: SeatIcon, perm: ['seats.view', 'seats.manage'] },
  { to: '/admin/members', label: 'Members', icon: UsersIcon, perm: ['members.view', 'members.manage'] },
  { to: '/admin/bookings', label: 'Bookings & shifts', icon: CalendarIcon, perm: ['bookings.view', 'bookings.manage'] },
  { to: '/admin/payments', label: 'Payments', icon: CardIcon, perm: ['payments.view', 'payments.manage'] },
  { to: '/admin/reports', label: 'Reports', icon: ChartIcon, perm: ['reports.view'] },
  { section: 'Administration' },
  { to: '/admin/team', label: 'Team', icon: UsersIcon, perm: ['team.view', 'team.manage'] },
  { to: '/admin/roles', label: 'Roles & access', icon: KeyIcon, perm: ['team.view', 'team.manage', 'roles.manage'] },
  { to: '/admin/settings/payments', label: 'Payment settings', icon: CardIcon, superOnly: true },
];

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export default function AdminLayout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  // Drop section headers whose items are all hidden.
  const visible = NAV.filter(
    (item) => item.section || (item.superOnly ? user.isSuperAdmin : !item.perm || can(...item.perm))
  );
  const items = visible.filter((item, i) => !item.section || (visible[i + 1] && !visible[i + 1].section));

  return (
    <div className={`shell${open ? ' nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <LogoMark size={36} bg="#c9bf9e" fg="#1d5470" />
          <div>
            <div className="sidebar-name">Knowledge <em>Nest</em></div>
            <div className="sidebar-tag">Admin console</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {items.map((item, i) =>
            item.section ? (
              <div key={i} className="nav-section">{item.section}</div>
            ) : item.soon ? (
              <span key={i} className="nav-item disabled" title="Coming soon">
                <item.icon /> {item.label} <span className="soon">Soon</span>
              </span>
            ) : (
              <NavLink key={i} to={item.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <item.icon /> {item.label}
              </NavLink>
            )
          )}
        </nav>

        <div className="sidebar-user">
          <NavLink to="/admin/account" className="sidebar-account" title="My account">
            <span className="avatar avatar-sand">{initials(user.name)}</span>
            <span className="sidebar-user-text">
              <strong>{user.name}</strong>
              <span>
                {user.isSuperAdmin ? <><CrownIcon width={12} height={12} /> Super admin</> : user.role?.name}
              </span>
            </span>
          </NavLink>
          <button
            className="icon-btn sidebar-logout"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => {
              logout();
              navigate('/admin/login');
            }}
          >
            <LogoutIcon />
          </button>
        </div>
      </aside>

      <div className="sidebar-scrim" onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon />
          </button>
          <LogoMark size={30} />
          <span className="topbar-name">Knowledge <em>Nest</em></span>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
