import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { DownloadUrl, EventInfo, FileInfo, Page, TransferDetail, TransferSummary } from '@s3ndless/shared';
import { api } from '../api/client.js';
import { ArrowLeftIcon, DownloadIcon, FileIcon, InboxIcon, LockIcon, SendIcon, TrashIcon } from '../components/icons.js';
import {
  Alert,
  AsyncView,
  Badge,
  Button,
  Card,
  ConfirmButton,
  CopyButton,
  CopyField,
  EmptyState,
  PageHeader,
  StatusBadge,
  useAsync,
} from '../components/ui.js';
import { bytes, dateTime, fileCount, relative } from '../format.js';
import { useI18n, type MessageKey, type Translate } from '../i18n/index.js';

function opensText(t: Translate, transfer: Pick<TransferSummary, 'opens' | 'maxOpens'>) {
  return transfer.maxOpens === null
    ? t('transfers.opensUnlimited', { opens: transfer.opens })
    : t('transfers.opens', { opens: transfer.opens, max: transfer.maxOpens });
}

export function transferName(t: Translate, transfer: Pick<TransferSummary, 'title' | 'submitter' | 'kind' | 'firstFileName' | 'fileCount'>) {
  if (transfer.kind === 'inbound' && transfer.submitter?.name) return t('transfers.from', { name: transfer.submitter.name });
  if (transfer.title) return transfer.title;
  if (!transfer.firstFileName) return t('transfers.untitled');
  return transfer.fileCount > 1 ? `${transfer.firstFileName} +${transfer.fileCount - 1}` : transfer.firstFileName;
}

export function TransferRow({ transfer }: { transfer: TransferSummary }) {
  const { t, locale } = useI18n();
  const active = transfer.status === 'ready';
  return (
    <li className="list-row">
      <Link to={`/transfers/${transfer.id}`} className="list-main">
        <span className="list-title">
          {transferName(t, transfer)}
          {transfer.hasPassword && <LockIcon size={14} aria-label={t('transfers.passwordProtected')} />}
        </span>
        <span className="muted">
          {fileCount(transfer.fileCount, t)} · {bytes(transfer.totalSize, locale)}
          {transfer.kind === 'outbound' && <> · {opensText(t, transfer)}</>}
          {' · '}
          {active ? `${t('common.expires')} ${relative(transfer.expiresAt, locale)}` : dateTime(transfer.createdAt, locale)}
        </span>
      </Link>
      <div className="list-side">
        <StatusBadge status={transfer.status} />
        {active && transfer.url && <CopyButton value={transfer.url} />}
      </div>
    </li>
  );
}

export function TransfersPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const kind = params.get('tab') === 'received' ? 'inbound' : 'outbound';
  const [extra, setExtra] = useState<{ items: TransferSummary[]; cursor: string | null } | null>(null);
  const state = useAsync(() => {
    setExtra(null);
    return api.get<Page<TransferSummary>>(`/api/transfers?kind=${kind}`);
  }, [kind]);

  const loadMore = async (cursor: string) => {
    const next = await api.get<Page<TransferSummary>>(`/api/transfers?kind=${kind}&cursor=${encodeURIComponent(cursor)}`);
    setExtra((prev) => ({ items: [...(prev?.items ?? []), ...next.items], cursor: next.cursor }));
  };

  return (
    <div className="stack">
      <PageHeader title={t('transfers.title')} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={kind === 'outbound'} className={kind === 'outbound' ? 'active' : ''} onClick={() => setParams({})}>
          <SendIcon /> {t('transfers.sent')}
        </button>
        <button role="tab" aria-selected={kind === 'inbound'} className={kind === 'inbound' ? 'active' : ''} onClick={() => setParams({ tab: 'received' })}>
          <InboxIcon /> {t('transfers.received')}
        </button>
      </div>
      <AsyncView state={state}>
        {(page) => {
          const items = [...page.items, ...(extra?.items ?? [])];
          const cursor = extra ? extra.cursor : page.cursor;
          if (items.length === 0) {
            return (
              <Card>
                <EmptyState
                  icon={kind === 'outbound' ? <SendIcon size={32} /> : <InboxIcon size={32} />}
                  action={
                    kind === 'outbound' ? (
                      <Link className="btn btn-primary" to="/">
                        {t('nav.send')}
                      </Link>
                    ) : (
                      <Link className="btn btn-primary" to="/requests">
                        {t('requests.new')}
                      </Link>
                    )
                  }
                >
                  {kind === 'outbound' ? t('transfers.emptySent') : t('transfers.emptyReceived')}
                </EmptyState>
              </Card>
            );
          }
          return (
            <Card>
              <ul className="list">
                {items.map((tr) => (
                  <TransferRow key={tr.id} transfer={tr} />
                ))}
              </ul>
              {cursor && (
                <div className="list-more">
                  <Button onClick={() => void loadMore(cursor)}>{t('common.loadMore')}</Button>
                </div>
              )}
            </Card>
          );
        }}
      </AsyncView>
    </div>
  );
}

