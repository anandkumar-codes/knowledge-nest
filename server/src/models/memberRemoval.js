// Removing archived members: what's linked to them, and the two ways to remove them.
import { db, now, transaction } from '../db.js';

const one = (sql, ...args) => db.prepare(sql).get(...args);

// Everything connected to a member, so staff can decide how (and whether) to delete them.
export function relatedRecords(memberId, today) {
  const bookings = one(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT seat_id) AS seats,
            MIN(start_date) AS first, MAX(end_date) AS last,
            SUM(CASE WHEN released_at IS NULL AND end_date >= ? THEN 1 ELSE 0 END) AS open
     FROM seat_allocations WHERE member_id = ?`,
    today, memberId
  );
  const payments = one(
    `SELECT SUM(CASE WHEN voided_at IS NULL THEN 1 ELSE 0 END) AS count,
            COALESCE(SUM(CASE WHEN voided_at IS NULL AND kind = 'payment' THEN amount END), 0) AS received,
            COALESCE(SUM(CASE WHEN voided_at IS NULL AND kind = 'refund' THEN amount END), 0) AS refunded,
            SUM(CASE WHEN voided_at IS NOT NULL THEN 1 ELSE 0 END) AS voided,
            MAX(CASE WHEN voided_at IS NULL THEN paid_on END) AS last
     FROM payments WHERE member_id = ?`,
    memberId
  );
  const claims = one(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
     FROM payment_claims WHERE member_id = ?`,
    memberId
  );
  const dues = one(
    `SELECT COALESCE(SUM(balance), 0) AS total, COUNT(*) AS bookings FROM (
       SELECT a.fee - COALESCE((SELECT SUM(CASE p.kind WHEN 'refund' THEN -p.amount ELSE p.amount END)
                               FROM payments p WHERE p.allocation_id = a.id AND p.voided_at IS NULL), 0) AS balance
       FROM seat_allocations a WHERE a.member_id = ?
     ) WHERE balance > 0`,
    memberId
  );
  const portal = one('SELECT portal_enabled FROM members WHERE id = ?', memberId);
  const seatLabels = db
    .prepare(
      `SELECT DISTINCT s.label FROM seat_allocations a JOIN seats s ON s.id = a.seat_id
       WHERE a.member_id = ? ORDER BY s.label LIMIT 6`
    )
    .all(memberId)
    .map((r) => r.label);

  return {
    bookings: { total: bookings.total, open: bookings.open ?? 0, seats: seatLabels, seatCount: bookings.seats, first: bookings.first, last: bookings.last },
    payments: {
      count: payments.count ?? 0,
      received: payments.received,
      refunded: payments.refunded,
      voided: payments.voided ?? 0,
      last: payments.last,
    },
    claims: { total: claims.total, pending: claims.pending ?? 0 },
    dues: { total: dues.total, bookings: dues.bookings },
    portalEnabled: !!portal?.portal_enabled,
  };
}

// Keep bookings and payments (so reports stay correct) but wipe everything that identifies the person.
export function anonymizeMember(memberId) {
  transaction(() => {
    db.prepare(
      `UPDATE members SET name = 'Deleted member', phone = '', phone_key = ?, email = '', gender = '',
              guardian_phone = '', address = '', preparing_for = '', notes = '', status = 'archived',
              portal_enabled = 0, portal_password_hash = NULL, anonymized_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(`deleted-${memberId}`, now(), now(), memberId);
    // Bookings keep a copy of the name and phone taken when they were made.
    db.prepare("UPDATE seat_allocations SET member_name = 'Deleted member', member_phone = '' WHERE member_id = ?").run(memberId);
    db.prepare("UPDATE payment_claims SET note = '' WHERE member_id = ?").run(memberId);
  });
}

// Remove the member and everything linked to them. Payments go too, so past revenue figures change.
export function eraseMember(memberId) {
  transaction(() => {
    const allocations = 'SELECT id FROM seat_allocations WHERE member_id = ?';
    db.prepare(`DELETE FROM payment_claims WHERE member_id = ? OR allocation_id IN (${allocations})`).run(memberId, memberId);
    db.prepare(`DELETE FROM payments WHERE member_id = ? OR allocation_id IN (${allocations})`).run(memberId, memberId);
    db.prepare('DELETE FROM seat_allocations WHERE member_id = ?').run(memberId);
    db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
  });
}
