import { createProject } from '../data/project';
import { scheduleProject } from '../scheduling/schedule';
import { getTreeIndex } from '../data/tree';
import type { Id, Operation, ProjectState } from '../data/types';
import { createEmitter } from '../util/emitter';
import { isEqual } from '../util/equal';
import { QuartzioError } from '../util/errors';
import { createDataBinding } from './binding';
import { createHistory, type HistoryAction } from './history';
import { keyCommand } from './keyboard';
import {
  clickRow,
  NO_SELECTION,
  pruneSelection,
  selectIds,
  selectionOf,
  visibleRowOf,
  type KeyModifiers,
  type Selection,
  type VisibleRows,
} from './selection';
import { resolveColumns, type ColumnInput, type ResolvedColumns } from './columns';
import type { TimeAxis } from '../timeaxis/timeAxis';
import { createDependencyView } from './dependencies';
import {
  CLICK_TOLERANCE,
  createInteraction,
  type Interaction,
  type InteractionView,
  type TaskInteraction,
  type TimelinePoint,
} from './interaction';
import { createNonWorkingView } from './nonWorking';
import { createRowsView, UNMEASURED_HEIGHT } from './rows';
import { createTimelineView, resolveTimeline, sameTimeline, type TimelineOptions } from './timeline';
import type { GanttController, GanttOptions, Interactions, TodayLine, ViewState, Viewport } from './types';

export type {
  GanttController,
  GanttDataChange,
  GanttOptions,
  HeaderState,
  Interactions,
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
  showToday: boolean;
  showNonWorkingTime: boolean;
  taskDrag: boolean;
  taskResize: boolean;
  taskDragCreate: boolean;
  progressDrag: boolean;
  dependencyCreate: boolean;
  /** The five switches above as one object, kept while they're unchanged. */
  interactions: Interactions;
}

const VIEW_KEYS = [
  'preset',
  'startDate',
  'endDate',
  'locale',
  'columns',
  'rowHeight',
  'headerRowHeight',
  'showToday',
  'showNonWorkingTime',
  'taskDrag',
  'taskResize',
  'taskDragCreate',
  'progressDrag',
  'dependencyCreate',
] as const;

/** Modifiers straight from events (or plain JavaScript): anything that isn't an object means none. */
const modifiersOf = (value: unknown): KeyModifiers =>
  typeof value === 'object' && value !== null ? value : {};

function toSwitch(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new QuartzioError(`Gantt options: "${name}" must be true or false.`);
  return value;
}

function toHeight(value: unknown, fallback: number, name: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 8 || value > 500) {
    throw new QuartzioError(`Gantt options: "${name}" must be a number from 8 to 500.`);
  }
  return value;
}

/** Validates the view options, reusing unchanged parts of `previous`. Throws before anything changes. */
function resolveViewOptions(options: GanttOptions, previous?: ViewOptions): ViewOptions {
  const resolved = resolveSwitches(options, previous);
  const interactions: Interactions = {
    drag: resolved.taskDrag,
    resize: resolved.taskResize,
    create: resolved.taskDragCreate,
    progress: resolved.progressDrag,
    link: resolved.dependencyCreate,
  };
  return {
    ...resolved,
    interactions:
      previous && isEqual(previous.interactions, interactions) ? previous.interactions : interactions,
  };
}

