import { getWorkingCalendar } from '../calendar/project';
import type { WorkingCalendar } from '../calendar/workingCalendar';
import type { ProjectState } from '../data/types';
import type { TimeAxis } from '../timeaxis/timeAxis';
import { QuartzioError } from '../util/errors';
import { addUnits, startOfUnit } from '../util/zone';
import { UNMEASURED_WIDTH } from './timeline';
import type { Viewport } from './types';

/** A time range drawn on the timeline, in timeline coordinates. */
export interface TimeSpan {
  /** Stable key for rendering lists. */
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly x: number;
  readonly width: number;
}

const EMPTY: readonly TimeSpan[] = [];
const SUB_DAY_TICKS = new Set(['millisecond', 'second', 'minute', 'hour']);

/**
 * Non-working time to shade, around the visible part of the timeline. What is shown depends on the tick size,
 * so the shading stays readable: with ticks under a day, every non-working interval (nights, weekends); with
 * day ticks, only whole days without working time (weekends, holidays) — shading nights would cover most of
 * every day; with longer ticks, nothing.
 */
export function createNonWorkingView(): {
  spansFor: (
    project: ProjectState,
    axis: TimeAxis,
    viewport: Viewport,
    enabled: boolean,
  ) => readonly TimeSpan[];
} {
  let cache: { key: unknown[]; from: number; to: number; spans: readonly TimeSpan[] } | undefined;

  const compute = (calendar: WorkingCalendar, axis: TimeAxis, from: number, to: number): TimeSpan[] => {
    const zone = axis.timeZone;
    const ranges: [number, number][] = [];
    const push = (start: number, end: number) => {
      const last = ranges[ranges.length - 1];
      if (last && last[1] >= start) last[1] = Math.max(last[1], end);
      else if (end > start) ranges.push([start, end]);
    };

    if (SUB_DAY_TICKS.has(axis.preset.tickUnit)) {
      let cursor = from;
      for (const [start, end] of calendar.workingIntervals(from, to)) {
        push(cursor, start);
        cursor = end;
      }
      push(cursor, to);
    } else {
      for (let day = startOfUnit(from, 'day', zone); day < to;) {
        // Re-align: after a day that starts late (a DST gap at midnight), adding a day keeps the late start.
        const next = startOfUnit(addUnits(day, 1, 'day', zone), 'day', zone);
        if (calendar.workingIntervals(day, next).length === 0) push(day, next);
        day = next;
      }
    }

    return ranges.map(([start, end]) => {
      const x = axis.dateToX(start);
      return { key: String(start), start, end, x, width: axis.dateToX(end) - x };
    });
  };

  const spansFor = (project: ProjectState, axis: TimeAxis, viewport: Viewport, enabled: boolean) => {
    const tickUnit = axis.preset.tickUnit;
    if (!enabled || (tickUnit !== 'day' && !SUB_DAY_TICKS.has(tickUnit))) return EMPTY;

    const width = viewport.width > 0 ? viewport.width : UNMEASURED_WIDTH;
    const visibleFrom = viewport.scrollLeft;
    const visibleTo = viewport.scrollLeft + width;
    const key = [axis, project.calendars, project.settings];
    if (
      cache &&
      key.every((part, i) => part === cache?.key[i]) &&
      cache.from <= visibleFrom &&
      visibleTo <= cache.to
    ) {
      return cache.spans;
    }

    // One extra viewport on each side, like the header.
    const fromX = Math.max(0, visibleFrom - width);
    const toX = Math.min(axis.totalWidth, visibleTo + width);
    let spans: readonly TimeSpan[];
    try {
      const calendar = getWorkingCalendar(project);
      spans = compute(
        calendar,
        axis,
        Math.max(axis.start, axis.xToDate(fromX)),
        Math.min(axis.end, axis.xToDate(toX)),
      );
    } catch (error) {
      if (!(error instanceof QuartzioError)) throw error;
      spans = EMPTY; // e.g. a range beyond what the calendar will calculate; shading is decoration
    }
    cache = {
      key,
      from: fromX === 0 ? Number.NEGATIVE_INFINITY : fromX,
      to: toX === axis.totalWidth ? Number.POSITIVE_INFINITY : toX,
      spans,
    };
    return spans;
  };

  return { spansFor };
}
