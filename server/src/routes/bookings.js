import { Router } from 'express';
import { CAPACITY } from '../config/seating.js';
import { listOpenAllocations, listPastAllocations } from '../models/seats.js';
import { getShifts, setShiftTimes } from '../models/shifts.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { today } from '../utils/dates.js';
import { allocationDTO } from '../utils/http.js';

export const bookingRoutes = Router();
bookingRoutes.use(authenticate);

// scope=open (default): current and upcoming bookings. scope=past: the 500 most recently finished.
bookingRoutes.get('/', requirePermission('bookings.view', 'bookings.manage', 'seats.manage'), async (req, res) => {
  const day = today();
  const scope = req.query.scope === 'past' ? 'past' : 'open';
  const list = scope === 'past' ? await listPastAllocations(day) : await listOpenAllocations(day);
  res.json({ today: day, scope, capacity: CAPACITY, shifts: await getShifts(), bookings: list.map(allocationDTO) });
});

export const shiftRoutes = Router();
shiftRoutes.use(authenticate);

shiftRoutes.get('/', async (_req, res) => {
  res.json({ shifts: await getShifts() });
});

shiftRoutes.put('/', requirePermission('settings.manage'), async (req, res) => {
  res.json({ shifts: await setShiftTimes(req.body ?? {}, req.user.id) });
});
