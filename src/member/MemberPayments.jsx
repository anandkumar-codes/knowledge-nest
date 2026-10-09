import { useRef, useState } from 'react';
import { useMember } from './MemberAuth.jsx';
import { shiftLookup, memberDues } from './MemberHome.jsx';
import { submitUpiPayment } from '../api/memberPortal.js';
import UpiQr from '../components/UpiQr.jsx';
import { canHover, useReceiptHover } from './ReceiptHoverPreview.jsx';
import { inr, methodLabel } from '../api/payments.js';
import { bookingShift, fmtDate, fmtShort, isDayPass } from '../api/seats.js';
import Modal from '../components/Modal.jsx';
import { ReceiptModal } from '../components/PaymentDialogs.jsx';
import { useToast } from '../components/Toast.jsx';
import '../styles/payments.css';

const CLAIM_STATUS = {
  pending: { label: 'Being confirmed', cls: 'pay-partial' },
  approved: { label: 'Confirmed', cls: 'pay-paid' },
  rejected: { label: 'Not confirmed', cls: 'pay-rejected' },
};

export default function MemberPayments() {
  const { portal, refresh } = useMember();
  const toast = useToast();
  const shift = shiftLookup(portal);
  const dues = memberDues(portal);
  const [paying, setPaying] = useState(null);
  const [receipt, setReceipt] = useState(null);
  // Hovering a receipt (mouse/trackpad) opens a PDF preview beside it; tapping still opens the full dialog.
  const hover = useReceiptHover((pay) => ({ label: bookingShift(pay, shift).label, time: bookingShift(pay, shift).time }));
  const upiReady = portal.upi.ready;

  return (
    <div className="member-page">
      <h1 className="member-title">Payments</h1>

      {dues.length === 0 ? (
        <section className="panel member-empty">
          <h2>You're all paid up</h2>
          <p>Nothing is due right now. Thank you!</p>
        </section>
      ) : (
        <div className="due-list">
          {dues.map((b) => (
            <section key={b.id} className="panel due-item">
              <div className="due-item-head">
                <span className="seat-pill">{b.seatLabel}</span>
                <div>
                  <strong>{bookingShift(b, shift).label}</strong>
                  <span>{isDayPass(b) ? fmtDate(b.startDate) : `${fmtShort(b.startDate)} – ${fmtDate(b.endDate)}`}</span>
                </div>
              </div>
              <div className="balance-strip">
                <div><span>Fee</span><strong>{inr(b.fee)}</strong></div>
                <div><span>Paid</span><strong>{inr(b.paid)}</strong></div>
                <div className={b.payable > 0 ? 'is-due' : 'is-clear'}><span>To pay</span><strong>{inr(Math.max(b.payable, 0))}</strong></div>
              </div>
              {b.pending > 0 && <p className="hint">{inr(b.pending)} you paid online is being confirmed by the front desk.</p>}
              {b.payable > 0 &&
                (upiReady ? (
                  <button className="btn btn-solid btn-block btn-lg" onClick={() => setPaying(b)}>Pay {inr(b.payable)} by UPI</button>
                ) : (
                  <p className="hint">Online payment isn't set up yet. Please pay at the front desk.</p>
                ))}
            </section>
          ))}
        </div>
      )}

      {portal.claims.length > 0 && (
        <section className="panel">
          <h2 className="member-h2">Online payments you submitted</h2>
          <ul className="claim-list">
            {portal.claims.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{inr(c.amount)}</strong>
                  <span>Seat {c.seatLabel} · UTR {c.utr} · {fmtShort(c.submittedAt.slice(0, 10))}</span>
                  {c.status === 'rejected' && c.reviewNote && <span className="claim-reason">{c.reviewNote}</span>}
                </div>
                <span className="claim-side">
                  <span className={`pay-status ${CLAIM_STATUS[c.status].cls}`}>{CLAIM_STATUS[c.status].label}</span>
                  {c.status === 'approved' && portal.payments.some((p) => String(p.id) === String(c.paymentId)) && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => setReceipt(portal.payments.find((p) => String(p.id) === String(c.paymentId)))}
                    >
                      View receipt
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel panel-flush">
        <h2 className="member-h2 panel-head-pad">Payment history</h2>
        {portal.payments.length > 0 && canHover() && (
          <p className="hint history-hint">Point at a receipt to preview its PDF.</p>
        )}
        {portal.payments.length === 0 ? (
          <p className="hint history-empty">No payments yet.</p>
        ) : (
          <ul className="history-list">
            {portal.payments.map((p) => (
              <li key={p.id} className={p.voidedAt ? 'is-void' : ''}>
                <button
                  type="button"
                  onClick={() => {
                    hover.close();
                    setReceipt(p);
                  }}
                  {...hover.rowProps(p)}
                >
                  <div>
                    <strong className={p.kind === 'refund' ? 'neg' : ''}>{p.kind === 'refund' ? `− ${inr(p.amount)}` : inr(p.amount)}</strong>
                    <span>{fmtDate(p.paidOn)} · {methodLabel(p.method)} · Seat {p.seatLabel}</span>
                  </div>
                  <span className="receipt-link">{p.voidedAt ? 'Void' : p.receiptNo}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {paying && (
        <PayModal
          booking={paying}
          upi={portal.upi}
          shiftLabel={bookingShift(paying, shift).label}
          onClose={() => setPaying(null)}
          onSubmitted={(result) => {
            setPaying(null);
            refresh();
            if (result.payment) {
              toast(`Payment received. Receipt ${result.payment.receiptNo} is ready.`);
              setReceipt(result.payment);
            } else {
              toast('Thanks! The front desk will confirm your payment shortly.');
            }
          }}
        />
      )}
      {hover.preview}
      {receipt && (
        <ReceiptModal
          payment={receipt}
          shiftLabel={bookingShift(receipt, shift).label}
          shiftTime={bookingShift(receipt, shift).time}
          allowPrint={false}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}

function PayModal({ booking: b, upi, shiftLabel, onClose, onSubmitted }) {
  // The amount is fixed: members pay exactly what's due on this booking (the server enforces it too).
  const n = b.payable;
  const [utr, setUtr] = useState('');
  const [utrError, setUtrError] = useState(''); // shown right under the transaction ID box
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const utrInput = useRef(null);

  const flagUtr = (message) => {
    setUtrError(message);
    utrInput.current?.focus();
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const clean = utr.replace(/\s/g, '');
    if (!clean) return flagUtr('Enter the UPI transaction ID.');
    if (!/^[A-Za-z0-9]{6,30}$/.test(clean)) return flagUtr('That doesn\'t look right. The UPI transaction ID is usually 12 digits.');
    setSaving(true);
    try {
      onSubmitted(await submitUpiPayment({ allocationId: b.id, amount: n, utr: clean }));
    } catch (err) {
      // Problems with the ID itself (e.g. already submitted) belong next to the box.
      if (/transaction ID/i.test(err.message)) flagUtr(err.message);
      else setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Pay by UPI"
      subtitle={`Seat ${b.seatLabel} · ${shiftLabel} · ${fmtShort(b.startDate)} – ${fmtDate(b.endDate)}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="upi-form" className="btn btn-solid" disabled={saving}>
            {saving && <span className="spinner" />} I've paid {inr(n)}
          </button>
        </>
      }
    >
      <form id="upi-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}

        <div className="pay-step">
          <span className="pay-step-no">1</span>
          <div className="pay-step-body">
            <strong>Pay with any UPI app</strong>
            <label className="form-field pay-amount">
              <span>Amount to pay</span>
              <div className="amount-input amount-fixed">
                <span aria-hidden="true">₹</span>
                <input className="input" value={n.toLocaleString('en-IN')} readOnly aria-readonly="true" tabIndex={-1} aria-label="Amount to pay" />
              </div>
              <small className="hint">The full amount due on this booking. Pay exactly this amount in your UPI app.</small>
            </label>
            <UpiQr settings={upi} amount={n} note={`Seat ${b.seatLabel} ${shiftLabel}`} openButton size={150} />
          </div>
        </div>

        <div className="pay-step">
          <span className="pay-step-no">2</span>
          <div className="pay-step-body">
            <strong>Enter the transaction ID</strong>
            <p className="hint">After paying, find the 12-digit UPI transaction ID (UTR / UPI Ref No.) in your payment app.</p>
            <div className="form-field">
              <label htmlFor="member-utr">
                UPI transaction ID <span className="req" aria-hidden="true">*</span>
              </label>
              <input
                ref={utrInput}
                id="member-utr"
                className={`input input-lg utr-input${utrError ? ' is-invalid' : ''}`}
                inputMode="numeric"
                value={utr}
                onChange={(e) => {
                  setUtr(e.target.value);
                  if (utrError) setUtrError('');
                }}
                placeholder="e.g. 412345678901"
                maxLength={30}
                required
                aria-required="true"
                aria-invalid={!!utrError}
                aria-describedby={utrError ? 'member-utr-error' : undefined}
              />
              {utrError && <p id="member-utr-error" className="input-error" role="alert">{utrError}</p>}
            </div>
          </div>
        </div>
        <p className="hint">
          {upi.autoConfirm
            ? 'Your payment is recorded as soon as you submit, and your receipt appears straight away.'
            : 'The front desk checks every online payment. Your receipt appears here once it is confirmed.'}
        </p>
      </form>
    </Modal>
  );
}
