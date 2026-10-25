import type { Edition, LicenseInfo, ProFeature } from '@s3ndless/shared';
import { verifyLicense } from '@s3ndless/ee/api';
import type { Settings } from './settings.js';

export interface EditionState {
  edition: Edition;
  features: ReadonlySet<ProFeature>;
  license: LicenseInfo | null;
  /** Why the license is not (fully) active, e.g. expired or invalid signature. */
  error: string | null;
}

const COMMUNITY: EditionState = { edition: 'community', features: new Set(), license: null, error: null };

export function editionFor(settings: Settings, now: number): EditionState {
  if (!settings.licenseKey) return COMMUNITY;
  const result = verifyLicense(settings.licenseKey, now);
  if (!result.ok) return { ...COMMUNITY, error: result.error };
  return {
    edition: result.info.edition,
    features: new Set(result.info.features),
    license: result.info,
    error: result.warning ?? null,
  };
}

export function hasFeature(state: EditionState, feature: ProFeature): boolean {
  return state.features.has(feature);
}
