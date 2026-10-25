import type { EventInfo } from '@sendless/shared';
import { randomId } from '../crypto.js';
import type { HttpRequest } from '../http.js';
import type { ActorRecord, EventRecord } from '../model.js';
import type { Deps, Principal } from '../ports.js';

export const transferSubject = (id: string) => `TRANSFER#${id}`;
export const requestSubject = (id: string) => `REQUEST#${id}`;
export const ADMIN_SUBJECT = 'ADMIN';

export function userActor(principal: Principal): ActorRecord {
  return { type: 'user', sub: principal.sub, email: principal.email };
}

export const RECIPIENT: ActorRecord = { type: 'recipient' };
export const SYSTEM: ActorRecord = { type: 'system' };

/** Epoch seconds at which audit data expires, from the (Pro-configurable) retention setting. */
export async function auditExpiry(deps: Deps, from = deps.now()): Promise<number> {
  const settings = await deps.settings();
  return Math.floor(from / 1000) + settings.policies.auditRetentionDays * 86_400;
}

/**
 * Appends an event to the audit trail. Never throws: a failed audit write is logged
 * but does not fail the user's request.
 */
export async function recordEvent(
  deps: Deps,
  input: {
    subject: string;
    action: string;
    actor: ActorRecord;
    req?: HttpRequest;
    details?: Record<string, string | number | boolean>;
  },
): Promise<void> {
  const event: EventRecord = {
    id: randomId(9),
    subject: input.subject,
    at: deps.now(),
    action: input.action,
    actor: input.actor,
    ip: input.req?.ip ?? null,
    country: input.req?.country ?? null,
    userAgent: input.req?.userAgent?.slice(0, 300) ?? null,
    details: input.details ?? null,
  };
  try {
    await deps.store.putEvent(event, await auditExpiry(deps, event.at));
  } catch (error) {
    deps.log.error('audit write failed', { action: event.action, subject: event.subject, error });
  }
}

export function toEventInfo(event: EventRecord): EventInfo {
  return {
    id: event.id,
    at: new Date(event.at).toISOString(),
    action: event.action,
    actor: event.actor.type === 'user' ? { type: 'user', email: event.actor.email } : event.actor,
    ip: event.ip,
    country: event.country,
    userAgent: event.userAgent,
    details: event.details,
    subject: event.subject,
  };
}
