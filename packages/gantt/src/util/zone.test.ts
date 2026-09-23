import { describe, expect, it } from 'vitest';
import { civilFromDays, daysFromCivil, weekdayFromDays } from './civil';
import { parseCivilDate, parseDateString, parseTimeOfDay } from './parse';
import {
  addUnits,
  fromWallTime,
  isoWeek,
  isValidTimeZone,
  startOfDay,
  startOfUnit,
  toWallTime,
  wallDay,
  zoneOffset,
} from './zone';

const H = 3_600_000;
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const OSLO = 'Europe/Oslo';
const NEW_YORK = 'America/New_York';

describe('civil dates', () => {
  it('round-trips day numbers and knows weekdays', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(civilFromDays(daysFromCivil(2026, 2, 28) + 1)).toEqual({ year: 2026, month: 3, day: 1 });
    expect(civilFromDays(daysFromCivil(2028, 2, 28) + 1)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(weekdayFromDays(daysFromCivil(2026, 10, 5))).toBe(1); // Monday
    expect(weekdayFromDays(daysFromCivil(1969, 12, 28))).toBe(0); // Sunday, before the epoch
  });

  it('handles years below 100', () => {
    expect(civilFromDays(daysFromCivil(50, 6, 15))).toEqual({ year: 50, month: 6, day: 15 });
  });
});

