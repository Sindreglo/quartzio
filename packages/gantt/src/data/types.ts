import type { TimeUnit } from '../util/time';
import type { TimeZone } from '../util/zone';

export type Id = string | number;

/**
 * A task as stored by the engine. Every field is always present; `null` means "not set".
 * Times are epoch milliseconds. End dates are exclusive.
 */
export interface Task {
  readonly id: Id;
  readonly parentId: Id | null;
  readonly name: string;
  readonly startDate: number | null;
  readonly endDate: number | null;
  readonly duration: number | null;
  readonly durationUnit: TimeUnit;
  /** 0–100 */
  readonly percentDone: number;
  /**
   * Uses its own dates: not moved by predecessors, and (for parents) not rolled up from its children. Still a
   * predecessor for others. Otherwise the task is scheduled automatically, as soon as possible.
   */
  readonly manuallyScheduled: boolean;
  /** Set together with `constraintDate` (both or neither). Ignored for manually scheduled tasks. */
  readonly constraintType: ConstraintType | null;
  readonly constraintDate: number | null;
}

/**
 * A scheduling constraint on a task. For now only "start no earlier than" (set when an automatically scheduled
 * task is dragged); the other types come with milestone 8.
 */
export type ConstraintType = 'startnoearlierthan';

/** Finish-to-start, start-to-start, finish-to-finish, start-to-finish. */
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Dependency {
  readonly id: Id;
  /** The predecessor task. */
  readonly from: Id;
  /** The successor task. */
  readonly to: Id;
  readonly type: DependencyType;
  readonly lag: number;
  readonly lagUnit: TimeUnit;
}

export type Weekday = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

/** Working time within a day, as wall-clock times "HH:mm". `end` is exclusive and may be "24:00". */
export interface WorkingInterval {
  readonly start: string;
  readonly end: string;
}

/** Overrides the weekly schedule for a range of dates (holidays, vacations, extra working days). */
export interface CalendarException {
  /** "YYYY-MM-DD", a date in the project's time zone. */
  readonly startDate: string;
  /** "YYYY-MM-DD", inclusive. */
  readonly endDate: string;
  readonly name: string;
  /** Working time on these dates. Empty means non-working. */
  readonly intervals: readonly WorkingInterval[];
}

export interface Calendar {
  readonly id: Id;
  readonly name: string;
  readonly week: Readonly<Record<Weekday, readonly WorkingInterval[]>>;
  /** Later exceptions win where they overlap earlier ones. */
  readonly exceptions: readonly CalendarException[];
}

export interface ProjectSettings {
  /** Time zone for wall-clock logic (working hours, midnight, date strings). */
  readonly timeZone: TimeZone;
  /** The project calendar; `null` uses the built-in standard calendar (Mon–Fri 08:00–16:00). */
  readonly calendarId: Id | null;
  /** Conversion factors for durations in working time. */
  readonly hoursPerDay: number;
  readonly daysPerWeek: number;
  readonly daysPerMonth: number;
  /** 0 = Sunday … 6 = Saturday. */
  readonly weekStartsOn: number;
  /**
   * Project start: automatically scheduled tasks start here at the earliest. When `null`, it's set to the
   * earliest task start the first time the project is scheduled.
   */
  readonly startDate: number | null;
}

// --- Input: what users may pass in. Looser than the stored records. ---

/**
 * A Date, epoch milliseconds, or an ISO 8601 string. Strings without an offset ("2026-10-05",
 * "2026-10-05T08:00") are wall-clock times in the project's time zone.
 */
export type DateInput = Date | number | string;

export interface TaskInput {
  id: Id;
  name?: string;
  /** Ignored for tasks nested in `children`, where the parent is implied. */
  parentId?: Id | null;
  children?: readonly TaskInput[];
  startDate?: DateInput | null;
  endDate?: DateInput | null;
  duration?: number | null;
  durationUnit?: TimeUnit;
  percentDone?: number;
  manuallyScheduled?: boolean;
  constraintType?: ConstraintType | null;
  constraintDate?: DateInput | null;
}

export interface DependencyInput {
  id: Id;
  from: Id;
  to: Id;
  type?: DependencyType;
  lag?: number;
  lagUnit?: TimeUnit;
}

export interface CalendarExceptionInput {
  startDate: string;
  /** Defaults to `startDate`. */
  endDate?: string;
  name?: string;
  /** Defaults to none (a non-working day). */
  intervals?: readonly WorkingInterval[];
}

export interface CalendarInput {
  id: Id;
  name?: string;
  /** Days left out are non-working. Omit entirely for Mon–Fri 08:00–16:00. */
  week?: Partial<Record<Weekday, readonly WorkingInterval[]>>;
  exceptions?: readonly CalendarExceptionInput[];
}

export type ProjectSettingsInput = {
  -readonly [K in Exclude<keyof ProjectSettings, 'startDate'>]?: ProjectSettings[K];
} & {
  /** Read in the project's time zone (the one in the same input, if given). */
  startDate?: DateInput | null;
};

/** Tasks may be a flat list with `parentId`, nested via `children`, or a mix. */
export interface ProjectInput {
  settings?: ProjectSettingsInput;
  calendars?: readonly CalendarInput[];
  tasks?: readonly TaskInput[];
  dependencies?: readonly DependencyInput[];
}

/**
 * The canonical, JSON-serializable form of a project: flat, fully normalized records.
 * It is also valid `ProjectInput`, so it can be loaded back as-is.
 */
export interface ProjectData {
  readonly settings: ProjectSettings;
  readonly calendars: readonly Calendar[];
  readonly tasks: readonly Task[];
  readonly dependencies: readonly Dependency[];
}

// --- State ---

export interface Table<R extends { readonly id: Id }> {
  readonly byId: ReadonlyMap<Id, R>;
  /**
   * Record order. For tasks, the order of siblings under a parent is their relative order here;
   * the full list is not guaranteed to be depth-first.
   */
  readonly order: readonly Id[];
}

/** Immutable snapshot of a project. A new object is created on every change. */
export interface ProjectState {
  readonly settings: ProjectSettings;
  readonly calendars: Table<Calendar>;
  readonly tasks: Table<Task>;
  readonly dependencies: Table<Dependency>;
}

export interface StoreRecords {
  calendars: Calendar;
  tasks: Task;
  dependencies: Dependency;
}

export type StoreName = keyof StoreRecords;

// --- Operations & patches ---

type OperationFor<S extends StoreName> =
  | { readonly type: 'add'; readonly store: S; readonly record: StoreRecords[S]; readonly index: number }
  | { readonly type: 'remove'; readonly store: S; readonly id: Id }
  | {
      readonly type: 'update';
      readonly store: S;
      readonly id: Id;
      readonly changes: Partial<Omit<StoreRecords[S], 'id'>>;
    }
  | {
      readonly type: 'move';
      readonly store: S;
      readonly id: Id;
      /** Target position in `order`, counted after the record has been taken out. */
      readonly index: number;
    };

export interface SettingsOperation {
  readonly type: 'settings';
  readonly changes: Partial<ProjectSettings>;
}

/** One low-level, JSON-serializable change to one record or to the project settings. */
export type Operation = { [S in StoreName]: OperationFor<S> }[StoreName] | SettingsOperation;

/** The result of one transaction. Applying `inverse` after `operations` restores the previous state. */
export interface Patch {
  readonly operations: readonly Operation[];
  readonly inverse: readonly Operation[];
}