function resolveSwitches(options: GanttOptions, previous?: ViewOptions): Omit<ViewOptions, 'interactions'> {
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
    showToday: has('showToday')
      ? toSwitch(options.showToday, true, 'showToday')
      : (previous?.showToday ?? true),
    showNonWorkingTime: has('showNonWorkingTime')
      ? toSwitch(options.showNonWorkingTime, true, 'showNonWorkingTime')
      : (previous?.showNonWorkingTime ?? true),
    taskDrag: has('taskDrag') ? toSwitch(options.taskDrag, true, 'taskDrag') : (previous?.taskDrag ?? true),
    taskResize: has('taskResize')
      ? toSwitch(options.taskResize, true, 'taskResize')
      : (previous?.taskResize ?? true),
    taskDragCreate: has('taskDragCreate')
      ? toSwitch(options.taskDragCreate, true, 'taskDragCreate')
      : (previous?.taskDragCreate ?? true),
    progressDrag: has('progressDrag')
      ? toSwitch(options.progressDrag, true, 'progressDrag')
      : (previous?.progressDrag ?? true),
    dependencyCreate: has('dependencyCreate')
      ? toSwitch(options.dependencyCreate, true, 'dependencyCreate')
      : (previous?.dependencyCreate ?? true),
  };
}

function toCallback<K extends 'validateChange' | 'onSelectionChange'>(
  value: unknown,
  name: K,
): GanttOptions[K] {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'function') throw new QuartzioError(`Gantt options: "${name}" must be a function.`);
  return value as GanttOptions[K];
}

/** Behaviour switches that don't change how anything looks. */
interface Behaviour {
  undoRedo: boolean;
  multiSelect: boolean;
  deleteKey: boolean;
  validateChange: GanttOptions['validateChange'];
  onSelectionChange: GanttOptions['onSelectionChange'];
}

function resolveBehaviour(options: GanttOptions, previous?: Behaviour): Behaviour {
  const has = (key: keyof GanttOptions) => previous === undefined || key in options;
  return {
    undoRedo: has('undoRedo') ? toSwitch(options.undoRedo, true, 'undoRedo') : (previous?.undoRedo ?? true),
    multiSelect: has('multiSelect')
      ? toSwitch(options.multiSelect, true, 'multiSelect')
      : (previous?.multiSelect ?? true),
    deleteKey: has('deleteKey')
      ? toSwitch(options.deleteKey, true, 'deleteKey')
      : (previous?.deleteKey ?? true),
    validateChange: has('validateChange')
      ? toCallback(options.validateChange, 'validateChange')
      : previous?.validateChange,
    onSelectionChange: has('onSelectionChange')
      ? toCallback(options.onSelectionChange, 'onSelectionChange')
      : previous?.onSelectionChange,
  };
}

const sameView = (a: ViewOptions, b: ViewOptions) =>
  a.taskDrag === b.taskDrag &&
  a.taskResize === b.taskResize &&
  a.taskDragCreate === b.taskDragCreate &&
  a.progressDrag === b.progressDrag &&
  a.dependencyCreate === b.dependencyCreate &&
  a.showToday === b.showToday &&
  a.showNonWorkingTime === b.showNonWorkingTime &&
  a.timeline === b.timeline &&
  a.columns === b.columns &&
  a.rowHeight === b.rowHeight &&
  a.headerRowHeight === b.headerRowHeight;

