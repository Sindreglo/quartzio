import type { Transaction } from '../data/transaction';
import type { DateInput, Id, Patch, ProjectData, ProjectInput, ProjectState } from '../data/types';
import type { ViewPreset } from '../timeaxis/presets';
import type { HeaderCell, TimeAxis } from '../timeaxis/timeAxis';
import type { ColumnInput, ColumnsState } from './columns';
import type { DependencyLine } from './dependencies';
import type { ProposedChange, TaskInteraction, TimelineHit, TimelinePoint } from './interaction';
import type { HistoryState } from './history';
import type { CellEdit } from './editing';
import type { KeyInput } from './keyboard';
import type { TimeSpan } from './nonWorking';
import type { RowsState } from './rows';
import type { KeyModifiers } from './selection';
import type { TaskTooltip } from './tooltip';

/**
 * The visible part of the timeline body: its size (excluding the task list and the header) and the scroll
 * position of the shared scroll area.
 */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

export interface HeaderState {
  /**
   * Cells per header row (top to bottom), only around the visible part of the timeline. The arrays keep
   * their identity while scrolling within the rendered window, so rows can be memoized.
   */
  readonly rows: readonly (readonly HeaderCell[])[];
  readonly rowHeight: number;
  /** All header rows together. */
  readonly height: number;
}

/** Everything a renderer needs to draw the chart. Plain data — no DOM, no framework types. */
export interface ViewState {
  readonly viewport: Viewport;
  readonly project: ProjectState;
  readonly timeAxis: TimeAxis;
  readonly header: HeaderState;
  /** Columns of the task list on the left. */
  readonly columns: ColumnsState;
  /** Visible task rows (virtualized), in tree order, with their bars. */
  readonly rows: RowsState;
  /** Dependency arrows near the rendered rows (virtualized with them). */
  readonly dependencies: readonly DependencyLine[];
  /** Where "now" is on the timeline, or `null` when outside it (or turned off). */
  readonly today: TodayLine | null;
  /** Non-working time to shade, around the visible part of the timeline. */
  readonly nonWorkingTime: readonly TimeSpan[];
  /** What's being dragged, and where it would land; `null` when nothing is. */
  readonly interaction: TaskInteraction | null;
  /** Which drag interactions are on (from the options), e.g. to show their handles. The same object while unchanged. */
  readonly interactions: Interactions;
  /** Whether there's something to undo or redo. The same object while unchanged. */
  readonly history: HistoryState;
  /** Selected task ids, in the order they were selected. The same array while unchanged. */
  readonly selection: readonly Id[];
  /** The task the keyboard cursor is on, or `null`. */
  readonly activeId: Id | null;
  /** The tooltip for the task under the pointer, or `null`. The same object while it shows the same. */
  readonly tooltip: TaskTooltip | null;
  /** The cell being edited, or `null`. */
  readonly editing: CellEdit | null;
}

export interface Interactions {
  readonly drag: boolean;
  readonly resize: boolean;
  readonly create: boolean;
  readonly progress: boolean;
  readonly link: boolean;
}

export interface TodayLine {
  /** When the line was placed; it only moves once it reaches the next pixel. */
  readonly time: number;
  /** Whole pixels. */
  readonly x: number;
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
   *
   * Having the `data` key makes the chart controlled, even when the value is `undefined` (shown as an
   * empty project, e.g. while data is loading). Leave the key out entirely for uncontrolled usage.
   */
  data?: ProjectInput | undefined;
  /** Initial data for uncontrolled usage, where the engine keeps the edited data itself. */
  defaultData?: ProjectInput | undefined;
  onChange?: ((change: GanttDataChange) => void) | undefined;
  /**
   * A built-in preset id (`'hourAndDay'` … `'manyYears'`, default `'weekAndDay'`) or a custom preset. Custom
   * presets are compared by value, but a label function is compared by identity: define custom presets outside
   * render (or memoize them), or an inline function makes every render a change that rebuilds the time axis.
   */
  preset?: string | ViewPreset | undefined;
  /**
   * The timeline range. Defaults to the tasks' dates with a little padding. Strings without an offset are
   * read in the project's time zone. The timeline is always at least as wide as the viewport.
   */
  startDate?: DateInput | undefined;
  endDate?: DateInput | undefined;
  /** Locale for header labels and cells, e.g. `'nb-NO'`. Defaults to the runtime's locale. */
  locale?: string | undefined;
  /** Task list columns. Defaults to name, start, end and duration. */
  columns?: readonly ColumnInput[] | undefined;
  /** Height of a task row in pixels. Default 36. */
  rowHeight?: number | undefined;
  /** Height of each header row in pixels. Default 28. */
  headerRowHeight?: number | undefined;
  /** Show a line at the current time. Default `true`. */
  showToday?: boolean | undefined;
  /**
   * Shade non-working time from the project calendar. Default `true`. With ticks under a day, every non-working
   * interval is shaded; with day ticks, whole non-working days; with longer ticks, nothing.
   */
  showNonWorkingTime?: boolean | undefined;
  /** Move tasks by dragging their bars. Default `true`. See ADR 0009 for what a drop changes. */
  taskDrag?: boolean | undefined;
  /** Change a task's duration by dragging the end of its bar. Default `true`. */
  taskResize?: boolean | undefined;
  /** Give an unscheduled task dates by drawing its bar in its row. Default `true`. */
  taskDragCreate?: boolean | undefined;
  /** Change a task's percentage done by dragging the handle at its progress. Default `true`. */
  progressDrag?: boolean | undefined;
  /** Add dependencies by dragging from a handle at either end of a bar to another bar. Default `true`. */
  dependencyCreate?: boolean | undefined;
  /**
   * Called for every change a drag proposes (move, resize, create, progress, link), while dragging and on the
   * drop. Return `false`, or a message to show, to refuse it: the preview shows it as invalid and the drop
   * changes nothing.
   */
  validateChange?: ((change: ProposedChange) => boolean | string) | undefined;
  /**
   * Keep a history of changes for `undo`/`redo` (the last 100). Default `true`. Turning it off forgets the
   * history. Controlled: a change counts once the app passes its data back; other data clears the history.
   */
  undoRedo?: boolean | undefined;
  /** Select several tasks (Ctrl/Cmd-click, Shift-click, Shift+arrows). Default `true`. */
  multiSelect?: boolean | undefined;
  /** Delete the selected tasks (with their subtasks) with Delete or Backspace. Default `true`. */
  deleteKey?: boolean | undefined;
  /** Called with the selected ids whenever the selection changes (also when deleted tasks drop out of it). */
  onSelectionChange?: ((selection: readonly Id[]) => void) | undefined;
  /** Show a tooltip for the task under the pointer (see `hover`). Default `true`. */
  taskTooltip?: boolean | undefined;
  /** Edit cells in the task list (double-click, Enter/F2). Default `true`. See ADR 0011 for what an edit does. */
  cellEdit?: boolean | undefined;
}

