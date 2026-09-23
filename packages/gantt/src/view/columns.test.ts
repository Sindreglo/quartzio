import { describe, expect, it } from 'vitest';
import { QuartzioError } from '../util/errors';
import { formatDuration, formatEndDate, formatPercent } from './cells';
import { resolveColumns, type ColumnInput } from './columns';

describe('resolveColumns', () => {
  it('defaults to name, start, end and duration, laid out left to right', () => {
    const { state } = resolveColumns();
    expect(state.items.map((column) => [column.id, column.x, column.width])).toEqual([
      ['name', 0, 240],
      ['startDate', 240, 120],
      ['endDate', 360, 120],
      ['duration', 480, 100],
    ]);
    expect(state.totalWidth).toBe(580);
    expect(state.items[0]?.tree).toBe(true);
  });

  it('supports custom columns based on a field or a value function', () => {
    const { state } = resolveColumns([
      { id: 'task', field: 'name', title: 'Task', width: 300 },
      { id: 'owner', title: 'Owner', value: () => 'Kari' },
    ]);
    expect(state.items.map((column) => [column.id, column.title, column.width, column.tree])).toEqual([
      ['task', 'Task', 300, true],
      ['owner', 'Owner', 120, false],
    ]);
  });

  it('allows no columns at all', () => {
    expect(resolveColumns([]).state.totalWidth).toBe(0);
  });

  it('leaves a cell empty when a value function throws', () => {
    const { values } = resolveColumns([
      {
        id: 'broken',
        value: () => {
          throw new Error('bug');
        },
      },
    ]);
    expect(values[0]?.({} as never)).toBe('');
  });

  it.each([
    [['nope']],
    [['name', 'name']],
    [[{ id: 'x' }]],
    [[{ id: '', field: 'name' }]],
    [[{ id: 'x', field: 'nope' }]],
    [[{ id: 'x', field: 'name', width: 0 }]],
    [[{ id: 'x', field: 'name', width: Number.NaN }]],
    [[{ id: 'x', field: 'name', width: 5000 }]],
    ['not an array'],
  ])('rejects %j', (input) => {
    expect(() => resolveColumns(input as unknown as ColumnInput[])).toThrow(QuartzioError);
  });
});

describe('cell formatting', () => {
  const oslo = (day: number, hour = 0) => Date.UTC(2026, 9, day, hour - 2);

  it('shows an end at midnight as the day before (end dates are exclusive)', () => {
    expect(formatEndDate(oslo(5, 8), oslo(9), 'Europe/Oslo', 'en-US')).toBe('Oct 8, 2026');
    expect(formatEndDate(oslo(5, 8), oslo(9, 16), 'Europe/Oslo', 'en-US')).toBe('Oct 9, 2026');
    // A zero-length task at midnight is still on that day.
    expect(formatEndDate(oslo(9), oslo(9), 'Europe/Oslo', 'en-US')).toBe('Oct 9, 2026');
  });

  it('spells out durations and percentages in the locale', () => {
    expect(formatDuration(3, 'day', 'en-US')).toBe('3 days');
    expect(formatDuration(1, 'week', 'nb-NO')).toBe('1 uke');
    expect(formatDuration(1.5, 'hour', 'en-US')).toBe('1.5 hours');
    expect(formatDuration(2, 'quarter', 'en-US')).toBe('2 q');
    expect(formatPercent(50, 'en-US')).toBe('50%');
  });

  describe('review regressions (4a)', () => {
    it.each([
      [[null]],
      [[{ id: 'x', value: 'abc' }]],
      [[{ id: 'x', field: 'name', title: {} }]],
      [[{ id: 'x', field: 'name', align: 'middle' }]],
    ])('rejects %j', (input) => {
      expect(() => resolveColumns(input as unknown as ColumnInput[])).toThrow(QuartzioError);
    });

    it('shows null/undefined values as empty cells and numbers as text', () => {
      const { values } = resolveColumns([
        { id: 'a', value: () => null as never },
        { id: 'b', value: () => 42 as never },
      ]);
      expect(values.map((value) => value({} as never))).toEqual(['', '42']);
    });

    it('shows an end at midnight as the previous day also on DST days and in other zones', () => {
      // Oslo 25 October 2026 has 25 hours; the task ends at midnight starting the 26th.
      const osloMidnight26 = Date.UTC(2026, 9, 25, 23);
      expect(formatEndDate(Date.UTC(2026, 9, 24, 22), osloMidnight26, 'Europe/Oslo', 'en-US')).toBe(
        'Oct 25, 2026',
      );
      const newYorkMidnight = Date.UTC(2026, 10, 2, 5); // 2 November, after the fall-back on the 1st
      expect(formatEndDate(Date.UTC(2026, 9, 30, 4), newYorkMidnight, 'America/New_York', 'en-US')).toBe(
        'Nov 1, 2026',
      );
    });
  });
});
