import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

// `permission` may be a string or array (any-of). Omit it to only require sign-in.
export default function ProtectedRoute({ permission, superAdmin = false, children }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();

  if (loading) return <div className="page-loading"><span className="spinner spinner-dark" /></div>;
  if (!user) return <Navigate to="/admin/login" replace state={{ from: location }} />;
  // Admin-issued passwords must be replaced before anything else (the API enforces this too).
  if (user.mustChangePassword) return <Navigate to="/admin/change-password" replace />;

  const required = [].concat(permission ?? []);
  if ((superAdmin && !user.isSuperAdmin) || (required.length && !can(...required))) {
    return (
      <div className="empty-state">
        <h2>No access</h2>
        <p>Your role doesn't include access to this page. Ask your administrator if you need it.</p>
      </div>
    );
  }
  return children;
}
