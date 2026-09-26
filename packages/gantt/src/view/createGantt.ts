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
import { tooltipFor, type TaskTooltip } from './tooltip';
import { createCellEditor, type EditorView } from './cellEditor';
import { barUnder } from './interaction';
import {
  customized,
  findItem,
  menuHover,
  menuKey,
  taskMenuItems,
  targetsOf,
  timeAxisMenuItems,
  zoomStep,
  type MenuContext,
  type MenuItem,
  type MenuState,
  type MenuTarget,
  type TaskMenuItemId,
} from './menu';
import { addTask, indent, outdent, type AddWhere } from './taskActions';
import { createTaskEditor } from './taskEditor';
import { VIEW_PRESETS } from '../timeaxis/presets';
import type { Transaction } from '../data/transaction';

import { dateKind } from './editing';
import { createTimelineView, resolveTimeline, sameTimeline, type TimelineOptions } from './timeline';
import type {
  GanttController,
  GanttOptions,
  Interactions,
  ScrollRequest,
  TodayLine,
  ViewState,
  Viewport,
} from './types';

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
/** Where a menu opened with the keyboard goes, from the left edge of the chart. */
const KEYBOARD_MENU_X = 24;

/** The `scrollTop` that shows row `index`, or `null` when it shows (or nothing is measured). */
function revealTopOf(index: number, viewport: Viewport, rowHeight: number): number | null {
  if (viewport.height <= 0) return null;
  const top = index * rowHeight;
  if (top < viewport.scrollTop) return top;
  if (top + rowHeight > viewport.scrollTop + viewport.height) return top + rowHeight - viewport.height;
  return null;
}

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

type CallbackOption =
  | 'validateChange'
  | 'onSelectionChange'
  | 'taskMenuItems'
  | 'timeAxisMenuItems'
  | 'createTaskId'
  | 'onPresetChange';

function toCallback<K extends CallbackOption>(value: unknown, name: K): GanttOptions[K] {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'function') throw new QuartzioError(`Gantt options: "${name}" must be a function.`);
  return value as GanttOptions[K];
}

/** Behaviour switches that don't change how anything looks. */
interface Behaviour {
  taskTooltip: boolean;
  cellEdit: boolean;
  undoRedo: boolean;
  multiSelect: boolean;
  deleteKey: boolean;
  taskMenu: boolean;
  timeAxisMenu: boolean;
  taskEdit: boolean;
  validateChange: GanttOptions['validateChange'];
  onSelectionChange: GanttOptions['onSelectionChange'];
  taskMenuItems: GanttOptions['taskMenuItems'];
  timeAxisMenuItems: GanttOptions['timeAxisMenuItems'];
  createTaskId: GanttOptions['createTaskId'];
  onPresetChange: GanttOptions['onPresetChange'];
}