// Property signatures (not methods) so the functions can be passed around unbound,
// e.g. `useSyncExternalStore(gantt.subscribe, gantt.getState)`.
export interface GanttController {
  /** Returns the same object until the state changes, so it can back `useSyncExternalStore`. */
  getState: () => ViewState;
  /**
   * The first subscription also reports (through `onChange`, after a microtask) what scheduling changed in the
   * initial data, so the app can keep the scheduled data.
   */
  subscribe: (listener: (state: ViewState) => void) => () => void;
  /**
   * Updates options after creation. All options are validated first: an invalid one throws and changes
   * nothing. `data` is only honoured in controlled mode; controlled vs. uncontrolled is decided at creation.
   */
  setOptions: (options: GanttOptions) => void;
  setViewport: (viewport: Partial<Viewport>) => void;
  /**
   * What's under a point of the timeline body (x from the start of the axis, y from the top of the first
   * row): a bar to move or a bar end to resize, if enabled. For the pointer cursor.
   */
  hitTest: (point: TimelinePoint) => TimelineHit | null;
  /**
   * Pointer events on the timeline body, in the same coordinates. `pointerDown` returns whether the press
   * counts (so the renderer can capture the pointer until `pointerUp`). Moves under 3 px are a click, which
   * selects the row (with the modifiers held at the press); a drop is one transaction.
   */
  pointerDown: (point: TimelinePoint, modifiers?: KeyModifiers) => boolean;
  pointerMove: (point: TimelinePoint) => void;
  pointerUp: (point: TimelinePoint) => void;
  /** Drops the current drag without changing anything (e.g. on Escape). Returns whether there was one. */
  cancelInteraction: () => boolean;
  /**
   * Changes project data. Uncontrolled: applied immediately. Controlled: only reported through
   * `onChange`; edits in the same synchronous run build on each other, later edits build on the last
   * `data` passed in. Returns the patch, or `null` if nothing changed.
   */
  transact: (fn: (tx: Transaction) => void) => Patch | null;
  /**
   * Reverts the last change (exactly, scheduling included), as a change of its own: reported through
   * `onChange`, and in controlled mode shown once the data comes back. Returns whether there was one.
   */
  undo: () => boolean;
  /** Applies the last undone change again. Returns whether there was one. */
  redo: () => boolean;
  /**
   * A click on a row in the task list: selects it; Ctrl/Cmd toggles it, Shift selects the rows from the last
   * clicked one. Unknown and hidden rows are ignored.
   */
  rowClick: (id: Id, modifiers?: KeyModifiers) => void;
  /** Selects these tasks (unknown ids are skipped); the last one gets the keyboard cursor. */
  select: (ids: readonly Id[]) => void;
  clearSelection: () => void;
  /**
   * A key pressed while the chart has focus: moves the cursor and selection, expands and collapses, deletes,
   * undoes. Returns whether the key was used, so the renderer can stop it (see ADR 0010 for the keys).
   */
  keyDown: (key: KeyInput) => boolean;
  /**
   * The `scrollTop` that brings a visible row into view (e.g. the active one after a key press), or `null`
   * when it's in view already, hidden or unknown.
   */
  revealTop: (id: Id) => number | null;
  /**
   * The pointer over the timeline body (mouse or pen), for the task tooltip; `null` when it leaves. In the
   * same coordinates as `pointerDown`.
   */
  hover: (point: TimelinePoint | null) => void;
  /**
   * Starts editing a cell (the first editable one of the row without a column). Returns whether it can be
   * edited; an open edit is closed either way.
   */
  startEdit: (id: Id, columnId?: string) => boolean;
  /** The text in the cell's field, as it's typed. */
  editInput: (text: string) => void;
  /**
   * A key pressed in the cell's field: Enter saves, Escape cancels, Tab and Shift+Tab save and move on.
   * Returns whether the key was used (other keys belong to the field).
   */
  editKeyDown: (key: KeyInput) => boolean;
  /** Saves the edit. Returns `false` (and keeps it open, with the reason in `error`) when it's refused. */
  commitEdit: () => boolean;
  cancelEdit: () => void;
  /** Expands a collapsed task or collapses an expanded one. Unknown ids and leaf tasks are ignored. */
  toggle: (id: Id) => void;
  setExpanded: (id: Id, expanded: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
  destroy: () => void;
}
