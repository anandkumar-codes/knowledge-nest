import { Link } from 'react-router-dom';
import { useMember } from './MemberAuth.jsx';
import { inr } from '../api/payments.js';
import { bookingShift, daysBetween, fmtDate, fmtShort, isDayPass } from '../api/seats.js';
import { ClockIcon, SeatIcon } from '../components/Icons.jsx';

export function shiftLookup(portal) {
  return Object.fromEntries(portal.shifts.map((s) => [s.key, s]));
}

const pendingFor = (claims, bookingId) =>
  claims.filter((c) => c.allocationId === bookingId && c.status === 'pending').reduce((t, c) => t + c.amount, 0);

export function memberDues(portal) {
  return portal.bookings
    .filter((b) => b.balance > 0)
    .map((b) => ({ ...b, pending: pendingFor(portal.claims, b.id), payable: b.balance - pendingFor(portal.claims, b.id) }));
}

export default function MemberHome() {
  const { portal, member } = useMember();
  const { today } = portal;
  const shift = shiftLookup(portal);
  const open = portal.bookings.filter((b) => !b.releasedAt && b.endDate >= today);
  const current = open.filter((b) => b.startDate <= today);
  const upcoming = open.filter((b) => b.startDate > today);
  const dues = memberDues(portal);
  const payable = dues.reduce((t, b) => t + Math.max(b.payable, 0), 0);
  const pending = dues.reduce((t, b) => t + b.pending, 0);
  const hour = new Date().getHours();

  return (
    <div className="member-page">
      <header className="member-hello">
        <p>{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'},</p>
        <h1>{member.name.split(' ')[0]}</h1>
        <span className="code-chip">{member.code}</span>
      </header>

      {current.length === 0 ? (
        <section className="panel member-empty">
          <span className="seat-empty-icon"><SeatIcon width={26} height={26} /></span>
          <h2>No seat booked today</h2>
          <p>{upcoming.length ? `Your next booking starts on ${fmtDate(upcoming[0].startDate)}.` : 'Visit the front desk to book a seat or renew your plan.'}</p>
        </section>
      ) : (
        current.map((b) => {
          const s = bookingShift(b, shift);
          const left = daysBetween(today, b.endDate);
          const total = daysBetween(b.startDate, b.endDate) + 1;
          const used = Math.min(total, daysBetween(b.startDate, today) + 1);
          const day = isDayPass(b);
          const endingSoon = !day && left <= 5;
          return (
            <section key={b.id} className={`my-seat${endingSoon ? ' is-expiring' : ''}`}>
              <div className="my-seat-top">
                <div>
                  <span className="my-seat-eyebrow">Your seat</span>
                  <span className="my-seat-label">{b.seatLabel}</span>
                </div>
                <div className="my-seat-shift">
                  <strong>{s.label}</strong>
                  <span><ClockIcon width={14} height={14} /> {s.time}</span>
                </div>
              </div>
              <div className="my-seat-progress" aria-hidden="true"><span style={{ width: `${(used / total) * 100}%` }} /></div>
              <div className="my-seat-dates">
                <span>{day ? fmtDate(b.startDate) : `${fmtShort(b.startDate)} – ${fmtDate(b.endDate)}`}</span>
                <strong>{day ? 'Today only' : left === 0 ? 'Last day today' : `${left} day${left === 1 ? '' : 's'} left`}</strong>
              </div>
              {endingSoon && <p className="my-seat-note">Your plan ends soon. Renew at the front desk to keep this seat.</p>}
            </section>
          );
        })
      )}

      <section className={`panel dues-card${payable > 0 ? ' has-dues' : ''}`}>
        <div>
          <span className="dues-label">{payable > 0 ? 'Amount due' : 'Fees'}</span>
          <strong className="dues-amount">{payable > 0 ? inr(payable) : 'All paid up'}</strong>
          {pending > 0 && <span className="dues-pending">{inr(pending)} you paid online is being confirmed</span>}
        </div>
        <Link to="/member/payments" className={`btn ${payable > 0 ? 'btn-solid' : 'btn-ghost'}`}>
          {payable > 0 ? 'Pay now' : 'View payments'}
        </Link>
      </section>

      {upcoming.length > 0 && (
        <section className="panel">
          <h2 className="member-h2">Coming up</h2>
          <ul className="upcoming">
            {upcoming.map((b) => (
              <li key={b.id}>
                <div>
                  <strong>Seat {b.seatLabel} · {bookingShift(b, shift).label}</strong>
                  <span>{isDayPass(b) ? fmtDate(b.startDate) : `${fmtShort(b.startDate)} – ${fmtDate(b.endDate)}`}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