export function createGantt(options: GanttOptions = {}): GanttController {
  let view = resolveViewOptions(options);
  let behaviour = resolveBehaviour(options);
  const controlled = 'data' in options;
  // Scheduling writes computed dates back into the data (ADR 0008).
  const project = createProject({}, { propagate: scheduleProject });
  const initialPatch = project.load((controlled ? options.data : options.defaultData) ?? {});
  const history = createHistory();
  // Changes are recorded after they're committed, so the history in the state is brought up to date then.
  const syncHistory = (): void => {
    if (!batching && !destroyed && state.history !== history.state())
      setState({ ...state, history: history.state() });
  };
  const binding = createDataBinding(project, controlled, options.data, options.onChange, initialPatch, {
    confirm(actions) {
      if (!behaviour.undoRedo) return;
      history.confirm(actions);
      syncHistory();
    },
    clear() {
      history.clear();
      syncHistory();
    },
  });
  const timelineView = createTimelineView();
  const rowsView = createRowsView();
  const dependencyView = createDependencyView();
  const nonWorkingView = createNonWorkingView();
  const changes = createEmitter<ViewState>();
  let collapsed: ReadonlySet<Id> = new Set();
  let selection: Selection = NO_SELECTION;
  // The selection last reported through onSelectionChange.
  let announced = selection.ids;
  // A press in the timeline that is a click as long as the pointer stays within the tolerance.
  let press: { origin: TimelinePoint; id: Id | null; modifiers: KeyModifiers } | null = null;
  let visible: VisibleRows | undefined;
  let collapsedVersion = 0;
  let destroyed = false;
  // True while setOptions applies several changes, so they produce one state update instead of several.
  let batching = false;

  // The bar being dragged (a preview), and the task of every visible row (for hit testing).
  let shownInteraction: TaskInteraction | null = null;
  let interactionView: InteractionView | undefined;
  // Created after the first state (it reads the view), so derive can't use it yet on that first call.
  const interactionRef: { current?: Interaction } = {};

  let todayCache: { axis: TimeAxis; line: TodayLine } | undefined;
  const todayOn = (axis: TimeAxis): TodayLine | null => {
    const now = Date.now();
    if (!view.showToday || now < axis.start || now >= axis.end) return null;
    // Whole pixels, and the same object while on the same pixel, so the line doesn't re-render on every update.
    const x = Math.round(axis.dateToX(now));
    if (todayCache?.axis !== axis || todayCache.line.x !== x) todayCache = { axis, line: { time: now, x } };
    return todayCache.line;
  };

  // Deriving never throws: options are validated up front, and oversized ranges are cut short.
  const derive = (viewport: Viewport, projectState: ProjectState): ViewState => {
    const timeAxis = timelineView.axisFor(projectState, viewport.width, view.timeline);
    const { rows, rowIndex, rowIds } = rowsView.rowsFor({
      project: projectState,
      collapsed,
      collapsedVersion,
      viewport,
      rowHeight: view.rowHeight,
      columns: view.columns,
      locale: view.timeline.locale,
      timeAxis,
      selection,
    });
    visible = { rowIds, rowIndex, tree: getTreeIndex(projectState.tasks) };
    const next: ViewState = {
      viewport,
      project: projectState,
      timeAxis,
      header: timelineView.headerFor(timeAxis, viewport, view.headerRowHeight),
      columns: view.columns.state,
      rows,
      dependencies: dependencyView.linesFor({
        project: projectState,
        timeAxis,
        rows,
        rowIndex,
      }),
      today: todayOn(timeAxis),
      nonWorkingTime: nonWorkingView.spansFor(projectState, timeAxis, viewport, view.showNonWorkingTime),
      interaction: shownInteraction,
      interactions: view.interactions,
      history: history.state(),
      selection: selection.ids,
      activeId: selection.active,
    };
    interactionView = {
      project: projectState,
      timeAxis,
      rows,
      rowIndex,
      rowIds,
      viewport,
      locale: view.timeline.locale,
      enabled: {
        drag: view.taskDrag,
        resize: view.taskResize,
        create: view.taskDragCreate,
        progress: view.progressDrag,
        link: view.dependencyCreate,
      },
      // Read when asked, so a validator set later (or one closing over newer app state) is the one used.
      validate: (change) => (behaviour.validateChange ? behaviour.validateChange(change) : true),
    };
    // A drag on a stale basis (another axis, a changed or hidden task, options turned off) is dropped before
    // anything shows it.
    if (interactionRef.current && !interactionRef.current.keep(interactionView)) {
      shownInteraction = null;
      return { ...next, interaction: null };
    }
    return next;
  };

  let state = derive(INITIAL_VIEWPORT, project.getState());

  const drags = createInteraction({
    view: () => interactionView as InteractionView,
    show(next) {
      shownInteraction = next;
      setState({ ...state, interaction: next });
    },
    commit(fn) {
      try {
        changing(() => binding.transact(fn));
      } catch (error) {
        // Expected: the data rejecting the change (a dependency cycle can't come from a drop, but a date the
        // data doesn't accept could). Nothing changes and the bar goes back; a pointer handler must not throw.
        if (!(error instanceof QuartzioError)) throw error;
      }
    },
  });
  interactionRef.current = drags;

  const setState = (next: ViewState): void => {
    state = next;
    changes.emit(state);
  };
  const refresh = (): void => {
    setState(derive(state.viewport, project.getState()));
  };

  const unsubscribeProject = project.subscribe(({ state: projectState }) => {
    pruneCollapsed(projectState);
    selection = pruneSelection(selection, projectState.tasks.byId);
    // Reported once the change is complete (see announce), not in the middle of committing it.
    if (!batching) setState(derive(state.viewport, projectState));
  });

  /**
   * Reports a changed selection. Called once an action is done (the data change reported and recorded), so an
   * app callback that throws or changes things again can't leave a change half done.
   */
  const announce = (): void => {
    if (selection.ids === announced || destroyed) return;
    const same =
      selection.ids.length === announced.length && selection.ids.every((id, i) => id === announced[i]);
    announced = selection.ids;
    if (!same) behaviour.onSelectionChange?.(announced);
  };

  /** Runs a data change, then reports what it did to the selection (deleted tasks drop out). */
  const changing = <T>(fn: () => T): T => {
    const result = fn();
    announce();
    return result;
  };

  const setSelection = (next: Selection): void => {
    if (next === selection) return;
    selection = next;
    refresh();
    announce();
  };

  const visibleRows = (): VisibleRows => visible as VisibleRows;

  /** Undo or redo. If the data refuses it, the history no longer matches the data and is dropped. */
  const replay = (operations: readonly Operation[], action: HistoryAction): boolean => {
    try {
      binding.apply(operations, () => action);
      return true;
    } catch (error) {
      if (!(error instanceof QuartzioError)) throw error;
      history.clear();
      syncHistory();
      return false;
    }
  };

  const removeTasks = (ids: readonly Id[]): void => {
    try {
      changing(() =>
        binding.transact((tx) => {
          for (const id of ids) tx.tasks.remove(id);
        }),
      );
    } catch (error) {
      if (!(error instanceof QuartzioError)) throw error;
    }
  };

  const sameSet = (a: ReadonlySet<Id>, b: ReadonlySet<Id>) =>
    a.size === b.size && [...a].every((id) => b.has(id));

  const setCollapsed = (next: ReadonlySet<Id>): void => {
    if (sameSet(next, collapsed)) return;
    collapsed = next;
    collapsedVersion++;
    refresh();
    // A cursor hidden by collapsing moves to the parent that hides it, so it stays in view.
    const shown = visibleRowOf(selection.active, visibleRows());
    const shownId = shown === undefined ? undefined : visibleRows().rowIds[shown];
    if (shownId !== undefined && shownId !== selection.active) {
      setSelection(selectionOf(selection, selection.ids, shownId, shownId));
    }
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

  const controller: GanttController = {
    getState: () => state,
    subscribe: (listener) => {
      binding.start(); // a renderer took this controller into use: report the initial scheduling
      return changes.subscribe(listener);
    },

    setOptions(next) {
      if (destroyed) return;
      // Validate everything first, so an invalid option changes nothing.
      const nextView = VIEW_KEYS.some((key) => key in next) ? resolveViewOptions(next, view) : view;
      const nextBehaviour = resolveBehaviour(next, behaviour);
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
      behaviour = nextBehaviour;
      if (!behaviour.undoRedo) history.clear();
      if (!behaviour.multiSelect && selection.ids.length > 1) {
        const last = selection.ids.at(-1) as Id;
        selection = selectionOf(selection, [last], selection.active, last);
      }
      if (
        !sameView(nextView, previousView) ||
        project.getState() !== before ||
        state.history !== history.state() ||
        state.selection !== selection.ids
      ) {
        refresh();
      }
      announce();
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
      // A drag follows the pointer to what's under it now (this is how auto-scrolling moves it).
      drags.follow();
    },

    transact(fn) {
      if (destroyed) return null;
      return changing(() => binding.transact(fn));
    },

    undo() {
      const patch = destroyed || !behaviour.undoRedo || binding.awaiting() ? undefined : history.undoable();
      if (!patch) return false;
      return changing(() => replay(patch.inverse, { type: 'undo', patch }));
    },

    redo() {
      const patch = destroyed || !behaviour.undoRedo || binding.awaiting() ? undefined : history.redoable();
      if (!patch) return false;
      return changing(() => replay(patch.operations, { type: 'redo', patch }));
    },

    hitTest: (point) => (destroyed ? null : drags.hitTest(point)),
    pointerDown(point, modifiers) {
      if (destroyed || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
      const index = Math.floor(point.y / state.rows.rowHeight);
      press = { origin: point, id: visibleRows().rowIds[index] ?? null, modifiers: modifiersOf(modifiers) };
      drags.pointerDown(point);
      return true;
    },
    pointerMove(point) {
      if (destroyed) return;
      if (press && Math.hypot(point.x - press.origin.x, point.y - press.origin.y) >= CLICK_TOLERANCE)
        press = null;
      drags.pointerMove(point);
    },
    pointerUp(point) {
      if (destroyed) return;
      const click = press;
      press = null;
      drags.pointerUp(point);
      if (!click) return;
      // Below the rows: a plain click clears the selection, as in a file list.
      if (click.id === null) {
        if (!click.modifiers.ctrl && !click.modifiers.meta && !click.modifiers.shift) {
          setSelection(selectionOf(selection, [], selection.active, selection.anchor));
        }
        return;
      }
      setSelection(clickRow(selection, click.id, click.modifiers, visibleRows(), behaviour.multiSelect));
    },
    cancelInteraction() {
      press = null;
      return !destroyed && drags.cancel();
    },

    rowClick(id, modifiers) {
      if (destroyed) return;
      setSelection(clickRow(selection, id, modifiersOf(modifiers), visibleRows(), behaviour.multiSelect));
    },

    select(ids) {
      if (destroyed || !Array.isArray(ids)) return;
      setSelection(selectIds(selection, ids, state.project.tasks.byId, behaviour.multiSelect));
    },

    clearSelection() {
      if (destroyed) return;
      setSelection(selectionOf(selection, [], selection.active, selection.anchor));
    },

    keyDown(input) {
      // Checked, as it comes straight from DOM events (or plain JavaScript).
      if (destroyed || typeof (input as unknown) !== 'object' || (input as unknown) === null) return false;
      const height = state.viewport.height > 0 ? state.viewport.height : UNMEASURED_HEIGHT;
      const command = keyCommand(input, {
        ...visibleRows(),
        selection,
        collapsed,
        pageRows: Math.floor(height / state.rows.rowHeight),
        multiSelect: behaviour.multiSelect,
        deleteKey: behaviour.deleteKey,
        undoRedo: behaviour.undoRedo,
      });
      if (!command) return false;
      switch (command.type) {
        case 'select':
          setSelection(command.selection);
          return true;
        case 'expand':
          controller.setExpanded(command.id, command.expanded);
          return true;
        case 'delete':
          removeTasks(command.ids);
          setSelection(command.selection);
          return true;
        case 'undo':
          return controller.undo();
        case 'redo':
          return controller.redo();
      }
    },

    revealTop(id) {
      const index = destroyed ? undefined : visibleRows().rowIndex.get(id);
      const { height, scrollTop } = state.viewport;
      if (index === undefined || height <= 0) return null;
      const top = index * state.rows.rowHeight;
      const bottom = top + state.rows.rowHeight;
      if (top < scrollTop) return top;
      if (bottom > scrollTop + height) return bottom - height;
      return null;
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
      binding.destroy();
      unsubscribeProject();
      changes.clear();
    },
  };
  return controller;
}
