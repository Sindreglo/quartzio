import type { Task } from '../data/types';
import type { EffectiveDates } from '../scheduling/effective';
import type { TimeAxis } from '../timeaxis/timeAxis';

export type BarKind = 'task' | 'summary' | 'milestone';

/** A task's bar on the timeline, in timeline coordinates (x = 0 is the start of the axis). */
export interface Bar {
  readonly kind: BarKind;
  /**
   * Left edge; for milestones, the center of the diamond. May be outside the axis for tasks that extend beyond
   * it, but is kept within one axis width on either side (`start` and `end` keep the real dates).
   */
  readonly x: number;
  /** 0 for milestones. */
  readonly width: number;
  readonly start: number;
  readonly end: number;
  /** 0–1. */
  readonly progress: number;
  readonly label: string;
}

/** Keeps very short tasks visible and clickable at coarse zoom levels. */
export const MIN_BAR_WIDTH = 2;

export function computeBar(
  task: Task,
  dates: EffectiveDates | null,
  isParent: boolean,
  axis: TimeAxis,
): Bar | null {
  if (!dates) return null;
  // Browsers stop drawing tens of millions of pixels out, so keep positions near the axis.
  const clamp = (value: number) => Math.max(-axis.totalWidth, Math.min(2 * axis.totalWidth, value));
  const start = clamp(axis.dateToX(dates.start));
  const common = {
    start: dates.start,
    end: dates.end,
    progress: Math.max(0, Math.min(1, task.percentDone / 100)),
    label: task.name,
  };
  if (dates.end === dates.start && !isParent) return { kind: 'milestone', x: start, width: 0, ...common };
  const width = Math.max(MIN_BAR_WIDTH, clamp(axis.dateToX(dates.end)) - start);
  return {
    kind: isParent ? 'summary' : 'task',
    x: Math.min(start, 2 * axis.totalWidth - width),
    width,
    ...common,
  };
}

export const sameBar = (a: Bar | null, b: Bar | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.kind === b.kind &&
    a.x === b.x &&
    a.width === b.width &&
    a.start === b.start &&
    a.end === b.end &&
    a.progress === b.progress &&
    a.label === b.label);
