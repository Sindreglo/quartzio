import { createEmitter } from '../util/emitter';
import { QuartzioError } from '../util/errors';
import { Draft } from './draft';
import { assertTaskDates, assertValidState, createProjectState } from './normalize';
import { applyOperations } from './operations';
import { toProjectData } from './serialize';
import { createTransaction, type IdGenerator, type Transaction } from './transaction';
import type { Operation, Patch, ProjectData, ProjectInput, ProjectState, StoreName } from './types';

export interface ProjectChange {
  readonly state: ProjectState;
  /** `null` when the whole project was replaced via `load()`. */
  readonly patch: Patch | null;
}

export interface PlannedChange {
  readonly state: ProjectState;
  readonly patch: Patch;
}

export interface ProjectOptions {
  /** Creates ids for records added without one. Defaults to `task-1`, `dependency-1`, ... */
  generateId?: IdGenerator;
  /**
   * Completes every change (transactions, `apply`, `load` and the initial data) with more operations, applied
   * in the same change and included in its patch: this is how the scheduler writes computed dates back.
   * Gets the operations that were applied, or `null` for loaded data. Must be pure, and return nothing for a
   * state it already completed; if it throws, the change is rejected.
   */
  propagate?: (state: ProjectState, operations: readonly Operation[] | null) => readonly Operation[];
}

// Property signatures (not methods) so the functions can be passed around unbound.
export interface Project {
  getState: () => ProjectState;
  subscribe: (listener: (change: ProjectChange) => void) => () => void;
  /**
   * Replaces the whole project. Returns the operations `propagate` added to the loaded data (e.g. computed
   * dates), or `null` when it added none.
   */
  load: (input: ProjectInput) => Patch | null;
  /**
   * Runs `fn` against a draft and commits all its changes at once, emitting a single change.
   * If `fn` throws, nothing is changed. Returns `null` when nothing changed.
   */
  transact: (fn: (tx: Transaction) => void) => Patch | null;
  /**
   * Like `transact`, but only computes the result without committing it.
   * `base` plans on top of another state than the current one (e.g. an earlier planned change).
   */
  plan: (fn: (tx: Transaction) => void, base?: ProjectState) => PlannedChange | null;
  /**
   * Applies operations, e.g. a patch's `inverse` for undo or operations received from a server.
   * The result is validated (parents and dependency ends must exist, no cycles); on failure nothing changes.
   */
  apply: (operations: readonly Operation[]) => Patch | null;
  /** Like `apply`, but only computes the result without committing it (`base` as for `plan`). */
  planApply: (operations: readonly Operation[], base?: ProjectState) => PlannedChange | null;
  toData: () => ProjectData;
}

const PREFIX: Record<StoreName, string> = {
  calendars: 'calendar',
  tasks: 'task',
  dependencies: 'dependency',
};

function createDefaultIdGenerator(): IdGenerator {
  const counters: Record<StoreName, number> = { calendars: 0, tasks: 0, dependencies: 0 };
  return (store, exists) => {
    let id: string;
    do id = `${PREFIX[store]}-${String(++counters[store])}`;
    while (exists(id));
    return id;
  };
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'
  );
}

export function createProject(input: ProjectInput = {}, options: ProjectOptions = {}): Project {
  const changes = createEmitter<ProjectChange>();
  const generateId = options.generateId ?? createDefaultIdGenerator();
  const { propagate } = options;

  /** Applies what `propagate` adds to `base`, returning the state and a patch relative to `base`. */
  const complete = (
    base: ProjectState,
    applied: readonly Operation[] | null,
  ): { state: ProjectState; patch: Patch | null } => {
    const extra = propagate?.(base, applied) ?? [];
    if (extra.length === 0) return { state: base, patch: null };
    const result = applyOperations(base, extra);
    assertValidState(result.state, result.touched);
    return { state: result.state, patch: { operations: [...extra], inverse: result.inverse } };
  };
  /** Joins a change and what propagate added to it into one patch. */
  const join = (first: Patch, second: Patch | null): Patch =>
    second
      ? {
          operations: [...first.operations, ...second.operations],
          inverse: [...second.inverse, ...first.inverse],
        }
      : first;

  /** Applies operations and what propagate adds, validated, without committing. */
  const applyCompleted = (base: ProjectState, operations: readonly Operation[]): PlannedChange => {
    const result = applyOperations(base, operations);
    // End before start is checked after propagation, which can repair it (like transact does).
    assertValidState(result.state, result.touched, { taskDates: false });
    const completed = complete(result.state, operations);
    for (const id of result.touched.tasks) {
      const task = completed.state.tasks.byId.get(id);
      if (task) assertTaskDates(task);
    }
    return {
      state: completed.state,
      patch: join({ operations: [...operations], inverse: result.inverse }, completed.patch),
    };
  };

  let state = complete(createProjectState(input), null).state;
  let running = false;

  const commit = (next: ProjectState, patch: Patch | null): void => {
    state = next;
    changes.emit({ state, patch });
  };

  const assertNotRunning = (): void => {
    if (running) throw new QuartzioError('Cannot change the project while a transaction is running.');
  };

  // `fn` is typed as returning `unknown` here: callers pass `=> void`, but an async function still
  // type-checks as that, so the return value is checked at runtime.
  const plan = (fn: (tx: Transaction) => unknown, base: ProjectState = state): PlannedChange | null => {
    assertNotRunning();
    running = true;
    const recorder = createTransaction(new Draft(base), generateId);
    try {
      const result = fn(recorder.transaction);
      if (isThenable(result)) {
        throw new QuartzioError(
          'Transaction functions must be synchronous. Do the async work before transact().',
        );
      }
      recorder.validate();
    } finally {
      recorder.close();
      running = false;
    }
    if (recorder.operations.length === 0) return null;
    const completed = complete(recorder.draft.finish(), recorder.operations);
    recorder.validateResult(completed.state);
    return {
      state: completed.state,
      patch: join({ operations: recorder.operations, inverse: recorder.inverse }, completed.patch),
    };
  };

  return {
    getState: () => state,
    subscribe: (listener) => changes.subscribe(listener),
    load(nextInput) {
      assertNotRunning();
      const completed = complete(createProjectState(nextInput, state), null);
      commit(completed.state, null);
      return completed.patch;
    },
    plan,
    transact(fn) {
      const planned = plan(fn);
      if (!planned) return null;
      commit(planned.state, planned.patch);
      return planned.patch;
    },
    planApply(operations, base = state) {
      assertNotRunning();
      if (operations.length === 0) return null;
      return applyCompleted(base, operations);
    },
    apply(operations) {
      assertNotRunning();
      if (operations.length === 0) return null;
      const { state: next, patch } = applyCompleted(state, operations);
      commit(next, patch);
      return patch;
    },
    toData: () => toProjectData(state),
  };
}
