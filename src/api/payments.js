import { api } from './client.js';
import { fmtDate } from './seats.js';
import { native } from '../platform/native.js';

export const listPayments = (from, to) => {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  return api(`/payments${q.size ? `?${q}` : ''}`);
};
export const listDues = () => api('/payments/dues');
export const recordPayment = (body) => api('/payments', { method: 'POST', body });
export const voidPayment = (id, reason) => api(`/payments/${id}/void`, { method: 'POST', body: { reason } }).then((d) => d.payment);
export const adjustFee = (bookingId, fee) =>
  api(`/payments/bookings/${bookingId}/fee`, { method: 'PATCH', body: { fee } }).then((d) => d.booking);
export const getFees = () => api('/fees').then((d) => d.fees);
export const saveFees = (fees) => api('/fees', { method: 'PUT', body: fees }).then((d) => d.fees);

export const METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'upi', label: 'UPI' },
  { key: 'card', label: 'Card' },
  { key: 'bank', label: 'Bank transfer' },
];
export const methodLabel = (key) => METHODS.find((m) => m.key === key)?.label ?? key;
// Staff record payments in cash or UPI only; card and bank transfer remain for older records.
export const COLLECT_METHODS = METHODS.filter((m) => m.key === 'cash' || m.key === 'upi');
// Methods to list in totals: cash and UPI always, older ones only when they have money against them.
export const methodsWithTotals = (byMethod) =>
  METHODS.filter((m) => COLLECT_METHODS.includes(m) || (byMethod?.[m.key] ?? 0) !== 0);

// ₹1,23,456 (Indian digit grouping)
export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

// Suggested fee: monthly price × months, or pro-rated by day (30-day month) for custom plans.
export function suggestedFee(fees, shift, months, days) {
  const monthly = fees?.[shift] ?? 0;
  return months ? monthly * months : Math.round((monthly * days) / 30);
}

export function paymentStatus(b) {
  if (!b.fee) return { key: 'nofee', label: 'No fee set' };
  if (b.balance <= 0) return { key: 'paid', label: 'Paid' };
  if (b.paid > 0) return { key: 'partial', label: `${inr(b.balance)} due` };
  return { key: 'unpaid', label: `${inr(b.balance)} due` };
}

// WhatsApp message asking a member to clear their dues.
export function duesReminder(b, shiftLabel) {
  let digits = b.memberPhone.replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  const first = b.memberName.split(' ')[0];
  const what =
    b.kind === 'day'
      ? `day pass for seat ${b.seatLabel} on ${fmtDate(b.startDate)}`
      : `${shiftLabel.toLowerCase()} seat ${b.seatLabel} (${fmtDate(b.startDate)} – ${fmtDate(b.endDate)})`;
  const text =
    `Hi ${first}, this is Knowledge Nest. A balance of ${inr(b.balance)} is pending for your ${what}. ` +
    'Please pay at the front desk or by UPI. Thank you!';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// Download rows as a CSV file (opens in Excel / Google Sheets).
export function downloadCsv(filename, header, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  // Android app: save to the phone's Documents folder and open it in a spreadsheet app.
  if (native) return native.saveFile(blob, filename, 'text/csv', 'documents').then((uri) => native.openFile(uri, 'text/csv'));
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Online (UPI) payments submitted from the member portal ----
export const listClaims = (status) => api(`/payments/claims${status ? `?status=${status}` : ''}`);
export const approveClaim = (id) => api(`/payments/claims/${id}/approve`, { method: 'POST' });
export const rejectClaim = (id, reason) => api(`/payments/claims/${id}/reject`, { method: 'POST', body: { reason } }).then((d) => d.claim);
