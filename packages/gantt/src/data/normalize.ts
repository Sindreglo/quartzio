import { deepFreeze, isEqual } from '../util/equal';
import { QuartzioError } from '../util/errors';
import { parseCivilDate, parseDateString, parseTimeOfDay } from '../util/parse';
import { isTimeUnit, type TimeUnit } from '../util/time';
import { assertTimeZone, type TimeZone } from '../util/zone';
import type {
  Calendar,
  CalendarException,
  CalendarExceptionInput,
  CalendarInput,
  DateInput,
  Dependency,
  DependencyInput,
  DependencyType,
  Id,
  ProjectInput,
  ProjectSettings,
  ProjectSettingsInput,
  ProjectState,
  Table,
  Task,
  TaskInput,
  Weekday,
  WorkingInterval,
} from './types';

const DEPENDENCY_TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

/** Index = weekday number (0 = Sunday), matching `Date` and `weekStartsOn`. */
export const WEEKDAYS: readonly Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export const DEFAULT_DURATION_UNIT: TimeUnit = 'day';
export const DEFAULT_LAG_UNIT: TimeUnit = 'day';

export const DEFAULT_SETTINGS: ProjectSettings = deepFreeze({
  timeZone: 'local',
  calendarId: null,
  hoursPerDay: 8,
  daysPerWeek: 5,
  daysPerMonth: 20,
  weekStartsOn: 1,
});

const OFFICE_HOURS: readonly WorkingInterval[] = [{ start: '08:00', end: '16:00' }];

/** Used when `settings.calendarId` is `null`: Monday–Friday 08:00–16:00, no exceptions. */
export const STANDARD_CALENDAR: Calendar = deepFreeze({
  id: 'standard',
  name: 'Standard',
  week: {
    sunday: [],
    monday: OFFICE_HOURS,
    tuesday: OFFICE_HOURS,
    wednesday: OFFICE_HOURS,
    thursday: OFFICE_HOURS,
    friday: OFFICE_HOURS,
    saturday: [],
  },
  exceptions: [],
});

const label = (kind: string, id: Id): string => `${kind} "${String(id)}"`;

export function isId(value: unknown): value is Id {
  return (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value));
}

// --- Fields ---

/** Dates must fall in the years 1000–9999; anything outside is almost certainly a typo. */
const MIN_TIME = Date.UTC(1000, 0, 1);
const MAX_TIME = Date.UTC(10_000, 0, 1) - 1;

export function toTime(
  value: DateInput | null | undefined,
  field: string,
  owner: string,
  zone: TimeZone,
): number | null {
  if (value === null || value === undefined) return null;
  const time =
    typeof value === 'string'
      ? parseDateString(value, zone)
      : value instanceof Date
        ? value.getTime()
        : value;
  if (typeof time !== 'number' || !Number.isFinite(time)) {
    throw new QuartzioError(
      `${owner}: "${field}" must be a valid Date, epoch milliseconds or an ISO 8601 string like "2026-10-05".`,
    );
  }
  if (time < MIN_TIME || time > MAX_TIME) {
    throw new QuartzioError(`${owner}: "${field}" must be between the years 1000 and 9999.`);
  }
  return time;
}

function toName(value: unknown, owner: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new QuartzioError(`${owner}: "name" must be a string.`);
  return value;
}

function toDuration(value: number | null | undefined, owner: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new QuartzioError(`${owner}: "duration" must be a finite number >= 0.`);
  }
  return value;
}

function toPercent(value: number | undefined, owner: string): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new QuartzioError(`${owner}: "percentDone" must be between 0 and 100.`);
  }
  return value;
}

function toUnit(value: TimeUnit | undefined, fallback: TimeUnit, field: string, owner: string): TimeUnit {
  if (value === undefined) return fallback;
  if (!isTimeUnit(value)) throw new QuartzioError(`${owner}: "${field}" is not a valid time unit.`);
  return value;
}

