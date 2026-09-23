import { durationToWorkingMs } from '../calendar/duration';
import { getWorkingCalendar } from '../calendar/project';
import type { WorkingCalendar } from '../calendar/workingCalendar';
import { getTreeIndex } from '../data/tree';
import type { Id, ProjectState, Task } from '../data/types';

/** Computed display dates of a task. Kept apart from the task's own (user-owned) fields. */
export interface EffectiveDates {
  readonly start: number;
  readonly end: number;
}

const cache = new WeakMap<ProjectState, ReadonlyMap<Id, EffectiveDates>>();

/**
 * Start and end to display for each task, until the scheduling engine (milestone 5) computes them from
 * dependencies and constraints:
 * - a leaf uses its own dates; a missing end (or start) is derived from the duration in working time;
 * - a task with only a start, or only an end (or duration 0), is zero-length;
 * - a parent spans its dated descendants, or uses its own dates when none of them are dated;
 * - tasks without a start or end are unscheduled and left out.
 * Never throws (a calendar without working time makes durations zero-length). Cached per state.
 */
export function computeEffectiveDates(state: ProjectState): ReadonlyMap<Id, EffectiveDates> {
  const cached = cache.get(state);
  if (cached) return cached;

  let calendar: WorkingCalendar | undefined;
  try {
    calendar = getWorkingCalendar(state);
  } catch {
    calendar = undefined;
  }

  const result = new Map<Id, EffectiveDates>();
  const tree = getTreeIndex(state.tasks);
  // Children before parents, so parents can roll up.
  const order = [...tree.flatten()].reverse();
  for (const id of order) {
    const task = state.tasks.byId.get(id) as Task;
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const child of tree.children(id)) {
      const dates = result.get(child);
      if (dates) {
        start = Math.min(start, dates.start);
        end = Math.max(end, dates.end);
      }
    }
    const own = start === Number.POSITIVE_INFINITY ? ownDates(task, state, calendar) : { start, end };
    if (own) result.set(id, own);
  }

  cache.set(state, result);
  return result;
}

function ownDates(
  task: Task,
  state: ProjectState,
  calendar: WorkingCalendar | undefined,
): EffectiveDates | null {
  const { startDate, endDate, duration, durationUnit } = task;
  if (startDate !== null && endDate !== null) return { start: startDate, end: endDate };

  const workingMs = duration === null ? 0 : durationToWorkingMs(duration, durationUnit, state.settings);
  const shift = (from: number, direction: 1 | -1): number => {
    if (!calendar || workingMs === 0) return from;
    try {
      return direction === 1
        ? calendar.addWorkingTime(from, workingMs)
        : calendar.subtractWorkingTime(from, workingMs);
    } catch {
      return from; // e.g. a calendar without working time
    }
  };

  if (startDate !== null) return { start: startDate, end: shift(startDate, 1) };
  if (endDate !== null) return { start: shift(endDate, -1), end: endDate };
  return null;
}
