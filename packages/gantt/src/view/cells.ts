import type { TimeUnit } from '../util/time';
import { startOfUnit, type TimeZone } from '../util/zone';

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

function cached<F extends Intl.DateTimeFormat | Intl.NumberFormat>(key: string, create: () => F): F {
  let formatter = cache.get(key) as F | undefined;
  if (!formatter) cache.set(key, (formatter = create()));
  return formatter;
}

export function formatDate(time: number, zone: TimeZone, locale: string | undefined): string {
  return cached(
    `date|${locale ?? ''}|${zone}`,
    () =>
      new Intl.DateTimeFormat(
        locale,
        zone === 'local' ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeZone: zone },
      ),
  ).format(time);
}

export function formatDateTime(time: number, zone: TimeZone, locale: string | undefined): string {
  return cached(
    `datetime|${locale ?? ''}|${zone}`,
    () =>
      new Intl.DateTimeFormat(
        locale,
        zone === 'local'
          ? { dateStyle: 'medium', timeStyle: 'short' }
          : { dateStyle: 'medium', timeStyle: 'short', timeZone: zone },
      ),
  ).format(time);
}

/**
 * End dates are exclusive: a task on 5–8 October ends at midnight on the 9th. Shown as a date, that reads
 * as one day too many, so an end exactly at midnight is shown as the day before (like MS Project).
 */
export function formatEndDate(
  start: number,
  end: number,
  zone: TimeZone,
  locale: string | undefined,
): string {
  const atMidnight = end > start && startOfUnit(end, 'day', zone) === end;
  return formatDate(atMidnight ? end - 1 : end, zone, locale);
}

// Units Intl.NumberFormat can spell out in every locale.
const INTL_UNITS: Partial<Record<TimeUnit, string>> = {
  millisecond: 'millisecond',
  second: 'second',
  minute: 'minute',
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
};

export function formatDuration(value: number, unit: TimeUnit, locale: string | undefined): string {
  const intlUnit = INTL_UNITS[unit];
  if (intlUnit === undefined) {
    // Quarters have no localized unit name.
    const number = cached(
      `number|${locale ?? ''}`,
      () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    );
    return `${number.format(value)} q`;
  }
  return cached(
    `duration|${locale ?? ''}|${intlUnit}`,
    () =>
      new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: intlUnit,
        unitDisplay: 'long',
        maximumFractionDigits: 2,
      }),
  ).format(value);
}

export function formatPercent(value: number, locale: string | undefined): string {
  return cached(
    `percent|${locale ?? ''}`,
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
  ).format(value / 100);
}
