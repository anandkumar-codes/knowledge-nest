import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { createMember, listMembers, standing } from '../api/members.js';
import { recordPayment } from '../api/payments.js';
import {
  DAY_PASS_AHEAD, addDays, bookSeat, daysBetween, extendBooking, fmtDate, fmtShort, getHall, moveBooking, planEnd,
  seatFreeFor,
} from '../api/seats.js';
import { initials } from './AdminLayout.jsx';
import Modal from './Modal.jsx';
import { useCashConfirm, useFeeAndPayment } from './PaymentDialogs.jsx';
import { SearchIcon } from './Icons.jsx';
import '../styles/seats.css';
import '../styles/members.css';

const PLANS = [
  { months: 1, label: '1 month' },
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 0, label: 'Custom' },
];

// Shift, start date and plan length. Returns the computed end date through `plan.endDate`.
function usePlan(today, shift) {
  const [plan, setPlan] = useState({ shift, startDate: today, months: 1, customEnd: planEnd(today, 1) });
  const endDate = plan.months ? planEnd(plan.startDate || today, plan.months) : plan.customEnd;
  const days = plan.startDate && endDate ? daysBetween(plan.startDate, endDate) + 1 : 0;
  return { plan: { ...plan, endDate, days }, setPlan };
}

function PlanFields({ plan, setPlan, today, shifts }) {
  const set = (k) => (e) => setPlan((p) => ({ ...p, [k]: e.target.value }));
  return (
    <>
      <fieldset className="form-field">
        <span>Shift</span>
        <div className="choice-cards">
          {shifts.map((s) => (
            <label key={s.key} className={plan.shift === s.key ? 'on' : ''}>
              <input type="radio" name="shift" value={s.key} checked={plan.shift === s.key} onChange={set('shift')} />
              <strong>{s.label}</strong>
              <span>{s.time}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-row form-row-even">
        <label className="form-field">
          <span>Start date</span>
          <input className="input" type="date" value={plan.startDate} min={today} onChange={set('startDate')} />
        </label>
        <label className="form-field">
          <span>Plan</span>
          <select
            className="input"
            value={plan.months}
            onChange={(e) => setPlan((p) => ({ ...p, months: Number(e.target.value), customEnd: plan.endDate }))}
          >
            {PLANS.map((p) => <option key={p.months} value={p.months}>{p.label}</option>)}
          </select>
        </label>
      </div>
      {plan.months === 0 && (
        <label className="form-field">
          <span>End date</span>
          <input className="input" type="date" value={plan.customEnd} min={plan.startDate} onChange={set('customEnd')} />
        </label>
      )}
    </>
  );
}

/**
 * Search existing members or register a new one inline.
 * `value` is { member } for an existing member or { draft: { name, phone } } for a new one.
 */
function MemberPicker({ value, onChange, today, allowNew = true }) {
  const { can } = useAuth();
  const canCreate = allowNew && can('members.manage');
  const [members, setMembers] = useState(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    listMembers()
      .then((d) => setMembers(d.members.filter((m) => m.status === 'active')))
      .catch(() => setMembers([]));
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!members || !q) return [];
    const digits = q.replace(/\D/g, '');
    return members
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.code.toLowerCase().includes(q) ||
          (digits.length >= 3 && m.phone.replace(/\D/g, '').includes(digits))
      )
      .slice(0, 6);
  }, [members, query]);

  if (value?.member) {
    const m = value.member;
    const seats = standing(m, today).current.map((b) => b.seatLabel);
    return (
      <div className="picked-member">
        <span className="avatar">{initials(m.name)}</span>
        <div>
          <strong>{m.name}</strong>
          <span>{m.code} · {m.phone}{seats.length ? ` · has seat ${seats.join(', ')}` : ''}</span>
        </div>
        <button type="button" className="link" onClick={() => { onChange(null); setTimeout(() => inputRef.current?.focus()); }}>
          Change
        </button>
      </div>
    );
  }

  if (value?.draft) {
    const set = (k) => (e) => onChange({ draft: { ...value.draft, [k]: e.target.value } });
    return (
      <div className="new-member-box">
        <div className="new-member-head">
          <strong>New member</strong>
          <button type="button" className="link" onClick={() => onChange(null)}>Search instead</button>
        </div>
        <div className="form-row form-row-even">
          <label className="form-field">
            <span>Full name</span>
            <input className="input" value={value.draft.name} onChange={set('name')} placeholder="e.g. Ravi Kumar" maxLength={80} autoFocus />
          </label>
          <label className="form-field">
            <span>Phone</span>
            <input className="input" type="tel" value={value.draft.phone} onChange={set('phone')} placeholder="98765 43210" />
          </label>
        </div>
        <small className="hint">You can add their other details from the Members page later.</small>
      </div>
    );
  }

  const startDraft = () => {
    const isPhone = /^[\d\s+-]+$/.test(query.trim());
    onChange({ draft: { name: isPhone ? '' : query.trim(), phone: isPhone ? query.trim() : '' } });
  };

  return (
    <div className="member-picker">
      <div className="search">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={members ? 'Search by name, phone or member code' : 'Loading members…'}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          aria-label="Find member"
          autoFocus
        />
      </div>
      {open && query.trim() && (
        <ul className="picker-list" role="listbox">
          {matches.map((m) => {
            const st = standing(m, today);
            return (
              <li key={m.id}>
                <button type="button" onClick={() => onChange({ member: m })} role="option" aria-selected="false">
                  <span className="avatar">{initials(m.name)}</span>
                  <span className="picker-text">
                    <strong>{m.name}</strong>
                    <span>{m.code} · {m.phone}</span>
                  </span>
                  {st.current.length > 0 && <span className="badge">{st.current.map((b) => b.seatLabel).join(', ')}</span>}
                </button>
              </li>
            );
          })}
          {matches.length === 0 && <li className="picker-empty">No member matches "{query.trim()}".</li>}
        </ul>
      )}
      {canCreate && (
        <button type="button" className="link picker-new" onClick={startDraft}>
          + Register a new member{query.trim() ? ` "${query.trim()}"` : ''}
        </button>
      )}
    </div>
  );
}

