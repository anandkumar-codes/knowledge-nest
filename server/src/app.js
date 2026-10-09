import cors from 'cors';
import express from 'express';
import authRoutes from './routes/auth.js';
import { bookingRoutes, shiftRoutes } from './routes/bookings.js';
import memberRoutes from './routes/members.js';
import { feeRoutes, paymentRoutes } from './routes/payments.js';
import portalRoutes from './routes/portal.js';
import paymentSettingsRoutes from './routes/paymentSettings.js';
import reportRoutes from './routes/reports.js';
import roleRoutes from './routes/roles.js';
import seatRoutes from './routes/seats.js';
import userRoutes from './routes/users.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './utils/http.js';
import { auditTrail } from './middleware/audit.js';
import { trustProxySetting } from './middleware/rateLimits.js';
import { securityHeaders } from './middleware/security.js';

const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

// The built web app (`npm run build` in the project root). When present, the API serves it too,
// so production needs a single process on a single origin.
const CLIENT_DIST = path.resolve(
  process.env.CLIENT_DIST ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')
);

// Pages allowed to call the API from another address: CLIENT_ORIGIN (comma-separated) plus the Android app,
// which runs from https://localhost. Sign-in uses tokens, not cookies, so this grants no access by itself.
const ANDROID_APP_ORIGIN = 'https://localhost';
function allowedOrigins() {
  const configured = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean);
  return [...new Set([...configured, ANDROID_APP_ORIGIN])];
}

function serveClient(app) {
  const indexFile = path.join(CLIENT_DIST, 'index.html');
  if (!fs.existsSync(indexFile)) return;
  // Hashed asset files never change, so browsers can keep them; index.html must always be fresh.
  app.use('/assets', express.static(path.join(CLIENT_DIST, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  // Every other page is handled by the React router.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
}

export function createApp() {
  const app = express();
  app.set('trust proxy', trustProxySetting());
  app.use(securityHeaders);
  app.use(cors({ origin: allowedOrigins() }));
  app.use('/api', auditTrail);
  // Mounted before the global JSON parser: it parses its own (larger) bodies for QR image uploads.
  app.use('/api/payment-settings', paymentSettingsRoutes);
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/roles', roleRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/seats', seatRoutes);
  app.use('/api/members', memberRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/shifts', shiftRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/fees', feeRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/portal', portalRoutes);

  app.use('/api', () => {
    throw new HttpError(404, 'Not found.');
  });

  serveClient(app);

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.errcode === SQLITE_CONSTRAINT_UNIQUE) {
      const what = err.message.includes('users.email')
        ? 'A team member with this email'
        : err.message.includes('members.phone_key')
          ? 'A member with this phone number'
          : 'A role with this name';
      return res.status(409).json({ error: `${what} already exists.` });
    }
    if (err?.errcode === SQLITE_CONSTRAINT_FOREIGNKEY) {
      return res.status(409).json({ error: 'This record is still in use. Reassign or remove what depends on it first.' });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
    if (err?.status === 404 && err?.expose) return res.status(404).end(); // missing static file
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
