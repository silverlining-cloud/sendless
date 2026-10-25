import { useState } from 'react';
import type { AdminSettings } from '@sendless/shared';
import { api } from '../../api/client.js';
import { Alert, AsyncView, Badge, Button, Card, Field, TextArea, useAsync } from '../../components/ui.js';
import { useReloadConfig } from '../../config.js';
import { dateTime } from '../../format.js';
import { useI18n } from '../../i18n/index.js';

/** Where customers buy Pro. Replace with the final Marketplace listing URL. */
export const PRO_URL = 'https://aws.amazon.com/marketplace/pp/prodview-vgrm5lfr2hgnu';

export function LicensePage() {
  const { t, locale } = useI18n();
  const reloadConfig = useReloadConfig();
  const state = useAsync(() => api.get<AdminSettings>('/api/admin/settings'), []);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      state.setData(await api.put<AdminSettings>('/api/admin/license', { key: value }));
      setKey('');
      await reloadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AsyncView state={state}>
      {({ license, licenseError }) => (
        <div className="stack">
          <Card title={t('admin.license')}>
            <p className="muted">{t('admin.licenseIntro')}</p>
            <dl className="facts">
              <dt>{t('admin.edition')}</dt>
              <dd>
                <Badge tone={license ? 'brand' : 'neutral'}>{license ? t('admin.pro') : t('admin.community')}</Badge>
              </dd>
              {license && (
                <>
                  <dt>{t('admin.licensee')}</dt>
                  <dd>{license.licensee}</dd>
                  <dt>{t('admin.licenseExpires')}</dt>
                  <dd>{dateTime(license.expiresAt, locale)}</dd>
                  <dt>{t('admin.licenseFeatures')}</dt>
                  <dd>{license.features.join(', ')}</dd>
                </>
              )}
            </dl>
            {licenseError && <Alert tone="warning">{licenseError}</Alert>}
            {license ? (
              <Button variant="ghost" busy={busy} onClick={() => void save('')}>
                {t('admin.removeLicense')}
              </Button>
            ) : (
              <a className="btn btn-secondary" href={PRO_URL} target="_blank" rel="noopener noreferrer">
                {t('admin.getPro')}
              </a>
            )}
          </Card>
          <Card title={t('admin.installLicense')}>
            <div className="stack">
              <Field label={t('admin.licenseKey')}>
                {(id) => <TextArea id={id} className="input mono" rows={4} value={key} spellCheck={false} onChange={(e) => setKey(e.target.value)} />}
              </Field>
              {error && <Alert tone="error">{error}</Alert>}
              <div>
                <Button variant="primary" busy={busy} disabled={!key.trim()} onClick={() => void save(key.trim())}>
                  {t('admin.installLicense')}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </AsyncView>
  );
}
