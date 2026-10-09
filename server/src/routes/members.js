import { Router } from 'express';
import { getShifts } from '../models/shifts.js';
import crypto from 'node:crypto';
import { createMember, findMember, listMembers, setMemberStatus, updateMember } from '../models/members.js';
import { disablePortal, setPortalPassword } from '../models/portal.js';
import { anonymizeMember, eraseMember, relatedRecords } from '../models/memberRemoval.js';
import { listMemberAllocations, listOpenAllocations } from '../models/seats.js';
import { listMemberPayments } from '../models/payments.js';
import { paymentDTO } from './payments.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { today } from '../utils/dates.js';
import { HttpError, allocationDTO, parseId } from '../utils/http.js';

const router = Router();
router.use(authenticate);

// Anyone who can book seats can read members too, so they can pick one when booking.
const canRead = requirePermission('members.view', 'members.manage', 'seats.manage', 'bookings.manage');
const canWrite = requirePermission('members.manage');

const memberDTO = (m, bookings = []) => ({ ...m, id: String(m.id), bookings });

// Staff who can book seats but not view members only need enough to pick the right person.
const canSeeDetails = (req) => req.user.isSuperAdmin || req.permissions.has('members.view') || req.permissions.has('members.manage');
const pickerDTO = (m, bookings = []) => ({
  id: String(m.id), code: m.code, name: m.name, phone: m.phone, status: m.status, anonymized: m.anonymized, bookings,
});

async function loadMember(idParam) {
  const id = parseId(idParam);
  const member = id && (await findMember(id));
  if (!member) throw new HttpError(404, 'Member not found.');
  return member;
}

// Members whose personal details were removed can't be edited, restored or given access again.
async function loadEditableMember(idParam) {
  const member = await loadMember(idParam);
  if (member.anonymized) throw new HttpError(409, "This member's personal details were removed. Register them as a new member instead.");
  return member;
}

// All members, each with their current and upcoming bookings.
router.get('/', canRead, async (req, res) => {
  const day = today();
  const byMember = {};
  for (const a of await listOpenAllocations(day)) {
    if (a.memberId) (byMember[a.memberId] ??= []).push(allocationDTO(a));
  }
  const toDTO = canSeeDetails(req) ? memberDTO : pickerDTO;
  res.json({ today: day, shifts: await getShifts(), members: (await listMembers()).map((m) => toDTO(m, byMember[m.id])) });
});

// One member with their full booking history (newest first).
router.get('/:id', canRead, async (req, res) => {
  const member = await loadMember(req.params.id);
  const toDTO = canSeeDetails(req) ? memberDTO : pickerDTO;
  res.json({
    today: today(),
    shifts: await getShifts(),
    member: toDTO(member, (await listMemberAllocations(member.id)).map(allocationDTO)),
    payments: (await listMemberPayments(member.id)).map(paymentDTO),
  });
});

router.post('/', canWrite, async (req, res) => {
  res.status(201).json({ member: memberDTO(await createMember(req.body ?? {}, req.user.id)) });
});

router.patch('/:id', canWrite, async (req, res) => {
  const member = await loadEditableMember(req.params.id);
  res.json({ member: memberDTO(await updateMember(member.id, req.body ?? {})) });
});

router.post('/:id/archive', canWrite, async (req, res) => {
  const member = await loadMember(req.params.id);
  const open = (await listOpenAllocations(today())).filter((a) => a.memberId === member.id);
  if (open.length) {
    throw new HttpError(
      409,
      `${member.name} still has ${open.length} active or upcoming booking(s). Release them before archiving.`
    );
  }
  await disablePortal(member.id); // archived members lose portal access
  res.json({ member: memberDTO(await setMemberStatus(member.id, 'archived')) });
});

// action: 'enable' | 'reset' (both issue a one-time password) or 'disable'.
router.post('/:id/portal', canWrite, async (req, res) => {
  const member = await loadEditableMember(req.params.id);
  const { action } = req.body ?? {};
  if (action === 'disable') {
    await disablePortal(member.id);
    return res.json({ member: memberDTO(await findMember(member.id)) });
  }
  if (action !== 'enable' && action !== 'reset') throw new HttpError(400, 'Unknown action.');
  if (member.status !== 'active') throw new HttpError(409, 'Restore this member before giving portal access.');
  const tempPassword = crypto.randomBytes(6).toString('base64url');
  await setPortalPassword(member.id, tempPassword, { mustChange: true });
  res.json({ member: memberDTO(await findMember(member.id)), tempPassword });
});

router.post('/:id/restore', canWrite, async (req, res) => {
  const member = await loadEditableMember(req.params.id);
  res.json({ member: memberDTO(await setMemberStatus(member.id, 'active')) });
});

// What's linked to an archived member, shown before deleting them.
router.get('/:id/related', canWrite, async (req, res) => {
  const member = await loadMember(req.params.id);
  res.json({ member: memberDTO(member), related: await relatedRecords(member.id, today()) });
});

/**
 * Delete an archived member.
 *   mode=anonymize: wipe personal details, keep bookings and payments (reports stay correct).
 *   mode=erase:     remove the member and all their bookings and payments.
 */
router.delete('/:id', canWrite, async (req, res) => {
  const member = await loadMember(req.params.id);
  const mode = req.query.mode;
  if (!['anonymize', 'erase'].includes(mode)) throw new HttpError(400, 'Choose how to delete this member.');
  if (member.status !== 'archived') throw new HttpError(409, 'Archive this member before deleting them.');

  const related = await relatedRecords(member.id, today());
  if (related.bookings.open) {
    throw new HttpError(409, 'This member still has an active or upcoming booking. Release it first.');
  }
  if (related.claims.pending) {
    throw new HttpError(
      409,
      `${related.claims.pending} online payment(s) from this member are waiting to be verified. Approve or reject them first.`
    );
  }

  if (mode === 'anonymize') {
    if (member.anonymized) throw new HttpError(409, "This member's details were already removed.");
    await anonymizeMember(member.id);
    return res.json({ member: memberDTO(await findMember(member.id)) });
  }

  // Erasing payment records changes past revenue, so it also needs the payments permission.
  const hasMoney = related.payments.count > 0 || related.payments.voided > 0;
  if (hasMoney && !req.user.isSuperAdmin && !req.permissions.has('payments.manage')) {
    throw new HttpError(403, 'This member has payment records. Deleting them needs the "Collect & refund fees" permission.');
  }
  if (req.query.confirm !== member.name) {
    throw new HttpError(400, `Type the member's name exactly ("${member.name}") to confirm.`);
  }
  await eraseMember(member.id);
  res.status(204).end();
});

export default router;
