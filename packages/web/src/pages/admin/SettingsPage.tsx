import { useState, type FormEvent } from 'react';
import { GiB, type AdminSettings, type SettingsInput } from '@s3ndless/shared';
import { api } from '../../api/client.js';
import { Alert, AsyncView, Button, Card, Checkbox, Field, Input, Select, TextArea, useAsync } from '../../components/ui.js';
import { applyTheme, useReloadConfig } from '../../config.js';
import { duration, lifetimeOptions } from '../../format.js';
import { useI18n } from '../../i18n/index.js';

function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <Field label={label}>
      {(id) => (
        <div className="color-field">
          <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
          <Input id={id} value={value} pattern="#[0-9a-fA-F]{6}" maxLength={7} onChange={(e) => onChange(e.target.value)} />
        </div>
      )}
    </Field>
  );
}

const nullable = (v: string) => (v.trim() ? v.trim() : null);

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
      const saved = await api.put<AdminSettings>('/api/admin/settings', s);
      setS(saved.settings);
      applyTheme(saved.settings.branding);
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
      <Card title={t('admin.branding')}>
        <div className="form-grid">
          <Field label={t('admin.appName')}>
            {(id) => <Input id={id} required maxLength={60} value={b.appName} onChange={(e) => setBranding({ appName: e.target.value })} />}
          </Field>
          <Field label={t('admin.logoUrl')} optional>
            {(id) => <Input id={id} type="url" value={b.logoUrl ?? ''} placeholder="https://" onChange={(e) => setBranding({ logoUrl: nullable(e.target.value) })} />}
          </Field>
          <ColorField label={t('admin.primaryColor')} value={b.primaryColor} onChange={(v) => setBranding({ primaryColor: v })} />
          <ColorField label={t('admin.backgroundColor')} value={b.backgroundColor} onChange={(v) => setBranding({ backgroundColor: v })} />
          <ColorField label={t('admin.textColor')} value={b.textColor} onChange={(v) => setBranding({ textColor: v })} />
          <Field label={t('admin.welcomeTitle')} optional>
            {(id) => <Input id={id} maxLength={120} value={b.welcomeTitle ?? ''} onChange={(e) => setBranding({ welcomeTitle: nullable(e.target.value) })} />}
          </Field>
        </div>
        <Field label={t('admin.welcomeText')} optional>
          {(id) => <TextArea id={id} maxLength={1000} value={b.welcomeText ?? ''} onChange={(e) => setBranding({ welcomeText: nullable(e.target.value) })} />}
        </Field>
        <div className="form-grid">
          <Field label={t('admin.footerText')} optional>
            {(id) => <Input id={id} maxLength={500} value={b.footerText ?? ''} onChange={(e) => setBranding({ footerText: nullable(e.target.value) })} />}
          </Field>
          <Field label={t('admin.privacyUrl')} optional>
            {(id) => <Input id={id} type="url" value={b.privacyUrl ?? ''} placeholder="https://" onChange={(e) => setBranding({ privacyUrl: nullable(e.target.value) })} />}
          </Field>
          <Field label={t('admin.imprintUrl')} optional>
            {(id) => <Input id={id} type="url" value={b.imprintUrl ?? ''} placeholder="https://" onChange={(e) => setBranding({ imprintUrl: nullable(e.target.value) })} />}
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
