import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { upiLink } from '../api/paymentSettings.js';
import { inr } from '../api/payments.js';
import { CopyIcon } from './Icons.jsx';

/**
 * The QR code and UPI ID to pay to. Shows the super admin's uploaded QR when that option is chosen
 * (a fixed QR, so the payer types the amount), otherwise a QR generated from the UPI ID with the amount
 * already filled in. Used on the member Pay screen and at the front desk.
 */
export default function UpiQr({ settings, amount, note, openButton = false, size = 180 }) {
  const uploaded = settings.qrMode === 'uploaded' && settings.qrImage;
  const link = settings.vpa && amount > 0 ? upiLink({ vpa: settings.vpa, payee: settings.payee, amount, note }) : null;
  const [generated, setGenerated] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (uploaded || !link) return setGenerated('');
    QRCode.toDataURL(link, { margin: 1, width: size * 2, color: { dark: '#11303f', light: '#ffffff' } })
      .then(setGenerated)
      .catch(() => setGenerated(''));
  }, [uploaded, link, size]);

  const src = uploaded ? settings.qrImage : generated;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(settings.vpa);
      setCopied(true);
    } catch {
      /* clipboard blocked; the UPI ID is visible to copy by hand */
    }
  };

  return (
    <div className="upi-box">
      {openButton && link && <a className="btn btn-solid btn-block upi-open" href={link}>Open my UPI app</a>}
      <div className="upi-qr">
        {src ? (
          <img src={src} alt={`QR code to pay ${settings.payee}`} style={{ width: size, height: size }} />
        ) : (
          <span className="upi-qr-empty" style={{ width: size, height: size }}>Enter an amount</span>
        )}
        <div className="upi-qr-text">
          <span className="upi-pay-to">Pay <strong>{inr(amount)}</strong> to</span>
          <strong className="upi-payee">{settings.payee}</strong>
          {settings.vpa && (
            <button type="button" className="upi-id" onClick={copy} title="Copy UPI ID">
              {settings.vpa} <CopyIcon width={14} height={14} />
            </button>
          )}
          {copied && <span className="hint">UPI ID copied</span>}
          {uploaded && <span className="hint upi-amount-hint">After scanning, enter <strong>{inr(amount)}</strong> in the UPI app.</span>}
        </div>
      </div>
    </div>
  );
}
