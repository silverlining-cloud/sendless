/**
 * Light or dark appearance, chosen per browser. `system` follows the operating system.
 * The result is `data-theme="light" | "dark"` on <html>, which styles.css reads.
 * public/color-scheme.js applies the stored choice before the first paint; keep the two in sync.
 */
export type ColorScheme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'sendless.colorScheme';
const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)');

export function storedColorScheme(): ColorScheme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Storage can be unavailable (private mode); follow the system then.
  }
  return 'system';
}

function apply(scheme: ColorScheme) {
  const dark = scheme === 'dark' || (scheme === 'system' && prefersDark().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setColorScheme(scheme: ColorScheme) {
  try {
    if (scheme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    // ignore
  }
  apply(scheme);
}

/** Applies the stored choice and keeps following the system setting while the choice is `system`. */
export function initColorScheme() {
  apply(storedColorScheme());
  prefersDark().addEventListener('change', () => apply(storedColorScheme()));
}