// --- Tasks ---

export type TaskFieldsInput = Omit<TaskInput, 'id' | 'parentId' | 'children'>;
export type TaskFields = Omit<Task, 'id' | 'parentId'>;

export function normalizeTaskFields(input: TaskFieldsInput, owner: string, zone: TimeZone): TaskFields {
  return {
    name: toName(input.name, owner),
    startDate: toTime(input.startDate, 'startDate', owner, zone),
    endDate: toTime(input.endDate, 'endDate', owner, zone),
    duration: toDuration(input.duration, owner),
    durationUnit: toUnit(input.durationUnit, DEFAULT_DURATION_UNIT, 'durationUnit', owner),
    percentDone: toPercent(input.percentDone, owner),
  };
}

/** Normalizes only the fields present in `input` (for updates). */
export function normalizeTaskChanges(
  input: TaskFieldsInput,
  owner: string,
  zone: TimeZone,
): Partial<TaskFields> {
  const changes: { -readonly [K in keyof TaskFields]?: TaskFields[K] } = {};
  if (input.name !== undefined) changes.name = toName(input.name, owner);
  if (input.startDate !== undefined) changes.startDate = toTime(input.startDate, 'startDate', owner, zone);
  if (input.endDate !== undefined) changes.endDate = toTime(input.endDate, 'endDate', owner, zone);
  if (input.duration !== undefined) changes.duration = toDuration(input.duration, owner);
  if (input.durationUnit !== undefined) {
    changes.durationUnit = toUnit(input.durationUnit, DEFAULT_DURATION_UNIT, 'durationUnit', owner);
  }
  if (input.percentDone !== undefined) changes.percentDone = toPercent(input.percentDone, owner);
  return changes;
}

/** Structure is changed with `position`/`move`, not with fields; catch data passed in by mistake. */
export function assertNoStructureFields(input: object, owner: string): void {
  if ('children' in input) {
    throw new QuartzioError(
      `${owner}: "children" is not supported here. Add child tasks with a parentId position.`,
    );
  }
  if ('parentId' in input) {
    throw new QuartzioError(
      `${owner}: "parentId" is not supported here. Use a position ({ parentId }) or move().`,
    );
  }
}

export function assertTaskDates(task: Task): void {
  if (task.startDate !== null && task.endDate !== null && task.endDate < task.startDate) {
    throw new QuartzioError(`${label('Task', task.id)}: "endDate" is before "startDate".`);
  }
}

// --- Dependencies ---

export type DependencyFieldsInput = Omit<DependencyInput, 'id' | 'from' | 'to'>;
export type DependencyFields = Omit<Dependency, 'id' | 'from' | 'to'>;

function toDependencyType(value: DependencyType | undefined, owner: string): DependencyType {
  if (value === undefined) return 'FS';
  if (!DEPENDENCY_TYPES.includes(value)) {
    throw new QuartzioError(`${owner}: "type" must be one of ${DEPENDENCY_TYPES.join(', ')}.`);
  }
  return value;
}

function toLag(value: number | undefined, owner: string): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value)) throw new QuartzioError(`${owner}: "lag" must be a finite number.`);
  return value;
}

export function normalizeDependencyFields(input: DependencyFieldsInput, owner: string): DependencyFields {
  return {
    type: toDependencyType(input.type, owner),
    lag: toLag(input.lag, owner),
    lagUnit: toUnit(input.lagUnit, DEFAULT_LAG_UNIT, 'lagUnit', owner),
  };
}

export function normalizeDependencyChanges(
  input: DependencyFieldsInput,
  owner: string,
): Partial<DependencyFields> {
  const changes: { -readonly [K in keyof DependencyFields]?: DependencyFields[K] } = {};
  if (input.type !== undefined) changes.type = toDependencyType(input.type, owner);
  if (input.lag !== undefined) changes.lag = toLag(input.lag, owner);
  if (input.lagUnit !== undefined)
    changes.lagUnit = toUnit(input.lagUnit, DEFAULT_LAG_UNIT, 'lagUnit', owner);
  return changes;
}

