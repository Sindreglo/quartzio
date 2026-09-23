import { deepFreeze } from '../util/equal';
import { QuartzioError } from '../util/errors';
import { isTimeUnit, type TimeUnit } from '../util/time';
import type { TimeZone } from '../util/zone';

export interface HeaderCellContext {
  start: number;
  end: number;
  unit: TimeUnit;
  increment: number;
  timeZone: TimeZone;
  /** BCP 47 locale, e.g. "nb-NO"; `undefined` uses the runtime default. */
  locale: string | undefined;
}

/** Built-in label formats. Month and weekday names follow the locale. */
export type HeaderFormatName =
  | 'year'
  | 'quarter'
  | 'quarterYear'
  | 'month'
  | 'monthShort'
  | 'monthYear'
  | 'monthShortYear'
  /** ISO 8601 week number, e.g. "W41". */
  | 'week'
  | 'day'
  | 'weekdayShort'
  | 'weekdayNarrow'
  | 'weekdayDay'
  | 'dayMonth'
  | 'weekdayDayMonth'
  | 'hour'
  | 'hourMinute';

/** A built-in format, or a function. Functions should be pure and must not throw (errors leave the label empty). */
export type HeaderFormat = HeaderFormatName | ((cell: HeaderCellContext) => string);

export const HEADER_FORMATS: readonly HeaderFormatName[] = [
  'year',
  'quarter',
  'quarterYear',
  'month',
  'monthShort',
  'monthYear',
  'monthShortYear',
  'week',
  'day',
  'weekdayShort',
  'weekdayNarrow',
  'weekdayDay',
  'dayMonth',
  'weekdayDayMonth',
  'hour',
  'hourMinute',
];

export interface HeaderRow {
  unit: TimeUnit;
  /** Units per cell. Defaults to 1. */
  increment?: number;
  format: HeaderFormat;
}

export interface ViewPreset {
  id: string;
  /** The smallest column. Every tick gets the same width, however long it is in time. */
  tickUnit: TimeUnit;
  tickIncrement: number;
  /** Pixels per tick. */
  tickWidth: number;
  /** Header rows from top to bottom. */
  headers: readonly HeaderRow[];
  /** Resolution for snapping when dragging and resizing. */
  timeResolution: { unit: TimeUnit; increment: number };
}

/** Built-in presets, from most zoomed in to most zoomed out. */
export const VIEW_PRESETS: readonly ViewPreset[] = deepFreeze([
  {
    id: 'hourAndDay',
    tickUnit: 'hour',
    tickIncrement: 1,
    tickWidth: 44,
    headers: [
      { unit: 'day', format: 'weekdayDayMonth' },
      { unit: 'hour', format: 'hour' },
    ],
    timeResolution: { unit: 'minute', increment: 15 },
  },
  {
    id: 'dayAndWeek',
    tickUnit: 'day',
    tickIncrement: 1,
    tickWidth: 64,
    headers: [
      { unit: 'week', format: 'week' },
      { unit: 'day', format: 'weekdayDay' },
    ],
    timeResolution: { unit: 'hour', increment: 1 },
  },
  {
    id: 'weekAndDay',
    tickUnit: 'day',
    tickIncrement: 1,
    tickWidth: 32,
    headers: [
      { unit: 'month', format: 'monthYear' },
      { unit: 'week', format: 'week' },
      { unit: 'day', format: 'weekdayNarrow' },
    ],
    timeResolution: { unit: 'day', increment: 1 },
  },
  {
    id: 'weekAndMonth',
    tickUnit: 'week',
    tickIncrement: 1,
    tickWidth: 56,
    headers: [
      { unit: 'month', format: 'monthShortYear' },
      { unit: 'week', format: 'week' },
    ],
    timeResolution: { unit: 'day', increment: 1 },
  },
  {
    id: 'monthAndYear',
    tickUnit: 'month',
    tickIncrement: 1,
    tickWidth: 72,
    headers: [
      { unit: 'year', format: 'year' },
      { unit: 'month', format: 'monthShort' },
    ],
    timeResolution: { unit: 'day', increment: 1 },
  },
  {
    id: 'quarterAndYear',
    tickUnit: 'quarter',
    tickIncrement: 1,
    tickWidth: 96,
    headers: [
      { unit: 'year', format: 'year' },
      { unit: 'quarter', format: 'quarter' },
    ],
    timeResolution: { unit: 'week', increment: 1 },
  },
  {
    id: 'manyYears',
    tickUnit: 'year',
    tickIncrement: 1,
    tickWidth: 72,
    headers: [
      { unit: 'year', increment: 5, format: 'year' },
      { unit: 'year', format: 'year' },
    ],
    timeResolution: { unit: 'month', increment: 1 },
  },
]);

