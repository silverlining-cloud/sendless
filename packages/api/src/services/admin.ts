import type { AdminSettings, Me, SettingsInput, UserInfo } from '@sendless/shared';
import { verifyLicense } from '@sendless/ee/api';
import { editionFor } from '../edition.js';
import { badRequest, conflict, type HttpRequest } from '../http.js';
import type { ActorRecord } from '../model.js';
import type { Deps, Principal } from '../ports.js';
import { ADMIN_SUBJECT, auditExpiry, recordEvent, requestSubject, userActor } from './audit.js';
import { destroyTransfer, mapLimit } from './transfers.js';

/** Refuses changes that would leave the installation without an enabled administrator. */
async function ensureAnotherAdmin(deps: Deps, username: string): Promise<void> {
  const users = await deps.directory.listUsers();
  if (!users.find((u) => u.username === username)?.isAdmin) return;
  if (!users.some((u) => u.isAdmin && u.enabled && u.username !== username)) {
    throw conflict('At least one active administrator is required', 'last_admin');
  }
}

export function me(principal: Principal): Me {
  return { sub: principal.sub, email: principal.email, isAdmin: principal.isAdmin };
}

export async function getAdminSettings(deps: Deps): Promise<AdminSettings> {
  const [settings, system] = await Promise.all([deps.settings(), deps.system()]);
  const edition = editionFor(settings, deps.now());
  const { privacyUrl, imprintUrl, ...branding } = settings.branding;
  return {
    settings: {
      branding: { privacyUrl, imprintUrl },
      defaults: settings.defaults,
      limits: settings.limits,
      showSenderEmail: settings.showSenderEmail,
    },
    branding,
    policies: settings.policies,
    license: edition.license,
    licenseError: edition.error,
    system: {
      version: deps.env.version,
      region: deps.env.region,
      appUrl: system.appUrl,
      emailEnabled: deps.mailer.enabled,
      malwareScanningAvailable: deps.env.malwareScanning,
      maxRetentionDays: deps.env.maxRetentionDays,
    },
  };
}

export async function updateSettings(deps: Deps, principal: Principal, input: SettingsInput, req: HttpRequest): Promise<AdminSettings> {
  const maxHours = deps.env.maxRetentionDays * 24;
  if (input.defaults.expiresInHours > maxHours) {
    throw badRequest(`The default lifetime cannot exceed ${maxHours} hours (MaxRetentionDays)`);
  }
  // Name, logo, colors and texts are saved through the Pro branding route and stay as they are.
  await deps.updateSettings((current) => ({ ...current, ...input, branding: { ...current.branding, ...input.branding } }));
  await recordEvent(deps, { subject: ADMIN_SUBJECT, action: 'settings.updated', actor: userActor(principal), req });
  return getAdminSettings(deps);
}

export async function setLicense(deps: Deps, principal: Principal, key: string, req: HttpRequest): Promise<AdminSettings> {
  if (key) {
    const result = verifyLicense(key, deps.now());
    if (!result.ok) throw badRequest(result.error, 'invalid_license');
  }
  await deps.updateSettings((current) => ({ ...current, licenseKey: key || null }));
  await recordEvent(deps, {
    subject: ADMIN_SUBJECT,
    action: key ? 'license.installed' : 'license.removed',
    actor: userActor(principal),
    req,
  });
  return getAdminSettings(deps);
}

export async function listUsers(deps: Deps): Promise<UserInfo[]> {
  const users = await deps.directory.listUsers();
  return users.sort((a, b) => a.email.localeCompare(b.email));
}

export async function inviteUser(deps: Deps, principal: Principal, email: string, admin: boolean, req: HttpRequest): Promise<UserInfo> {
  const user = await deps.directory.inviteUser(email.toLowerCase(), admin);
  await recordEvent(deps, {
    subject: ADMIN_SUBJECT,
    action: 'user.invited',
    actor: userActor(principal),
    req,
    details: { email: user.email, admin },
  });
  return user;
}

export async function updateUser(
  deps: Deps,
  principal: Principal,
  username: string,
  patch: { enabled?: boolean | undefined; admin?: boolean | undefined },
  req: HttpRequest,
): Promise<void> {
  if (username === principal.username && (patch.enabled === false || patch.admin === false)) {
    throw conflict('You cannot disable or demote your own account', 'self_change');
  }
  if (patch.enabled === false || patch.admin === false) await ensureAnotherAdmin(deps, username);
  if (patch.enabled !== undefined) await deps.directory.setEnabled(username, patch.enabled);
  if (patch.admin !== undefined) await deps.directory.setAdmin(username, patch.admin);
  await recordEvent(deps, {
    subject: ADMIN_SUBJECT,
    action: 'user.updated',
    actor: userActor(principal),
    req,
    details: { username, ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.admin !== undefined ? { admin: patch.admin } : {}) },
  });
}

/**
 * Closes all active file requests and transfers of a user and deletes their files. Without the
 * account nobody could manage or revoke them, so they must not stay live.
 */
async function closeEverythingOf(deps: Deps, ownerSub: string, actor: ActorRecord, req: HttpRequest) {
  // Requests first, so no new uploads start while the transfers are being closed.
  let requests = 0;
  let cursor: string | null = null;
  do {
    const page = await deps.store.listRequests(ownerSub, { limit: 100, cursor });
    for (const request of page.items.filter((r) => r.status === 'active')) {
      if (!(await deps.store.endRequest(request.id, 'revoked', await auditExpiry(deps)))) continue;
      requests++;
      await recordEvent(deps, { subject: requestSubject(request.id), action: 'request.revoked', actor, req });
    }
    cursor = page.cursor;
  } while (cursor);

  let transfers = 0;
  for (const kind of ['outbound', 'inbound'] as const) {
    cursor = null;
    do {
      const page = await deps.store.listTransfers(ownerSub, kind, { limit: 100, cursor });
      const active = page.items.filter((t) => t.status === 'uploading' || t.status === 'ready');
      const ended = await mapLimit(active, 8, (t) => destroyTransfer(deps, t.id, 'revoked', actor, req));
      transfers += ended.filter(Boolean).length;
      cursor = page.cursor;
    } while (cursor);
  }
  return { transfers, requests };
}

export async function deleteUser(deps: Deps, principal: Principal, username: string, req: HttpRequest): Promise<void> {
  if (username === principal.username) throw conflict('You cannot delete your own account', 'self_change');
  await ensureAnotherAdmin(deps, username);
  // Before the account goes, so a failure part-way can simply be retried.
  const sub = await deps.directory.findSub(username);
  const closed = sub ? await closeEverythingOf(deps, sub, userActor(principal), req) : { transfers: 0, requests: 0 };
  await deps.directory.deleteUser(username);
  await recordEvent(deps, {
    subject: ADMIN_SUBJECT,
    action: 'user.deleted',
    actor: userActor(principal),
    req,
    details: { username, transfersClosed: closed.transfers, requestsClosed: closed.requests },
  });
}
