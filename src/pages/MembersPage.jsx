import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { listMembers, standing } from '../api/members.js';
import { fmtDate, fmtShort } from '../api/seats.js';
import { initials } from '../components/AdminLayout.jsx';
import MemberFormModal from '../components/MemberFormModal.jsx';
import DeleteMemberModal from '../components/DeleteMemberModal.jsx';
import { useToast } from '../components/Toast.jsx';
import { PhoneIcon, PlusIcon, SearchIcon, TrashIcon } from '../components/Icons.jsx';
import '../styles/seats.css';
import '../styles/members.css';

const TABS = [
  { key: 'active', label: 'All active' },
  { key: 'seated', label: 'With seat' },
  { key: 'unseated', label: 'No seat' },
  { key: 'expiring', label: 'Expiring soon' },
  { key: 'archived', label: 'Archived' },
];

export default function MembersPage() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const canManage = can('members.manage');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await listMembers());
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = data?.today;
  const shiftLabel = useMemo(() => Object.fromEntries((data?.shifts ?? []).map((s) => [s.key, s.label])), [data]);
  const rows = useMemo(
    () => (data?.members ?? []).map((m) => ({ ...m, st: standing(m, today) })),
    [data, today]
  );

  const counts = useMemo(() => {
    const active = rows.filter((m) => m.status === 'active');
    return {
      active: active.length,
      seated: active.filter((m) => m.st.current.length).length,
      unseated: active.filter((m) => !m.st.current.length).length,
      expiring: active.filter((m) => m.st.expiring).length,
      archived: rows.length - active.length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return rows
      .filter((m) => {
        if (tab === 'archived') return m.status === 'archived';
        if (m.status !== 'active') return false;
        if (tab === 'seated') return m.st.current.length > 0;
        if (tab === 'unseated') return m.st.current.length === 0;
        if (tab === 'expiring') return m.st.expiring;
        return true;
      })
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          m.code.toLowerCase().includes(q) ||
          m.preparingFor.toLowerCase().includes(q) ||
          (digits.length >= 3 && m.phone.replace(/\D/g, '').includes(digits))
      )
      .sort((a, b) => (tab === 'expiring' ? (a.st.daysLeft ?? 99) - (b.st.daysLeft ?? 99) : 0));
  }, [rows, tab, query]);

  if (error && !data) return <div className="page"><div className="alert">{error}</div></div>;
  if (!data) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Reading room</p>
          <h1>Members</h1>
          <p className="page-sub">Everyone who studies at Knowledge Nest, with their seat and plan.</p>
        </div>
        {canManage && (
          <button className="btn btn-solid" onClick={() => setAdding(true)}>
            <PlusIcon /> Add member
          </button>
        )}
      </header>

      <div className="member-stats">
        <button className="seat-stat" onClick={() => setTab('active')}>
          <span className="seat-stat-label">Active members</span>
          <span className="seat-stat-value">{counts.active}</span>
        </button>
        <button className="seat-stat" onClick={() => setTab('seated')}>
          <span className="seat-stat-label">With a seat today</span>
          <span className="seat-stat-value">{counts.seated}</span>
        </button>
        <button className="seat-stat" onClick={() => setTab('unseated')}>
          <span className="seat-stat-label">Without a seat</span>
          <span className="seat-stat-value">{counts.unseated}</span>
          <span className="seat-stat-foot">Plan ended or not booked</span>
        </button>
        <button className={`seat-stat${counts.expiring ? ' seat-stat-warn' : ''}`} onClick={() => setTab('expiring')}>
          <span className="seat-stat-label">Plans ending soon</span>
          <span className="seat-stat-value">{counts.expiring}</span>
          <span className="seat-stat-foot">Within 5 days: time to renew</span>
        </button>
      </div>

      <section className="panel panel-flush">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Filter members">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`tab${tab === t.key ? ' on' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                <span className="tab-count">{counts[t.key]}</span>
              </button>
            ))}
          </div>
          <div className="search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Name, phone, code or exam"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search members"
            />
          </div>
        </div>

        <div className="table-wrap">
          <table className="table members-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Preparing for</th>
                <th>Seat today</th>
                <th>Plan ends</th>
                <th>Joined</th>
                {tab === 'archived' && canManage && <th className="th-actions"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="table-empty">
                    {rows.length === 0 ? (
                      <>
                        No members yet.
                        {canManage && <> <button className="link" onClick={() => setAdding(true)}>Add your first member</button></>}
                      </>
                    ) : (
                      'No members match.'
                    )}
                  </td>
                </tr>
              )}
              {filtered.map((m) => (
                <tr
                  key={m.id}
                  className={`row-link${m.status === 'archived' ? ' row-muted' : ''}`}
                  onClick={() => navigate(`/admin/members/${m.id}`)}
                >
                  <td>
                    <div className="member">
                      <span className="avatar">{initials(m.name)}</span>
                      <div>
                        <span className="member-name-row">
                          <a
                            href={`/admin/members/${m.id}`}
                            className="member-name-link"
                            onClick={(e) => { e.preventDefault(); navigate(`/admin/members/${m.id}`); }}
                          >
                            {m.name}
                          </a>
                          {m.portal?.enabled && (
                            <span className="portal-chip" title="Has member portal access">
                              <PhoneIcon width={12} height={12} aria-hidden="true" /> Portal
                            </span>
                          )}
                          {m.anonymized && <span className="removed-chip" title="Personal details were removed">Details removed</span>}
                        </span>
                        <span>{m.code}{m.phone ? ` · ${m.phone}` : ''}</span>
                      </div>
                    </div>
                  </td>
                  <td className="muted">{m.preparingFor || '—'}</td>
                  <td>
                    {m.st.current.length ? (
                      <div className="seat-chips">
                        {m.st.current.map((b) => (
                          <span key={b.id} className="seat-chip">
                            <strong>{b.seatLabel}</strong> {b.kind === 'day' ? 'Day pass' : shiftLabel[b.shift]}
                          </span>
                        ))}
                      </div>
                    ) : m.st.upcoming.length ? (
                      <span className="muted">From {fmtShort(m.st.upcoming[0].startDate)}</span>
                    ) : (
                      <span className="muted">{m.status === 'archived' ? 'Archived' : 'No seat'}</span>
                    )}
                  </td>
                  <td>
                    {m.st.nextEnd ? (
                      <div className={`plan-end${m.st.expiring ? ' is-expiring' : ''}`}>
                        <span>{fmtDate(m.st.nextEnd)}</span>
                        <small>{m.st.daysLeft === 0 ? 'ends today' : `${m.st.daysLeft} days left`}</small>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted">{fmtDate(m.joinedOn)}</td>
                  {tab === 'archived' && canManage && (
                    <td className="td-actions">
                      <button
                        className="btn btn-ghost btn-sm btn-ghost-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(m);
                        }}
                        aria-label={`Delete ${m.name}`}
                      >
                        <TrashIcon width={15} height={15} /> Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {deleting && (
        <DeleteMemberModal
          member={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(mode) => {
            toast(mode === 'anonymize' ? `Personal details of ${deleting.name} were removed.` : `${deleting.name} was deleted.`);
            setDeleting(null);
            load();
          }}
        />
      )}
      {adding && (
        <MemberFormModal
          today={today}
          onClose={() => setAdding(false)}
          onSaved={(m) => {
            toast(`${m.name} added as ${m.code}.`);
            navigate(`/admin/members/${m.id}`);
          }}
        />
      )}
    </div>
  );
}
