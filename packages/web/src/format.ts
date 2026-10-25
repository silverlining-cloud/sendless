import { formatBytes } from '@s3ndless/shared';
import type { Translate } from './i18n/index.js';

export const bytes = (value: number, locale: string) => formatBytes(value, locale);

export function dateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** "in 3 days" / "vor 2 Stunden". */
export function relative(iso: string, locale: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

export function duration(hours: number, t: Translate): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? t('duration.day') : t('duration.days', { count: days });
  }
  return hours === 1 ? t('duration.hour') : t('duration.hours', { count: hours });
}

export function seconds(value: number, locale: string): string {
  if (!Number.isFinite(value) || value <= 0) return '–';
  const unit = value < 90 ? 'second' : value < 5400 ? 'minute' : 'hour';
  const amount = unit === 'second' ? value : unit === 'minute' ? value / 60 : value / 3600;
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long', maximumFractionDigits: 0 }).format(amount);
}

export function fileCount(count: number, t: Translate): string {
  return count === 1 ? t('common.file') : t('common.files', { count });
}

/** Lifetime choices up to the installation's maximum. */
export function lifetimeOptions(maxHours: number): number[] {
  const all = [1, 6, 24, 72, 168, 336, 720, 1440, 2160, 4320, 8760];
  const options = all.filter((h) => h <= maxHours);
  if (!options.includes(maxHours)) options.push(maxHours);
  return options;
}
