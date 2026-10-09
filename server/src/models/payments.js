import { db, now } from '../db.js';

// Every method a payment may have been recorded with (older records can be card or bank transfer).
export const METHODS = ['cash', 'upi', 'card', 'bank'];
// Methods staff can record now.
export const COLLECT_METHODS = ['cash', 'upi'];
export const receiptNo = (id) => `R-${String(id).padStart(5, '0')}`;

const toPayment = (row) =>
  row && {
    id: row.id,
    receiptNo: receiptNo(row.id),
    allocationId: row.allocation_id,
    memberId: row.member_id,
    memberName: row.member_name,
    memberCode: row.member_id ? `KN-${String(row.member_id).padStart(4, '0')}` : null,
    bookingFee: row.booking_fee,
    bookingPaid: row.booking_paid,
    paidBefore: row.paid_before,
    memberPhone: row.member_phone,
    seatLabel: row.seat_label,
    shift: row.shift,
    bookingKind: row.booking_kind ?? 'plan',
    startDate: row.start_date,
    endDate: row.end_date,
    kind: row.kind,
    amount: row.amount,
    method: row.method,
    reference: row.reference,
    paidOn: row.paid_on,
    notes: row.notes,
    receivedBy: row.received_by_name ?? null,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by_name ?? null,
    voidReason: row.void_reason,
  };

const SELECT = `
  SELECT p.*, COALESCE(m.name, a.member_name) AS member_name, COALESCE(m.phone, a.member_phone) AS member_phone,
         s.label AS seat_label, a.shift, a.kind AS booking_kind, a.start_date, a.end_date, a.fee AS booking_fee,
         (SELECT COALESCE(SUM(CASE p2.kind WHEN 'refund' THEN -p2.amount ELSE p2.amount END), 0)
            FROM payments p2 WHERE p2.allocation_id = a.id AND p2.voided_at IS NULL) AS booking_paid,
         -- what had been paid on this booking before this payment, for "balance after" on the receipt
         (SELECT COALESCE(SUM(CASE p3.kind WHEN 'refund' THEN -p3.amount ELSE p3.amount END), 0)
            FROM payments p3
           WHERE p3.allocation_id = p.allocation_id AND p3.voided_at IS NULL
             AND (p3.paid_on < p.paid_on OR (p3.paid_on = p.paid_on AND p3.id < p.id))) AS paid_before,
         r.name AS received_by_name, v.name AS voided_by_name
  FROM payments p
  JOIN seat_allocations a ON a.id = p.allocation_id
  JOIN seats s ON s.id = a.seat_id
  LEFT JOIN members m ON m.id = p.member_id
  LEFT JOIN users r ON r.id = p.received_by
  LEFT JOIN users v ON v.id = p.voided_by`;

export const findPayment = (id) => toPayment(db.prepare(`${SELECT} WHERE p.id = ?`).get(id));

// Payments whose paid_on falls within [from, to], newest first. Voided ones are included (and flagged).
export const listPaymentsBetween = (from, to) =>
  db.prepare(`${SELECT} WHERE p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on DESC, p.id DESC`).all(from, to).map(toPayment);

export const listMemberPayments = (memberId) =>
  db.prepare(`${SELECT} WHERE p.member_id = ? ORDER BY p.paid_on DESC, p.id DESC`).all(memberId).map(toPayment);

// Net money in (payments minus refunds, ignoring voided) for a date range.
export const netCollected = (from, to) =>
  db
    .prepare(
      `SELECT COALESCE(SUM(CASE kind WHEN 'refund' THEN -amount ELSE amount END), 0) AS net
       FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ? AND ?`
    )
    .get(from, to).net;

export function createPayment({ allocation, kind = 'payment', amount, method, reference = '', paidOn, notes = '', receivedBy }) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO payments (allocation_id, member_id, kind, amount, method, reference, paid_on, notes, received_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(allocation.id, allocation.memberId, kind, amount, method, reference, paidOn, notes, receivedBy, now());
  return findPayment(Number(lastInsertRowid));
}

export function voidPayment(id, reason, userId) {
  db.prepare('UPDATE payments SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?').run(now(), userId, reason, id);
  return findPayment(id);
}
