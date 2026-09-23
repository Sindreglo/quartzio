import type { ProjectSettings } from '../data/types';
import { MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from '../util/civil';
import type { TimeUnit } from '../util/time';

export type DurationSettings = Pick<ProjectSettings, 'hoursPerDay' | 'daysPerWeek' | 'daysPerMonth'>;

/**
 * Working milliseconds in one unit. Durations are working time (like MS Project): with 8 hours per day,
 * "1 day" is 8 working hours, and "1 week" is `daysPerWeek` such days — not 7 calendar days.
 */
export function workingMsPerUnit(unit: TimeUnit, settings: DurationSettings): number {
  const day = settings.hoursPerDay * MS_PER_HOUR;
  const month = settings.daysPerMonth * day;
  switch (unit) {
    case 'millisecond':
      return 1;
    case 'second':
      return MS_PER_SECOND;
    case 'minute':
      return MS_PER_MINUTE;
    case 'hour':
      return MS_PER_HOUR;
    case 'day':
      return day;
    case 'week':
      return settings.daysPerWeek * day;
    case 'month':
      return month;
    case 'quarter':
      return 3 * month;
    case 'year':
      return 12 * month;
  }
}

export function durationToWorkingMs(value: number, unit: TimeUnit, settings: DurationSettings): number {
  return value * workingMsPerUnit(unit, settings);
}

export function workingMsToDuration(ms: number, unit: TimeUnit, settings: DurationSettings): number {
  return ms / workingMsPerUnit(unit, settings);
}
