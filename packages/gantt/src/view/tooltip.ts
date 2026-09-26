import { getWorkingCalendar } from '../calendar/project';
import type { WorkingCalendar } from '../calendar/workingCalendar';
import { getTreeIndex } from '../data/tree';
import type { Id, ProjectState, Task } from '../data/types';
import type { TimeAxis } from '../timeaxis/timeAxis';
import { builtInText, type CellContext } from './columns';
import { taskDates } from './dates';
import { barUnder, type TimelinePoint } from './interaction';
import { rowKey, type RowsState } from './rows';
import type { Viewport } from './types';

/** The tooltip for the task under the pointer: what to show, and where (see ADR 0011). */
export interface TaskTooltip {
  readonly taskId: Id;
  /** Key of the task's row. */
  readonly rowKey: string;
  readonly task: Task;
  readonly title: string;
  /** Formatted values, in order. */
  readonly fields: readonly { readonly label: string; readonly value: string }[];
  /**
   * Where it points to, in timeline coordinates: the start of the visible part of the bar (`align: 'start'`) or
   * its end (`'end'`, the tooltip's right edge there).
   */
  readonly x: number;
  readonly align: 'start' | 'end';
  /** The room (px) from `x` to the edge of the visible timeline it runs towards; `null` before measuring. */
  readonly room: number | null;
  /**
   * The top of the row (the tooltip above it), or its bottom when `below`: when there's no room above it in the
   * visible rows (the header would cover it) and more below.
   */
  readonly y: number;
  readonly below: boolean;
}

export interface TooltipView {
  readonly project: ProjectState;
  readonly timeAxis: TimeAxis;
  readonly rows: RowsState;
  readonly rowIds: readonly Id[];
  readonly viewport: Viewport;
  readonly locale: string | undefined;
}

/**
 * About how tall the default tooltip can get (a title and four lines, wrapped when there's little room), to
 * decide whether it fits above a row. Below a row, there's room for it.
 */
const TOOLTIP_HEIGHT = 160;

/** The tooltip for a point, or `null`. Returns `previous` when it would show the same. Never throws. */
export function tooltipFor(
  view: TooltipView,
  point: TimelinePoint,
  previous: TaskTooltip | null,
): TaskTooltip | null {
  const hit = barUnder(view, point);
  if (!hit) return null;
  const { bar, index, taskId } = hit;
  const task = view.project.tasks.byId.get(taskId);
  const dates = task ? taskDates(task) : null;
  if (!task || !dates) return null;

  const { scrollLeft, width } = view.viewport;
  const right = bar.x + bar.width; // a milestone's width is 0: its center
  const visibleStart = Math.max(bar.x, scrollLeft);
  const visibleEnd = width > 0 ? Math.min(right, scrollLeft + width) : right;
  // Towards the side with more room, so it runs past the edge as little as possible (and is kept within it).
  const roomAfter = scrollLeft + width - visibleStart;
  const roomBefore = visibleEnd - scrollLeft;
  const align = width > 0 && roomBefore > roomAfter ? 'end' : 'start';
  const room = width > 0 ? Math.max(0, Math.round(align === 'end' ? roomBefore : roomAfter)) : null;
  const rowHeight = view.rows.rowHeight;
  const roomAbove = index * rowHeight - view.viewport.scrollTop;
  const roomBelow =
    view.viewport.height > 0
      ? view.viewport.scrollTop + view.viewport.height - (index + 1) * rowHeight
      : Number.POSITIVE_INFINITY;
  const below = roomAbove < TOOLTIP_HEIGHT && roomBelow > roomAbove;
  const x = align === 'end' ? visibleEnd : visibleStart;
  const y = below ? (index + 1) * rowHeight : index * rowHeight;
  const same =
    previous?.task === task &&
    previous.x === x &&
    previous.y === y &&
    previous.align === align &&
    previous.room === room;
  if (same) return previous;

  const cell: CellContext = {
    task,
    isParent: !getTreeIndex(view.project.tasks).isLeaf(taskId),
    dates,
    settings: view.project.settings,
    locale: view.locale,
    calendar: calendarOf(view.project),
  };
  const fields: TaskTooltip['fields'] =
    bar.kind === 'milestone'
      ? [{ label: 'Date', value: builtInText('startDate', cell) }]
      : [
          { label: 'Start', value: builtInText('startDate', cell) },
          { label: 'End', value: builtInText('endDate', cell) },
          { label: 'Duration', value: builtInText('duration', cell) },
          { label: 'Done', value: builtInText('percentDone', cell) },
        ];
  return { taskId, rowKey: rowKey(taskId), task, title: task.name, fields, x, align, room, y, below };
}

function calendarOf(project: ProjectState): WorkingCalendar | undefined {
  try {
    return getWorkingCalendar(project);
  } catch {
    return undefined;
  }
}
