import { QuartzioError } from '../util/errors';
import type { TimeZone } from '../util/zone';
import { alignToUnit, nextBoundary } from './align';
import { formatHeaderCell } from './format';
import type { ViewPreset } from './presets';

export interface TimeAxisOptions {
  /** The axis is widened to whole ticks around `[start, end)`. */
  start: number;
  end: number;
  preset: ViewPreset;
  timeZone: TimeZone;
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number;
  locale?: string | undefined;
  /** Adds ticks after `end` until the axis is at least this many pixels wide (e.g. to fill a viewport). */
  minWidth?: number | undefined;
  /**
   * When the range needs more than `MAX_TICKS` ticks: stop there (the axis ends early) instead of
   * throwing. Used by the controller, which must never fail while rendering.
   */
  truncate?: boolean | undefined;
}

export interface Tick {
  index: number;
  start: number;
  end: number;
  x: number;
  width: number;
}

export interface HeaderCell {
  /** Stable key for rendering lists. */
  key: string;
  /** The cell's full time span; it may extend beyond the axis at the edges. */
  start: number;
  end: number;
  /** Position and width, clipped to the axis. */
  x: number;
  width: number;
  label: string;
}

/**
 * Maps time to pixels and back. Every tick has the same width; within a tick, position is linear in
 * time. So a 23-hour DST day is as wide as any other day, and every month is as wide as every other.
 */
export interface TimeAxis {
  readonly preset: ViewPreset;
  readonly timeZone: TimeZone;
  readonly locale: string | undefined;
  readonly weekStartsOn: number;
  /** First tick start and last tick end. */
  readonly start: number;
  readonly end: number;
  readonly tickCount: number;
  readonly tickWidth: number;
  readonly totalWidth: number;
  tick: (index: number) => Tick;
  /** Pixel position of a time. Times outside the axis are extrapolated from the edge ticks. */
  dateToX: (time: number) => number;
  /** Time at a pixel position; the inverse of `dateToX`, rounded to whole milliseconds. */
  xToDate: (x: number) => number;
  /** Ticks overlapping `[fromX, toX)`. */
  ticksInRange: (fromX: number, toX: number) => Tick[];
  /**
   * Cells of header row `row` (0 = top) overlapping `[fromX, toX)`, clipped to the axis. Always aligned to
   * natural boundaries, so the same cells come back whatever window is asked for. At most 10 000 cells.
   */
  headerCells: (row: number, fromX: number, toX: number) => HeaderCell[];
  /** Rounds to the nearest `timeResolution` boundary of the preset. */
  snap: (time: number) => number;
}

/** Guards against presets that would create absurd numbers of ticks (e.g. hours over centuries). */
export const MAX_TICKS = 200_000;
const MAX_HEADER_CELLS = 10_000;

export function createTimeAxis(options: TimeAxisOptions): TimeAxis {
  const { preset, timeZone, weekStartsOn, locale } = options;
  const { tickUnit, tickIncrement, tickWidth } = preset;
  if (!Number.isFinite(options.start) || !Number.isFinite(options.end)) {
    throw new QuartzioError('Time axis: start and end must be finite times.');
  }

  const minTicks = Math.ceil((options.minWidth ?? 0) / tickWidth);
  const boundaries: number[] = [alignToUnit(options.start, tickUnit, tickIncrement, timeZone, weekStartsOn)];
  do {
    if (boundaries.length - 1 >= MAX_TICKS) {
      if (options.truncate) break;
      throw new QuartzioError(
        `Time axis: more than ${String(MAX_TICKS)} ticks. Use a more zoomed-out preset or a shorter range.`,
      );
    }
    const last = boundaries[boundaries.length - 1] as number;
    boundaries.push(nextBoundary(last, tickUnit, tickIncrement, timeZone, weekStartsOn));
  } while ((boundaries[boundaries.length - 1] as number) < options.end || boundaries.length - 1 < minTicks);

  const tickCount = boundaries.length - 1;
  const totalWidth = tickCount * tickWidth;
  const boundary = (i: number): number => boundaries[i] as number;
  const start = boundary(0);
  const end = boundary(tickCount);

  /** Index of the tick containing `time` (which must be inside the axis). */
  const tickIndexAt = (time: number): number => {
    let low = 0;
    let high = tickCount - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (boundary(middle) <= time) low = middle;
      else high = middle - 1;
    }
    return low;
  };

  const tick = (index: number): Tick => ({
    index,
    start: boundary(index),
    end: boundary(index + 1),
    x: index * tickWidth,
    width: tickWidth,
  });

  const dateToX = (time: number): number => {
    if (time < start) return ((time - start) / (boundary(1) - start)) * tickWidth;
    if (time >= end) return totalWidth + ((time - end) / (end - boundary(tickCount - 1))) * tickWidth;
    const i = tickIndexAt(time);
    return i * tickWidth + ((time - boundary(i)) / (boundary(i + 1) - boundary(i))) * tickWidth;
  };

  const xToDate = (x: number): number => {
    const i = Math.floor(x / tickWidth);
    if (i < 0) return Math.round(start + (x / tickWidth) * (boundary(1) - start));
    if (i >= tickCount) {
      return Math.round(end + ((x - totalWidth) / tickWidth) * (end - boundary(tickCount - 1)));
    }
    return Math.round(boundary(i) + ((x - i * tickWidth) / tickWidth) * (boundary(i + 1) - boundary(i)));
  };

  const clampIndex = (i: number): number => Math.max(0, Math.min(tickCount, i));

  return {
    preset,
    timeZone,
    locale,
    weekStartsOn,
    start,
    end,
    tickCount,
    tickWidth,
    totalWidth,
    tick,
    dateToX,
    xToDate,

    ticksInRange(fromX, toX) {
      const first = clampIndex(Math.floor(fromX / tickWidth));
      const last = clampIndex(Math.ceil(toX / tickWidth));
      const result: Tick[] = [];
      for (let i = first; i < last; i++) result.push(tick(i));
      return result;
    },

    headerCells(row, fromX, toX) {
      const header = preset.headers[row];
      if (!header)
        throw new QuartzioError(`Time axis: preset "${preset.id}" has no header row ${String(row)}.`);
      const increment = header.increment ?? 1;
      const from = Math.max(start, xToDate(fromX));
      const to = Math.min(end, xToDate(toX));
      const cells: HeaderCell[] = [];
      let cellStart = alignToUnit(from, header.unit, increment, timeZone, weekStartsOn);
      while (cellStart < to && cells.length < MAX_HEADER_CELLS) {
        const cellEnd = nextBoundary(cellStart, header.unit, increment, timeZone, weekStartsOn);
        const x = dateToX(Math.max(cellStart, start));
        cells.push({
          key: `${String(row)}:${String(cellStart)}`,
          start: cellStart,
          end: cellEnd,
          x,
          width: dateToX(Math.min(cellEnd, end)) - x,
          label: formatHeaderCell(header.format, {
            start: cellStart,
            end: cellEnd,
            unit: header.unit,
            increment,
            timeZone,
            locale,
          }),
        });
        cellStart = cellEnd;
      }
      return cells;
    },

    snap(time) {
      const { unit, increment } = preset.timeResolution;
      const floor = alignToUnit(time, unit, increment, timeZone, weekStartsOn);
      const ceil = nextBoundary(floor, unit, increment, timeZone, weekStartsOn);
      return time - floor < ceil - time ? floor : ceil;
    },
  };
}
