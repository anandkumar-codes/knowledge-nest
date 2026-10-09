import { db, now } from '../db.js';

const insert = db.prepare(
  'INSERT INTO audit_log (user_id, user_name, method, path, status, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);

/**
 * Records every staff change (POST/PUT/PATCH/DELETE) once the response is sent: who, what route, the result.
 * Request bodies are never stored, so passwords and personal details stay out of the log.
 * `req.user` is set later by `authenticate`, so it's read when the response finishes.
 */
export function auditTrail(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (!req.user) return; // sign-in attempts and member portal requests have no staff user
    insert
      .run(req.user.id, req.user.name, req.method, req.originalUrl.split('?')[0], res.statusCode, req.ip ?? '', now())
      .catch((err) => console.error('Could not write audit log:', err.message));
  });
  next();
}
