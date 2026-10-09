import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { duesReminder, inr, listDues, listPayments } from '../../api/payments.js';
import { bookingShift, daysBetween, fmtDate, fmtShort, isDayPass } from '../../api/seats.js';
import { AdjustFeeModal, CollectPaymentModal } from '../../components/PaymentDialogs.jsx';
import StatCard from '../../components/StatCard.jsx';
import { useToast } from '../../components/Toast.jsx';
import { MessageIcon, SearchIcon } from '../../components/Icons.jsx';

const FILTERS = [
  { key: 'all', label: 'All dues' },
  { key: 'current', label: 'Current plans' },
  { key: 'ended', label: 'Ended, unpaid' },
  { key: 'unpaid', label: 'Nothing paid yet' },
];

export default function Dues() {
  const { can } = useAuth();
  const toast = useToast();
  const canCollect = can('payments.manage');
  const canSeeMembers = can('members.view', 'members.manage');

  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [collecting, setCollecting] = useState(null);
  const [adjusting, setAdjusting] = useState(null);

  const load = useCallback(async () => {
    try {
      const [dues, ledger] = await Promise.all([listDues(), listPayments()]);
      setData(dues);
      setStats(ledger.stats);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = data?.today;
  const shiftOf = useMemo(() => Object.fromEntries((data?.shifts ?? []).map((s) => [s.key, s])), [data]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return (data?.dues ?? [])
      .filter((b) => {
        const ended = b.releasedAt || b.endDate < today;
        if (filter === 'current') return !ended;
        if (filter === 'ended') return ended;
        if (filter === 'unpaid') return b.paid === 0;
        return true;
      })
      .filter(
        (b) =>
          !q ||
          b.memberName.toLowerCase().includes(q) ||
          b.seatLabel.toLowerCase() === q ||
          (b.memberCode ?? '').toLowerCase().includes(q) ||
          (digits.length >= 3 && b.memberPhone.replace(/\D/g, '').includes(digits))
      );
  }, [data, filter, query, today]);

  if (error && !data) return <div className="alert">{error}</div>;
  if (!data || !stats) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;

  const total = rows.reduce((t, b) => t + b.balance, 0);
  const endedCount = data.dues.filter((b) => b.releasedAt || b.endDate < today).length;

  return (
    <>
      <div className="seat-stats booking-stats">
        <div className="seat-stat seat-stat-hero">
          <span className="seat-stat-label">Outstanding dues</span>
          <span className="seat-stat-value">{inr(stats.outstanding)}</span>
          <span className="seat-stat-foot">across {stats.dueCount} booking{stats.dueCount === 1 ? '' : 's'}</span>
        </div>
        <StatCard label="Collected today" value={inr(stats.today)} foot={fmtDate(today)} />
        <StatCard label="Collected this month" value={inr(stats.month)} foot="Net of refunds" />
        <StatCard
          label="Ended with dues"
          value={endedCount}
          foot="Plans over, balance unpaid"
          tone={endedCount ? 'warn' : ''}
          onClick={() => setFilter('ended')}
        />
      </div>

      <section className="panel panel-flush">
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Filter dues">
            {FILTERS.map((f) => (
              <button key={f.key} role="tab" aria-selected={filter === f.key} className={`tab${filter === f.key ? ' on' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="search">
            <SearchIcon />
            <input type="search" placeholder="Member, phone or seat" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search dues" />
          </div>
        </div>

        <div className="table-wrap">
          <table className="table money-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Seat</th>
                <th>Plan</th>
                <th className="num">Fee</th>
                <th className="num">Paid</th>
                <th className="num">Due</th>
                <th className="th-actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="table-empty">
                    {data.dues.length === 0 ? 'No dues. Every booking is paid up.' : 'No dues match.'}
                  </td>
                </tr>
              )}
              {rows.map((b) => {
                const shift = bookingShift(b, shiftOf);
                const ended = b.releasedAt || b.endDate < today;
                const overdue = ended ? daysBetween(b.endDate, today) : null;
                return (
                  <tr key={b.id}>
                    <td>
                      <div className="member member-compact">
                        <div>
                          {canSeeMembers && b.memberId ? (
                            <Link to={`/admin/members/${b.memberId}`} className="member-name-link">{b.memberName}</Link>
                          ) : (
                            <strong>{b.memberName}</strong>
                          )}
                          <span>{b.memberCode ? `${b.memberCode} · ` : ''}{b.memberPhone || (b.memberId ? '' : 'Walk-in guest')}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="seat-shift">
                        <span className="seat-pill">{b.seatLabel}</span>
                        <span className={`shift-tag shift-${shift.key}`}>{shift.label}</span>
                      </div>
                    </td>
                    <td className="nowrap">
                      <span className="muted">{isDayPass(b) ? fmtDate(b.startDate) : `${fmtShort(b.startDate)} – ${fmtDate(b.endDate)}`}</span>
                      {ended && <small className="overdue">{b.releasedAt ? 'Released' : `Ended ${overdue} day${overdue === 1 ? '' : 's'} ago`}</small>}
                    </td>
                    <td className="num">{inr(b.fee)}</td>
                    <td className="num muted">{inr(b.paid)}</td>
                    <td className="num"><strong className="due-amount">{inr(b.balance)}</strong></td>
                    <td className="td-actions">
                      <div className="row-actions">
                        {b.memberPhone && (
                          <a
                            className="btn btn-ghost btn-sm btn-whatsapp btn-square"
                            href={duesReminder(b, shift.label)}
                            target="_blank"
                            rel="noreferrer"
                            title="Send a payment reminder on WhatsApp"
                            aria-label={`Send ${b.memberName} a payment reminder on WhatsApp`}
                          >
                            <MessageIcon width={16} height={16} />
                          </a>
                        )}
                        {canCollect && (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => setAdjusting(b)}>Adjust</button>
                            <button className="btn btn-solid btn-sm" onClick={() => setCollecting(b)}>Collect</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr>
                  <td colSpan={5}>Total ({rows.length} bookings)</td>
                  <td className="num"><strong>{inr(total)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {collecting && (
        <CollectPaymentModal
          booking={collecting}
          today={today}
          shiftLabel={bookingShift(collecting, shiftOf).label}
          shiftTime={bookingShift(collecting, shiftOf).time}
          onSaved={() => load()}
          onClose={() => setCollecting(null)}
        />
      )}
      {adjusting && (
        <AdjustFeeModal
          booking={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={(b) => {
            toast(b.balance <= 0 ? 'Fee updated. Nothing is due now.' : `Fee updated. ${inr(b.balance)} due.`);
            setAdjusting(null);
            load();
          }}
        />
      )}
    </>
  );
}
