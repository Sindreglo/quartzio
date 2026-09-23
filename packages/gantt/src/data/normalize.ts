import { QuartzioError } from '../util/errors';
import { isTimeUnit, type TimeUnit } from '../util/time';
import type {
  DateInput,
  Dependency,
  DependencyInput,
  DependencyType,
  Id,
  ProjectInput,
  ProjectState,
  Table,
  Task,
  TaskInput,
} from './types';

const DEPENDENCY_TYPES: readonly DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

export const DEFAULT_DURATION_UNIT: TimeUnit = 'day';
export const DEFAULT_LAG_UNIT: TimeUnit = 'day';

const label = (kind: string, id: Id): string => `${kind} "${String(id)}"`;

export function isId(value: unknown): value is Id {
  return (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value));
}

export function toTime(value: DateInput | null | undefined, field: string, owner: string): number | null {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value.getTime() : value;
  if (typeof time !== 'number' || !Number.isFinite(time)) {
    throw new QuartzioError(`${owner}: "${field}" must be a valid Date or epoch milliseconds.`);
  }
  return time;
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

/** Field-level normalization shared by loading and transactions. */
export type TaskFieldsInput = Omit<TaskInput, 'id' | 'parentId' | 'children'>;
export type TaskFields = Omit<Task, 'id' | 'parentId'>;

export function normalizeTaskFields(input: TaskFieldsInput, owner: string): TaskFields {
  return {
    name: input.name ?? '',
    startDate: toTime(input.startDate, 'startDate', owner),
    endDate: toTime(input.endDate, 'endDate', owner),
    duration: toDuration(input.duration, owner),
    durationUnit: toUnit(input.durationUnit, DEFAULT_DURATION_UNIT, 'durationUnit', owner),
    percentDone: toPercent(input.percentDone, owner),
  };
}

/** Normalizes only the fields present in `input` (for updates). */
export function normalizeTaskChanges(input: TaskFieldsInput, owner: string): Partial<TaskFields> {
  const changes: { -readonly [K in keyof TaskFields]?: TaskFields[K] } = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.startDate !== undefined) changes.startDate = toTime(input.startDate, 'startDate', owner);
  if (input.endDate !== undefined) changes.endDate = toTime(input.endDate, 'endDate', owner);
  if (input.duration !== undefined) changes.duration = toDuration(input.duration, owner);
  if (input.durationUnit !== undefined) {
    changes.durationUnit = toUnit(input.durationUnit, DEFAULT_DURATION_UNIT, 'durationUnit', owner);
  }
  if (input.percentDone !== undefined) changes.percentDone = toPercent(input.percentDone, owner);
  return changes;
}

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

/** Normalizes and validates user input into an immutable ProjectState. Throws QuartzioError on invalid data. */
export function createProjectState(input: ProjectInput = {}): ProjectState {
  const tasks = new Map<Id, Task>();
  const taskOrder: Id[] = [];

  const visit = (task: TaskInput, nestedParent: Id | undefined): void => {
    if (!isId(task.id)) throw new QuartzioError(`Task id must be a non-empty string or a finite number.`);
    const owner = label('Task', task.id);
    if (tasks.has(task.id)) throw new QuartzioError(`${owner} is defined more than once.`);
    if (nestedParent !== undefined && task.parentId != null && task.parentId !== nestedParent) {
      throw new QuartzioError(
        `${owner} is nested under "${String(nestedParent)}" but has parentId "${String(task.parentId)}".`,
      );
    }
    const parentId = nestedParent ?? task.parentId ?? null;
    tasks.set(task.id, { id: task.id, parentId, ...normalizeTaskFields(task, owner) });
    taskOrder.push(task.id);
    for (const child of task.children ?? []) visit(child, task.id);
  };
  for (const task of input.tasks ?? []) visit(task, undefined);

  assertTaskHierarchy(tasks);

  const dependencies = new Map<Id, Dependency>();
  const dependencyOrder: Id[] = [];
  for (const dependency of input.dependencies ?? []) {
    if (!isId(dependency.id)) {
      throw new QuartzioError(`Dependency id must be a non-empty string or a finite number.`);
    }
    const owner = label('Dependency', dependency.id);
    if (dependencies.has(dependency.id)) throw new QuartzioError(`${owner} is defined more than once.`);
    assertDependencyEnds(tasks, dependency.from, dependency.to, owner);
    dependencies.set(dependency.id, {
      id: dependency.id,
      from: dependency.from,
      to: dependency.to,
      ...normalizeDependencyFields(dependency, owner),
    });
    dependencyOrder.push(dependency.id);
  }

  return {
    tasks: { byId: tasks, order: taskOrder },
    dependencies: { byId: dependencies, order: dependencyOrder },
  };
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

/**
 * Checks the structural invariants of a state produced by applying operations from outside
 * (undo stacks, servers). Transactions keep these invariants by construction. O(n).
 */
export function assertValidState(state: ProjectState): void {
  assertTaskHierarchy(state.tasks.byId);
  for (const dependency of state.dependencies.byId.values()) {
    assertDependencyEnds(
      state.tasks.byId,
      dependency.from,
      dependency.to,
      label('Dependency', dependency.id),
    );
  }
}

export function assertDependencyEnds(tasks: Table<Task>['byId'], from: Id, to: Id, owner: string): void {
  if (!tasks.has(from)) throw new QuartzioError(`${owner}: "from" task "${String(from)}" does not exist.`);
  if (!tasks.has(to)) throw new QuartzioError(`${owner}: "to" task "${String(to)}" does not exist.`);
  if (from === to) throw new QuartzioError(`${owner}: a task cannot depend on itself.`);
}
