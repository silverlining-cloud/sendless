// Sendless Pro. Licensed under the Sendless Enterprise License (see ee/LICENSE).
import { useState } from 'react';
import type { EventInfo, Page } from '@sendless/shared';
import { api, requestRaw } from '@sendless/web/api';
import { dateTime } from '@sendless/web/format';
import { useI18n, type MessageKey } from '@sendless/web/i18n';
import { Alert, AsyncView, Button, Card, Field, Input, isApiError, ProGate, useAsync } from '@sendless/web/ui';
import { DownloadIcon } from '@sendless/web/icons';

const today = () => new Date().toISOString().slice(0, 10);

export function AuditPage() {
  const { t, locale } = useI18n();
  const [day, setDay] = useState(today);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [more, setMore] = useState<Page<EventInfo> | null>(null);
  const [notice, setNotice] = useState<{ tone: 'warning' | 'error'; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const state = useAsync(() => {
    setMore(null);
    return api.get<Page<EventInfo>>(`/api/admin/audit?day=${day}`);
  }, [day]);

  if (isApiError(state.error, 'pro_required')) return <ProGate licensed={false}>{null}</ProGate>;

  const loadMore = async (cursor: string) => {
    const next = await api.get<Page<EventInfo>>(`/api/admin/audit?day=${day}&cursor=${encodeURIComponent(cursor)}`);
    setMore((prev) => ({ items: [...(prev?.items ?? []), ...next.items], cursor: next.cursor }));
  };

  const exportCsv = async () => {
    setExporting(true);
    setNotice(null);
    try {
      const response = await requestRaw(`/api/admin/audit/export?from=${from}&to=${to}`);
      if (response.headers.get('x-sendless-truncated') === 'true') setNotice({ tone: 'warning', text: t('pro.audit.truncated') });
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `sendless-audit-${from}_${to}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setExporting(false);
    }
  };

  const label = (action: string) => {
    const key = `event.${action}` as MessageKey;
    return t(key) === key ? action : t(key);
  };

  return (
    <div className="stack">
      <Card title={t('admin.audit')}>
        <p className="muted">{t('pro.audit.intro')}</p>
        <div className="toolbar">
          <Field label={t('pro.audit.day')}>{(id) => <Input id={id} type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />}</Field>
          <span className="toolbar-spacer" />
          <Field label={t('pro.audit.from')}>{(id) => <Input id={id} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label={t('pro.audit.to')}>{(id) => <Input id={id} type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Button icon={<DownloadIcon />} busy={exporting} onClick={() => void exportCsv()}>
            {t('pro.audit.export')}
          </Button>
        </div>
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      </Card>
      <AsyncView state={state}>
        {(page) => {
          const items = [...page.items, ...(more?.items ?? [])];
          const cursor = more ? more.cursor : page.cursor;
          if (items.length === 0) return <p className="muted">{t('pro.audit.empty')}</p>;
          return (
            <Card>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('pro.audit.time')}</th>
                      <th>{t('pro.audit.action')}</th>
                      <th>{t('pro.audit.actor')}</th>
                      <th>{t('pro.audit.subject')}</th>
                      <th>{t('pro.audit.ip')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((e) => (
                      <tr key={e.id}>
                        <td className="nowrap">{dateTime(e.at, locale)}</td>
                        <td>{label(e.action)}</td>
                        <td>{e.actor.type === 'user' ? e.actor.email : t(`actor.${e.actor.type}`)}</td>
                        <td className="mono small">{e.subject}</td>
                        <td className="mono small">
                          {e.ip ?? '–'}
                          {e.country && ` (${e.country})`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