function scanLabel(t: Translate, file: FileInfo): { tone: 'warning' | 'danger'; text: string } | null {
  if (!file.scan || file.scan === 'clean') return null;
  if (file.scan === 'pending') return { tone: 'warning', text: t('transfers.scanPending') };
  if (file.scan === 'infected') return { tone: 'danger', text: t('transfers.scanInfected') };
  return { tone: 'warning', text: t('transfers.scanFailed') };
}

function EventItem({ event }: { event: EventInfo }) {
  const { t, locale } = useI18n();
  const key = `event.${event.action}` as MessageKey;
  const label = t(key) === key ? event.action : t(key);
  const who = event.actor.type === 'user' ? event.actor.email : t(`actor.${event.actor.type}`);
  const name = typeof event.details?.name === 'string' ? event.details.name : null;
  return (
    <li>
      <span className="timeline-dot" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        {name && <span className="muted"> · {name}</span>}
        <div className="muted small">
          {dateTime(event.at, locale)}
          {who && ` · ${who}`}
          {event.ip && ` · ${event.ip}`}
          {event.country && ` (${event.country})`}
        </div>
      </div>
    </li>
  );
}

export function TransferDetailPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const state = useAsync(() => api.get<TransferDetail>(`/api/transfers/${encodeURIComponent(id)}`), [id]);
  const [error, setError] = useState<string | null>(null);

  const download = async (file: FileInfo) => {
    setError(null);
    try {
      const { url } = await api.post<DownloadUrl>(`/api/transfers/${encodeURIComponent(id)}/files/${encodeURIComponent(file.id)}/download`);
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <AsyncView state={state}>
      {(tr) => {
        const active = tr.status === 'ready';
        return (
          <div className="stack">
            <Link to={tr.kind === 'inbound' ? '/transfers?tab=received' : '/transfers'} className="back">
              <ArrowLeftIcon /> {t('transfers.title')}
            </Link>
            <PageHeader
              title={transferName(t, tr)}
              subtitle={`${fileCount(tr.fileCount, t)} · ${bytes(tr.totalSize, locale)}`}
              actions={
                active && (
                  <ConfirmButton
                    icon={<TrashIcon />}
                    confirmText={t('transfers.deleteText')}
                    onConfirm={async () => {
                      await api.delete(`/api/transfers/${encodeURIComponent(id)}`);
                      navigate(tr.kind === 'inbound' ? '/transfers?tab=received' : '/transfers');
                    }}
                  >
                    {t('common.delete')}
                  </ConfirmButton>
                )
              }
            />
            {active && tr.url && <CopyField value={tr.url} />}
            {error && <Alert tone="error">{error}</Alert>}
            <div className="detail-grid">
              <Card title={t('common.status')}>
                <dl className="facts">
                  <dt>{t('common.status')}</dt>
                  <dd>
                    <StatusBadge status={tr.status} />
                  </dd>
                  <dt>{t('common.created')}</dt>
                  <dd>{dateTime(tr.createdAt, locale)}</dd>
                  <dt>{t('common.expires')}</dt>
                  <dd>{dateTime(tr.expiresAt, locale)}</dd>
                  {tr.kind === 'outbound' && (
                    <>
                      <dt>{t('send.maxOpens')}</dt>
                      <dd>{opensText(t, tr)}</dd>
                      <dt>{t('common.password')}</dt>
                      <dd>{tr.hasPassword ? t('common.yes') : t('common.no')}</dd>
                    </>
                  )}
                  {tr.recipients.length > 0 && (
                    <>
                      <dt>{t('transfers.recipients')}</dt>
                      <dd>{tr.recipients.join(', ')}</dd>
                    </>
                  )}
                  {tr.submitter && (
                    <>
                      <dt>{t('transfers.submitter')}</dt>
                      <dd>{[tr.submitter.name, tr.submitter.email].filter(Boolean).join(' · ') || '–'}</dd>
                    </>
                  )}
                </dl>
                {tr.message && <p className="message">{tr.message}</p>}
              </Card>
              <Card title={t('common.files', { count: tr.fileCount })}>
                <ul className="file-list">
                  {tr.files.map((f) => {
                    const scan = scanLabel(t, f);
                    return (
                      <li key={f.id}>
                        <FileIcon />
                        <span className="file-name" title={f.name}>
                          {f.name}
                          {scan && (
                            <>
                              {' '}
                              <Badge tone={scan.tone}>{scan.text}</Badge>
                            </>
                          )}
                        </span>
                        <span className="muted">{bytes(f.size, locale)}</span>
                        {active && f.status === 'uploaded' && (
                          <Button size="sm" variant="ghost" icon={<DownloadIcon />} aria-label={`${t('common.download')} ${f.name}`} onClick={() => void download(f)} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
            <Card title={t('transfers.activity')}>
              {tr.events.length === 0 ? (
                <p className="muted">{t('transfers.noActivity')}</p>
              ) : (
                <ul className="timeline">
                  {tr.events.map((e) => (
                    <EventItem key={e.id} event={e} />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        );
      }}
    </AsyncView>
  );
}
