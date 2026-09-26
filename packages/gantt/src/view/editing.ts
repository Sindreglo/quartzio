import { workingMsPerUnit } from '../calendar/duration';
import type { Transaction } from '../data/transaction';
import type { Id, ProjectSettings, Task } from '../data/types';
import type { TimeUnit } from '../util/time';
import { daysInMonth } from '../util/civil';
import { fromWallTime, startOfUnit, toWallTime, type TimeZone } from '../util/zone';
import type { BuiltInColumnId } from './columns';
import type { TaskDates } from './dates';
import type { ProposedChange } from './interaction';

/** The kind of field a cell is edited in. */
export type EditKind = 'text' | 'duration' | 'percent' | 'date' | 'datetime';

/** The cell being edited (see ADR 0011). */
export interface CellEdit {
  readonly taskId: Id;
  /** Key of the task's row. */
  readonly rowKey: string;
  readonly columnId: string;
  readonly kind: EditKind;
  /** What's in the field now. */
  readonly text: string;
  /** Why the last attempt to save was refused, until the text changes. */
  readonly error: string | null;
}

/** Dates must stay within what the data accepts. */
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;
const SUB_DAY = new Set<TimeUnit>(['millisecond', 'second', 'minute', 'hour']);
/**
 * Longer durations and spans are refused: most likely a typo (a year off by decades), and the scheduler can't
 * place tasks that long (it would keep the old dates).
 */
export const MAX_WORKING_DAYS = 5000;
const MAX_SPAN_YEARS = 20;
const MAX_SPAN = MAX_SPAN_YEARS * 365.25 * 24 * 60 * 60 * 1000;

/** Dates are edited with a time when the time axis resolves to less than a day. */
export const dateKind = (resolution: TimeUnit): 'date' | 'datetime' =>
  SUB_DAY.has(resolution) ? 'datetime' : 'date';

