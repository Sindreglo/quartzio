import { workingMsPerUnit } from '../calendar/duration';
import type { WorkingCalendar } from '../calendar/workingCalendar';
import type { ProjectSettings, Task } from '../data/types';
import type { TaskDates } from './dates';
import { QuartzioError } from '../util/errors';
import { formatDate, formatDuration, formatEndDate, formatPercent } from './cells';

export type BuiltInColumnId = 'name' | 'startDate' | 'endDate' | 'duration' | 'percentDone';

/** What a cell's value function gets. */
export interface CellContext {
  readonly task: Task;
  /** Whether the task has children (its dates then span its descendants). */
  readonly isParent: boolean;
  /** Computed display dates, or `null` for unscheduled tasks. */
  readonly dates: TaskDates | null;
  readonly settings: ProjectSettings;
  readonly locale: string | undefined;
  /** The project calendar, e.g. to measure working time. Absent if it can't be used. */
  readonly calendar: WorkingCalendar | undefined;
}

export interface ColumnDefinition {
  id: string;
  title?: string;
  /** Pixels. */
  width?: number;
  /** A built-in column to base this one on (its title, width and value). */
  field?: BuiltInColumnId;
  align?: 'start' | 'end';
  /** Cell text. Must not throw (errors leave the cell empty). */
  value?: (cell: CellContext) => string;
  /**
   * Whether cells can be edited (double-click, Enter/F2). Default `true` for columns with a `field` (the edit
   * writes that field), and always `false` without one.
   */
  editable?: boolean;
}

export type ColumnInput = BuiltInColumnId | ColumnDefinition;

export interface Column {
  readonly id: string;
  readonly title: string;
  readonly width: number;
  /** Left edge within the task list. */
  readonly x: number;
  readonly align: 'start' | 'end';
  /** The column that shows the tree (indentation and expand/collapse). */
  readonly tree: boolean;
  /** Its cells can be edited (some cells still can't, e.g. a parent's dates). */
  readonly editable: boolean;
}

export interface ColumnsState {
  readonly items: readonly Column[];
  /** Width of the task list. */
  readonly totalWidth: number;
}

export interface ResolvedColumns {
  readonly state: ColumnsState;
  readonly values: readonly ((cell: CellContext) => string)[];
  /** The field each column edits, or `null` when it can't be edited. */
  readonly fields: readonly (BuiltInColumnId | null)[];
}

interface BuiltIn {
  title: string;
  width: number;
  align: 'start' | 'end';
  value: (cell: CellContext) => string;
}

const zoneOf = (cell: CellContext) => cell.settings.timeZone;

const BUILT_IN: Record<BuiltInColumnId, BuiltIn> = {
  name: { title: 'Name', width: 240, align: 'start', value: ({ task }) => task.name },
  startDate: {
    title: 'Start',
    width: 120,
    align: 'start',
    value: (cell) => (cell.dates ? formatDate(cell.dates.start, zoneOf(cell), cell.locale) : ''),
  },
  endDate: {
    title: 'End',
    width: 120,
    align: 'start',
    value: (cell) =>
      cell.dates ? formatEndDate(cell.dates.start, cell.dates.end, zoneOf(cell), cell.locale) : '',
  },
  duration: {
    title: 'Duration',
    width: 100,
    align: 'end',
    value: ({ task, isParent, dates, settings, locale, calendar }) => {
      // A parent's dates span its children, so its own duration would contradict the dates shown.
      if (task.duration !== null && !isParent)
        return formatDuration(task.duration, task.durationUnit, locale);
      // Otherwise: the working time its dates span, in days.
      if (!dates || !calendar) return '';
      const days = calendar.workingTimeBetween(dates.start, dates.end) / workingMsPerUnit('day', settings);
      return formatDuration(days, 'day', locale);
    },
  },
  percentDone: {
    title: '% Done',
    width: 80,
    align: 'end',
    value: ({ task, locale }) => formatPercent(task.percentDone, locale),
  },
};

