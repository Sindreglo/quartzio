import { describe, expect, it } from 'vitest';
import { QuartzioError } from '../util/errors';
import { fromWallTime, toWallTime } from '../util/zone';
import { alignToUnit } from './align';
import { resolvePreset, VIEW_PRESETS, type ViewPreset } from './presets';
import { createTimeAxis, type TimeAxisOptions } from './timeAxis';

const H = 3_600_000;
const OSLO = 'Europe/Oslo';
const at = (year: number, month: number, day: number, hour = 0) =>
  fromWallTime({ year, month, day, hour }, OSLO);

const axis = (
  preset: string | ViewPreset,
  start: number,
  end: number,
  extra: Partial<TimeAxisOptions> = {},
) =>
  createTimeAxis({
    start,
    end,
    preset: resolvePreset(preset),
    timeZone: OSLO,
    weekStartsOn: 1,
    locale: 'en-US',
    ...extra,
  });

describe('ticks', () => {
  it('widens the range to whole ticks', () => {
    const weeks = axis('weekAndMonth', at(2026, 10, 7, 13), at(2026, 10, 20));
    expect(weeks.start).toBe(at(2026, 10, 5)); // Monday
    expect(weeks.end).toBe(at(2026, 10, 26));
    expect(weeks.tickCount).toBe(3);
    expect(weeks.totalWidth).toBe(3 * 56);
  });

  it('has 23 hour ticks on spring-forward day, all the same width', () => {
    const hours = axis('hourAndDay', at(2026, 3, 29), at(2026, 3, 30));
    expect(hours.tickCount).toBe(23);
    expect(hours.ticksInRange(0, hours.totalWidth).every((tick) => tick.end - tick.start === H)).toBe(true);
  });

  it('gives every month the same width', () => {
    const months = axis('monthAndYear', at(2026, 1, 1), at(2027, 1, 1));
    expect(months.tickCount).toBe(12);
    expect(months.dateToX(at(2026, 3, 1)) - months.dateToX(at(2026, 2, 1))).toBe(72); // February (28 days)
    expect(months.dateToX(at(2026, 4, 1)) - months.dateToX(at(2026, 3, 1))).toBe(72); // March (31 days)
  });

  it('refuses absurd tick counts', () => {
    expect(() => axis('hourAndDay', at(2000, 1, 1), at(2100, 1, 1))).toThrow(QuartzioError);
  });
});

describe('dateToX / xToDate', () => {
  const days = axis('weekAndDay', at(2026, 10, 5), at(2026, 11, 2));

  it('is linear within a tick', () => {
    expect(days.dateToX(at(2026, 10, 5))).toBe(0);
    expect(days.dateToX(at(2026, 10, 6, 12))).toBe(32 + 16);
  });

  it('round-trips', () => {
    for (let time = days.start; time < days.end; time += 5 * H + 123_456) {
      expect(days.xToDate(days.dateToX(time))).toBe(time);
    }
  });

  it('extrapolates outside the axis', () => {
    expect(days.dateToX(at(2026, 10, 4))).toBe(-32);
    expect(days.dateToX(at(2026, 11, 3))).toBe(days.totalWidth + 32);
    expect(days.xToDate(-32)).toBe(at(2026, 10, 4));
  });

  it('keeps a 25-hour DST day as wide as any other day', () => {
    const autumn = axis('weekAndDay', at(2026, 10, 19), at(2026, 11, 2));
    const fallBack = autumn.dateToX(at(2026, 10, 26)) - autumn.dateToX(at(2026, 10, 25));
    expect(fallBack).toBe(32);
  });
});

