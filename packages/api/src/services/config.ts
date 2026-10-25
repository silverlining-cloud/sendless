import type { PublicConfig } from '@sendless/shared';
import { editionFor, hasFeature } from '../edition.js';
import type { Deps } from '../ports.js';
import { effectiveLimits } from './limits.js';

export async function publicConfig(deps: Deps): Promise<PublicConfig> {
  const [settings, system] = await Promise.all([deps.settings(), deps.system()]);
  const edition = editionFor(settings, deps.now());
  return {
    version: deps.env.version,
    edition: edition.edition,
    branding: settings.branding,
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
