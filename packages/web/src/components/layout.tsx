import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { DEFAULT_APP_NAME, SOURCE_URL } from '@sendless/shared';
import { useAuth } from '../auth/AuthProvider.js';
import { useConfig } from '../config.js';
import { useI18n } from '../i18n/index.js';
import { GitHubIcon, InboxIcon, ListIcon, SendIcon, SettingsIcon, ShieldIcon } from './icons.js';
import { Button, Card, Field, Input, Loading } from './ui.js';

/** The built-in logos belong to Sendless; a renamed installation without its own logo shows its name instead. */
function useBuiltInLogo(): boolean {
  const { branding } = useConfig();
  return !branding.logoUrl && branding.appName === DEFAULT_APP_NAME;
}

/** Dark-gray logo for the light theme, light-gray copy for the dark theme (switched in CSS). */
function BuiltInLogo({ name, className, alt }: { name: 'sendless-wordmark' | 'sendless-tagline'; className: string; alt: string }) {
  return (
    <>
      <img src={`/brand/${name}.png`} alt={alt} className={`${className} logo-for-light`} />
      <img src={`/brand/${name}-light.png`} alt={alt} className={`${className} logo-for-dark`} />
    </>
  );
}

function Brand() {
  const { branding } = useConfig();
  const builtIn = useBuiltInLogo();
  return (
    <a href="/" className="brand">
      {builtIn ? (
        <>
          <span className="brand-wordmark">
            <BuiltInLogo name="sendless-wordmark" className="builtin-logo" alt={branding.appName} />
          </span>
          {/* Small screens: the round icon instead of the wordmark, so the navigation still fits. */}
          <img src="/brand/sendless-icon.png" alt={branding.appName} className="builtin-logo brand-icon" />
        </>
      ) : branding.logoUrl ? (
        <img src={branding.logoUrl} alt={branding.appName} />
      ) : (
        <>
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">{branding.appName}</span>
        </>
      )}
    </a>
  );
}

function Footer() {
  const { branding, edition } = useConfig();
  const { t } = useI18n();
  const community = edition === 'community';
  const text = branding.footerText ?? (community ? t('footer.communityEdition') : null);
  if (!text && !branding.privacyUrl && !branding.imprintUrl && !community) return null;
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span className="footer-text">{text}</span>
        <nav aria-label={t('footer.links')}>
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
          {community && (
            <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" title={t('footer.sourceCodeTitle')}>
              <GitHubIcon size={14} />
              {t('footer.sourceCode')}
            </a>
          )}
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
  const builtIn = useBuiltInLogo();
  return (
    <div className="signin">
      <Card>
        {builtIn && (
          <div className="signin-logo">
            <BuiltInLogo name="sendless-tagline" className="builtin-logo" alt="sendless.cloud — secure file transfer in your own cloud" />
          </div>
        )}
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
                  <ShieldIcon /> <span>{t('nav.admin')}</span>
                </NavLink>
              )}
            </nav>
          )}
          {status === 'signedIn' && (
            <div className="user">
              {/* Personal settings: appearance and language. The page also shows who is signed in. */}
              <NavLink to="/settings" className="user-settings" title={t('nav.settings')} aria-label={t('nav.settings')}>
                <SettingsIcon />
              </NavLink>
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
