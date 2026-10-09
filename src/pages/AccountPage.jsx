import { useAuth } from '../auth/AuthContext.jsx';
import { timeAgo } from '../api/team.js';
import { initials } from '../components/AdminLayout.jsx';
import { CrownIcon } from '../components/Icons.jsx';
import PasswordForm from '../components/PasswordForm.jsx';
import { useToast } from '../components/Toast.jsx';

export default function AccountPage() {
  const { user } = useAuth();
  const toast = useToast();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">Account</p>
          <h1>My account</h1>
          <p className="page-sub">Your profile and sign-in details.</p>
        </div>
      </header>

      <div className="account-grid">
        <section className="panel">
          <div className="profile">
            <span className={`avatar avatar-lg${user.isSuperAdmin ? ' avatar-sand' : ''}`}>{initials(user.name)}</span>
            <div>
              <h2>{user.name}</h2>
              <p>{user.email}</p>
            </div>
          </div>
          <dl className="details">
            <div>
              <dt>Role</dt>
              <dd>
                {user.isSuperAdmin ? (
                  <span className="badge badge-sand"><CrownIcon width={12} height={12} /> Super admin</span>
                ) : (
                  <span className="badge">{user.role?.name}</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>{new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
            </div>
            <div>
              <dt>Last sign-in</dt>
              <dd>{timeAgo(user.lastLoginAt)}</dd>
            </div>
          </dl>
          <p className="hint">To change your name, email or role, ask {user.isSuperAdmin ? 'a developer' : 'your administrator'}.</p>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Change password</h2>
            <p>You'll stay signed in on this device.</p>
          </div>
          <PasswordForm onDone={() => toast('Your password has been changed.')} />
        </section>
      </div>
    </div>
  );
}
