import { db } from '../db.js';
import { netCollected } from './payments.js';
import { listDueAllocations } from './seats.js';

const NET = "SUM(CASE kind WHEN 'refund' THEN -amount ELSE amount END)";

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
}

function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// Bookings that overlap [from, to]. A booking counts on its release day, not after.
function overlapping(from, to) {
  return db
    .prepare(
      `SELECT id, seat_id, member_id, shift, start_date, end_date, local_date(released_at) AS released_on
       FROM seat_allocations WHERE start_date <= ? AND end_date >= ?`
    )
    .all(to, from);
}

const activeOn = (a, d) => a.start_date <= d && a.end_date >= d && (!a.released_on || a.released_on >= d);

// Per-day count of seats taken in each shift, plus shift-days used per seat.
function occupancy(from, to) {
  const allocs = overlapping(from, to);
  const perSeat = {};
  const days = eachDay(from, to).map((date) => {
    let morning = 0;
    let evening = 0;
    for (const a of allocs) {
      if (!activeOn(a, date)) continue;
      const m = a.shift !== 'evening';
      const e = a.shift !== 'morning';
      morning += m;
      evening += e;
      perSeat[a.seat_id] = (perSeat[a.seat_id] ?? 0) + m + e;
    }
    return { date, morning, evening };
  });
  return { days, perSeat };
}

const average = (list) => (list.length ? list.reduce((t, x) => t + x, 0) / list.length : 0);
const occupancyRate = (days, capacity) =>
  capacity ? average(days.map((d) => (d.morning + d.evening) / (capacity * 2))) : 0;

const count = (sql, ...args) => db.prepare(sql).get(...args).n;
const bookingsStarting = (from, to) =>
  count('SELECT COUNT(*) AS n FROM seat_allocations WHERE start_date BETWEEN ? AND ?', from, to);
const membersJoining = (from, to) => count('SELECT COUNT(*) AS n FROM members WHERE joined_on BETWEEN ? AND ?', from, to);

/**
 * Plans that ran to their end date within the period: how many were followed by a new booking for the
 * same member within 7 days. Plans that ended under 7 days ago and haven't been renewed yet are left out
 * (they may still renew). Extensions move the end date, so extended plans never count as "ended".
 */
function renewals(from, to, today) {
  const ended = db
    .prepare(
      `SELECT id, member_id, end_date FROM seat_allocations
       WHERE end_date BETWEEN ? AND ? AND end_date < ? AND member_id IS NOT NULL AND kind = 'plan'
         AND (released_at IS NULL OR local_date(released_at) >= end_date)`
    )
    .all(from, to, today);
  const next = db.prepare(
    "SELECT 1 FROM seat_allocations WHERE member_id = ? AND id != ? AND kind = 'plan' AND start_date > ? AND start_date <= ? LIMIT 1"
  );
  let renewed = 0;
  let counted = 0;
  for (const a of ended) {
    const didRenew = !!next.get(a.member_id, a.id, a.end_date, addDays(a.end_date, 7));
    if (didRenew) renewed++;
    if (didRenew || addDays(a.end_date, 7) < today) counted++;
  }
  return { renewed, counted, rate: counted ? renewed / counted : null };
}

// Day passes used in the period and what they brought in (net of refunds).
function dayPasses(from, to) {
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM seat_allocations WHERE kind = 'day' AND start_date BETWEEN ? AND ?")
    .get(from, to);
  const { net } = db
    .prepare(
      `SELECT COALESCE(SUM(CASE p.kind WHEN 'refund' THEN -p.amount ELSE p.amount END), 0) AS net
       FROM payments p JOIN seat_allocations a ON a.id = p.allocation_id
       WHERE a.kind = 'day' AND p.voided_at IS NULL AND p.paid_on BETWEEN ? AND ?`
    )
    .get(from, to);
  return { value: n, revenue: net };
}

export function buildReport(from, to, today) {
  const length = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -length);

  const seats = db.prepare('SELECT id, label, row_label, position, status FROM seats ORDER BY row_label, position').all();
  const capacity = seats.length;

  // Revenue
  const revenueRows = db
    .prepare(`SELECT paid_on AS date, ${NET} AS net FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ? AND ? GROUP BY paid_on`)
    .all(from, to);
  const revenueByDay = Object.fromEntries(revenueRows.map((r) => [r.date, r.net]));
  const byMethod = Object.fromEntries(
    db
      .prepare(`SELECT method, ${NET} AS net FROM payments WHERE voided_at IS NULL AND paid_on BETWEEN ? AND ? GROUP BY method`)
      .all(from, to)
      .map((r) => [r.method, r.net])
  );

  // Occupancy (current + previous period for the delta)
  const occ = occupancy(from, to);
  const prevOcc = occupancy(prevFrom, prevTo);

  const shiftMix = Object.fromEntries(
    db
      .prepare(
        `SELECT CASE kind WHEN 'day' THEN 'day' ELSE shift END AS k, COUNT(*) AS n
         FROM seat_allocations WHERE start_date BETWEEN ? AND ? GROUP BY k`
      )
      .all(from, to)
      .map((r) => [r.k, r.n])
  );

  const dues = listDueAllocations();

  return {
    from,
    to,
    previous: { from: prevFrom, to: prevTo },
    capacity,
    days: occ.days.map((d) => ({ ...d, revenue: revenueByDay[d.date] ?? 0 })),
    kpis: {
      revenue: { value: netCollected(from, to), previous: netCollected(prevFrom, prevTo) },
      occupancy: { value: occupancyRate(occ.days, capacity), previous: occupancyRate(prevOcc.days, capacity) },
      newBookings: { value: bookingsStarting(from, to), previous: bookingsStarting(prevFrom, prevTo) },
      newMembers: { value: membersJoining(from, to), previous: membersJoining(prevFrom, prevTo) },
      renewals: renewals(from, to, today),
      dayPasses: dayPasses(from, to),
      outstanding: { value: dues.reduce((t, a) => t + a.balance, 0), count: dues.length },
    },
    byMethod: { cash: 0, upi: 0, card: 0, bank: 0, ...byMethod },
    shiftMix: { morning: 0, evening: 0, full: 0, day: 0, ...shiftMix },
    // Share of shift-days each seat was booked over the period (0–1).
    seatUse: seats.map((s) => ({
      label: s.label,
      row: s.row_label,
      position: s.position,
      status: s.status,
      rate: (occ.perSeat[s.id] ?? 0) / (length * 2),
    })),
  };
}
