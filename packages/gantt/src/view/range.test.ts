import { describe, expect, it } from 'vitest';
import { createProjectState } from '../data/normalize';
import { resolvePreset } from '../timeaxis/presets';
import { defaultTimelineRange } from './range';

const preset = resolvePreset('weekAndDay');
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

describe('defaultTimelineRange', () => {
  it('shows a few weeks from the start of this week without dated tasks', () => {
    const state = createProjectState({ settings: { timeZone: 'UTC' }, tasks: [{ id: 1 }] });
    const range = defaultTimelineRange(state, preset, utc(2026, 10, 7) + 5_000_000); // a Wednesday
    expect(range).toEqual({ start: utc(2026, 10, 5), end: utc(2026, 11, 2) });
  });

  it('pads the tasks by two ticks and uses start or end dates alone', () => {
    const state = createProjectState({
      settings: { timeZone: 'UTC' },
      tasks: [
        { id: 1, startDate: utc(2026, 10, 10) }, // milestone-like: start only
        { id: 2, endDate: utc(2026, 10, 20) }, // end only
      ],
    });
    expect(defaultTimelineRange(state, preset, 0)).toEqual({
      start: utc(2026, 10, 8),
      end: utc(2026, 10, 22),
    });
  });
});
