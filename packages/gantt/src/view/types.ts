import type { Transaction } from '../data/transaction';
import type { DateInput, Id, Patch, ProjectData, ProjectInput, ProjectState } from '../data/types';
import type { ViewPreset } from '../timeaxis/presets';
import type { HeaderCell, TimeAxis } from '../timeaxis/timeAxis';
import type { ColumnInput, ColumnsState } from './columns';
import type { DependencyLine } from './dependencies';
import type { ProposedChange, TaskInteraction, TimelineHit, TimelinePoint } from './interaction';
import type { TimeSpan } from './nonWorking';
import type { RowsState } from './rows';

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
   * Pointer events on the timeline body, in the same coordinates. `pointerDown` returns whether it grabbed a
   * bar (so the renderer can capture the pointer). Moves under 3 px are a click. The drop is one transaction.
   */
  pointerDown: (point: TimelinePoint) => boolean;
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
  /** Expands a collapsed task or collapses an expanded one. Unknown ids and leaf tasks are ignored. */
  toggle: (id: Id) => void;
  setExpanded: (id: Id, expanded: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
  destroy: () => void;
}
