import type { TimeUnit } from '../util/time';

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
}

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

// --- Input: what users may pass in. Looser than the stored records. ---

export type DateInput = Date | number;

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
}

export interface DependencyInput {
  id: Id;
  from: Id;
  to: Id;
  type?: DependencyType;
  lag?: number;
  lagUnit?: TimeUnit;
}

/** Tasks may be a flat list with `parentId`, nested via `children`, or a mix. */
export interface ProjectInput {
  tasks?: readonly TaskInput[];
  dependencies?: readonly DependencyInput[];
}

/**
 * The canonical, JSON-serializable form of a project: flat, fully normalized records.
 * It is also valid `ProjectInput`, so it can be loaded back as-is.
 */
export interface ProjectData {
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
  readonly tasks: Table<Task>;
  readonly dependencies: Table<Dependency>;
}

export interface StoreRecords {
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

/** One low-level, JSON-serializable change to one record. */
export type Operation = { [S in StoreName]: OperationFor<S> }[StoreName];

/** The result of one transaction. Applying `inverse` after `operations` restores the previous state. */
export interface Patch {
  readonly operations: readonly Operation[];
  readonly inverse: readonly Operation[];
}
