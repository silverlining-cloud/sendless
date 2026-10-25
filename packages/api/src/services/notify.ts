import { formatBytes } from '@s3ndless/shared';
import type { Deps, MailMessage } from '../ports.js';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const formatDate = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

interface Brand {
  appName: string;
  primaryColor: string;
}

function render(brand: Brand, heading: string, paragraphs: string[], action?: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:${brand.primaryColor};color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p><p style="margin:0;color:#666;font-size:12px;word-break:break-all">${escapeHtml(action.url)}</p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f8;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2430"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:28px"><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>${body}${button}</div><p style="text-align:center;color:#888;font-size:12px">${escapeHtml(brand.appName)}</p></body></html>`;
  const text = [heading, '', ...paragraphs, ...(action ? ['', `${action.label}: ${action.url}`] : []), '', `— ${brand.appName}`].join('\n');
  return { html, text };
}

export function transferSharedMail(
  brand: Brand,
  t: { sender: string; title: string | null; message: string | null; url: string; expiresAt: number; fileCount: number; totalSize: number },
): Omit<MailMessage, 'to'> {
  const subject = `${t.sender} sent you ${t.title ? `"${t.title}"` : 'files'} via ${brand.appName}`;
  const lines = [
    `${t.sender} shared ${t.fileCount} file${t.fileCount === 1 ? '' : 's'} (${formatBytes(t.totalSize)}) with you.`,
    ...(t.message ? [t.message] : []),
    `The link expires on ${formatDate(t.expiresAt)}.`,
  ];
  return { subject, replyTo: t.sender, ...render(brand, t.title ?? 'Files for you', lines, { label: 'Download files', url: t.url }) };
}

export function transferOpenedMail(
  brand: Brand,
  t: { title: string | null; opens: number; maxOpens: number | null; detailUrl: string },
): Omit<MailMessage, 'to'> {
  const name = t.title ? `"${t.title}"` : 'Your transfer';
  const remaining = t.maxOpens === null ? '' : ` ${Math.max(0, t.maxOpens - t.opens)} of ${t.maxOpens} opens left.`;
  return {
    subject: `${name} was opened`,
    ...render(brand, `${name} was opened`, [`Your link was opened (${t.opens}×).${remaining}`], {
      label: 'View activity',
      url: t.detailUrl,
    }),
  };
}

export function submissionReceivedMail(
  brand: Brand,
  s: { requestTitle: string; submitter: string | null; message: string | null; fileCount: number; totalSize: number; detailUrl: string },
): Omit<MailMessage, 'to'> {
  const from = s.submitter ?? 'Someone';
  return {
    subject: `New files for "${s.requestTitle}"`,
    ...render(
      brand,
      `New files for "${s.requestTitle}"`,
      [`${from} uploaded ${s.fileCount} file${s.fileCount === 1 ? '' : 's'} (${formatBytes(s.totalSize)}).`, ...(s.message ? [s.message] : [])],
      { label: 'Open files', url: s.detailUrl },
    ),
  };
}

/** Sends an email without letting delivery problems fail the request. */
export async function sendSafely(deps: Deps, message: MailMessage): Promise<boolean> {
  if (!deps.mailer.enabled) return false;
  try {
    await deps.mailer.send(message);
    return true;
  } catch (error) {
    deps.log.error('email delivery failed', { subject: message.subject, error });
    return false;
  }
}