/** A built-in column's text for a cell (also used by the task tooltip). */
export const builtInText = (field: BuiltInColumnId, cell: CellContext): string => BUILT_IN[field].value(cell);

export const DEFAULT_COLUMNS: readonly BuiltInColumnId[] = ['name', 'startDate', 'endDate', 'duration'];

const isBuiltIn = (value: unknown): value is BuiltInColumnId =>
  typeof value === 'string' && Object.hasOwn(BUILT_IN, value);

/** Validates columns; throws QuartzioError for invalid definitions. */
export function resolveColumns(input: readonly ColumnInput[] = DEFAULT_COLUMNS): ResolvedColumns {
  // Input may come from plain JavaScript, so check it as unknown.
  const entries: unknown = input;
  if (!Array.isArray(entries)) throw new QuartzioError('Gantt options: "columns" must be an array.');
  const ids = new Set<string>();
  const items: Column[] = [];
  const values: ((cell: CellContext) => string)[] = [];
  const fields: (BuiltInColumnId | null)[] = [];
  let x = 0;

  for (const entry of entries as readonly ColumnInput[]) {
    if (typeof entry !== 'string' && (typeof entry !== 'object' || (entry as unknown) === null)) {
      throw new QuartzioError('Every column must be a built-in column id or a column definition object.');
    }
    const definition: ColumnDefinition = typeof entry === 'string' ? { id: entry, field: entry } : entry;
    if (typeof entry === 'string' && !isBuiltIn(entry)) {
      throw new QuartzioError(
        `Unknown column "${String(entry)}". Built-in columns: ${Object.keys(BUILT_IN).join(', ')}.`,
      );
    }
    const { id, field } = definition;
    if (typeof id !== 'string' || id === '')
      throw new QuartzioError('Every column needs a non-empty string id.');
    if (ids.has(id)) throw new QuartzioError(`Column "${id}" is defined more than once.`);
    if (field !== undefined && !isBuiltIn(field))
      throw new QuartzioError(`Column "${id}": unknown field "${String(field)}".`);
    const builtIn = field ? BUILT_IN[field] : undefined;
    if (definition.value !== undefined && typeof definition.value !== 'function') {
      throw new QuartzioError(`Column "${id}": "value" must be a function.`);
    }
    if (definition.title !== undefined && typeof definition.title !== 'string') {
      throw new QuartzioError(`Column "${id}": "title" must be a string.`);
    }
    const editableInput: unknown = definition.editable;
    if (editableInput !== undefined && typeof editableInput !== 'boolean') {
      throw new QuartzioError(`Column "${id}": "editable" must be true or false.`);
    }
    const editable = field !== undefined && editableInput !== false;
    const align: unknown = definition.align;
    if (align !== undefined && align !== 'start' && align !== 'end') {
      throw new QuartzioError(`Column "${id}": "align" must be "start" or "end".`);
    }
    const value = definition.value ?? builtIn?.value;
    if (!value) throw new QuartzioError(`Column "${id}" needs a "field" or a "value" function.`);
    const width = definition.width ?? builtIn?.width ?? 120;
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || width > 4000) {
      throw new QuartzioError(`Column "${id}": width must be a number above 0 and at most 4000.`);
    }

    ids.add(id);
    items.push({
      id,
      title: definition.title ?? builtIn?.title ?? id,
      width,
      x,
      align: definition.align ?? builtIn?.align ?? 'start',
      tree: field === 'name',
      editable,
    });
    fields.push(editable ? field : null);
    // A bug in a custom value function must not break rendering.
    values.push((cell) => {
      try {
        const text: unknown = value(cell);
        if (typeof text === 'string') return text;
        // Numbers and booleans read fine as text; anything else (null, objects) becomes an empty cell.
        return typeof text === 'number' || typeof text === 'boolean' ? String(text) : '';
      } catch {
        return '';
      }
    });
    x += width;
  }
  return { state: { items, totalWidth: x }, values, fields };
}
