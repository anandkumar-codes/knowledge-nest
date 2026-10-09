import express, { Router } from 'express';
import { getPaymentSettings, setPaymentSettings } from '../models/paymentSettings.js';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();
// Signed-in staff only, checked before reading the body so strangers can't make the server parse 1 MB uploads.
router.use(authenticate);
// The QR image travels as a data URL, so this route accepts a larger body than the rest of the API.
router.use(express.json({ limit: '1mb' }));

// Any staff member can read these (they show the QR when collecting at the desk).
router.get('/', (_req, res) => {
  res.json({ settings: getPaymentSettings() });
});

router.put('/', requireSuperAdmin, (req, res) => {
  res.json({ settings: setPaymentSettings(req.body ?? {}, req.user.id) });
});

export default router;
