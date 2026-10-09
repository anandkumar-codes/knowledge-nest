import { useEffect, useRef, useState } from 'react';
import { getPaymentSettings, onlineReady, readQrImage, savePaymentSettings } from '../api/paymentSettings.js';
import UpiQr from '../components/UpiQr.jsx';
import { useToast } from '../components/Toast.jsx';
import { CrownIcon } from '../components/Icons.jsx';
import '../styles/payments.css';
import '../styles/memberPortal.css';
import '../styles/bookings.css';

const KEYS = ['vpa', 'payee', 'qrMode', 'qrImage', 'autoConfirm'];

// Super admin only: where Knowledge Nest receives UPI payments and how member payments are confirmed.
export default function PaymentSettingsPage() {
  const toast = useToast();
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    getPaymentSettings()
      .then((s) => {
        setSaved(s);
        setForm(s);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (!form) return error ? <div className="page"><div className="alert">{error}</div></div> : <div className="page-loading"><span className="spinner spinner-dark" /></div>;

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError('');
  };
  const dirty = KEYS.some((k) => form[k] !== saved[k]);
  const ready = onlineReady(form);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await readQrImage(file);
      setForm((f) => ({ ...f, qrImage: data, qrMode: 'uploaded' }));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const s = await savePaymentSettings({
        vpa: form.vpa.trim(),
        payee: form.payee.trim(),
        qrMode: form.qrMode,
        qrImage: form.qrImage,
        autoConfirm: form.autoConfirm,
      });
      setSaved(s);
      setForm(s);
      toast('Payment settings saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow"><CrownIcon width={13} height={13} /> Super admin</p>
          <h1>Payment settings</h1>
          <p className="page-sub">How members and the front desk take UPI payments.</p>
        </div>
      </header>

      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel">
            <div className="panel-head">
              <h2>UPI ID</h2>
              <p>The account payments go to. Find it in your bank or UPI business app (e.g. knowledgenest@okhdfcbank).</p>
            </div>
            <div className="form-row form-row-even">
              <label className="form-field">
                <span>UPI ID</span>
                <input className="input" value={form.vpa} onChange={(e) => set('vpa', e.target.value)} placeholder="knowledgenest@okhdfcbank" autoCapitalize="none" spellCheck={false} />
              </label>
              <label className="form-field">
                <span>Name shown when paying</span>
                <input className="input" value={form.payee} onChange={(e) => set('payee', e.target.value)} placeholder="Knowledge Nest" maxLength={60} />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>QR code</h2>
              <p>Choose which QR code members and staff see when paying by UPI.</p>
            </div>
            <div className="choice-cards qr-choice" role="radiogroup" aria-label="QR code to show">
              <label className={form.qrMode === 'generated' ? 'on' : ''}>
                <input type="radio" name="qrMode" checked={form.qrMode === 'generated'} onChange={() => set('qrMode', 'generated')} />
                <strong>Create from my UPI ID</strong>
                <span>Recommended. The exact amount is filled in automatically, so nobody types it wrong.</span>
              </label>
              <label className={form.qrMode === 'uploaded' ? 'on' : ''}>
                <input type="radio" name="qrMode" checked={form.qrMode === 'uploaded'} onChange={() => set('qrMode', 'uploaded')} />
                <strong>Use my own QR code</strong>
                <span>Upload the QR from your bank, GPay for Business, PhonePe or Paytm. Payers type the amount.</span>
              </label>
            </div>

            {form.qrMode === 'uploaded' && (
              <div className="qr-upload">
                {form.qrImage ? (
                  <img src={form.qrImage} alt="Your uploaded QR code" />
                ) : (
                  <div className="qr-upload-empty">No QR code uploaded yet</div>
                )}
                <div className="qr-upload-actions">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} hidden />
                  <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                    {form.qrImage ? 'Replace image' : 'Upload QR image'}
                  </button>
                  {form.qrImage && (
                    <button type="button" className="link link-muted" onClick={() => set('qrImage', '')}>Remove</button>
                  )}
                  <small className="hint">PNG, JPG or WebP. A clear screenshot of the QR works well.</small>
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Confirming member payments</h2>
              <p>After paying, members enter the 12-digit UPI transaction ID from their payment app.</p>
            </div>
            <label className="switch-row">
              <span className="switch">
                <input type="checkbox" checked={form.autoConfirm} onChange={(e) => set('autoConfirm', e.target.checked)} disabled={!ready} />
                <span className="switch-track" aria-hidden="true" />
              </span>
              <span>
                <strong>Mark member UPI payments as paid automatically</strong>
                <small>
                  {form.autoConfirm
                    ? 'On: the payment is recorded and the receipt issued as soon as the member submits the transaction ID.'
                    : 'Off: each payment waits in Payments → Online payments until staff approve it.'}
                </small>
              </span>
            </label>
            {form.autoConfirm && (
              <div className="note settings-warning">
                UPI doesn't tell this app when money arrives, so auto-confirmed payments are based on the transaction ID the
                member enters. Check them against your bank statement under Payments → Online payments → Approved, and
                void any that don't match. For bank-verified confirmation, connect a payment gateway such as Razorpay.
              </div>
            )}
            {!ready && <p className="hint">Add a UPI ID or upload a QR code to turn this on.</p>}
          </section>

          {error && <div className="alert">{error}</div>}
          <div className="timings-foot">
            <p className="hint">Only the super admin can change these. Everyone else sees the result when collecting or paying.</p>
            <div className="timings-actions">
              {dirty && <button type="button" className="btn btn-ghost" onClick={() => setForm(saved)}>Discard</button>}
              <button type="button" className="btn btn-solid" onClick={save} disabled={!dirty || saving}>
                {saving && <span className="spinner" />} Save settings
              </button>
            </div>
          </div>
        </div>

        <aside className="panel settings-preview">
          <div className="panel-head">
            <h2>Preview</h2>
            <p>What a member or the front desk sees for a ₹900 payment.</p>
          </div>
          {ready ? (
            <UpiQr settings={form} amount={900} note="Seat C4 Morning" size={170} />
          ) : (
            <p className="preview-empty">Online UPI payments are off. Members are asked to pay at the front desk.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
