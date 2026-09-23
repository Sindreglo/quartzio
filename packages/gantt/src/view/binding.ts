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
}

/**
 * Connects the project to the app's data: uncontrolled (the engine keeps edits) or controlled (edits are
 * only reported, and shown once the app passes new data back in).
 */
export function createDataBinding(
  project: Project,
  controlled: boolean,
  initialData: ProjectInput | undefined,
  initialOnChange: ((change: GanttDataChange) => void) | undefined,
): DataBinding {
  let onChange = initialOnChange;
  let currentData = initialData;
  // Controlled mode: the last change reported through onChange, relative to the committed state.
  // If exactly its data comes back, the operations are replayed instead of re-normalizing everything.
  let pending: { state: ProjectState; data: ProjectData; operations: Operation[] } | undefined;
  // Edits in the same synchronous run (e.g. two transact() calls in one event handler) build on each
  // other. Later edits build on the last data passed in, so a change the app rejected (by not passing
  // it back) is dropped instead of sneaking into the next one — like a controlled <input>.
  let chaining = false;

  return {
    setData(data) {
      if (data === currentData) return;
      if (pending !== undefined && pending.data === data) project.apply(pending.operations);
      else project.load(data ?? {});
      // Only after loading succeeded, so passing the same (fixed) data again is not skipped.
      currentData = data;
      pending = undefined;
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
        onChange?.({ patch: planned.patch, data: pending.data });
        return planned.patch;
      }
      const patch = project.transact(fn);
      if (patch) onChange?.({ patch, data: project.toData() });
      return patch;
    },

    setOnChange(next) {
      onChange = next;
    },
  };
}
