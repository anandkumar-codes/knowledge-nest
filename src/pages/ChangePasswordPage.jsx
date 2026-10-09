import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Logo from '../components/Logo.jsx';
import PasswordForm from '../components/PasswordForm.jsx';
import { useToast } from '../components/Toast.jsx';

// Shown straight after sign-in when an admin set (or reset) this person's password.
export default function ChangePasswordPage() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  if (loading) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;
  if (!user) return <Navigate to="/admin/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/admin/dashboard" replace />;

  return (
    <main className="standalone">
      <div className="standalone-card">
        <Logo tone="dark" size={40} />
        <h1>Choose your password</h1>
        <p className="standalone-sub">
          Hi {user.name.split(' ')[0]}, your administrator set a temporary password for you. Replace it with one only
          you know to continue.
        </p>

        <PasswordForm
          currentLabel="Temporary password"
          submitLabel="Save and continue"
          onDone={() => {
            toast('Password updated. Welcome to Knowledge Nest!');
            navigate('/admin/dashboard', { replace: true });
          }}
        />

        <button
          type="button"
          className="link standalone-signout"
          onClick={() => {
            logout();
            navigate('/admin/login');
          }}
        >
          Not you? Sign out
        </button>
      </div>
    </main>
  );
}
