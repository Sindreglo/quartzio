import { workingMsPerUnit } from '../calendar/duration';
import { getWorkingCalendar } from '../calendar/project';
import { getDependencyIndex, wouldCreateCycle } from '../data/graph';
import type { Transaction } from '../data/transaction';
import { getTreeIndex } from '../data/tree';
import type { DependencyType, Id, ProjectState, Task } from '../data/types';
import type { TimeAxis } from '../timeaxis/timeAxis';
import { QuartzioError } from '../util/errors';
import { addUnits } from '../util/zone';
import { computeBar, type Bar } from './bars';
import { formatDate, formatDateTime, formatEndDate } from './cells';
import { taskDates } from './dates';
import { rowKey, type RowsState } from './rows';
import type { Viewport } from './types';

/** A point on the timeline body: x from the start of the axis, y from the top of the first row. */
export interface TimelinePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * What a press would grab: a bar to move, its end to resize, its progress handle, an empty row of an
 * unscheduled task to draw a bar in, or a link handle at either end of a bar to draw a dependency from.
 */
export type HitArea = 'bar' | 'resize-end' | 'progress' | 'create' | 'link-start' | 'link-end';

/** What's under a point (only what's enabled). */
export interface TimelineHit {
  readonly taskId: Id;
  readonly area: HitArea;
}

/** A change an interaction proposes, for `validateChange`. */
export type ProposedChange =
  | {
      readonly kind: 'move' | 'resize' | 'create';
      readonly task: Task;
      readonly start: number;
      readonly end: number;
    }
  | { readonly kind: 'progress'; readonly task: Task; readonly percentDone: number }
  | { readonly kind: 'link'; readonly from: Task; readonly to: Task; readonly type: DependencyType };

interface InteractionBase {
  /** Whether the drop would be applied: `validateChange` (and, for links, the rules) allow it. */
  readonly valid: boolean;
  /** Why it isn't valid, if there's a reason to show. */
  readonly message: string | null;
  /** Text for a tooltip: the new dates, the percentage, or the link. */
  readonly label: string;
  /**
   * Pixels per frame to scroll by, while the pointer is near or past an edge of the visible timeline. The
   * renderer scrolls and then sends the pointer position again.
   */
  readonly autoScroll: { readonly x: number; readonly y: number };
}

/** A bar being moved, resized, drawn (created) or having its progress dragged: where it would land. */
export interface BarInteraction extends InteractionBase {
  readonly kind: 'move' | 'resize' | 'create' | 'progress';
  readonly taskId: Id;
  /** Key of the task's row, to set the original bar apart. */
  readonly rowKey: string;
  /** The bar at its new place (snapped), in timeline coordinates, in the task's row. */
  readonly bar: Bar;
  readonly start: number;
  readonly end: number;
  /** 0–100; for progress. */
  readonly percent: number;
}

/** A dependency being drawn from a bar's end (or start) to the pointer. */
export interface LinkInteraction extends InteractionBase {
  readonly kind: 'link';
  readonly from: Id;
  /** The bar under the pointer, if any. */
  readonly to: Id | null;
  /** The type the drop would create (from the sides), when over a bar. */
  readonly type: DependencyType | null;
  /** SVG path data of the line, in timeline coordinates. */
  readonly path: string;
  /** Where the line ends (the pointer), e.g. to put a tooltip there. */
  readonly end: TimelinePoint;
}

export type TaskInteraction = BarInteraction | LinkInteraction;

/** Movement (px) below which a press and release is a click, not a drag. */
export const CLICK_TOLERANCE = 3;
/** Hit targets are at least this wide, so short bars can still be grabbed. */
const MIN_HIT_WIDTH = 6;
/** The resize handle at a bar's end; less on short bars, so their middle can still be moved. */
const RESIZE_HANDLE = 6;
/** Link handles sit just outside a bar's ends. */
const LINK_HANDLE = 10;
/** The progress handle: this far either side of the progress edge, low in the bar (fractions of the row). */
const PROGRESS_HANDLE = 5;
const PROGRESS_TOP = 0.6;
const PROGRESS_BOTTOM = 0.9;
/** Half a milestone diamond (matches the default --qz-milestone-size; a changed size doesn't move the target). */
const MILESTONE_RADIUS = 7;
/** Auto-scroll: within this distance of an edge, up to this many px per frame (more past the edge). */
const EDGE = 30;
const MAX_SPEED = 20;
/** Dates must stay within what the data accepts (years 1000–9999). */
const MIN_TIME = Date.UTC(1000, 0, 1);
const MAX_TIME = Date.UTC(10_000, 0, 1) - 1;
const SUB_DAY = new Set(['millisecond', 'second', 'minute', 'hour']);
const NO_SCROLL = { x: 0, y: 0 };

