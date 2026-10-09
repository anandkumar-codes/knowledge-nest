import { db, now, transaction } from '../db.js';
import { HttpError } from '../utils/http.js';
import { isDate, today } from '../utils/dates.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^\+?[\d\s-]{7,16}$/;
const GENDERS = ['', 'female', 'male', 'other'];

export const memberCode = (id) => `KN-${String(id).padStart(4, '0')}`;

// Last 10 digits identify a phone regardless of "+91", spaces or dashes.
export const phoneKey = (phone) => String(phone ?? '').replace(/\D/g, '').slice(-10);

const toMember = (row) =>
  row && {
    id: row.id,
    code: memberCode(row.id),
    name: row.name,
    phone: row.phone,
    email: row.email,
    gender: row.gender,
    guardianPhone: row.guardian_phone,
    address: row.address,
    preparingFor: row.preparing_for,
    notes: row.notes,
    joinedOn: row.joined_on,
    status: row.status,
    portal: { enabled: !!row.portal_enabled, lastLogin: row.portal_last_login ?? null },
    anonymized: !!row.anonymized_at,
    createdBy: row.created_by_name ?? null,
    createdAt: row.created_at,
  };

const str = (v, max, label) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  return s;
};

function clean(input, existing = {}) {
  const pick = (k) => (input[k] === undefined ? existing[k] : input[k]);
  const m = {
    name: str(pick('name'), 80, 'Name'),
    phone: str(pick('phone'), 20, 'Phone'),
    email: str(pick('email'), 120, 'Email').toLowerCase(),
    gender: str(pick('gender'), 10, 'Gender'),
    guardianPhone: str(pick('guardianPhone'), 20, 'Emergency contact'),
    address: str(pick('address'), 300, 'Address'),
    preparingFor: str(pick('preparingFor'), 80, 'Preparing for'),
    notes: str(pick('notes'), 500, 'Notes'),
    joinedOn: pick('joinedOn') || today(),
  };
  if (!m.name) throw new HttpError(400, "Enter the member's name.");
  if (!PHONE_RE.test(m.phone) || phoneKey(m.phone).length < 7) throw new HttpError(400, 'Enter a valid phone number.');
  if (m.email && !EMAIL_RE.test(m.email)) throw new HttpError(400, 'Enter a valid email address or leave it blank.');
  if (!GENDERS.includes(m.gender)) throw new HttpError(400, 'Invalid gender.');
  if (m.guardianPhone && !PHONE_RE.test(m.guardianPhone)) throw new HttpError(400, 'Enter a valid emergency contact number.');
  if (!isDate(m.joinedOn)) throw new HttpError(400, 'Choose a valid joining date.');
  return m;
}

const SELECT = `
  SELECT m.*, u.name AS created_by_name
  FROM members m LEFT JOIN users u ON u.id = m.created_by`;

export const listMembers = async () => (await db.prepare(`${SELECT} ORDER BY m.name COLLATE NOCASE`).all()).map(toMember);

export const findMember = async (id) => toMember(await db.prepare(`${SELECT} WHERE m.id = ?`).get(id));

export const findMemberByPhone = async (phone) =>
  toMember(await db.prepare(`${SELECT} WHERE m.phone_key = ?`).get(phoneKey(phone)));

async function assertPhoneFree(phone, exceptId = 0) {
  const other = await findMemberByPhone(phone);
  if (other && other.id !== exceptId) {
    throw new HttpError(409, `${other.name} (${other.code}) is already registered with this phone number.`);
  }
}

export async function createMember(input, createdBy = null) {
  const m = clean(input);
  await assertPhoneFree(m.phone);
  const ts = now();
  const { lastInsertRowid } = await db
    .prepare(
      `INSERT INTO members (name, phone, phone_key, email, gender, guardian_phone, address, preparing_for, notes,
                            joined_on, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      m.name, m.phone, phoneKey(m.phone), m.email, m.gender, m.guardianPhone, m.address, m.preparingFor, m.notes,
      m.joinedOn, createdBy, ts, ts
    );
  return findMember(Number(lastInsertRowid));
}

export async function updateMember(id, input) {
  const existing = await findMember(id);
  const m = clean(input, existing);
  await assertPhoneFree(m.phone, id);
  await db.prepare(
    `UPDATE members SET name = ?, phone = ?, phone_key = ?, email = ?, gender = ?, guardian_phone = ?, address = ?,
                        preparing_for = ?, notes = ?, joined_on = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    m.name, m.phone, phoneKey(m.phone), m.email, m.gender, m.guardianPhone, m.address, m.preparingFor, m.notes,
    m.joinedOn, now(), id
  );
  return findMember(id);
}

export async function setMemberStatus(id, status) {
  await db.prepare('UPDATE members SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  return findMember(id);
}

// One-off: bookings made before the Members module stored only a name and phone.
// Turn each distinct phone into a member and link its bookings.
export async function backfillMembersFromBookings() {
  const orphans = await db
    .prepare('SELECT id, member_name, member_phone, start_date FROM seat_allocations WHERE member_id IS NULL ORDER BY id')
    .all();
  if (!orphans.length) return 0;
  let created = 0;
  await transaction(async () => {
    for (const a of orphans) {
      const key = phoneKey(a.member_phone) || `legacy-${a.id}`;
      let row = await db.prepare('SELECT id FROM members WHERE phone_key = ?').get(key);
      if (!row) {
        const ts = now();
        const { lastInsertRowid } = await db
          .prepare(
            `INSERT INTO members (name, phone, phone_key, joined_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(a.member_name, a.member_phone, key, a.start_date, ts, ts);
        row = { id: Number(lastInsertRowid) };
        created++;
      }
      await db.prepare('UPDATE seat_allocations SET member_id = ? WHERE id = ?').run(row.id, a.id);
    }
  });
  return created;
}
