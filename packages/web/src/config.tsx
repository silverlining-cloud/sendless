import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Branding, PublicConfig } from '@sendless/shared';
import { ApiError, publicApi } from './api/client.js';

interface ConfigState {
  config: PublicConfig;
  reload(): Promise<void>;
}

const ConfigContext = createContext<ConfigState | null>(null);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function shade(hex: string, amount: number): string {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    const v = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
    return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * Applies the admin's branding as CSS variables. Colors are validated as #RRGGBB on the server.
 * Background and text colors only feed the light theme; styles.css picks per theme.
 */
export function applyTheme(branding: Branding) {
  const root = document.documentElement.style;
  const dark = luminance(branding.primaryColor) > 0.45;
  root.setProperty('--brand', branding.primaryColor);
  root.setProperty('--brand-hover', shade(branding.primaryColor, -0.15));
  root.setProperty('--brand-contrast', dark ? '#111111' : '#ffffff');
  root.setProperty('--light-brand-soft', shade(branding.primaryColor, 0.88));
  root.setProperty('--light-bg', branding.backgroundColor);
  root.setProperty('--light-text', branding.textColor);
  // Brand-colored text on dark surfaces needs a lighter shade to stay readable.
  root.setProperty('--dark-brand-text', shade(branding.primaryColor, 0.4));
  document.title = branding.appName;
}

export function ConfigProvider({ children, fallback, error }: { children: ReactNode; fallback: ReactNode; error: (e: Error, retry: () => void) => ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setFailure(null);
      const next = await publicApi.get<PublicConfig>('/api/public/config');
      applyTheme(next.branding);
      setConfig(next);
    } catch (e) {
      setFailure(e instanceof Error ? e : new ApiError(0, 'unknown', String(e)));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failure) return <>{error(failure, () => void load())}</>;
  if (!config) return <>{fallback}</>;
  return <ConfigContext.Provider value={{ config, reload: load }}>{children}</ConfigContext.Provider>;
}

export function useConfig(): PublicConfig {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig outside ConfigProvider');
  return ctx.config;
}

export function useReloadConfig(): () => Promise<void> {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useReloadConfig outside ConfigProvider');
  return ctx.reload;
}
