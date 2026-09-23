import { createEmitter } from '../util/emitter';
import { QuartzioError } from '../util/errors';
import { Draft } from './draft';
import { assertValidState, createProjectState } from './normalize';
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
}

// Property signatures (not methods) so the functions can be passed around unbound.
export interface Project {
  getState: () => ProjectState;
  subscribe: (listener: (change: ProjectChange) => void) => () => void;
  /** Replaces the whole project. */
  load: (input: ProjectInput) => void;
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
  let state = createProjectState(input);
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
    return {
      state: recorder.draft.finish(),
      patch: { operations: recorder.operations, inverse: recorder.inverse },
    };
  };

  return {
    getState: () => state,
    subscribe: (listener) => changes.subscribe(listener),
    load(nextInput) {
      assertNotRunning();
      commit(createProjectState(nextInput), null);
    },
    plan,
    transact(fn) {
      const planned = plan(fn);
      if (!planned) return null;
      commit(planned.state, planned.patch);
      return planned.patch;
    },
    apply(operations) {
      assertNotRunning();
      if (operations.length === 0) return null;
      const result = applyOperations(state, operations);
      assertValidState(result.state, result.touched);
      const patch: Patch = { operations: [...operations], inverse: result.inverse };
      commit(result.state, patch);
      return patch;
    },
    toData: () => toProjectData(state),
  };
}
