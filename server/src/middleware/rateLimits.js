import rateLimit from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
const message = { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' };

/**
 * Sign-in limits, applied together:
 *   - per network address: 10 attempts per 15 minutes (as before);
 *   - per account: 10 failed attempts per 15 minutes, so changing address doesn't allow unlimited guessing.
 * `accountKey(req)` names the account being tried (normalised email, phone or member code).
 *
 * SIGNIN_LIMIT_BY_ADDRESS=false turns the per-address limit off. Use it only when the app can't see visitors'
 * real addresses (e.g. behind Tailscale Funnel, where every visitor arrives from the same address): there the
 * per-address limit would be shared by everyone, and 10 sign-ins in 15 minutes would lock out the whole site.
 * The per-account limit still stops password guessing.
 */
export function signInLimiters(accountKey) {
  const perAddress = rateLimit({
    windowMs: WINDOW_MS,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message,
  });
  const perAccount = rateLimit({
    windowMs: WINDOW_MS,
    limit: 10,
    standardHeaders: false,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `account:${accountKey(req) || 'unknown'}`,
    message,
  });
  const byAddress = String(process.env.SIGNIN_LIMIT_BY_ADDRESS ?? '').trim().toLowerCase() !== 'false';
  return byAddress ? [perAddress, perAccount] : [perAccount];
}

/**
 * `trust proxy` only when the API really sits behind a reverse proxy (nginx, Caddy, a cloud load balancer).
 * Trusting X-Forwarded-For without one lets anyone fake their address and dodge the sign-in limits.
 * TRUST_PROXY: unset/false = no proxy, a number = that many proxy hops, or a value Express understands
 * such as "loopback".
 */
export function trustProxySetting(value = process.env.TRUST_PROXY) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || v === 'false' || v === '0') return false;
  if (v === 'true') return 1;
  return /^\d+$/.test(v) ? Number(v) : v;
}
