import { workingMsPerUnit } from '../calendar/duration';
import { getWorkingCalendar } from '../calendar/project';
import type { Transaction } from '../data/transaction';
import { getTreeIndex } from '../data/tree';
import type { Id, ProjectState, Task } from '../data/types';
import type { TimeAxis } from '../timeaxis/timeAxis';
import { QuartzioError } from '../util/errors';
import { addUnits } from '../util/zone';
import { computeBar, type Bar } from './bars';
import { formatDate, formatDateTime, formatEndDate } from './cells';
import { taskDates } from './dates';
import { rowKey, type RowsState } from './rows';

/** A point on the timeline body: x from the start of the axis, y from the top of the first row. */
export interface TimelinePoint {
  readonly x: number;
  readonly y: number;
}

export type HitArea = 'bar' | 'resize-end';

/** What's under a point: a bar to move, or its end to resize (only what's enabled). */
export interface TimelineHit {
  readonly taskId: Id;
  readonly area: HitArea;
}

/** A bar being dragged or resized: where it would land. Only the dragged bar is previewed. */
export interface TaskInteraction {
  readonly kind: 'move' | 'resize';
  readonly taskId: Id;
  /** Key of the task's row, to set the original bar apart. */
  readonly rowKey: string;
  /** The bar at its new place (snapped), in timeline coordinates, in the task's row. */
  readonly bar: Bar;
  readonly start: number;
  readonly end: number;
  /** The new dates as text (locale and project time zone), e.g. for a tooltip. */
  readonly label: string;
}

/** Movement (px) below which a press and release is a click, not a drag. */
const CLICK_TOLERANCE = 3;
/** Hit targets are at least this wide, so short bars can still be grabbed. */
const MIN_HIT_WIDTH = 6;
/** The resize handle at a bar's end; less on short bars, so their middle can still be moved. */
const RESIZE_HANDLE = 6;
/** Half a milestone diamond (matches the default --qz-milestone-size; a changed size doesn't move the target). */
const MILESTONE_RADIUS = 7;
/** Dates must stay within what the data accepts (years 1000–9999). */
const MIN_TIME = Date.UTC(1000, 0, 1);
const MAX_TIME = Date.UTC(10_000, 0, 1) - 1;
const SUB_DAY = new Set(['millisecond', 'second', 'minute', 'hour']);

/** What the interaction needs from the view. */
export interface InteractionView {
  readonly project: ProjectState;
  readonly timeAxis: TimeAxis;
  readonly rows: RowsState;
  /** Row index of every visible task. */
  readonly rowIndex: ReadonlyMap<Id, number>;
  /** Task ids of the visible rows, by row index. */
  readonly rowIds: readonly Id[];
  readonly locale: string | undefined;
  readonly drag: boolean;
  readonly resize: boolean;
}

export interface InteractionContext {
  readonly view: () => InteractionView;
  readonly show: (interaction: TaskInteraction | null) => void;
  readonly commit: (fn: (tx: Transaction) => void) => void;
}

export interface Interaction {
  hitTest: (point: TimelinePoint) => TimelineHit | null;
  pointerDown: (point: TimelinePoint) => boolean;
  pointerMove: (point: TimelinePoint) => void;
  pointerUp: (point: TimelinePoint) => void;
  /** Drops the drag; returns whether there was one. */
  cancel: () => boolean;
  /**
   * For a new view, before it's shown: whether the drag still applies. A drag on a stale basis (another time
   * axis, a changed or hidden task, turned-off options) is dropped silently, so no outdated preview is shown.
   */
  keep: (next: InteractionView) => boolean;
}

interface Pending {
  readonly hit: TimelineHit;
  readonly origin: TimelinePoint;
  readonly task: Task;
  readonly bar: Bar;
  readonly axis: TimeAxis;
  readonly row: number;
  started: boolean;
  preview: TaskInteraction | null;
  /** The snapped time under the pointer: a move's new start (before moving to working time), or a new end. */
  snapped: number | null;
}

