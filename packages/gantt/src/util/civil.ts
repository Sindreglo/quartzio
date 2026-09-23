// Calendar-date ("civil") arithmetic, independent of any time zone. A civil day number counts days
// since 1970-01-01; it names a date on the wall calendar, not an instant.

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE: number = 60 * MS_PER_SECOND;
export const MS_PER_HOUR: number = 60 * MS_PER_MINUTE;
export const MS_PER_DAY: number = 24 * MS_PER_HOUR;

export interface CivilDate {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
}

/** Day number for a date. Out-of-range months and days roll over (month 13 → January next year). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const date = new Date(0);
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0–99 to 1900–1999.
  date.setUTCFullYear(year, month - 1, day);
  return Math.round(date.getTime() / MS_PER_DAY);
}

export function civilFromDays(days: number): CivilDate {
  const date = new Date(days * MS_PER_DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayFromDays(days: number): number {
  // 1970-01-01 was a Thursday.
  return (((days + 4) % 7) + 7) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return daysFromCivil(year, month + 1, 1) - daysFromCivil(year, month, 1);
}
