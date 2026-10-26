import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { CreateTransferResult } from '@sendless/shared';
import { api } from '../api/client.js';
import { FilePicker, validateFiles } from '../components/files.js';
import { CheckIcon } from '../components/icons.js';
import { UploadProgressCard, useUpload } from '../components/upload-progress.js';
import { Alert, Button, Card, Checkbox, CopyField, Field, Input, Select, TextArea } from '../components/ui.js';
import { useConfig } from '../config.js';
import { duration, lifetimeOptions } from '../format.js';
import { useI18n } from '../i18n/index.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Done {
  url: string;
  transferId: string;
  emailed: number;
}

export function SendPage() {
  const { limits, features } = useConfig();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const upload = useUpload();

  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [hours, setHours] = useState(limits.defaultExpiresInHours);
  const [unlimited, setUnlimited] = useState(limits.defaultMaxOpens === null && limits.allowUnlimitedOpens);
  const [maxOpens, setMaxOpens] = useState(limits.defaultMaxOpens ?? Math.min(10, limits.maxOpensLimit ?? 10));
  const [usePassword, setUsePassword] = useState(limits.requirePassword);
  const [password, setPassword] = useState('');
  const [recipients, setRecipients] = useState('');
  const [notify, setNotify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const options = lifetimeOptions(limits.maxExpiresInHours);
  if (!options.includes(hours)) options.push(hours);
  options.sort((a, b) => a - b);

  const reset = () => {
    setFiles([]);
    setTitle('');
    setMessage('');
    setPassword('');
    setRecipients('');
    setDone(null);
    setError(null);
    upload.reset();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const fileError = validateFiles(files, limits, limits.maxTransferBytes, t, locale);
    if (fileError) return setError(fileError);
    if (usePassword && [...password].length < limits.minPasswordLength) {
      return setError(password ? t('send.passwordShort', { count: limits.minPasswordLength }) : t('send.passwordRequired'));
    }
    const emails = recipients.split(/[\s,;]+/).map((r) => r.trim()).filter(Boolean);
    const invalid = emails.find((r) => !EMAIL.test(r));
    if (invalid) return setError(t('send.invalidEmail', { email: invalid }));

    setBusy(true);
    try {
      const created = await api.post<CreateTransferResult>('/api/transfers', {
        title: title || undefined,
        message: message || undefined,
        files: files.map((f) => ({ name: f.name, size: f.size, contentType: f.type || 'application/octet-stream' })),
        expiresInHours: hours,
        maxOpens: unlimited ? null : maxOpens,
        password: usePassword ? password : undefined,
        recipients: emails,
        notifyOnOpen: notify,
      });
      setBusy(false);
      const result = await upload.start(created.upload, files);
      if (result?.url) setDone({ url: result.url, transferId: result.transferId, emailed: emails.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="narrow-center">
        <Card className="done">
          <div className="done-icon">
            <CheckIcon size={28} />
          </div>
          <h1>{t('send.doneTitle')}</h1>
          <p className="muted">{t('send.doneText')}</p>
          <CopyField value={done.url} />
          {done.emailed > 0 && <p className="muted">{t('send.doneEmailed', { count: done.emailed })}</p>}
          <div className="row">
            <Button variant="primary" onClick={reset}>
              {t('send.another')}
            </Button>
            <Button onClick={() => navigate(`/transfers/${done.transferId}`)}>{t('send.viewTransfer')}</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (upload.phase === 'uploading' && upload.progress) {
    return (
      <div className="narrow-center">
        <UploadProgressCard progress={upload.progress} onCancel={upload.cancel} />
      </div>
    );
  }

  return (
    <form className="send-grid" onSubmit={submit} noValidate>
      <div className="stack">
        <h1>{t('send.title')}</h1>
        <FilePicker files={files} onChange={setFiles} />
      </div>
      <Card>
        <div className="stack">
          <Field label={t('common.title')} optional>
            {(id) => <Input id={id} value={title} maxLength={200} placeholder={t('send.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label={t('common.message')} optional>
            {(id) => (
              <TextArea id={id} value={message} maxLength={5000} placeholder={t('send.messagePlaceholder')} onChange={(e) => setMessage(e.target.value)} />
            )}
          </Field>
          <div className="row-2">
            <Field label={t('send.expiresIn')}>
              {(id) => (
                <Select id={id} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  {options.map((h) => (
                    <option key={h} value={h}>
                      {duration(h, t)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('send.maxOpens')}>
              {(id) => (
                <div className="inline-input">
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={limits.maxOpensLimit ?? 100000}
                    value={unlimited ? '' : maxOpens}
                    disabled={unlimited}
                    onChange={(e) => setMaxOpens(Math.max(1, Number(e.target.value)))}
                  />
                  <span className="muted">{t('send.times')}</span>
                </div>
              )}
            </Field>
          </div>
          {limits.allowUnlimitedOpens && limits.maxOpensLimit === null && (
            <Checkbox label={t('send.unlimitedDownloads')} checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />
          )}
          {!limits.requirePassword && (
            <Checkbox label={t('send.protect')} checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
          )}
          {usePassword && (
            <Field label={t('common.password')} hint={t('send.passwordHint', { count: limits.minPasswordLength })}>
              {(id, describedBy) => (
                <Input
                  id={id}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={password}
                  aria-describedby={describedBy}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
          )}
          {features.email && (
            <>
              <Field label={t('send.recipients')} optional>
                {(id) => (
                  <Input id={id} type="text" value={recipients} placeholder={t('send.recipientsPlaceholder')} onChange={(e) => setRecipients(e.target.value)} />
                )}
              </Field>
              <Checkbox label={t('send.notify')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            </>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" variant="primary" busy={busy} disabled={files.length === 0}>
            {t('send.submit')}
          </Button>
        </div>
      </Card>
    </form>
  );
}
