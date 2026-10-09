import { db, now, transaction } from '../db.js';
import { HALL } from '../config/seating.js';
import { memberCode } from './members.js';

const toSeat = (row) =>
  row && {
    id: row.id,
    label: row.label,
    row: row.row_label,
    position: row.position,
    status: row.status,
    notes: row.notes,
  };

const toAllocation = (row) =>
  row && {
    id: row.id,
    seatId: row.seat_id,
    seatLabel: row.seat_label,
    memberId: row.member_id,
    memberCode: row.member_id ? memberCode(row.member_id) : null,
    // Live member details; fall back to the booking-time snapshot.
    memberName: row.live_name ?? row.member_name,
    memberPhone: row.live_phone ?? row.member_phone,
    shift: row.shift,
    kind: row.kind ?? 'plan',
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
    fee: row.fee,
    paid: row.paid,
    movedFrom: row.moved_from ? { id: row.moved_from, seatLabel: row.moved_from_label } : null,
    balance: row.fee - row.paid,
    createdBy: row.created_by_name ?? null,
    createdAt: row.created_at,
    releasedAt: row.released_at,
  };

// Creates the hall's seats the first time the server or seed script runs.
export function ensureSeats() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM seats').get();
  if (n > 0) return 0;
  const insert = db.prepare(
    'INSERT INTO seats (label, row_label, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const ts = now();
  transaction(() => {
    for (const row of HALL.rows) {
      for (let p = 1; p <= HALL.seatsPerRow; p++) insert.run(`${row}${p}`, row, p, ts, ts);
    }
  });
  return HALL.rows.length * HALL.seatsPerRow;
}

export const listSeats = () =>
  db.prepare('SELECT * FROM seats ORDER BY row_label, position').all().map(toSeat);

export const findSeat = (id) => toSeat(db.prepare('SELECT * FROM seats WHERE id = ?').get(id));

export function updateSeat(id, { status, notes }) {
  const seat = findSeat(id);
  db.prepare('UPDATE seats SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(
    status ?? seat.status, notes ?? seat.notes, now(), id
  );
  return findSeat(id);
}

const SELECT_ALLOC = `
  SELECT a.*, s.label AS seat_label, u.name AS created_by_name, m.name AS live_name, m.phone AS live_phone,
         (SELECT COALESCE(SUM(CASE p.kind WHEN 'refund' THEN -p.amount ELSE p.amount END), 0)
            FROM payments p WHERE p.allocation_id = a.id AND p.voided_at IS NULL) AS paid,
         (SELECT s2.label FROM seat_allocations a2 JOIN seats s2 ON s2.id = a2.seat_id WHERE a2.id = a.moved_from) AS moved_from_label
  FROM seat_allocations a
  JOIN seats s ON s.id = a.seat_id
  LEFT JOIN members m ON m.id = a.member_id
  LEFT JOIN users u ON u.id = a.created_by`;

// Bookings still in effect or starting later (not released, not yet ended).
export const listOpenAllocations = (today, seatId = null) =>
  db
    .prepare(
      `${SELECT_ALLOC} WHERE a.released_at IS NULL AND a.end_date >= ? AND (? IS NULL OR a.seat_id = ?)
       ORDER BY a.start_date, a.id`
    )
    .all(today, seatId, seatId)
    .map(toAllocation);

// Finished bookings (ended or released), most recently finished first.
export const listPastAllocations = (today, limit = 500) =>
  db
    .prepare(
      `${SELECT_ALLOC} WHERE a.released_at IS NOT NULL OR a.end_date < ?
       ORDER BY COALESCE(local_date(a.released_at), a.end_date) DESC, a.id DESC
       LIMIT ?`
    )
    .all(today, limit)
    .map(toAllocation);

// Every booking a member has ever had, newest first.
export const listMemberAllocations = (memberId) =>
  db.prepare(`${SELECT_ALLOC} WHERE a.member_id = ? ORDER BY a.start_date DESC, a.id DESC`).all(memberId).map(toAllocation);

export const findAllocation = (id) => toAllocation(db.prepare(`${SELECT_ALLOC} WHERE a.id = ?`).get(id));

// Bookings on the same seat whose dates overlap and whose shifts clash
// (full day clashes with everything; morning/evening only with themselves).
export const findConflicts = ({ seatId, shift, startDate, endDate, excludeId = 0 }) =>
  db
    .prepare(
      `${SELECT_ALLOC}
       WHERE a.seat_id = ? AND a.released_at IS NULL AND a.id != ?
         AND a.start_date <= ? AND a.end_date >= ?
         AND (a.shift = 'full' OR ? = 'full' OR a.shift = ?)
       ORDER BY a.start_date`
    )
    .all(seatId, excludeId, endDate, startDate, shift, shift)
    .map(toAllocation);

// `member` is a member row, or { id: null, name, phone } for a walk-in day-pass guest.
export function createAllocation({ seatId, member, shift, startDate, endDate, notes, fee = 0, kind = 'plan', createdBy }) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO seat_allocations
         (seat_id, member_id, member_name, member_phone, shift, start_date, end_date, notes, fee, kind, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(seatId, member.id, member.name, member.phone ?? '', shift, startDate, endDate, notes, fee, kind, createdBy, now());
  return findAllocation(Number(lastInsertRowid));
}

// Change the end date; `addFee` is charged on top of the existing fee (e.g. for an extra month).
export function setAllocationEndDate(id, endDate, addFee = 0) {
  db.prepare('UPDATE seat_allocations SET end_date = ?, fee = fee + ? WHERE id = ?').run(endDate, addFee, id);
  return findAllocation(id);
}

export function setAllocationFee(id, fee) {
  db.prepare('UPDATE seat_allocations SET fee = ? WHERE id = ?').run(fee, id);
  return findAllocation(id);
}

// Every booking (current or past) that still has money owed, oldest first.
export const listDueAllocations = () =>
  db
    .prepare(`SELECT * FROM (${SELECT_ALLOC}) WHERE fee > paid ORDER BY start_date, id`)
    .all()
    .map(toAllocation);

export function releaseAllocation(id, userId) {
  db.prepare('UPDATE seat_allocations SET released_at = ?, released_by = ? WHERE id = ?').run(now(), userId, id);
}

/**
 * Move a booking to another seat for the rest of its plan, keeping shift and end date.
 * If the plan is already running, the current booking ends yesterday (keeping its fee and payments)
 * and a linked booking on the new seat runs from today. Otherwise the seat is simply swapped.
 * Returns the booking that now holds the member's seat.
 */
export function moveAllocation(allocation, newSeatId, today, userId) {
  return transaction(() => {
    if (allocation.startDate >= today) {
      db.prepare('UPDATE seat_allocations SET seat_id = ? WHERE id = ?').run(newSeatId, allocation.id);
      return findAllocation(allocation.id);
    }
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    db.prepare('UPDATE seat_allocations SET end_date = ? WHERE id = ?').run(yesterday.toISOString().slice(0, 10), allocation.id);
    const row = db.prepare('SELECT * FROM seat_allocations WHERE id = ?').get(allocation.id);
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO seat_allocations
           (seat_id, member_id, member_name, member_phone, shift, start_date, end_date, notes, fee, kind, moved_from, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
      )
      .run(newSeatId, row.member_id, row.member_name, row.member_phone, row.shift, today, allocation.endDate, row.notes, row.kind, row.id, userId, now());
    return findAllocation(Number(lastInsertRowid));
  });
}
