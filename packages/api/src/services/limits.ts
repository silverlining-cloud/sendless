import {
  emailDomain,
  fileExtension,
  formatBytes,
  MIN_PASSWORD_LENGTH,
  type EffectiveLimits,
  type FileInput,
} from '@sendless/shared';
import { applyPolicyLimits } from '@sendless/ee/api';
import { hasFeature, type EditionState } from '../edition.js';
import { badRequest } from '../http.js';
import type { Env } from '../ports.js';
import type { Settings } from '../settings.js';

/** Core limits from settings and the template's retention cap, tightened by Pro policies when licensed. */
export function effectiveLimits(settings: Settings, env: Env, edition: EditionState): EffectiveLimits {
  const maxExpiresInHours = env.maxRetentionDays * 24;
  const base: EffectiveLimits = {
    maxTransferBytes: settings.limits.maxTransferBytes,
    maxFilesPerTransfer: settings.limits.maxFilesPerTransfer,
    maxExpiresInHours,
    defaultExpiresInHours: Math.min(settings.defaults.expiresInHours, maxExpiresInHours),
    defaultMaxOpens: settings.defaults.maxOpens,
    allowUnlimitedOpens: settings.limits.allowUnlimitedOpens,
    maxOpensLimit: null,
    requirePassword: false,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    blockedExtensions: [],
    allowedRecipientDomains: [],
  };
  return hasFeature(edition, 'policies') ? applyPolicyLimits(base, settings.policies) : base;
}

export function checkFiles(files: FileInput[], limits: EffectiveLimits, maxBytes = limits.maxTransferBytes): void {
  if (files.length > limits.maxFilesPerTransfer) {
    throw badRequest(`At most ${limits.maxFilesPerTransfer} files per transfer`, 'too_many_files');
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > maxBytes) {
    throw badRequest(`Transfers can be at most ${formatBytes(maxBytes)}`, 'too_large');
  }
  if (limits.blockedExtensions.length > 0) {
    const blocked = files.find((f) => limits.blockedExtensions.includes(fileExtension(f.name)));
    if (blocked) throw badRequest(`Files of type .${fileExtension(blocked.name)} are not allowed`, 'blocked_file_type');
  }
}

export function checkPassword(password: string | undefined, limits: EffectiveLimits): void {
  if (!password) {
    if (limits.requirePassword) throw badRequest('A password is required', 'password_required');
    return;
  }
  if ([...password].length < limits.minPasswordLength) {
    throw badRequest(`Passwords must be at least ${limits.minPasswordLength} characters`, 'password_too_short');
  }
}

export function checkLifetime(hours: number, limits: EffectiveLimits): void {
  if (hours > limits.maxExpiresInHours) {
    throw badRequest(`Links can stay active for at most ${limits.maxExpiresInHours} hours`, 'expiry_too_long');
  }
}

export function checkOpens(maxOpens: number | null, limits: EffectiveLimits): void {
  if (maxOpens === null) {
    if (!limits.allowUnlimitedOpens || limits.maxOpensLimit !== null) {
      throw badRequest('Choose how often the link can be opened', 'open_limit_required');
    }
    return;
  }
  if (limits.maxOpensLimit !== null && maxOpens > limits.maxOpensLimit) {
    throw badRequest(`Links can be opened at most ${limits.maxOpensLimit} times`, 'open_limit_too_high');
  }
}

export function checkRecipients(recipients: string[], limits: EffectiveLimits, emailEnabled: boolean): void {
  if (recipients.length === 0) return;
  if (!emailEnabled) throw badRequest('Sending email is not configured for this installation', 'email_disabled');
  if (limits.allowedRecipientDomains.length > 0) {
    const outside = recipients.find((r) => !limits.allowedRecipientDomains.includes(emailDomain(r)));
    if (outside) throw badRequest(`Sending to ${emailDomain(outside)} is not allowed`, 'recipient_not_allowed');
  }
}