describe('header cells', () => {
  it('labels cells in the locale and time zone', () => {
    const days = axis('weekAndDay', at(2026, 10, 5), at(2026, 10, 19));
    const [month, week, day] = [0, 1, 2].map((row) => days.headerCells(row, 0, days.totalWidth));
    expect(month?.map((cell) => cell.label)).toEqual(['October 2026']);
    expect(week?.map((cell) => cell.label)).toEqual(['W41', 'W42']);
    expect(day?.slice(0, 3).map((cell) => cell.label)).toEqual(['M', 'T', 'W']);

    const norwegian = axis('weekAndDay', at(2026, 10, 5), at(2026, 10, 19), { locale: 'nb-NO' });
    expect(norwegian.headerCells(0, 0, 10)[0]?.label).toBe('oktober 2026');
  });

  it('clips cells to the axis and keeps their full span', () => {
    const days = axis('weekAndDay', at(2026, 10, 14), at(2026, 10, 21));
    const [month] = days.headerCells(0, 0, days.totalWidth);
    expect(month).toMatchObject({
      start: at(2026, 10, 1),
      end: at(2026, 11, 1),
      x: 0,
      width: days.totalWidth,
    });
  });

  it('only creates the cells in view (virtualization)', () => {
    const days = axis('weekAndDay', at(2026, 1, 1), at(2027, 1, 1));
    const visible = days.headerCells(2, 32 * 100, 32 * 110);
    expect(visible).toHaveLength(10);
    expect(visible[0]?.x).toBe(32 * 100);
  });

  it('aligns multi-unit cells to natural boundaries', () => {
    const years = axis('manyYears', at(2023, 1, 1), at(2036, 1, 1));
    expect(years.headerCells(0, 0, years.totalWidth).map((cell) => cell.label)).toEqual([
      '2020',
      '2025',
      '2030',
      '2035',
    ]);
    expect(years.headerCells(0, 0, years.totalWidth)[0]?.x).toBe(0); // clipped at 2023
  });

  it('formats quarters', () => {
    const quarters = axis('quarterAndYear', at(2026, 1, 1), at(2027, 1, 1));
    expect(quarters.headerCells(1, 0, quarters.totalWidth).map((cell) => cell.label)).toEqual([
      'Q1',
      'Q2',
      'Q3',
      'Q4',
    ]);
  });

  it('supports custom label functions', () => {
    const preset: ViewPreset = {
      ...resolvePreset('weekAndMonth'),
      id: 'custom',
      headers: [
        { unit: 'week', format: (cell) => `Uke ${String(toWallTime(cell.start, cell.timeZone).day)}` },
      ],
    };
    expect(axis(preset, at(2026, 10, 5), at(2026, 10, 12)).headerCells(0, 0, 56)[0]?.label).toBe('Uke 5');
  });
});

describe('alignment and snapping', () => {
  it('aligns increments to natural boundaries', () => {
    expect(alignToUnit(at(2026, 10, 5, 13), 'hour', 6, OSLO, 1)).toBe(at(2026, 10, 5, 12));
    expect(alignToUnit(at(2026, 11, 20), 'month', 3, OSLO, 1)).toBe(at(2026, 10, 1));
    expect(alignToUnit(at(2027, 6, 1), 'year', 5, OSLO, 1)).toBe(at(2025, 1, 1));
  });

  it('snaps to the nearest time resolution boundary', () => {
    const hours = axis('hourAndDay', at(2026, 10, 5), at(2026, 10, 6));
    expect(hours.snap(at(2026, 10, 5, 8) + 7 * 60_000)).toBe(at(2026, 10, 5, 8)); // 08:07 → 08:00
    expect(hours.snap(at(2026, 10, 5, 8) + 8 * 60_000)).toBe(at(2026, 10, 5, 8) + 15 * 60_000); // 08:08 → 08:15
  });
});

describe('presets', () => {
  it('has built-ins from zoomed in to zoomed out', () => {
    expect(VIEW_PRESETS.map((preset) => preset.id)).toEqual([
      'hourAndDay',
      'dayAndWeek',
      'weekAndDay',
      'weekAndMonth',
      'monthAndYear',
      'quarterAndYear',
      'manyYears',
    ]);
  });

  it('builds a valid axis for every built-in preset', () => {
    for (const preset of VIEW_PRESETS) {
      const built = axis(preset.id, at(2026, 1, 1), at(2026, 3, 1));
      for (let row = 0; row < preset.headers.length; row++) {
        const cells = built.headerCells(row, 0, built.totalWidth);
        expect(cells.length).toBeGreaterThan(0);
        expect(cells.every((cell) => cell.label !== '' && cell.width > 0)).toBe(true);
      }
    }
  });

  it('rejects unknown and invalid presets', () => {
    expect(() => resolvePreset('nope')).toThrow(/Unknown view preset/);
    expect(() => resolvePreset({ ...resolvePreset('weekAndDay'), tickWidth: 0 })).toThrow(/tickWidth/);
  });
});