export function assertDependencyEnds(tasks: Table<Task>['byId'], from: Id, to: Id, owner: string): void {
  if (!tasks.has(from)) throw new QuartzioError(`${owner}: "from" task "${String(from)}" does not exist.`);
  if (!tasks.has(to)) throw new QuartzioError(`${owner}: "to" task "${String(to)}" does not exist.`);
  if (from === to) throw new QuartzioError(`${owner}: a task cannot depend on itself.`);
}

// --- Settings ---

function toPositive(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    throw new QuartzioError(
      `Project settings: "${field}" must be a number above 0 and at most ${String(max)}.`,
    );
  }
  return value;
}

/** Normalizes only the settings present in `input`. */
export function normalizeSettingsChanges(input: ProjectSettingsInput): Partial<ProjectSettings> {
  const changes: { -readonly [K in keyof ProjectSettings]?: ProjectSettings[K] } = {};
  if (input.timeZone !== undefined) {
    assertTimeZone(input.timeZone);
    changes.timeZone = input.timeZone;
  }
  if (input.calendarId !== undefined) {
    if (input.calendarId !== null && !isId(input.calendarId)) {
      throw new QuartzioError('Project settings: "calendarId" must be a calendar id or null.');
    }
    changes.calendarId = input.calendarId;
  }
  if (input.hoursPerDay !== undefined) changes.hoursPerDay = toPositive(input.hoursPerDay, 'hoursPerDay', 24);
  if (input.daysPerWeek !== undefined) changes.daysPerWeek = toPositive(input.daysPerWeek, 'daysPerWeek', 7);
  if (input.daysPerMonth !== undefined)
    changes.daysPerMonth = toPositive(input.daysPerMonth, 'daysPerMonth', 31);
  if (input.weekStartsOn !== undefined) {
    if (!Number.isInteger(input.weekStartsOn) || input.weekStartsOn < 0 || input.weekStartsOn > 6) {
      throw new QuartzioError(
        'Project settings: "weekStartsOn" must be an integer from 0 (Sunday) to 6 (Saturday).',
      );
    }
    changes.weekStartsOn = input.weekStartsOn;
  }
  return changes;
}

export function normalizeSettings(input: ProjectSettingsInput = {}): ProjectSettings {
  return { ...DEFAULT_SETTINGS, ...normalizeSettingsChanges(input) };
}

// --- Calendars ---

function normalizeIntervals(input: unknown, owner: string): readonly WorkingInterval[] {
  if (!Array.isArray(input)) throw new QuartzioError(`${owner}: working intervals must be an array.`);
  const parsed = (input as unknown[]).map((interval) => {
    const { start, end } = (interval ?? {}) as Partial<WorkingInterval>;
    const from = typeof start === 'string' ? parseTimeOfDay(start) : null;
    const to = typeof end === 'string' ? parseTimeOfDay(end) : null;
    if (from === null || to === null || from >= to) {
      throw new QuartzioError(
        `${owner}: working intervals need "start" before "end", as "HH:mm" (e.g. { start: "08:00", end: "16:00" }).`,
      );
    }
    return { start: start as string, end: end as string, from, to };
  });
  parsed.sort((a, b) => a.from - b.from);
  for (let i = 1; i < parsed.length; i++) {
    if ((parsed[i] as { from: number }).from < (parsed[i - 1] as { to: number }).to) {
      throw new QuartzioError(`${owner}: working intervals overlap.`);
    }
  }
  return parsed.map(({ start, end }) => ({ start, end }));
}

