// Time-zone aware wall-clock arithmetic. This is the only place (with civil.ts) that may depend on
// the host time zone; everything else works on epoch milliseconds and goes through these helpers.
import {
  civilFromDays,
  daysFromCivil,
  daysInMonth,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  weekdayFromDays,
} from './civil';
import { QuartzioError } from './errors';
import type { TimeUnit } from './time';

/** `'local'` (the host's zone), `'UTC'`, or an IANA name such as `'Europe/Oslo'`. */
export type TimeZone = string;

export const LOCAL_TIME_ZONE: TimeZone = 'local';

export interface WallTime {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export interface ZonedWallTime extends WallTime {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(zone: unknown): zone is TimeZone {
  if (zone === LOCAL_TIME_ZONE || zone === 'UTC') return true;
  if (typeof zone !== 'string' || zone === '') return false;
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

export function assertTimeZone(zone: unknown): asserts zone is TimeZone {
  if (!isValidTimeZone(zone)) {
    throw new QuartzioError(
      `"${String(zone)}" is not a valid time zone. Use "local", "UTC" or an IANA name.`,
    );
  }
}

function intlOffset(time: number, zone: string): number {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of formatterFor(zone).formatToParts(time)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  const wallAsUtc =
    daysFromCivil(values.year ?? 1970, values.month ?? 1, values.day ?? 1) * MS_PER_DAY +
    (values.hour ?? 0) * MS_PER_HOUR +
    (values.minute ?? 0) * MS_PER_MINUTE +
    (values.second ?? 0) * MS_PER_SECOND;
  return wallAsUtc - (time - mod(time, MS_PER_SECOND));
}

// Offsets are cached in two levels. A whole day is cached as one entry when the offset is the same at both
// ends (real zones never change twice in a day). Days with a transition are cached per 15 minutes; most
// transitions fall on quarter hours, but not all (e.g. St. John's before 2011), so a quarter hour is only
// cached when its ends agree, and otherwise computed exactly.
const QUARTER_HOUR = 15 * MS_PER_MINUTE;
const MAX_CACHED_OFFSETS = 50_000;
/** Per zone: day bucket → offset, or `null` for days with a transition. */
const dayCache = new Map<string, Map<number, number | null>>();
const quarterCache = new Map<string, Map<number, number>>();

function cacheFor<V>(caches: Map<string, Map<number, V>>, zone: string): Map<number, V> {
  let cache = caches.get(zone);
  if (!cache) caches.set(zone, (cache = new Map<number, V>()));
  if (cache.size >= MAX_CACHED_OFFSETS) cache.clear();
  return cache;
}

/** Offset from UTC in milliseconds at `time` (e.g. +3 600 000 for CET). */
export function zoneOffset(time: number, zone: TimeZone): number {
  if (zone === 'UTC') return 0;
  if (zone === LOCAL_TIME_ZONE) return -new Date(time).getTimezoneOffset() * MS_PER_MINUTE;

  const days = cacheFor(dayCache, zone);
  const day = Math.floor(time / MS_PER_DAY);
  let dayOffset = days.get(day);
  if (dayOffset === undefined) {
    assertTimeZone(zone);
    const start = intlOffset(day * MS_PER_DAY, zone);
    dayOffset = start === intlOffset((day + 1) * MS_PER_DAY - MS_PER_SECOND, zone) ? start : null;
    days.set(day, dayOffset);
  }
  if (dayOffset !== null) return dayOffset;

  const quarters = cacheFor(quarterCache, zone);
  const quarter = Math.floor(time / QUARTER_HOUR);
  const cached = quarters.get(quarter);
  if (cached !== undefined) return cached;
  const start = intlOffset(quarter * QUARTER_HOUR, zone);
  const end = intlOffset((quarter + 1) * QUARTER_HOUR - MS_PER_SECOND, zone);
  if (start !== end) return intlOffset(time, zone); // the transition is inside this quarter hour
  quarters.set(quarter, start);
  return start;
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Civil day number (days since 1970-01-01) of the wall date at `time` in `zone`. */
export function wallDay(time: number, zone: TimeZone): number {
  return Math.floor((time + zoneOffset(time, zone)) / MS_PER_DAY);
}

export function toWallTime(time: number, zone: TimeZone): ZonedWallTime {
  const local = time + zoneOffset(time, zone);
  const days = Math.floor(local / MS_PER_DAY);
  const msOfDay = local - days * MS_PER_DAY;
  return {
    ...civilFromDays(days),
    hour: Math.floor(msOfDay / MS_PER_HOUR),
    minute: Math.floor((msOfDay % MS_PER_HOUR) / MS_PER_MINUTE),
    second: Math.floor((msOfDay % MS_PER_MINUTE) / MS_PER_SECOND),
    millisecond: msOfDay % MS_PER_SECOND,
    weekday: weekdayFromDays(days),
  };
}

const wallAsUtcOf = (wall: Partial<WallTime> & Pick<WallTime, 'year'>): number =>
  daysFromCivil(wall.year, wall.month ?? 1, wall.day ?? 1) * MS_PER_DAY +
  (wall.hour ?? 0) * MS_PER_HOUR +
  (wall.minute ?? 0) * MS_PER_MINUTE +
  (wall.second ?? 0) * MS_PER_SECOND +
  (wall.millisecond ?? 0);

/**
 * The instant a wall-clock time happens in `zone`. Out-of-range fields roll over.
 * A time skipped by a DST change (e.g. 02:30 on spring-forward day) resolves to the same distance after
 * the change (03:30); a time that happens twice (fall-back) resolves to the first occurrence.
 */
export function fromWallTime(wall: Partial<WallTime> & Pick<WallTime, 'year'>, zone: TimeZone): number {
  return wallAsUtcToInstant(wallAsUtcOf(wall), zone, {});
}

/**
 * Midnight at the start of civil day `days`, plus `minutes` of wall-clock time. Times inside a DST gap
 * resolve to the transition instant, so boundaries of consecutive intervals stay ordered and never overlap
 * (a working interval 02:15–02:45 on spring-forward day collapses to nothing).
 */
export function wallDayTime(days: number, minutes: number, zone: TimeZone): number {
  return wallAsUtcToInstant(days * MS_PER_DAY + minutes * MS_PER_MINUTE, zone, { gap: 'transition' });
}

interface Resolution {
  /** `'shift'` (default): move forward by the gap's length. `'transition'`: the instant the gap starts. */
  gap?: 'shift' | 'transition';
  /** For repeated wall times: prefer the occurrence with this offset instead of the first one. */
  preferOffset?: number;
}

function wallAsUtcToInstant(wallAsUtc: number, zone: TimeZone, resolution: Resolution): number {
  if (zone === 'UTC') return wallAsUtc;
  // Real zones have at most one transition within a day, so the offsets a day before and after cover
  // every candidate.
  const before = zoneOffset(wallAsUtc - MS_PER_DAY, zone);
  const after = zoneOffset(wallAsUtc + MS_PER_DAY, zone);
  const candidates = (before === after ? [before] : [before, after])
    .filter((offset) => zoneOffset(wallAsUtc - offset, zone) === offset)
    .map((offset) => ({ offset, time: wallAsUtc - offset }))
    .sort((a, b) => a.time - b.time);

  const chosen = candidates.find(({ offset }) => offset === resolution.preferOffset) ?? candidates[0];
  if (chosen) return chosen.time;

  // No candidate: the wall time falls in a DST gap.
  if (resolution.gap === 'transition') return findTransition(wallAsUtc - after, wallAsUtc - before, zone);
  return wallAsUtc - before; // the offset from before the gap moves it forward
}

/** Binary search for the instant the offset changes, given `low` (old offset) < `high` (new offset). */
function findTransition(low: number, high: number, zone: TimeZone): number {
  const offsetAtLow = zoneOffset(low, zone);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (zoneOffset(middle, zone) === offsetAtLow) low = middle;
    else high = middle;
  }
  return high;
}

export function startOfDay(time: number, zone: TimeZone): number {
  return wallDayTime(wallDay(time, zone), 0, zone);
}

/**
 * Start of the unit containing `time`, e.g. midnight for `'day'`, the first day of the month for `'month'`.
 * `weekStartsOn`: 0 = Sunday … 6 = Saturday.
 */
export function startOfUnit(time: number, unit: TimeUnit, zone: TimeZone, weekStartsOn = 1): number {
  switch (unit) {
    case 'millisecond':
      return time;
    case 'second':
    case 'minute':
    case 'hour': {
      // Work on the instant, not by rebuilding the wall time: in a repeated hour (fall-back) the wall time
      // is ambiguous and would resolve to the first occurrence.
      const size = unit === 'hour' ? MS_PER_HOUR : unit === 'minute' ? MS_PER_MINUTE : MS_PER_SECOND;
      return time - mod(time + zoneOffset(time, zone), size);
    }
    case 'day':
      return startOfDay(time, zone);
    case 'week': {
      const days = wallDay(time, zone);
      return wallDayTime(days - mod(weekdayFromDays(days) - weekStartsOn, 7), 0, zone);
    }
    case 'month':
    case 'quarter':
    case 'year': {
      const { year, month } = toWallTime(time, zone);
      const firstMonth = unit === 'month' ? month : unit === 'quarter' ? month - ((month - 1) % 3) : 1;
      return fromWallTime({ year, month: firstMonth, day: 1 }, zone);
    }
  }
}

/**
 * Adds calendar time. Units up to hours are exact durations; days and longer follow the wall clock, so
 * adding a day across a DST change keeps the time of day. Month arithmetic clamps to the month's last day
 * (31 January + 1 month = 28/29 February). Days and longer need whole numbers.
 */
export function addUnits(time: number, amount: number, unit: TimeUnit, zone: TimeZone): number {
  switch (unit) {
    case 'millisecond':
      return time + amount;
    case 'second':
      return time + amount * MS_PER_SECOND;
    case 'minute':
      return time + amount * MS_PER_MINUTE;
    case 'hour':
      return time + amount * MS_PER_HOUR;
    case 'day':
    case 'week':
    case 'month':
    case 'quarter':
    case 'year': {
      if (!Number.isInteger(amount)) {
        throw new QuartzioError(`addUnits: "${unit}" needs a whole number, got ${String(amount)}.`);
      }
      const wall = toWallTime(time, zone);
      let { year, month, day } = wall;
      if (unit === 'day' || unit === 'week') {
        day += amount * (unit === 'week' ? 7 : 1);
      } else {
        const months = amount * (unit === 'year' ? 12 : unit === 'quarter' ? 3 : 1);
        const monthIndex = year * 12 + (month - 1) + months;
        year = Math.floor(monthIndex / 12);
        month = mod(monthIndex, 12) + 1;
        day = Math.min(day, daysInMonth(year, month));
      }
      // Keep the same occurrence of a repeated hour (e.g. adding 0 days to the second 02:30 on fall-back day).
      return wallAsUtcToInstant(wallAsUtcOf({ ...wall, year, month, day }), zone, {
        preferOffset: zoneOffset(time, zone),
      });
    }
  }
}

/** ISO 8601 week number: weeks start on Monday, and week 1 contains the year's first Thursday. */
export function isoWeek(time: number, zone: TimeZone): { year: number; week: number } {
  const days = wallDay(time, zone);
  const thursday = days - mod(weekdayFromDays(days) - 1, 7) + 3;
  const { year } = civilFromDays(thursday);
  return { year, week: Math.floor((thursday - daysFromCivil(year, 1, 1)) / 7) + 1 };
}
