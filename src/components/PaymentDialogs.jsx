import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  COLLECT_METHODS, adjustFee, getFees, inr, methodLabel, recordPayment, suggestedFee, voidPayment,
} from '../api/payments.js';
import { fmtDate, fmtShort } from '../api/seats.js';
import { LogoMark } from './Logo.jsx';
import UpiQr from './UpiQr.jsx';
import { onlineReady, usePaymentSettings } from '../api/paymentSettings.js';
import Modal, { ConfirmDialog } from './Modal.jsx';
import { PrintIcon } from './Icons.jsx';
import { canSharePdf, downloadReceiptPdf, previewReceiptPdf, shareReceiptPdf } from '../api/receiptPdf.js';
import '../styles/payments.css';

/**
 * Ask staff to confirm before recording cash, which can't be traced afterwards.
 * `confirmCash({ amount, who, refund })` resolves to true/false; render `cashDialog` somewhere in the tree.
 */
export function useCashConfirm() {
  const [ask, setAsk] = useState(null);
  const confirmCash = ({ amount, who, refund = false }) =>
    new Promise((resolve) => setAsk({ amount, who, refund, resolve }));
  const finish = (ok) => {
    ask?.resolve(ok);
    setAsk(null);
  };
  const cashDialog = ask && (
    <ConfirmDialog
      title={ask.refund ? 'Confirm cash refund' : 'Confirm cash received'}
      message={
        ask.refund
          ? `Have you handed ${inr(ask.amount)} in cash back to ${ask.who}? This records the refund.`
          : `Have you received ${inr(ask.amount)} in cash from ${ask.who}? Count it before confirming. This records the payment and issues a receipt.`
      }
      confirmLabel={ask.refund ? `Yes, refunded ${inr(ask.amount)}` : `Yes, received ${inr(ask.amount)}`}
      onConfirm={() => finish(true)}
      onClose={() => finish(false)}
    />
  );
  return { confirmCash, cashDialog };
}

function MethodPicker({ value, onChange }) {
  return (
    <div className="method-picker" role="radiogroup" aria-label="Payment method">
      {COLLECT_METHODS.map((m) => (
        <label key={m.key} className={value === m.key ? 'on' : ''}>
          <input type="radio" name="method" value={m.key} checked={value === m.key} onChange={() => onChange(m.key)} />
          {m.label}
        </label>
      ))}
    </div>
  );
}

/**
 * Required UPI transaction ID with its error shown right under the box.
 * `error` is the message to show (or ''); typing clears it via onChange.
 */
const UpiRefField = ({ id, value, onChange, error, inputRef }) => (
  <div className="form-field">
    <label htmlFor={id}>
      UPI transaction ID <span className="req" aria-hidden="true">*</span>
    </label>
    <input
      ref={inputRef}
      id={id}
      className={`input${error ? ' is-invalid' : ''}`}
      placeholder="e.g. 412345678901"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={60}
      required
      aria-required="true"
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
    />
    {error && <p id={`${id}-error`} className="input-error" role="alert">{error}</p>}
  </div>
);
const UPI_REF_MISSING = 'Enter the UPI transaction ID.';

function AmountInput({ value, onChange, id, autoFocus }) {
  return (
    <div className="amount-input">
      <span aria-hidden="true">₹</span>
      <input
        id={id}
        className="input"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        autoFocus={autoFocus}
      />
    </div>
  );
}

/**
 * Fee for a new booking (or extension), suggested from the fee plans until the user edits it,
 * plus an optional "collect now" payment. Returns { fee, payment, valid, error, ui }.
 */