/** The field a cell is edited in, or `null` when it can't be edited. */
export function editKind(
  field: BuiltInColumnId | null,
  task: Task,
  isParent: boolean,
  dates: TaskDates | null,
  dateField: 'date' | 'datetime',
): EditKind | null {
  if (field === null) return null;
  if (field === 'name') return 'text';
  // A parent's dates, duration and progress roll up from its children.
  if (isParent) return null;
  switch (field) {
    case 'startDate':
      return dateField;
    case 'endDate':
      // A milestone has one date; an unscheduled task has no start to end after.
      return dates && dates.end > dates.start ? dateField : null;
    case 'duration':
      return 'duration';
    case 'percentDone':
      return 'percent';
  }
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** A time as an `<input type="date">` or `datetime-local` value, in the project's time zone. */
export function inputValue(time: number, kind: 'date' | 'datetime', zone: TimeZone): string {
  const wall = toWallTime(time, zone);
  const date = `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
  return kind === 'date' ? date : `${date}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

// Units as MS Project writes them; `m` is minutes, `mo` months.
const UNIT_ABBREVIATIONS: Record<TimeUnit, string> = {
  millisecond: 'ms',
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  week: 'w',
  month: 'mo',
  quarter: 'q',
  year: 'y',
};
const UNIT_NAMES: Record<string, TimeUnit> = {
  ms: 'millisecond',
  millisecond: 'millisecond',
  milliseconds: 'millisecond',
  s: 'second',
  sec: 'second',
  secs: 'second',
  second: 'second',
  seconds: 'second',
  m: 'minute',
  min: 'minute',
  mins: 'minute',
  minute: 'minute',
  minutes: 'minute',
  h: 'hour',
  hr: 'hour',
  hrs: 'hour',
  hour: 'hour',
  hours: 'hour',
  d: 'day',
  day: 'day',
  days: 'day',
  w: 'week',
  wk: 'week',
  wks: 'week',
  week: 'week',
  weeks: 'week',
  mo: 'month',
  mon: 'month',
  month: 'month',
  months: 'month',
  q: 'quarter',
  quarter: 'quarter',
  quarters: 'quarter',
  y: 'year',
  yr: 'year',
  yrs: 'year',
  year: 'year',
  years: 'year',
};

/** What the field shows when editing starts. */
export function initialText(
  field: BuiltInColumnId,
  kind: EditKind,
  task: Task,
  dates: TaskDates | null,
  zone: TimeZone,
): string {
  switch (field) {
    case 'name':
      return task.name;
    case 'startDate':
      return dates && kind !== 'text'
        ? inputValue(dates.start, kind === 'date' ? 'date' : 'datetime', zone)
        : '';
    case 'endDate': {
      if (!dates) return '';
      if (kind === 'datetime') return inputValue(dates.end, 'datetime', zone);
      // As in the column: an end at midnight is the end of the day before.
      return inputValue(atMidnight(dates, zone) ? dates.end - 1 : dates.end, 'date', zone);
    }
    case 'duration':
      return task.duration === null ? '' : durationText(task.duration, task.durationUnit);
    case 'percentDone':
      return String(task.percentDone);
  }
}

/** A duration as the field shows it, e.g. `4d` or `-1.5h`. */
export const durationText = (value: number, unit: TimeUnit): string =>
  `${String(Math.round(value * 100) / 100)}${UNIT_ABBREVIATIONS[unit]}`;

const atMidnight = (dates: TaskDates, zone: TimeZone) =>
  dates.end > dates.start && startOfUnit(dates.end, 'day', zone) === dates.end;

/** What an edit changes, and the change to propose to `validateChange` once it's planned. */
export interface ParsedEdit {
  readonly change: (tx: Transaction) => void;
  /**
   * The change for `validateChange`: the task as it is (as a drag gives it), with where the plan puts it
   * (`dates`, after the change). `null` for nothing to validate.
   */
  readonly propose: (task: Task, dates: TaskDates | null) => ProposedChange | null;
}

/** Reads the field's text into a change, or says why it can't. Never throws. */
export function parseEdit(
  field: BuiltInColumnId,
  kind: EditKind,
  text: string,
  task: Task,
  dates: TaskDates | null,
  settings: ProjectSettings,
): ParsedEdit | { readonly error: string } {
  const id = task.id;
  const zone = settings.timeZone;
  switch (field) {
    case 'name':
      return {
        change: (tx) => {
          tx.tasks.update(id, { name: text });
        },
        propose: () => null,
      };
    case 'startDate': {
      const wall = parseInputDate(text, kind);
      if (typeof wall === 'string') return { error: wall };
      // A date alone keeps a manual task's time of day (an automatic one starts on the day's first working time).
      const old = dates && kind === 'date' && task.manuallyScheduled ? toWallTime(dates.start, zone) : null;
      const start = fromWallTime(old ? { ...wall, hour: old.hour, minute: old.minute } : wall, zone);
      // Without a duration, a start alone would make it a milestone.
      const duration = task.duration === null ? { duration: 1 } : {};
      return {
        change: (tx) => {
          if (task.manuallyScheduled) tx.tasks.update(id, { startDate: start, ...duration });
          else
            tx.tasks.update(id, { constraintType: 'startnoearlierthan', constraintDate: start, ...duration });
        },
        propose: (before, next) =>
          next ? { kind: 'move', task: before, start: next.start, end: next.end } : null,
      };
    }
    case 'endDate': {
      if (!dates) return { error: 'Set a start date first.' };
      const wall = parseInputDate(text, kind);
      if (typeof wall === 'string') return { error: wall };
      let end: number;
      if (kind === 'datetime') {
        end = fromWallTime(wall, zone);
      } else if (atMidnight(dates, zone)) {
        // The whole day: up to the next midnight.
        end = fromWallTime({ ...wall, day: wall.day + 1 }, zone);
      } else {
        const old = toWallTime(dates.end, zone);
        end = fromWallTime({ ...wall, hour: old.hour, minute: old.minute }, zone);
      }
      if (end <= dates.start) return { error: 'The end must be after the start.' };
      if (end - dates.start > MAX_SPAN) {
        return { error: `A task can span at most ${String(MAX_SPAN_YEARS)} years.` };
      }
      return {
        change: (tx) => {
          tx.tasks.update(id, { endDate: end });
        },
        propose: (before, next) =>
          next ? { kind: 'resize', task: before, start: next.start, end: next.end } : null,
      };
    }
    case 'duration': {
      const parsed = parseDuration(text, task.durationUnit);
      if (typeof parsed === 'string') return { error: parsed };
      const days =
        (parsed.value * workingMsPerUnit(parsed.unit, settings)) / workingMsPerUnit('day', settings);
      if (!(days <= MAX_WORKING_DAYS)) {
        return { error: `Enter a duration of at most ${String(MAX_WORKING_DAYS)} working days.` };
      }
      return {
        change: (tx) => {
          tx.tasks.update(id, { duration: parsed.value, durationUnit: parsed.unit });
        },
        propose: (before, next) =>
          next ? { kind: 'resize', task: before, start: next.start, end: next.end } : null,
      };
    }
    case 'percentDone': {
      const match = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(text);
      const value = match ? Number((match[1] as string).replace(',', '.')) : Number.NaN;
      if (!(value >= 0 && value <= 100)) return { error: 'Enter a percentage from 0 to 100.' };
      return {
        change: (tx) => {
          tx.tasks.update(id, { percentDone: value });
        },
        propose: (before) => ({ kind: 'progress', task: before, percentDone: value }),
      };
    }
  }
}

/** A duration like `4d`, `2 weeks` or `1,5` (in the task's unit). */
export function parseDuration(text: string, fallback: TimeUnit): { value: number; unit: TimeUnit } | string {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*([a-z]*)\s*$/i.exec(text);
  const message = 'Enter a duration, like 4d, 2w or 3h.';
  if (!match) return message;
  const value = Number((match[1] as string).replace(',', '.'));
  const name = (match[2] as string).toLowerCase();
  const unit = name === '' ? fallback : UNIT_NAMES[name];
  if (unit === undefined || !Number.isFinite(value)) return message;
  return { value, unit };
}

/** The wall-clock date (and time) of an `<input type="date">` or `datetime-local` value. */
export function parseInputDate(
  text: string,
  kind: EditKind,
): { year: number; month: number; day: number; hour: number; minute: number } | string {
  const match =
    kind === 'datetime'
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text.trim())
      : /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return kind === 'datetime' ? 'Enter a date and time.' : 'Enter a date.';
  const [year, month, day, hour = 0, minute = 0] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number?,
    number?,
  ];
  if (year < MIN_YEAR || year > MAX_YEAR)
    return `Enter a year from ${String(MIN_YEAR)} to ${String(MAX_YEAR)}.`;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59) {
    return 'That date does not exist.';
  }
  return { year, month, day, hour, minute };
}