function normalizeWeek(input: CalendarInput['week'], owner: string): Calendar['week'] {
  if (input === undefined) return STANDARD_CALENDAR.week;
  const week = {} as Record<Weekday, readonly WorkingInterval[]>;
  for (const day of WEEKDAYS) week[day] = normalizeIntervals(input[day] ?? [], `${owner} (${day})`);
  for (const key of Object.keys(input)) {
    if (!(WEEKDAYS as readonly string[]).includes(key)) {
      throw new QuartzioError(`${owner}: "${key}" is not a weekday. Use ${WEEKDAYS.join(', ')}.`);
    }
  }
  return week;
}

function normalizeException(input: CalendarExceptionInput, owner: string): CalendarException {
  const endDate = input.endDate ?? input.startDate;
  const start = typeof input.startDate === 'string' ? parseCivilDate(input.startDate) : null;
  const end = typeof endDate === 'string' ? parseCivilDate(endDate) : null;
  if (start === null || end === null) {
    throw new QuartzioError(`${owner}: exception dates must be "YYYY-MM-DD".`);
  }
  if (end < start) throw new QuartzioError(`${owner}: exception "endDate" is before "startDate".`);
  return {
    startDate: input.startDate,
    endDate,
    name: toName(input.name, owner),
    intervals: normalizeIntervals(input.intervals ?? [], owner),
  };
}

export type CalendarFieldsInput = Omit<CalendarInput, 'id'>;
export type CalendarFields = Omit<Calendar, 'id'>;

export function normalizeCalendarFields(input: CalendarFieldsInput, owner: string): CalendarFields {
  return {
    name: toName(input.name, owner),
    week: normalizeWeek(input.week, owner),
    exceptions: (input.exceptions ?? []).map((exception) => normalizeException(exception, owner)),
  };
}

export function normalizeCalendarChanges(input: CalendarFieldsInput, owner: string): Partial<CalendarFields> {
  const changes: { -readonly [K in keyof CalendarFields]?: CalendarFields[K] } = {};
  if (input.name !== undefined) changes.name = toName(input.name, owner);
  if (input.week !== undefined) changes.week = normalizeWeek(input.week, owner);
  if (input.exceptions !== undefined) {
    changes.exceptions = input.exceptions.map((exception) => normalizeException(exception, owner));
  }
  return changes;
}

function assertCalendarExists(calendars: ReadonlyMap<Id, Calendar>, calendarId: Id | null): void {
  if (calendarId !== null && !calendars.has(calendarId)) {
    throw new QuartzioError(`Project settings: calendar "${String(calendarId)}" does not exist.`);
  }
}

// --- Structure ---

