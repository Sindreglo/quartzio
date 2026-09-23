import { describe, expect, it } from 'vitest';
import { createProjectState } from '../data/normalize';
import type { ProjectInput } from '../data/types';
import { computeEffectiveDates } from './effective';

// Oslo is UTC+2 in October 2026: 08:00 local = 06:00 UTC.
const oslo = (day: number, hour: number) => Date.UTC(2026, 9, day, hour - 2);
const base: ProjectInput = { settings: { timeZone: 'Europe/Oslo' } };
const dates = (input: ProjectInput) => computeEffectiveDates(createProjectState({ ...base, ...input }));

describe('computeEffectiveDates', () => {
  it('uses start and end as given', () => {
    const result = dates({ tasks: [{ id: 1, startDate: oslo(5, 8), endDate: oslo(7, 16) }] });
    expect(result.get(1)).toEqual({ start: oslo(5, 8), end: oslo(7, 16) });
  });

  it('derives the end from start + duration in working time', () => {
    // Friday 12:00 + 1 day (8 working hours) skips the weekend: Monday 12:00.
    const result = dates({ tasks: [{ id: 1, startDate: oslo(9, 12), duration: 1 }] });
    expect(result.get(1)).toEqual({ start: oslo(9, 12), end: oslo(12, 12) });
  });

  it('derives the start from end + duration', () => {
    const result = dates({ tasks: [{ id: 1, endDate: oslo(12, 12), duration: 1 }] });
    expect(result.get(1)).toEqual({ start: oslo(9, 12), end: oslo(12, 12) });
  });

  it('treats a task with only a start (or duration 0) as a zero-length task', () => {
    const result = dates({
      tasks: [
        { id: 1, startDate: oslo(5, 8) },
        { id: 2, startDate: oslo(5, 8), duration: 0 },
      ],
    });
    expect(result.get(1)).toEqual({ start: oslo(5, 8), end: oslo(5, 8) });
    expect(result.get(2)).toEqual({ start: oslo(5, 8), end: oslo(5, 8) });
  });

  it('leaves unscheduled tasks out', () => {
    const result = dates({ tasks: [{ id: 1 }, { id: 2, duration: 3 }] });
    expect(result.has(1)).toBe(false);
    expect(result.has(2)).toBe(false);
  });

  it('rolls parents up from their descendants, through several levels', () => {
    const result = dates({
      tasks: [
        {
          id: 'root',
          startDate: oslo(1, 8), // ignored: parents span their children
          endDate: oslo(2, 8),
          children: [
            { id: 'a', startDate: oslo(5, 8), endDate: oslo(6, 16) },
            {
              id: 'group',
              children: [{ id: 'b', startDate: oslo(7, 8), endDate: oslo(9, 16) }, { id: 'undated' }],
            },
          ],
        },
      ],
    });
    expect(result.get('group')).toEqual({ start: oslo(7, 8), end: oslo(9, 16) });
    expect(result.get('root')).toEqual({ start: oslo(5, 8), end: oslo(9, 16) });
  });

  it('uses a parent’s own dates when none of its children are dated', () => {
    const result = dates({
      tasks: [{ id: 'p', startDate: oslo(5, 8), endDate: oslo(6, 16), children: [{ id: 'c' }] }],
    });
    expect(result.get('p')).toEqual({ start: oslo(5, 8), end: oslo(6, 16) });
    expect(result.has('c')).toBe(false);
  });

  it('never throws, even when the calendar has no working time', () => {
    const result = dates({
      settings: { timeZone: 'Europe/Oslo', calendarId: 'none' },
      calendars: [{ id: 'none', week: {} }],
      tasks: [{ id: 1, startDate: oslo(5, 8), duration: 2 }],
    });
    expect(result.get(1)).toEqual({ start: oslo(5, 8), end: oslo(5, 8) });
  });

  it('is cached per project state', () => {
    const state = createProjectState({ ...base, tasks: [{ id: 1, startDate: oslo(5, 8) }] });
    expect(computeEffectiveDates(state)).toBe(computeEffectiveDates(state));
  });

  it('treats a task with only an end as zero-length at the end', () => {
    expect(dates({ tasks: [{ id: 1, endDate: oslo(9, 16) }] }).get(1)).toEqual({
      start: oslo(9, 16),
      end: oslo(9, 16),
    });
  });

  it('falls back quickly for absurd durations instead of freezing', () => {
    const result = dates({ tasks: [{ id: 1, startDate: oslo(5, 8), duration: 36_000 }] }); // ~140 years
    expect(result.get(1)).toEqual({ start: oslo(5, 8), end: oslo(5, 8) });
  });
});
