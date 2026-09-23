import { WEEKDAYS } from '../data/normalize';
import type { Calendar, Id } from '../data/types';
import { weekdayFromDays } from '../util/civil';
import { QuartzioError } from '../util/errors';
import { parseCivilDate, parseTimeOfDay } from '../util/parse';
import { wallDay, wallDayTime, type TimeZone } from '../util/zone';

/** A working period as instants: `[start, end)`. */
export type Interval = readonly [start: number, end: number];

/**
 * A calendar bound to a time zone, answering working-time questions in epoch milliseconds.
 * Durations here are working milliseconds (see `durationToWorkingMs`).
 */
export interface WorkingCalendar {
  readonly calendarId: Id;
  readonly timeZone: TimeZone;
  isWorking: (time: number) => boolean;
  /** The earliest working instant at or after `time`. */
  nextWorkingTime: (time: number) => number;
  /** The latest instant at or before `time` that ends working time (working time lies just before it). */
  previousWorkingTime: (time: number) => number;
  /**
   * Walks forward from `start` until `workingMs` of working time has passed and returns that instant.
   * When the duration ends exactly at the end of a working period, that end is returned (end dates
   * are exclusive). Zero returns `start` unchanged. Negative walks backwards.
   */
  addWorkingTime: (start: number, workingMs: number) => number;
  /** Walks backwards from `end`; the mirror of `addWorkingTime`. */
  subtractWorkingTime: (end: number, workingMs: number) => number;
  /** Working milliseconds in `[from, to)`. Negative when `to` is before `from`. */
  workingTimeBetween: (from: number, to: number) => number;
  /** Working intervals overlapping `[from, to)`, clipped to it. For drawing working/non-working time. */
  workingIntervals: (from: number, to: number) => Interval[];
}

/** How far to search for working time before deciding the calendar has none (~10 years). */
const MAX_EMPTY_DAYS = 3660;
const MAX_CACHED_DAYS = 20_000;

type MinuteInterval = readonly [from: number, to: number];

const toMinutes = (intervals: Calendar['week']['monday']): MinuteInterval[] =>
  intervals.map(({ start, end }) => [parseTimeOfDay(start) ?? 0, parseTimeOfDay(end) ?? 0] as const);

