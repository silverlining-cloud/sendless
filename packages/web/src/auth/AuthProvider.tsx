import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import type { AuthConfig, Me } from '@sendless/shared';
import { api, configureAuth } from '../api/client.js';
import { useConfig } from '../config.js';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  me: Me | null;
  signIn(opts?: { returnTo?: string; email?: string }): Promise<void>;
  signOut(): Promise<void>;
  /** Handles the OAuth redirect; returns where to go next. */
  completeSignIn(): Promise<string>;
}

const AuthContext = createContext<AuthState | null>(null);
const DEV_TOKEN = 'sendless.devToken';

function createUserManager(auth: AuthConfig): UserManager {
  return new UserManager({
    authority: `https://cognito-idp.${auth.region}.amazonaws.com/${auth.userPoolId}`,
    client_id: auth.clientId,
    redirect_uri: `${location.origin}/auth/callback`,
    post_logout_redirect_uri: `${location.origin}/`,
    response_type: 'code',
    scope: 'openid email profile',
    // Tokens stay in this tab's session storage; a new tab re-uses the Cognito session with one redirect.
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    automaticSilentRenew: true,
    loadUserInfo: false,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useConfig();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const manager = useMemo(() => (auth.mode === 'cognito' ? createUserManager(auth) : null), [auth]);
  const signedOutRef = useRef(() => {});

  const token = useCallback(async (): Promise<string | null> => {
    if (!manager) return sessionStorage.getItem(DEV_TOKEN);
    let user = await manager.getUser();
    if (!user) return null;
    if ((user.expires_in ?? 0) < 60) {
      try {
        user = await manager.signinSilent();
      } catch {
        return null;
      }
    }
    return user?.id_token ?? null;
  }, [manager]);

  const loadMe = useCallback(async () => {
    try {
      const current = await api.get<Me>('/api/me');
      setMe(current);
      setStatus('signedIn');
    } catch {
      setMe(null);
      setStatus('signedOut');
    }
  }, []);

  signedOutRef.current = () => {
    setMe(null);
    setStatus('signedOut');
    if (manager) void manager.removeUser();
    else sessionStorage.removeItem(DEV_TOKEN);
  };

  useEffect(() => {
    configureAuth(token, () => signedOutRef.current());
    if (location.pathname === '/auth/callback') return; // the callback page finishes sign-in
    void (async () => {
      if (!(await token())) {
        setStatus('signedOut');
        return;
      }
      await loadMe();
    })();
  }, [token, loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      async signIn(opts = {}) {
        if (manager) {
          await manager.signinRedirect({ state: { returnTo: opts.returnTo ?? location.pathname } });
          return;
        }
        sessionStorage.setItem(DEV_TOKEN, `dev:${(opts.email ?? '').trim().toLowerCase()}`);
        setStatus('loading');
        await loadMe();
      },
      async signOut() {
        setMe(null);
        setStatus('signedOut');
        if (!manager) {
          sessionStorage.removeItem(DEV_TOKEN);
          return;
        }
        await manager.removeUser();
        const logout = new URL(`https://${auth.domain}/logout`);
        logout.searchParams.set('client_id', auth.clientId);
        logout.searchParams.set('logout_uri', `${location.origin}/`);
        location.assign(logout.toString());
      },
      async completeSignIn() {
        if (!manager) return '/';
        const user = await manager.signinRedirectCallback();
        await loadMe();
        const returnTo = (user.state as { returnTo?: string } | undefined)?.returnTo;
        return returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
      },
    }),
    [status, me, manager, auth, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
