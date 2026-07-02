import { type Ref, unref } from 'vue';
import type { Composer } from 'vue-i18n';
import { defaultLng } from '../i18n';

export const readBrowserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (error) {
    console.warn('[dateTimeFormat] Failed to read browser timezone:', error);
    return 'UTC';
  }
};

export const normalizeTimezone = (timezone?: string | null): string => {
  const fallbackTimezone = readBrowserTimezone();
  if (!timezone) {
    return fallbackTimezone;
  }

  try {
    new Intl.DateTimeFormat(defaultLng, { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (error) {
    console.warn(`[dateTimeFormat] Invalid timezone "${timezone}", falling back to "${fallbackTimezone}".`, error);
    return fallbackTimezone;
  }
};

export type LocaleLike = string | Ref<string> | Composer['locale'];

export const resolveLocale = (locale?: LocaleLike): string => {
  const value = locale ? unref(locale as Ref<string>) : undefined;
  return value || defaultLng;
};

export const formatDateTimeWithSettings = (
  dateInput: string | number | Date,
  locale?: LocaleLike,
  timezone?: string | null,
  options?: Intl.DateTimeFormatOptions
): string => {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString(resolveLocale(locale), {
    ...options,
    timeZone: normalizeTimezone(timezone),
  });
};
