import { Router } from 'express';
import { CAPACITY, HALL, SHIFT_KEYS } from '../config/seating.js';
import { getShifts } from '../models/shifts.js';
import {
  createAllocation, findAllocation, findConflicts, findSeat, listOpenAllocations, listSeats,
  moveAllocation, releaseAllocation, setAllocationEndDate, updateSeat,
} from '../models/seats.js';
import { PHONE_RE, findMember } from '../models/members.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { addDays, formatDate, isDate, today } from '../utils/dates.js';
import { HttpError, allocationDTO, parseId } from '../utils/http.js';
import { parseAmount } from '../models/fees.js';
import { createPayment } from '../models/payments.js';
import { transaction } from '../db.js';
import { canCollect, checkPayment } from './payments.js';

const router = Router();
router.use(authenticate);

// Booking actions are open to seat managers and booking managers alike.
const canBook = requirePermission('seats.manage', 'bookings.manage');

// Day passes can be booked up to this many days ahead.
export const DAY_PASS_AHEAD = 30;


const seatDTO = (seat, allocations = []) => ({ ...seat, id: String(seat.id), allocations });

function loadSeat(idParam) {
  const id = parseId(idParam);
  const seat = id && findSeat(id);
  if (!seat) throw new HttpError(404, 'Seat not found.');
  return seat;
}

function loadOpenAllocation(idParam) {
  const id = parseId(idParam);
  const a = id && findAllocation(id);
  if (!a) throw new HttpError(404, 'Booking not found.');
  if (a.releasedAt) throw new HttpError(409, 'This booking was already released.');
  if (a.endDate < today()) throw new HttpError(409, 'This booking has already ended.');
  return a;
}

function clashMessage(clash, seatLabel = clash.seatLabel) {
  if (clash.kind === 'day') {
    return `Seat ${seatLabel} has a day pass for ${clash.memberName} on ${formatDate(clash.startDate)}.`;
  }
  const shiftName = getShifts().find((s) => s.key === clash.shift).label.toLowerCase();
  return (
    `Seat ${seatLabel} is already booked for the ${shiftName} shift by ${clash.memberName} ` +
    `(${formatDate(clash.startDate)} – ${formatDate(clash.endDate)}).`
  );
}

function assertNoConflict(params) {
  const [clash] = findConflicts(params);
  if (clash) throw new HttpError(409, clashMessage(clash));
}

// Who a booking is for: an active member, or (day passes only) a walk-in guest with just a name.
function bookingPerson(body, isDay) {
  if (isDay && !body.memberId) {
    const name = String(body.guest?.name ?? '').trim().replace(/\s+/g, ' ');
    const phone = String(body.guest?.phone ?? '').trim();
    if (!name) throw new HttpError(400, "Enter the visitor's name, or pick a member.");
    if (name.length > 80) throw new HttpError(400, 'Name must be 80 characters or fewer.');
    if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, 'Enter a valid phone number, or leave it blank.');
    return { id: null, name, phone };
  }
  const memberId = parseId(body.memberId);
  const member = memberId && findMember(memberId);
  if (!member) throw new HttpError(400, 'Choose a member.');
  if (member.status !== 'active') throw new HttpError(409, `${member.name} is archived. Restore them before booking.`);
  return member;
}

// Whole hall: every seat with its current and upcoming bookings.
router.get('/', requirePermission('seats.view', 'seats.manage', 'bookings.view', 'bookings.manage'), (_req, res) => {
  const day = today();
  const bySeat = {};
  for (const a of listOpenAllocations(day)) (bySeat[a.seatId] ??= []).push(allocationDTO(a));
  res.json({
    today: day,
    capacity: CAPACITY,
    layout: HALL,
    shifts: getShifts(),
    seats: listSeats().map((s) => seatDTO(s, bySeat[s.id])),
  });
});

router.patch('/:id', requirePermission('seats.manage'), (req, res) => {
  const seat = loadSeat(req.params.id);
  const { status, notes } = req.body ?? {};

  if (status !== undefined && !['active', 'maintenance'].includes(status)) {
    throw new HttpError(400, 'Invalid seat status.');
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 200)) {
    throw new HttpError(400, 'Notes must be 200 characters or fewer.');
  }
  const open = listOpenAllocations(today(), seat.id);
  if (status === 'maintenance' && open.length) {
    throw new HttpError(
      409,
      `Seat ${seat.label} has ${open.length} active or upcoming booking(s). Release them before marking it under maintenance.`
    );
  }
  const updated = updateSeat(seat.id, { status, notes: notes?.trim() });
  res.json({ seat: seatDTO(updated, open.map(allocationDTO)) });
});

