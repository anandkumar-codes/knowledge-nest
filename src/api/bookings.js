import { api } from './client.js';
import { fmtDate } from './seats.js';

export const listBookings = (scope = 'open') => api(`/bookings${scope === 'past' ? '?scope=past' : ''}`);
export const getShifts = () => api('/shifts').then((d) => d.shifts);
export const saveShifts = (body) => api('/shifts', { method: 'PUT', body }).then((d) => d.shifts);

// Is booking `b` in effect on `date` (and not released)?
export const activeOn = (b, date) => !b.releasedAt && b.startDate <= date && b.endDate >= date;

// "A10" sorts after "A9": row letter first, then seat number.
export const bySeat = (a, b) =>
  a.seatLabel[0].localeCompare(b.seatLabel[0]) || Number(a.seatLabel.slice(1)) - Number(b.seatLabel.slice(1));

// Opens WhatsApp with a ready-to-send renewal reminder. Assumes Indian numbers when no country code is given.
export function whatsappReminder(b, shiftLabel, today) {
  let digits = b.memberPhone.replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  const first = b.memberName.split(' ')[0];
  const ended = b.endDate < today || b.releasedAt;
  const text = ended
    ? `Hi ${first}, this is Knowledge Nest. Your ${shiftLabel.toLowerCase()} seat ${b.seatLabel} plan ended on ${fmtDate(b.endDate)}. We'd love to have you back. Reply here to book your seat again.`
    : `Hi ${first}, this is Knowledge Nest. Your ${shiftLabel.toLowerCase()} seat ${b.seatLabel} plan ends on ${fmtDate(b.endDate)}. Please renew at the front desk to keep your seat. Thank you!`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