function resolveBehaviour(options: GanttOptions, previous?: Behaviour): Behaviour {
  const has = (key: keyof GanttOptions) => previous === undefined || key in options;
  return {
    taskTooltip: has('taskTooltip')
      ? toSwitch(options.taskTooltip, true, 'taskTooltip')
      : (previous?.taskTooltip ?? true),
    cellEdit: has('cellEdit') ? toSwitch(options.cellEdit, true, 'cellEdit') : (previous?.cellEdit ?? true),
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
    taskMenu: has('taskMenu') ? toSwitch(options.taskMenu, true, 'taskMenu') : (previous?.taskMenu ?? true),
    timeAxisMenu: has('timeAxisMenu')
      ? toSwitch(options.timeAxisMenu, true, 'timeAxisMenu')
      : (previous?.timeAxisMenu ?? true),
    taskEdit: has('taskEdit') ? toSwitch(options.taskEdit, true, 'taskEdit') : (previous?.taskEdit ?? true),
    taskMenuItems: has('taskMenuItems')
      ? toCallback(options.taskMenuItems, 'taskMenuItems')
      : previous?.taskMenuItems,
    timeAxisMenuItems: has('timeAxisMenuItems')
      ? toCallback(options.timeAxisMenuItems, 'timeAxisMenuItems')
      : previous?.timeAxisMenuItems,
    createTaskId: has('createTaskId')
      ? toCallback(options.createTaskId, 'createTaskId')
      : previous?.createTaskId,
    onPresetChange: has('onPresetChange')
      ? toCallback(options.onPresetChange, 'onPresetChange')
      : previous?.onPresetChange,
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
  let menu: MenuState | null = null;
  // Where the renderer should scroll to (after zooming, or to show a new task); new object each time.
  let scrollTo: ScrollRequest | null = null;
  // A zoom overrides the preset option until the option changes (compared by value).
  let zoomed = false;
  let presetOption: unknown = options.preset;
  // A task just added from the menu: selected, shown and opened for editing once it's in the data.
  let added: Id | null = null;
  let reveal: Id | null = null;
  // Its name is opened once the rows show it (after the state is derived).
  let editAdded: Id | null = null;
  const openAdded = (): void => {
    const id = editAdded;
    editAdded = null;
    if (id !== null) editor.start(id, 'name');
  };
  // The selection last reported through onSelectionChange.
  let announced = selection.ids;
  // A press in the timeline that is a click as long as the pointer stays within the tolerance.
  let press: { origin: TimelinePoint; id: Id | null; modifiers: KeyModifiers } | null = null;
  let visible: VisibleRows | undefined;
  let collapsedVersion = 0;
  let destroyed = false;
  // True while setOptions applies several changes, so they produce one state update instead of several.
  let batching = false;

  // The pointer over the timeline (for the tooltip), and the tooltip it shows.
  let hoverPoint: TimelinePoint | null = null;
  let tooltip: TaskTooltip | null = null;
  let editorView: EditorView | undefined;

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
    if (reveal !== null) {
      const index = rowIndex.get(reveal);
      const top = index === undefined ? null : revealTopOf(index, viewport, rows.rowHeight);
      if (top !== null) scrollTo = { top };
      reveal = null;
    }
    if (menu?.kind === 'task' && !projectState.tasks.byId.has(menu.taskId as Id)) menu = null;
    editorView = {
      ...visible,
      project: projectState,
      columns: view.columns,
      dateField: dateKind(timeAxis.preset.timeResolution.unit),
    };
    const tooltipView = {
      project: projectState,
      timeAxis,
      rows,
      rowIds,
      viewport,
      locale: view.timeline.locale,
    };
    tooltip =
      hoverPoint && behaviour.taskTooltip && !shownInteraction
        ? tooltipFor(tooltipView, hoverPoint, tooltip)
        : null;
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
      tooltip,
      editing: editor.current(editorView),
      menu,
      taskEditor: taskEditor.current(editorView),
      scrollTo,
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
    if (shownInteraction) tooltip = null;
    return next;
  };

  const editor = createCellEditor({
    view: () => editorView as EditorView,
    enabled: () => behaviour.cellEdit,
    plan: (fn) => project.plan(fn),
    commit(fn) {
      changing(() => binding.transact(fn));
    },
    validate: (change) => (behaviour.validateChange ? behaviour.validateChange(change) : true),
    show: () => {
      if (!batching && !destroyed) refresh();
    },
    focusRow(id) {
      selection = selection.set.has(id)
        ? selectionOf(selection, selection.ids, id, selection.anchor)
        : selectionOf(selection, [id], id, id);
    },
  });

  const taskEditor = createTaskEditor({
    view: () => editorView as EditorView,
    enabled: () => behaviour.taskEdit,
    plan: (fn) => project.plan(fn),
    commit(fn) {
      changing(() => binding.transact(fn));
    },
    show: () => {
      if (!batching && !destroyed) refresh();
    },
  });

  let state = derive(INITIAL_VIEWPORT, project.getState());

  const drags = createInteraction({
    view: () => interactionView as InteractionView,
    show(next) {
      shownInteraction = next;
      setState({ ...state, interaction: next, tooltip: next ? null : state.tooltip });
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
    const arrived = added !== null && projectState.tasks.byId.has(added) ? added : null;
    added = null; // in this change, or not coming (the app didn't take it)
    if (arrived !== null) {
      selection = selectionOf(selection, [arrived], arrived, arrived);
      reveal = arrived;
    }
    // Reported once the change is complete (see announce), not in the middle of committing it.
    if (arrived !== null) editAdded = arrived;
    if (!batching) {
      setState(derive(state.viewport, projectState));
      openAdded();
    }
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

  /**
   * Saves an open edit whose field is no longer there to take the keys and presses (its row scrolled out of the
   * rendered window, say); a value that can't be saved is dropped, as on blur.
   */
  const closeEdit = (): void => {
    if (!state.editing) return;
    if (!editor.commit()) editor.cancel();
  };

  const parentOf = (id: Id): Id | null => state.project.tasks.byId.get(id)?.parentId ?? null;

  const menuContext = (target: MenuTarget): MenuContext => ({
    target,
    task: target.kind === 'task' ? (state.project.tasks.byId.get(target.id) ?? null) : null,
    selection: selection.ids,
    preset: view.timeline.preset,
  });

  /** A change from the task menu; the data refusing it changes nothing. */
  const changeFromMenu = (fn: (tx: Transaction) => void): void => {
    try {
      changing(() => binding.transact(fn));
    } catch (error) {
      if (!(error instanceof QuartzioError)) throw error;
      added = null;
    }
  };

  const expand = (ids: readonly Id[]): void => {
    if (ids.some((id) => collapsed.has(id)))
      setCollapsed(new Set([...collapsed].filter((id) => !ids.includes(id))));
  };

  const runTaskAction = (id: TaskMenuItemId, taskId: Id): void => {
    const task = state.project.tasks.byId.get(taskId);
    if (!task) return;
    const targets = targetsOf(taskId, selection.ids, getTreeIndex(state.project.tasks));
    const add = (where: AddWhere) => {
      // A subtask of a collapsed parent would be hidden.
      if (where === 'subtask') expand([taskId]);
      changeFromMenu((tx) => {
        added = addTask(tx, task, where, behaviour.createTaskId?.());
      });
    };
    switch (id) {
      case 'edit':
        controller.openTaskEditor(taskId);
        return;
      case 'addTaskAbove': {
        add('above');
        return;
      }
      case 'addTaskBelow': {
        add('below');
        return;
      }
      case 'addSubtask': {
        add('subtask');
        return;
      }
      case 'addMilestone': {
        add('milestone');
        return;
      }
      case 'addSuccessor': {
        add('successor');
        return;
      }
      case 'addPredecessor': {
        add('predecessor');
        return;
      }
      case 'indent': {
        let parents: Id[] = [];
        const { tasks, dependencies } = state.project;
        changeFromMenu((tx) => {
          parents = indent(tx, targets, getTreeIndex(tasks), dependencies.byId.values());
        });
        expand(parents); // so the indented tasks stay in view
        return;
      }
      case 'outdent': {
        changeFromMenu((tx) => {
          outdent(tx, targets);
        });
        return;
      }
      case 'convertToMilestone': {
        changeFromMenu((tx) => {
          tx.tasks.update(taskId, { duration: 0 });
        });
        return;
      }
      case 'delete':
        removeTasks(targets);
    }
  };

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
      // The same preset as before on a zoomed chart (e.g. the same prop on the next render) keeps the zoom.
      const keepZoom = zoomed && 'preset' in next && isEqual(next.preset, presetOption);
      const { preset: _preset, ...withoutPreset } = next;
      const effective = keepZoom ? withoutPreset : next;
      const nextView = VIEW_KEYS.some((key) => key in effective) ? resolveViewOptions(effective, view) : view;
      const nextBehaviour = resolveBehaviour(next, behaviour);
      const before = project.getState();

      const previousView = view;
      view = nextView;
      batching = true;
      try {
        if (controlled && 'data' in next) {
          binding.setData(next.data);
          // A task added from the menu comes with the next data, or not at all (the app didn't take it).
          added = null;
        }
      } catch (error) {
        view = previousView;
        throw error;
      } finally {
        batching = false;
      }
      if ('onChange' in next) binding.setOnChange(next.onChange);
      behaviour = nextBehaviour;
      if ('preset' in next && !keepZoom) {
        zoomed = false;
        presetOption = next.preset;
      }
      if (menu && !(menu.kind === 'task' ? behaviour.taskMenu : behaviour.timeAxisMenu)) menu = null;
      if (!behaviour.undoRedo) history.clear();
      // Recomputed from scratch: the texts depend on the options (locale, columns).
      if (!sameView(nextView, previousView)) tooltip = null;
      if (!behaviour.multiSelect && selection.ids.length > 1) {
        const last = selection.ids.at(-1) as Id;
        selection = selectionOf(selection, [last], selection.active, last);
      }
      if (
        !sameView(nextView, previousView) ||
        project.getState() !== before ||
        state.history !== history.state() ||
        state.selection !== selection.ids ||
        (state.tooltip !== null && !behaviour.taskTooltip) ||
        (state.editing !== null && !behaviour.cellEdit) ||
        state.menu !== menu ||
        (state.taskEditor !== null && !behaviour.taskEdit)
      ) {
        refresh();
      }
      openAdded();
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
      // What's under a still pointer changes while scrolling; the tooltip goes until it moves again.
      if (viewport.scrollLeft !== current.scrollLeft || viewport.scrollTop !== current.scrollTop) menu = null;
      if (viewport.scrollLeft !== current.scrollLeft || viewport.scrollTop !== current.scrollTop)
        hoverPoint = null;
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
      closeEdit();
      if (menu) {
        menu = null;
        refresh();
      }
      press = { origin: point, id: visibleRows().rowIds[index] ?? null, modifiers: modifiersOf(modifiers) };
      if (hoverPoint) {
        hoverPoint = null;
        refresh();
      }
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
      closeEdit();
      const height = state.viewport.height > 0 ? state.viewport.height : UNMEASURED_HEIGHT;
      const command = keyCommand(input, {
        ...visibleRows(),
        selection,
        collapsed,
        pageRows: Math.floor(height / state.rows.rowHeight),
        multiSelect: behaviour.multiSelect,
        deleteKey: behaviour.deleteKey,
        undoRedo: behaviour.undoRedo,
        cellEdit: behaviour.cellEdit,
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
        case 'menu':
          return controller.openMenu({ kind: 'task', id: command.id });
        case 'edit': {
          const started = editor.start(command.id);
          announce(); // the cursor may have moved
          return started;
        }
      }
    },

    hover(point) {
      if (destroyed) return;
      const next = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
      if (next === null && hoverPoint === null) return;
      hoverPoint = next;
      const shown =
        next && behaviour.taskTooltip && !shownInteraction && interactionView
          ? tooltipFor(interactionView, next, tooltip)
          : null;
      tooltip = shown;
      if (shown !== state.tooltip) setState({ ...state, tooltip: shown });
    },

    startEdit(id, columnId) {
      if (destroyed) return false;
      const started = editor.start(id, columnId);
      announce(); // the cursor may have moved
      return started;
    },
    editInput(text) {
      if (!destroyed) editor.input(text);
    },
    editKeyDown(key) {
      if (destroyed) return false;
      const used = editor.keyDown(key);
      announce(); // Tab may move the cursor
      return used;
    },
    commitEdit: () => !destroyed && editor.commit(),
    cancelEdit() {
      if (!destroyed) editor.cancel();
    },

    openMenu(target, point) {
      if (destroyed || typeof target !== 'object' || (target as unknown) === null) return false;
      // Opened during a press (Ctrl-click on macOS): that press is not a click or a drag.
      press = null;
      drags.cancel();
      const at = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
      let items: readonly MenuItem[];
      let y: number;
      if (target.kind === 'task') {
        const task = state.project.tasks.byId.get(target.id);
        if (!behaviour.taskMenu || !task) return false;
        // As in a file list: a row that isn't selected is selected alone; a selection that has it is kept.
        const id = task.id;
        selection = selection.set.has(id)
          ? selectionOf(selection, selection.ids, id, selection.anchor)
          : selectionOf(selection, [id], id, id);
        const tree = getTreeIndex(state.project.tasks);
        const targets = targetsOf(id, selection.ids, tree);
        const builtIn = taskMenuItems(task, targets, tree, parentOf, { edit: behaviour.taskEdit });
        items = customized(builtIn, behaviour.taskMenuItems, menuContext(target));
        const row = visibleRows().rowIndex.get(id) ?? 0;
        const { header, rows, viewport } = state;
        // Below the row, kept within the visible rows (the row may be scrolled out of view).
        const below = header.height + (row + 1) * rows.rowHeight - viewport.scrollTop;
        y = Math.max(header.height, Math.min(below, header.height + Math.max(viewport.height, 0)));
      } else if ((target.kind as unknown) === 'timeAxis') {
        if (!behaviour.timeAxisMenu) return false;
        const builtIn = timeAxisMenuItems(view.timeline.preset);
        items = customized(builtIn, behaviour.timeAxisMenuItems, menuContext(target));
        y = state.header.height;
      } else {
        return false;
      }
      if (items.length === 0) return false;
      menu = {
        kind: target.kind,
        taskId: target.kind === 'task' ? target.id : null,
        x: at?.x ?? KEYBOARD_MENU_X,
        y: at?.y ?? y,
        items,
        // Opened with the keyboard: the first item is ready to be picked.
        active: at ? null : (items.find((item) => item.disabled !== true)?.id ?? null),
        submenu: null,
      };
      refresh();
      announce();
      return true;
    },

    menuKeyDown(key) {
      if (destroyed || !menu || typeof key !== 'object' || (key as unknown) === null) return false;
      const result = menuKey(menu, key);
      if (!result) return false;
      if (result.pick !== undefined) {
        controller.menuAction(result.pick);
        return true;
      }
      menu = result.menu;
      refresh();
      return true;
    },

    menuHover(id) {
      if (destroyed || !menu) return;
      const next = menuHover(menu, id);
      if (next === menu) return;
      menu = next;
      refresh();
    },

    menuAction(id) {
      const open = menu;
      const item = open && !destroyed ? findItem(open.items, id) : undefined;
      if (!open || !item || item.disabled === true || item.items) return;
      menu = null;
      refresh();
      const target: MenuTarget =
        open.kind === 'task' ? { kind: 'task', id: open.taskId as Id } : { kind: 'timeAxis' };
      if (item.action) {
        item.action(menuContext(target));
        return;
      }
      if (target.kind === 'timeAxis') {
        if (id === 'zoomIn' || id === 'zoomOut') controller.zoom(id === 'zoomIn' ? 'in' : 'out');
        else if (id.startsWith('preset:')) controller.zoom(id.slice('preset:'.length));
        return;
      }
      runTaskAction(id as TaskMenuItemId, target.id);
    },

    closeMenu() {
      if (destroyed || !menu) return;
      menu = null;
      refresh();
    },

    zoom(target) {
      if (destroyed || typeof target !== 'string') return false;
      const current = view.timeline.preset;
      const next =
        target === 'in' || target === 'out'
          ? zoomStep(current, target)
          : VIEW_PRESETS.find((preset) => preset.id === target);
      if (!next || next === current || isEqual(next, current)) return false;
      const { width, scrollLeft } = state.viewport;
      const middle = width > 0 ? state.timeAxis.xToDate(scrollLeft + width / 2) : null;
      view = resolveViewOptions({ preset: next }, view);
      zoomed = true;
      tooltip = null;
      refresh();
      if (middle !== null) {
        // Keep what was in the middle of the view there.
        scrollTo = { left: Math.max(0, Math.round(state.timeAxis.dateToX(middle) - width / 2)) };
        setState({ ...state, scrollTo });
      }
      behaviour.onPresetChange?.(next.id);
      return true;
    },

    openTaskEditor(id) {
      if (destroyed) return false;
      closeEdit();
      menu = null;
      return taskEditor.open(id);
    },

    taskEditorAction(action) {
      if (destroyed) return false;
      const used = taskEditor.act(action);
      announce();
      return used;
    },

    doubleClick(point) {
      if (destroyed || !interactionView || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        return false;
      const hit = barUnder(interactionView, point);
      return hit ? controller.openTaskEditor(hit.taskId) : false;
    },

    revealTop(id) {
      const index = destroyed ? undefined : visibleRows().rowIndex.get(id);
      return index === undefined ? null : revealTopOf(index, state.viewport, state.rows.rowHeight);
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
