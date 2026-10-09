import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { activeOn, bySeat } from '../../api/bookings.js';
import { addDays, fmtDate, isDayPass } from '../../api/seats.js';
import { PrintIcon, SearchIcon } from '../../components/Icons.jsx';

// Who should be in the hall during each shift on a given day.
export default function Roster({ data }) {
  const { can } = useAuth();
  const canSeeMembers = can('members.view', 'members.manage');
  const { today, shifts, capacity, bookings } = data;
  const [date, setDate] = useState(today);
  const [query, setQuery] = useState('');

  const columns = useMemo(() => {
    const on = bookings.filter((b) => activeOn(b, date));
    return shifts
      .filter((s) => s.key !== 'full')
      .map((s) => ({ shift: s, people: on.filter((b) => b.shift === s.key || b.shift === 'full').sort(bySeat) }));
  }, [bookings, shifts, date]);

  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const matches = (b) =>
    !q ||
    b.memberName.toLowerCase().includes(q) ||
    b.seatLabel.toLowerCase() === q ||
    (digits.length >= 3 && b.memberPhone.replace(/\D/g, '').includes(digits));

  const tomorrow = addDays(today, 1);
  const fullDay = shifts.find((s) => s.key === 'full');

  return (
    <section className="roster">
      <div className="roster-bar no-print">
        <div className="segmented" role="radiogroup" aria-label="Roster day">
          {[
            [today, 'Today'],
            [tomorrow, 'Tomorrow'],
          ].map(([d, label]) => (
            <label key={d} className={date === d ? 'on' : ''}>
              <input type="radio" name="day" checked={date === d} onChange={() => setDate(d)} />
              {label}
            </label>
          ))}
        </div>
        <input
          className="input roster-date"
          type="date"
          value={date}
          min={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Roster date"
        />
        <div className="search">
          <SearchIcon />
          <input type="search" placeholder="Find a member or seat" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search roster" />
        </div>
        <button className="btn btn-ghost" onClick={() => window.print()}>
          <PrintIcon width={16} height={16} /> Print
        </button>
      </div>

      <h2 className="print-only roster-print-title">Knowledge Nest · Shift roster for {fmtDate(date)}</h2>

      <div className="roster-grid">
        {columns.map(({ shift, people }) => (
          <div key={shift.key} className="panel panel-flush roster-col">
            <header className={`roster-head roster-head-${shift.key}`}>
              <div>
                <h3>{shift.label}</h3>
                <span>{shift.time}</span>
              </div>
              <div className="roster-count">
                <strong>{people.length}</strong>
                <span>of {capacity} seats</span>
              </div>
            </header>
            {people.length === 0 ? (
              <p className="roster-empty">Nobody is booked for this shift on {fmtDate(date)}.</p>
            ) : (
              <ol className="roster-list">
                {people.map((b) => (
                  <li key={b.id} className={matches(b) ? '' : 'is-dimmed'}>
                    <span className="seat-pill">{b.seatLabel}</span>
                    <span className="roster-name">
                      {canSeeMembers && b.memberId ? (
                        <Link to={`/admin/members/${b.memberId}`}>{b.memberName}</Link>
                      ) : (
                        b.memberName
                      )}
                      <small>{b.memberPhone}</small>
                    </span>
                    <span className="roster-tags">
                      {isDayPass(b) ? (
                        <span className="mini-tag tag-day">Day pass</span>
                      ) : (
                        <>
                          {b.shift === 'full' && <span className="mini-tag">{fullDay.label}</span>}
                          {b.startDate === date && <span className="mini-tag tag-new">First day</span>}
                          {b.endDate === date && <span className="mini-tag tag-last">Last day</span>}
                        </>
                      )}
                    </span>
                    <span className="print-only check-box" aria-hidden="true" />
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
