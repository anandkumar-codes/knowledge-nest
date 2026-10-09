import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { activeOn, listBookings, whatsappReminder } from '../../api/bookings.js';
import { bookingShift, daysBetween, fmtDate, fmtShort, isDayPass, isExpiring, releaseBooking } from '../../api/seats.js';
import { ExtendModal } from '../../components/BookingDialogs.jsx';
import { ConfirmDialog } from '../../components/Modal.jsx';
import StatCard from '../../components/StatCard.jsx';
import { useToast } from '../../components/Toast.jsx';
import { MessageIcon, SearchIcon } from '../../components/Icons.jsx';
import { paymentStatus } from '../../api/payments.js';

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'ending', label: 'Ending soon' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
];

export default function BookingsList({ data, reload, canBook }) {
  const { can } = useAuth();
  const toast = useToast();
  const canSeeMembers = can('members.view', 'members.manage');
  const canSeePayments = can('payments.view', 'payments.manage');
  const { today, shifts, capacity } = data;
  const shiftOf = useMemo(() => Object.fromEntries(shifts.map((s) => [s.key, s])), [shifts]);

  const [tab, setTab] = useState('active');
  const [shift, setShift] = useState('all');
  const [query, setQuery] = useState('');
  const [past, setPast] = useState(null);
  const [extending, setExtending] = useState(null);
  const [releasing, setReleasing] = useState(null);
  const [busy, setBusy] = useState(false);

  // Past bookings are loaded only when that tab is opened.
  useEffect(() => {
    if (tab !== 'past' || past) return;
    listBookings('past').then((d) => setPast(d.bookings)).catch((err) => toast(err.message, 'error'));
  }, [tab, past, toast]);

  const open = data.bookings;
  const active = useMemo(() => open.filter((b) => activeOn(b, today)), [open, today]);
  const counts = {
    active: active.length,
    ending: active.filter((b) => isExpiring(b, today)).length,
    upcoming: open.filter((b) => b.startDate > today).length,
    past: past?.length,
  };
  const held = (key) => active.filter((b) => b.shift === key || b.shift === 'full').length;

  const rows = useMemo(() => {
    const source =
      tab === 'past' ? past ?? [] :
      tab === 'upcoming' ? open.filter((b) => b.startDate > today) :
      tab === 'ending' ? active.filter((b) => isExpiring(b, today)) :
      active;
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return source
      .filter((b) => shift === 'all' || bookingShift(b, shiftOf).key === shift)
      .filter(
        (b) =>
          !q ||
          b.memberName.toLowerCase().includes(q) ||
          b.seatLabel.toLowerCase() === q ||
          (b.memberCode ?? '').toLowerCase().includes(q) ||
          (digits.length >= 3 && b.memberPhone.replace(/\D/g, '').includes(digits))
      )
      .sort((a, b) =>
        tab === 'upcoming' ? a.startDate.localeCompare(b.startDate) :
        tab === 'past' ? 0 :
        a.endDate.localeCompare(b.endDate)
      );
  }, [tab, past, open, active, today, shift, query]);

  const doRelease = async () => {
    setBusy(true);
    try {
      await releaseBooking(releasing.id);
      toast(releasing.startDate > today ? 'Upcoming booking cancelled.' : `Seat ${releasing.seatLabel} released.`);
      setPast(null);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setReleasing(null);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="seat-stats booking-stats">
        <StatCard label={`${shiftOf.morning.label} seats taken`} value={held('morning')} of={capacity} foot={shiftOf.morning.time} />
        <StatCard label={`${shiftOf.evening.label} seats taken`} value={held('evening')} of={capacity} foot={shiftOf.evening.time} />
        <StatCard label="Ending within 5 days" value={counts.ending} foot="Remind them to renew" tone={counts.ending ? 'warn' : ''} onClick={() => setTab('ending')} />
        <StatCard label="Starting soon" value={counts.upcoming} foot="Advance bookings" onClick={() => setTab('upcoming')} />
      </div>

      <section className="panel panel-flush">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Filter bookings">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`tab${tab === t.key ? ' on' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {counts[t.key] !== undefined && <span className="tab-count">{counts[t.key]}</span>}
              </button>
            ))}
          </div>
          <select className="select" value={shift} onChange={(e) => setShift(e.target.value)} aria-label="Filter by shift">
            <option value="all">All shifts</option>
            {shifts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            <option value="day">Day passes</option>
          </select>
          <div className="search">
            <SearchIcon />
            <input type="search" placeholder="Member, phone or seat" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search bookings" />
          </div>
        </div>

        <div className="table-wrap">
          <table className="table bookings-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Seat</th>
                <th>Shift</th>
                <th>Period</th>
                <th>Status</th>
                {canSeePayments && <th>Payment</th>}
                {canBook && tab !== 'past' && <th className="th-actions"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {tab === 'past' && !past && (
                <tr><td colSpan={7} className="table-empty"><span className="spinner spinner-dark" /></td></tr>
              )}
              {(tab !== 'past' || past) && rows.length === 0 && (
                <tr><td colSpan={7} className="table-empty">{EMPTY[tab]}</td></tr>
              )}
              {rows.map((b) => (
                <BookingRow
                  key={b.id}
                  b={b}
                  tab={tab}
                  today={today}
                  shift={bookingShift(b, shiftOf)}
                  canBook={canBook}
                  canSeeMembers={canSeeMembers}
                  canSeePayments={canSeePayments}
                  onExtend={() => setExtending(b)}
                  onRelease={() => setReleasing(b)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {tab === 'past' && past?.length === 500 && <p className="table-foot">Showing the 500 most recent past bookings.</p>}
      </section>

      {extending && (
        <ExtendModal
          allocation={extending}
          today={today}
          onClose={() => setExtending(null)}
          onSaved={(a) => {
            toast(`Extended to ${fmtDate(a.endDate)}.`);
            setExtending(null);
            reload();
          }}
        />
      )}
      {releasing && (
        <ConfirmDialog
          title={releasing.startDate > today ? 'Cancel upcoming booking?' : `Release seat ${releasing.seatLabel}?`}
          message={
            releasing.startDate > today
              ? `${releasing.memberName}'s booking from ${fmtDate(releasing.startDate)} will be cancelled.`
              : `${releasing.memberName}'s ${isDayPass(releasing) ? 'day pass' : 'plan'} ends now and the seat becomes available immediately.`
          }
          confirmLabel={releasing.startDate > today ? 'Cancel booking' : 'Release seat'}
          danger
          busy={busy}
          onConfirm={doRelease}
          onClose={() => !busy && setReleasing(null)}
        />
      )}
    </>
  );
}

const EMPTY = {
  active: 'No active bookings.',
  ending: 'No plans end in the next 5 days.',
  upcoming: 'No advance bookings.',
  past: 'No past bookings yet.',
};

function BookingRow({ b, tab, today, shift, canBook, canSeeMembers, canSeePayments, onExtend, onRelease }) {
  const left = daysBetween(today, b.endDate);
  const total = daysBetween(b.startDate, b.endDate) + 1;
  const expiring = tab !== 'past' && b.startDate <= today && isExpiring(b, today);

  let status;
  if (tab === 'past') {
    status = b.releasedAt
      ? <span className="hist hist-released">Released {fmtShort(b.releasedAt.slice(0, 10))}</span>
      : <span className="hist hist-ended">Completed</span>;
  } else if (b.startDate > today) {
    const inDays = daysBetween(today, b.startDate);
    status = <span className="hist hist-upcoming">Starts {inDays === 1 ? 'tomorrow' : `in ${inDays} days`}</span>;
  } else {
    const used = Math.min(total, daysBetween(b.startDate, today) + 1);
    status = (
      <div className={`row-progress${expiring ? ' is-expiring' : ''}`}>
        <span className="progress" aria-hidden="true"><span style={{ width: `${(used / total) * 100}%` }} /></span>
        <small>{isDayPass(b) ? 'Today only' : left === 0 ? 'Ends today' : `${left} day${left === 1 ? '' : 's'} left`}</small>
      </div>
    );
  }

  return (
    <tr className={tab === 'past' ? 'row-muted-soft' : ''}>
      <td>
        <div className="member member-compact">
          <div>
            {canSeeMembers && b.memberId ? (
              <Link to={`/admin/members/${b.memberId}`} className="member-name-link">{b.memberName}</Link>
            ) : (
              <strong>{b.memberName}</strong>
            )}
            <span>{b.memberCode ? `${b.memberCode} · ` : ''}{b.memberPhone}</span>
          </div>
        </div>
      </td>
      <td>
        <Link to={`/admin/seats?seat=${b.seatId}`} className="seat-pill" title="View on floor plan">{b.seatLabel}</Link>
      </td>
      <td>
        <span className={`shift-tag shift-${shift.key}`}>{shift.label}</span>
      </td>
      <td className="muted nowrap">{isDayPass(b) ? fmtDate(b.startDate) : `${fmtShort(b.startDate)} – ${fmtDate(b.endDate)}`}</td>
      <td>{status}</td>
      {canSeePayments && (
        <td>
          <span className={`pay-status pay-${paymentStatus(b).key}`}>{paymentStatus(b).label}</span>
        </td>
      )}
      {canBook && tab !== 'past' && (
        <td className="td-actions">
          <div className="row-actions">
            {expiring && (
              <a
                className="btn btn-ghost btn-sm btn-whatsapp"
                href={whatsappReminder(b, shift.label, today)}
                target="_blank"
                rel="noreferrer"
                title="Send a renewal reminder on WhatsApp"
              >
                <MessageIcon width={15} height={15} /> Remind
              </a>
            )}
            {b.startDate <= today && !isDayPass(b) && <button className="btn btn-ghost btn-sm" onClick={onExtend}>Extend</button>}
            <button className="btn btn-ghost btn-sm btn-ghost-danger" onClick={onRelease}>
              {b.startDate > today ? 'Cancel' : 'Release'}
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}