const finite = (point: TimelinePoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const inRange = (time: number) => Number.isFinite(time) && time >= MIN_TIME && time <= MAX_TIME;

/**
 * Dragging and resizing bars, as a small state machine fed with pointer events in timeline coordinates. Snaps to
 * the preset's time resolution; a drop becomes one transaction (see ADR 0009).
 */
export function createInteraction(context: InteractionContext): Interaction {
  let pending: Pending | null = null;

  const barOf = (view: InteractionView, id: Id): Bar | null => {
    const rendered = view.rows.items.find((row) => row.id === id);
    if (rendered) return rendered.bar;
    const task = view.project.tasks.byId.get(id);
    if (!task) return null;
    return computeBar(task, taskDates(task), !getTreeIndex(view.project.tasks).isLeaf(id), view.timeAxis);
  };

  const hitTest = (point: TimelinePoint): TimelineHit | null => {
    const view = context.view();
    if ((!view.drag && !view.resize) || !finite(point) || point.y < 0) return null;
    const taskId = view.rowIds[Math.floor(point.y / view.rows.rowHeight)];
    if (taskId === undefined) return null;
    const bar = barOf(view, taskId);
    if (!bar) return null;

    const left = bar.kind === 'milestone' ? bar.x - MILESTONE_RADIUS : bar.x;
    const width = bar.kind === 'milestone' ? 2 * MILESTONE_RADIUS : bar.width;
    const extra = Math.max(0, MIN_HIT_WIDTH - width) / 2;
    if (point.x < left - extra || point.x > left + width + extra) return null;
    const handle = Math.min(RESIZE_HANDLE, width / 3);
    if (view.resize && bar.kind === 'task' && point.x >= left + width - handle)
      return { taskId, area: 'resize-end' };
    return view.drag ? { taskId, area: 'bar' } : null;
  };

  /** Where a move to `start` lands: the end the drop will give, from the duration in working time. */
  const moved = (view: InteractionView, current: Pending, start: number): { start: number; end: number } => {
    const { task, bar } = current;
    if (bar.kind === 'milestone') return { start, end: start };
    try {
      const calendar = getWorkingCalendar(view.project);
      const ms =
        task.duration !== null && bar.kind === 'task'
          ? Math.round(task.duration * workingMsPerUnit(task.durationUnit, view.project.settings))
          : calendar.workingTimeBetween(bar.start, bar.end);
      // Automatic tasks start at working time (scheduling moves them there; predecessors may push further).
      const begin = task.manuallyScheduled || ms === 0 ? start : calendar.nextWorkingTime(start);
      return { start: begin, end: calendar.addWorkingTime(begin, ms) };
    } catch (error) {
      if (!(error instanceof QuartzioError)) throw error;
      return { start, end: start + (bar.end - bar.start) }; // e.g. no working time: keep the span
    }
  };

  /** The smallest end a resize allows: one step of the time resolution after the start. */
  const minimumEnd = (axis: TimeAxis, start: number, zone: ProjectState['settings']['timeZone']): number => {
    const snapped = axis.snap(start);
    if (snapped > start) return snapped;
    const { unit, increment } = axis.preset.timeResolution;
    return addUnits(snapped, increment, unit, zone);
  };

  const preview = (
    view: InteractionView,
    current: Pending,
    point: TimelinePoint,
  ): { interaction: TaskInteraction; snapped: number } | null => {
    const { timeAxis, project, locale } = view;
    const { bar, task } = current;
    const zone = project.settings.timeZone;
    const dx = point.x - current.origin.x;
    // From the dates, not the bar: a bar far outside the axis is clipped to near it.
    let snapped: number;
    let start: number;
    let end: number;
    if (current.hit.area === 'bar') {
      snapped = timeAxis.snap(timeAxis.xToDate(timeAxis.dateToX(bar.start) + dx));
      if (!inRange(snapped)) return null;
      ({ start, end } = moved(view, current, snapped));
    } else {
      snapped = timeAxis.snap(timeAxis.xToDate(timeAxis.dateToX(bar.end) + dx));
      if (!inRange(snapped)) return null;
      start = bar.start;
      end = Math.max(minimumEnd(timeAxis, start, zone), snapped);
    }
    if (!inRange(start) || !inRange(end)) return null;

    const next = computeBar(task, { start, end }, bar.kind === 'summary', timeAxis);
    if (!next) return null;
    const subDay = SUB_DAY.has(timeAxis.preset.timeResolution.unit);
    const format = (time: number) =>
      subDay ? formatDateTime(time, zone, locale) : formatDate(time, zone, locale);
    const label =
      bar.kind === 'milestone'
        ? format(start)
        : `${format(start)} – ${subDay ? format(end) : formatEndDate(start, end, zone, locale)}`;
    const kind = current.hit.area === 'bar' ? 'move' : 'resize';
    return {
      interaction: { kind, taskId: task.id, rowKey: rowKey(task.id), bar: next, start, end, label },
      snapped,
    };
  };

  const cancel = (): boolean => {
    if (!pending) return false;
    const shown = pending.preview !== null;
    pending = null;
    if (shown) context.show(null);
    return true;
  };

  const pointerMove = (point: TimelinePoint) => {
    if (!pending || !finite(point)) return;
    if (!pending.started) {
      if (Math.hypot(point.x - pending.origin.x, point.y - pending.origin.y) < CLICK_TOLERANCE) return;
      pending.started = true;
    }
    const next = preview(context.view(), pending, point);
    if (!next) return;
    pending.snapped = next.snapped;
    const { interaction } = next;
    if (interaction.start !== pending.preview?.start || interaction.end !== pending.preview.end) {
      pending.preview = interaction;
      context.show(interaction);
    }
  };

  return {
    hitTest,
    pointerMove,
    cancel,

    pointerDown(point) {
      cancel();
      const hit = hitTest(point);
      if (!hit) return false;
      const view = context.view();
      const task = view.project.tasks.byId.get(hit.taskId);
      const bar = barOf(view, hit.taskId);
      const row = view.rowIndex.get(hit.taskId);
      if (!task || !bar || row === undefined) return false;
      pending = {
        hit,
        origin: point,
        task,
        bar,
        axis: view.timeAxis,
        row,
        started: false,
        preview: null,
        snapped: null,
      };
      return true;
    },

    pointerUp(point) {
      const current = pending;
      if (!current) return;
      if (current.started) pointerMove(point);
      const { preview: result, snapped, task, bar, axis } = current;
      cancel();
      if (!current.started || !result || snapped === null) return;
      if (result.kind === 'move') {
        // Compared with where the bar snaps to without moving: an automatic task starting at 08:00 snaps to
        // midnight, which isn't a move.
        if (snapped === axis.snap(bar.start)) return;
        context.commit((tx) => {
          if (task.manuallyScheduled) tx.tasks.update(task.id, { startDate: snapped });
          else tx.tasks.update(task.id, { constraintType: 'startnoearlierthan', constraintDate: snapped });
        });
      } else if (result.end !== axis.snap(bar.end)) {
        context.commit((tx) => {
          tx.tasks.update(task.id, { endDate: result.end });
        });
      }
    },

    keep(next) {
      if (!pending) return true;
      const { hit, task, axis, row } = pending;
      const stillValid =
        next.timeAxis === axis &&
        next.project.tasks.byId.get(hit.taskId) === task &&
        next.rowIndex.get(hit.taskId) === row &&
        (hit.area === 'bar' ? next.drag : next.resize);
      if (!stillValid) pending = null;
      return stillValid;
    },
  };
}
