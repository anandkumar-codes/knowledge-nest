import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { changePassword } from '../auth/authService.js';
import { EyeIcon, EyeOffIcon } from './Icons.jsx';

// Change-your-own-password form, used on the first-sign-in screen and the My account page.
// `changeFn(current, next)` overrides the default (staff) password change, e.g. for the member portal.
export default function PasswordForm({ currentLabel = 'Current password', submitLabel = 'Update password', changeFn, onDone }) {
  const { setCurrentUser } = useAuth() ?? {};
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setError('');
  };

  const rules = [
    { ok: form.next.length >= 8, label: 'At least 8 characters' },
    { ok: /[a-z]/i.test(form.next) && /\d/.test(form.next), label: 'Contains a letter and a number' },
    { ok: !!form.next && form.next !== form.current, label: 'Different from your current password' },
    { ok: !!form.next && form.next === form.confirm, label: 'Both new passwords match' },
  ];
  const valid = !!form.current && rules.every((r) => r.ok);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return setError('Check the requirements below.');
    setSaving(true);
    try {
      const result = changeFn ? await changeFn(form.current, form.next) : await changePassword(form.current, form.next);
      setForm({ current: '', next: '', confirm: '' });
      if (!changeFn) setCurrentUser(result);
      onDone?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const type = show ? 'text' : 'password';

  return (
    <form onSubmit={submit} className="form-grid password-form" noValidate>
      {error && <div className="alert" role="alert">{error}</div>}

      <label className="form-field">
        <span>{currentLabel}</span>
        <input className="input" type={type} autoComplete="current-password" value={form.current} onChange={set('current')} />
      </label>
      <label className="form-field">
        <span>New password</span>
        <div className="input-with-btn">
          <input className="input" type={type} autoComplete="new-password" value={form.next} onChange={set('next')} />
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide passwords' : 'Show passwords'}
          >
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </label>
      <label className="form-field">
        <span>Confirm new password</span>
        <input className="input" type={type} autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
      </label>

      <ul className="pw-rules" aria-label="Password requirements">
        {rules.map((r) => (
          <li key={r.label} className={r.ok ? 'ok' : ''}>
            <span className="tick" aria-hidden="true">{r.ok ? '✓' : ''}</span>
            {r.label}
            <span className="sr-only">{r.ok ? '(met)' : '(not met)'}</span>
          </li>
        ))}
      </ul>

      <button type="submit" className="btn btn-solid btn-block btn-lg" disabled={saving}>
        {saving && <span className="spinner" />} {submitLabel}
      </button>
    </form>
  );
}
