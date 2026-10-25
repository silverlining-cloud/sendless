import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { isApiError } from './components/ui.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { initColorScheme } from './color-scheme.js';
import { ConfigProvider } from './config.js';
import { I18nProvider, useT } from './i18n/index.js';
import './styles.css';

function Boot({ error, retry }: { error?: Error; retry?: () => void }) {
  const t = useT();
  if (!error) {
    return (
      <div className="boot">
        <span className="spinner" role="status" aria-label={t('app.loading')} />
      </div>
    );
  }
  return (
    <div className="boot">
      <div className="card">
        <h1>{isApiError(error, 'not_configured') ? t('app.notConfigured') : t('app.error')}</h1>
        <p className="muted">{error.message}</p>
        <button className="btn btn-primary" onClick={retry}>
          {t('app.retry')}
        </button>
      </div>
    </div>
  );
}

initColorScheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ConfigProvider fallback={<Boot />} error={(error, retry) => <Boot error={error} retry={retry} />}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ConfigProvider>
    </I18nProvider>
  </StrictMode>,
);