/** What the interaction needs from the view. */
export interface InteractionView {
  readonly project: ProjectState;
  readonly timeAxis: TimeAxis;
  readonly rows: RowsState;
  readonly viewport: Viewport;
  /** Row index of every visible task. */
  readonly rowIndex: ReadonlyMap<Id, number>;
  /** Task ids of the visible rows, by row index. */
  readonly rowIds: readonly Id[];
  readonly locale: string | undefined;
  readonly enabled: {
    readonly drag: boolean;
    readonly resize: boolean;
    readonly create: boolean;
    readonly progress: boolean;
    readonly link: boolean;
  };
  readonly validate: ((change: ProposedChange) => boolean | string) | undefined;
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
  /**
   * After the chart scrolled: the pointer is now over another part of it, so the drag follows (with the fresh
   * viewport). Lets auto-scrolling work without the renderer sending the pointer again.
   */
  follow: () => void;
}

/** A drop to apply, decided by the latest preview. */
type Drop = (tx: Transaction) => void;

interface Pending {
  readonly hit: TimelineHit;
  readonly origin: TimelinePoint;
  readonly task: Task;
  /** The task's bar; `null` when drawing a new one. */
  readonly bar: Bar | null;
  readonly axis: TimeAxis;
  readonly row: number;
  started: boolean;
  preview: TaskInteraction | null;
  drop: Drop | null;
  /** The last pointer position, and the scroll position at that moment (to follow scrolling). */
  last: TimelinePoint | null;
  scroll: { left: number; top: number };
}

