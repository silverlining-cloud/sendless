// Sendless Pro. Licensed under the Sendless Enterprise License (see ee/LICENSE).
import { useState, type FormEvent } from 'react';
import type { AdminSettings, ProBranding } from '@sendless/shared';
import { api } from '@sendless/web/api';
import { useReloadConfig } from '@sendless/web/config';
import { useI18n } from '@sendless/web/i18n';
import { Alert, AsyncView, Button, Card, Field, Input, ProGate, TextArea, useAsync } from '@sendless/web/ui';

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

/** Optional texts are kept as typed while editing and trimmed when saving; blank means the default. */
const optional = (v: string | null) => v?.trim() || null;

function BrandingForm({ initial }: { initial: ProBranding }) {
  const { t } = useI18n();
  const reloadConfig = useReloadConfig();
  const [b, setB] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const set = (patch: Partial<ProBranding>) => setB({ ...b, ...patch });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.put<ProBranding>('/api/admin/branding', {
        ...b,
        logoUrl: optional(b.logoUrl),
        welcomeTitle: optional(b.welcomeTitle),
        welcomeText: optional(b.welcomeText),
        footerText: optional(b.footerText),
      });
      setB(saved);
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
      <Card title={t('pro.branding.logoAndColors')}>
        <p className="muted">{t('pro.branding.intro')}</p>
        <Field label={t('admin.logoUrl')} optional hint={t('pro.branding.logoHint')}>
          {(id, d) => <Input id={id} aria-describedby={d} type="url" value={b.logoUrl ?? ''} placeholder="https://" onChange={(e) => set({ logoUrl: e.target.value || null })} />}
        </Field>
        <div className="form-grid form-grid-3">
          <ColorField label={t('admin.primaryColor')} value={b.primaryColor} onChange={(v) => set({ primaryColor: v })} />
          <ColorField label={t('admin.backgroundColor')} value={b.backgroundColor} onChange={(v) => set({ backgroundColor: v })} />
          <ColorField label={t('admin.textColor')} value={b.textColor} onChange={(v) => set({ textColor: v })} />
        </div>
        <p className="hint">{t('admin.colorsLightOnly')}</p>
      </Card>

      <Card title={t('pro.branding.texts')}>
        <Field label={t('admin.welcomeTitle')} optional>
          {(id) => <Input id={id} maxLength={120} value={b.welcomeTitle ?? ''} onChange={(e) => set({ welcomeTitle: e.target.value || null })} />}
        </Field>
        <Field label={t('admin.welcomeText')} optional>
          {(id) => <TextArea id={id} maxLength={1000} value={b.welcomeText ?? ''} onChange={(e) => set({ welcomeText: e.target.value || null })} />}
        </Field>
        <Field label={t('admin.footerText')} optional>
          {(id) => <Input id={id} maxLength={500} value={b.footerText ?? ''} onChange={(e) => set({ footerText: e.target.value || null })} />}
        </Field>
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

export function BrandingPage() {
  const state = useAsync(() => api.get<AdminSettings>('/api/admin/settings'), []);
  return (
    <AsyncView state={state}>
      {(data) => (
        <ProGate licensed={Boolean(data.license?.features.includes('branding'))}>
          <BrandingForm initial={data.branding} />
        </ProGate>
      )}
    </AsyncView>
  );
}
