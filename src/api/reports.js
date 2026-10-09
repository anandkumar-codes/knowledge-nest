import { api } from './client.js';
import { addDays, daysBetween, fmtShort } from './seats.js';

export const getReport = (from, to) => {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  return api(`/reports${q.size ? `?${q}` : ''}`);
};

export function presets(today) {
  const monthStart = `${today.slice(0, 8)}01`;
  return [
    { key: '7d', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { key: '30d', label: 'Last 30 days', from: addDays(today, -29), to: today },
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: '90d', label: 'Last 3 months', from: addDays(today, -89), to: today },
    { key: '365d', label: 'Last 12 months', from: addDays(today, -364), to: today },
  ];
}

const MONTH = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

/**
 * Group daily rows into days (≤ 31 days), 7-day weeks (≤ 120 days) or calendar months.
 * Revenue is summed; occupancy is averaged per bucket.
 */
export function bucketDays(days, capacity) {
  const span = days.length;
  const unit = span <= 31 ? 'day' : span <= 120 ? 'week' : 'month';
  const groups = [];
  days.forEach((d, i) => {
    const key = unit === 'day' ? d.date : unit === 'week' ? `w${Math.floor(i / 7)}` : d.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) groups.push((g = { key, from: d.date, to: d.date, days: [] }));
    g.to = d.date;
    g.days.push(d);
  });
  return {
    unit,
    buckets: groups.map((g) => {
      const n = g.days.length;
      const avg = (k) => (capacity ? g.days.reduce((t, d) => t + d[k], 0) / n / capacity : 0);
      return {
        key: g.key,
        label: unit === 'day' ? fmtShort(g.from) : unit === 'week' ? fmtShort(g.from) : MONTH(g.from),
        range: g.from === g.to ? fmtShort(g.from) : `${fmtShort(g.from)} – ${fmtShort(g.to)}`,
        revenue: g.days.reduce((t, d) => t + d.revenue, 0),
        morning: avg('morning'),
        evening: avg('evening'),
        partial: unit === 'month' && (daysBetween(g.from, g.to) + 1 < new Date(Number(g.from.slice(0, 4)), Number(g.from.slice(5, 7)), 0).getDate()),
      };
    }),
  };
}

export const pct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;

// Change vs the previous period. `kind` is 'ratio' for rates (percentage points) or 'count'/'money'.
export function delta(value, previous, kind = 'count') {
  if (kind === 'ratio') {
    const pts = (value - previous) * 100;
    return { diff: pts, text: `${pts >= 0 ? '+' : '−'}${Math.abs(pts).toFixed(1)} pts` };
  }
  if (!previous) return value ? { diff: 1, text: 'New this period' } : { diff: 0, text: 'No change' };
  const change = (value - previous) / previous;
  return { diff: change, text: `${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(0)}%` };
}

// Round an axis maximum up to a clean value with 4 even steps.
export function niceScale(max) {
  if (max <= 0) return { max: 4, step: 1 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { max: step * 4, step };
}

// Compact money for axes: ₹1.2L, ₹45K
export function compactInr(n) {
  if (n >= 1e7) return `₹${+(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${+(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${+(n / 1e3).toFixed(1)}K`;
  return `₹${n}`;
}
