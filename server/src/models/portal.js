import bcrypt from 'bcryptjs';
import { db, now } from '../db.js';
import { HttpError } from '../utils/http.js';
import { findMember, phoneKey } from './members.js';
import { DUMMY_HASH, nowSeconds } from './users.js';

// ---- Member sign-in ----

// Phone number (any format) or member code ("KN-0007").
export function findMemberForLogin(identifier) {
  const raw = String(identifier ?? '').trim();
  const code = raw.match(/^kn-?0*(\d+)$/i);
  const row = code
    ? db.prepare('SELECT id, portal_password_hash FROM members WHERE id = ?').get(Number(code[1]))
    : db.prepare('SELECT id, portal_password_hash FROM members WHERE phone_key = ?').get(phoneKey(raw));
  return row ? { member: findMember(row.id), hash: row.portal_password_hash } : null;
}

// Phone and member code both name the same account, so sign-in limits count them together.
export function loginKey(identifier) {
  const raw = String(identifier ?? '').trim();
  const code = raw.match(/^kn-?0*(\d+)$/i);
  return code ? `member:${Number(code[1])}` : `phone:${phoneKey(raw)}`;
}

export function portalState(memberId) {
  return db
    .prepare('SELECT portal_enabled, portal_must_change, portal_password_changed_at FROM members WHERE id = ?')
    .get(memberId);
}

// Always runs a bcrypt comparison, so unknown phones take as long as wrong passwords.
export async function verifyPortalPassword(hash, plain) {
  const ok = await bcrypt.compare(String(plain ?? ''), hash ?? DUMMY_HASH);
  return !!hash && ok;
}

export async function setPortalPassword(memberId, password, { mustChange }) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters.');
  }
  if (Buffer.byteLength(password) > 72) throw new HttpError(400, 'Password must be 72 characters or fewer.');
  // Recording the change time signs out portal sessions opened with the old password.
  db.prepare(
    `UPDATE members SET portal_password_hash = ?, portal_must_change = ?, portal_enabled = 1, portal_password_changed_at = ?
     WHERE id = ?`
  ).run(await bcrypt.hash(password, 12), mustChange ? 1 : 0, nowSeconds(), memberId);
}

export const disablePortal = (memberId) =>
  db.prepare('UPDATE members SET portal_enabled = 0, portal_password_hash = NULL WHERE id = ?').run(memberId);

export const touchPortalLogin = (memberId) =>
  db.prepare('UPDATE members SET portal_last_login = ? WHERE id = ?').run(now(), memberId);

// ---- Online payment claims ----

const toClaim = (row) =>
  row && {
    id: row.id,
    allocationId: row.allocation_id,
    memberId: row.member_id,
    memberName: row.member_name,
    memberPhone: row.member_phone,
    seatLabel: row.seat_label,
    shift: row.shift,
    startDate: row.start_date,
    endDate: row.end_date,
    amount: row.amount,
    utr: row.utr,
    note: row.note,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedBy: row.reviewed_by_name ?? null,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    paymentId: row.payment_id,
  };

const SELECT = `
  SELECT c.*, m.name AS member_name, m.phone AS member_phone, s.label AS seat_label,
         a.shift, a.start_date, a.end_date, u.name AS reviewed_by_name
  FROM payment_claims c
  JOIN members m ON m.id = c.member_id
  JOIN seat_allocations a ON a.id = c.allocation_id
  JOIN seats s ON s.id = a.seat_id
  LEFT JOIN users u ON u.id = c.reviewed_by`;

export const findClaim = (id) => toClaim(db.prepare(`${SELECT} WHERE c.id = ?`).get(id));

// The online claim (if any) that a payment was created from.
export const findClaimByPayment = (paymentId) => toClaim(db.prepare(`${SELECT} WHERE c.payment_id = ?`).get(paymentId));

export const listClaims = ({ status, memberId } = {}) =>
  db
    .prepare(
      `${SELECT} WHERE (? IS NULL OR c.status = ?) AND (? IS NULL OR c.member_id = ?)
       ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.submitted_at DESC LIMIT 300`
    )
    .all(status ?? null, status ?? null, memberId ?? null, memberId ?? null)
    .map(toClaim);

// Money already claimed online for a booking but not yet reviewed.
export const pendingClaimTotal = (allocationId) =>
  db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM payment_claims WHERE allocation_id = ? AND status = 'pending'")
    .get(allocationId).n;

export const utrInUse = (utr) =>
  !!db.prepare("SELECT 1 FROM payment_claims WHERE upper(utr) = upper(?) AND status != 'rejected'").get(utr) ||
  !!db.prepare('SELECT 1 FROM payments WHERE upper(reference) = upper(?) AND voided_at IS NULL').get(utr);

export function createClaim({ allocationId, memberId, amount, utr, note }) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO payment_claims (allocation_id, member_id, amount, utr, note, submitted_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(allocationId, memberId, amount, utr, note, now());
  return findClaim(Number(lastInsertRowid));
}

export function reviewClaim(id, { status, note, userId, paymentId = null }) {
  db.prepare(
    'UPDATE payment_claims SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, payment_id = ? WHERE id = ?'
  ).run(status, note, userId, now(), paymentId, id);
  return findClaim(id);
}
