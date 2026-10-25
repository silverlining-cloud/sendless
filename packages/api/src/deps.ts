import { HttpError } from './http.js';
import type { SystemConfig } from './model.js';
import type { Deps } from './ports.js';
import { mergeSettings, type Settings } from './settings.js';

type BaseDeps = Omit<Deps, 'now' | 'system' | 'settings' | 'invalidateSettings'> & {
  now?: () => number;
  /** Override the deploy-time config (dev server and tests). */
  systemConfig?: SystemConfig;
};

const SETTINGS_TTL_MS = 10_000;

/** Adds clock and cached access to system config and settings. */
export function createDeps(base: BaseDeps): Deps {
  const { systemConfig, now = Date.now, ...rest } = base;
  let system: SystemConfig | null = systemConfig ?? null;
  let settings: { value: Settings; at: number } | null = null;

  return {
    ...rest,
    now,
    async system() {
      if (!system) system = await rest.store.getSystemConfig();
      if (!system) throw new HttpError(503, 'not_configured', 'This installation has not finished setting up');
      return system;
    },
    async settings() {
      if (!settings || Date.now() - settings.at > SETTINGS_TTL_MS) {
        settings = { value: mergeSettings(await rest.store.getSettings()), at: Date.now() };
      }
      return settings.value;
    },
    invalidateSettings() {
      settings = null;
    },
  };
}
