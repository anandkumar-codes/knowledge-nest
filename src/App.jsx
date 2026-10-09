import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import AdminLogin from './pages/AdminLogin.jsx';
import Dashboard from './pages/Dashboard.jsx';
import TeamPage from './pages/TeamPage.jsx';
import RolesPage from './pages/RolesPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import SeatsPage from './pages/SeatsPage.jsx';
import MembersPage from './pages/MembersPage.jsx';
import MemberDetailPage from './pages/MemberDetailPage.jsx';
import BookingsPage from './pages/BookingsPage.jsx';
import PaymentsPage from './pages/PaymentsPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import PaymentSettingsPage from './pages/PaymentSettingsPage.jsx';
import ChangePasswordPage from './pages/ChangePasswordPage.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';
import { MemberProvider } from './member/MemberAuth.jsx';
import MemberLogin from './member/MemberLogin.jsx';
import MemberLayout from './member/MemberLayout.jsx';
import MemberHome from './member/MemberHome.jsx';
import MemberPayments from './member/MemberPayments.jsx';
import MemberProfile from './member/MemberProfile.jsx';

// "Knowledge Nest · Member" in the member portal, "Knowledge Nest · Admin" everywhere else.
function PageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `Knowledge Nest · ${pathname.startsWith('/member') ? 'Member' : 'Admin'}`;
  }, [pathname]);
  return null;
}

function LegacyPortalRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={pathname.replace(/^\/student/, '/member') + search} replace />;
}

export default function App() {
  return (
    <>
      <PageTitle />
      <Routes>
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/change-password" element={<ChangePasswordPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="account" element={<AccountPage />} />
          <Route
            path="seats"
            element={<ProtectedRoute permission={['seats.view', 'seats.manage']}><SeatsPage /></ProtectedRoute>}
          />
          <Route
            path="members"
            element={<ProtectedRoute permission={['members.view', 'members.manage']}><MembersPage /></ProtectedRoute>}
          />
          <Route
            path="members/:id"
            element={<ProtectedRoute permission={['members.view', 'members.manage']}><MemberDetailPage /></ProtectedRoute>}
          />
          <Route
            path="bookings"
            element={<ProtectedRoute permission={['bookings.view', 'bookings.manage']}><BookingsPage /></ProtectedRoute>}
          />
          <Route
            path="payments"
            element={<ProtectedRoute permission={['payments.view', 'payments.manage']}><PaymentsPage /></ProtectedRoute>}
          />
          <Route
            path="reports"
            element={<ProtectedRoute permission="reports.view"><ReportsPage /></ProtectedRoute>}
          />
          <Route
            path="settings/payments"
            element={<ProtectedRoute superAdmin><PaymentSettingsPage /></ProtectedRoute>}
          />
          <Route
            path="team"
            element={<ProtectedRoute permission={['team.view', 'team.manage']}><TeamPage /></ProtectedRoute>}
          />
          <Route
            path="roles"
            element={<ProtectedRoute permission={['team.view', 'team.manage', 'roles.manage']}><RolesPage /></ProtectedRoute>}
          />
        </Route>
        <Route path="/member" element={<MemberProvider><Outlet /></MemberProvider>}>
          <Route path="login" element={<MemberLogin />} />
          <Route element={<MemberLayout />}>
            <Route index element={<MemberHome />} />
            <Route path="payments" element={<MemberPayments />} />
            <Route path="profile" element={<MemberProfile />} />
          </Route>
        </Route>
        {/* Old portal links (e.g. sign-in details already shared over WhatsApp) used /student. */}
        <Route path="/student/*" element={<LegacyPortalRedirect />} />
        <Route path="*" element={<Navigate to="/admin/login" replace />} />
      </Routes>
    </>
  );
}
