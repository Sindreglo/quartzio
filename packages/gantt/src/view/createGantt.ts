import { createProject } from '../data/project';
import { getTreeIndex } from '../data/tree';
import type { Id, ProjectState } from '../data/types';
import { createEmitter } from '../util/emitter';
import { isEqual } from '../util/equal';
import { QuartzioError } from '../util/errors';
import { createDataBinding } from './binding';
import { resolveColumns, type ColumnInput, type ResolvedColumns } from './columns';
import { createRowsView } from './rows';
import { createTimelineView, resolveTimeline, sameTimeline, type TimelineOptions } from './timeline';
import type { GanttController, GanttOptions, ViewState, Viewport } from './types';

export type {
  GanttController,
  GanttDataChange,
  GanttOptions,
  HeaderState,
  ViewState,
  Viewport,
} from './types';

const INITIAL_VIEWPORT: Viewport = { width: 0, height: 0, scrollLeft: 0, scrollTop: 0 };
const DEFAULT_ROW_HEIGHT = 36;
const DEFAULT_HEADER_ROW_HEIGHT = 28;

/** Options that shape the view (as opposed to data and callbacks), validated as a whole. */
interface ViewOptions {
  timeline: TimelineOptions;
  columnInput: readonly ColumnInput[] | undefined;
  columns: ResolvedColumns;
  rowHeight: number;
  headerRowHeight: number;
}

const VIEW_KEYS = [
  'preset',
  'startDate',
  'endDate',
  'locale',
  'columns',
  'rowHeight',
  'headerRowHeight',
] as const;

function toHeight(value: unknown, fallback: number, name: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 8 || value > 500) {
    throw new QuartzioError(`Gantt options: "${name}" must be a number from 8 to 500.`);
  }
  return value;
}

/** Validates the view options, reusing unchanged parts of `previous`. Throws before anything changes. */
function resolveViewOptions(options: GanttOptions, previous?: ViewOptions): ViewOptions {
  const has = (key: keyof GanttOptions) => previous === undefined || key in options;
  const timeline = resolveTimeline({
    preset: has('preset') ? options.preset : previous?.timeline.preset,
    startDate: has('startDate') ? options.startDate : previous?.timeline.startDate,
    endDate: has('endDate') ? options.endDate : previous?.timeline.endDate,
    locale: has('locale') ? options.locale : previous?.timeline.locale,
  });
  const columnInput = has('columns') ? options.columns : previous?.columnInput;
  // Equal by value, so an inline array with the same columns (new on every React render) is no change.
  // Value functions compare by identity: define columns with custom functions outside render.
  const columns =
    previous && (columnInput === previous.columnInput || isEqual(columnInput, previous.columnInput))
      ? previous.columns
      : resolveColumns(columnInput ?? undefined);
  return {
    timeline: previous && sameTimeline(timeline, previous.timeline) ? previous.timeline : timeline,
    columnInput,
    columns,
    rowHeight: has('rowHeight')
      ? toHeight(options.rowHeight, DEFAULT_ROW_HEIGHT, 'rowHeight')
      : (previous?.rowHeight ?? DEFAULT_ROW_HEIGHT),
    headerRowHeight: has('headerRowHeight')
      ? toHeight(options.headerRowHeight, DEFAULT_HEADER_ROW_HEIGHT, 'headerRowHeight')
      : (previous?.headerRowHeight ?? DEFAULT_HEADER_ROW_HEIGHT),
  };
}

const sameView = (a: ViewOptions, b: ViewOptions) =>
  a.timeline === b.timeline &&
  a.columns === b.columns &&
  a.rowHeight === b.rowHeight &&
  a.headerRowHeight === b.headerRowHeight;

