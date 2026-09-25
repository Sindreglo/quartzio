import { isEqual } from '../util/equal';
import { QuartzioError } from '../util/errors';
import type { Draft } from './draft';
import {
  assertDependencyEnds,
  assertNoParentCycle,
  assertNoStructureFields,
  assertTaskConstraint,
  assertTaskDates,
  isId,
  normalizeCalendarChanges,
  normalizeCalendarFields,
  normalizeDependencyChanges,
  normalizeDependencyFields,
  normalizeSettingsChanges,
  normalizeTaskChanges,
  normalizeTaskFields,
  type CalendarFieldsInput,
  type DependencyFieldsInput,
  type TaskFieldsInput,
} from './normalize';
import { applyOperation } from './operations';
import { getScheduleGraph } from './graph';
import { buildDraftTreeIndex, type DraftTreeIndex } from './tree';
import type {
  Calendar,
  Dependency,
  Id,
  Operation,
  ProjectState,
  ProjectSettings,
  ProjectSettingsInput,
  StoreName,
  Table,
  Task,
} from './types';

/** Where to put a task. `parentId` defaults to root (for add) or the current parent (for move); `index` to last. */
export interface TaskPosition {
  parentId?: Id | null;
  /** Position among the new siblings. */
  index?: number;
}

export interface TaskAddInput extends TaskFieldsInput {
  /** Generated when omitted. */
  id?: Id;
}

export type TaskUpdateInput = TaskFieldsInput;

export interface DependencyAddInput extends DependencyFieldsInput {
  /** Generated when omitted. */
  id?: Id;
  from: Id;
  to: Id;
}

export interface DependencyUpdateInput extends DependencyFieldsInput {
  from?: Id;
  to?: Id;
}

// Property signatures (not methods) so the functions can be destructured and passed around.
export interface TaskTransaction {
  /** Reads reflect earlier writes in the same transaction. */
  get: (id: Id) => Task | undefined;
  children: (parentId: Id | null) => readonly Id[];
  add: (input: TaskAddInput, position?: TaskPosition) => Task;
  /** Fields that equal the current value are skipped, so no-op updates produce no operations. */
  update: (id: Id, changes: TaskUpdateInput) => void;
  move: (id: Id, position: TaskPosition) => void;
  /** Also removes all descendants and every dependency connected to them. */
  remove: (id: Id) => void;
}

export interface DependencyTransaction {
  get: (id: Id) => Dependency | undefined;
  add: (input: DependencyAddInput) => Dependency;
  update: (id: Id, changes: DependencyUpdateInput) => void;
  remove: (id: Id) => void;
}

export interface CalendarAddInput extends CalendarFieldsInput {
  /** Generated when omitted. */
  id?: Id;
}

export type CalendarUpdateInput = CalendarFieldsInput;

export interface CalendarTransaction {
  get: (id: Id) => Calendar | undefined;
  add: (input: CalendarAddInput) => Calendar;
  update: (id: Id, changes: CalendarUpdateInput) => void;
  /** Fails while the calendar is the project calendar. */
  remove: (id: Id) => void;
}

export interface SettingsTransaction {
  get: () => ProjectSettings;
  /**
   * Changing `timeZone` does not move existing dates (they are instants), but it changes how wall-clock
   * logic and date strings in later input are interpreted.
   */
  update: (changes: ProjectSettingsInput) => void;
}

export interface Transaction {
  readonly settings: SettingsTransaction;
  readonly calendars: CalendarTransaction;
  readonly tasks: TaskTransaction;
  readonly dependencies: DependencyTransaction;
}

export type IdGenerator = (store: StoreName, exists: (id: Id) => boolean) => Id;

export interface TransactionRecorder {
  transaction: Transaction;
  draft: Draft;
  operations: Operation[];
  inverse: Operation[];
  /** Checks structural invariants once the transaction function is done (e.g. no dependency cycles). */
  validate: () => void;
  /**
   * Checks invariants that may be broken until the change is complete, on the final state (after propagation,
   * which can repair them, e.g. a new start after the old end on a scheduled task).
   */
  validateResult: (state: ProjectState) => void;
  /** Makes every further use of the transaction throw. Called when the transaction function returns. */
  close: () => void;
}

