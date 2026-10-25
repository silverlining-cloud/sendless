import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.js';
import { PublicLayout } from '../components/layout.js';
import { Alert, Button, Loading } from '../components/ui.js';
import { useT } from '../i18n/index.js';

export function AuthCallbackPage() {
  const { completeSignIn } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React StrictMode runs effects twice; the code can only be used once.
    started.current = true;
    completeSignIn()
      .then((to) => navigate(to, { replace: true }))
      .catch(() => setFailed(true));
  }, [completeSignIn, navigate]);

  return (
    <PublicLayout>
      {failed ? (
        <div className="stack">
          <Alert tone="error">{t('auth.callbackError')}</Alert>
          <div>
            <Button variant="primary" onClick={() => navigate('/', { replace: true })}>
              {t('app.backHome')}
            </Button>
          </div>
        </div>
      ) : (
        <Loading />
      )}
    </PublicLayout>
  );
}

export function NotFoundPage() {
  const t = useT();
  return (
    <div className="empty">
      <h1>404</h1>
      <p>{t('app.notFound')}</p>
      <a className="btn btn-primary" href="/">
        {t('app.backHome')}
      </a>
    </div>
  );
}
