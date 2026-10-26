import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../../auth/AuthProvider.js';
import { Badge, PageHeader } from '../../components/ui.js';
import { useConfig } from '../../config.js';
import { useT, type MessageKey } from '../../i18n/index.js';
import { NotFoundPage } from '../AuthCallbackPage.js';

const SECTIONS: { path: string; label: MessageKey; pro?: boolean }[] = [
  { path: 'settings', label: 'admin.settings' },
  { path: 'users', label: 'admin.users' },
  { path: 'license', label: 'admin.license' },
  { path: 'branding', label: 'admin.branding', pro: true },
  { path: 'audit', label: 'admin.audit', pro: true },
  { path: 'policies', label: 'admin.policies', pro: true },
  { path: 'sso', label: 'admin.sso', pro: true },
];

export function AdminLayout() {
  const t = useT();
  const { me } = useAuth();
  const { edition } = useConfig();
  if (!me?.isAdmin) return <NotFoundPage />;
  return (
    <div className="stack">
      <PageHeader title={t('admin.title')} actions={<Badge tone={edition === 'pro' ? 'brand' : 'neutral'}>{edition === 'pro' ? t('admin.pro') : t('admin.community')}</Badge>} />
      <nav className="subnav" aria-label={t('admin.title')}>
        {SECTIONS.map((s) => (
          <NavLink key={s.path} to={`/admin/${s.path}`}>
            {t(s.label)}
            {s.pro && edition !== 'pro' && <span className="pro-tag">{t('common.proFeature')}</span>}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
