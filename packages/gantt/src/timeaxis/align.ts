import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from '../util/civil';
import type { TimeUnit } from '../util/time';
import {
  addUnits,
  fromWallTime,
  startOfUnit,
  toWallTime,
  wallDay,
  zoneOffset,
  type TimeZone,
} from '../util/zone';

const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

/**
 * Start of the `increment`-sized unit containing `time`, aligned to natural boundaries: 6 hours → 00, 06,
 * 12, 18; 3 months → January, April, …; 5 years → 2025, 2030, …
 */
export function alignToUnit(
  time: number,
  unit: TimeUnit,
  increment: number,
  zone: TimeZone,
  weekStartsOn: number,
): number {
  const base = startOfUnit(time, unit, zone, weekStartsOn);
  if (increment === 1) return base;

  const wall = toWallTime(base, zone);
  let position: number;
  switch (unit) {
    case 'millisecond':
      position = wall.millisecond;
      break;
    case 'second':
      position = wall.second;
      break;
    case 'minute':
      position = wall.minute;
      break;
    case 'hour':
      position = wall.hour;
      break;
    case 'day':
      position = wallDay(base, zone);
      break;
    case 'week':
      // Every week start is the same weekday, so this counts weeks consistently.
      position = Math.floor(wallDay(base, zone) / 7);
      break;
    case 'month':
      position = wall.month - 1;
      break;
    case 'quarter':
      position = Math.floor((wall.month - 1) / 3);
      break;
    case 'year':
      position = wall.year;
      break;
  }
  const remainder = mod(position, increment);
  if (remainder === 0) return base;
  switch (unit) {
    // Sub-day units: go back on the wall clock, not by a fixed duration, which would overshoot across a
    // DST gap (03:00 on spring-forward day minus 3 hours is 23:00 the day before, not 00:00).
    case 'millisecond':
      return fromWallTime({ ...wall, millisecond: wall.millisecond - remainder }, zone);
    case 'second':
      return fromWallTime({ ...wall, second: wall.second - remainder }, zone);
    case 'minute':
      return fromWallTime({ ...wall, minute: wall.minute - remainder }, zone);
    case 'hour':
      return fromWallTime({ ...wall, hour: wall.hour - remainder }, zone);
    default:
      return addUnits(base, -remainder, unit, zone);
  }
}

const SUB_DAY_SIZE: Partial<Record<TimeUnit, number>> = {
  millisecond: 1,
  second: MS_PER_SECOND,
  minute: MS_PER_MINUTE,
  hour: MS_PER_HOUR,
};

/**
 * The natural boundary after an aligned boundary. Always re-aligns instead of adding a fixed step, so the
 * result doesn't depend on where counting started.
 */
export function nextBoundary(
  boundary: number,
  unit: TimeUnit,
  increment: number,
  zone: TimeZone,
  weekStartsOn: number,
): number {
  // Fast path: if `boundary` sits exactly on a wall-clock boundary (not shifted by a DST gap) and the UTC
  // offset is the same one step later, the wall clock moved exactly one step, so a fixed step lands on the
  // next natural boundary. This is the common case (no DST change in between) and avoids wall-clock math.
  const subDay = SUB_DAY_SIZE[unit];
  const step = subDay ?? (unit === 'day' ? MS_PER_DAY : unit === 'week' ? 7 * MS_PER_DAY : undefined);
  if (step !== undefined) {
    const offset = zoneOffset(boundary, zone);
    const candidate = boundary + step * increment;
    if (mod(boundary + offset, subDay ?? MS_PER_DAY) === 0 && zoneOffset(candidate, zone) === offset) {
      return candidate;
    }
  }

  const size = SUB_DAY_SIZE[unit];
  if (size !== undefined) {
    // Step half a step past the next boundary, then align down. A plain 6-hour step would drift from
    // 00/06/12/18 to 07/13/19 after a DST change.
    const next = alignToUnit(boundary + size * increment * 1.5, unit, increment, zone, weekStartsOn);
    return next > boundary ? next : boundary + size * increment;
  }
  // Days and longer: step on the wall calendar and re-align, so a DST change that skips midnight
  // (e.g. Cairo) doesn't leave every later boundary at 01:00.
  return alignToUnit(addUnits(boundary, increment, unit, zone), unit, increment, zone, weekStartsOn);
}