export function createWorkingCalendar(calendar: Calendar, zone: TimeZone): WorkingCalendar {
  const week = WEEKDAYS.map((day) => toMinutes(calendar.week[day]));
  const hasWeeklyWork = week.some((intervals) => intervals.length > 0);

  // Kept as ranges (not expanded per day), so a long exception costs nothing extra. Later ones win.
  const exceptions = calendar.exceptions.map((exception) => {
    const first = parseCivilDate(exception.startDate) ?? 0;
    return {
      first,
      last: parseCivilDate(exception.endDate) ?? first,
      intervals: toMinutes(exception.intervals),
    };
  });
  const exceptionOn = (day: number): MinuteInterval[] | undefined => {
    for (let i = exceptions.length - 1; i >= 0; i--) {
      const exception = exceptions[i];
      if (exception && exception.first <= day && day <= exception.last) return exception.intervals;
    }
    return undefined;
  };

  const cache = new Map<number, readonly Interval[]>();

  const intervalsOnDay = (day: number): readonly Interval[] => {
    let intervals = cache.get(day);
    if (!intervals) {
      const minutes = exceptionOn(day) ?? week[weekdayFromDays(day)] ?? [];
      intervals = minutes
        .map(([from, to]): Interval => [wallDayTime(day, from, zone), wallDayTime(day, to, zone)])
        // A DST change can squeeze an interval to nothing (e.g. 02:00–03:00 on spring-forward day).
        .filter(([start, end]) => end > start);
      if (cache.size >= MAX_CACHED_DAYS) cache.clear();
      cache.set(day, intervals);
    }
    return intervals;
  };

  const noWorkingTime = (): QuartzioError =>
    new QuartzioError(
      `Calendar "${String(calendar.id)}" has no working time within ${String(MAX_EMPTY_DAYS)} days. ` +
        'Check its weekly schedule and exceptions.',
    );

  /** Calls `visit` for each working interval from `time` onward (or backward) until it returns true. */
  const scan = (time: number, direction: 1 | -1, visit: (interval: Interval) => boolean): void => {
    let day = wallDay(time, zone);
    let emptyDays = 0;
    for (;;) {
      const intervals = intervalsOnDay(day);
      if (intervals.length === 0) {
        // Only exceptions can produce long runs of empty days when the week has working time.
        if (++emptyDays > MAX_EMPTY_DAYS || (!hasWeeklyWork && exceptions.length === 0))
          throw noWorkingTime();
      } else {
        emptyDays = 0;
        const ordered = direction === 1 ? intervals : [...intervals].reverse();
        for (const interval of ordered) if (visit(interval)) return;
      }
      day += direction;
    }
  };

  const assertFinite = (...values: number[]): void => {
    if (!values.every(Number.isFinite)) {
      throw new QuartzioError('Working-time calculations need finite numbers (not NaN or Infinity).');
    }
  };

  const addWorkingTime = (start: number, workingMs: number): number => {
    assertFinite(start, workingMs);
    if (workingMs === 0) return start;
    if (workingMs < 0) return subtractWorkingTime(start, -workingMs);
    let remaining = workingMs;
    let result = start;
    scan(start, 1, ([intervalStart, intervalEnd]) => {
      if (intervalEnd <= start) return false;
      const from = Math.max(intervalStart, start);
      if (intervalEnd - from >= remaining) {
        result = from + remaining;
        return true;
      }
      remaining -= intervalEnd - from;
      return false;
    });
    return result;
  };

  const subtractWorkingTime = (end: number, workingMs: number): number => {
    assertFinite(end, workingMs);
    if (workingMs === 0) return end;
    if (workingMs < 0) return addWorkingTime(end, -workingMs);
    let remaining = workingMs;
    let result = end;
    scan(end, -1, ([intervalStart, intervalEnd]) => {
      if (intervalStart >= end) return false;
      const to = Math.min(intervalEnd, end);
      if (to - intervalStart >= remaining) {
        result = to - remaining;
        return true;
      }
      remaining -= to - intervalStart;
      return false;
    });
    return result;
  };

  const workingIntervals = (from: number, to: number): Interval[] => {
    assertFinite(from, to);
    const result: Interval[] = [];
    for (let day = wallDay(from, zone), last = wallDay(to, zone); day <= last; day++) {
      for (const [start, end] of intervalsOnDay(day)) {
        const clippedStart = Math.max(start, from);
        const clippedEnd = Math.min(end, to);
        if (clippedEnd > clippedStart) result.push([clippedStart, clippedEnd]);
      }
    }
    return result;
  };

  const workingTimeBetween = (from: number, to: number): number => {
    if (to < from) return -workingTimeBetween(to, from);
    return workingIntervals(from, to).reduce((total, [start, end]) => total + end - start, 0);
  };

  return {
    calendarId: calendar.id,
    timeZone: zone,

    isWorking: (time) =>
      Number.isFinite(time) &&
      intervalsOnDay(wallDay(time, zone)).some(([start, end]) => start <= time && time < end),

    nextWorkingTime(time) {
      assertFinite(time);
      let result = time;
      scan(time, 1, ([start, end]) => {
        if (end <= time) return false;
        result = Math.max(start, time);
        return true;
      });
      return result;
    },

    previousWorkingTime(time) {
      assertFinite(time);
      let result = time;
      scan(time, -1, ([start, end]) => {
        if (start >= time) return false;
        result = Math.min(end, time);
        return true;
      });
      return result;
    },

    addWorkingTime,
    subtractWorkingTime,

    workingTimeBetween,
    workingIntervals,
  };
}