const finite = (point: TimelinePoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const inRange = (time: number) => Number.isFinite(time) && time >= MIN_TIME && time <= MAX_TIME;
const round = (value: number) => Math.round(value * 10) / 10;

/** Link type from the sides: out of the predecessor's end or start, into the successor's start or end. */
function linkType(fromSide: 'start' | 'end', toSide: 'start' | 'end'): DependencyType {
  if (fromSide === 'end') return toSide === 'start' ? 'FS' : 'FF';
  return toSide === 'start' ? 'SS' : 'SF';
}

/** Speed towards an edge: 0 far from it, growing inside EDGE px, and more past it. */
function speed(position: number, low: number, high: number): number {
  if (high - low <= 2 * EDGE) return 0; // too small to tell an edge from the middle
  const ease = (distance: number) =>
    Math.min(MAX_SPEED * 2, Math.ceil(((EDGE - distance) / EDGE) * MAX_SPEED));
  if (position > high - EDGE) return ease(high - position);
  if (position < low + EDGE) return -ease(position - low);
  return 0;
}

function barOf(view: Pick<InteractionView, 'project' | 'timeAxis' | 'rows'>, id: Id): Bar | null {
  const rendered = view.rows.items.find((row) => row.id === id);
  if (rendered) return rendered.bar;
  const task = view.project.tasks.byId.get(id);
  if (!task) return null;
  return computeBar(task, taskDates(task), !getTreeIndex(view.project.tasks).isLeaf(id), view.timeAxis);
}

/** The bar extent a point is tested against: milestones are their diamond; short bars get a minimum width. */
const extent = (bar: Bar) => {
  const left = bar.kind === 'milestone' ? bar.x - MILESTONE_RADIUS : bar.x;
  const width = bar.kind === 'milestone' ? 2 * MILESTONE_RADIUS : bar.width;
  const extra = Math.max(0, MIN_HIT_WIDTH - width) / 2;
  return { left, width, from: left - extra, to: left + width + extra };
};

const rowAt = (view: Pick<InteractionView, 'rows' | 'rowIds'>, point: TimelinePoint) => {
  if (!finite(point) || point.y < 0) return null;
  const index = Math.floor(point.y / view.rows.rowHeight);
  const taskId = view.rowIds[index];
  return taskId === undefined ? null : { taskId, index };
};

/** The bar under a point (its whole extent, whatever is enabled), for the task tooltip. */
export function barUnder(
  view: Pick<InteractionView, 'project' | 'timeAxis' | 'rows' | 'rowIds'>,
  point: TimelinePoint,
): { taskId: Id; index: number; bar: Bar } | null {
  const row = rowAt(view, point);
  if (!row) return null;
  const bar = barOf(view, row.taskId);
  if (!bar) return null;
  const { from, to } = extent(bar);
  return point.x >= from && point.x <= to ? { ...row, bar } : null;
}

/**
 * Dragging on the timeline, as a small state machine fed with pointer events in timeline coordinates: moving,
 * resizing, drawing bars, dragging progress and drawing dependencies. Snaps to the preset's time resolution; a
 * drop becomes one transaction (see ADR 0009).
 */
export function createInteraction(context: InteractionContext): Interaction {
  let pending: Pending | null = null;

  const hitTest = (point: TimelinePoint): TimelineHit | null => {
    const view = context.view();
    const { enabled } = view;
    const row = rowAt(view, point);
    if (!row) return null;
    const { taskId } = row;
    const bar = barOf(view, taskId);
    // Drawing gives a task its own dates, so not a parent (it spans its children).
    if (!bar) {
      return enabled.create && getTreeIndex(view.project.tasks).isLeaf(taskId)
        ? { taskId, area: 'create' }
        : null;
    }

    const { left, width, from, to } = extent(bar);
    const inRow = (point.y - row.index * view.rows.rowHeight) / view.rows.rowHeight;
    if (point.x >= from && point.x <= to) {
      const progressX = bar.x + bar.progress * bar.width;
      if (
        enabled.progress &&
        bar.kind === 'task' &&
        Math.abs(point.x - progressX) <= PROGRESS_HANDLE &&
        inRow >= PROGRESS_TOP &&
        inRow <= PROGRESS_BOTTOM
      ) {
        return { taskId, area: 'progress' };
      }
      const handle = Math.min(RESIZE_HANDLE, width / 3);
      if (enabled.resize && bar.kind === 'task' && point.x >= left + width - handle)
        return { taskId, area: 'resize-end' };
      return enabled.drag ? { taskId, area: 'bar' } : null;
    }
    if (enabled.link && point.x >= from - LINK_HANDLE && point.x < from)
      return { taskId, area: 'link-start' };
    if (enabled.link && point.x > to && point.x <= to + LINK_HANDLE) return { taskId, area: 'link-end' };
    return null;
  };

  /** Where a move to `start` lands: the end the drop will give, from the duration in working time. */
  const moved = (
    view: InteractionView,
    task: Task,
    bar: Bar,
    start: number,
  ): { start: number; end: number } => {
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

  /** One step of the time resolution after `time`, snapped: the least a bar may span. */
  const stepAfter = (axis: TimeAxis, time: number, zone: ProjectState['settings']['timeZone']): number => {
    const snapped = axis.snap(time);
    if (snapped > time) return snapped;
    const { unit, increment } = axis.preset.timeResolution;
    return addUnits(snapped, increment, unit, zone);
  };

  /** Where an automatic task drawn over `first`–`last` lands: at working time, lasting the span's working time. */
  const landing = (view: InteractionView, first: number, last: number) => {
    try {
      const calendar = getWorkingCalendar(view.project);
      const ms = calendar.workingTimeBetween(first, last);
      if (ms === 0) return { start: first, end: last, empty: true };
      const start = calendar.nextWorkingTime(first);
      return { start, end: calendar.addWorkingTime(start, ms), empty: false };
    } catch (error) {
      if (!(error instanceof QuartzioError)) throw error;
      return { start: first, end: last, empty: true };
    }
  };

  const dateLabel = (view: InteractionView, start: number, end: number, milestone: boolean): string => {
    const zone = view.project.settings.timeZone;
    const subDay = SUB_DAY.has(view.timeAxis.preset.timeResolution.unit);
    const format = (time: number) =>
      subDay ? formatDateTime(time, zone, view.locale) : formatDate(time, zone, view.locale);
    if (milestone) return format(start);
    return `${format(start)} – ${subDay ? format(end) : formatEndDate(start, end, zone, view.locale)}`;
  };

  const verdict = (
    view: InteractionView,
    change: ProposedChange,
  ): { valid: boolean; message: string | null } => {
    let result: boolean | string;
    try {
      result = view.validate?.(change) ?? true;
    } catch (error) {
      // A validator that throws refuses: pointer handlers (and what renders) must not throw.
      return { valid: false, message: error instanceof Error && error.message !== '' ? error.message : null };
    }
    if (result === true) return { valid: true, message: null };
    return { valid: false, message: typeof result === 'string' && result !== '' ? result : null };
  };

  // Bar gestures stay in their row, so only links (to other rows) scroll vertically.
  const autoScroll = (view: InteractionView, point: TimelinePoint, vertical: boolean) => {
    const { scrollLeft, scrollTop, width, height } = view.viewport;
    if (width <= 0 || height <= 0) return NO_SCROLL;
    // Only as far as there is to scroll: nothing towards an edge already reached.
    const limit = (value: number, position: number, max: number) =>
      (value < 0 && position <= 0) || (value > 0 && position >= max) ? 0 : value;
    const x = limit(
      speed(point.x, scrollLeft, scrollLeft + width),
      scrollLeft,
      view.timeAxis.totalWidth - width,
    );
    const y = vertical
      ? limit(speed(point.y, scrollTop, scrollTop + height), scrollTop, view.rows.totalHeight - height)
      : 0;
    return x === 0 && y === 0 ? NO_SCROLL : { x, y };
  };

  /** Preview and drop for moving, resizing, creating and progress. */
  const barPreview = (
    view: InteractionView,
    current: Pending,
    point: TimelinePoint,
  ): { interaction: BarInteraction; drop: Drop | null } | null => {
    const { timeAxis, project } = view;
    const { task, bar, hit } = current;
    const zone = project.settings.timeZone;
    const dx = point.x - current.origin.x;
    const scroll = autoScroll(view, point, false);
    const base = { taskId: task.id, rowKey: rowKey(task.id), autoScroll: scroll };

    if (hit.area === 'progress' && bar) {
      const percent = Math.round(Math.max(0, Math.min(1, (point.x - bar.x) / bar.width)) * 100);
      const change: ProposedChange = { kind: 'progress', task, percentDone: percent };
      const { valid, message } = verdict(view, change);
      const interaction: BarInteraction = {
        ...base,
        kind: 'progress',
        bar: { ...bar, progress: percent / 100 },
        start: bar.start,
        end: bar.end,
        percent,
        label: `${String(percent)}%`,
        valid,
        message,
      };
      const drop: Drop | null =
        valid && percent !== task.percentDone
          ? (tx) => {
              tx.tasks.update(task.id, { percentDone: percent });
            }
          : null;
      return { interaction, drop };
    }

    // From the dates, not the bar: a bar far outside the axis is clipped to near it.
    let kind: BarInteraction['kind'];
    let start: number;
    let end: number;
    let drop: Drop | null = null;
    if (hit.area === 'create') {
      const a = timeAxis.snap(timeAxis.xToDate(current.origin.x));
      const b = timeAxis.snap(timeAxis.xToDate(point.x));
      if (!inRange(a) || !inRange(b)) return null;
      kind = 'create';
      const first = Math.min(a, b);
      const last = Math.max(Math.max(a, b), stepAfter(timeAxis, first, zone));
      // An automatic task lands at working time, with the working time in the span as its duration.
      const landed = task.manuallyScheduled
        ? { start: first, end: last, empty: false }
        : landing(view, first, last);
      start = landed.start;
      end = landed.end;
      if (landed.empty) {
        const drawn = computeBar(task, { start: first, end: last }, false, timeAxis);
        if (!drawn) return null;
        const interaction: BarInteraction = {
          ...base,
          kind,
          bar: drawn,
          start: first,
          end: last,
          percent: task.percentDone,
          label: dateLabel(view, first, last, false),
          valid: false,
          message: 'No working time in the drawn span',
        };
        return { interaction, drop: null };
      }
      drop = (tx) => {
        if (task.manuallyScheduled) tx.tasks.update(task.id, { startDate: first, endDate: last });
        else {
          // Automatic: held at the drawn start ("start no earlier than"); the duration comes from the drawn span.
          tx.tasks.update(task.id, {
            startDate: first,
            endDate: last,
            constraintType: 'startnoearlierthan',
            constraintDate: first,
          });
        }
      };
    } else if (hit.area === 'bar' && bar) {
      const snapped = timeAxis.snap(timeAxis.xToDate(timeAxis.dateToX(bar.start) + dx));
      if (!inRange(snapped)) return null;
      kind = 'move';
      ({ start, end } = moved(view, task, bar, snapped));
      // Compared with where the bar snaps to without moving: an automatic task starting at 08:00 snaps to
      // midnight, which isn't a move.
      if (snapped !== timeAxis.snap(bar.start)) {
        drop = (tx) => {
          if (task.manuallyScheduled) tx.tasks.update(task.id, { startDate: snapped });
          else tx.tasks.update(task.id, { constraintType: 'startnoearlierthan', constraintDate: snapped });
        };
      }
    } else if (bar) {
      const snapped = timeAxis.snap(timeAxis.xToDate(timeAxis.dateToX(bar.end) + dx));
      if (!inRange(snapped)) return null;
      kind = 'resize';
      start = bar.start;
      end = Math.max(stepAfter(timeAxis, start, zone), snapped);
      if (end !== timeAxis.snap(bar.end)) {
        const newEnd = end;
        drop = (tx) => {
          tx.tasks.update(task.id, { endDate: newEnd });
        };
      }
    } else {
      return null;
    }
    if (!inRange(start) || !inRange(end)) return null;

    const isParent = bar?.kind === 'summary' || !getTreeIndex(project.tasks).isLeaf(task.id);
    const next = computeBar(task, { start, end }, isParent, timeAxis);
    if (!next) return null;
    const { valid, message } = verdict(view, { kind, task, start, end });
    const interaction: BarInteraction = {
      ...base,
      kind,
      bar: next,
      start,
      end,
      percent: task.percentDone,
      label: dateLabel(view, start, end, next.kind === 'milestone'),
      valid,
      message,
    };
    return { interaction, drop: valid ? drop : null };
  };

  /** Preview and drop for drawing a dependency. */
  const linkPreview = (
    view: InteractionView,
    current: Pending,
    point: TimelinePoint,
  ): { interaction: LinkInteraction; drop: Drop | null } | null => {
    const { task, bar, hit, row } = current;
    if (!bar) return null;
    const fromSide = hit.area === 'link-start' ? 'start' : 'end';
    const { from, to } = extent(bar);
    const x1 = fromSide === 'start' ? from : to;
    const y1 = row * view.rows.rowHeight + view.rows.rowHeight / 2;
    const base = {
      kind: 'link' as const,
      from: task.id,
      path: `M${String(round(x1))} ${String(round(y1))} L${String(round(point.x))} ${String(round(point.y))}`,
      end: { x: point.x, y: point.y },
      autoScroll: autoScroll(view, point, true),
    };
    const nothing = { ...base, to: null, type: null, label: '', valid: false, message: null };

    const target = rowAt(view, point);
    const targetBar = target && barOf(view, target.taskId);
    const targetTask = target && view.project.tasks.byId.get(target.taskId);
    if (!target || !targetBar || !targetTask) return { interaction: nothing, drop: null };
    const edges = extent(targetBar);
    if (point.x < edges.from - LINK_HANDLE || point.x > edges.to + LINK_HANDLE)
      return { interaction: nothing, drop: null };
    // Onto the end handle (or the last third of the bar): into its end; otherwise into its start.
    const toSide = point.x > edges.left + (edges.width * 2) / 3 ? 'end' : 'start';
    const type = linkType(fromSide, toSide);
    const label = `${task.name || String(task.id)} → ${targetTask.name || String(targetTask.id)} (${type})`;

    let rule: string | null = null;
    const tree = getTreeIndex(view.project.tasks);
    if (targetTask.id === task.id) rule = 'Can’t link a task to itself';
    else if (
      tree.ancestors(task.id).includes(targetTask.id) ||
      tree.ancestors(targetTask.id).includes(task.id)
    ) {
      rule = 'Can’t link a task to its parent or child';
    } else if (
      getDependencyIndex(view.project.dependencies)
        .outgoing(task.id)
        .some((d) => d.to === targetTask.id)
    ) {
      rule = 'Already linked';
    } else if (wouldCreateCycle(view.project, task.id, targetTask.id)) rule = 'Would create a cycle';
    const checked = rule === null ? verdict(view, { kind: 'link', from: task, to: targetTask, type }) : null;
    const valid = checked?.valid ?? false;
    const interaction: LinkInteraction = {
      ...base,
      to: targetTask.id,
      type,
      label,
      valid,
      message: rule ?? checked?.message ?? null,
    };
    const drop: Drop | null = valid
      ? (tx) => {
          tx.dependencies.add({ from: task.id, to: targetTask.id, type });
        }
      : null;
    return { interaction, drop };
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
    const view = context.view();
    pending.last = point;
    pending.scroll = { left: view.viewport.scrollLeft, top: view.viewport.scrollTop };
    const isLink = pending.hit.area === 'link-start' || pending.hit.area === 'link-end';
    const next = isLink ? linkPreview(view, pending, point) : barPreview(view, pending, point);
    if (!next) return;
    pending.drop = next.drop;
    if (!sameInteraction(pending.preview, next.interaction)) {
      pending.preview = next.interaction;
      context.show(next.interaction);
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
      const row = view.rowIndex.get(hit.taskId);
      if (!task || row === undefined) return false;
      const bar = barOf(view, hit.taskId);
      if (!bar && hit.area !== 'create') return false;
      pending = {
        hit,
        origin: point,
        task,
        bar,
        axis: view.timeAxis,
        row,
        started: false,
        preview: null,
        drop: null,
        last: null,
        scroll: { left: view.viewport.scrollLeft, top: view.viewport.scrollTop },
      };
      return true;
    },

    pointerUp(point) {
      const current = pending;
      if (!current) return;
      try {
        if (current.started) pointerMove(point);
      } finally {
        cancel(); // the drag ends with the release, whatever happens
      }
      if (current.started && current.drop) context.commit(current.drop);
    },

    follow() {
      if (!pending?.started || !pending.last) return;
      const { viewport } = context.view();
      const dx = viewport.scrollLeft - pending.scroll.left;
      const dy = viewport.scrollTop - pending.scroll.top;
      if (dx !== 0 || dy !== 0) pointerMove({ x: pending.last.x + dx, y: pending.last.y + dy });
    },

    keep(next) {
      if (!pending) return true;
      const { hit, task, axis, row } = pending;
      const { enabled } = next;
      const allowed = {
        bar: enabled.drag,
        'resize-end': enabled.resize,
        progress: enabled.progress,
        create: enabled.create,
        'link-start': enabled.link,
        'link-end': enabled.link,
      }[hit.area];
      const stillValid =
        allowed &&
        next.timeAxis === axis &&
        next.project.tasks.byId.get(hit.taskId) === task &&
        next.rowIndex.get(hit.taskId) === row;
      if (!stillValid) pending = null;
      return stillValid;
    },
  };
}

/** Whether a new preview shows the same as the last (so nothing needs rendering). */
function sameInteraction(a: TaskInteraction | null, b: TaskInteraction): boolean {
  if (a?.kind !== b.kind || a.valid !== b.valid || a.message !== b.message) return false;
  if (a.autoScroll.x !== b.autoScroll.x || a.autoScroll.y !== b.autoScroll.y) return false;
  if (a.kind === 'link' && b.kind === 'link') return a.path === b.path && a.to === b.to && a.type === b.type;
  if (a.kind !== 'link' && b.kind !== 'link')
    return a.start === b.start && a.end === b.end && a.percent === b.percent;
  return false;
}
