import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppLayout, PublicLayout } from './components/layout.js';
import { Loading } from './components/ui.js';
import { AuthCallbackPage, NotFoundPage } from './pages/AuthCallbackPage.js';
import { DownloadPage } from './pages/DownloadPage.js';
import { RequestUploadPage } from './pages/RequestUploadPage.js';
import { SendPage } from './pages/SendPage.js';

// Recipients only load the public pages; everything for signed-in users and admins is split off.
const TransfersPage = lazy(() => import('./pages/TransfersPage.js').then((m) => ({ default: m.TransfersPage })));
const TransferDetailPage = lazy(() => import('./pages/TransfersPage.js').then((m) => ({ default: m.TransferDetailPage })));
const RequestsPage = lazy(() => import('./pages/RequestsPage.js').then((m) => ({ default: m.RequestsPage })));
const RequestDetailPage = lazy(() => import('./pages/RequestsPage.js').then((m) => ({ default: m.RequestDetailPage })));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.js').then((m) => ({ default: m.AdminLayout })));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage.js').then((m) => ({ default: m.SettingsPage })));
const UsersPage = lazy(() => import('./pages/admin/UsersPage.js').then((m) => ({ default: m.UsersPage })));
const LicensePage = lazy(() => import('./pages/admin/LicensePage.js').then((m) => ({ default: m.LicensePage })));
const AuditPage = lazy(() => import('@sendless/ee/web').then((m) => ({ default: m.AuditPage })));
const PoliciesPage = lazy(() => import('@sendless/ee/web').then((m) => ({ default: m.PoliciesPage })));
const SsoPage = lazy(() => import('@sendless/ee/web').then((m) => ({ default: m.SsoPage })));

const page = (element: ReactNode) => <Suspense fallback={<Loading />}>{element}</Suspense>;

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public: recipients and uploaders, no account */}
        <Route path="/d/:id" element={<PublicLayout><DownloadPage /></PublicLayout>} />
        <Route path="/r/:id" element={<PublicLayout><RequestUploadPage /></PublicLayout>} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        {/* Signed in */}
        <Route element={<AppLayout />}>
          <Route index element={<SendPage />} />
          <Route path="transfers" element={page(<TransfersPage />)} />
          <Route path="transfers/:id" element={page(<TransferDetailPage />)} />
          <Route path="requests" element={page(<RequestsPage />)} />
          <Route path="requests/:id" element={page(<RequestDetailPage />)} />
          <Route path="admin" element={page(<AdminLayout />)}>
            <Route index element={<Navigate to="settings" replace />} />
            <Route path="settings" element={page(<SettingsPage />)} />
            <Route path="users" element={page(<UsersPage />)} />
            <Route path="license" element={page(<LicensePage />)} />
            <Route path="audit" element={page(<AuditPage />)} />
            <Route path="policies" element={page(<PoliciesPage />)} />
            <Route path="sso" element={page(<SsoPage />)} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
