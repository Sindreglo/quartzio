import { assertValidState, createProjectState } from './normalize';
import { applyOperations } from './operations';
import type { Id, Patch, ProjectData, ProjectState, Table } from './types';

const records = <R extends { readonly id: Id }>(table: Table<R>): R[] =>
  table.order.map((id) => table.byId.get(id) as R);

/** Converts a state snapshot to the canonical, JSON-serializable data format. */
export function toProjectData(state: ProjectState): ProjectData {
  return {
    settings: state.settings,
    calendars: records(state.calendars),
    tasks: records(state.tasks),
    dependencies: records(state.dependencies),
  };
}

/**
 * Returns new project data with the patch applied; the input is not modified.
 * Meant for controlled usage: `onChange={({ patch }) => setData((data) => applyPatch(data, patch))}`.
 */
export function applyPatch(data: ProjectData, patch: Patch): ProjectData {
  const { state, touched } = applyOperations(createProjectState(data), patch.operations);
  assertValidState(state, touched);
  return toProjectData(state);
}