describe('zoneOffset', () => {
  it('knows standard and daylight time', () => {
    expect(zoneOffset(utc(2026, 1, 15), OSLO)).toBe(1 * H);
    expect(zoneOffset(utc(2026, 7, 15), OSLO)).toBe(2 * H);
    expect(zoneOffset(utc(2026, 1, 15), NEW_YORK)).toBe(-5 * H);
    expect(zoneOffset(utc(2026, 7, 15), 'Asia/Kolkata')).toBe(5.5 * H);
    expect(zoneOffset(utc(2026, 7, 15), 'UTC')).toBe(0);
  });

  it('switches exactly at the transition instant', () => {
    // Oslo springs forward at 01:00 UTC on 2026-03-29.
    expect(zoneOffset(utc(2026, 3, 29, 1) - 1, OSLO)).toBe(1 * H);
    expect(zoneOffset(utc(2026, 3, 29, 1), OSLO)).toBe(2 * H);
  });

  it('matches the host for "local"', () => {
    const time = utc(2026, 7, 15, 12);
    expect(zoneOffset(time, 'local')).toBe(-new Date(time).getTimezoneOffset() * 60_000);
  });

  it('validates zone names', () => {
    expect(isValidTimeZone('Europe/Oslo')).toBe(true);
    expect(isValidTimeZone('local')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('wall time', () => {
  it('converts both ways', () => {
    const time = utc(2026, 10, 5, 6); // 08:00 in Oslo (CEST)
    expect(toWallTime(time, OSLO)).toMatchObject({
      year: 2026,
      month: 10,
      day: 5,
      hour: 8,
      minute: 0,
      weekday: 1,
    });
    expect(fromWallTime({ year: 2026, month: 10, day: 5, hour: 8 }, OSLO)).toBe(time);
  });

  it('moves times skipped by spring-forward past the gap', () => {
    // 02:30 does not exist in Oslo on 2026-03-29; it becomes 03:30 CEST = 01:30 UTC.
    expect(fromWallTime({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, OSLO)).toBe(
      utc(2026, 3, 29, 1, 30),
    );
    // Same in New York (08 March 2026): 02:30 → 03:30 EDT = 07:30 UTC.
    expect(fromWallTime({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NEW_YORK)).toBe(
      utc(2026, 3, 8, 7, 30),
    );
  });

  it('picks the first occurrence of times repeated by fall-back', () => {
    // 02:30 happens twice in Oslo on 2026-10-25; the first is still CEST (00:30 UTC).
    expect(fromWallTime({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, OSLO)).toBe(
      utc(2026, 10, 25, 0, 30),
    );
  });

  it('finds the wall day and start of day in the zone', () => {
    const lateEvening = utc(2026, 10, 5, 23); // already 6 October in Oslo
    expect(civilFromDays(wallDay(lateEvening, OSLO))).toEqual({ year: 2026, month: 10, day: 6 });
    expect(startOfDay(lateEvening, OSLO)).toBe(utc(2026, 10, 5, 22));
    expect(startOfDay(lateEvening, 'UTC')).toBe(utc(2026, 10, 5));
  });
});

describe('startOfUnit', () => {
  const time = utc(2026, 10, 7, 13, 45); // Wednesday 15:45 in Oslo
  it.each([
    ['hour', utc(2026, 10, 7, 13)],
    ['day', utc(2026, 10, 6, 22)],
    ['week', utc(2026, 10, 4, 22)], // Monday 5 October
    ['month', utc(2026, 9, 30, 22)],
    ['quarter', utc(2026, 9, 30, 22)],
    ['year', utc(2025, 12, 31, 23)],
  ] as const)('%s', (unit, expected) => {
    expect(startOfUnit(time, unit, OSLO)).toBe(expected);
  });

  it('respects weekStartsOn', () => {
    expect(startOfUnit(time, 'week', OSLO, 0)).toBe(utc(2026, 10, 3, 22)); // Sunday 4 October
  });
});

describe('addUnits', () => {
  it('keeps the time of day when adding days across DST', () => {
    const before = fromWallTime({ year: 2026, month: 3, day: 28, hour: 9 }, OSLO);
    const after = addUnits(before, 1, 'day', OSLO);
    expect(after - before).toBe(23 * H);
    expect(toWallTime(after, OSLO)).toMatchObject({ day: 29, hour: 9 });
  });

  it('adds hours as exact durations', () => {
    const before = fromWallTime({ year: 2026, month: 3, day: 29, hour: 1 }, OSLO);
    expect(toWallTime(addUnits(before, 2, 'hour', OSLO), OSLO).hour).toBe(4); // 02:00–03:00 doesn't exist
  });

  it('clamps month arithmetic to the last day of the month', () => {
    const jan31 = fromWallTime({ year: 2026, month: 1, day: 31, hour: 8 }, OSLO);
    expect(toWallTime(addUnits(jan31, 1, 'month', OSLO), OSLO)).toMatchObject({ month: 2, day: 28, hour: 8 });
    expect(toWallTime(addUnits(jan31, -2, 'month', OSLO), OSLO)).toMatchObject({
      year: 2025,
      month: 11,
      day: 30,
    });
    expect(toWallTime(addUnits(jan31, 1, 'year', OSLO), OSLO)).toMatchObject({
      year: 2027,
      month: 1,
      day: 31,
    });
  });
});

describe('isoWeek', () => {
  it.each([
    [utc(2026, 1, 1), 2026, 1], // Thursday
    [utc(2027, 1, 1), 2026, 53], // Friday → last week of 2026
    [utc(2024, 12, 30), 2025, 1], // Monday → first week of 2025
    [utc(2026, 10, 5), 2026, 41],
  ])('%#', (time, year, week) => {
    expect(isoWeek(time, 'UTC')).toEqual({ year, week });
  });
});

describe('parsing', () => {
  it('reads dates without an offset as wall time in the zone', () => {
    expect(parseDateString('2026-10-05', OSLO)).toBe(utc(2026, 10, 4, 22));
    expect(parseDateString('2026-10-05T08:30', OSLO)).toBe(utc(2026, 10, 5, 6, 30));
    expect(parseDateString('2026-10-05 08:30:15.5', 'UTC')).toBe(utc(2026, 10, 5, 8, 30) + 15_500);
  });

  it('reads dates with an offset as absolute instants', () => {
    expect(parseDateString('2026-10-05T08:00Z', OSLO)).toBe(utc(2026, 10, 5, 8));
    expect(parseDateString('2026-10-05T08:00+02:00', NEW_YORK)).toBe(utc(2026, 10, 5, 6));
    expect(parseDateString('2026-10-05T08:00-0530', 'UTC')).toBe(utc(2026, 10, 5, 13, 30));
  });

  it.each(['2026-02-30', '2026-13-01', '05.10.2026', '2026-10-05T25:00', 'tomorrow', ''])(
    'rejects %j',
    (value) => {
      expect(parseDateString(value, 'UTC')).toBeNull();
    },
  );

  it('parses civil dates and times of day', () => {
    expect(parseCivilDate('2026-10-05')).toBe(daysFromCivil(2026, 10, 5));
    expect(parseCivilDate('2026-10-5')).toBeNull();
    expect(parseTimeOfDay('08:30')).toBe(510);
    expect(parseTimeOfDay('24:00')).toBe(1440);
    expect(parseTimeOfDay('24:30')).toBeNull();
    expect(parseTimeOfDay('8:30')).toBeNull();
  });
});

describe('review regressions', () => {
  const secondOccurrence = utc(2026, 10, 25, 1, 30); // 02:30 CET, after the clocks went back in Oslo

  it('keeps the second occurrence of a repeated hour', () => {
    expect(toWallTime(secondOccurrence, OSLO)).toMatchObject({ hour: 2, minute: 30 });
    expect(startOfUnit(secondOccurrence, 'minute', OSLO)).toBe(secondOccurrence);
    expect(startOfUnit(secondOccurrence, 'hour', OSLO)).toBe(utc(2026, 10, 25, 1));
    expect(addUnits(secondOccurrence, 0, 'day', OSLO)).toBe(secondOccurrence);
    expect(addUnits(secondOccurrence, 1, 'day', OSLO)).toBe(utc(2026, 10, 26, 1, 30));
  });

  it('handles the southern hemisphere and 30-minute DST', () => {
    // Sydney springs forward on 2026-10-04 at 02:00 (AEST +10 → AEDT +11).
    expect(fromWallTime({ year: 2026, month: 10, day: 4, hour: 2, minute: 30 }, 'Australia/Sydney')).toBe(
      utc(2026, 10, 3, 16, 30),
    );
    // Lord Howe falls back by only 30 minutes (+11 → +10:30) on 2026-04-05 at 02:00.
    const repeated = utc(2026, 4, 4, 15, 15); // second 01:45
    expect(toWallTime(repeated, 'Australia/Lord_Howe')).toMatchObject({ hour: 1, minute: 45 });
    expect(startOfUnit(repeated, 'minute', 'Australia/Lord_Howe')).toBe(repeated);
  });

  it('gets offsets right just after transitions that are not on a quarter hour', () => {
    // St. John's fell back at 00:01 local on 2010-11-07 (02:31 UTC): NDT −2:30 → NST −3:30.
    expect(zoneOffset(utc(2010, 11, 7, 2, 40), 'America/St_Johns')).toBe(-3.5 * H);
    expect(zoneOffset(utc(2010, 11, 7, 2, 20), 'America/St_Johns')).toBe(-2.5 * H);
  });

  it('only adds whole days, weeks and months', () => {
    expect(() => addUnits(utc(2026, 10, 5), 0.5, 'day', OSLO)).toThrow(/whole number/);
  });

  it('validates offsets and accepts long fractions', () => {
    expect(parseDateString('2026-10-05T08:00+02:99', 'UTC')).toBeNull();
    expect(parseDateString('2026-10-05T08:00+99:00', 'UTC')).toBeNull();
    expect(parseDateString('2026-10-05Z', 'UTC')).toBeNull();
    expect(parseDateString('2026-10-05T08:00:00.1234567Z', 'UTC')).toBe(utc(2026, 10, 5, 8) + 123);
    expect(parseDateString('2026-10-05T08:00+14:00', 'UTC')).toBe(utc(2026, 10, 4, 18));
  });
});
