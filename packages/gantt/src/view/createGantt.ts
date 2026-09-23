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
}

// Options are filled in as the engine grows.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GanttOptions {}

// Property signatures (not methods) so the functions can be passed around unbound,
// e.g. `useSyncExternalStore(gantt.subscribe, gantt.getState)`.
export interface GanttController {
  /** Returns the same object until the state changes, so it can back `useSyncExternalStore`. */
  getState: () => ViewState;
  subscribe: (listener: (state: ViewState) => void) => () => void;
  setViewport: (viewport: Partial<Viewport>) => void;
  destroy: () => void;
}

const INITIAL_VIEWPORT: Viewport = { width: 0, height: 0, scrollLeft: 0, scrollTop: 0 };

export function createGantt(_options: GanttOptions = {}): GanttController {
  const changes = createEmitter<ViewState>();
  let state: ViewState = { viewport: INITIAL_VIEWPORT };
  let destroyed = false;

  const setState = (next: ViewState): void => {
    state = next;
    changes.emit(state);
  };

  return {
    getState: () => state,
    subscribe: (listener) => changes.subscribe(listener),
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
    destroy() {
      destroyed = true;
      changes.clear();
    },
  };
}
