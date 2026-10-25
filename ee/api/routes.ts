import { policiesSchema, ssoProviderInput, type EventInfo } from '@s3ndless/shared';
import { ADMIN_SUBJECT, recordEvent, toEventInfo, userActor } from '@s3ndless/api/audit';
import { badRequest, json, noContent, parseBody, type HttpResponse } from '@s3ndless/api/http';
import type { ProRouteContext } from '@s3ndless/api/ports';
import type { Router } from '@s3ndless/api/router';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EXPORT_DAYS = 31;
const MAX_EXPORT_BYTES = 5 * 1024 * 1024; // Lambda responses are limited to 6 MB.

function parseDay(value: string | undefined, fallback: string): string {
  const day = value ?? fallback;
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw badRequest('Dates must look like 2026-01-31');
  return day;
}

function csvCell(value: string): string {
  // Neutralise spreadsheet formulas (CSV injection) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function eventToCsv(e: EventInfo): string {
  const actor = e.actor.type === 'user' ? e.actor.email : e.actor.type;
  return [e.at, e.action, e.subject, actor, e.ip ?? '', e.country ?? '', e.userAgent ?? '', e.details ? JSON.stringify(e.details) : '']
    .map(csvCell)
    .join(',');
}

export function registerProRoutes(r: Router, ctx: ProRouteContext): void {
  const { deps } = ctx;
  const today = () => new Date(deps.now()).toISOString().slice(0, 10);

  // ----- audit log -----
  r.get('/api/admin/audit', async (req) => {
    await ctx.requireAdmin(req);
    await ctx.requireFeature('audit');
    const day = parseDay(req.query.day, today());
    const page = await deps.store.listEventsByDay(day, { limit: 100, cursor: req.query.cursor ?? null });
    return json(200, { items: page.items.map(toEventInfo), cursor: page.cursor });
  });

  r.get('/api/admin/audit/export', async (req): Promise<HttpResponse> => {
    const principal = await ctx.requireAdmin(req);
    await ctx.requireFeature('audit');
    const to = parseDay(req.query.to, today());
    const from = parseDay(req.query.from, to);
    const days: string[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }
    if (days.length === 0) throw badRequest('"from" must not be after "to"');
    if (days.length > MAX_EXPORT_DAYS) throw badRequest(`Export at most ${MAX_EXPORT_DAYS} days at a time`);

    const lines = ['time,action,subject,actor,ip,country,user_agent,details'];
    let bytes = lines[0]!.length;
    let truncated = false;
    outer: for (const day of days) {
      let cursor: string | null = null;
      do {
        const page = await deps.store.listEventsByDay(day, { limit: 500, cursor });
        for (const event of page.items) {
          const line = eventToCsv(toEventInfo(event));
          bytes += line.length + 1;
          if (bytes > MAX_EXPORT_BYTES) {
            truncated = true;
            break outer;
          }
          lines.push(line);
        }
        cursor = page.cursor;
      } while (cursor);
    }
    await recordEvent(deps, {
      subject: ADMIN_SUBJECT,
      action: 'audit.exported',
      actor: userActor(principal),
      req,
      details: { from, to, rows: lines.length - 1, truncated },
    });
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="s3ndless-audit-${from}_${to}.csv"`,
        'cache-control': 'no-store',
        'x-s3ndless-truncated': String(truncated),
        'access-control-expose-headers': 'x-s3ndless-truncated',
      },
      body: `${lines.join('\n')}\n`,
    };
  });

  // ----- policies -----
  r.get('/api/admin/policies', async (req) => {
    await ctx.requireAdmin(req);
    return json(200, (await deps.settings()).policies);
  });

  r.put('/api/admin/policies', async (req) => {
    const principal = await ctx.requireAdmin(req);
    await ctx.requireFeature('policies');
    const policies = parseBody(req, policiesSchema);
    const settings = await deps.settings();
    await deps.store.putSettings({ ...settings, policies });
    deps.invalidateSettings();
    await recordEvent(deps, { subject: ADMIN_SUBJECT, action: 'policies.updated', actor: userActor(principal), req });
    return json(200, policies);
  });

  // ----- SSO -----
  r.get('/api/admin/sso/providers', async (req) => {
    await ctx.requireAdmin(req);
    await ctx.requireFeature('sso');
    return json(200, { items: await deps.idp.list() });
  });

  r.post('/api/admin/sso/providers', async (req) => {
    const principal = await ctx.requireAdmin(req);
    await ctx.requireFeature('sso');
    const input = parseBody(req, ssoProviderInput);
    await deps.idp.create(input);
    const settings = await deps.settings();
    const providers = [
      ...settings.sso.providers.filter((p) => p.name !== input.name),
      { name: input.name, type: input.type, emailDomains: input.emailDomains },
    ];
    await deps.store.putSettings({ ...settings, sso: { providers } });
    deps.invalidateSettings();
    await deps.idp.syncClient(providers.map((p) => p.name));
    await recordEvent(deps, {
      subject: ADMIN_SUBJECT,
      action: 'sso.provider_added',
      actor: userActor(principal),
      req,
      details: { name: input.name, type: input.type },
    });
    return json(201, { name: input.name, type: input.type, emailDomains: input.emailDomains });
  });

  r.delete('/api/admin/sso/providers/{name}', async (req, p) => {
    const principal = await ctx.requireAdmin(req);
    await ctx.requireFeature('sso');
    const settings = await deps.settings();
    const providers = settings.sso.providers.filter((x) => x.name !== p.name);
    // Detach from the client first; Cognito refuses to delete a provider that is still in use.
    await deps.idp.syncClient(providers.map((x) => x.name));
    await deps.idp.delete(p.name!);
    await deps.store.putSettings({ ...settings, sso: { providers } });
    deps.invalidateSettings();
    await recordEvent(deps, {
      subject: ADMIN_SUBJECT,
      action: 'sso.provider_removed',
      actor: userActor(principal),
      req,
      details: { name: p.name! },
    });
    return noContent();
  });
}
