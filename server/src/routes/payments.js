import { Router } from 'express';
import { getFeePlans, parseAmount, setFeePlans } from '../models/fees.js';
import {
  COLLECT_METHODS, METHODS, createPayment, findPayment, listPaymentsBetween, netCollected, voidPayment,
} from '../models/payments.js';
import { findAllocation, listDueAllocations, setAllocationFee } from '../models/seats.js';
import { getShifts } from '../models/shifts.js';
import { findClaim, findClaimByPayment, listClaims, reviewClaim, utrInUse } from '../models/portal.js';
import { transaction } from '../db.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { isDate, localDate, today } from '../utils/dates.js';
import { HttpError, allocationDTO, parseId } from '../utils/http.js';

export const rupees = (n) => `₹${n.toLocaleString('en-IN')}`;

export const paymentDTO = (p) => ({
  ...p,
  id: String(p.id),
  allocationId: String(p.allocationId),
  memberId: p.memberId ? String(p.memberId) : null,
});

export const canCollect = (req) => req.user.isSuperAdmin || req.permissions.has('payments.manage');

// Validates a payment or refund against a booking's current balance.
export async function checkPayment(allocation, body) {
  const kind = body?.kind === 'refund' ? 'refund' : 'payment';
  const amount = parseAmount(body?.amount, 'Amount', 1);
  if (!COLLECT_METHODS.includes(body?.method)) throw new HttpError(400, 'Choose cash or UPI.');
  const paidOn = body?.paidOn || today();
  if (!isDate(paidOn)) throw new HttpError(400, 'Choose a valid payment date.');
  if (paidOn > today()) throw new HttpError(400, "Payment date can't be in the future.");
  const reference = String(body?.reference ?? '').trim();
  const notes = String(body?.notes ?? '').trim();
  if (reference.length > 60) throw new HttpError(400, 'Reference must be 60 characters or fewer.');
  if (body.method === 'upi') {
    if (!reference) throw new HttpError(400, 'Enter the UPI transaction ID.');
    if (kind === 'payment' && (await utrInUse(reference))) {
      throw new HttpError(409, `UPI transaction ID ${reference} is already recorded on another payment.`);
    }
  }
  if (notes.length > 200) throw new HttpError(400, 'Notes must be 200 characters or fewer.');

  if (kind === 'payment') {
    if (allocation.balance <= 0) throw new HttpError(400, 'This booking is already fully paid.');
    if (amount > allocation.balance) {
      throw new HttpError(400, `That's more than the ${rupees(allocation.balance)} due on this booking.`);
    }
  } else if (amount > allocation.paid) {
    throw new HttpError(400, `You can refund at most ${rupees(allocation.paid)} (the amount paid so far).`);
  }
  return { kind, amount, method: body.method, paidOn, reference: body.method === 'cash' ? '' : reference, notes };
}

async function loadAllocation(idValue) {
  const id = parseId(idValue);
  const a = id && (await findAllocation(id));
  if (!a) throw new HttpError(404, 'Booking not found.');
  return a;
}

function monthStart(day) {
  return `${day.slice(0, 8)}01`;
}

export const paymentRoutes = Router();
paymentRoutes.use(authenticate);

const canView = requirePermission('payments.view', 'payments.manage');
const canManage = requirePermission('payments.manage');

// Ledger for a date range (default: this month so far) plus headline numbers.
paymentRoutes.get('/', canView, async (req, res) => {
  const day = today();
  const from = isDate(req.query.from) ? req.query.from : monthStart(day);
  const to = isDate(req.query.to) ? req.query.to : day;
  if (from > to) throw new HttpError(400, 'The start date must be before the end date.');

  const payments = await listPaymentsBetween(from, to);
  const live = payments.filter((p) => !p.voidedAt);
  const sum = (list) => list.reduce((t, p) => t + p.amount, 0);
  const byMethod = Object.fromEntries(
    METHODS.map((m) => [m, sum(live.filter((p) => p.method === m && p.kind === 'payment')) - sum(live.filter((p) => p.method === m && p.kind === 'refund'))])
  );
  const dues = await listDueAllocations();

  res.json({
    today: day,
    from,
    to,
    shifts: await getShifts(),
    payments: payments.map(paymentDTO),
    summary: {
      received: sum(live.filter((p) => p.kind === 'payment')),
      refunded: sum(live.filter((p) => p.kind === 'refund')),
      net: await netCollected(from, to),
      count: live.length,
      byMethod,
    },
    stats: {
      today: await netCollected(day, day),
      month: await netCollected(monthStart(day), day),
      outstanding: dues.reduce((t, a) => t + a.balance, 0),
      dueCount: dues.length,
      pendingClaims: (await listClaims({ status: 'pending' })).length,
    },
  });
});

