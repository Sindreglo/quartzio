import { daysFromCivil, daysInMonth, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from './civil';
import { fromWallTime, type TimeZone } from './zone';

// YYYY-MM-DD, optionally followed by a time, optionally followed by an explicit offset.
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Parses an ISO 8601 date string. Without an offset ("2026-10-05", "2026-10-05T08:00") the string is a
 * wall-clock time in `zone`; with one ("…Z", "…+02:00") it is an absolute instant.
 * Returns `null` for anything else, including impossible dates like 2026-02-30.
 */
export function parseDateString(value: string, zone: TimeZone): number | null {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', ms = '0', offset] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  // More than three decimals (as written by .NET and PostgreSQL) are truncated to milliseconds.
  const millisecond = Number(ms.slice(0, 3).padEnd(3, '0'));

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  if (offset === undefined)
    return fromWallTime({ year, month, day, hour, minute, second, millisecond }, zone);

  const wallAsUtc =
    daysFromCivil(year, month, day) * MS_PER_DAY +
    hour * MS_PER_HOUR +
    minute * MS_PER_MINUTE +
    second * MS_PER_SECOND +
    millisecond;
  if (offset === 'Z') return wallAsUtc;
  const sign = offset.startsWith('-') ? -1 : 1;
  const digits = offset.slice(1).replace(':', '');
  const offsetHours = Number(digits.slice(0, 2));
  const extraMinutes = Number(digits.slice(2));
  if (offsetHours > 14 || extraMinutes > 59) return null;
  const offsetMinutes = offsetHours * 60 + extraMinutes;
  return wallAsUtc - sign * offsetMinutes * MS_PER_MINUTE;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" to a civil day number, or `null` if invalid. */
export function parseCivilDate(value: string): number | null {
  const match = ISO_DAY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return daysFromCivil(year, month, day);
}

const TIME_OF_DAY = /^(\d{2}):(\d{2})$/;

/** Parses "HH:mm" (00:00–24:00) to minutes since midnight, or `null` if invalid. */
export function parseTimeOfDay(value: string): number | null {
  const match = TIME_OF_DAY.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[2]) > 59 || minutes > 24 * 60) return null;
  return minutes;
}
