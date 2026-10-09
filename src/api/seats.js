import { api } from './client.js';

export const getHall = () => api('/seats');
export const updateSeat = (id, body) => api(`/seats/${id}`, { method: 'PATCH', body }).then((d) => d.seat);
export const bookSeat = (id, body) => api(`/seats/${id}/allocations`, { method: 'POST', body }).then((d) => d.allocation);
export const extendBooking = (id, endDate, addFee = 0) =>
  api(`/seats/allocations/${id}`, { method: 'PATCH', body: { endDate, addFee } }).then((d) => d.allocation);
export const releaseBooking = (id) => api(`/seats/allocations/${id}/release`, { method: 'POST' });
// Move a booking to another seat for the rest of its plan; resolves to the booking that now holds the seat.
export const moveBooking = (id, seatId) =>
  api(`/seats/allocations/${id}/move`, { method: 'POST', body: { seatId } }).then((d) => d.allocation);

export const EXPIRING_DAYS = 5;
export const DAY_PASS_AHEAD = 30; // day passes can be booked up to this many days ahead (matches the server)

// A one-day pass: the whole day on one date, no shift choice. Stored as a full-day booking with kind 'day'.
export const isDayPass = (a) => a?.kind === 'day' || a?.bookingKind === 'day';

/**
 * Label and hours for a booking (or a payment): its shift, or "Day pass" with full-day hours.
 * `shifts` is the server's list, or a { key: shift } map.
 */
export function bookingShift(a, shifts) {
  const find = (k) => (Array.isArray(shifts) ? shifts.find((s) => s.key === k) : shifts?.[k]);
  if (isDayPass(a)) return { key: 'day', label: 'Day pass', time: find('full')?.time ?? '' };
  return find(a.shift) ?? { key: a.shift, label: a.shift, time: '' };
}

// ---- Calendar-day helpers ("YYYY-MM-DD") ----
const toDate = (s) => new Date(`${s}T00:00:00`);
const toStr = (d) => d.toLocaleDateString('en-CA');

export const addDays = (s, n) => {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return toStr(d);
};

// Last day of an n-month plan starting on `s` (e.g. 5 Oct + 1 month → 4 Nov).
export const planEnd = (s, months) => {
  const d = toDate(s);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return toStr(d);
};

export const daysBetween = (from, to) => Math.round((toDate(to) - toDate(from)) / 86400000);

export const fmtDate = (s) => toDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtShort = (s) => toDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Which booking (if any) holds each shift of a seat on `date`. A full-day booking holds both.
export function shiftsOn(seat, date) {
  const held = { morning: null, evening: null };
  for (const a of seat.allocations) {
    if (a.startDate > date || a.endDate < date) continue;
    if (a.shift === 'full') held.morning = held.evening = a;
    else held[a.shift] = a;
  }
  return held;
}

// Mirrors the server's clash rule: can `seat` take `shift` for every day from start to end?
export const seatFreeFor = (seat, shift, start, end) =>
  seat.status === 'active' &&
  !seat.allocations.some(
    (a) => a.startDate <= end && a.endDate >= start && (a.shift === 'full' || shift === 'full' || a.shift === shift)
  );

export const upcomingFor =(seat, date) => seat.allocations.filter((a) => a.startDate > date);

// Plans ending soon. Day passes always end the same day, so they never count as "expiring".
export const isExpiring = (a, today) => !!a && !isDayPass(a) && daysBetween(today, a.endDate) <= EXPIRING_DAYS;
