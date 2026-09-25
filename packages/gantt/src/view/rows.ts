import { getWorkingCalendar } from '../calendar/project';
import type { WorkingCalendar } from '../calendar/workingCalendar';
import { getTreeIndex } from '../data/tree';
import type { Id, ProjectState, Task } from '../data/types';
import { taskDates, type TaskDates } from './dates';
import type { TimeAxis } from '../timeaxis/timeAxis';
import { computeBar, sameBar, type Bar } from './bars';
import type { ResolvedColumns } from './columns';
import type { Viewport } from './types';

/** A string key per task for rendering lists: tasks 1 and "1" are different. */
export const rowKey = (id: Id): string => `${typeof id === 'number' ? 'n' : 's'}:${String(id)}`;

export interface Row {
  readonly id: Id;
  /** Unique string key for rendering lists (ids 1 and "1" are different tasks). */
  readonly key: string;
  /** Position among the visible rows. */
  readonly index: number;
  readonly y: number;
  readonly height: number;
  /** 0 for root tasks. */
  readonly depth: number;
  readonly task: Task;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  /** Computed display dates, or `null` for unscheduled tasks. */
  readonly dates: TaskDates | null;
  /** Cell texts, one per column. */
  readonly cells: readonly string[];
  /** The task's bar on the timeline, or `null` for unscheduled tasks. */
  readonly bar: Bar | null;
}

export interface RowsState {
  readonly rowHeight: number;
  /** Visible rows in total (not counting collapsed descendants). */
  readonly count: number;
  readonly totalHeight: number;
  /**
   * Rows around the visible part only (virtualized). Unchanged rows keep their identity, so they can be
   * memoized, and the array itself is reused while scrolling within the rendered window.
   */
  readonly items: readonly Row[];
}

export interface RowsInput {
  readonly project: ProjectState;
  readonly collapsed: ReadonlySet<Id>;
  /** Changes whenever `collapsed` changes. */
  readonly collapsedVersion: number;
  readonly viewport: Viewport;
  readonly rowHeight: number;
  readonly columns: ResolvedColumns;
  readonly locale: string | undefined;
  readonly timeAxis: TimeAxis;
}

/** Assumed viewport height before it has been measured (and when rendering on the server). */
export const UNMEASURED_HEIGHT = 800;

interface VisibleRows {
  readonly ids: readonly Id[];
  readonly depths: readonly number[];
  /** Row index per visible task. */
  readonly index: ReadonlyMap<Id, number>;
}

/** Tree order, skipping the descendants of collapsed tasks. Iterative, so deep trees can't overflow. */
function visibleRows(project: ProjectState, collapsed: ReadonlySet<Id>): VisibleRows {
  const tree = getTreeIndex(project.tasks);
  const ids: Id[] = [];
  const depths: number[] = [];
  const index = new Map<Id, number>();
  const stack: [Id, number][] = [...tree.children(null)].reverse().map((id): [Id, number] => [id, 0]);
  while (stack.length > 0) {
    const [id, depth] = stack.pop() as [Id, number];
    index.set(id, ids.length);
    ids.push(id);
    depths.push(depth);
    if (!collapsed.has(id)) {
      const children = tree.children(id);
      for (let i = children.length - 1; i >= 0; i--) stack.push([children[i] as Id, depth + 1]);
    }
  }
  return { ids, depths, index };
}

const sameCells = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((text, i) => text === b[i]);

const sameDates = (a: TaskDates | null, b: TaskDates | null) =>
  a === b || (a !== null && b !== null && a.start === b.start && a.end === b.end);

