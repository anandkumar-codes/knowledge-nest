import { Router } from 'express';
import { HALL } from '../config/seating.js';
import { addDays, buildReport, daysBetween } from '../models/reports.js';
import { getShifts } from '../models/shifts.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { isDate, today } from '../utils/dates.js';
import { HttpError } from '../utils/http.js';

const router = Router();
router.use(authenticate);

const MAX_DAYS = 366;

// Default: the last 30 days, ending today.
router.get('/', requirePermission('reports.view'), async (req, res) => {
  const day = today();
  const to = isDate(req.query.to) ? req.query.to : day;
  const from = isDate(req.query.from) ? req.query.from : addDays(to, -29);
  if (from > to) throw new HttpError(400, 'The start date must be before the end date.');
  if (to > day) throw new HttpError(400, "Reports can't look into the future.");
  if (daysBetween(from, to) + 1 > MAX_DAYS) throw new HttpError(400, 'Choose a period of one year or less.');
  res.json({ today: day, shifts: await getShifts(), layout: HALL, ...(await buildReport(from, to, day)) });
});

export default router;
