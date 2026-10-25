import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import type { DownloadUrl, FileInfo, PublicTransfer, UnlockResult } from '@sendless/shared';
import { publicApi } from '../api/client.js';
import { AlertIcon, ClockIcon, DownloadIcon, FileIcon, LockIcon } from '../components/icons.js';
import { Alert, Badge, Button, Card, Field, Input, isApiError, Loading, useAsync } from '../components/ui.js';
import { bytes, dateTime, fileCount } from '../format.js';
import { useI18n } from '../i18n/index.js';

const sessionKey = (id: string) => `sendless.session.${id}`;

/** Re-uses an unlocked session after a reload, so refreshing does not count as another open. */
function storedSession(id: string): UnlockResult | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(id));
    const session = raw ? (JSON.parse(raw) as UnlockResult) : null;
    return session && new Date(session.sessionExpiresAt).getTime() > Date.now() + 30_000 ? session : null;
  } catch {
    return null;
  }
}

function triggerDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function Unavailable({ title, text }: { title: string; text: string }) {
  return (
    <Card className="public-card center">
      <AlertIcon size={36} />
      <h1>{title}</h1>
      <p className="muted">{text}</p>
    </Card>
  );
}

export function DownloadPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const meta = useAsync(() => publicApi.get<PublicTransfer>(`/api/public/transfers/${encodeURIComponent(id)}`), [id]);
  const [session, setSession] = useState<UnlockResult | null>(() => storedSession(id));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  // Unlocking here used one open; the metadata was loaded before that.
  const [openedHere, setOpenedHere] = useState(false);

  const unlock = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await publicApi.post<UnlockResult>(`/api/public/transfers/${encodeURIComponent(id)}/unlock`, {
        password: password || undefined,
      });
      sessionStorage.setItem(sessionKey(id), JSON.stringify(result));
      setSession(result);
      setOpenedHere(true);
    } catch (err) {
      if (isApiError(err, 'wrong_password')) setError(t('download.wrongPassword'));
      else if (isApiError(err, 'locked')) setError(t('download.locked'));
      else if (isApiError(err, 'expired', 'limit_reached')) meta.reload();
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async (file: FileInfo) => {
    if (!session) return;
    setError(null);
    setDownloading(file.id);
    try {
      const { url } = await publicApi.post<DownloadUrl>(
        `/api/public/transfers/${encodeURIComponent(id)}/files/${encodeURIComponent(file.id)}/download`,
        { sessionId: session.sessionId },
      );
      triggerDownload(url);
    } catch (err) {
      if (isApiError(err, 'session_expired')) {
        sessionStorage.removeItem(sessionKey(id));
        setSession(null);
        setError(t('download.sessionExpired'));
      } else if (isApiError(err, 'scan_pending')) setError(t('download.scanPending'));
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(null);
    }
  };

  const downloadAll = async (files: FileInfo[]) => {
    for (const [i, file] of files.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1200)); // browsers drop rapid-fire downloads
      await download(file);
    }
  };

  // Once unlocked, a later expiry of the public metadata must not hide the files of this session.
  if (!session && meta.error) {
    if (isApiError(meta.error, 'limit_reached')) return <Unavailable title={t('download.limitTitle')} text={t('download.limitText')} />;
    if (isApiError(meta.error, 'expired')) return <Unavailable title={t('download.expiredTitle')} text={t('download.expiredText')} />;
    if (isApiError(meta.error, 'not_found')) return <Unavailable title={t('download.missingTitle')} text={t('download.missingText')} />;
    return <Alert tone="error">{meta.error instanceof Error ? meta.error.message : t('app.error')}</Alert>;
  }
  if (!meta.data && !session) return <Loading />;

  const info = meta.data;
  const files = session?.files ?? [];
  const downloadable = files.filter((f) => !f.scan || f.scan === 'clean' || f.scan === 'unsupported' || f.scan === 'error');

  return (
    <Card className="public-card">
      <h1>{info?.title || t('download.title')}</h1>
      {info && (
        <p className="muted">
          {fileCount(info.fileCount, t)} · {bytes(info.totalSize, locale)}
          {info.senderEmail && <> · {t('download.from', { email: info.senderEmail })}</>}
        </p>
      )}
      {info?.message && <p className="message">{info.message}</p>}
      {info && (
        <p className="meta-line muted">
          <ClockIcon size={16} /> {t('download.expires', { date: dateTime(info.expiresAt, locale) })}
          {info.opensLeft !== null && <> · {t('download.opensLeft', { count: Math.max(0, info.opensLeft - (openedHere ? 1 : 0)) })}</>}
        </p>
      )}

      {!session ? (
        <form className="stack" onSubmit={unlock}>
          {info?.passwordRequired && (
            <Field label={<><LockIcon size={14} /> {t('download.passwordPrompt')}</>}>
              {(fieldId) => <Input id={fieldId} type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" variant="primary" busy={busy} disabled={info?.passwordRequired && !password}>
            {t('download.unlock')}
          </Button>
        </form>
      ) : (
        <div className="stack">
          <ul className="file-list">
            {files.map((f) => {
              const blocked = f.scan === 'infected';
              const pending = f.scan === 'pending';
              return (
                <li key={f.id}>
                  <FileIcon />
                  <span className="file-name" title={f.name}>
                    {f.name}
                    {blocked && <> <Badge tone="danger">{t('download.blocked')}</Badge></>}
                    {pending && <> <Badge tone="warning">{t('transfers.scanPending')}</Badge></>}
                    {(f.scan === 'unsupported' || f.scan === 'error') && <> <Badge tone="warning">{t('download.notScanned')}</Badge></>}
                  </span>
                  <span className="muted">{bytes(f.size, locale)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<DownloadIcon />}
                    busy={downloading === f.id}
                    disabled={blocked}
                    aria-label={`${t('common.download')} ${f.name}`}
                    onClick={() => void download(f)}
                  />
                </li>
              );
            })}
          </ul>
          {error && <Alert tone="error">{error}</Alert>}
          {downloadable.length > 1 && (
            <Button variant="primary" icon={<DownloadIcon />} onClick={() => void downloadAll(downloadable)}>
              {t('common.downloadAll')}
            </Button>
          )}
          {downloadable.length === 1 && (
            <Button variant="primary" icon={<DownloadIcon />} onClick={() => void download(downloadable[0]!)}>
              {t('common.download')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
