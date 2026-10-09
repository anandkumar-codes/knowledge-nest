import { useEffect, useState } from 'react';
import { api } from './client.js';

let cache = null; // one fetch per page load; refreshed after saving

export const getPaymentSettings = () => (cache ??= api('/payment-settings').then((d) => d.settings).catch((err) => {
  cache = null;
  throw err;
}));

export async function savePaymentSettings(body) {
  const { settings } = await api('/payment-settings', { method: 'PUT', body });
  cache = Promise.resolve(settings);
  return settings;
}

// Staff-side hook: the UPI ID / QR to show when collecting a payment at the desk.
export function usePaymentSettings() {
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    getPaymentSettings().then(setSettings).catch(() => setSettings({ vpa: '', payee: '', qrMode: 'generated', qrImage: '' }));
  }, []);
  return settings;
}

export const onlineReady = (s) => !!s && (!!s.vpa || (s.qrMode === 'uploaded' && !!s.qrImage));

// upi://pay link understood by GPay, PhonePe, Paytm, BHIM, etc. (amount is filled in for the payer).
export function upiLink({ vpa, payee, amount, note }) {
  const q = new URLSearchParams({ pa: vpa, pn: payee, am: String(amount), cu: 'INR', tn: note });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

// Shrink an uploaded QR image (keeps it sharp but small enough to store and send).
export function readQrImage(file, maxSide = 640) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Choose a PNG, JPG or WebP image.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let data = canvas.toDataURL('image/png');
      if (data.length > 880_000) data = canvas.toDataURL('image/jpeg', 0.9);
      if (data.length > 880_000) return reject(new Error('That image is too large. Try a smaller screenshot of the QR code.'));
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image."));
    };
    img.src = url;
  });
}
