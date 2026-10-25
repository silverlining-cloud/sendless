// Sendless Pro. Licensed under the Sendless Enterprise License (see ee/LICENSE).
import { useState, type FormEvent } from 'react';
import type { AdminSettings, Policies } from '@sendless/shared';
import { api } from '@sendless/web/api';
import { useConfig } from '@sendless/web/config';
import { useI18n } from '@sendless/web/i18n';
import { Alert, AsyncView, Button, Card, Checkbox, Field, Input, ProGate, useAsync } from '@sendless/web/ui';

const list = (value: string) =>
  value
    .split(/[\s,;]+/)
    .map((v) => v.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);

function PoliciesForm({ initial, malwareScanning }: { initial: Policies; malwareScanning: boolean }) {
  const { t } = useI18n();
  const [p, setP] = useState(initial);
  const [extensions, setExtensions] = useState(initial.blockedExtensions.join(', '));
  const [domains, setDomains] = useState(initial.allowedRecipientDomains.join(', '));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.put<Policies>('/api/admin/policies', { ...p, blockedExtensions: list(extensions), allowedRecipientDomains: list(domains) });
      setP(saved);
      setMessage({ tone: 'success', text: t('common.saved') });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const optionalNumber = (value: string) => (value ? Math.max(1, Number(value)) : null);

  return (
    <form className="stack" onSubmit={save}>
      <Card title={t('admin.policies')}>
        <p className="muted">{t('pro.policies.intro')}</p>
        <div className="stack">
          <Checkbox label={t('pro.policies.requirePassword')} checked={p.requirePassword} onChange={(e) => setP({ ...p, requirePassword: e.target.checked })} />
          <div className="form-grid">
            <Field label={t('pro.policies.minPasswordLength')}>
              {(id) => <Input id={id} type="number" min={1} max={128} value={p.minPasswordLength} onChange={(e) => setP({ ...p, minPasswordLength: Math.max(1, Number(e.target.value)) })} />}
            </Field>
            <Field label={t('pro.policies.maxExpires')}>
              {(id) => (
                <Input id={id} type="number" min={1} value={p.maxExpiresInHours ?? ''} placeholder={t('pro.policies.noLimit')} onChange={(e) => setP({ ...p, maxExpiresInHours: optionalNumber(e.target.value) })} />
              )}
            </Field>
            <Field label={t('pro.policies.maxOpens')}>
              {(id) => (
                <Input id={id} type="number" min={1} value={p.maxOpensLimit ?? ''} placeholder={t('pro.policies.noLimit')} onChange={(e) => setP({ ...p, maxOpensLimit: optionalNumber(e.target.value) })} />
              )}
            </Field>
            <Field label={t('pro.policies.auditRetention')}>
              {(id) => <Input id={id} type="number" min={1} max={3650} value={p.auditRetentionDays} onChange={(e) => setP({ ...p, auditRetentionDays: Math.max(1, Number(e.target.value)) })} />}
            </Field>
          </div>
          <Checkbox label={t('pro.policies.requireOpenLimit')} checked={p.requireOpenLimit} onChange={(e) => setP({ ...p, requireOpenLimit: e.target.checked })} />
          <Field label={t('pro.policies.blockedExtensions')} hint={t('pro.policies.blockedExtensionsHint')}>
            {(id, d) => <Input id={id} aria-describedby={d} value={extensions} onChange={(e) => setExtensions(e.target.value)} />}
          </Field>
          <Field label={t('pro.policies.allowedDomains')} hint={t('pro.policies.allowedDomainsHint')}>
            {(id, d) => <Input id={id} aria-describedby={d} value={domains} onChange={(e) => setDomains(e.target.value)} />}
          </Field>
          {malwareScanning && (
            <Checkbox
              label={t('pro.policies.allowUnscannable')}
              hint={t('pro.policies.allowUnscannableHint')}
              checked={p.allowUnscannableFiles}
              onChange={(e) => setP({ ...p, allowUnscannableFiles: e.target.checked })}
            />
          )}
        </div>
      </Card>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div>
        <Button type="submit" variant="primary" busy={busy}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

export function PoliciesPage() {
  const config = useConfig();
  const state = useAsync(() => api.get<AdminSettings>('/api/admin/settings'), []);
  return (
    <AsyncView state={state}>
      {(data) => (
        <ProGate licensed={Boolean(data.license?.features.includes('policies'))}>
          <PoliciesForm initial={data.policies} malwareScanning={data.system.malwareScanningAvailable || config.features.malwareScanning} />
        </ProGate>
      )}
    </AsyncView>
  );
}
