import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadReceiptPdf, receiptPreviewUrl } from '../api/receiptPdf.js';
import { inr } from '../api/payments.js';

// Only devices with a real pointer get hover previews; touch devices keep tap-to-open.
export const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const OPEN_DELAY = 350; // ms resting on a receipt before the preview opens (so passing over doesn't trigger it)
const CLOSE_DELAY = 220; // grace period to move the pointer from the row into the preview

/**
 * Hover-intent controller for a list of receipts. Spread `rowProps(payment)` onto each row's button
 * and render `preview` once.
 */
export function useReceiptHover(shiftFor) {
  const [active, setActive] = useState(null); // { payment, rect }
  const openTimer = useRef(null);
  const closeTimer = useRef(null);
  const enabled = canHover();

  const clearTimers = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setActive(null), CLOSE_DELAY);
  };
  const open = (payment, el, delay) => {
    clearTimers();
    openTimer.current = setTimeout(() => setActive({ payment, rect: el.getBoundingClientRect() }), delay);
  };

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => e.key === 'Escape' && setActive(null);
    const onScroll = () => setActive(null);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };
  }, [active]);

  useEffect(() => clearTimers, []);

  const rowProps = (payment) =>
    enabled
      ? {
          onMouseEnter: (e) => open(payment, e.currentTarget, OPEN_DELAY),
          onMouseLeave: scheduleClose,
          onFocus: (e) => open(payment, e.currentTarget, 0),
          onBlur: scheduleClose,
          'aria-describedby': active?.payment.id === payment.id ? 'receipt-hover-preview' : undefined,
        }
      : {};

  const preview = active && (
    <ReceiptHoverPreview
      key={active.payment.id}
      payment={active.payment}
      shift={shiftFor(active.payment)}
      anchor={active.rect}
      onPointerEnter={clearTimers}
      onPointerLeave={scheduleClose}
    />
  );

  return { rowProps, preview, close: () => setActive(null) };
}

function ReceiptHoverPreview({ payment: p, shift, anchor, onPointerEnter, onPointerLeave }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const panel = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useEffect(() => {
    let live = true;
    receiptPreviewUrl(p, shift)
      .then((u) => live && setUrl(u))
      .catch(() => live && setError("Couldn't load the receipt."));
    return () => {
      live = false;
    };
  }, [p, shift]);

  // Sit beside the hovered row without covering it: below if there's room, otherwise above.
  useLayoutEffect(() => {
    const w = Math.min(360, window.innerWidth - 24);
    const h = Math.min(560, window.innerHeight - 24);
    const below = window.innerHeight - anchor.bottom - 12 >= h;
    const top = below ? anchor.bottom + 8 : Math.max(12, anchor.top - h - 8);
    const left = Math.min(Math.max(12, anchor.right - w), window.innerWidth - w - 12);
    setPos({ top, left, width: w, height: h });
  }, [anchor]);

  const download = async () => {
    setBusy(true);
    try {
      await downloadReceiptPdf(p, shift);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={panel}
      id="receipt-hover-preview"
      className="receipt-hover"
      role="dialog"
      aria-label={`Receipt ${p.receiptNo} preview`}
      style={pos}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      onFocus={onPointerEnter}
      onBlur={onPointerLeave}
    >
      <header className="receipt-hover-head">
        <div>
          <strong>{p.receiptNo}</strong>
          <span>{p.kind === 'refund' ? 'Refund' : 'Payment'} of {inr(p.amount)}{p.voidedAt ? ' · void' : ''}</span>
        </div>
        <button type="button" className="btn btn-solid btn-sm" onClick={download} disabled={busy}>
          {busy && <span className="spinner" />} Download PDF
        </button>
      </header>
      <div className="receipt-hover-body">
        {error ? (
          <p className="hint">{error}</p>
        ) : url ? (
          <iframe title={`Receipt ${p.receiptNo}`} src={`${url}#toolbar=0&navpanes=0&view=FitH`} />
        ) : (
          <span className="spinner spinner-dark" />
        )}
      </div>
    </div>,
    document.body
  );
}
