import { DEFAULT_SHIFT_TIMES } from '../config/seating.js';
import { HttpError } from '../utils/http.js';
import { getSetting, setSetting } from './settings.js';

const KEY = 'shift_times';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// "06:00" → "6 AM", "14:30" → "2:30 PM"
export function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}

const storedTimes = () => getSetting(KEY, DEFAULT_SHIFT_TIMES);

// The three shifts with their current labels and timings, in display order.
export async function getShifts() {
  const t = await storedTimes();
  const full = { ...t.full, start: t.morning.start, end: t.evening.end };
  return [
    ['morning', t.morning],
    ['evening', t.evening],
    ['full', full],
  ].map(([key, s]) => ({
    key,
    label: s.label,
    start: s.start,
    end: s.end,
    time: `${formatTime(s.start)} – ${formatTime(s.end)}`,
  }));
}

export async function setShiftTimes(input, userId) {
  const label = (v, fallback) => {
    const s = String(v ?? fallback).trim();
    if (!s || s.length > 24) throw new HttpError(400, 'Shift names must be 1–24 characters.');
    return s;
  };
  const current = await storedTimes();
  const next = {
    morning: {
      label: label(input?.morning?.label, current.morning.label),
      start: input?.morning?.start ?? current.morning.start,
      end: input?.morning?.end ?? current.morning.end,
    },
    evening: {
      label: label(input?.evening?.label, current.evening.label),
      start: input?.evening?.start ?? current.evening.start,
      end: input?.evening?.end ?? current.evening.end,
    },
    full: { label: label(input?.full?.label, current.full.label) },
  };

  for (const k of ['morning', 'evening']) {
    const { start, end, label: name } = next[k];
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) throw new HttpError(400, `Enter valid times for the ${name} shift.`);
    if (start >= end) throw new HttpError(400, `The ${name} shift must end after it starts.`);
  }
  // One seat is shared by a morning and an evening member, so the shifts can't overlap.
  if (next.morning.end > next.evening.start) {
    throw new HttpError(400, `${next.morning.label} must end by the time ${next.evening.label} starts.`);
  }

  await setSetting(KEY, next, userId);
  return getShifts();
}