export function createRowsView(): {
  /** The rows, the row index of every visible task and the task of every row (the same while visibility is unchanged). */
  rowsFor: (input: RowsInput) => {
    rows: RowsState;
    rowIndex: ReadonlyMap<Id, number>;
    rowIds: readonly Id[];
  };
} {
  let visibleCache: { key: unknown[]; rows: VisibleRows } | undefined;
  let calendarCache: { project: ProjectState; calendar: WorkingCalendar | undefined } | undefined;
  let windowCache: { key: unknown[]; first: number; last: number; state: RowsState } | undefined;
  let previousRows = new Map<Id, Row>();

  const calendarFor = (project: ProjectState): WorkingCalendar | undefined => {
    if (calendarCache?.project !== project) {
      let calendar: WorkingCalendar | undefined;
      try {
        calendar = getWorkingCalendar(project);
      } catch {
        calendar = undefined;
      }
      calendarCache = { project, calendar };
    }
    return calendarCache.calendar;
  };

  const rowsFor = (input: RowsInput): RowsState => {
    const { project, collapsed, collapsedVersion, viewport, rowHeight, columns, locale, timeAxis } = input;

    const visibleKey = [project.tasks, collapsedVersion];
    if (!visibleCache || visibleKey.some((part, i) => part !== visibleCache?.key[i])) {
      visibleCache = { key: visibleKey, rows: visibleRows(project, collapsed) };
    }
    const visible = visibleCache.rows;
    const count = visible.ids.length;

    const height = viewport.height > 0 ? viewport.height : UNMEASURED_HEIGHT;
    const clamp = (index: number) => Math.max(0, Math.min(count, index));
    const visibleFirst = clamp(Math.floor(viewport.scrollTop / rowHeight));
    const visibleLast = clamp(Math.ceil((viewport.scrollTop + height) / rowHeight));

    const key = [visible, project, rowHeight, columns, locale, timeAxis];
    if (
      windowCache &&
      key.every((part, i) => part === windowCache?.key[i]) &&
      windowCache.first <= visibleFirst &&
      visibleLast <= windowCache.last
    ) {
      return windowCache.state;
    }

    // Render one extra viewport above and below, so most scrolling reuses the same rows.
    const first = clamp(Math.floor((viewport.scrollTop - height) / rowHeight));
    const last = clamp(Math.ceil((viewport.scrollTop + 2 * height) / rowHeight));
    const tree = getTreeIndex(project.tasks);
    const calendar = calendarFor(project);
    const rows = new Map<Id, Row>();
    const items: Row[] = [];

    for (let index = first; index < last; index++) {
      const id = visible.ids[index] as Id;
      const task = project.tasks.byId.get(id) as Task;
      const hasChildren = !tree.isLeaf(id);
      const rowDates = taskDates(task);
      const context = {
        task,
        isParent: hasChildren,
        dates: rowDates,
        settings: project.settings,
        locale,
        calendar,
      };
      const row: Row = {
        id,
        key: rowKey(id),
        index,
        y: index * rowHeight,
        height: rowHeight,
        depth: visible.depths[index] as number,
        task,
        hasChildren,
        expanded: hasChildren && !collapsed.has(id),
        dates: rowDates,
        cells: columns.values.map((value) => value(context)),
        bar: computeBar(task, rowDates, hasChildren, timeAxis),
      };
      const previous = previousRows.get(id);
      const same =
        previous?.task === row.task &&
        previous.index === row.index &&
        previous.height === row.height &&
        previous.depth === row.depth &&
        previous.expanded === row.expanded &&
        previous.hasChildren === row.hasChildren &&
        sameDates(previous.dates, row.dates) &&
        sameCells(previous.cells, row.cells) &&
        sameBar(previous.bar, row.bar);
      const kept = same ? previous : row;
      rows.set(id, kept);
      items.push(kept);
    }

    previousRows = rows;
    const state: RowsState = { rowHeight, count, totalHeight: count * rowHeight, items };
    // At the list's edges the window can't grow, so treat it as open-ended there.
    windowCache = {
      key,
      first: first === 0 ? -1 : first,
      last: last === count ? Number.POSITIVE_INFINITY : last,
      state,
    };
    return state;
  };

  return {
    rowsFor: (input) => {
      const rows = rowsFor(input);
      const visible = (visibleCache as { rows: VisibleRows }).rows;
      return { rows, rowIndex: visible.index, rowIds: visible.ids };
    },
  };
}
