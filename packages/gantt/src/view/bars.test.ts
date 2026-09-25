import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectInput } from '../data/types';
import { QuartzioError } from '../util/errors';
import { createGantt } from './createGantt';

// Oslo is UTC+2 in October 2026: local midnight = 22:00 UTC the day before.
const oslo = (day: number, hour = 0) => Date.UTC(2026, 9, day, hour - 2);

// Leaves are manually scheduled: these tests are about drawing, with dates as given.
const project: ProjectInput = {
  settings: { timeZone: 'Europe/Oslo' },
  tasks: [
    {
      id: 'plan',
      name: 'Planning',
      children: [
        {
          id: 'scope',
          name: 'Scope',
          startDate: oslo(5),
          endDate: oslo(8),
          percentDone: 50,
          manuallyScheduled: true,
        },
        { id: 'budget', name: 'Budget', startDate: oslo(8), endDate: oslo(10), manuallyScheduled: true },
      ],
    },
    { id: 'launch', name: 'Launch', startDate: oslo(12), manuallyScheduled: true },
    { id: 'idea', name: 'Idea' },
  ],
};

// 'weekAndDay': one day = 32 px. Starting the axis on Monday 5 October makes positions easy to read.
const gantt = (extra = {}) =>
  createGantt({
    defaultData: project,
    preset: 'weekAndDay',
    startDate: '2026-10-05',
    endDate: '2026-11-02',
    ...extra,
  });

const bars = (g: ReturnType<typeof createGantt>) =>
  new Map(g.getState().rows.items.map((row) => [row.id, row.bar]));

afterEach(() => {
  vi.useRealTimers();
});

describe('bars', () => {
  it('places task bars from the time axis', () => {
    const scope = bars(gantt()).get('scope');
    expect(scope).toMatchObject({
      kind: 'task',
      x: 0,
      width: 3 * 32,
      start: oslo(5),
      end: oslo(8),
      progress: 0.5,
    });
    expect(scope?.label).toBe('Scope');
  });

  it('draws parents as summary bars spanning their children', () => {
    expect(bars(gantt()).get('plan')).toMatchObject({ kind: 'summary', x: 0, width: 5 * 32 });
  });

  it('draws zero-length tasks as milestones', () => {
    expect(bars(gantt()).get('launch')).toMatchObject({ kind: 'milestone', x: 7 * 32, width: 0 });
  });

  it('has no bar for unscheduled tasks', () => {
    expect(bars(gantt()).get('idea')).toBeNull();
  });

  it('gives very short tasks a minimum visible width', () => {
    const g = createGantt({
      defaultData: {
        settings: { timeZone: 'UTC' },
        tasks: [{ id: 1, startDate: '2026-10-05T08:00', endDate: '2026-10-05T08:01' }],
      },
      preset: 'monthAndYear',
    });
    expect(bars(g).get(1)?.width).toBeGreaterThanOrEqual(2);
  });

  it('extends bars outside the axis instead of clipping or dropping them', () => {
    const g = gantt({ startDate: '2026-10-07', endDate: '2026-11-02' });
    expect(bars(g).get('scope')).toMatchObject({ x: -2 * 32, width: 3 * 32 });
  });

  it('moves bars when the preset changes, and keeps rows while only scrolling', () => {
    const g = gantt();
    g.setViewport({ height: 400 });
    const rows = g.getState().rows;
    g.setViewport({ scrollLeft: 50 });
    expect(g.getState().rows).toBe(rows);

    g.setOptions({ preset: 'dayAndWeek' }); // 64 px per day
    expect(bars(g).get('scope')).toMatchObject({ x: 0, width: 3 * 64 });
  });

  it('draws a parent whose children are all on the same instant as a thin summary bar', () => {
    const g = createGantt({
      defaultData: {
        settings: { timeZone: 'Europe/Oslo' },
        tasks: [
          {
            id: 'p',
            children: [
              { id: 'a', startDate: oslo(7) },
              { id: 'b', startDate: oslo(7) },
            ],
          },
          { id: 'q', children: [{ id: 'c' }] }, // only unscheduled children
        ],
      },
      preset: 'weekAndDay',
      startDate: '2026-10-05',
      endDate: '2026-11-02',
    });
    expect(bars(g).get('p')).toMatchObject({ kind: 'summary', x: 2 * 32, width: 2 });
    expect(bars(g).get('a')).toMatchObject({ kind: 'milestone' });
    expect(bars(g).get('q')).toBeNull();
  });

  it('keeps pixel positions within what browsers can draw, but keeps the real dates', () => {
    const g = createGantt({
      defaultData: {
        settings: { timeZone: 'UTC' },
        tasks: [
          { id: 'long', startDate: '1100-01-01', endDate: '9900-01-01' },
          { id: 'far', startDate: '9800-01-01', endDate: '9800-01-02' },
        ],
      },
      preset: 'hourAndDay',
      startDate: '2026-10-05',
      endDate: '2026-10-06',
    });
    const total = g.getState().timeAxis.totalWidth;
    for (const bar of bars(g).values()) {
      expect(bar?.x).toBeGreaterThanOrEqual(-total);
      expect((bar?.x ?? 0) + (bar?.width ?? 0)).toBeLessThanOrEqual(2 * total);
    }
    expect(bars(g).get('long')?.start).toBe(Date.UTC(1100, 0, 1));
    expect(bars(g).get('far')?.width).toBeGreaterThanOrEqual(2);
  });

  it('keeps row objects when the axis changes without moving any bar', () => {
    const g = gantt();
    g.setViewport({ height: 400 });
    const before = g.getState().rows.items;
    g.setOptions({ endDate: '2026-12-01' });
    const after = g.getState().rows.items;
    expect(after).toHaveLength(before.length);
    after.forEach((row, i) => {
      expect(row).toBe(before[i]);
    });
  });

  it('places bars on day boundaries in a zone that skips midnight (Cairo)', () => {
    const g = createGantt({
      defaultData: {
        settings: { timeZone: 'Africa/Cairo' },
        tasks: [{ id: 1, startDate: '2026-04-29', endDate: '2026-04-30', manuallyScheduled: true }],
      },
      preset: 'weekAndDay',
      // Friday 24 April 2026 starts at 01:00 in Cairo (00:00 doesn't exist).
      startDate: '2026-04-20',
      endDate: '2026-05-11',
    });
    expect(bars(g).get(1)).toMatchObject({ x: 9 * 32, width: 32 });
  });

  it('clamps progress to 0–1 and updates it on edits', () => {
    const g = gantt();
    g.transact((tx) => {
      tx.tasks.update('scope', { percentDone: 100 });
    });
    expect(bars(g).get('scope')?.progress).toBe(1);
  });
});