// Bookings with money still owed.
paymentRoutes.get('/dues', canView, async (_req, res) => {
  res.json({ today: today(), shifts: await getShifts(), dues: (await listDueAllocations()).map(allocationDTO) });
});

paymentRoutes.post('/', canManage, async (req, res) => {
  const allocation = await loadAllocation(req.body?.allocationId);
  const input = await checkPayment(allocation, req.body);
  const payment = await createPayment({ allocation, ...input, receivedBy: req.user.id });
  res.status(201).json({ payment: paymentDTO(payment), booking: allocationDTO(await findAllocation(allocation.id)) });
});

paymentRoutes.post('/:id/void', canManage, async (req, res) => {
  const id = parseId(req.params.id);
  const payment = id && (await findPayment(id));
  if (!payment) throw new HttpError(404, 'Payment not found.');
  if (payment.voidedAt) throw new HttpError(409, 'This payment was already voided.');
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 3) throw new HttpError(400, 'Give a short reason for voiding this payment.');
  if (reason.length > 200) throw new HttpError(400, 'Reason must be 200 characters or fewer.');
  const voided = await transaction(async () => {
    // A payment that came from a member's online claim: the claim can't stay "approved" once the money is
    // voided. Marking it rejected shows the member why, and lets them submit the transaction ID again.
    const claim = await findClaimByPayment(payment.id);
    if (claim?.status === 'approved') {
      await reviewClaim(claim.id, { status: 'rejected', note: `Payment voided: ${reason}`, userId: req.user.id, paymentId: payment.id });
    }
    return voidPayment(payment.id, reason, req.user.id);
  });
  res.json({ payment: paymentDTO(voided) });
});

const claimDTO = (c) => ({ ...c, id: String(c.id), allocationId: String(c.allocationId), memberId: String(c.memberId) });

// Online (UPI) payments submitted by members. Default: pending first, then recent decisions.
paymentRoutes.get('/claims', canView, async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : undefined;
  res.json({ today: today(), shifts: await getShifts(), claims: (await listClaims({ status })).map(claimDTO) });
});

async function loadPendingClaim(idParam) {
  const id = parseId(idParam);
  const claim = id && (await findClaim(id));
  if (!claim) throw new HttpError(404, 'Payment not found.');
  if (claim.status !== 'pending') throw new HttpError(409, `This payment was already ${claim.status}.`);
  return claim;
}

// Approving turns the claim into a real UPI payment (with a receipt) dated the day it was submitted.
paymentRoutes.post('/claims/:id/approve', canManage, async (req, res) => {
  const claim = await loadPendingClaim(req.params.id);
  const allocation = await findAllocation(claim.allocationId);
  if (claim.amount > allocation.balance) {
    throw new HttpError(
      409,
      `Only ${rupees(Math.max(allocation.balance, 0))} is due on this booking now. Reject this one and ask the member, or adjust the fee first.`
    );
  }
  const paidOn = localDate(claim.submittedAt);
  const result = await transaction(async () => {
    const payment = await createPayment({
      allocation, kind: 'payment', amount: claim.amount, method: 'upi', reference: claim.utr,
      paidOn, notes: 'Paid online (member portal)', receivedBy: req.user.id,
    });
    return { payment, claim: await reviewClaim(claim.id, { status: 'approved', note: '', userId: req.user.id, paymentId: payment.id }) };
  });
  res.json({ claim: claimDTO(result.claim), payment: paymentDTO(result.payment) });
});

paymentRoutes.post('/claims/:id/reject', canManage, async (req, res) => {
  const claim = await loadPendingClaim(req.params.id);
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 3) throw new HttpError(400, 'Tell the member why, e.g. "No payment found with this ID".');
  if (reason.length > 200) throw new HttpError(400, 'Reason must be 200 characters or fewer.');
  res.json({ claim: claimDTO(await reviewClaim(claim.id, { status: 'rejected', note: reason, userId: req.user.id })) });
});

// Set a booking's total fee (discount, waiver or correction).
paymentRoutes.patch('/bookings/:id/fee', canManage, async (req, res) => {
  const allocation = await loadAllocation(req.params.id);
  const fee = parseAmount(req.body?.fee, 'Fee');
  if (fee < allocation.paid) {
    throw new HttpError(
      400,
      `The fee can't be less than the ${rupees(allocation.paid)} already paid. Record a refund first.`
    );
  }
  res.json({ booking: allocationDTO(await setAllocationFee(allocation.id, fee)) });
});

export const feeRoutes = Router();
feeRoutes.use(authenticate);

feeRoutes.get('/', async (_req, res) => {
  res.json({ fees: await getFeePlans() });
});

feeRoutes.put('/', requirePermission('settings.manage'), async (req, res) => {
  res.json({ fees: await setFeePlans(req.body ?? {}, req.user.id) });
});
