export type TimeUnit =
  'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export const TIME_UNITS: readonly TimeUnit[] = [
  'millisecond',
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
];

export function isTimeUnit(value: unknown): value is TimeUnit {
  return typeof value === 'string' && (TIME_UNITS as readonly string[]).includes(value);
}