describe('today line', () => {
  it('is shown where now falls on the axis', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(oslo(6, 12)); // Tuesday noon
    expect(gantt().getState().today).toEqual({ time: oslo(6, 12), x: 32 + 16 });
  });

  it('is hidden when now is outside the axis, or when turned off', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2030, 0, 1));
    expect(gantt().getState().today).toBeNull();
    vi.setSystemTime(oslo(6, 12));
    expect(gantt({ showToday: false }).getState().today).toBeNull();
  });
});

describe('non-working time', () => {
  it('shades whole non-working days with day ticks (weekends, not nights)', () => {
    const spans = gantt().getState().nonWorkingTime;
    // Saturday 10 + Sunday 11 October: x = 5 and 6 days in, merged into one span.
    expect(spans[0]).toMatchObject({ start: oslo(10), end: oslo(12), x: 5 * 32, width: 2 * 32 });
    expect(spans.every((span) => span.width % 32 === 0)).toBe(true);
  });

  it('shades every non-working hour with hour ticks', () => {
    const g = gantt({ preset: 'hourAndDay', startDate: '2026-10-05', endDate: '2026-10-06' });
    const spans = g.getState().nonWorkingTime;
    // 00:00–08:00 on Monday, then from 16:00 through the night (one span across midnight), 44 px per hour.
    expect(spans[0]).toMatchObject({ x: 0, width: 8 * 44 });
    expect(spans[1]).toMatchObject({ x: 16 * 44, start: oslo(5, 16) });
    expect(spans[1]?.end).toBeGreaterThan(oslo(6)); // past midnight
  });

  it('includes holidays from the project calendar', () => {
    const g = createGantt({
      defaultData: {
        ...project,
        settings: { timeZone: 'Europe/Oslo', calendarId: 'c' },
        calendars: [{ id: 'c', exceptions: [{ startDate: '2026-10-07', name: 'Holiday' }] }],
      },
      preset: 'weekAndDay',
      startDate: '2026-10-05',
      endDate: '2026-11-02',
    });
    expect(g.getState().nonWorkingTime[0]).toMatchObject({ x: 2 * 32, width: 32 });
  });

  it('is empty for coarse presets or when turned off', () => {
    expect(gantt({ preset: 'monthAndYear' }).getState().nonWorkingTime).toEqual([]);
    expect(gantt({ showNonWorkingTime: false }).getState().nonWorkingTime).toEqual([]);
  });

  it('never throws, even for a calendar without working time', () => {
    const g = createGantt({
      defaultData: {
        settings: { timeZone: 'UTC', calendarId: 'none' },
        calendars: [{ id: 'none', week: {} }],
      },
      preset: 'weekAndDay',
      startDate: '2026-10-05',
      endDate: '2026-10-12',
    });
    expect(g.getState().nonWorkingTime).toHaveLength(1); // one span covering everything
  });

  it('stays on day boundaries in a zone that skips midnight (Cairo)', () => {
    const g = createGantt({
      defaultData: { settings: { timeZone: 'Africa/Cairo' } },
      preset: 'weekAndDay',
      // Friday 24 April 2026 starts at 01:00 in Cairo; the weekend after it must still start at midnight.
      startDate: '2026-04-20',
      endDate: '2026-05-11',
    });
    const spans = g.getState().nonWorkingTime;
    expect(spans[0]).toMatchObject({ x: 5 * 32, width: 2 * 32 });
    expect(spans.every((span) => span.x % 32 === 0 && span.width % 32 === 0)).toBe(true);
  });

  it('shades across a DST change (Oslo, October)', () => {
    // Sunday 25 October 2026 is 25 hours long; the weekend is still exactly two day ticks.
    const g = gantt({ startDate: '2026-10-19', endDate: '2026-11-02' });
    expect(g.getState().nonWorkingTime[0]).toMatchObject({ x: 5 * 32, width: 2 * 32 });
  });

  it('works with the host time zone', () => {
    const g = createGantt({
      defaultData: { settings: { timeZone: 'local' } },
      preset: 'weekAndDay',
      startDate: '2026-10-05',
      endDate: '2026-10-19',
    });
    // The axis fills the unmeasured viewport, so it covers more than two weekends.
    const spans = g.getState().nonWorkingTime;
    expect(spans[0]).toMatchObject({ x: 5 * 32, width: 2 * 32 });
    expect(spans.every((span) => span.x % 32 === 0 && span.width === 2 * 32)).toBe(true);
  });

  it('handles custom presets with tick increments', () => {
    const base = { settings: { timeZone: 'UTC' } };
    const sixHours = createGantt({
      defaultData: base,
      preset: {
        id: 'six-hours',
        tickUnit: 'hour',
        tickIncrement: 6,
        tickWidth: 60,
        headers: [{ unit: 'hour', increment: 6, format: 'hour' }],
        timeResolution: { unit: 'hour', increment: 1 },
      },
      startDate: '2026-10-05',
      endDate: '2026-10-06',
    });
    // Working 08:00–16:00: the nights, 10 px per hour.
    expect(
      sixHours
        .getState()
        .nonWorkingTime.slice(0, 2)
        .map((span) => [span.x, span.width]),
    ).toEqual([
      [0, 80],
      [160, 160],
    ]);

    const twoDays = createGantt({
      defaultData: base,
      preset: {
        id: 'two-days',
        tickUnit: 'day',
        tickIncrement: 2,
        tickWidth: 40,
        headers: [{ unit: 'day', increment: 2, format: 'weekdayDay' }],
        timeResolution: { unit: 'day', increment: 1 },
      },
      startDate: '2026-10-05',
      endDate: '2026-10-19',
    });
    // 20 px per day. Two-day ticks align the axis to Sunday 4 October, so it starts with half a weekend.
    const [sunday, weekend] = twoDays.getState().nonWorkingTime;
    expect(sunday).toMatchObject({ x: 0, width: 20 });
    expect(weekend).toMatchObject({ x: 6 * 20, width: 40 });
  });

  it('reuses the spans while scrolling nearby, and recomputes after a calendar or size change', () => {
    const g = createGantt({
      defaultData: { settings: { timeZone: 'UTC', calendarId: 'c' }, calendars: [{ id: 'c' }] },
      preset: 'hourAndDay',
      startDate: '2026-10-05',
      endDate: '2026-11-05',
    });
    g.setViewport({ width: 800, height: 400 });
    const spans = g.getState().nonWorkingTime;
    g.setViewport({ scrollLeft: 100 });
    expect(g.getState().nonWorkingTime).toBe(spans);

    g.setViewport({ width: 4000 });
    const wider = g.getState().nonWorkingTime;
    expect(wider).not.toBe(spans);
    expect(wider.at(-1)?.x).toBeGreaterThan(spans.at(-1)?.x ?? 0);

    g.transact((tx) => {
      tx.calendars.update('c', { exceptions: [{ startDate: '2026-10-05', name: 'Holiday' }] });
    });
    expect(g.getState().nonWorkingTime[0]).toMatchObject({ x: 0, width: 24 * 44 + 8 * 44 });
  });

  it('rejects non-boolean switches', () => {
    expect(() => createGantt({ showToday: 'yes' as never })).toThrow(QuartzioError);
  });

  it('toggles both switches with setOptions, and changes nothing when one is invalid', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(oslo(6, 12));
    const g = gantt();
    g.setOptions({ showToday: false, showNonWorkingTime: false });
    expect(g.getState().today).toBeNull();
    expect(g.getState().nonWorkingTime).toEqual([]);

    const state = g.getState();
    expect(() => {
      g.setOptions({ showToday: true, showNonWorkingTime: 1 as never });
    }).toThrow(QuartzioError);
    expect(g.getState()).toBe(state);

    g.setOptions({ showToday: true, showNonWorkingTime: true });
    expect(g.getState().today).not.toBeNull();
    expect(g.getState().nonWorkingTime.length).toBeGreaterThan(0);
  });
});
