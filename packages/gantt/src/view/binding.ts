import type { Project } from '../data/project';
import { toProjectData } from '../data/serialize';
import type { Transaction } from '../data/transaction';
import type { Operation, Patch, ProjectData, ProjectInput, ProjectState } from '../data/types';
import type { GanttDataChange } from './types';

export interface DataBinding {
  /** Controlled mode: new data from the app. */
  setData: (data: ProjectInput | undefined) => void;
  transact: (fn: (tx: Transaction) => void) => Patch | null;
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
  let pending: { state: ProjectState; data: ProjectData; operations: Operation[] } | undefined;
  // Edits in the same synchronous run (e.g. two transact() calls in one event handler) build on each
  // other. Later edits build on the last data passed in, so a change the app rejected (by not passing
  // it back) is dropped instead of sneaking into the next one — like a controlled <input>.
  let chaining = false;

  /** Reports what completing loaded data changed; controlled, that data coming back is recognized. */
  const reportLoaded = (patch: Patch): void => {
    const data = toProjectData(project.getState());
    if (controlled) pending = { state: project.getState(), data, operations: [] };
    report({ patch, data });
  };

  let started = false;

  return {
    setData(data) {
      if (data === currentData) return;
      let patch: Patch | null = null;
      if (pending !== undefined && pending.data === data) project.apply(pending.operations);
      else patch = project.load(data ?? {});
      // Only after loading succeeded, so passing the same (fixed) data again is not skipped, and rejected data
      // doesn't cancel the initial report.
      superseded = true;
      currentData = data;
      pending = undefined;
      if (patch) reportLoaded(patch);
    },

    transact(fn) {
      if (controlled) {
        const previous = chaining ? pending : undefined;
        const planned = project.plan(fn, previous?.state);
        if (!planned) return null;
        pending = {
          state: planned.state,
          data: toProjectData(planned.state),
          operations: [...(previous?.operations ?? []), ...planned.patch.operations],
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
      const patch = project.transact(fn);
      if (patch) report({ patch, data: project.toData() });
      return patch;
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
