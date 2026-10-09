import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { listPermissions, listRoles, listUsers } from '../api/team.js';
import { getHall, shiftsOn } from '../api/seats.js';
import { inr, listPayments } from '../api/payments.js';
import { CardIcon, CrownIcon, KeyIcon, SeatIcon, UsersIcon } from '../components/Icons.jsx';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { user, can } = useAuth();
  const [stats, setStats] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const canSeeTeam = can('team.view', 'team.manage');
  const canSeeSeats = can('seats.view', 'seats.manage');
  const [seatStats, setSeatStats] = useState(null);
  const canSeePayments = can('payments.view', 'payments.manage');
  const [money, setMoney] = useState(null);

  useEffect(() => {
    if (!canSeePayments) return;
    listPayments().then((d) => setMoney(d.stats)).catch(() => {});
  }, [canSeePayments]);

  useEffect(() => {
    if (!canSeeSeats) return;
    getHall()
      .then(({ seats, today, capacity }) => {
        const held = seats.map((s) => shiftsOn(s, today));
        setSeatStats({
          capacity,
          inUse: held.filter((h) => h.morning || h.evening).length,
          free: seats.filter((s, i) => s.status === 'active' && !held[i].morning && !held[i].evening).length,
        });
      })
      .catch(() => {});
  }, [canSeeSeats]);

  useEffect(() => {
    listPermissions().then(setCatalog).catch(() => {});
    if (!canSeeTeam) return;
    Promise.all([listUsers(), listRoles()])
      .then(([users, roles]) =>
        setStats({
          members: users.length,
          active: users.filter((u) => u.status === 'active').length,
          roles: roles.length,
        })
      )
      .catch(() => {});
  }, [canSeeTeam]);

  const groups = catalog.reduce((acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{greeting()}, {user.name.split(' ')[0]}</h1>
          <p className="page-sub">
            {user.isSuperAdmin ? (
              <><CrownIcon width={14} height={14} /> You're the super admin, with full access to Knowledge Nest.</>
            ) : (
              <>You're signed in as <strong>{user.role?.name}</strong>.</>
            )}
          </p>
        </div>
      </header>

      {(canSeeTeam || canSeeSeats || canSeePayments) && (
        <div className="stat-row">
          {canSeeSeats && (
            <Link to="/admin/seats" className="stat-card">
              <span className="stat-icon"><SeatIcon /></span>
              <span className="stat-label">Seats in use today</span>
              <span className="stat-value">{seatStats ? `${seatStats.inUse} / ${seatStats.capacity}` : '–'}</span>
              <span className="stat-foot">{seatStats ? `${seatStats.free} completely free` : ' '}</span>
            </Link>
          )}
          {canSeePayments && (
            <Link to="/admin/payments" className="stat-card">
              <span className="stat-icon"><CardIcon /></span>
              <span className="stat-label">Collected today</span>
              <span className="stat-value">{money ? inr(money.today) : '–'}</span>
              <span className="stat-foot">{money ? `${inr(money.outstanding)} outstanding` : ' '}</span>
            </Link>
          )}
          {canSeeTeam && (
            <>
              <Link to="/admin/team" className="stat-card">
                <span className="stat-icon"><UsersIcon /></span>
                <span className="stat-label">Team members</span>
                <span className="stat-value">{stats?.members ?? '–'}</span>
                <span className="stat-foot">{stats ? `${stats.active} active` : ' '}</span>
              </Link>
              <Link to="/admin/roles" className="stat-card">
                <span className="stat-icon"><KeyIcon /></span>
                <span className="stat-label">Roles</span>
                <span className="stat-value">{stats?.roles ?? '–'}</span>
                <span className="stat-foot">plus super admin</span>
              </Link>
            </>
          )}
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Your access</h2>
          <p>What your {user.isSuperAdmin ? 'account' : 'role'} can do in this reading room.</p>
        </div>
        <div className="access-grid">
          {Object.entries(groups).map(([group, perms]) => (
            <div key={group} className="access-group">
              <h3>{group}</h3>
              <ul>
                {perms.map((p) => {
                  const has = user.permissions.includes(p.key);
                  return (
                    <li key={p.key} className={has ? 'yes' : 'no'}>
                      <span className="tick" aria-hidden="true">{has ? '✓' : '–'}</span>
                      {p.label}
                      <span className="sr-only">{has ? '(allowed)' : '(not allowed)'}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