export function createGantt(options: GanttOptions = {}): GanttController {
  let view = resolveViewOptions(options);
  const controlled = 'data' in options;
  const project = createProject((controlled ? options.data : options.defaultData) ?? {});
  const binding = createDataBinding(project, controlled, options.data, options.onChange);
  const timelineView = createTimelineView();
  const rowsView = createRowsView();
  const changes = createEmitter<ViewState>();
  let collapsed: ReadonlySet<Id> = new Set();
  let collapsedVersion = 0;
  let destroyed = false;
  // True while setOptions applies several changes, so they produce one state update instead of several.
  let batching = false;

  // Deriving never throws: options are validated up front, and oversized ranges are cut short.
  const derive = (viewport: Viewport, projectState: ProjectState): ViewState => {
    const timeAxis = timelineView.axisFor(projectState, viewport.width, view.timeline);
    return {
      viewport,
      project: projectState,
      timeAxis,
      header: timelineView.headerFor(timeAxis, viewport, view.headerRowHeight),
      columns: view.columns.state,
      rows: rowsView.rowsFor({
        project: projectState,
        collapsed,
        collapsedVersion,
        viewport,
        rowHeight: view.rowHeight,
        columns: view.columns,
        locale: view.timeline.locale,
      }),
    };
  };

  let state = derive(INITIAL_VIEWPORT, project.getState());

  const setState = (next: ViewState): void => {
    state = next;
    changes.emit(state);
  };
  const refresh = (): void => {
    setState(derive(state.viewport, project.getState()));
  };

  const unsubscribeProject = project.subscribe(({ state: projectState }) => {
    pruneCollapsed(projectState);
    if (!batching) setState(derive(state.viewport, projectState));
  });

  const sameSet = (a: ReadonlySet<Id>, b: ReadonlySet<Id>) =>
    a.size === b.size && [...a].every((id) => b.has(id));

  const setCollapsed = (next: ReadonlySet<Id>): void => {
    if (sameSet(next, collapsed)) return;
    collapsed = next;
    collapsedVersion++;
    refresh();
  };

  /** Forgets collapsed tasks that were removed or lost their children, so they start expanded if reused. */
  const pruneCollapsed = (projectState: ProjectState): void => {
    if (collapsed.size === 0) return;
    const tree = getTreeIndex(projectState.tasks);
    const kept = new Set([...collapsed].filter((id) => !tree.isLeaf(id)));
    if (kept.size !== collapsed.size) {
      collapsed = kept;
      collapsedVersion++;
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => changes.subscribe(listener),

    setOptions(next) {
      if (destroyed) return;
      // Validate everything first, so an invalid option changes nothing.
      const nextView = VIEW_KEYS.some((key) => key in next) ? resolveViewOptions(next, view) : view;
      const before = project.getState();

      const previousView = view;
      view = nextView;
      batching = true;
      try {
        if (controlled && 'data' in next) binding.setData(next.data);
      } catch (error) {
        view = previousView;
        throw error;
      } finally {
        batching = false;
      }
      if ('onChange' in next) binding.setOnChange(next.onChange);
      if (!sameView(nextView, previousView) || project.getState() !== before) refresh();
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
      setState(derive(viewport, state.project));
    },

    transact(fn) {
      if (destroyed) return null;
      return binding.transact(fn);
    },

    toggle(id) {
      if (destroyed || getTreeIndex(state.project.tasks).isLeaf(id)) return;
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setCollapsed(next);
    },

    setExpanded(id, expanded) {
      if (destroyed || getTreeIndex(state.project.tasks).isLeaf(id) || collapsed.has(id) !== expanded) return;
      const next = new Set(collapsed);
      if (expanded) next.delete(id);
      else next.add(id);
      setCollapsed(next);
    },

    expandAll() {
      if (destroyed) return;
      setCollapsed(new Set());
    },

    collapseAll() {
      if (destroyed) return;
      const tree = getTreeIndex(state.project.tasks);
      setCollapsed(new Set(state.project.tasks.order.filter((id) => !tree.isLeaf(id))));
    },

    destroy() {
      destroyed = true;
      unsubscribeProject();
      changes.clear();
    },
  };
}
