// Sendless Pro. Licensed under the Sendless Enterprise License (see ee/LICENSE).
import { useState, type FormEvent } from 'react';
import type { SsoProviderInfo } from '@sendless/shared';
import { api } from '@sendless/web/api';
import { useConfig } from '@sendless/web/config';
import { useI18n } from '@sendless/web/i18n';
import { Alert, AsyncView, Badge, Button, Card, ConfirmButton, CopyButton, EmptyState, Field, Input, isApiError, ProGate, Select, useAsync } from '@sendless/web/ui';

const SAML_EMAIL = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';
const domainList = (value: string) => value.split(/[\s,;]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);

function AddProvider({ onAdded }: { onAdded(): void }) {
  const { t } = useI18n();
  const [type, setType] = useState<'saml' | 'oidc'>('saml');
  const [name, setName] = useState('');
  const [metadataUrl, setMetadataUrl] = useState('');
  const [emailAttribute, setEmailAttribute] = useState(SAML_EMAIL);
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [domains, setDomains] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const emailDomains = domainList(domains);
      await api.post(
        '/api/admin/sso/providers',
        type === 'saml' ? { type, name, metadataUrl, emailAttribute, emailDomains } : { type, name, issuer, clientId, clientSecret, emailDomains },
      );
      setName('');
      setClientSecret('');
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label={t('pro.sso.type')}>
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as 'saml' | 'oidc')}>
              <option value="saml">SAML 2.0 (Entra ID, Okta, ADFS…)</option>
              <option value="oidc">OpenID Connect (Google, Okta, Auth0…)</option>
            </Select>
          )}
        </Field>
        <Field label={t('pro.sso.name')} hint={t('pro.sso.nameHint')}>
          {(id, d) => <Input id={id} aria-describedby={d} required pattern="[A-Za-z0-9][A-Za-z0-9-]{1,31}" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>
      {type === 'saml' ? (
        <div className="form-grid">
          <Field label={t('pro.sso.metadataUrl')}>{(id) => <Input id={id} type="url" required value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)} />}</Field>
          <Field label={t('pro.sso.emailAttribute')}>{(id) => <Input id={id} required value={emailAttribute} onChange={(e) => setEmailAttribute(e.target.value)} />}</Field>
        </div>
      ) : (
        <div className="form-grid">
          <Field label={t('pro.sso.issuer')}>{(id) => <Input id={id} type="url" required value={issuer} onChange={(e) => setIssuer(e.target.value)} />}</Field>
          <Field label={t('pro.sso.clientId')}>{(id) => <Input id={id} required value={clientId} onChange={(e) => setClientId(e.target.value)} />}</Field>
          <Field label={t('pro.sso.clientSecret')}>
            {(id) => <Input id={id} type="password" required autoComplete="off" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />}
          </Field>
        </div>
      )}
      <Field label={t('pro.sso.domains')} hint={t('pro.sso.domainsHint')} optional>
        {(id, d) => <Input id={id} aria-describedby={d} value={domains} placeholder="example.com" onChange={(e) => setDomains(e.target.value)} />}
      </Field>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" variant="primary" busy={busy}>
          {t('pro.sso.add')}
        </Button>
      </div>
    </form>
  );
}

export function SsoPage() {
  const { t } = useI18n();
  const { auth } = useConfig();
  const state = useAsync(() => api.get<{ items: SsoProviderInfo[] }>('/api/admin/sso/providers'), []);
  if (isApiError(state.error, 'pro_required')) return <ProGate licensed={false}>{null}</ProGate>;

  const spValues = [
    { label: t('pro.sso.acsUrl'), value: `https://${auth.domain}/saml2/idpresponse` },
    { label: t('pro.sso.entityId'), value: `urn:amazon:cognito:sp:${auth.userPoolId}` },
    { label: t('pro.sso.redirectUrl'), value: `https://${auth.domain}/oauth2/idpresponse` },
  ];

  return (
    <div className="stack">
      <Card title={t('admin.sso')}>
        <p className="muted">{t('pro.sso.intro')}</p>
        <p>{t('pro.sso.spInfo')}</p>
        <dl className="facts">
          {spValues.map((v) => (
            <div key={v.label} className="facts-row">
              <dt>{v.label}</dt>
              <dd className="mono small">
                {v.value} <CopyButton value={v.value} label={t('common.copy')} />
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <AsyncView state={state}>
        {({ items }) => (
          <Card title={t('pro.sso.providers')}>
            {items.length === 0 ? (
              <EmptyState>{t('pro.sso.none')}</EmptyState>
            ) : (
              <ul className="list">
                {items.map((p) => (
                  <li key={p.name} className="list-row">
                    <div className="list-main">
                      <span className="list-title">
                        {p.name} <Badge>{p.type.toUpperCase()}</Badge>
                      </span>
                      {p.emailDomains.length > 0 && <span className="muted">{p.emailDomains.join(', ')}</span>}
                    </div>
                    <div className="list-side">
                      <ConfirmButton
                        confirmText={t('common.confirmDelete')}
                        onConfirm={async () => {
                          await api.delete(`/api/admin/sso/providers/${encodeURIComponent(p.name)}`);
                          state.reload();
                        }}
                      >
                        {t('pro.sso.remove')}
                      </ConfirmButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </AsyncView>
      <Card title={t('pro.sso.add')}>
        <AddProvider onAdded={state.reload} />
      </Card>
    </div>
  );
}