// `dayPass`: price is the flat day-pass fee, and payment is collected up front by default.
export function useFeeAndPayment({ shift, months, days, label = 'Fee', dayPass = false }) {
  const { can } = useAuth();
  const canCollect = can('payments.manage');
  const [fees, setFees] = useState(null);
  const [custom, setCustom] = useState(null); // string while the user overrides the suggestion
  const [collect, setCollect] = useState(dayPass);
  const [pay, setPay] = useState({ amount: null, method: 'cash', reference: '' });
  const [refError, setRefError] = useState('');
  const refInput = useRef(null);
  const upi = usePaymentSettings();

  useEffect(() => {
    getFees().then(setFees).catch(() => setFees({}));
  }, []);

  const suggested = !fees ? 0 : dayPass ? fees.day ?? 0 : suggestedFee(fees, shift, months, days);
  const fee = custom === null ? suggested : Number(custom || 0);
  const amount = pay.amount === null ? fee : Number(pay.amount || 0);

  const collecting = collect && canCollect && fee > 0;
  let error = '';
  if (collecting && amount < 1) error = 'Enter the amount received.';
  else if (collecting && amount > fee) error = `The payment can't be more than the ${inr(fee)} fee.`;

  const ui = (
    <div className="fee-box">
      <div className="fee-row">
        <label className="form-field" htmlFor="fee-amount">
          <span>{label}</span>
        </label>
        <AmountInput id="fee-amount" value={custom ?? String(suggested)} onChange={setCustom} />
      </div>
      <p className="hint fee-hint">
        {dayPass ? (
          fees?.day ? `Day pass · ${inr(fees.day)} for the whole day` : 'No day pass price set (Payments → Fee plans).'
        ) : fees && fees[shift] ? (
          months ? `${inr(fees[shift])} / month × ${months}` : `${inr(fees[shift])} / month, pro-rated for ${days} days`
        ) : 'No fee plan set for this shift.'}
        {custom !== null && Number(custom) !== suggested && (
          <> · <button type="button" className="link" onClick={() => setCustom(null)}>Use plan price ({inr(suggested)})</button></>
        )}
      </p>

      {canCollect && fee > 0 && (
        <>
          <label className="checkbox collect-toggle">
            <input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} />
            <span className="box" />
            Collect payment now
          </label>
          {collect && (
            <div className="collect-fields">
              <div className="fee-row">
                <span className="form-label">Amount received</span>
                <AmountInput value={pay.amount ?? String(fee)} onChange={(v) => setPay((p) => ({ ...p, amount: v }))} />
              </div>
              <MethodPicker value={pay.method} onChange={(m) => setPay((p) => ({ ...p, method: m }))} />
              {pay.method === 'upi' && onlineReady(upi) && amount > 0 && (
                <div className="desk-qr">
                  <span className="hint">Show this to the member to scan:</span>
                  <UpiQr settings={upi} amount={amount} note="Knowledge Nest fee" size={130} />
                </div>
              )}
              {pay.method === 'upi' && (
                <UpiRefField
                  id="fee-upi-ref"
                  inputRef={refInput}
                  value={pay.reference}
                  error={refError}
                  onChange={(v) => {
                    setPay((p) => ({ ...p, reference: v }));
                    if (v.trim()) setRefError('');
                  }}
                />
              )}
              {amount > 0 && amount < fee && <small className="hint">{inr(fee - amount)} will remain due.</small>}
            </div>
          )}
        </>
      )}
    </div>
  );

  // Call before saving: flags a missing UPI transaction ID next to its box. Returns false if not ready.
  const check = () => {
    if (collecting && pay.method === 'upi' && !pay.reference.trim()) {
      setRefError(UPI_REF_MISSING);
      refInput.current?.focus();
      return false;
    }
    return true;
  };
  // Show a server error about the UPI transaction ID (e.g. already used) next to its box. Returns true if handled.
  const takeError = (message) => {
    if (!collecting || pay.method !== 'upi' || !/UPI transaction ID/.test(message)) return false;
    setRefError(message);
    refInput.current?.focus();
    return true;
  };

  return {
    fee,
    check,
    takeError,
    payment: collecting ? { amount, method: pay.method, reference: pay.method === 'upi' ? pay.reference.trim() : '' } : undefined,
    error,
    ui,
  };
}

