import type { PlannedChange, Project } from '../data/project';
import { toProjectData } from '../data/serialize';
import type { Transaction } from '../data/transaction';
import type { Operation, Patch, ProjectData, ProjectInput, ProjectState } from '../data/types';
import type { History, HistoryAction } from './history';
import type { GanttDataChange } from './types';

export interface DataBinding {
  /** Controlled mode: new data from the app. */
  setData: (data: ProjectInput | undefined) => void;
  transact: (fn: (tx: Transaction) => void) => Patch | null;
  /** Applies operations as one change (undo and redo), recorded in the history as `action`. */
  apply: (operations: readonly Operation[], action: (patch: Patch) => HistoryAction) => Patch | null;
  /**
   * Controlled mode: whether an edit reported in this synchronous run is still waiting for the app. The history
   * doesn't show it yet, so undo and redo would pick the wrong step.
   */
  awaiting: () => boolean;
  setOnChange: (onChange: ((change: GanttDataChange) => void) | undefined) => void;
  /**
   * Reports what scheduling changed in the initial data, after a microtask. Called when the controller gets
   * its first subscriber: a renderer took it into use (React may create controllers it then throws away).
   */
  start: () => void;
  /** Stops reporting (a pending report of the initial scheduling is dropped). */
  destroy: () => void;
}

/**
 * Connects the project to the app's data: uncontrolled (the engine keeps edits) or controlled (edits are
 * only reported, and shown once the app passes new data back in).
 *
 * Loaded data is shown completed (scheduled). What that changed is reported through onChange too, so the app
 * can keep the scheduled data: right away for data passed in later; for the initial data (`initialPatch`) once
 * `start` is called, after a microtask, since the controller is usually created during rendering.
 */
export function createDataBinding(
  project: Project,
  controlled: boolean,
  initialData: ProjectInput | undefined,
  initialOnChange: ((change: GanttDataChange) => void) | undefined,
  initialPatch: Patch | null,
  history: Pick<History, 'confirm' | 'clear'>,
): DataBinding {
  let onChange = initialOnChange;
  let currentData = initialData;
  // Set once anything newer than the initial data was reported or loaded: its report is then out of date.
  let superseded = false;
  let destroyed = false;
  const report = (change: GanttDataChange): void => {
    superseded = true;
    if (!destroyed) onChange?.(change);
  };
  // Controlled mode: the last change reported through onChange, relative to the committed state.
  // If exactly its data comes back, the operations are replayed instead of re-normalizing everything.
  // Its history actions take effect when the data comes back (the app accepted the change).
  let pending:
    { state: ProjectState; data: ProjectData; operations: Operation[]; actions: HistoryAction[] } | undefined;
  // Edits in the same synchronous run (e.g. two transact() calls in one event handler) build on each
  // other. Later edits build on the last data passed in, so a change the app rejected (by not passing
  // it back) is dropped instead of sneaking into the next one — like a controlled <input>.
  let chaining = false;

  /** Reports what completing loaded data changed; controlled, that data coming back is recognized. */
  const reportLoaded = (patch: Patch): void => {
    const data = toProjectData(project.getState());
    if (controlled) pending = { state: project.getState(), data, operations: [], actions: [] };
    report({ patch, data });
  };

  let started = false;

  /** One change: controlled, planned and reported; uncontrolled, applied and reported. */
  const change = (
    plan: (base: ProjectState | undefined) => PlannedChange | null,
    apply: () => Patch | null,
    action: (patch: Patch) => HistoryAction,
  ): Patch | null => {
    if (controlled) {
      const previous = chaining ? pending : undefined;
      const planned = plan(previous?.state);
      if (!planned) return null;
      pending = {
        state: planned.state,
        data: toProjectData(planned.state),
        operations: [...(previous?.operations ?? []), ...planned.patch.operations],
        actions: [...(previous?.actions ?? []), action(planned.patch)],
      };
      if (!chaining) {
        chaining = true;
        void Promise.resolve().then(() => {
          chaining = false;
        });
      }
      report({ patch: planned.patch, data: pending.data });
      return planned.patch;
    }
    const patch = apply();
    if (patch) {
      history.confirm([action(patch)]);
      report({ patch, data: project.toData() });
    }
    return patch;
  };

  return {
    setData(data) {
      if (data === currentData) return;
      let patch: Patch | null = null;
      const accepted = pending !== undefined && pending.data === data ? pending : undefined;
      if (accepted) project.apply(accepted.operations);
      else patch = project.load(data ?? {});
      // Only after loading succeeded, so passing the same (fixed) data again is not skipped, and rejected data
      // doesn't cancel the initial report.
      superseded = true;
      currentData = data;
      pending = undefined;
      // The reported changes happened; other data makes the history meaningless.
      if (accepted) history.confirm(accepted.actions);
      else history.clear();
      if (patch) reportLoaded(patch);
    },

    transact(fn) {
      return change(
        (base) => project.plan(fn, base),
        () => project.transact(fn),
        (patch) => ({ type: 'edit', patch }),
      );
    },

    apply(operations, action) {
      return change(
        (base) => project.planApply(operations, base),
        () => project.apply(operations),
        action,
      );
    },

    awaiting() {
      return chaining && pending !== undefined && pending.actions.length > 0;
    },

    setOnChange(next) {
      onChange = next;
    },

    start() {
      if (started || !initialPatch) return;
      started = true;
      void Promise.resolve().then(() => {
        if (!superseded) reportLoaded(initialPatch);
      });
    },

    destroy() {
      destroyed = true;
    },
  };
}
