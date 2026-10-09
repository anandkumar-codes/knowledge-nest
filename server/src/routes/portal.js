// Member portal API. Members authenticate with their own tokens (kind: 'member'),
// which the staff API rejects, and they can only ever see or act on their own records.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { signInLimiters } from '../middleware/rateLimits.js';
import { findMember, updateMember } from '../models/members.js';
import { listMemberPayments } from '../models/payments.js';
import {
  createClaim, findMemberForLogin, listClaims, loginKey, pendingClaimTotal, portalState, reviewClaim,
  setPortalPassword, touchPortalLogin, utrInUse, verifyPortalPassword,
} from '../models/portal.js';
import { getPaymentSettings, onlinePaymentsReady, publicPaymentSettings } from '../models/paymentSettings.js';
import { createPayment } from '../models/payments.js';
import { transaction } from '../db.js';
import { findAllocation, listMemberAllocations } from '../models/seats.js';
import { getShifts } from '../models/shifts.js';
import { parseAmount } from '../models/fees.js';
import { today } from '../utils/dates.js';
import { HttpError, allocationDTO, parseId } from '../utils/http.js';
import { paymentDTO, rupees } from './payments.js';

const router = Router();

const loginLimiters = signInLimiters((req) => loginKey(req.body?.phone));

const signToken = (memberId, remember) =>
  jwt.sign({ sub: String(memberId), kind: 'member' }, process.env.JWT_SECRET, { expiresIn: remember ? '30d' : '12h' });

const memberDTO = (m, mustChange) => ({
  id: String(m.id),
  code: m.code,
  name: m.name,
  phone: m.phone,
  email: m.email,
  gender: m.gender,
  guardianPhone: m.guardianPhone,
  address: m.address,
  preparingFor: m.preparingFor,
  joinedOn: m.joinedOn,
  mustChangePassword: !!mustChange,
});

const claimDTO = (c) => ({ ...c, id: String(c.id), allocationId: String(c.allocationId), memberId: String(c.memberId) });

const REMOVED = 'Your portal access is not active. Please contact the front desk.';

router.post('/login', loginLimiters, async (req, res) => {
  const { phone, password, remember } = req.body ?? {};
  if (!phone || !password) throw new HttpError(400, 'Enter your phone number and password.');
  const found = await findMemberForLogin(phone);
  // Same message (and the same time taken) for unknown phone, wrong password and no access, so accounts can't be probed.
  if (!(await verifyPortalPassword(found?.hash, password))) {
    throw new HttpError(401, 'Phone number or password is incorrect.');
  }
  const state = await portalState(found.member.id);
  if (!state.portal_enabled || found.member.status !== 'active') throw new HttpError(403, REMOVED);

  await touchPortalLogin(found.member.id);
  res.json({ token: signToken(found.member.id, remember), member: memberDTO(found.member, state.portal_must_change) });
});

const PASSWORD_ROUTES = new Set(['/me', '/change-password']);

async function authenticateMember(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please sign in.');
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }
  if (payload.kind !== 'member') throw new HttpError(401, 'Please sign in.');
  const id = parseId(payload.sub);
  const member = id && (await findMember(id));
  const state = member && (await portalState(member.id));
  if (!member || member.status !== 'active' || !state.portal_enabled) throw new HttpError(401, REMOVED);
  // Sessions opened before the latest password change (by the member or a front-desk reset) no longer count.
  if (state.portal_password_changed_at && payload.iat < state.portal_password_changed_at) {
    throw new HttpError(401, 'Your password was changed. Please sign in again.');
  }
  // A password the front desk set must be replaced before anything else.
  if (state.portal_must_change && !(req.method === 'GET' && req.path === '/me') && !PASSWORD_ROUTES.has(req.path)) {
    throw new HttpError(403, 'Please choose a new password before continuing.');
  }
  req.member = member;
  req.auth = payload;
  req.mustChange = !!state.portal_must_change;
  next();
}

router.use(authenticateMember);

