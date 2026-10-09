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
bookingRoutes.get('/', requirePermission('bookings.view', 'bookings.manage', 'seats.manage'), (req, res) => {
  const day = today();
  const scope = req.query.scope === 'past' ? 'past' : 'open';
  const list = scope === 'past' ? listPastAllocations(day) : listOpenAllocations(day);
  res.json({ today: day, scope, capacity: CAPACITY, shifts: getShifts(), bookings: list.map(allocationDTO) });
});

export const shiftRoutes = Router();
shiftRoutes.use(authenticate);

shiftRoutes.get('/', (_req, res) => {
  res.json({ shifts: getShifts() });
});

shiftRoutes.put('/', requirePermission('settings.manage'), (req, res) => {
  res.json({ shifts: setShiftTimes(req.body ?? {}, req.user.id) });
});
