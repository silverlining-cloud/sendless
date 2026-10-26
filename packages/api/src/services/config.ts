import type { Branding, PublicConfig } from '@sendless/shared';
import { editionFor, hasFeature, type EditionState } from '../edition.js';
import type { Deps } from '../ports.js';
import { DEFAULT_SETTINGS, type Settings } from '../settings.js';
import { effectiveLimits } from './limits.js';

/**
 * Logo, colors and texts need the Pro `branding` feature. Without it they fall back to the defaults;
 * the stored values are kept and apply again once a license is installed.
 */
export function effectiveBranding(settings: Settings, edition: EditionState): Branding {
  if (hasFeature(edition, 'branding')) return settings.branding;
  const { appName, privacyUrl, imprintUrl } = settings.branding;
  return { ...DEFAULT_SETTINGS.branding, appName, privacyUrl, imprintUrl };
}

export async function publicConfig(deps: Deps): Promise<PublicConfig> {
  const [settings, system] = await Promise.all([deps.settings(), deps.system()]);
  const edition = editionFor(settings, deps.now());
  return {
    version: deps.env.version,
    edition: edition.edition,
    branding: effectiveBranding(settings, edition),
    auth: {
      mode: deps.env.devMode ? 'dev' : 'cognito',
      region: deps.env.region,
      userPoolId: system.userPoolId,
      clientId: system.clientId,
      domain: system.cognitoDomain,
      selfSignUp: system.selfSignUp,
    },
    features: {
      email: deps.mailer.enabled,
      malwareScanning: deps.env.malwareScanning && hasFeature(edition, 'malware-scanning'),
    },
    limits: effectiveLimits(settings, deps.env, edition),
  };
}