// Record a payment (or refund) against a booking, then show the receipt.
export function CollectPaymentModal({ booking: b, today, shiftLabel, shiftTime, onClose, onSaved }) {
  const [kind, setKind] = useState('payment');
  const [amount, setAmount] = useState(String(Math.max(b.balance, 0)));
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [refError, setRefError] = useState('');
  const refInput = useRef(null);
  const [paidOn, setPaidOn] = useState(today);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const upi = usePaymentSettings();
  const { confirmCash, cashDialog } = useCashConfirm();

  if (receipt) {
    return <ReceiptModal payment={receipt} shiftLabel={shiftLabel} shiftTime={shiftTime} balanceAfter={receipt.balanceAfter} onClose={onClose} />;
  }

  const switchKind = (k) => {
    setKind(k);
    setAmount(String(k === 'refund' ? b.paid : Math.max(b.balance, 0)));
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const n = Number(amount || 0);
    if (n < 1) return setError('Enter an amount.');
    if (kind === 'payment' && n > b.balance) return setError(`That's more than the ${inr(b.balance)} due.`);
    if (kind === 'refund' && n > b.paid) return setError(`You can refund at most ${inr(b.paid)}.`);
    if (method === 'upi' && !reference.trim()) {
      setRefError(UPI_REF_MISSING);
      refInput.current?.focus();
      return;
    }
    if (method === 'cash' && !(await confirmCash({ amount: n, who: b.memberName, refund: kind === 'refund' }))) return;
    setSaving(true);
    try {
      const { payment, booking } = await recordPayment({
        allocationId: b.id, kind, amount: n, method, reference: method === 'upi' ? reference.trim() : '', paidOn, notes,
      });
      onSaved?.(payment, booking);
      setReceipt({ ...payment, balanceAfter: booking.balance });
    } catch (err) {
      if (/UPI transaction ID/.test(err.message)) {
        setRefError(err.message);
        refInput.current?.focus();
      } else setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={kind === 'refund' ? 'Record a refund' : 'Collect payment'}
      subtitle={`${b.memberName} · Seat ${b.seatLabel} · ${shiftLabel}`}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="pay-form" className="btn btn-solid" disabled={saving}>
            {saving && <span className="spinner" />} {kind === 'refund' ? `Refund ${inr(amount)}` : `Record ${inr(amount)}`}
          </button>
        </>
      }
    >
      <form id="pay-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}
        <div className="balance-strip">
          <div><span>Fee</span><strong>{inr(b.fee)}</strong></div>
          <div><span>Paid</span><strong>{inr(b.paid)}</strong></div>
          <div className={b.balance > 0 ? 'is-due' : 'is-clear'}><span>Balance</span><strong>{inr(b.balance)}</strong></div>
        </div>
        {b.paid > 0 && (
          <div className="segmented" role="radiogroup" aria-label="Type">
            {[['payment', 'Payment'], ['refund', 'Refund']].map(([k, l]) => (
              <label key={k} className={kind === k ? 'on' : ''}>
                <input type="radio" name="kind" checked={kind === k} onChange={() => switchKind(k)} />
                {l}
              </label>
            ))}
          </div>
        )}
        <div className="form-row form-row-even">
          <label className="form-field">
            <span>Amount</span>
            <AmountInput value={amount} onChange={setAmount} autoFocus />
          </label>
          <label className="form-field">
            <span>Date</span>
            <input className="input" type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
        </div>
        <div className="form-field">
          <span>{kind === 'refund' ? 'Refunded by' : 'Paid by'}</span>
          <MethodPicker value={method} onChange={setMethod} />
        </div>
        {kind === 'payment' && method === 'upi' && onlineReady(upi) && Number(amount) > 0 && (
          <div className="desk-qr">
            <span className="hint">Ask the member to scan and pay, then record it below:</span>
            <UpiQr settings={upi} amount={Number(amount)} note={`Seat ${b.seatLabel} ${shiftLabel}`} size={150} />
          </div>
        )}
        {method === 'upi' && (
          <UpiRefField
            id="pay-upi-ref"
            inputRef={refInput}
            value={reference}
            error={refError}
            onChange={(v) => {
              setReference(v);
              if (v.trim()) setRefError('');
            }}
          />
        )}
        <label className="form-field">
          <span>Notes <em className="optional">optional</em></span>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder={kind === 'refund' ? 'e.g. Left early' : ''} />
        </label>
      </form>
      {cashDialog}
    </Modal>
  );
}

