import { useState, type FormEvent } from 'react';
import { GiB, type AdminSettings, type SettingsInput } from '@sendless/shared';
import { api } from '../../api/client.js';
import { Alert, AsyncView, Button, Card, Checkbox, Field, Input, Select, useAsync } from '../../components/ui.js';
import { useReloadConfig } from '../../config.js';
import { duration, lifetimeOptions } from '../../format.js';
import { useI18n } from '../../i18n/index.js';

/** Optional URLs: kept as typed while editing, trimmed when saving; empty means none. */
const optionalUrl = (v: string | null) => v?.trim() || null;

function SettingsForm({ initial }: { initial: AdminSettings }) {
  const { t } = useI18n();
  const reloadConfig = useReloadConfig();
  const [s, setS] = useState<SettingsInput>(initial.settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const maxHours = initial.system.maxRetentionDays * 24;
  const b = s.branding;
  const setBranding = (patch: Partial<SettingsInput['branding']>) => setS({ ...s, branding: { ...b, ...patch } });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const branding = { ...b, appName: b.appName.trim(), privacyUrl: optionalUrl(b.privacyUrl), imprintUrl: optionalUrl(b.imprintUrl) };
      const saved = await api.put<AdminSettings>('/api/admin/settings', { ...s, branding });
      setS(saved.settings);
      await reloadConfig();
      setMessage({ tone: 'success', text: t('common.saved') });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      <Card title={t('admin.general')}>
        <div className="form-grid">
          <Field label={t('admin.appName')}>
            {(id) => <Input id={id} required maxLength={60} value={b.appName} onChange={(e) => setBranding({ appName: e.target.value })} />}
          </Field>
          <Field label={t('admin.privacyUrl')} optional>
            {(id) => <Input id={id} type="url" value={b.privacyUrl ?? ''} placeholder="https://" onChange={(e) => setBranding({ privacyUrl: e.target.value || null })} />}
          </Field>
          <Field label={t('admin.imprintUrl')} optional>
            {(id) => <Input id={id} type="url" value={b.imprintUrl ?? ''} placeholder="https://" onChange={(e) => setBranding({ imprintUrl: e.target.value || null })} />}
          </Field>
        </div>
      </Card>

      <Card title={t('admin.defaults')}>
        <div className="form-grid">
          <Field label={t('admin.defaultExpiry')}>
            {(id) => (
              <Select id={id} value={s.defaults.expiresInHours} onChange={(e) => setS({ ...s, defaults: { ...s.defaults, expiresInHours: Number(e.target.value) } })}>
                {lifetimeOptions(maxHours).map((h) => (
                  <option key={h} value={h}>
                    {duration(h, t)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('admin.defaultOpens')}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                value={s.defaults.maxOpens ?? ''}
                placeholder={t('common.unlimited')}
                onChange={(e) => setS({ ...s, defaults: { ...s.defaults, maxOpens: e.target.value ? Math.max(1, Number(e.target.value)) : null } })}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title={t('admin.limits')}>
        <div className="form-grid">
          <Field label={t('admin.maxTransferSize')}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0.1}
                step={0.1}
                value={Math.round((s.limits.maxTransferBytes / GiB) * 10) / 10}
                onChange={(e) => setS({ ...s, limits: { ...s.limits, maxTransferBytes: Math.max(1, Math.round(Number(e.target.value) * GiB)) } })}
              />
            )}
          </Field>
          <Field label={t('admin.maxFiles')}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={500}
                value={s.limits.maxFilesPerTransfer}
                onChange={(e) => setS({ ...s, limits: { ...s.limits, maxFilesPerTransfer: Math.max(1, Number(e.target.value)) } })}
              />
            )}
          </Field>
        </div>
        <Checkbox
          label={t('admin.allowUnlimited')}
          checked={s.limits.allowUnlimitedOpens}
          onChange={(e) => setS({ ...s, limits: { ...s.limits, allowUnlimitedOpens: e.target.checked } })}
        />
        <Checkbox label={t('admin.showSender')} checked={s.showSenderEmail} onChange={(e) => setS({ ...s, showSenderEmail: e.target.checked })} />
        <p className="hint">{t('admin.maxRetention', { count: initial.system.maxRetentionDays })}</p>
      </Card>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div>
        <Button type="submit" variant="primary" busy={busy}>
          {t('common.save')}
        </Button>
      </div>

      <Card title={t('admin.system')}>
        <dl className="facts">
          <dt>{t('admin.version')}</dt>
          <dd className="mono">{initial.system.version}</dd>
          <dt>{t('admin.region')}</dt>
          <dd className="mono">{initial.system.region}</dd>
          <dt>{t('admin.email')}</dt>
          <dd>{initial.system.emailEnabled ? t('admin.emailOn') : t('admin.emailOff')}</dd>
          <dt>URL</dt>
          <dd className="mono">{initial.system.appUrl}</dd>
        </dl>
      </Card>
    </form>
  );
}

export function SettingsPage() {
  const state = useAsync(() => api.get<AdminSettings>('/api/admin/settings'), []);
  return <AsyncView state={state}>{(data) => <SettingsForm initial={data} />}</AsyncView>;
}