describe('review regressions', () => {
  it('keeps day ticks at midnight after a DST change that skips midnight (Cairo)', () => {
    const cairo = (month: number, day: number) => fromWallTime({ year: 2023, month, day }, 'Africa/Cairo');
    const days = axis('weekAndDay', cairo(4, 26), cairo(5, 3), { timeZone: 'Africa/Cairo' });
    const starts = days
      .ticksInRange(0, days.totalWidth)
      .map((tick) => toWallTime(tick.start, 'Africa/Cairo').hour);
    // 28 April starts at 01:00 (00:00 doesn't exist); every other day at 00:00.
    expect(starts).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });

  it('returns the same header cells whatever window is asked for, also across DST', () => {
    const preset: ViewPreset = {
      ...resolvePreset('hourAndDay'),
      id: 'six-hours',
      headers: [{ unit: 'hour', increment: 6, format: 'hour' }],
    };
    const hours = axis(preset, at(2026, 3, 28), at(2026, 3, 31), { locale: 'nb-NO' });
    const all = hours.headerCells(0, 0, hours.totalWidth);
    expect(all.slice(0, 8).map((cell) => cell.label)).toEqual([
      '00',
      '06',
      '12',
      '18',
      '00',
      '06',
      '12',
      '18',
    ]);
    for (const from of [100, 600, 1234]) {
      for (const cell of hours.headerCells(0, from, from + 500)) {
        expect(all).toContainEqual(cell);
      }
    }
  });

  it('rejects increments that do not divide the next unit, and other invalid presets', () => {
    const base = resolvePreset('weekAndDay');
    const invalid: unknown[] = [
      { ...base, headers: [] },
      { ...base, headers: [{ unit: 'hour', increment: 5, format: 'hour' }] },
      { ...base, headers: [{ unit: 'month', increment: 5, format: 'month' }] },
      { ...base, tickUnit: 'fortnight' },
      { ...base, headers: [{ unit: 'eon', format: 'year' }] },
      { ...base, headers: [{ unit: 'day', format: 'nope' }] },
      { ...base, timeResolution: { unit: 'day', increment: 0 } },
      { ...base, timeResolution: { unit: 'day', increment: 1.5 } },
      { ...base, tickWidth: Number.NaN },
      { ...base, id: '' },
    ];
    for (const preset of invalid) expect(() => resolvePreset(preset as ViewPreset)).toThrow(QuartzioError);
  });

  it('fills a minimum width tick by tick, even when the next tick is longer', () => {
    const months = axis('monthAndYear', at(2026, 1, 1), at(2026, 2, 1), { minWidth: 219.6 });
    expect(months.totalWidth).toBeGreaterThanOrEqual(219.6);
    expect(months.tickCount).toBe(4);
  });

  it('can cut an oversized range short instead of throwing', () => {
    const hours = axis('hourAndDay', at(2000, 1, 1), at(2100, 1, 1), { truncate: true });
    expect(hours.tickCount).toBe(200_000);
  });

  it('labels Sunday-based weeks with the ISO number of their Monday', () => {
    const weeks = axis('weekAndMonth', at(2026, 10, 4), at(2026, 10, 11), { weekStartsOn: 0 });
    expect(weeks.start).toBe(at(2026, 10, 4)); // Sunday
    expect(weeks.headerCells(1, 0, weeks.totalWidth)[0]?.label).toBe('W41');
  });

  it('leaves the label empty when a custom format throws', () => {
    const preset: ViewPreset = {
      ...resolvePreset('weekAndMonth'),
      id: 'broken',
      headers: [
        {
          unit: 'week',
          format: () => {
            throw new Error('bug');
          },
        },
      ],
    };
    expect(axis(preset, at(2026, 10, 5), at(2026, 10, 12)).headerCells(0, 0, 56)[0]?.label).toBe('');
  });
});
