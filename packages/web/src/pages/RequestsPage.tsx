import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { GiB, type Page, type RequestDetail, type RequestSummary } from '@s3ndless/shared';
import { api } from '../api/client.js';
import { ArrowLeftIcon, InboxIcon, LockIcon, PlusIcon } from '../components/icons.js';
import {
  Alert,
  AsyncView,
  Button,
  Card,
  Checkbox,
  ConfirmButton,
  CopyButton,
  CopyField,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  TextArea,
  useAsync,
} from '../components/ui.js';
import { useConfig } from '../config.js';
import { bytes, dateTime, duration, lifetimeOptions, relative } from '../format.js';
import { useI18n, type Translate } from '../i18n/index.js';
import { TransferRow } from './TransfersPage.js';

const SIZE_OPTIONS = [100 * 1024 * 1024, 1 * GiB, 5 * GiB, 20 * GiB, 100 * GiB];

function submissionsText(t: Translate, r: Pick<RequestSummary, 'submissions' | 'maxSubmissions'>) {
  return r.maxSubmissions === null
    ? t('requests.submissions', { count: r.submissions })
    : t('requests.submissionsOf', { count: r.submissions, max: r.maxSubmissions });
}

function NewRequestForm({ onCreated }: { onCreated(request: RequestSummary): void }) {
  const { limits, features } = useConfig();
  const { t, locale } = useI18n();
  const options = lifetimeOptions(limits.maxExpiresInHours);
  const sizes = SIZE_OPTIONS.filter((s) => s <= limits.maxTransferBytes);
  if (!sizes.includes(limits.maxTransferBytes)) sizes.push(limits.maxTransferBytes);

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [hours, setHours] = useState(Math.min(168, limits.maxExpiresInHours));
  const [retention, setRetention] = useState(Math.min(168, limits.maxExpiresInHours));
  const [maxSize, setMaxSize] = useState(Math.min(5 * GiB, limits.maxTransferBytes));
  const [maxSubmissions, setMaxSubmissions] = useState<number | null>(null);
  const [password, setPassword] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<RequestSummary>('/api/requests', {
        title,
        message: message || undefined,
        expiresInHours: hours,
        retentionHours: retention,
        maxBytesPerSubmission: maxSize,
        maxSubmissions,
        password: password || undefined,
        notifyOnSubmission: notify,
      });
      onCreated(created);
      setTitle('');
      setMessage('');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <Field label={t('common.title')}>
        {(id) => <Input id={id} required maxLength={200} value={title} placeholder={t('requests.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label={t('common.message')} optional>
        {(id) => <TextArea id={id} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />}
      </Field>
      <div className="row-2">
        <Field label={t('requests.expiresIn')}>
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
        <Field label={t('requests.retention')}>
          {(id) => (
            <Select id={id} value={retention} onChange={(e) => setRetention(Number(e.target.value))}>
              {options.map((h) => (
                <option key={h} value={h}>
                  {duration(h, t)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="row-2">
        <Field label={t('requests.maxSize')}>
          {(id) => (
            <Select id={id} value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))}>
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {bytes(s, locale)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('requests.maxSubmissions')} optional>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              value={maxSubmissions ?? ''}
              placeholder={t('common.unlimited')}
              onChange={(e) => setMaxSubmissions(e.target.value ? Math.max(1, Number(e.target.value)) : null)}
            />
          )}
        </Field>
      </div>
      <Field label={t('common.password')} optional>
        {(id) => <Input id={id} type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      {features.email && <Checkbox label={t('requests.notify')} checked={notify} onChange={(e) => setNotify(e.target.checked)} />}
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" variant="primary" busy={busy} disabled={!title.trim()}>
          {t('requests.create')}
        </Button>
      </div>
    </form>
  );
}

export function RequestsPage() {
  const { t, locale } = useI18n();
  const state = useAsync(() => api.get<Page<RequestSummary>>('/api/requests'), []);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<RequestSummary | null>(null);

  return (
    <div className="stack">
      <PageHeader
        title={t('requests.title')}
        subtitle={t('requests.intro')}
        actions={
          !creating && (
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              {t('requests.new')}
            </Button>
          )
        }
      />
      {created && (
        <Card title={t('requests.created')}>
          <CopyField value={created.url} />
        </Card>
      )}
      {creating && (
        <Card title={t('requests.new')} actions={<Button size="sm" variant="ghost" onClick={() => setCreating(false)}>{t('common.cancel')}</Button>}>
          <NewRequestForm
            onCreated={(r) => {
              setCreated(r);
              setCreating(false);
              state.reload();
            }}
          />
        </Card>
      )}
      <AsyncView state={state}>
        {(page) =>
          page.items.length === 0 ? (
            !creating && (
              <Card>
                <EmptyState icon={<InboxIcon size={32} />}>{t('requests.empty')}</EmptyState>
              </Card>
            )
          ) : (
            <Card>
              <ul className="list">
                {page.items.map((r) => (
                  <li key={r.id} className="list-row">
                    <Link to={`/requests/${r.id}`} className="list-main">
                      <span className="list-title">
                        {r.title}
                        {r.hasPassword && <LockIcon size={14} />}
                      </span>
                      <span className="muted">
                        {submissionsText(t, r)} · {r.status === 'active' ? `${t('common.expires')} ${relative(r.expiresAt, locale)}` : dateTime(r.createdAt, locale)}
                      </span>
                    </Link>
                    <div className="list-side">
                      <StatusBadge status={r.status} />
                      {r.status === 'active' && <CopyButton value={r.url} />}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )
        }
      </AsyncView>
    </div>
  );
}

export function RequestDetailPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const state = useAsync(() => api.get<RequestDetail>(`/api/requests/${encodeURIComponent(id)}`), [id]);

  return (
    <AsyncView state={state}>
      {(r) => (
        <div className="stack">
          <Link to="/requests" className="back">
            <ArrowLeftIcon /> {t('requests.title')}
          </Link>
          <PageHeader
            title={r.title}
            subtitle={submissionsText(t, r)}
            actions={
              r.status === 'active' && (
                <ConfirmButton
                  confirmText={t('requests.closeText')}
                  onConfirm={async () => {
                    await api.delete(`/api/requests/${encodeURIComponent(id)}`);
                    state.reload();
                  }}
                >
                  {t('requests.close')}
                </ConfirmButton>
              )
            }
          />
          {r.status === 'active' && <CopyField value={r.url} />}
          <Card>
            <dl className="facts">
              <dt>{t('common.status')}</dt>
              <dd>
                <StatusBadge status={r.status} />
              </dd>
              <dt>{t('common.expires')}</dt>
              <dd>{dateTime(r.expiresAt, locale)}</dd>
              <dt>{t('requests.maxSize')}</dt>
              <dd>{r.maxBytesPerSubmission ? bytes(r.maxBytesPerSubmission, locale) : '–'}</dd>
              <dt>{t('requests.retention')}</dt>
              <dd>{duration(r.retentionHours, t)}</dd>
              <dt>{t('common.password')}</dt>
              <dd>{r.hasPassword ? t('common.yes') : t('common.no')}</dd>
            </dl>
            {r.message && <p className="message">{r.message}</p>}
          </Card>
          <Card title={t('requests.received')}>
            {r.transfers.length === 0 ? (
              <p className="muted">{t('requests.noneReceived')}</p>
            ) : (
              <ul className="list">
                {r.transfers.map((tr) => (
                  <TransferRow key={tr.id} transfer={tr} />
                ))}
              </ul>
            )}
          </Card>
          <div>
            <Button variant="ghost" onClick={() => navigate('/transfers?tab=received')}>
              {t('transfers.received')}
            </Button>
          </div>
        </div>
      )}
    </AsyncView>
  );
}