router.post('/:id/allocations', canBook, (req, res) => {
  const seat = loadSeat(req.params.id);
  if (seat.status !== 'active') throw new HttpError(409, `Seat ${seat.label} is under maintenance.`);

  const body = req.body ?? {};
  const notes = String(body.notes ?? '').trim();
  const kind = body.kind === 'day' ? 'day' : 'plan';
  const member = bookingPerson(body, kind === 'day');

  let { shift, startDate, endDate } = body;
  if (kind === 'day') {
    // A day pass is the whole day on one date: no shift choice, and it holds both halves of the seat.
    startDate = body.date ?? startDate;
    if (!isDate(startDate)) throw new HttpError(400, 'Choose a valid date for the day pass.');
    if (startDate < today()) throw new HttpError(400, "A day pass can't be for a past date.");
    if (startDate > addDays(today(), DAY_PASS_AHEAD)) {
      throw new HttpError(400, `Day passes can be booked up to ${DAY_PASS_AHEAD} days ahead.`);
    }
    shift = 'full';
    endDate = startDate;
  } else {
    if (!SHIFT_KEYS.includes(shift)) throw new HttpError(400, 'Choose a shift.');
    if (!isDate(startDate) || !isDate(endDate)) throw new HttpError(400, 'Choose valid start and end dates.');
    if (endDate < startDate) throw new HttpError(400, 'End date must be on or after the start date.');
    if (endDate < today()) throw new HttpError(400, 'This booking would already be over. Check the end date.');
  }
  if (notes.length > 200) throw new HttpError(400, 'Notes must be 200 characters or fewer.');

  const fee = parseAmount(body.fee ?? 0, 'Fee');
  if (body.payment && !canCollect(req)) throw new HttpError(403, "You don't have permission to record payments.");

  assertNoConflict({ seatId: seat.id, shift, startDate, endDate });
  // Booking and the first payment are saved together, so a rejected payment doesn't leave a booking behind.
  const allocation = transaction(() => {
    const created = createAllocation({ seatId: seat.id, member, shift, startDate, endDate, notes, fee, kind, createdBy: req.user.id });
    if (body.payment) {
      createPayment({ allocation: created, ...checkPayment(created, body.payment), receivedBy: req.user.id });
    }
    return findAllocation(created.id);
  });
  res.status(201).json({ allocation: allocationDTO(allocation) });
});

// Extend (or shorten) a booking.
router.patch('/allocations/:id', canBook, (req, res) => {
  const a = loadOpenAllocation(req.params.id);
  if (a.kind === 'day') throw new HttpError(409, "A day pass is for a single day and can't be extended. Book another day pass instead.");
  const { endDate } = req.body ?? {};
  const addFee = parseAmount(req.body?.addFee ?? 0, 'Extra fee');
  if (!isDate(endDate)) throw new HttpError(400, 'Choose a valid end date.');
  if (endDate < a.startDate) throw new HttpError(400, 'End date must be on or after the start date.');
  if (endDate < today()) throw new HttpError(400, "End date can't be in the past. Release the seat instead.");

  assertNoConflict({ seatId: a.seatId, shift: a.shift, startDate: a.startDate, endDate, excludeId: a.id });
  res.json({ allocation: allocationDTO(setAllocationEndDate(a.id, endDate, addFee)) });
});

// Change seat for the rest of the plan (same shift, same end date, fee and payments unchanged).
router.post('/allocations/:id/move', canBook, (req, res) => {
  const a = loadOpenAllocation(req.params.id);
  const seat = loadSeat(req.body?.seatId);
  if (seat.id === a.seatId) throw new HttpError(400, `${a.memberName} is already on seat ${seat.label}.`);
  if (seat.status !== 'active') throw new HttpError(409, `Seat ${seat.label} is under maintenance.`);

  const day = today();
  const from = a.startDate > day ? a.startDate : day;
  const [clash] = findConflicts({ seatId: seat.id, shift: a.shift, startDate: from, endDate: a.endDate, excludeId: a.id });
  if (clash) throw new HttpError(409, clashMessage(clash, seat.label));
  res.json({ allocation: allocationDTO(moveAllocation(a, seat.id, day, req.user.id)) });
});

router.post('/allocations/:id/release', canBook, (req, res) => {
  const a = loadOpenAllocation(req.params.id);
  releaseAllocation(a.id, req.user.id);
  res.json({ ok: true });
});

export default router;