/** Throws if placing task `id` under `parentId` would make the task its own ancestor. */
export function assertNoParentCycle(byId: ReadonlyMap<Id, Task>, id: Id, parentId: Id | null): void {
  let current = parentId;
  const seen = new Set<Id>();
  while (current !== null) {
    if (current === id) {
      throw new QuartzioError(`${label('Task', id)} cannot be placed inside its own subtree.`);
    }
    if (seen.has(current)) break; // pre-existing cycle elsewhere; reported by load validation
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
}

/** Throws unless every parent exists and no parent chain loops. O(n). */
function assertTaskHierarchy(tasks: ReadonlyMap<Id, Task>): void {
  const verified = new Set<Id>();
  for (const task of tasks.values()) {
    const chain = new Set<Id>();
    let current: Task = task;
    while (current.parentId !== null && !verified.has(current.id)) {
      chain.add(current.id);
      const parent = tasks.get(current.parentId);
      if (!parent) {
        throw new QuartzioError(
          `${label('Task', current.id)} has parentId "${String(current.parentId)}", which does not exist.`,
        );
      }
      if (chain.has(parent.id)) {
        throw new QuartzioError(`${label('Task', parent.id)} is part of a parent cycle.`);
      }
      current = parent;
    }
    for (const id of chain) verified.add(id);
  }
}

// --- Whole project ---

/** The first candidate structurally equal to `record`, or `record` itself. */
function reuse<R>(record: R, ...candidates: unknown[]): R {
  for (const candidate of candidates) {
    if (candidate !== undefined && isEqual(candidate, record)) return candidate as R;
  }
  return record;
}

/** The previous table when order and every record are unchanged, so downstream caches keep hitting. */
function reuseTable<R extends { readonly id: Id }>(
  table: Table<R>,
  previous: Table<R> | undefined,
): Table<R> {
  if (previous?.order.length !== table.order.length) return table;
  for (let i = 0; i < table.order.length; i++) {
    const id = table.order[i] as Id;
    if (previous.order[i] !== id || previous.byId.get(id) !== table.byId.get(id)) return table;
  }
  return previous;
}

/**
 * Normalizes and validates user input into an immutable ProjectState. Throws QuartzioError on invalid data.
 *
 * Unchanged records keep their identity: a record equal to the one in `previous` (or to the input object
 * itself, when that is already canonical) is reused, and so is a whole table when nothing in it changed.
 * That lets memoized views skip work after `load()`/`applyPatch()`. Treat data you pass in as immutable.
 */
export function createProjectState(input: ProjectInput = {}, previous?: ProjectState): ProjectState {
  const settings = reuse(normalizeSettings(input.settings), previous?.settings, input.settings);

  const calendars = new Map<Id, Calendar>();
  const calendarOrder: Id[] = [];
  for (const calendar of input.calendars ?? []) {
    if (!isId(calendar.id))
      throw new QuartzioError('Calendar id must be a non-empty string or a finite number.');
    const owner = label('Calendar', calendar.id);
    if (calendars.has(calendar.id)) throw new QuartzioError(`${owner} is defined more than once.`);
    const record: Calendar = { id: calendar.id, ...normalizeCalendarFields(calendar, owner) };
    calendars.set(calendar.id, reuse(record, previous?.calendars.byId.get(calendar.id), calendar));
    calendarOrder.push(calendar.id);
  }
  assertCalendarExists(calendars, settings.calendarId);

  const tasks = new Map<Id, Task>();
  const taskOrder: Id[] = [];
  // Depth-first with an explicit stack (not recursion), so deeply nested input can't overflow the stack.
  const stack: [TaskInput, Id | undefined][] = [...(input.tasks ?? [])]
    .reverse()
    .map((task): [TaskInput, Id | undefined] => [task, undefined]);
  while (stack.length > 0) {
    const [task, nestedParent] = stack.pop() as [TaskInput, Id | undefined];
    if (!isId(task.id)) throw new QuartzioError('Task id must be a non-empty string or a finite number.');
    const owner = label('Task', task.id);
    if (tasks.has(task.id)) throw new QuartzioError(`${owner} is defined more than once.`);
    if (nestedParent !== undefined && task.parentId != null && task.parentId !== nestedParent) {
      throw new QuartzioError(
        `${owner} is nested under "${String(nestedParent)}" but has parentId "${String(task.parentId)}".`,
      );
    }
    const record: Task = {
      id: task.id,
      parentId: nestedParent ?? task.parentId ?? null,
      ...normalizeTaskFields(task, owner, settings.timeZone),
    };
    assertTaskDates(record);
    tasks.set(task.id, reuse(record, previous?.tasks.byId.get(task.id), task));
    taskOrder.push(task.id);
    const children: unknown = task.children ?? [];
    if (!Array.isArray(children)) throw new QuartzioError(`${owner}: "children" must be an array.`);
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i] as TaskInput, task.id]);
  }
  assertTaskHierarchy(tasks);

  const dependencies = new Map<Id, Dependency>();
  const dependencyOrder: Id[] = [];
  for (const dependency of input.dependencies ?? []) {
    if (!isId(dependency.id)) {
      throw new QuartzioError('Dependency id must be a non-empty string or a finite number.');
    }
    const owner = label('Dependency', dependency.id);
    if (dependencies.has(dependency.id)) throw new QuartzioError(`${owner} is defined more than once.`);
    assertDependencyEnds(tasks, dependency.from, dependency.to, owner);
    const record: Dependency = {
      id: dependency.id,
      from: dependency.from,
      to: dependency.to,
      ...normalizeDependencyFields(dependency, owner),
    };
    dependencies.set(
      dependency.id,
      reuse(record, previous?.dependencies.byId.get(dependency.id), dependency),
    );
    dependencyOrder.push(dependency.id);
  }

  return {
    settings,
    calendars: reuseTable({ byId: calendars, order: calendarOrder }, previous?.calendars),
    tasks: reuseTable({ byId: tasks, order: taskOrder }, previous?.tasks),
    dependencies: reuseTable({ byId: dependencies, order: dependencyOrder }, previous?.dependencies),
  };
}

