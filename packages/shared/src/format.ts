const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number, locale = 'en'): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits })} ${UNITS[exponent]}`;
}

/** Lower-case extension without the dot, or '' if the name has none. */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}
