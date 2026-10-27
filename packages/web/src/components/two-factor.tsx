import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { encode } from 'uqr';
import { useAuth } from '../auth/AuthProvider.js';
import { MfaError } from '../auth/mfa.js';
import { useConfig } from '../config.js';
import { useI18n } from '../i18n/index.js';
import { Alert, Badge, Button, Card, CopyField, Field, Input, Loading } from './ui.js';

/** QR code drawn as one SVG path; always dark on white, as authenticator apps expect. */
function QrCode({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, size: qr.size };
  }, [value]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

type View = { step: 'loading' } | { step: 'status'; enabled: boolean } | { step: 'setup'; secret: string };

export function TwoFactorCard() {
  const { t } = useI18n();
  const { me, mfa } = useAuth();
  const { branding } = useConfig();
  const [view, setView] = useState<View>({ step: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const fail = (err: unknown) => {
    const kind = err instanceof MfaError ? err.code : 'failed';
    const text = kind === 'wrong_code' ? t('mfa.wrongCode') : kind === 'sign_in_again' ? t('mfa.signInAgain') : err instanceof Error ? err.message : String(err);
    setMessage({ tone: 'error', text });
  };

  useEffect(() => {
    if (!mfa) return;
    mfa.enabled().then(
      (enabled) => setView({ step: 'status', enabled }),
      (err: unknown) => {
        setView({ step: 'status', enabled: false });
        fail(err);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfa]);

  if (!mfa) {
    return (
      <Card title={t('mfa.title')}>
        <p className="muted">{t('mfa.federated')}</p>
      </Card>
    );
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const secret = await mfa.begin();
      setCode('');
      setView({ step: 'setup', secret });
    });

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await mfa.confirm(code.trim());
      setView({ step: 'status', enabled: true });
      setMessage({ tone: 'success', text: t('mfa.turnedOn') });
    });
  };

  const turnOff = () =>
    run(async () => {
      await mfa.disable();
      setView({ step: 'status', enabled: false });
      setMessage({ tone: 'success', text: t('mfa.turnedOff') });
    });

  const issuer = branding.appName;
  const uri = (secret: string) =>
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(me?.email ?? '')}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

  return (
    <Card
      title={t('mfa.title')}
      actions={view.step === 'status' && <Badge tone={view.enabled ? 'success' : 'neutral'}>{view.enabled ? t('mfa.badgeOn') : t('mfa.badgeOff')}</Badge>}
    >
      <p className="muted">{t('mfa.intro')}</p>
      {view.step === 'loading' && <Loading />}

      {view.step === 'status' && (
        <div>
          {view.enabled ? (
            <Button busy={busy} onClick={() => void turnOff()}>
              {t('mfa.turnOff')}
            </Button>
          ) : (
            <Button variant="primary" busy={busy} onClick={() => void start()}>
              {t('mfa.setUp')}
            </Button>
          )}
        </div>
      )}

      {view.step === 'setup' && (
        <form className="two-factor-setup" onSubmit={confirm}>
          <QrCode value={uri(view.secret)} label={t('mfa.qrLabel')} />
          <div className="stack">
            <p>{t('mfa.scan')}</p>
            <div className="field">
              <span className="field-label">{t('mfa.key')}</span>
              <CopyField value={view.secret.replace(/(.{4})(?=.)/g, '$1 ')} label={t('mfa.key')} />
            </div>
            <Field label={t('mfa.code')}>
              {(id) => (
                <Input
                  id={id}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  required
                  className="input code-input"
                />
              )}
            </Field>
            <div className="row">
              <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6}>
                {t('mfa.confirm')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setView({ step: 'status', enabled: false })}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </form>
      )}

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </Card>
  );
}
