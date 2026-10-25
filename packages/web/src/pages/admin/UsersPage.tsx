import { useState, type FormEvent } from 'react';
import type { UserInfo } from '@s3ndless/shared';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthProvider.js';
import { Alert, AsyncView, Badge, Button, Card, Checkbox, ConfirmButton, Field, Input, useAsync } from '../../components/ui.js';
import { dateTime } from '../../format.js';
import { useI18n } from '../../i18n/index.js';

export function UsersPage() {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const state = useAsync(() => api.get<{ items: UserInfo[] }>('/api/admin/users'), []);
  const [email, setEmail] = useState('');
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await action();
      state.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await run(async () => {
      const user = await api.post<UserInfo>('/api/admin/users', { email, admin });
      setMessage({ tone: 'success', text: t('admin.invited', { email: user.email }) });
      setEmail('');
      setAdmin(false);
    });
    setBusy(false);
  };

  const patch = (u: UserInfo, body: { enabled?: boolean; admin?: boolean }) =>
    run(() => api.patch(`/api/admin/users/${encodeURIComponent(u.username)}`, body));

  return (
    <div className="stack">
      <Card title={t('admin.inviteTitle')}>
        <form className="invite-form" onSubmit={invite}>
          <Field label={t('auth.email')}>
            {(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Checkbox label={t('admin.makeAdmin')} checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
          <Button type="submit" variant="primary" busy={busy} disabled={!email}>
            {t('admin.invite')}
          </Button>
        </form>
      </Card>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <AsyncView state={state}>
        {({ items }) => (
          <Card title={t('admin.users')}>
            <ul className="list">
              {items.map((u) => {
                const self = u.email === me?.email;
                return (
                  <li key={u.username} className="list-row">
                    <div className="list-main">
                      <span className="list-title">
                        {u.email}
                        {u.isAdmin && <Badge tone="brand">{t('admin.isAdmin')}</Badge>}
                        {!u.enabled && <Badge>{t('admin.disabled')}</Badge>}
                        {u.status === 'FORCE_CHANGE_PASSWORD' && <Badge tone="warning">{t('admin.pending')}</Badge>}
                      </span>
                      {u.createdAt && <span className="muted">{dateTime(u.createdAt, locale)}</span>}
                    </div>
                    {!self && (
                      <div className="list-side">
                        <Button size="sm" variant="ghost" onClick={() => void patch(u, { admin: !u.isAdmin })}>
                          {u.isAdmin ? t('admin.demote') : t('admin.promote')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void patch(u, { enabled: !u.enabled })}>
                          {u.enabled ? t('admin.disable') : t('admin.enable')}
                        </Button>
                        <ConfirmButton confirmText={t('common.confirmDelete')} onConfirm={() => run(() => api.delete(`/api/admin/users/${encodeURIComponent(u.username)}`))}>
                          {t('common.delete')}
                        </ConfirmButton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </AsyncView>
    </div>
  );
}
