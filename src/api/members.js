import { api } from './client.js';
import { daysBetween, isExpiring } from './seats.js';

export const listMembers = () => api('/members');
export const getMember = (id) => api(`/members/${id}`);
export const createMember = (body) => api('/members', { method: 'POST', body }).then((d) => d.member);
export const updateMember = (id, body) => api(`/members/${id}`, { method: 'PATCH', body }).then((d) => d.member);
export const archiveMember = (id) => api(`/members/${id}/archive`, { method: 'POST' }).then((d) => d.member);
export const restoreMember = (id) => api(`/members/${id}/restore`, { method: 'POST' }).then((d) => d.member);

export const GENDERS = [
  { key: '', label: 'Prefer not to say' },
  { key: 'female', label: 'Female' },
  { key: 'male', label: 'Male' },
  { key: 'other', label: 'Other' },
];

export const EXAM_SUGGESTIONS = [
  'UPSC CSE', 'State PSC', 'SSC CGL', 'Banking (IBPS / SBI)', 'Railways (RRB)', 'NEET', 'JEE', 'GATE', 'CA', 'CAT',
  'NET / JRF', 'College studies',
];

// Where a member stands today, based on their open bookings.
export function standing(member, today) {
  const bookings = member.bookings ?? [];
  const current = bookings.filter((b) => !b.releasedAt && b.startDate <= today && b.endDate >= today);
  const upcoming = bookings.filter((b) => !b.releasedAt && b.startDate > today);
  const nextEnd = current.map((b) => b.endDate).sort()[0] ?? null;
  return {
    current,
    upcoming,
    nextEnd,
    daysLeft: nextEnd ? daysBetween(today, nextEnd) : null,
    expiring: current.some((b) => isExpiring(b, today)),
  };
}

export function bookingState(b, today) {
  if (b.releasedAt) return { key: 'released', label: 'Released' };
  if (b.startDate > today) return { key: 'upcoming', label: 'Upcoming' };
  if (b.endDate < today) return { key: 'ended', label: 'Completed' };
  return { key: 'active', label: 'Active' };
}

// action: 'enable' | 'reset' → { member, tempPassword }; 'disable' → { member }
export const setPortalAccess = (id, action) => api(`/members/${id}/portal`, { method: 'POST', body: { action } });

// Everything linked to a member (bookings, payments, dues…), shown before deleting them.
export const getRelated = (id) => api(`/members/${id}/related`).then((d) => d.related);
// mode: 'anonymize' (remove personal details, keep history) | 'erase' (delete everything)
export const deleteMember = (id, mode, confirmName = '') =>
  api(`/members/${id}?mode=${mode}&confirm=${encodeURIComponent(confirmName)}`, { method: 'DELETE' });
