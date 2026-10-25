import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider.js';
import { useConfig } from '../config.js';
import { useI18n } from '../i18n/index.js';
import { InboxIcon, ListIcon, SendIcon, SettingsIcon } from './icons.js';
import { Button, Card, Field, Input, Loading } from './ui.js';

function Brand() {
  const { branding } = useConfig();
  return (
    <a href="/" className="brand">
      {branding.logoUrl ? <img src={branding.logoUrl} alt={branding.appName} /> : <span className="brand-mark" aria-hidden="true" />}
      {!branding.logoUrl && <span className="brand-name">{branding.appName}</span>}
    </a>
  );
}

function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="lang" role="group" aria-label={t('nav.language')}>
      {(['en', 'de'] as const).map((l) => (
        <button key={l} type="button" className={l === locale ? 'active' : ''} aria-pressed={l === locale} onClick={() => setLocale(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function Footer() {
  const { branding } = useConfig();
  const { t } = useI18n();
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span>{branding.footerText}</span>
        <nav>
          {branding.privacyUrl && (
            <a href={branding.privacyUrl} target="_blank" rel="noopener noreferrer">
              {t('footer.privacy')}
            </a>
          )}
          {branding.imprintUrl && (
            <a href={branding.imprintUrl} target="_blank" rel="noopener noreferrer">
              {t('footer.imprint')}
            </a>
          )}
          <LanguageSwitch />
        </nav>
      </div>
    </footer>
  );
}

/** Pages for recipients: branding only, no navigation. */
export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand />
        </div>
      </header>
      <main className="container narrow">{children}</main>
      <Footer />
    </div>
  );
}

function SignIn() {
  const { auth, branding } = useConfig();
  const { signIn } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const [email, setEmail] = useState('admin@example.com');
  const [busy, setBusy] = useState(false);
  return (
    <div className="signin">
      <Card>
        <h1>{branding.welcomeTitle || t('auth.title')}</h1>
        <p className="muted">{branding.welcomeText || t('auth.text')}</p>
        {auth.mode === 'dev' ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void signIn({ email }).finally(() => setBusy(false));
            }}
          >
            <p className="hint">{t('auth.devHint')}</p>
            <Field label={t('auth.email')}>{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Button type="submit" variant="primary" busy={busy}>
              {t('auth.signIn')}
            </Button>
          </form>
        ) : (
          <Button variant="primary" onClick={() => void signIn({ returnTo: location.pathname + location.search })}>
            {t('auth.signIn')}
          </Button>
        )}
      </Card>
    </div>
  );
}

/** Signed-in area. Shows the sign-in screen when nobody is signed in. */
export function AppLayout() {
  const { status, me, signOut } = useAuth();
  const { t } = useI18n();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand />
          {status === 'signedIn' && (
            <nav className="nav" aria-label="Main">
              <NavLink to="/" end>
                <SendIcon /> <span>{t('nav.send')}</span>
              </NavLink>
              <NavLink to="/transfers">
                <ListIcon /> <span>{t('nav.transfers')}</span>
              </NavLink>
              <NavLink to="/requests">
                <InboxIcon /> <span>{t('nav.requests')}</span>
              </NavLink>
              {me?.isAdmin && (
                <NavLink to="/admin">
                  <SettingsIcon /> <span>{t('nav.admin')}</span>
                </NavLink>
              )}
            </nav>
          )}
          {status === 'signedIn' && (
            <div className="user">
              <span className="muted user-email" title={me?.email}>
                {me?.email}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void signOut()}>
                {t('nav.signOut')}
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="container">{status === 'loading' ? <Loading /> : status === 'signedOut' ? <SignIn /> : <Outlet />}</main>
      <Footer />
    </div>
  );
}
