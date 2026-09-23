import { QuartzioError } from '../util/errors';
import { isoWeek, toWallTime } from '../util/zone';
import type { HeaderCellContext, HeaderFormat, HeaderFormatName } from './presets';

const INTL_OPTIONS: Partial<Record<HeaderFormatName, Intl.DateTimeFormatOptions>> = {
  year: { year: 'numeric' },
  month: { month: 'long' },
  monthShort: { month: 'short' },
  monthYear: { month: 'long', year: 'numeric' },
  monthShortYear: { month: 'short', year: 'numeric' },
  day: { day: 'numeric' },
  weekdayShort: { weekday: 'short' },
  weekdayNarrow: { weekday: 'narrow' },
  weekdayDay: { weekday: 'short', day: 'numeric' },
  dayMonth: { day: 'numeric', month: 'short' },
  weekdayDayMonth: { weekday: 'short', day: 'numeric', month: 'short' },
  hour: { hour: 'numeric' },
  hourMinute: { hour: '2-digit', minute: '2-digit' },
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(name: HeaderFormatName, cell: HeaderCellContext): Intl.DateTimeFormat {
  const key = `${name}|${cell.locale ?? ''}|${cell.timeZone}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    const options = INTL_OPTIONS[name] ?? {};
    formatter = new Intl.DateTimeFormat(
      cell.locale,
      cell.timeZone === 'local' ? options : { ...options, timeZone: cell.timeZone },
    );
    formatters.set(key, formatter);
  }
  return formatter;
}

/** Throws QuartzioError for malformed locale tags (unsupported but well-formed tags fall back silently). */
export function assertLocale(locale: unknown): void {
  try {
    if (typeof locale !== 'string') throw new TypeError();
    Intl.DateTimeFormat.supportedLocalesOf(locale);
  } catch {
    throw new QuartzioError(
      `"${String(locale)}" is not a valid locale. Use a BCP 47 tag such as "en-US" or "nb-NO".`,
    );
  }
}

export function formatHeaderCell(format: HeaderFormat, cell: HeaderCellContext): string {
  if (typeof format === 'function') {
    // A bug in a custom label must not break rendering (or leave the controller in a broken state).
    try {
      const label: unknown = format(cell);
      return typeof label === 'string' ? label : String(label);
    } catch {
      return '';
    }
  }
  switch (format) {
    case 'quarter':
    case 'quarterYear': {
      const { year, month } = toWallTime(cell.start, cell.timeZone);
      const quarter = `Q${String(Math.floor((month - 1) / 3) + 1)}`;
      return format === 'quarter' ? quarter : `${quarter} ${String(year)}`;
    }
    case 'week':
      // The middle of the cell, so weeks starting on Sunday still get the ISO number of their Mon–Sat.
      return `W${String(isoWeek(cell.start + (cell.end - cell.start) / 2, cell.timeZone).week)}`;
    default:
      return formatterFor(format, cell).format(cell.start);
  }
}