const clampIndex = (index: number | undefined, length: number): number => {
  if (index === undefined) return length;
  // NaN can't be clamped to anything meaningful (and would put a task in different places in the tree and in
  // `order`); out-of-range numbers, including ±Infinity, are clamped.
  if (typeof index !== 'number' || Number.isNaN(index)) {
    throw new QuartzioError(`Position index must be a number, got ${String(index)}.`);
  }
  return Math.max(0, Math.min(Math.trunc(index), length));
};

// Subtree size from which placementFor looks up positions through a map instead of scanning `order`.
const MAP_ABOVE = 8;

/** Creates a transaction that applies every change to `draft` immediately and records the operations. */
export function createTransaction(draft: Draft, generateId: IdGenerator): TransactionRecorder {
  const operations: Operation[] = [];
  const inverse: Operation[] = [];
  const touchedTasks = new Set<Id>();
  let closed = false;

  // The draft's tables become the committed state, so a transaction used after it finished
  // (e.g. after an `await`) would silently mutate "immutable" state.
  const assertOpen = (): void => {
    if (closed) {
      throw new QuartzioError(
        'This transaction has already finished. Transactions must be synchronous; do not keep or await them.',
      );
    }
  };

  const apply = (op: Operation): void => {
    assertOpen();
    inverse.push(applyOperation(draft, op));
    operations.push(op);
  };

  const tasks = (): Table<Task> => {
    assertOpen();
    return draft.read('tasks');
  };
  const dependencies = (): Table<Dependency> => {
    assertOpen();
    return draft.read('dependencies');
  };
  const calendars = (): Table<Calendar> => {
    assertOpen();
    return draft.read('calendars');
  };
  const settings = (): ProjectSettings => {
    assertOpen();
    return draft.readSettings();
  };

  const newId = (store: StoreName, requested: Id | undefined, exists: (id: Id) => boolean): Id => {
    const id = requested ?? generateId(store, exists);
    if (!isId(id)) {
      throw new QuartzioError(
        `${store === 'tasks' ? 'Task' : 'Dependency'} id must be a non-empty string or a finite number.`,
      );
    }
    return id;
  };

  // Rebuilt only after structural changes other than adds, which are inserted in place (see add).
  let tree: { version: number; index: DraftTreeIndex } | undefined;
  const treeIndex = (): DraftTreeIndex => {
    const version = draft.structureVersionOf('tasks');
    if (tree?.version !== version) tree = { version, index: buildDraftTreeIndex(tasks()) };
    return tree.index;
  };

  // Dependency ids per task (both ends), kept in step with adds and removals here and rebuilt after other
  // structural changes, so removing many tasks doesn't scan every dependency each time.
  let links: { version: number; byTask: Map<Id, Set<Id>> } | undefined;
  const linksOf = (): Map<Id, Set<Id>> => {
    const version = draft.structureVersionOf('dependencies');
    if (links?.version !== version) {
      const byTask = new Map<Id, Set<Id>>();
      for (const dependency of dependencies().byId.values()) link(byTask, dependency, true);
      links = { version, byTask };
    }
    return links.byTask;
  };
  const link = (byTask: Map<Id, Set<Id>>, dependency: Dependency, add: boolean): void => {
    for (const taskId of [dependency.from, dependency.to]) {
      let set = byTask.get(taskId);
      if (!set) byTask.set(taskId, (set = new Set()));
      if (add) set.add(dependency.id);
      else set.delete(dependency.id);
    }
  };
  // Applies a dependency add or remove and updates the links in place instead of invalidating them.
  const applyLinked = (op: Operation, dependency: Dependency, add: boolean): void => {
    const byTask = linksOf();
    apply(op);
    link(byTask, dependency, add);
    if (links) links.version = draft.structureVersionOf('dependencies');
  };

  const requireTask = (id: Id): Task => {
    const task = tasks().byId.get(id);
    if (!task) throw new QuartzioError(`Task "${String(id)}" does not exist.`);
    return task;
  };

  const requireDependency = (id: Id): Dependency => {
    const dependency = dependencies().byId.get(id);
    if (!dependency) throw new QuartzioError(`Dependency "${String(id)}" does not exist.`);
    return dependency;
  };

  const requireParent = (parentId: Id | null): void => {
    if (parentId !== null) requireTask(parentId);
  };

  /**
   * Where a task goes to be at `index` among the children of `parentId`: its index in `order`, and among its
   * siblings. With `moving`, positions are counted as if that task were already taken out (move semantics).
   */
  const placementFor = (
    parentId: Id | null,
    index: number | undefined,
    moving?: Id,
  ): { orderIndex: number; siblingIndex: number } => {
    const tree = treeIndex();
    // Positions come straight from `order`: it changes with every add, so a position map would need
    // rebuilding each time. Large subtrees get a map for their one lookup below.
    const order = tasks().order;
    const movingPosition = moving === undefined ? -1 : order.indexOf(moving);
    const adjust = (p: number): number => (movingPosition !== -1 && p > movingPosition ? p - 1 : p);

    const all = tree.childrenView(parentId);
    const siblings = moving === undefined ? all : all.filter((id) => id !== moving);
    const siblingIndex = clampIndex(index, siblings.length);
    const before = siblings[siblingIndex];
    if (before !== undefined) return { orderIndex: adjust(order.indexOf(before)), siblingIndex };

    const last = siblings[siblings.length - 1];
    if (last !== undefined) {
      const subtree = tree.descendants(last);
      // One scan per descendant is cheaper than a map for small subtrees, the common case when adding.
      const positions = subtree.length > MAP_ABOVE ? new Map(order.map((id, i) => [id, i])) : undefined;
      // A loop, not Math.max(...spread): large subtrees would overflow the call stack.
      let end = order.lastIndexOf(last); // appends usually go after the last task: search from the end
      for (const id of subtree) end = Math.max(end, positions?.get(id) ?? order.indexOf(id));
      return { orderIndex: adjust(end) + 1, siblingIndex };
    }
    if (parentId !== null) return { orderIndex: adjust(order.indexOf(parentId)) + 1, siblingIndex };
    return { orderIndex: order.length - (movingPosition === -1 ? 0 : 1), siblingIndex };
  };

  const changedFields = <R extends object>(record: R, changes: Partial<R>): Partial<R> => {
    const result: Partial<R> = {};
    for (const key of Object.keys(changes) as (keyof R)[]) {
      // Structural, so re-sending equal arrays/objects (e.g. a calendar's week) is not a change.
      if (!isEqual(record[key], changes[key])) result[key] = changes[key];
    }
    return result;
  };

  const taskTransaction: TaskTransaction = {
    get: (id) => tasks().byId.get(id),
    children: (parentId) => treeIndex().children(parentId),

    add(input, position = {}) {
      const { id: requestedId, ...fields } = input;
      const id = newId('tasks', requestedId, (candidate) => tasks().byId.has(candidate));
      const owner = `Task "${String(id)}"`;
      assertNoStructureFields(fields, owner);
      const parentId = position.parentId ?? null;
      requireParent(parentId);
      const record: Task = { id, parentId, ...normalizeTaskFields(fields, owner, settings().timeZone) };
      assertTaskConstraint(record);
      const { orderIndex, siblingIndex } = placementFor(parentId, position.index);
      apply({ type: 'add', store: 'tasks', record, index: orderIndex });
      // placementFor brought the tree up to date; insert instead of rebuilding it for the next add.
      if (tree) {
        tree.index.insert(id, parentId, siblingIndex);
        tree.version = draft.structureVersionOf('tasks');
      }
      touchedTasks.add(id);
      return record;
    },

    update(id, input) {
      const task = requireTask(id);
      const owner = `Task "${String(id)}"`;
      assertNoStructureFields(input, owner);
      const changes = changedFields(task, normalizeTaskChanges(input, owner, settings().timeZone));
      // A new end before the start is an error. (A new start after the old end isn't: scheduling moves the
      // end, keeping the duration; see validateResult.)
      if ('endDate' in changes) assertTaskDates({ ...task, ...changes });
      assertTaskConstraint({ ...task, ...changes });
      if (Object.keys(changes).length > 0) apply({ type: 'update', store: 'tasks', id, changes });
      touchedTasks.add(id);
    },

    move(id, position) {
      const task = requireTask(id);
      const parentId = position.parentId === undefined ? task.parentId : position.parentId;
      requireParent(parentId);
      assertNoParentCycle(tasks().byId, id, parentId);

      if (parentId !== task.parentId) apply({ type: 'update', store: 'tasks', id, changes: { parentId } });
      const { orderIndex } = placementFor(parentId, position.index, id);
      if (orderIndex !== tasks().order.indexOf(id))
        apply({ type: 'move', store: 'tasks', id, index: orderIndex });
    },

    remove(id) {
      requireTask(id);
      const index = treeIndex();
      const descendants = index.descendants(id);
      const subtree = [id, ...descendants];
      // Dependencies first, then tasks leaf-first, so the inverse re-adds parents before children
      // and tasks before the dependencies that reference them.
      const byTask = linksOf();
      const touching = new Set(subtree.flatMap((taskId) => [...(byTask.get(taskId) ?? [])]));
      for (const dependencyId of touching) {
        const dependency = requireDependency(dependencyId);
        applyLinked({ type: 'remove', store: 'dependencies', id: dependencyId }, dependency, false);
      }
      for (const taskId of [...subtree].reverse()) apply({ type: 'remove', store: 'tasks', id: taskId });
      index.removeSubtree(id, descendants);
      if (tree) tree.version = draft.structureVersionOf('tasks');
    },
  };

  const dependencyTransaction: DependencyTransaction = {
    get: (id) => dependencies().byId.get(id),

    add(input) {
      const { id: requestedId, from, to, ...fields } = input;
      const id = newId('dependencies', requestedId, (candidate) => dependencies().byId.has(candidate));
      const owner = `Dependency "${String(id)}"`;
      assertDependencyEnds(tasks().byId, from, to, owner);
      const record: Dependency = { id, from, to, ...normalizeDependencyFields(fields, owner) };
      applyLinked(
        { type: 'add', store: 'dependencies', record, index: dependencies().order.length },
        record,
        true,
      );
      return record;
    },

    update(id, input) {
      const dependency = requireDependency(id);
      const owner = `Dependency "${String(id)}"`;
      const { from = dependency.from, to = dependency.to, ...fields } = input;
      assertDependencyEnds(tasks().byId, from, to, owner);
      const changes = changedFields(dependency, { from, to, ...normalizeDependencyChanges(fields, owner) });
      if (Object.keys(changes).length > 0) apply({ type: 'update', store: 'dependencies', id, changes });
    },

    remove(id) {
      applyLinked({ type: 'remove', store: 'dependencies', id }, requireDependency(id), false);
    },
  };

  const calendarTransaction: CalendarTransaction = {
    get: (id) => calendars().byId.get(id),

    add(input) {
      const { id: requestedId, ...fields } = input;
      const id = newId('calendars', requestedId, (candidate) => calendars().byId.has(candidate));
      const record: Calendar = { id, ...normalizeCalendarFields(fields, `Calendar "${String(id)}"`) };
      apply({ type: 'add', store: 'calendars', record, index: calendars().order.length });
      return record;
    },

    update(id, input) {
      const calendar = calendars().byId.get(id);
      if (!calendar) throw new QuartzioError(`Calendar "${String(id)}" does not exist.`);
      const changes = changedFields(calendar, normalizeCalendarChanges(input, `Calendar "${String(id)}"`));
      if (Object.keys(changes).length > 0) apply({ type: 'update', store: 'calendars', id, changes });
    },

    remove(id) {
      if (!calendars().byId.has(id)) throw new QuartzioError(`Calendar "${String(id)}" does not exist.`);
      if (settings().calendarId === id) {
        throw new QuartzioError(
          `Calendar "${String(id)}" is the project calendar. Change settings.calendarId first.`,
        );
      }
      apply({ type: 'remove', store: 'calendars', id });
    },
  };

  const settingsTransaction: SettingsTransaction = {
    get: settings,
    update(input) {
      const changes = changedFields(settings(), normalizeSettingsChanges(input, settings().timeZone));
      if (changes.calendarId != null && !calendars().byId.has(changes.calendarId)) {
        throw new QuartzioError(`Project settings: calendar "${String(changes.calendarId)}" does not exist.`);
      }
      if (Object.keys(changes).length > 0) apply({ type: 'settings', changes });
    },
  };

  return {
    transaction: {
      settings: settingsTransaction,
      calendars: calendarTransaction,
      tasks: taskTransaction,
      dependencies: dependencyTransaction,
    },
    draft,
    operations,
    // Inverse operations must run in reverse order; pushed in order and reversed on read.
    get inverse() {
      return [...inverse].reverse();
    },
    validate: () => {
      // Dependency cycles, also through the hierarchy (a move can create one). Cached when nothing structural
      // changed.
      getScheduleGraph(draft.finish());
    },
    validateResult: (state) => {
      for (const id of touchedTasks) {
        const task = state.tasks.byId.get(id);
        if (task) assertTaskDates(task);
      }
    },
    close: () => {
      closed = true;
    },
  };
}