export const DEFAULT_PRESET_ID = 'weekAndDay';

/**
 * Increments must divide the next larger unit evenly (6 hours, not 5), so cells and ticks line up with
 * natural boundaries wherever you start counting. Days, weeks and years can use any whole number.
 */
const ALLOWED_INCREMENTS: Partial<Record<TimeUnit, readonly number[]>> = {
  millisecond: [1, 2, 4, 5, 8, 10, 20, 25, 40, 50, 100, 125, 200, 250, 500],
  second: [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30],
  minute: [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30],
  hour: [1, 2, 3, 4, 6, 8, 12],
  month: [1, 2, 3, 4, 6],
  quarter: [1, 2],
};

function assertUnitAndIncrement(unit: unknown, increment: unknown, owner: string): void {
  if (!isTimeUnit(unit)) throw new QuartzioError(`${owner}: "${String(unit)}" is not a time unit.`);
  if (typeof increment !== 'number' || !Number.isInteger(increment) || increment < 1) {
    throw new QuartzioError(`${owner}: increment must be a whole number >= 1.`);
  }
  const allowed = ALLOWED_INCREMENTS[unit];
  if (allowed && !allowed.includes(increment)) {
    throw new QuartzioError(`${owner}: a "${unit}" increment must be one of ${allowed.join(', ')}.`);
  }
}

/** Looks up a built-in preset by id, or validates a custom one. */
export function resolvePreset(preset: string | ViewPreset = DEFAULT_PRESET_ID): ViewPreset {
  if (typeof preset === 'string') {
    const found = VIEW_PRESETS.find((candidate) => candidate.id === preset);
    if (!found) {
      throw new QuartzioError(
        `Unknown view preset "${preset}". Built-in presets: ${VIEW_PRESETS.map((p) => p.id).join(', ')}.`,
      );
    }
    return found;
  }

  const owner = `View preset "${String((preset as Partial<ViewPreset> | null)?.id)}"`;
  if (typeof preset !== 'object' || typeof preset.id !== 'string' || preset.id === '') {
    throw new QuartzioError('A view preset needs a non-empty string id.');
  }
  if (typeof preset.tickWidth !== 'number' || !Number.isFinite(preset.tickWidth) || preset.tickWidth <= 0) {
    throw new QuartzioError(`${owner}: tickWidth must be a number above 0.`);
  }
  assertUnitAndIncrement(preset.tickUnit, preset.tickIncrement, `${owner} (ticks)`);
  const resolution = preset.timeResolution as ViewPreset['timeResolution'] | undefined;
  assertUnitAndIncrement(resolution?.unit, resolution?.increment, `${owner} (timeResolution)`);
  if (!Array.isArray(preset.headers) || preset.headers.length === 0) {
    throw new QuartzioError(`${owner}: headers must be a non-empty array.`);
  }
  preset.headers.forEach((row: HeaderRow, index) => {
    const rowOwner = `${owner} (header row ${String(index)})`;
    assertUnitAndIncrement(row.unit, row.increment ?? 1, rowOwner);
    if (typeof row.format !== 'function' && !HEADER_FORMATS.includes(row.format)) {
      throw new QuartzioError(`${rowOwner}: unknown format "${row.format}".`);
    }
  });
  return preset;
}
