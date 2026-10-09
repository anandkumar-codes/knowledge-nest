import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useMember } from './MemberAuth.jsx';
import Logo from '../components/Logo.jsx';
import { EyeIcon, EyeOffIcon, LockIcon } from '../components/Icons.jsx';
import '../styles/memberPortal.css';

export default function MemberLogin() {
  const { member, loading, login } = useMember();
  const [form, setForm] = useState({ phone: '', password: '', remember: true });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);

  if (loading) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;
  if (member) return <Navigate to="/member" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.phone.trim() || !form.password) return setError('Enter your phone number and password.');
    setBusy(true);
    setError('');
    try {
      await login(form);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="standalone member-login">
      <div className="standalone-card">
        <Logo tone="dark" size={40} tagline="Member portal" />
        <h1>Welcome, reader</h1>
        <p className="standalone-sub">Check your seat, see your dues and pay your fees online.</p>

        <form onSubmit={submit} className="form-grid" noValidate>
          {error && <div className="alert" role="alert">{error}</div>}
          <label className="form-field">
            <span>Phone number</span>
            <input className="input input-lg" type="tel" inputMode="tel" autoComplete="username" value={form.phone} onChange={set('phone')} placeholder="98765 43210" autoFocus />
          </label>
          <label className="form-field">
            <span>Password</span>
            <div className="input-with-btn">
              <input className="input input-lg" type={show ? 'text' : 'password'} autoComplete="current-password" value={form.password} onChange={set('password')} />
              <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={form.remember} onChange={set('remember')} />
            <span className="box" />
            Keep me signed in on this phone
          </label>
          <button type="submit" className="btn btn-solid btn-block btn-lg" disabled={busy}>
            {busy && <span className="spinner" />} Sign in
          </button>
        </form>

        <button type="button" className="link member-help" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
          <LockIcon width={14} height={14} /> First time here, or forgot your password?
        </button>
        {help && (
          <p className="forgot-hint">
            Ask the front desk to turn on portal access for you. They'll give you a one-time password, and you'll choose
            your own the first time you sign in.
          </p>
        )}
        <p className="member-switch">
          Staff member? <Link to="/admin/login">Sign in to the admin console</Link>
        </p>
      </div>
    </main>
  );
}