/** Records touched by operations from outside; only these get full field validation. */
export interface TouchedRecords {
  settings: boolean;
  calendars: ReadonlySet<Id>;
  tasks: ReadonlySet<Id>;
  dependencies: ReadonlySet<Id>;
}

function assertNormalized(record: object, expected: object, owner: string): void {
  if (!isEqual(record, expected)) {
    throw new QuartzioError(
      `${owner} is not a valid, normalized record (from an operation that was applied).`,
    );
  }
}

function assertValidSettings(settings: ProjectSettings): void {
  for (const [key, value] of Object.entries(settings)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key))
      throw new QuartzioError(`Project settings: unknown setting "${key}".`);
    if (value === undefined) throw new QuartzioError(`Project settings: "${key}" is undefined.`);
  }
  assertNormalized(settings, normalizeSettings(settings), 'Project settings');
}

/**
 * Checks the invariants of a state produced by applying operations from outside (undo stacks, servers).
 * Transactions keep these invariants by construction. Structure is checked in O(n); record fields only
 * for `touched` records (all records when omitted).
 */
export function assertValidState(state: ProjectState, touched?: TouchedRecords): void {
  const check = <R>(store: keyof Omit<TouchedRecords, 'settings'>, table: Table<R & { readonly id: Id }>) =>
    touched ? [...touched[store]].flatMap((id) => table.byId.get(id) ?? []) : [...table.byId.values()];

  if (!touched || touched.settings) assertValidSettings(state.settings);
  assertCalendarExists(state.calendars.byId, state.settings.calendarId);

  for (const calendar of check('calendars', state.calendars)) {
    const owner = label('Calendar', calendar.id);
    if (!isId(calendar.id)) throw new QuartzioError(`${owner}: invalid id.`);
    assertNormalized(calendar, { id: calendar.id, ...normalizeCalendarFields(calendar, owner) }, owner);
  }

  for (const task of check('tasks', state.tasks)) {
    const owner = label('Task', task.id);
    if (!isId(task.id) || (task.parentId !== null && !isId(task.parentId))) {
      throw new QuartzioError(`${owner}: invalid id or parentId.`);
    }
    // Stored dates are numbers, so the zone passed here doesn't matter; strings would fail the comparison.
    assertNormalized(
      task,
      { id: task.id, parentId: task.parentId, ...normalizeTaskFields(task, owner, 'UTC') },
      owner,
    );
    assertTaskDates(task);
  }
  assertTaskHierarchy(state.tasks.byId);

  const touchedDependencies = new Set(check('dependencies', state.dependencies));
  for (const dependency of state.dependencies.byId.values()) {
    const owner = label('Dependency', dependency.id);
    assertDependencyEnds(state.tasks.byId, dependency.from, dependency.to, owner);
    if (touchedDependencies.has(dependency)) {
      const { id, from, to } = dependency;
      assertNormalized(dependency, { id, from, to, ...normalizeDependencyFields(dependency, owner) }, owner);
    }
  }
}
