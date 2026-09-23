import { QuartzioError } from '../util/errors';
import type { Draft } from './draft';
import {
  assertDependencyEnds,
  assertNoParentCycle,
  normalizeDependencyChanges,
  normalizeDependencyFields,
  normalizeTaskChanges,
  normalizeTaskFields,
  type DependencyFieldsInput,
  type TaskFieldsInput,
} from './normalize';
import { applyOperation } from './operations';
import { buildTreeIndex, type TreeIndex } from './tree';
import type { Dependency, Id, Operation, StoreName, Table, Task } from './types';

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

export interface Transaction {
  readonly tasks: TaskTransaction;
  readonly dependencies: DependencyTransaction;
}

export type IdGenerator = (store: StoreName, exists: (id: Id) => boolean) => Id;

export interface TransactionRecorder {
  transaction: Transaction;
  operations: Operation[];
  inverse: Operation[];
}

const clampIndex = (index: number | undefined, length: number): number =>
  index === undefined ? length : Math.max(0, Math.min(Math.trunc(index), length));

/** Creates a transaction that applies every change to `draft` immediately and records the operations. */
export function createTransaction(draft: Draft, generateId: IdGenerator): TransactionRecorder {
  const operations: Operation[] = [];
  const inverse: Operation[] = [];

  const apply = (op: Operation): void => {
    inverse.unshift(applyOperation(draft, op));
    operations.push(op);
  };

  const tasks = (): Table<Task> => draft.read('tasks');
  const dependencies = (): Table<Dependency> => draft.read('dependencies');

  let tree: { version: number; index: TreeIndex } | undefined;
  const treeIndex = (): TreeIndex => {
    const version = draft.versionOf('tasks');
    if (tree?.version !== version) tree = { version, index: buildTreeIndex(tasks()) };
    return tree.index;
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
   * Index in `order` that puts a task at `index` among the children of `parentId`.
   * With `moving`, positions are counted as if that task were already taken out (move semantics).
   */
  const orderIndexFor = (parentId: Id | null, index: number | undefined, moving?: Id): number => {
    const tree = treeIndex();
    const movingPosition = moving === undefined ? -1 : tree.position(moving);
    const position = (id: Id): number => {
      const p = tree.position(id);
      return movingPosition !== -1 && p > movingPosition ? p - 1 : p;
    };

    const siblings = tree.children(parentId).filter((id) => id !== moving);
    const target = clampIndex(index, siblings.length);
    const before = siblings[target];
    if (before !== undefined) return position(before);

    const last = siblings[siblings.length - 1];
    if (last !== undefined) {
      return Math.max(...[last, ...tree.descendants(last)].map(position)) + 1;
    }
    if (parentId !== null) return position(parentId) + 1;
    return tasks().order.length - (movingPosition === -1 ? 0 : 1);
  };

  const changedFields = <R extends object>(record: R, changes: Partial<R>): Partial<R> => {
    const result: Partial<R> = {};
    for (const key of Object.keys(changes) as (keyof R)[]) {
      if (!Object.is(record[key], changes[key])) result[key] = changes[key];
    }
    return result;
  };

  const taskTransaction: TaskTransaction = {
    get: (id) => tasks().byId.get(id),
    children: (parentId) => treeIndex().children(parentId),

    add(input, position = {}) {
      const { id: requestedId, ...fields } = input;
      const id = requestedId ?? generateId('tasks', (candidate) => tasks().byId.has(candidate));
      const parentId = position.parentId ?? null;
      requireParent(parentId);
      const record: Task = { id, parentId, ...normalizeTaskFields(fields, `Task "${String(id)}"`) };
      apply({ type: 'add', store: 'tasks', record, index: orderIndexFor(parentId, position.index) });
      return record;
    },

    update(id, input) {
      const task = requireTask(id);
      const changes = changedFields(task, normalizeTaskChanges(input, `Task "${String(id)}"`));
      if (Object.keys(changes).length > 0) apply({ type: 'update', store: 'tasks', id, changes });
    },

    move(id, position) {
      const task = requireTask(id);
      const parentId = position.parentId === undefined ? task.parentId : position.parentId;
      requireParent(parentId);
      assertNoParentCycle(tasks().byId, id, parentId);

      if (parentId !== task.parentId) apply({ type: 'update', store: 'tasks', id, changes: { parentId } });
      const index = orderIndexFor(parentId, position.index, id);
      if (index !== treeIndex().position(id)) apply({ type: 'move', store: 'tasks', id, index });
    },

    remove(id) {
      requireTask(id);
      const subtree = [id, ...treeIndex().descendants(id)];
      const removed = new Set(subtree);
      // Dependencies first, then tasks leaf-first, so the inverse re-adds parents before children
      // and tasks before the dependencies that reference them.
      for (const dependency of [...dependencies().byId.values()]) {
        if (removed.has(dependency.from) || removed.has(dependency.to)) {
          apply({ type: 'remove', store: 'dependencies', id: dependency.id });
        }
      }
      for (const taskId of subtree.reverse()) apply({ type: 'remove', store: 'tasks', id: taskId });
    },
  };

  const dependencyTransaction: DependencyTransaction = {
    get: (id) => dependencies().byId.get(id),

    add(input) {
      const { id: requestedId, from, to, ...fields } = input;
      const id = requestedId ?? generateId('dependencies', (candidate) => dependencies().byId.has(candidate));
      const owner = `Dependency "${String(id)}"`;
      assertDependencyEnds(tasks().byId, from, to, owner);
      const record: Dependency = { id, from, to, ...normalizeDependencyFields(fields, owner) };
      apply({ type: 'add', store: 'dependencies', record, index: dependencies().order.length });
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
      requireDependency(id);
      apply({ type: 'remove', store: 'dependencies', id });
    },
  };

  return {
    transaction: { tasks: taskTransaction, dependencies: dependencyTransaction },
    operations,
    inverse,
  };
}
