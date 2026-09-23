import { toTime } from '../data/normalize';
import type { DateInput, ProjectState } from '../data/types';
import { assertLocale } from '../timeaxis/format';
import { resolvePreset, type ViewPreset } from '../timeaxis/presets';
import { createTimeAxis, type TimeAxis } from '../timeaxis/timeAxis';
import { isEqual } from '../util/equal';
import { QuartzioError } from '../util/errors';
import { defaultTimelineRange } from './range';
import type { HeaderState, Viewport } from './types';

/** Assumed viewport width before it has been measured (and when rendering on the server). */
export const UNMEASURED_WIDTH = 1200;

export interface TimelineOptions {
  preset: ViewPreset;
  startDate: DateInput | undefined;
  endDate: DateInput | undefined;
  locale: string | undefined;
}

interface TimelineOptionsInput {
  preset?: string | ViewPreset | undefined;
  startDate?: DateInput | null | undefined;
  endDate?: DateInput | null | undefined;
  locale?: string | undefined;
}

/** Validates the timeline options; throws QuartzioError before anything is changed. */
export function resolveTimeline(options: TimelineOptionsInput): TimelineOptions {
  const preset = resolvePreset(options.preset);
  if (options.locale !== undefined) assertLocale(options.locale);
  // `null` from plain JavaScript means "not set", like `undefined`.
  const startDate = options.startDate ?? undefined;
  const endDate = options.endDate ?? undefined;
  // The format doesn't depend on the zone, so check it now; the real value is read in the project's zone.
  const start = toTime(startDate, 'startDate', 'Gantt options', 'UTC');
  const end = toTime(endDate, 'endDate', 'Gantt options', 'UTC');
  if (start !== null && end !== null && end <= start) {
    throw new QuartzioError('Gantt options: "endDate" must be after "startDate".');
  }
  return { preset, startDate, endDate, locale: options.locale };
}

const dateValue = (value: DateInput | undefined): unknown =>
  value instanceof Date ? value.getTime() : value;

/** Equal by value, so re-rendering with a new but equal Date (or an equal custom preset) is no change. */
export const sameTimeline = (a: TimelineOptions, b: TimelineOptions): boolean =>
  (a.preset === b.preset || isEqual(a.preset, b.preset)) &&
  Object.is(dateValue(a.startDate), dateValue(b.startDate)) &&
  Object.is(dateValue(a.endDate), dateValue(b.endDate)) &&
  a.locale === b.locale;

/** Parses an already validated date option, falling back when it isn't set. Never throws. */
function parseOr(value: DateInput | undefined, zone: string, fallback: number): number {
  try {
    return toTime(value, 'date', 'Gantt options', zone) ?? fallback;
  } catch {
    return fallback;
  }
}

export interface TimelineView {
  axisFor: (project: ProjectState, viewportWidth: number, timeline: TimelineOptions) => TimeAxis;
  headerFor: (axis: TimeAxis, viewport: Viewport, rowHeight: number) => HeaderState;
}

/**
 * Derives the time axis and the visible header cells. Each piece is reused while its inputs are unchanged,
 * and nothing here throws: options are validated up front, and oversized ranges are cut short.
 */
export function createTimelineView(): TimelineView {
  let rangeCache: { key: unknown[]; range: { start: number; end: number } } | undefined;
  const timelineRange = (
    project: ProjectState,
    timeline: TimelineOptions,
  ): { start: number; end: number } => {
    const key = [project.tasks, project.settings, timeline];
    if (!rangeCache || key.some((part, i) => part !== rangeCache?.key[i])) {
      const zone = project.settings.timeZone;
      const fallback = defaultTimelineRange(project, timeline.preset, Date.now());
      const start = parseOr(timeline.startDate, zone, fallback.start);
      const end = parseOr(timeline.endDate, zone, fallback.end);
      rangeCache = { key, range: { start, end: Math.max(start, end) } };
    }
    return rangeCache.range;
  };

  let axisCache: { key: unknown[]; axis: TimeAxis } | undefined;
  const axisFor = (project: ProjectState, viewportWidth: number, timeline: TimelineOptions): TimeAxis => {
    const { start, end } = timelineRange(project, timeline);
    const { timeZone, weekStartsOn } = project.settings;
    const { preset, locale } = timeline;
    const minWidth = viewportWidth > 0 ? viewportWidth : UNMEASURED_WIDTH;
    // Keyed on the tick count needed to fill the viewport, so resizing by a few pixels reuses the axis.
    const key = [start, end, preset, locale, timeZone, weekStartsOn, Math.ceil(minWidth / preset.tickWidth)];
    if (axisCache && key.every((part, i) => part === axisCache?.key[i])) return axisCache.axis;

    const axis = createTimeAxis({
      start,
      end,
      preset,
      timeZone,
      weekStartsOn,
      locale,
      minWidth,
      truncate: true,
    });
    // Different inputs can still produce the same axis (e.g. the last task moved by an hour). Keeping the
    // old object lets everything memoized on it stay valid.
    const previous = axisCache?.axis;
    const same =
      previous?.start === axis.start &&
      previous.end === axis.end &&
      previous.tickCount === axis.tickCount &&
      previous.preset === axis.preset &&
      previous.locale === axis.locale &&
      previous.timeZone === axis.timeZone &&
      previous.weekStartsOn === axis.weekStartsOn;
    axisCache = { key, axis: same ? previous : axis };
    return axisCache.axis;
  };

  let headerCache:
    { axis: TimeAxis; rowHeight: number; from: number; to: number; header: HeaderState } | undefined;
  const headerFor = (axis: TimeAxis, viewport: Viewport, rowHeight: number): HeaderState => {
    const width = viewport.width > 0 ? viewport.width : UNMEASURED_WIDTH;
    const visibleFrom = viewport.scrollLeft;
    const visibleTo = viewport.scrollLeft + width;
    if (
      headerCache?.axis === axis &&
      headerCache.rowHeight === rowHeight &&
      headerCache.from <= visibleFrom &&
      visibleTo <= headerCache.to
    ) {
      return headerCache.header;
    }
    // Render one extra viewport on each side, so most scrolling reuses the same cells.
    const from = Math.max(0, visibleFrom - width);
    const to = Math.min(axis.totalWidth, visibleTo + width);
    const rows = axis.preset.headers.map((_, row) => axis.headerCells(row, from, to));
    const header: HeaderState = { rows, rowHeight, height: rows.length * rowHeight };
    // At the timeline's edges the window can't grow, so treat it as open-ended there.
    headerCache = {
      axis,
      rowHeight,
      from: from === 0 ? Number.NEGATIVE_INFINITY : from,
      to: to === axis.totalWidth ? Number.POSITIVE_INFINITY : to,
      header,
    };
    return header;
  };

  return { axisFor, headerFor };
}
