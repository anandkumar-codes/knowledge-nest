import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Link, useSearchParams } from 'react-router-dom';
import {
  bookingShift, daysBetween, fmtDate, fmtShort, getHall, isDayPass, isExpiring, releaseBooking, shiftsOn, updateSeat,
  upcomingFor,
} from '../api/seats.js';
import { BookSeatModal, DayPassModal, ExtendModal } from '../components/BookingDialogs.jsx';
import { inr } from '../api/payments.js';
import Modal, { ConfirmDialog } from '../components/Modal.jsx';
import StatCard from '../components/StatCard.jsx';
import { useToast } from '../components/Toast.jsx';
import { CalendarIcon, CloseIcon, SearchIcon, SeatIcon, SunIcon } from '../components/Icons.jsx';
import '../styles/seats.css';

const VIEWS = [
  { key: 'both', label: 'Both shifts' },
  { key: 'morning', label: 'Morning' },
  { key: 'evening', label: 'Evening' },
];
const FILTERS = [
  { key: 'all', label: 'All seats' },
  { key: 'available', label: 'Available' },
  { key: 'occupied', label: 'Occupied' },
  { key: 'expiring', label: 'Expiring soon' },
  { key: 'maintenance', label: 'Maintenance' },
];

export default function SeatsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('seats.manage');
  const canBook = can('seats.manage', 'bookings.manage');

  const [hall, setHall] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('both');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState(() => params.get('seat'));
  const [booking, setBooking] = useState(null); // { seat, shift }
  const [dayPassSeat, setDayPassSeat] = useState(null);
  const [extending, setExtending] = useState(null); // allocation
  const [releasing, setReleasing] = useState(null); // allocation
  const [maintaining, setMaintaining] = useState(null); // seat
  const [busy, setBusy] = useState(false);
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setHall(await getHall());
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = hall?.today;
  const seats = useMemo(() => hall?.seats ?? [], [hall]);
  const shiftOf = useMemo(() => Object.fromEntries((hall?.shifts ?? []).map((s) => [s.key, s])), [hall]);
  const state = useMemo(() => Object.fromEntries(seats.map((s) => [s.id, shiftsOn(s, today)])), [seats, today]);

  const stats = useMemo(() => {
    const st = { morning: 0, evening: 0, inUse: 0, free: 0, maintenance: 0, expiring: 0 };
    const seenExpiring = new Set();
    for (const seat of seats) {
      const { morning, evening } = state[seat.id];
      if (seat.status === 'maintenance') st.maintenance++;
      if (morning) st.morning++;
      if (evening) st.evening++;
      if (morning || evening) st.inUse++;
      else if (seat.status === 'active') st.free++;
      for (const a of [morning, evening]) {
        if (a && isExpiring(a, today) && !seenExpiring.has(a.id)) {
          seenExpiring.add(a.id);
          st.expiring++;
        }
      }
    }
    const open = seats.length - st.maintenance;
    st.occupancy = open ? Math.round(((st.morning + st.evening) / (open * 2)) * 100) : 0;
    return st;
  }, [seats, state, today]);

  const shiftsInView = view === 'both' ? ['morning', 'evening'] : [view];

  const matches = (seat) => {
    const held = shiftsInView.map((k) => state[seat.id][k]);
    if (filter === 'maintenance' && seat.status !== 'maintenance') return false;
    if (filter === 'available' && (seat.status !== 'active' || held.every(Boolean))) return false;
    if (filter === 'occupied' && !held.every(Boolean)) return false;
    if (filter === 'expiring' && !held.some((a) => isExpiring(a, today))) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const digits = q.replace(/\D/g, '');
    return (
      seat.label.toLowerCase().startsWith(q) ||
      seat.allocations.some(
        (a) =>
          a.memberName.toLowerCase().includes(q) ||
          (digits.length >= 3 && a.memberPhone.replace(/\D/g, '').includes(digits))
      )
    );
  };

  const rows = useMemo(() => {
    const byRow = {};
    for (const s of seats) (byRow[s.row] ??= []).push(s);
    return Object.entries(byRow);
  }, [seats]);

  const selected = seats.find((s) => s.id === selectedId) ?? null;
  const matchCount = seats.filter(matches).length;
  const filtering = filter !== 'all' || query.trim();

  const selectSeat = (id) => {
    setSelectedId((cur) => (cur === id ? null : id));
    if (window.matchMedia('(max-width: 1180px)').matches) {
      setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  };

  const doRelease = async () => {
    setBusy(true);
    try {
      await releaseBooking(releasing.id);
      toast(releasing.startDate > today ? 'Upcoming booking cancelled.' : `Seat ${releasing.seatLabel} released.`);
      setReleasing(null);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (error && !hall) return <div className="page"><div className="alert">{error}</div></div>;
  if (!hall) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Reading room</p>
          <h1>Seats</h1>
          <p className="page-sub">
            <CalendarIcon width={15} height={15} /> {fmtDate(today)} · {hall.capacity} seats · two shifts a day
          </p>
        </div>
      </header>

      <div className="seat-stats">
        <div className="seat-stat seat-stat-hero">
          <span className="seat-stat-label">Occupancy today</span>
          <span className="seat-stat-value">{stats.occupancy}%</span>
          <span className="meter" aria-hidden="true"><span style={{ width: `${stats.occupancy}%` }} /></span>
          <span className="seat-stat-foot">{stats.morning + stats.evening} of {(seats.length - stats.maintenance) * 2} shift slots filled</span>
        </div>
        <StatCard label="Morning" value={stats.morning} of={seats.length} foot={shiftOf.morning?.time} />
        <StatCard label="Evening" value={stats.evening} of={seats.length} foot={shiftOf.evening?.time} />
        <StatCard label="Completely free" value={stats.free} foot="Both shifts open" onClick={() => setFilter('available')} />
        <StatCard
          label="Expiring soon"
          value={stats.expiring}
          foot="Within 5 days"
          tone={stats.expiring ? 'warn' : ''}
          onClick={() => setFilter('expiring')}
        />
      </div>

      <div className="seats-layout">
        <section className="panel panel-flush">
          <div className="toolbar">
            <div className="segmented" role="radiogroup" aria-label="Shift view">
              {VIEWS.map((v) => (
                <label key={v.key} className={view === v.key ? 'on' : ''}>
                  <input type="radio" name="view" value={v.key} checked={view === v.key} onChange={() => setView(v.key)} />
                  {v.label}
                </label>
              ))}
            </div>
            <div className="search">
              <SearchIcon />
              <input
                type="search"
                placeholder="Seat, member or phone"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search seats"
              />
            </div>
            <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter seats">
              {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            {filtering && (
              <span className="toolbar-meta">
                {matchCount} match{matchCount === 1 ? '' : 'es'}
                <button className="link" onClick={() => { setFilter('all'); setQuery(''); }}>Clear</button>
              </span>
            )}
          </div>

          <div className="hall-scroll">
            <div className="hall" style={{ '--cols': hall.layout.seatsPerRow }}>
              <div className="hall-edge">Windows</div>
              {rows.map(([row, rowSeats]) => (
                <div className="hall-row" key={row}>
                  <span className="row-label">{row}</span>
                  {rowSeats.map((seat) => (
                    <SeatTile
                      key={seat.id}
                      seat={seat}
                      held={state[seat.id]}
                      view={view}
                      today={today}
                      dimmed={filtering && !matches(seat)}
                      selected={seat.id === selectedId}
                      aisleAfter={seat.position === hall.layout.aisleAfter}
                      onClick={() => selectSeat(seat.id)}
                    />
                  ))}
                  <span className="row-label">{row}</span>
                </div>
              ))}
              <div className="hall-edge hall-entrance">
                <span>Entrance</span>
                <span className="desk">Front desk</span>
              </div>
            </div>
          </div>

          <Legend />
        </section>

        <aside className="panel seat-panel" ref={panelRef}>
          {selected ? (
            <SeatDetails
              seat={selected}
              held={state[selected.id]}
              today={today}
              shiftOf={shiftOf}
              canManage={canManage}
              canBook={canBook}
              onClose={() => setSelectedId(null)}
              onBook={(shift) => setBooking({ seat: selected, shift })}
              onDayPass={() => setDayPassSeat(selected)}
              onExtend={setExtending}
              onRelease={setReleasing}
              onMaintenance={() => setMaintaining(selected)}
              onBackInService={async () => {
                try {
                  await updateSeat(selected.id, { status: 'active', notes: '' });
                  toast(`Seat ${selected.label} is back in service.`);
                  load();
                } catch (err) {
                  toast(err.message, 'error');
                }
              }}
            />
          ) : (
            <div className="seat-empty">
              <span className="seat-empty-icon"><SeatIcon width={26} height={26} /></span>
              <h2>Select a seat</h2>
              <p>
                Click any seat on the plan to see who's booked, {canBook ? 'book it (or give a day pass), extend a plan or release it.' : 'and their booking dates.'}
              </p>
              <ul className="seat-tips">
                <li><span className="mini-tile half-top" /><span>Top half is the <strong>morning</strong> shift</span></li>
                <li><span className="mini-tile half-bottom" /><span>Bottom half is the <strong>evening</strong> shift</span></li>
                <li><span className="mini-tile full" /><span>Fully filled means a <strong>full-day</strong> member or both shifts taken</span></li>
                <li><span className="mini-tile day" /><span>Striped means a one-day <strong>day pass</strong></span></li>
                <li><span className="mini-tile exp" /><span>Orange dot: the plan ends within <strong>5 days</strong></span></li>
              </ul>
            </div>
          )}
        </aside>
      </div>

      {booking && (
        <BookSeatModal
          {...booking}
          today={today}
          shifts={hall.shifts}
          onClose={() => setBooking(null)}
          onSaved={(a) => {
            toast(`Seat ${a.seatLabel} booked for ${a.memberName}.`);
            setBooking(null);
            load();
          }}
        />
      )}
      {dayPassSeat && (
        <DayPassModal
          seat={dayPassSeat}
          today={today}
          onClose={() => setDayPassSeat(null)}
          onSaved={(a) => {
            toast(`Day pass booked: seat ${a.seatLabel} for ${a.memberName}.`);
            setDayPassSeat(null);
            load();
          }}
        />
      )}
      {extending && (
        <ExtendModal
          allocation={extending}
          today={today}
          onClose={() => setExtending(null)}
          onSaved={(a) => {
            toast(`Extended to ${fmtDate(a.endDate)}.`);
            setExtending(null);
            load();
          }}
        />
      )}
      {maintaining && (
        <MaintenanceModal
          seat={maintaining}
          onClose={() => setMaintaining(null)}
          onSaved={(s) => {
            toast(`Seat ${s.label} marked under maintenance.`);
            setMaintaining(null);
            load();
          }}
        />
      )}
      {releasing && (
        <ConfirmDialog
          title={releasing.startDate > today ? 'Cancel upcoming booking?' : `Release seat ${releasing.seatLabel}?`}
          message={
            releasing.startDate > today
              ? `${releasing.memberName}'s booking from ${fmtDate(releasing.startDate)} will be cancelled.`
              : `${releasing.memberName}'s ${isDayPass(releasing) ? 'day pass' : `${bookingShift(releasing, shiftOf).label.toLowerCase()} booking`} ends now and the seat becomes available immediately.`
          }
          confirmLabel={releasing.startDate > today ? 'Cancel booking' : 'Release seat'}
          danger
          busy={busy}
          onConfirm={doRelease}
          onClose={() => !busy && setReleasing(null)}
        />
      )}
    </div>
  );
}

function SeatTile({ seat, held, view, today, dimmed, selected, aisleAfter, onClick }) {
  const maintenance = seat.status === 'maintenance';
  const top = view === 'evening' ? held.evening : held.morning;
  const bottom = view === 'morning' ? held.morning : held.evening;
  const full = !!top && top === bottom;
  const day = [top, bottom].some(isDayPass);
  const expiring = [top, bottom].some((a) => isExpiring(a, today));

  const describe = (k) => (held[k] ? `${k} ${held[k].memberName}${isDayPass(held[k]) ? ' (day pass)' : ''}` : `${k} free`);
  const label = maintenance
    ? `Seat ${seat.label}, under maintenance`
    : `Seat ${seat.label}, ${view === 'both' ? `${describe('morning')}, ${describe('evening')}` : describe(view)}`;

  return (
    <button
      type="button"
      className={[
        'seat-tile',
        maintenance && 'is-maintenance',
        full && 'is-full',
        day && !maintenance && 'is-day',
        dimmed && 'is-dimmed',
        selected && 'is-selected',
        aisleAfter && 'aisle-after',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      title={label}
    >
      {!maintenance && (
        <>
          <span className={`half half-top${top ? ' held' : ''}`} />
          <span className={`half half-bottom${bottom ? ' held' : ''}`} />
        </>
      )}
      <span className="seat-num">{seat.label}</span>
      {expiring && <span className="exp-dot" aria-hidden="true" />}
    </button>
  );
}

function Legend() {
  return (
    <div className="seat-legend">
      <span><i className="mini-tile" /> Available</span>
      <span><i className="mini-tile half-top" /> Morning taken</span>
      <span><i className="mini-tile half-bottom" /> Evening taken</span>
      <span><i className="mini-tile full" /> Full / both</span>
      <span><i className="mini-tile day" /> Day pass</span>
      <span><i className="mini-tile exp" /> Ends within 5 days</span>
      <span><i className="mini-tile maint" /> Maintenance</span>
    </div>
  );
}

function SeatDetails({
  seat, held, today, shiftOf, canManage, canBook, onClose, onBook, onDayPass, onExtend, onRelease, onMaintenance, onBackInService,
}) {
  const maintenance = seat.status === 'maintenance';
  const fullDay = held.morning && held.morning === held.evening;
  const upcoming = upcomingFor(seat, today);
  const slots = fullDay ? [['full', held.morning]] : [['morning', held.morning], ['evening', held.evening]];
  const bothFree = !held.morning && !held.evening;

  return (
    <div className="seat-details">
      <header className="seat-details-head">
        <div className="seat-badge">{seat.label}</div>
        <div>
          <h2>Seat {seat.label}</h2>
          <p>Row {seat.row} · Seat {seat.position}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close seat details"><CloseIcon /></button>
      </header>

      {maintenance ? (
        <div className="maint-box">
          <strong>Under maintenance</strong>
          <p>{seat.notes || 'No reason given.'}</p>
          {canManage && <button className="btn btn-solid btn-sm" onClick={onBackInService}>Back in service</button>}
        </div>
      ) : (
        <>
          <h3 className="seat-section-title">Today</h3>
          <div className="slots">
            {slots.map(([key, a]) => (
              <SlotRow
                key={key}
                shift={shiftOf[key]}
                allocation={a}
                today={today}
                canManage={canBook}
                onBook={() => onBook(key)}
                onExtend={() => onExtend(a)}
                onRelease={() => onRelease(a)}
              />
            ))}
          </div>
          {canBook && bothFree && (
            <div className="slot-extra">
              <button className="btn btn-ghost" onClick={() => onBook('full')}>Full-day plan</button>
              <button className="btn btn-ghost" onClick={onDayPass}>
                <SunIcon width={16} height={16} /> Day pass
              </button>
            </div>
          )}
          {canBook && !bothFree && (
            <button className="link daypass-link" onClick={onDayPass}>Day pass for another date</button>
          )}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <h3 className="seat-section-title">Upcoming</h3>
          <ul className="upcoming">
            {upcoming.map((a) => (
              <li key={a.id}>
                <div>
                  <strong><MemberName allocation={a} /></strong>
                  <span>{bookingShift(a, shiftOf).label} · {isDayPass(a) ? fmtShort(a.startDate) : `${fmtShort(a.startDate)} – ${fmtShort(a.endDate)}`}</span>
                </div>
                {canBook && <button className="link" onClick={() => onRelease(a)}>Cancel</button>}
              </li>
            ))}
          </ul>
        </>
      )}

      {canManage && !maintenance && (
        <button className="link maint-link" onClick={onMaintenance}>Mark seat under maintenance</button>
      )}
    </div>
  );
}

function MemberName({ allocation: a }) {
  const { can } = useAuth();
  if (a.memberId && can('members.view', 'members.manage')) {
    return <Link to={`/admin/members/${a.memberId}`} className="member-link">{a.memberName}</Link>;
  }
  return a.memberName;
}

function SlotRow({ shift, allocation: a, today, canManage, onBook, onExtend, onRelease }) {
  const { can } = useAuth();
  if (!a) {
    return (
      <div className="slot slot-free">
        <div className="slot-shift">
          <strong>{shift.label}</strong>
          <span>{shift.time}</span>
        </div>
        <div className="slot-body">
          <span className="slot-free-label">Available</span>
          {canManage && <button className="btn btn-solid btn-sm" onClick={onBook}>Book</button>}
        </div>
      </div>
    );
  }
  const left = daysBetween(today, a.endDate);
  const expiring = isExpiring(a, today);
  const day = isDayPass(a);
  return (
    <div className={`slot slot-held${expiring ? ' slot-expiring' : ''}${day ? ' slot-day' : ''}`}>
      <div className="slot-shift">
        <strong>{day ? 'Day pass' : shift.label}</strong>
        <span>{shift.time}</span>
      </div>
      <div className="slot-member">
        <strong><MemberName allocation={a} /></strong>
        {a.memberPhone ? <a href={`tel:${a.memberPhone.replace(/\s/g, '')}`}>{a.memberPhone}</a> : <span className="slot-guest">Walk-in guest</span>}
        <span className="slot-dates">
          {day ? (
            <>Today only{!a.memberId && a.memberPhone ? ' · walk-in guest' : ''}</>
          ) : (
            <>
              {fmtShort(a.startDate)} – {fmtShort(a.endDate)} ·{' '}
              <em>{left === 0 ? 'ends today' : `${left} day${left === 1 ? '' : 's'} left`}</em>
            </>
          )}
        </span>
        {a.balance > 0 && can('payments.view', 'payments.manage') && <span className="pay-status pay-unpaid slot-due">{inr(a.balance)} due</span>}
        {a.notes && <span className="slot-notes">{a.notes}</span>}
      </div>
      {canManage && (
        <div className="slot-actions">
          {!day && <button className="btn btn-ghost btn-sm" onClick={onExtend}>Extend</button>}
          <button className="btn btn-ghost btn-sm btn-ghost-danger" onClick={onRelease}>Release</button>
        </div>
      )}
    </div>
  );
}

function MaintenanceModal({ seat, onClose, onSaved }) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      onSaved(await updateSeat(seat.id, { status: 'maintenance', notes }));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Take seat ${seat.label} out of service?`}
      subtitle="It won't be bookable until you mark it back in service."
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="maint-form" className="btn btn-solid" disabled={saving}>
            {saving && <span className="spinner" />} Mark under maintenance
          </button>
        </>
      }
    >
      <form id="maint-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}
        <label className="form-field">
          <span>Reason <em className="optional">optional</em></span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Lamp not working" maxLength={200} />
        </label>
      </form>
    </Modal>
  );
}
