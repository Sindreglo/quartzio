import { createProject, type Project } from '../data/project';
import { toProjectData } from '../data/serialize';
import type { Transaction } from '../data/transaction';
import type { Patch, ProjectData, ProjectInput, ProjectState } from '../data/types';
import { createEmitter } from '../util/emitter';

export interface Viewport {
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
}

/** Everything a renderer needs to draw the chart. Plain data — no DOM, no framework types. */
export interface ViewState {
  viewport: Viewport;
  project: ProjectState;
}

export interface GanttDataChange {
  readonly patch: Patch;
  /** The project data with the change applied. */
  readonly data: ProjectData;
}

export interface GanttOptions {
  /**
   * Controlled data. The engine never changes it on its own: edits are reported through `onChange`,
   * and only show up once new `data` is passed back in.
   */
  data?: ProjectInput | undefined;
  /** Initial data for uncontrolled usage, where the engine keeps the edited data itself. */
  defaultData?: ProjectInput | undefined;
  onChange?: ((change: GanttDataChange) => void) | undefined;
}

// Property signatures (not methods) so the functions can be passed around unbound,
// e.g. `useSyncExternalStore(gantt.subscribe, gantt.getState)`.
export interface GanttController {
  /** Returns the same object until the state changes, so it can back `useSyncExternalStore`. */
  getState: () => ViewState;
  subscribe: (listener: (state: ViewState) => void) => () => void;
  /** Updates options after creation. `data` is only honoured in controlled mode. */
  setOptions: (options: GanttOptions) => void;
  setViewport: (viewport: Partial<Viewport>) => void;
  /**
   * Changes project data. Uncontrolled: applied immediately. Controlled: only reported through
   * `onChange`. Returns the patch, or `null` if nothing changed.
   */
  transact: (fn: (tx: Transaction) => void) => Patch | null;
  destroy: () => void;
}

const INITIAL_VIEWPORT: Viewport = { width: 0, height: 0, scrollLeft: 0, scrollTop: 0 };

export function createGantt(options: GanttOptions = {}): GanttController {
  const controlled = options.data !== undefined;
  const project: Project = createProject(options.data ?? options.defaultData);
  const changes = createEmitter<ViewState>();
  let onChange = options.onChange;
  let currentData = options.data;
  // Last change reported in controlled mode. If exactly that data comes back, the planned operations
  // are replayed instead of re-normalizing the whole project.
  let pending: { data: ProjectData; patch: Patch } | undefined;
  let state: ViewState = { viewport: INITIAL_VIEWPORT, project: project.getState() };
  let destroyed = false;

  const setState = (next: ViewState): void => {
    state = next;
    changes.emit(state);
  };

  const unsubscribeProject = project.subscribe(({ state: projectState }) => {
    setState({ ...state, project: projectState });
  });

  const setData = (data: ProjectInput): void => {
    if (data === currentData) return;
    currentData = data;
    if (pending?.data === data) project.apply(pending.patch.operations);
    else project.load(data);
    pending = undefined;
  };

  return {
    getState: () => state,
    subscribe: (listener) => changes.subscribe(listener),

    setOptions(next) {
      if (destroyed) return;
      if ('onChange' in next) onChange = next.onChange;
      if (controlled && next.data !== undefined) setData(next.data);
    },

    setViewport(patch) {
      if (destroyed) return;
      const viewport = { ...state.viewport, ...patch };
      const current = state.viewport;
      if (
        viewport.width === current.width &&
        viewport.height === current.height &&
        viewport.scrollLeft === current.scrollLeft &&
        viewport.scrollTop === current.scrollTop
      ) {
        return;
      }
      setState({ ...state, viewport });
    },

    transact(fn) {
      if (destroyed) return null;
      if (controlled) {
        const planned = project.plan(fn);
        if (!planned) return null;
        pending = { data: toProjectData(planned.state), patch: planned.patch };
        onChange?.({ patch: planned.patch, data: pending.data });
        return planned.patch;
      }
      const patch = project.transact(fn);
      if (patch) onChange?.({ patch, data: project.toData() });
      return patch;
    },

    destroy() {
      destroyed = true;
      unsubscribeProject();
      changes.clear();
    },
  };
}
