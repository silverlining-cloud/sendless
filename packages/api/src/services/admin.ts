import type { AdminSettings, Me, SettingsInput, UserInfo } from '@s3ndless/shared';
import { verifyLicense } from '@s3ndless/ee/api';
import { editionFor } from '../edition.js';
import { badRequest, conflict, type HttpRequest } from '../http.js';
import type { Deps, Principal } from '../ports.js';
import { ADMIN_SUBJECT, recordEvent, userActor } from './audit.js';

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
  return {
    settings: {
      branding: settings.branding,
      defaults: settings.defaults,
      limits: settings.limits,
      showSenderEmail: settings.showSenderEmail,
    },
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
  const current = await deps.settings();
  const maxHours = deps.env.maxRetentionDays * 24;
  if (input.defaults.expiresInHours > maxHours) {
    throw badRequest(`The default lifetime cannot exceed ${maxHours} hours (MaxRetentionDays)`);
  }
  await deps.store.putSettings({ ...current, ...input });
  deps.invalidateSettings();
  await recordEvent(deps, { subject: ADMIN_SUBJECT, action: 'settings.updated', actor: userActor(principal), req });
  return getAdminSettings(deps);
}

export async function setLicense(deps: Deps, principal: Principal, key: string, req: HttpRequest): Promise<AdminSettings> {
  const current = await deps.settings();
  if (key) {
    const result = verifyLicense(key, deps.now());
    if (!result.ok) throw badRequest(result.error, 'invalid_license');
  }
  await deps.store.putSettings({ ...current, licenseKey: key || null });
  deps.invalidateSettings();
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

export async function deleteUser(deps: Deps, principal: Principal, username: string, req: HttpRequest): Promise<void> {
  if (username === principal.username) throw conflict('You cannot delete your own account', 'self_change');
  await ensureAnotherAdmin(deps, username);
  await deps.directory.deleteUser(username);
  await recordEvent(deps, {
    subject: ADMIN_SUBJECT,
    action: 'user.deleted',
    actor: userActor(principal),
    req,
    details: { username },
  });
}
