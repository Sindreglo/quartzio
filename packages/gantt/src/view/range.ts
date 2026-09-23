import type { ProjectState } from '../data/types';
import type { ViewPreset } from '../timeaxis/presets';
import { addUnits, startOfUnit } from '../util/zone';

/** Ticks of empty space added on each side of the tasks. */
const PADDING_TICKS = 2;
/** Shown when there are no dated tasks. */
const EMPTY_WEEKS = 4;

/**
 * The time range to show when none is given: from the earliest to the latest task date, padded by a few
 * ticks. Without dated tasks, a few weeks from the start of the current week.
 */
export function defaultTimelineRange(
  state: ProjectState,
  preset: ViewPreset,
  now: number,
): { start: number; end: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const task of state.tasks.byId.values()) {
    for (const time of [task.startDate, task.endDate]) {
      if (time !== null) {
        if (time < min) min = time;
        if (time > max) max = time;
      }
    }
  }

  const { timeZone, weekStartsOn } = state.settings;
  if (min === Number.POSITIVE_INFINITY) {
    const start = startOfUnit(now, 'week', timeZone, weekStartsOn);
    return { start, end: addUnits(start, EMPTY_WEEKS, 'week', timeZone) };
  }
  const padding = PADDING_TICKS * preset.tickIncrement;
  return {
    start: addUnits(min, -padding, preset.tickUnit, timeZone),
    // A zero-length range (one milestone) still gets room after it.
    end: addUnits(max, padding, preset.tickUnit, timeZone),
  };
}