export function ReceiptModal({ payment: p, shiftLabel, shiftTime, balanceAfter, onClose, allowPrint = true }) {
  const [pdfBusy, setPdfBusy] = useState('');
  const [pdfError, setPdfError] = useState('');
  const shift = { label: shiftLabel, time: shiftTime };
  const pdf = async (kind, fn) => {
    setPdfBusy(kind);
    setPdfError('');
    try {
      await fn(p, shift);
    } catch (err) {
      if (err?.name !== 'AbortError') setPdfError("Couldn't create the PDF. Please try again.");
    } finally {
      setPdfBusy('');
    }
  };

  // Print only the receipt: hide the app behind it while the print dialog is open.
  const print = () => {
    document.body.classList.add('print-receipt');
    const done = () => {
      document.body.classList.remove('print-receipt');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };

  const refund = p.kind === 'refund';
  return (
    <Modal
      title={refund ? 'Refund receipt' : 'Payment receipt'}
      onClose={onClose}
      width={460}
      footer={
        <>
          {allowPrint && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={print}><PrintIcon width={16} height={16} /> Print</button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!pdfBusy} onClick={() => pdf('preview', previewReceiptPdf)}>
            {pdfBusy === 'preview' && <span className="spinner spinner-dark" />} Preview PDF
          </button>
          {canSharePdf() && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!pdfBusy} onClick={() => pdf('share', shareReceiptPdf)}>
              {pdfBusy === 'share' && <span className="spinner spinner-dark" />} Share
            </button>
          )}
          <button type="button" className="btn btn-solid btn-sm" disabled={!!pdfBusy} onClick={() => pdf('download', downloadReceiptPdf)}>
            {pdfBusy === 'download' && <span className="spinner" />} Download PDF
          </button>
        </>
      }
    >
      {pdfError && <div className="alert">{pdfError}</div>}
      <div className={`receipt${p.voidedAt ? ' is-void' : ''}`}>
        <header className="receipt-head">
          <LogoMark size={40} />
          <div>
            <strong>Knowledge Nest</strong>
            <span>Reading Room</span>
          </div>
          <div className="receipt-no">
            <span>{p.receiptNo}</span>
            <span>{fmtDate(p.paidOn)}</span>
          </div>
        </header>
        <div className="receipt-amount">
          <span>{refund ? 'Amount refunded' : 'Amount received'}</span>
          <strong>{inr(p.amount)}</strong>
        </div>
        <dl className="receipt-lines">
          <div><dt>{p.memberId ? 'Member' : 'Name'}</dt><dd>{p.memberName}</dd></div>
          {p.memberPhone && <div><dt>Phone</dt><dd>{p.memberPhone}</dd></div>}
          <div><dt>Seat</dt><dd>{p.seatLabel} · {shiftLabel}</dd></div>
          {p.bookingKind === 'day' ? (
            <div><dt>Date</dt><dd>{fmtDate(p.startDate)}</dd></div>
          ) : (
            <div><dt>Plan</dt><dd>{fmtShort(p.startDate)} – {fmtDate(p.endDate)}</dd></div>
          )}
          <div><dt>Method</dt><dd>{methodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ''}</dd></div>
          {p.notes && <div><dt>Notes</dt><dd>{p.notes}</dd></div>}
          {balanceAfter !== undefined && <div><dt>Balance due</dt><dd>{inr(balanceAfter)}</dd></div>}
          <div><dt>Received by</dt><dd>{p.receivedBy ?? 'Online payment'}</dd></div>
        </dl>
        {p.voidedAt && <p className="void-note">Voided: {p.voidReason}</p>}
        <p className="receipt-foot">Thank you for studying with us.</p>
      </div>
    </Modal>
  );
}

export function AdjustFeeModal({ booking: b, onClose, onSaved }) {
  const [fee, setFee] = useState(String(b.fee));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const n = Number(fee || 0);

  const submit = async (e) => {
    e.preventDefault();
    if (n < b.paid) return setError(`The fee can't be less than the ${inr(b.paid)} already paid. Record a refund first.`);
    setSaving(true);
    setError('');
    try {
      onSaved(await adjustFee(b.id, n));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Adjust fee"
      subtitle={`${b.memberName} · Seat ${b.seatLabel} · ${fmtShort(b.startDate)} – ${fmtDate(b.endDate)}`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="fee-form" className="btn btn-solid" disabled={saving || n === b.fee}>
            {saving && <span className="spinner" />} Save fee
          </button>
        </>
      }
    >
      <form id="fee-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}
        <label className="form-field">
          <span>Total fee for this booking</span>
          <AmountInput value={fee} onChange={setFee} autoFocus />
        </label>
        <p className="hint">
          Use this for discounts, waivers or corrections. Already paid: {inr(b.paid)}.
          {n !== b.fee && <> New balance: <strong>{inr(n - b.paid)}</strong>.</>}
        </p>
      </form>
    </Modal>
  );
}

export function VoidPaymentModal({ payment: p, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (reason.trim().length < 3) return setError('Give a short reason.');
    setSaving(true);
    try {
      onSaved(await voidPayment(p.id, reason.trim()));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Void ${p.receiptNo}?`}
      subtitle={`${inr(p.amount)} ${p.kind === 'refund' ? 'refund to' : 'from'} ${p.memberName} on ${fmtDate(p.paidOn)}`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="void-form" className="btn btn-danger" disabled={saving}>
            {saving && <span className="spinner" />} Void payment
          </button>
        </>
      }
    >
      <form id="void-form" onSubmit={submit} className="form-grid" noValidate>
        {error && <div className="alert">{error}</div>}
        <p className="confirm-text">
          Use this only for mistakes (wrong amount, entered twice). The entry stays in the ledger marked as void, and the
          booking's balance goes back up.
        </p>
        <label className="form-field">
          <span>Reason</span>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" maxLength={200} autoFocus />
        </label>
      </form>
    </Modal>
  );
}