// Everything the portal shows, in one call.
router.get('/me', async (req, res) => {
  const m = req.member;
  res.json({
    today: today(),
    shifts: await getShifts(),
    upi: await publicPaymentSettings(),
    member: memberDTO(m, req.mustChange),
    bookings: (await listMemberAllocations(m.id)).map(allocationDTO),
    payments: (await listMemberPayments(m.id)).map(paymentDTO),
    claims: (await listClaims({ memberId: m.id })).map(claimDTO),
  });
});

// Members may update their contact details; name and phone stay with the front desk.
router.patch('/me', async (req, res) => {
  const { email, address, guardianPhone, preparingFor } = req.body ?? {};
  const updated = await updateMember(req.member.id, { email, address, guardianPhone, preparingFor });
  res.json({ member: memberDTO(updated, req.mustChange) });
});

router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const found = await findMemberForLogin(req.member.code);
  if (!(await verifyPortalPassword(found.hash, currentPassword))) {
    throw new HttpError(400, 'Current password is incorrect.');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8 || !/[a-z]/i.test(newPassword) || !/\d/.test(newPassword)) {
    throw new HttpError(400, 'Use at least 8 characters, including a letter and a number.');
  }
  if (newPassword === currentPassword) throw new HttpError(400, 'Choose a password different from your current one.');
  await setPortalPassword(req.member.id, newPassword, { mustChange: false });
  // Other devices are now signed out; this one gets a fresh token with the same lifetime as before.
  const remember = (req.auth.exp - req.auth.iat) > 24 * 60 * 60;
  res.json({ token: signToken(req.member.id, remember), member: memberDTO(await findMember(req.member.id), false) });
});

// "I've paid by UPI": recorded as a claim. With auto-confirm on, it becomes a payment (and receipt)
// straight away; otherwise it waits for the front desk to verify it.
router.post('/claims', async (req, res) => {
  const settings = await getPaymentSettings();
  if (!onlinePaymentsReady(settings)) throw new HttpError(409, 'Online payment is not set up yet. Please pay at the front desk.');

  const id = parseId(req.body?.allocationId);
  const booking = id && (await findAllocation(id));
  if (!booking || booking.memberId !== req.member.id) throw new HttpError(404, 'Booking not found.');

  const utr = String(req.body?.utr ?? '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9]{6,30}$/.test(utr)) {
    throw new HttpError(400, 'Enter the UPI transaction ID (UTR) from your payment app. It is usually 12 digits.');
  }
  if (await utrInUse(utr)) throw new HttpError(409, 'This transaction ID has already been submitted.');
  const amount = parseAmount(req.body?.amount, 'Amount', 1);
  const outstanding = booking.balance - (await pendingClaimTotal(booking.id));
  if (outstanding <= 0) {
    throw new HttpError(409, 'Nothing is due on this booking (payments you submitted are still being checked).');
  }
  // Members pay the full amount due; only staff can take part-payments.
  if (amount !== outstanding) throw new HttpError(400, `Please pay the full amount due: ${rupees(outstanding)}.`);

  const note = String(req.body?.note ?? '').trim();
  if (note.length > 200) throw new HttpError(400, 'Note must be 200 characters or fewer.');

  const result = await transaction(async () => {
    const claim = await createClaim({ allocationId: booking.id, memberId: req.member.id, amount, utr, note });
    if (!settings.autoConfirm) return { claim };
    const payment = await createPayment({
      allocation: booking, kind: 'payment', amount, method: 'upi', reference: utr, paidOn: today(),
      notes: 'Paid online (member portal), auto-confirmed', receivedBy: null,
    });
    return {
      claim: await reviewClaim(claim.id, { status: 'approved', note: 'Auto-confirmed', userId: null, paymentId: payment.id }),
      payment,
    };
  });
  res.status(201).json({
    claim: claimDTO(result.claim),
    ...(result.payment ? { payment: paymentDTO(result.payment) } : {}),
  });
});

export default router;