// Book a specific seat (from the Seats page) for an existing or new member.
export function BookSeatModal({ seat, shift, today, shifts, onClose, onSaved }) {
  const { plan, setPlan } = usePlan(today, shift);
  const money = useFeeAndPayment({ shift: plan.shift, months: plan.months, days: plan.days });
  const { confirmCash, cashDialog } = useCashConfirm();
  const [who, setWho] = useState(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const shiftInfo = shifts.find((s) => s.key === plan.shift);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!who) return setError('Choose a member or register a new one.');
    if (who.draft && (!who.draft.name.trim() || !who.draft.phone.trim())) return setError("Enter the new member's name and phone.");
    if (plan.days < 1) return setError('End date must be on or after the start date.');
    if (money.error) return setError(money.error);
    if (!money.check()) return;
    const payer = who.member?.name ?? who.draft.name;
    if (money.payment?.method === 'cash' && !(await confirmCash({ amount: money.payment.amount, who: payer }))) return;
    setSaving(true);
    try {
      let member = who.member;
      if (who.draft) {
        member = await createMember({ name: who.draft.name, phone: who.draft.phone, joinedOn: plan.startDate });
        setWho({ member: { ...member, bookings: [] } }); // don't re-create it if booking fails
      }
      onSaved(
        await bookSeat(seat.id, {
          memberId: member.id, shift: plan.shift, startDate: plan.startDate, endDate: plan.endDate, notes,
          fee: money.fee, payment: money.payment,
        })
      );
    } catch (err) {
      if (!money.takeError(err.message)) setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Book seat ${seat.label}`}
      subtitle="Choose the member, shift and plan length."
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="foot-note">{plan.days > 0 ? `${plan.days} day${plan.days === 1 ? '' : 's'}` : ''}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="book-form" className="btn btn-solid" disabled={saving}>
            {saving && <span className="spinner" />} Book seat
          </button>
        </>
      }
    >
      <form id="book-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}
        <div className="form-field">
          <span>Member</span>
          <MemberPicker value={who} onChange={setWho} today={today} />
        </div>
        <PlanFields plan={plan} setPlan={setPlan} today={today} shifts={shifts} />
        {money.ui}
        <label className="form-field">
          <span>Notes <em className="optional">optional</em></span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Prefers locker 12" maxLength={200} />
        </label>
        {plan.days > 0 && (
          <div className="note">
            Seat <strong>{seat.label}</strong> · {shiftInfo.label} ({shiftInfo.time}) · {fmtDate(plan.startDate)} – {fmtDate(plan.endDate)}
          </div>
        )}
      </form>
      {cashDialog}
    </Modal>
  );
}

// Book a seat for a member: pick shift + dates, then any seat that's free for that whole period.
// Pass `member` to book for a known member (profile page); omit it to choose one first (Bookings page).
export function AssignSeatModal({ member, today, onClose, onSaved }) {
  const [hall, setHall] = useState(null);
  const { plan, setPlan } = usePlan(today, 'morning');
  const money = useFeeAndPayment({ shift: plan.shift, months: plan.months, days: plan.days });
  const { confirmCash, cashDialog } = useCashConfirm();
  const [who, setWho] = useState(member ? { member } : null);
  const [seatId, setSeatId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getHall().then(setHall).catch((err) => setError(err.message));
  }, []);

  const free = useMemo(() => {
    if (!hall || plan.days < 1) return new Set();
    return new Set(hall.seats.filter((s) => seatFreeFor(s, plan.shift, plan.startDate, plan.endDate)).map((s) => s.id));
  }, [hall, plan.shift, plan.startDate, plan.endDate, plan.days]);

  // Drop the chosen seat if new dates/shift make it unavailable.
  useEffect(() => {
    if (seatId && !free.has(seatId)) setSeatId(null);
  }, [free, seatId]);

  const rows = useMemo(() => {
    const byRow = {};
    for (const s of hall?.seats ?? []) (byRow[s.row] ??= []).push(s);
    return Object.entries(byRow);
  }, [hall]);
  const seat = hall?.seats.find((s) => s.id === seatId);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!who) return setError('Choose a member or register a new one.');
    if (who.draft && (!who.draft.name.trim() || !who.draft.phone.trim())) return setError("Enter the new member's name and phone.");
    if (plan.days < 1) return setError('End date must be on or after the start date.');
    if (!seat) return setError('Pick a seat from the plan.');
    if (money.error) return setError(money.error);
    if (!money.check()) return;
    const payer = who.member?.name ?? who.draft.name;
    if (money.payment?.method === 'cash' && !(await confirmCash({ amount: money.payment.amount, who: payer }))) return;
    setSaving(true);
    try {
      let target = who.member;
      if (who.draft) {
        target = await createMember({ name: who.draft.name, phone: who.draft.phone, joinedOn: plan.startDate });
        setWho({ member: { ...target, bookings: [] } }); // don't re-create it if booking fails
      }
      onSaved(
        await bookSeat(seat.id, {
          memberId: target.id, shift: plan.shift, startDate: plan.startDate, endDate: plan.endDate,
          fee: money.fee, payment: money.payment,
        })
      );
    } catch (err) {
      if (!money.takeError(err.message)) setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={member ? `Assign a seat to ${member.name}` : 'New booking'}
      subtitle={member ? 'Pick the shift and plan, then choose any highlighted seat.' : 'Choose the member, shift and plan, then any highlighted seat.'}
      onClose={onClose}
      width={680}
      footer={
        <>
          <span className="foot-note">
            {seat ? `Seat ${seat.label} · ${fmtShort(plan.startDate)} – ${fmtShort(plan.endDate)}` : `${free.size} seats free for this period`}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="assign-form" className="btn btn-solid" disabled={saving || !seat}>
            {saving && <span className="spinner" />} {seat ? `Book ${seat.label}` : 'Book seat'}
          </button>
        </>
      }
    >
      <form id="assign-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}
        {!hall ? (
          <div className="page-loading" style={{ minHeight: 200 }}><span className="spinner spinner-dark" /></div>
        ) : (
          <>
            {!member && (
              <div className="form-field">
                <span>Member</span>
                <MemberPicker value={who} onChange={setWho} today={today} />
              </div>
            )}
            <PlanFields plan={plan} setPlan={setPlan} today={today} shifts={hall.shifts} />
            <div className="form-field">
              <span>Seat</span>
              <div className="picker-hall" style={{ '--cols': hall.layout.seatsPerRow }}>
                {rows.map(([row, seats]) => (
                  <div className="picker-row" key={row}>
                    <span className="row-label">{row}</span>
                    {seats.map((s) => {
                      const ok = free.has(s.id);
                      return (
                        <button
                          type="button"
                          key={s.id}
                          className={`pick-seat${ok ? ' is-free' : ''}${s.id === seatId ? ' is-picked' : ''}${s.position === hall.layout.aisleAfter ? ' aisle-after' : ''}`}
                          disabled={!ok}
                          onClick={() => setSeatId(s.id)}
                          aria-pressed={s.id === seatId}
                          aria-label={`Seat ${s.label}${ok ? '' : ', not available'}`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            {money.ui}
          </>
        )}
      </form>
      {cashDialog}
    </Modal>
  );
}

const dayLabel = (d) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * One-day pass: a seat for the whole day on a single date, with no shift or plan choice.
 * For a walk-in guest (just a name, no member record or portal) or an existing member.
 * Pass `seat` to book that seat (Seats page); omit it to pick any seat free that day.
 */
export function DayPassModal({ seat: fixedSeat, today, onClose, onSaved }) {
  const [hall, setHall] = useState(null);
  const [mode, setMode] = useState('guest'); // 'guest' | 'member'
  const [guest, setGuest] = useState({ name: '', phone: '' });
  const [who, setWho] = useState(null);
  const [date, setDate] = useState(today);
  const [seatId, setSeatId] = useState(fixedSeat?.id ?? null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const money = useFeeAndPayment({ dayPass: true, label: 'Day pass fee' });
  const { confirmCash, cashDialog } = useCashConfirm();
  const lastDay = addDays(today, DAY_PASS_AHEAD);
  const validDate = !!date && date >= today && date <= lastDay;

  useEffect(() => {
    getHall().then(setHall).catch((err) => setError(err.message));
  }, []);

  // A day pass needs the seat free for the whole day (both shifts).
  const free = useMemo(() => {
    if (!hall || !validDate) return new Set();
    return new Set(hall.seats.filter((s) => seatFreeFor(s, 'full', date, date)).map((s) => s.id));
  }, [hall, date, validDate]);

  useEffect(() => {
    if (!fixedSeat && seatId && hall && !free.has(seatId)) setSeatId(null);
  }, [fixedSeat, free, seatId, hall]);

  const rows = useMemo(() => {
    const byRow = {};
    for (const s of hall?.seats ?? []) (byRow[s.row] ??= []).push(s);
    return Object.entries(byRow);
  }, [hall]);
  const seat = hall?.seats.find((s) => s.id === seatId) ?? fixedSeat ?? null;
  const seatTaken = !!(hall && seat && validDate && !free.has(seat.id));
  const fullDay = hall?.shifts.find((s) => s.key === 'full');
  const name = mode === 'guest' ? guest.name.trim() : who?.member?.name;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'guest' && !guest.name.trim()) return setError("Enter the visitor's name.");
    if (mode === 'member' && !who?.member) return setError('Choose a member.');
    if (!validDate) return setError(`Pick a date between today and ${fmtDate(lastDay)}.`);
    if (!seat) return setError('Pick a seat from the plan.');
    if (seatTaken) return setError(`Seat ${seat.label} isn't free for the whole day on ${fmtDate(date)}.`);
    if (money.error) return setError(money.error);
    if (!money.check()) return;
    if (money.payment?.method === 'cash' && !(await confirmCash({ amount: money.payment.amount, who: name }))) return;
    setSaving(true);
    try {
      onSaved(
        await bookSeat(seat.id, {
          kind: 'day',
          date,
          ...(mode === 'guest' ? { guest: { name: guest.name, phone: guest.phone } } : { memberId: who.member.id }),
          notes,
          fee: money.fee,
          payment: money.payment,
        })
      );
    } catch (err) {
      if (!money.takeError(err.message)) setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={fixedSeat ? `Day pass · seat ${fixedSeat.label}` : 'Day pass'}
      subtitle={`A seat for one whole day${fullDay?.time ? ` (${fullDay.time})` : ''}. No shift or plan to choose.`}
      onClose={onClose}
      width={fixedSeat ? 520 : 680}
      footer={
        <>
          <span className="foot-note">
            {seat && validDate ? `Seat ${seat.label} · ${dayLabel(date)}` : !fixedSeat && hall && validDate ? `${free.size} seats free all day` : ''}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="daypass-form" className="btn btn-solid" disabled={saving || !seat || seatTaken}>
            {saving && <span className="spinner" />} Book day pass
          </button>
        </>
      }
    >
      <form id="daypass-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}
        <fieldset className="form-field">
          <span>Who's coming</span>
          <div className="choice-cards choice-cards-2">
            <label className={mode === 'guest' ? 'on' : ''}>
              <input type="radio" name="who" value="guest" checked={mode === 'guest'} onChange={() => setMode('guest')} />
              <strong>Walk-in guest</strong>
              <span>Just a name, no registration</span>
            </label>
            <label className={mode === 'member' ? 'on' : ''}>
              <input type="radio" name="who" value="member" checked={mode === 'member'} onChange={() => setMode('member')} />
              <strong>Existing member</strong>
              <span>Adds to their history</span>
            </label>
          </div>
        </fieldset>

        {mode === 'guest' ? (
          <div className="form-row form-row-even">
            <label className="form-field">
              <span>Name</span>
              <input
                className="input"
                value={guest.name}
                onChange={(e) => setGuest((g) => ({ ...g, name: e.target.value }))}
                placeholder="e.g. Kiran Rao"
                maxLength={80}
                autoFocus
              />
            </label>
            <label className="form-field">
              <span>Phone <em className="optional">optional</em></span>
              <input
                className="input"
                type="tel"
                value={guest.phone}
                onChange={(e) => setGuest((g) => ({ ...g, phone: e.target.value }))}
                placeholder="98765 43210"
              />
            </label>
          </div>
        ) : (
          <div className="form-field">
            <span>Member</span>
            <MemberPicker value={who} onChange={setWho} today={today} allowNew={false} />
          </div>
        )}

        <div className="form-field">
          <span>Date</span>
          <div className="daypass-date">
            <input
              className="input"
              type="date"
              value={date}
              min={today}
              max={lastDay}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Day pass date"
            />
            <div className="quick-dates">
              {[['Today', today], ['Tomorrow', addDays(today, 1)]].map(([label, d]) => (
                <button type="button" key={label} className={`quick-date${date === d ? ' on' : ''}`} onClick={() => setDate(d)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {fixedSeat ? (
          seatTaken && <div className="alert">Seat {fixedSeat.label} is booked on {fmtDate(date)}. Choose another date, or book from the Bookings page to pick a different seat.</div>
        ) : !hall ? (
          <div className="page-loading" style={{ minHeight: 160 }}><span className="spinner spinner-dark" /></div>
        ) : (
          <div className="form-field">
            <span>Seat free all day{validDate ? ` on ${dayLabel(date)}` : ''}</span>
            <div className="picker-hall" style={{ '--cols': hall.layout.seatsPerRow }}>
              {rows.map(([row, seats]) => (
                <div className="picker-row" key={row}>
                  <span className="row-label">{row}</span>
                  {seats.map((s) => {
                    const ok = free.has(s.id);
                    return (
                      <button
                        type="button"
                        key={s.id}
                        className={`pick-seat${ok ? ' is-free' : ''}${s.id === seatId ? ' is-picked' : ''}${s.position === hall.layout.aisleAfter ? ' aisle-after' : ''}`}
                        disabled={!ok}
                        onClick={() => setSeatId(s.id)}
                        aria-pressed={s.id === seatId}
                        aria-label={`Seat ${s.label}${ok ? '' : ', not available'}`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {money.ui}
        <label className="form-field">
          <span>Notes <em className="optional">optional</em></span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. ID checked" maxLength={200} />
        </label>
      </form>
      {cashDialog}
    </Modal>
  );
}

export function ExtendModal({ allocation: a, today, onClose, onSaved }) {
  const from = addDays(a.endDate, 1);
  const options = [
    { key: '1', label: '+1 month', date: planEnd(from, 1) },
    { key: '3', label: '+3 months', date: planEnd(from, 3) },
    { key: 'custom', label: 'Custom', date: null },
  ];
  const [choice, setChoice] = useState('1');
  const [custom, setCustom] = useState(planEnd(from, 1));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const endDate = choice === 'custom' ? custom : options.find((o) => o.key === choice).date;
  const money = useFeeAndPayment({
    shift: a.shift,
    months: choice === 'custom' ? 0 : Number(choice),
    days: endDate ? Math.max(daysBetween(a.endDate, endDate), 0) : 0,
    label: 'Fee for the extra time',
  });
  const { confirmCash, cashDialog } = useCashConfirm();

  const submit = async (e) => {
    e.preventDefault();
    if (money.error) return setError(money.error);
    if (!money.check()) return;
    if (money.payment?.method === 'cash' && !(await confirmCash({ amount: money.payment.amount, who: a.memberName }))) return;
    setSaving(true);
    setError('');
    try {
      const extended = await extendBooking(a.id, endDate, money.fee);
      if (money.payment) {
        const { booking } = await recordPayment({ allocationId: a.id, ...money.payment });
        return onSaved(booking);
      }
      onSaved(extended);
    } catch (err) {
      if (!money.takeError(err.message)) setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Extend ${a.memberName}'s booking`}
      subtitle={`Seat ${a.seatLabel} · currently ends ${fmtDate(a.endDate)}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="extend-form" className="btn btn-solid" disabled={saving || !endDate}>
            {saving && <span className="spinner" />} Extend to {endDate ? fmtShort(endDate) : '…'}
          </button>
        </>
      }
    >
      <form id="extend-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}
        <div className="choice-cards">
          {options.map((o) => (
            <label key={o.key} className={choice === o.key ? 'on' : ''}>
              <input type="radio" name="ext" value={o.key} checked={choice === o.key} onChange={() => setChoice(o.key)} />
              <strong>{o.label}</strong>
              <span>{o.date ? `until ${fmtShort(o.date)}` : 'pick a date'}</span>
            </label>
          ))}
        </div>
        {choice === 'custom' && (
          <label className="form-field">
            <span>New end date</span>
            <input
              className="input"
              type="date"
              value={custom}
              min={today > a.startDate ? today : a.startDate}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
        )}
        {money.ui}
      </form>
      {cashDialog}
    </Modal>
  );
}

/**
 * Move a member's booking to another seat for the rest of their plan: same shift, same end date,
 * fee and payments unchanged. Only seats free for that shift from today to the plan's end can be picked.
 */
export function ChangeSeatModal({ booking: b, today, onClose, onSaved }) {
  const [hall, setHall] = useState(null);
  const [seatId, setSeatId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const from = b.startDate > today ? b.startDate : today;
  const midPlan = b.startDate < today;

  useEffect(() => {
    getHall().then(setHall).catch((err) => setError(err.message));
  }, []);

  const shift = hall?.shifts.find((s) => s.key === b.shift);
  const free = useMemo(() => {
    if (!hall) return new Set();
    return new Set(
      hall.seats
        .filter((s) => s.id !== b.seatId && seatFreeFor({ ...s, allocations: s.allocations.filter((a) => a.id !== b.id) }, b.shift, from, b.endDate))
        .map((s) => s.id)
    );
  }, [hall, b.id, b.seatId, b.shift, b.endDate, from]);

  const rows = useMemo(() => {
    const byRow = {};
    for (const s of hall?.seats ?? []) (byRow[s.row] ??= []).push(s);
    return Object.entries(byRow);
  }, [hall]);
  const seat = hall?.seats.find((s) => s.id === seatId);

  const submit = async () => {
    if (!seat) return setError('Pick a seat from the plan.');
    setSaving(true);
    setError('');
    try {
      onSaved(await moveBooking(b.id, seat.id));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Change seat for ${b.memberName}`}
      subtitle={shift ? `${shift.label} (${shift.time}) · plan ends ${fmtDate(b.endDate)}` : ''}
      onClose={onClose}
      width={680}
      footer={
        <>
          <span className="foot-note">{hall ? `${free.size} seats free for the rest of this plan` : ''}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-solid" onClick={submit} disabled={saving || !seat}>
            {saving && <span className="spinner" />} {seat ? `Move to ${seat.label}` : 'Move'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        {error && <div className="alert">{error}</div>}
        <div className="move-summary">
          <div>
            <span>Current seat</span>
            <strong className="seat-pill">{b.seatLabel}</strong>
          </div>
          <span className="move-arrow" aria-hidden="true">→</span>
          <div>
            <span>New seat</span>
            <strong className={`seat-pill${seat ? '' : ' seat-pill-empty'}`}>{seat?.label ?? '?'}</strong>
          </div>
          <p>
            {midPlan
              ? `From today (${fmtShort(from)}) until ${fmtShort(b.endDate)}. Their time on ${b.seatLabel} until yesterday stays in their history.`
              : `For the whole plan, ${fmtShort(from)} – ${fmtShort(b.endDate)}.`}{' '}
            Shift, fee and payments don't change.
          </p>
        </div>
        {!hall ? (
          <div className="page-loading" style={{ minHeight: 200 }}><span className="spinner spinner-dark" /></div>
        ) : (
          <div className="form-field">
            <span>Choose a seat free for the {shift?.label.toLowerCase()} shift</span>
            <div className="picker-hall">
              {rows.map(([row, seats]) => (
                <div className="picker-row" key={row}>
                  <span className="row-label">{row}</span>
                  {seats.map((s) => {
                    const ok = free.has(s.id);
                    const current = s.id === b.seatId;
                    return (
                      <button
                        type="button"
                        key={s.id}
                        className={`pick-seat${ok ? ' is-free' : ''}${current ? ' is-current' : ''}${s.id === seatId ? ' is-picked' : ''}${s.position === hall.layout.aisleAfter ? ' aisle-after' : ''}`}
                        disabled={!ok}
                        onClick={() => setSeatId(s.id)}
                        aria-pressed={s.id === seatId}
                        aria-label={`Seat ${s.label}${current ? ', current seat' : ok ? '' : s.status === 'maintenance' ? ', under maintenance' : ', taken'}`}
                        title={current ? 'Current seat' : s.status === 'maintenance' ? 'Under maintenance' : ok ? '' : 'Taken for this shift during the plan'}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="picker-legend">
              <span><i className="pick-seat is-free" /> Free</span>
              <span><i className="pick-seat is-current" /> Current seat</span>
              <span><i className="pick-seat" /> Taken or maintenance</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
