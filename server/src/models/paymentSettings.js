// How Knowledge Nest receives money online. Managed by the super admin only.
import { HttpError } from '../utils/http.js';
import { getSetting, setSetting } from './settings.js';

const KEY = 'upi_details'; // kept from the first version so existing UPI IDs carry over
const VPA_RE = /^[a-z0-9.\-_]{2,256}@[a-z][a-z0-9]{1,64}$/i;
const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 900_000; // ~650 KB of image data

const DEFAULTS = { vpa: '', payee: '', qrMode: 'generated', qrImage: '', autoConfirm: false };

export const getPaymentSettings = () => ({ ...DEFAULTS, ...getSetting(KEY, {}) });

// Members and staff can take UPI payments when there's a UPI ID or an uploaded QR to show.
export function onlinePaymentsReady(s = getPaymentSettings()) {
  return !!s.vpa || (s.qrMode === 'uploaded' && !!s.qrImage);
}

export function setPaymentSettings(input, userId) {
  const current = getPaymentSettings();
  const pick = (k) => (input?.[k] === undefined ? current[k] : input[k]);

  const next = {
    vpa: String(pick('vpa') ?? '').trim(),
    payee: String(pick('payee') ?? '').trim(),
    qrMode: pick('qrMode'),
    qrImage: String(pick('qrImage') ?? ''),
    autoConfirm: !!pick('autoConfirm'),
  };

  if (next.vpa && !VPA_RE.test(next.vpa)) throw new HttpError(400, 'Enter a valid UPI ID, like knowledgenest@okhdfcbank.');
  if (next.payee.length > 60) throw new HttpError(400, 'Payee name must be 60 characters or fewer.');
  if ((next.vpa || next.qrImage) && !next.payee) throw new HttpError(400, 'Enter the name shown to people when they pay.');
  if (!['generated', 'uploaded'].includes(next.qrMode)) throw new HttpError(400, 'Choose which QR code to show.');
  if (next.qrImage && (!IMAGE_RE.test(next.qrImage) || next.qrImage.length > MAX_IMAGE_CHARS)) {
    throw new HttpError(400, 'Upload the QR code as a PNG, JPG or WebP image under 650 KB.');
  }
  if (next.qrMode === 'uploaded' && !next.qrImage) throw new HttpError(400, 'Upload your QR code image, or choose the generated QR.');
  if (next.autoConfirm && !onlinePaymentsReady(next)) {
    throw new HttpError(400, 'Add a UPI ID or QR code before turning on automatic confirmation.');
  }

  setSetting(KEY, next, userId);
  return getPaymentSettings();
}

// What members see: no need to send the image unless it's the one in use.
export function publicPaymentSettings() {
  const s = getPaymentSettings();
  return {
    vpa: s.vpa,
    payee: s.payee,
    qrMode: s.qrMode,
    qrImage: s.qrMode === 'uploaded' ? s.qrImage : '',
    autoConfirm: s.autoConfirm,
    ready: onlinePaymentsReady(s),
  };
}
