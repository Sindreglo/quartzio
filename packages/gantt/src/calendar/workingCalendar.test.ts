import { describe, expect, it } from 'vitest';
import { createProjectState, STANDARD_CALENDAR } from '../data/normalize';
import type { Calendar, CalendarInput } from '../data/types';
import { QuartzioError } from '../util/errors';
import { fromWallTime, toWallTime, type TimeZone } from '../util/zone';
import { durationToWorkingMs, workingMsToDuration } from './duration';
import { getWorkingCalendar } from './project';
import { createWorkingCalendar } from './workingCalendar';

const H = 3_600_000;
const OSLO = 'Europe/Oslo';

/** Wall time in Oslo, e.g. at(2026, 10, 5, 8) = Monday 5 October 2026 08:00. */
const at = (year: number, month: number, day: number, hour = 0, minute = 0, zone: TimeZone = OSLO) =>
  fromWallTime({ year, month, day, hour, minute }, zone);

const wall = (time: number, zone: TimeZone = OSLO) => {
  const { year, month, day, hour, minute } = toWallTime(time, zone);
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const calendarFrom = (input: Omit<CalendarInput, 'id'>): Calendar => {
  const state = createProjectState({ calendars: [{ id: 'c', ...input }] });
  return state.calendars.byId.get('c') as Calendar;
};

const standard = createWorkingCalendar(STANDARD_CALENDAR, OSLO);

/** Working intervals on one wall-clock day in Oslo. */
const onDay = (
  calendar: ReturnType<typeof createWorkingCalendar>,
  year: number,
  month: number,
  day: number,
) => calendar.workingIntervals(at(year, month, day), at(year, month, day + 1));

describe('createWorkingCalendar (standard Mon–Fri 08:00–16:00)', () => {
  it('knows working and non-working time', () => {
    expect(standard.isWorking(at(2026, 10, 5, 8))).toBe(true); // Monday 08:00
    expect(standard.isWorking(at(2026, 10, 5, 16))).toBe(false); // end is exclusive
    expect(standard.isWorking(at(2026, 10, 10, 10))).toBe(false); // Saturday
  });

  it.each([
    [
      'Mon 08:00 + 8h ends at the end of the day, not the next morning',
      at(2026, 10, 5, 8),
      8,
      '2026-10-05 16:00',
    ],
    ['Fri 12:00 + 1 day skips the weekend', at(2026, 10, 9, 12), 8, '2026-10-12 12:00'],
    ['Sat 10:00 + 1h starts on Monday', at(2026, 10, 10, 10), 1, '2026-10-12 09:00'],
    ['Mon 08:00 + 3 days', at(2026, 10, 5, 8), 24, '2026-10-07 16:00'],
    ['Mon 15:00 + 2h continues next morning', at(2026, 10, 5, 15), 2, '2026-10-06 09:00'],
  ])('addWorkingTime: %s', (_, start, hours, expected) => {
    expect(wall(standard.addWorkingTime(start, hours * H))).toBe(expected);
  });

  it.each([
    ['Mon 12:00 − 1 day goes back over the weekend', at(2026, 10, 12, 12), 8, '2026-10-09 12:00'],
    ['Tue 16:00 − 8h starts at the start of the day', at(2026, 10, 6, 16), 8, '2026-10-06 08:00'],
    ['Mon 00:00 − 1h ends on Friday', at(2026, 10, 12), 1, '2026-10-09 15:00'],
  ])('subtractWorkingTime: %s', (_, end, hours, expected) => {
    expect(wall(standard.subtractWorkingTime(end, hours * H))).toBe(expected);
  });

  it('finds the next and previous working time', () => {
    expect(wall(standard.nextWorkingTime(at(2026, 10, 10, 10)))).toBe('2026-10-12 08:00');
    expect(wall(standard.nextWorkingTime(at(2026, 10, 5, 9)))).toBe('2026-10-05 09:00');
    expect(wall(standard.previousWorkingTime(at(2026, 10, 10, 10)))).toBe('2026-10-09 16:00');
  });

  it('lists working intervals in a range, clipped to it', () => {
    expect(standard.workingIntervals(at(2026, 10, 9, 12), at(2026, 10, 12, 10))).toEqual([
      [at(2026, 10, 9, 12), at(2026, 10, 9, 16)],
      [at(2026, 10, 12, 8), at(2026, 10, 12, 10)],
    ]);
  });

  it('measures working time between two instants', () => {
    expect(standard.workingTimeBetween(at(2026, 10, 9, 12), at(2026, 10, 12, 12))).toBe(8 * H);
    expect(standard.workingTimeBetween(at(2026, 10, 12, 12), at(2026, 10, 9, 12))).toBe(-8 * H);
    expect(standard.workingTimeBetween(at(2026, 10, 5), at(2026, 10, 12))).toBe(40 * H);
  });

  it('is consistent: add, subtract and measure agree for many starts and durations', () => {
    for (let start = at(2026, 10, 1); start < at(2026, 10, 15); start += 5 * H + 17 * 60_000) {
      for (const hours of [0.5, 1, 7.25, 8, 20, 41]) {
        const end = standard.addWorkingTime(start, hours * H);
        expect(standard.workingTimeBetween(start, end)).toBe(hours * H);
        expect(standard.subtractWorkingTime(end, hours * H)).toBe(standard.nextWorkingTime(start));
      }
    }
  });
});

describe('exceptions', () => {
  it('skips holidays', () => {
    const calendar = createWorkingCalendar(
      calendarFrom({ exceptions: [{ startDate: '2026-10-07', name: 'Holiday' }] }),
      OSLO,
    );
    expect(wall(calendar.addWorkingTime(at(2026, 10, 5, 8), 24 * H))).toBe('2026-10-08 16:00');
  });

  it('lets later exceptions override earlier ones', () => {
    const calendar = createWorkingCalendar(
      calendarFrom({
        exceptions: [
          { startDate: '2026-10-05', endDate: '2026-10-11', name: 'Vacation' },
          {
            startDate: '2026-10-08',
            name: 'Back for a meeting',
            intervals: [{ start: '10:00', end: '12:00' }],
          },
        ],
      }),
      OSLO,
    );
    expect(onDay(calendar, 2026, 10, 7)).toEqual([]);
    expect(onDay(calendar, 2026, 10, 8)).toEqual([[at(2026, 10, 8, 10), at(2026, 10, 8, 12)]]);
    expect(wall(calendar.addWorkingTime(at(2026, 10, 5, 8), 3 * H))).toBe('2026-10-12 09:00');
  });

  it('can add working time on a weekend', () => {
    const calendar = createWorkingCalendar(
      calendarFrom({
        exceptions: [{ startDate: '2026-10-10', intervals: [{ start: '08:00', end: '12:00' }] }],
      }),
      OSLO,
    );
    expect(wall(calendar.addWorkingTime(at(2026, 10, 9, 14), 4 * H))).toBe('2026-10-10 10:00');
  });
});

describe('time zones and DST', () => {
  const allDay = createWorkingCalendar(
    calendarFrom({
      week: Object.fromEntries(
        ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((day) => [
          day,
          [{ start: '00:00', end: '24:00' }],
        ]),
      ),
    }),
    OSLO,
  );

  it('has 23 working hours on spring-forward day and 25 on fall-back day (24/7 calendar)', () => {
    expect(allDay.workingTimeBetween(at(2026, 3, 29), at(2026, 3, 30))).toBe(23 * H);
    expect(allDay.workingTimeBetween(at(2026, 10, 25), at(2026, 10, 26))).toBe(25 * H);
  });

  it('keeps office hours on the wall clock across a DST change', () => {
    // Friday before spring-forward + 1 day: Monday 12:00 wall time, one hour less in real time.
    const start = at(2026, 3, 27, 12);
    const end = standard.addWorkingTime(start, 8 * H);
    expect(wall(end)).toBe('2026-03-30 12:00');
    expect(end - start).toBe(3 * 24 * H - H);
  });

  it('drops working intervals that fall entirely in a DST gap', () => {
    const calendar = createWorkingCalendar(
      calendarFrom({ week: { sunday: [{ start: '02:00', end: '03:00' }] } }),
      OSLO,
    );
    expect(onDay(calendar, 2026, 3, 29)).toEqual([]);
    expect(onDay(calendar, 2026, 3, 22)).toHaveLength(1);
  });

  it('interprets working hours in the calendar time zone', () => {
    const newYork = createWorkingCalendar(STANDARD_CALENDAR, 'America/New_York');
    const mondayMorningOslo = at(2026, 10, 5, 9); // 03:00 in New York
    expect(standard.isWorking(mondayMorningOslo)).toBe(true);
    expect(newYork.isWorking(mondayMorningOslo)).toBe(false);
    expect(wall(newYork.nextWorkingTime(mondayMorningOslo), 'America/New_York')).toBe('2026-10-05 08:00');
  });
});

describe('calendars without working time', () => {
  it('throws instead of looping forever', () => {
    const empty = createWorkingCalendar(calendarFrom({ week: {} }), OSLO);
    expect(() => empty.addWorkingTime(at(2026, 10, 5), H)).toThrow(QuartzioError);
    expect(() => empty.nextWorkingTime(at(2026, 10, 5))).toThrow(/no working time/);
  });

  it('works with only exceptions', () => {
    const calendar = createWorkingCalendar(
      calendarFrom({
        week: {},
        exceptions: [{ startDate: '2026-12-01', intervals: [{ start: '08:00', end: '16:00' }] }],
      }),
      OSLO,
    );
    expect(wall(calendar.nextWorkingTime(at(2026, 10, 5)))).toBe('2026-12-01 08:00');
  });
});

describe('durations', () => {
  const settings = { hoursPerDay: 8, daysPerWeek: 5, daysPerMonth: 20 };

  it('converts units to working time', () => {
    expect(durationToWorkingMs(1, 'day', settings)).toBe(8 * H);
    expect(durationToWorkingMs(2, 'week', settings)).toBe(80 * H);
    expect(durationToWorkingMs(1, 'month', settings)).toBe(160 * H);
    expect(durationToWorkingMs(90, 'minute', settings)).toBe(1.5 * H);
    expect(workingMsToDuration(12 * H, 'day', settings)).toBe(1.5);
  });
});

describe('getWorkingCalendar', () => {
  it('uses the standard calendar and project time zone by default', () => {
    const state = createProjectState({ settings: { timeZone: 'America/New_York' } });
    const calendar = getWorkingCalendar(state);
    expect(calendar.calendarId).toBe('standard');
    expect(calendar.timeZone).toBe('America/New_York');
    expect(getWorkingCalendar(state)).toBe(calendar);
  });

  it('uses the project calendar', () => {
    const state = createProjectState({
      settings: { calendarId: 'short', timeZone: OSLO },
      calendars: [{ id: 'short', week: { monday: [{ start: '09:00', end: '12:00' }] } }],
    });
    expect(wall(getWorkingCalendar(state).addWorkingTime(at(2026, 10, 5, 9), 4 * H))).toBe(
      '2026-10-12 10:00',
    );
  });

  it('throws for unknown calendars', () => {
    expect(() => getWorkingCalendar(createProjectState(), 'nope')).toThrow(/does not exist/);
  });
});

describe('review regressions', () => {
  it('never counts working time twice when an interval ends inside a DST gap', () => {
    const calendar = createWorkingCalendar(
      calendarFrom({
        week: {
          sunday: [
            { start: '00:00', end: '02:30' },
            { start: '03:00', end: '06:00' },
          ],
        },
      }),
      OSLO,
    );
    // 00:00–02:00 (the clock jumps to 03:00) + 03:00–06:00 = 5 real hours.
    expect(calendar.workingTimeBetween(at(2026, 3, 29), at(2026, 3, 30))).toBe(5 * H);
    const [first, second] = onDay(calendar, 2026, 3, 29);
    expect(first?.[1]).toBeLessThanOrEqual(second?.[0] ?? 0);
  });

  it('collapses an interval that lies inside a DST gap', () => {
    const calendar = createWorkingCalendar(
      calendarFrom({ week: { sunday: [{ start: '02:15', end: '02:45' }] } }),
      OSLO,
    );
    expect(onDay(calendar, 2026, 3, 29)).toEqual([]);
  });

  it('rejects NaN and Infinity instead of looping forever', () => {
    expect(() => standard.addWorkingTime(Number.NaN, H)).toThrow(QuartzioError);
    expect(() => standard.addWorkingTime(at(2026, 10, 5), Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => standard.subtractWorkingTime(at(2026, 10, 5), Number.NaN)).toThrow(/finite/);
    expect(() => standard.workingTimeBetween(at(2026, 10, 5), Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => standard.nextWorkingTime(Number.NaN)).toThrow(/finite/);
    expect(standard.isWorking(Number.NaN)).toBe(false);
  });

  it('handles very long exceptions without expanding them per day', () => {
    const calendar = createWorkingCalendar(
      calendarFrom({
        exceptions: [
          { startDate: '0001-01-01', endDate: '9999-12-31', intervals: [{ start: '10:00', end: '11:00' }] },
        ],
      }),
      OSLO,
    );
    expect(wall(calendar.addWorkingTime(at(2026, 10, 5, 10), 2 * H))).toBe('2026-10-06 11:00');
  });

  it('refuses calculations spanning more than ~25 years (likely typos) instead of freezing', () => {
    expect(() => standard.addWorkingTime(at(2026, 10, 5, 8), 30 * 260 * 8 * H)).toThrow(/25 years/);
    expect(() => standard.workingTimeBetween(at(2026, 1, 1), at(2060, 1, 1))).toThrow(/25 years/);
    expect(standard.workingTimeBetween(at(2026, 1, 1), at(2046, 1, 1))).toBeGreaterThan(0);
  });
});
