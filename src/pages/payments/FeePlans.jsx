import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { getShifts } from '../../api/bookings.js';
import { Link } from 'react-router-dom';
import { getFees, inr, saveFees } from '../../api/payments.js';
import { useToast } from '../../components/Toast.jsx';

const KEYS = ['morning', 'evening', 'full', 'day'];
const MONTHLY = ['morning', 'evening', 'full'];

export default function FeePlans() {
  const { can, user } = useAuth();
  const toast = useToast();
  const canEdit = can('settings.manage');
  const [shifts, setShifts] = useState(null);
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getShifts(), getFees()])
      .then(([s, f]) => {
        setShifts(Object.fromEntries(s.map((x) => [x.key, x])));
        const asText = Object.fromEntries(KEYS.map((k) => [k, String(f[k])]));
        setSaved(asText);
        setForm(asText);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (!form) return error ? <div className="alert">{error}</div> : <div className="page-loading"><span className="spinner spinner-dark" /></div>;

  const dirty = KEYS.some((k) => form[k] !== saved[k]);
  const n = (k) => Number(form[k] || 0);
  const shared = n('morning') + n('evening');

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const f = await saveFees(Object.fromEntries(KEYS.map((k) => [k, n(k)])));
      const asText = Object.fromEntries(KEYS.map((k) => [k, String(f[k])]));
      setSaved(asText);
      setForm(asText);
      toast('Fee plans saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="timings" onSubmit={submit} noValidate>
      <div className="timing-cards fee-cards">
        {MONTHLY.map((k) => (
          <section key={k} className={`panel timing-card timing-${k}`}>
            <div className="timing-card-head">
              <div>
                <h3>{shifts[k].label}</h3>
                <span className="hint">{shifts[k].time}</span>
              </div>
            </div>
            <label className="form-field">
              <span>Monthly fee</span>
              <div className="amount-input amount-input-lg">
                <span aria-hidden="true">₹</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={form[k]}
                  disabled={!canEdit}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value.replace(/[^\d]/g, '') }))}
                />
              </div>
            </label>
            <dl className="plan-examples">
              {[1, 3, 6].map((m) => (
                <div key={m}><dt>{m} month{m > 1 ? 's' : ''}</dt><dd>{inr(n(k) * m)}</dd></div>
              ))}
            </dl>
          </section>
        ))}
        <section className="panel timing-card timing-day">
          <div className="timing-card-head">
            <div>
              <h3>Day pass</h3>
              <span className="hint">One whole day · {shifts.full.time}</span>
            </div>
          </div>
          <label className="form-field">
            <span>Per day</span>
            <div className="amount-input amount-input-lg">
              <span aria-hidden="true">₹</span>
              <input
                className="input"
                inputMode="numeric"
                value={form.day}
                disabled={!canEdit}
                onChange={(e) => setForm((f) => ({ ...f, day: e.target.value.replace(/[^\d]/g, '') }))}
              />
            </div>
          </label>
          <dl className="plan-examples">
            {[1, 5, 10].map((d) => (
              <div key={d}><dt>{d} day{d > 1 ? 's' : ''}</dt><dd>{inr(n('day') * d)}</dd></div>
            ))}
          </dl>
        </section>
      </div>

      <section className="panel insight">
        <p>
          A seat shared by one {shifts.morning.label.toLowerCase()} and one {shifts.evening.label.toLowerCase()} member earns{' '}
          <strong>{inr(shared)}</strong> a month; a {shifts.full.label.toLowerCase()} member pays <strong>{inr(n('full'))}</strong>.
          {n('full') < shared
            ? ` Full-day members get a ${inr(shared - n('full'))} discount compared with booking both shifts.`
            : ''}
          {n('day') > 0 && n('full') > 0 && (
            <>
              {' '}At <strong>{inr(n('day'))}</strong> a day, {Math.ceil(n('full') / n('day'))} day passes cost as much as a month of{' '}
              {shifts.full.label.toLowerCase()}.
            </>
          )}
        </p>
      </section>

      {error && <div className="alert">{error}</div>}

      {user.isSuperAdmin && (
        <p className="hint">
          UPI ID, QR code and online payment confirmation are in <Link to="/admin/settings/payments">Payment settings</Link>.
        </p>
      )}

      <div className="timings-foot">
        <p className="hint">
          {canEdit
            ? 'New prices are suggested for new bookings and extensions. Existing bookings keep the fee they were booked at.'
            : 'Only people with the "Manage reading room settings" permission can change fee plans.'}
        </p>
        {canEdit && (
          <div className="timings-actions">
            {dirty && <button type="button" className="btn btn-ghost" onClick={() => setForm(saved)}>Discard</button>}
            <button type="submit" className="btn btn-solid" disabled={!dirty || saving}>
              {saving && <span className="spinner" />} Save fee plans
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

