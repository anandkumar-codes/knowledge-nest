// Dates are plain calendar days ("YYYY-MM-DD") in the reading room's time zone,
// so they compare correctly as strings.

// The reading room's time zone, independent of where the server runs (cloud hosts are often UTC).
export const TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

// Calendar day of a Date or ISO timestamp in the reading room's time zone.
export function localDate(value = new Date()) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
}

export const today = () => localDate(new Date());

// Minutes the reading room's clock is ahead of UTC right now (India: +330).
export function utcOffsetMinutes(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(at).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - at.getTime()) / 60000);
}

// SQL for "the reading room's calendar day of this stored UTC timestamp", e.g. date(released_at, '+330 minutes').
export function localDateSql(column) {
  const m = utcOffsetMinutes();
  return `date(${column}, '${m >= 0 ? '+' : ''}${m} minutes')`;
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatDate(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
