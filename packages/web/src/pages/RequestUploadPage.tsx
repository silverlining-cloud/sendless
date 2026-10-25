import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import type { PublicRequest, SubmissionResult } from '@s3ndless/shared';
import { publicApi } from '../api/client.js';
import { FilePicker, validateFiles } from '../components/files.js';
import { CheckIcon, ClockIcon, LockIcon } from '../components/icons.js';
import { UploadProgressCard, useUpload } from '../components/upload-progress.js';
import { Alert, Button, Card, Field, Input, isApiError, Loading, TextArea, useAsync } from '../components/ui.js';
import { useConfig } from '../config.js';
import { bytes, dateTime } from '../format.js';
import { useI18n } from '../i18n/index.js';
import { Unavailable } from './DownloadPage.js';

export function RequestUploadPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const { limits } = useConfig();
  const meta = useAsync(() => publicApi.get<PublicRequest>(`/api/public/requests/${encodeURIComponent(id)}`), [id]);
  const upload = useUpload();
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (meta.error) {
    if (isApiError(meta.error, 'not_found')) return <Unavailable title={t('download.missingTitle')} text={t('download.missingText')} />;
    if (isApiError(meta.error, 'expired', 'limit_reached')) return <Unavailable title={t('upload.closedTitle')} text={t('upload.closedText')} />;
    return <Alert tone="error">{meta.error instanceof Error ? meta.error.message : t('app.error')}</Alert>;
  }
  if (!meta.data) return <Loading />;
  const request = meta.data;

  if (done) {
    return (
      <Card className="public-card center">
        <div className="done-icon">
          <CheckIcon size={28} />
        </div>
        <h1>{t('upload.doneTitle')}</h1>
        <p className="muted">{t('upload.doneText')}</p>
        <Button
          onClick={() => {
            setDone(false);
            setFiles([]);
            upload.reset();
            meta.reload();
          }}
        >
          {t('upload.again')}
        </Button>
      </Card>
    );
  }

  if (upload.phase === 'uploading' && upload.progress) {
    return <UploadProgressCard progress={upload.progress} onCancel={upload.cancel} />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const fileError = validateFiles(files, { ...limits, maxFilesPerTransfer: request.maxFilesPerSubmission }, request.maxBytesPerSubmission, t, locale);
    if (fileError) return setError(fileError);
    setBusy(true);
    try {
      const { upload: plan } = await publicApi.post<SubmissionResult>(`/api/public/requests/${encodeURIComponent(id)}/submissions`, {
        password: password || undefined,
        name: name || undefined,
        email: email || undefined,
        message: message || undefined,
        files: files.map((f) => ({ name: f.name, size: f.size, contentType: f.type || 'application/octet-stream' })),
      });
      setBusy(false);
      if (await upload.start(plan, files)) setDone(true);
    } catch (err) {
      if (isApiError(err, 'wrong_password')) setError(t('download.wrongPassword'));
      else if (isApiError(err, 'locked')) setError(t('download.locked'));
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="public-card">
      <h1>{request.title}</h1>
      {request.ownerEmail && <p className="muted">{t('upload.for', { email: request.ownerEmail })}</p>}
      {request.message && <p className="message">{request.message}</p>}
      <p className="meta-line muted">
        <ClockIcon size={16} /> {t('upload.until', { date: dateTime(request.expiresAt, locale) })} ·{' '}
        {t('upload.limit', { size: bytes(request.maxBytesPerSubmission, locale) })}
      </p>
      <form className="stack" onSubmit={submit} noValidate>
        <FilePicker files={files} onChange={setFiles} />
        <div className="row-2">
          <Field label={t('upload.name')} optional>
            {(fid) => <Input id={fid} autoComplete="name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={t('upload.email')} optional>
            {(fid) => <Input id={fid} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
        </div>
        <Field label={t('upload.message')} optional>
          {(fid) => <TextArea id={fid} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />}
        </Field>
        {request.passwordRequired && (
          <Field label={<><LockIcon size={14} /> {t('common.password')}</>}>
            {(fid) => <Input id={fid} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" busy={busy} disabled={files.length === 0 || (request.passwordRequired && !password)}>
          {t('upload.submit')}
        </Button>
      </form>
    </Card>
  );
}
