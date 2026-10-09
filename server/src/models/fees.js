import { HttpError } from '../utils/http.js';
import { getSetting, setSetting } from './settings.js';

const KEY = 'fee_plans';
// Monthly plan fees per shift, plus `day`: the price of a one-day pass. Whole rupees.
export const DEFAULT_FEES = { morning: 800, evening: 800, full: 1400, day: 150 };
export const MAX_AMOUNT = 1000000;

// Validates a whole-rupee amount. `min` is 0 for fees (free/waived) and 1 for payments.
export function parseAmount(value, label, min = 0) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > MAX_AMOUNT) {
    throw new HttpError(400, `${label} must be a whole number of rupees${min ? ' above zero' : ''}.`);
  }
  return n;
}

export const getFeePlans = () => ({ ...DEFAULT_FEES, ...getSetting(KEY, {}) });

export function setFeePlans(input, userId) {
  const next = {};
  for (const k of Object.keys(DEFAULT_FEES)) next[k] = parseAmount(input?.[k] ?? getFeePlans()[k], k === 'day' ? 'Day pass fee' : 'Monthly fee');
  setSetting(KEY, next, userId);
  return next;
}
