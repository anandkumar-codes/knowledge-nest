import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { listBookings } from '../api/bookings.js';
import { AssignSeatModal, DayPassModal } from '../components/BookingDialogs.jsx';
import { useToast } from '../components/Toast.jsx';
import { PlusIcon, SunIcon } from '../components/Icons.jsx';
import BookingsList from './bookings/BookingsList.jsx';
import Roster from './bookings/Roster.jsx';
import ShiftTimings from './bookings/ShiftTimings.jsx';
import '../styles/seats.css';
import '../styles/members.css';
import '../styles/bookings.css';

const VIEWS = [
  { key: 'list', label: 'Bookings' },
  { key: 'roster', label: 'Shift roster' },
  { key: 'timings', label: 'Shift timings' },
];

export default function BookingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canBook = can('seats.manage', 'bookings.manage');
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some((v) => v.key === params.get('view')) ? params.get('view') : 'list';

  // Current + upcoming bookings feed both the list and the roster.
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [dayPass, setDayPass] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listBookings('open'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page">
      <header className="page-head no-print">
        <div>
          <p className="page-eyebrow">Reading room</p>
          <h1>Bookings &amp; shifts</h1>
          <p className="page-sub">Every seat booking, today's shift roster and shift timings in one place.</p>
        </div>
        {canBook && data && (
          <div className="head-actions">
            <button className="btn btn-ghost" onClick={() => setDayPass(true)}>
              <SunIcon /> Day pass
            </button>
            <button className="btn btn-solid" onClick={() => setCreating(true)}>
              <PlusIcon /> New booking
            </button>
          </div>
        )}
      </header>

      <nav className="page-tabs no-print" role="tablist" aria-label="Bookings sections">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            className={`page-tab${view === v.key ? ' on' : ''}`}
            onClick={() => setParams(v.key === 'list' ? {} : { view: v.key }, { replace: true })}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {error && !data && <div className="alert">{error}</div>}
      {!data && !error && <div className="page-loading"><span className="spinner spinner-dark" /></div>}

      {data && view === 'list' && <BookingsList data={data} reload={load} canBook={canBook} />}
      {data && view === 'roster' && <Roster data={data} />}
      {view === 'timings' && <ShiftTimings onSaved={load} />}

      {dayPass && (
        <DayPassModal
          today={data.today}
          onClose={() => setDayPass(false)}
          onSaved={(a) => {
            toast(`Day pass booked: seat ${a.seatLabel} for ${a.memberName}.`);
            setDayPass(false);
            load();
          }}
        />
      )}
      {creating && (
        <AssignSeatModal
          today={data.today}
          onClose={() => setCreating(false)}
          onSaved={(a) => {
            toast(`Seat ${a.seatLabel} booked for ${a.memberName}.`);
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}
