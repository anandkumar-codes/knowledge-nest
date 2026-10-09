import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import SeatMap from '../components/SeatMap.jsx';
import Logo from '../components/Logo.jsx';
import {
  AlertIcon, ArrowIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon, ShieldIcon,
} from '../components/Icons.jsx';
import '../styles/login.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate({ email, password }) {
  const errors = {};
  if (!email.trim()) errors.email = 'Email is required.';
  else if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Password is required.';
  return errors;
}

export default function AdminLogin() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '', remember: true });
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');
  const [shake, setShake] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  if (loading) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;
  if (user) return <Navigate to="/admin/dashboard" replace />;

  const errors = validate(form);
  const showError = (field) => touched[field] && errors[field];

  const update = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
    setAuthError('');
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 450);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (Object.keys(errors).length) return triggerShake();

    setSubmitting(true);
    setAuthError('');
    try {
      await login(form);
      navigate(location.state?.from?.pathname ?? '/admin/dashboard', { replace: true });
    } catch (err) {
      setAuthError(err.message || 'Sign-in failed. Please try again.');
      triggerShake();
      setSubmitting(false);
    }
  };

  return (
    <main className="login">
      {/* Showcase panel */}
      <section className="showcase">
        <div className="lamp-glow" />
        <div className="grain" />

        <header className="brand">
          <Logo tone="light" size={46} />
        </header>

        <div className="showcase-body">
          <p className="eyebrow">Admin console</p>
          <h1 className="headline">
            Every seat, every member, <em>one quiet place</em> to run it all.
          </h1>
          <p className="sub">
            Manage seat allocation, memberships, shifts and fee collection for your study hall at a glance.
          </p>
          <SeatMap />
        </div>

        <footer className="showcase-foot">
          <ShieldIcon width={16} height={16} />
          Restricted area · authorised staff only
        </footer>
      </section>

      {/* Form panel */}
      <section className="form-panel">
        <div className={`card${shake ? ' shake' : ''}`}>
          <div className="mobile-brand">
            <Logo tone="dark" size={42} />
          </div>

          <h2>Welcome back</h2>
          <p className="card-sub">Sign in to the Knowledge Nest admin dashboard.</p>

          {authError && (
            <div className="alert" role="alert">
              <AlertIcon />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={onSubmit} noValidate>
            <div className={`field${showError('email') ? ' has-error' : ''}`}>
              <label htmlFor="email">Email address</label>
              <div className="input-wrap">
                <MailIcon className="input-icon" />
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@knowledgenest.in"
                  value={form.email}
                  onChange={update('email')}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  aria-invalid={!!showError('email')}
                  aria-describedby="email-error"
                  autoFocus
                />
              </div>
              <p id="email-error" className="field-error">{showError('email') || ''}</p>
            </div>

            <div className={`field${showError('password') ? ' has-error' : ''}`}>
              <div className="label-row">
                <label htmlFor="password">Password</label>
                <button type="button" className="link" onClick={() => setForgotOpen((o) => !o)} aria-expanded={forgotOpen}>
                  Forgot password?
                </button>
              </div>
              <div className="input-wrap">
                <LockIcon className="input-icon" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={update('password')}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock'))}
                  aria-invalid={!!showError('password')}
                  aria-describedby="password-error"
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              <p id="password-error" className={`field-error${!showError('password') && capsLock ? ' warn' : ''}`}>
                {showError('password') || (capsLock ? 'Caps Lock is on.' : '')}
              </p>
            </div>

            {forgotOpen && (
              <p className="forgot-hint" role="note">
                Ask your administrator to reset it from the Team page. You'll get a temporary password and choose a new
                one when you sign in.
              </p>
            )}

            <label className="checkbox">
              <input type="checkbox" checked={form.remember} onChange={update('remember')} />
              <span className="box" />
              Keep me signed in
            </label>

            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? (
                <><span className="spinner" /> Signing in…</>
              ) : (
                <>Sign in <ArrowIcon /></>
              )}
            </button>
          </form>

        </div>

        <p className="portal-switch">
          Member? <a href="/member/login">Sign in to the member portal</a>
        </p>
        <p className="legal">© {new Date().getFullYear()} Knowledge Nest · Reading Room Management</p>
      </section>
    </main>
  );
}
