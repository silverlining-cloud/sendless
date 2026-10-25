import type { EffectiveLimits, Policies } from '@sendless/shared';

/** Tightens the core limits with the admin's policies. Policies can only restrict, never relax. */
export function applyPolicyLimits(base: EffectiveLimits, policies: Policies): EffectiveLimits {
  const maxExpiresInHours =
    policies.maxExpiresInHours !== null ? Math.min(base.maxExpiresInHours, policies.maxExpiresInHours) : base.maxExpiresInHours;
  const maxOpensLimit = policies.maxOpensLimit;
  const allowUnlimitedOpens = base.allowUnlimitedOpens && !policies.requireOpenLimit && maxOpensLimit === null;

  let defaultMaxOpens = base.defaultMaxOpens;
  if (defaultMaxOpens === null && !allowUnlimitedOpens) defaultMaxOpens = maxOpensLimit ?? 10;
  if (defaultMaxOpens !== null && maxOpensLimit !== null) defaultMaxOpens = Math.min(defaultMaxOpens, maxOpensLimit);

  return {
    ...base,
    maxExpiresInHours,
    defaultExpiresInHours: Math.min(base.defaultExpiresInHours, maxExpiresInHours),
    allowUnlimitedOpens,
    maxOpensLimit,
    defaultMaxOpens,
    requirePassword: base.requirePassword || policies.requirePassword,
    minPasswordLength: Math.max(base.minPasswordLength, policies.minPasswordLength),
    blockedExtensions: [...new Set([...base.blockedExtensions, ...policies.blockedExtensions])],
    allowedRecipientDomains: policies.allowedRecipientDomains,
  };
}
