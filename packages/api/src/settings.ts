import { DEFAULT_APP_NAME, GiB, type Branding, type Policies, type SettingsInput } from '@sendless/shared';
import type { SsoProviderRecord } from './model.js';

export interface Settings extends Omit<SettingsInput, 'branding'> {
  /** Legal links, plus name, logo, colors and texts, which apply only with a license that includes `branding`. */
  branding: Branding;
  licenseKey: string | null;
  /** Pro: enforced only with a license that includes `policies`. */
  policies: Policies;
  /** Pro: SAML/OIDC providers configured in the user pool. */
  sso: { providers: SsoProviderRecord[] };
}

export const DEFAULT_POLICIES: Policies = {
  requirePassword: false,
  minPasswordLength: 8,
  maxExpiresInHours: null,
  requireOpenLimit: false,
  maxOpensLimit: null,
  blockedExtensions: [],
  allowedRecipientDomains: [],
  auditRetentionDays: 90,
  allowUnscannableFiles: false,
};

export const DEFAULT_SETTINGS: Settings = {
  branding: {
    appName: DEFAULT_APP_NAME,
    logoUrl: null,
    primaryColor: '#2F6FB5',
    backgroundColor: '#E9EDF2',
    textColor: '#1C2430',
    welcomeTitle: null,
    welcomeText: null,
    footerText: null,
    privacyUrl: null,
    imprintUrl: null,
  },
  defaults: { expiresInHours: 7 * 24, maxOpens: 10 },
  limits: { maxTransferBytes: 20 * GiB, maxFilesPerTransfer: 100, allowUnlimitedOpens: true },
  showSenderEmail: true,
  licenseKey: null,
  policies: DEFAULT_POLICIES,
  sso: { providers: [] },
};

/** Fills in defaults for anything missing, so settings written by older versions keep working. */
export function mergeSettings(stored: Partial<Settings> | null | undefined): Settings {
  const s = stored ?? {};
  return {
    branding: { ...DEFAULT_SETTINGS.branding, ...s.branding },
    defaults: { ...DEFAULT_SETTINGS.defaults, ...s.defaults },
    limits: { ...DEFAULT_SETTINGS.limits, ...s.limits },
    showSenderEmail: s.showSenderEmail ?? DEFAULT_SETTINGS.showSenderEmail,
    licenseKey: s.licenseKey ?? null,
    policies: { ...DEFAULT_POLICIES, ...s.policies },
    sso: { providers: s.sso?.providers ?? [] },
  };
}
