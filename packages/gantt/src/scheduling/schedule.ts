import { workingMsPerUnit } from '../calendar/duration';
import { getWorkingCalendar } from '../calendar/project';
import type { WorkingCalendar } from '../calendar/workingCalendar';
import { getDependencyIndex, getScheduleGraph } from '../data/graph';
import { getTreeIndex } from '../data/tree';
import type { Dependency, Id, Operation, ProjectState, Task } from '../data/types';
import { QuartzioError } from '../util/errors';

const NO_BOUND = Number.NEGATIVE_INFINITY;

/**
 * Schedules the project and returns the operations that write the results back: for automatically scheduled
 * tasks, dates as soon as possible after the project start and their predecessors' requirements; for parents,
 * the span of their children; start, end and duration kept consistent everywhere. See ADR 0008.
 *
 * `operations` are the ones just applied (to tell a new end from a new duration), or `null` for loaded data.
 * Pure, idempotent (nothing to add to a state it scheduled), and doesn't throw for calendar trouble: a task
 * whose dates can't be computed (e.g. no working time at all) keeps its dates.
 */
export function scheduleProject(state: ProjectState, operations: readonly Operation[] | null): Operation[] {
  const { settings } = state;
  if (settings.startDate !== null) return run(state, operations, settings.startDate).operations;

  // No project start yet: the earliest task start. Without any, only manual tasks can get a start (e.g. from
  // an end and a duration), so schedule once to find the earliest, then again from there. Written back, so it
  // doesn't move when the earliest task does.
  let projectStart: number | null = null;
  for (const t of state.tasks.byId.values()) {
    if (t.startDate !== null && (projectStart === null || t.startDate < projectStart))
      projectStart = t.startDate;
  }
  let result = run(state, operations, projectStart);
  if (projectStart === null && result.earliest !== null) {
    projectStart = result.earliest;
    result = run(state, operations, projectStart);
  }
  return projectStart === null
    ? result.operations
    : [{ type: 'settings', changes: { startDate: projectStart } }, ...result.operations];
}

function run(
  state: ProjectState,
  operations: readonly Operation[] | null,
  projectStart: number | null,
): { operations: Operation[]; earliest: number | null } {
  const result: Operation[] = [];
  const { settings } = state;
  const calendar = getWorkingCalendar(state);
  const graph = getScheduleGraph(state);
  const tree = getTreeIndex(state.tasks);
  const dependencies = getDependencyIndex(state.dependencies);
  const ids = graph.ids;
  const count = ids.length;
  const indexOf = new Map<Id, number>();
  ids.forEach((id, i) => indexOf.set(id, i));

  // Which task fields each operation changed: a new end (without a new duration) keeps the end.
  const changed = new Map<Id, Set<string>>();
  for (const op of operations ?? []) {
    if (op.type === 'update' && op.store === 'tasks') {
      let fields = changed.get(op.id);
      if (!fields) changed.set(op.id, (fields = new Set()));
      for (const key of Object.keys(op.changes)) fields.add(key);
    }
  }

  // Rounded one way only, so a derived duration converts back to exactly the same working time.
  const toMs = (value: number, unit: Task['durationUnit']) =>
    Math.round(value * workingMsPerUnit(unit, settings));
  const fromMs = (ms: number, unit: Task['durationUnit']) => ms / workingMsPerUnit(unit, settings);
  const context: Context = { calendar, toMs, fromMs };
  const shift = (time: number, lag: number, unit: Task['durationUnit']) => {
    const ms = toMs(lag, unit);
    return ms === 0 ? time : calendar.addWorkingTime(time, ms); // negative: subtracts
  };

  // Per task: its requirements (from the `in` node) and its dates (from the `out` node). NaN = unscheduled.
  const boundStart = new Float64Array(count).fill(NO_BOUND);
  const boundEnd = new Float64Array(count).fill(NO_BOUND);
  const starts = new Float64Array(count).fill(Number.NaN);
  const ends = new Float64Array(count).fill(Number.NaN);
  const durations = new Float64Array(count); // working ms, for weighting parents' progress
  const percents = new Float64Array(count);

  const requirements = (i: number, task: Task): void => {
    let start = NO_BOUND;
    let end = NO_BOUND;
    const parent = task.parentId === null ? undefined : indexOf.get(task.parentId);
    if (parent !== undefined) {
      start = boundStart[parent] as number;
      end = boundEnd[parent] as number;
    }
    // A manually scheduled task isn't pushed itself, but passes its parents' requirements on to its children.
    if (!task.manuallyScheduled) {
      for (const dependency of dependencies.incoming(task.id)) {
        const from = indexOf.get(dependency.from);
        if (from === undefined || Number.isNaN(starts[from])) continue;
        let required: number;
        try {
          required = requirement(dependency, starts[from] as number, ends[from] as number, shift);
        } catch (error) {
          if (!(error instanceof QuartzioError)) throw error;
          continue; // e.g. a lag beyond what the calendar will calculate: skip this requirement
        }
        if (dependency.type === 'FS' || dependency.type === 'SS') start = Math.max(start, required);
        else end = Math.max(end, required);
      }
    }
    boundStart[i] = start;
    boundEnd[i] = end;
  };
  let earliest: number | null = null;

  for (const node of graph.order) {
    const i = node >> 1;
    const id = ids[i] as Id;
    const task = state.tasks.byId.get(id) as Task;
    if ((node & 1) === 0) {
      requirements(i, task);
      continue;
    }

    let dates: Computed | null;
    try {
      dates = task.manuallyScheduled
        ? ownDates(task, context, changed.get(id))
        : (rollUp(tree.children(id), indexOf, { starts, ends, durations, percents }, task, context) ??
          asSoonAsPossible(
            task,
            projectStart,
            boundStart[i] as number,
            boundEnd[i] as number,
            context,
            changed.get(id),
          ));
    } catch (error) {
      if (!(error instanceof QuartzioError)) throw error;
      dates = null; // e.g. no working time in the calendar: keep what the task has
    }

    const start = dates?.start ?? task.startDate;
    const end = dates?.end ?? task.endDate;
    if (start !== null && end !== null) {
      if (earliest === null || start < earliest) earliest = start;
      starts[i] = start;
      ends[i] = end;
      durations[i] =
        dates?.workingMs ?? (task.duration === null ? 0 : toMs(task.duration, task.durationUnit));
    }
    percents[i] = dates?.percentDone ?? task.percentDone;
    if (dates) {
      const changes = differences(task, dates);
      if (changes) result.push({ type: 'update', store: 'tasks', id, changes });
    }
  }
  return { operations: result, earliest };
}

interface Context {
  calendar: WorkingCalendar;
  toMs: (value: number, unit: Task['durationUnit']) => number;
  fromMs: (ms: number, unit: Task['durationUnit']) => number;
}

interface Computed {
  start: number;
  end: number;
  /** Only when it has to change (derived); otherwise the task's own duration stands. */
  duration?: number;
  workingMs: number;
  percentDone?: number;
}

function requirement(
  dependency: Dependency,
  start: number,
  end: number,
  shift: (time: number, lag: number, unit: Dependency['lagUnit']) => number,
): number {
  const from = dependency.type === 'FS' || dependency.type === 'FF' ? end : start;
  return shift(from, dependency.lag, dependency.lagUnit);
}

/** The duration to schedule with, in working ms, and whether it's derived (and has to be written). */
function workingDuration(
  task: Task,
  { calendar, toMs }: Context,
  changed: Set<string> | undefined,
): { ms: number; derived: boolean } {
  const { startDate, endDate, duration } = task;
  const newEnd = changed?.has('endDate') === true && !changed.has('duration') && !changed.has('durationUnit');
  // (An end before the start comes from a new start on its own: the duration stands, and the end moves.)
  if (startDate !== null && endDate !== null && endDate >= startDate && (newEnd || duration === null)) {
    const ms = calendar.workingTimeBetween(startDate, endDate);
    // A replayed patch (redo, undo, controlled data coming back) repeats the scheduler's own new ends: when the
    // duration already amounts to that, it stands instead of being derived again (which could drift).
    if (duration !== null && toMs(duration, task.durationUnit) === ms) return { ms, derived: false };
    return { ms, derived: true };
  }
  if (duration !== null) return { ms: toMs(duration, task.durationUnit), derived: false };
  return { ms: 0, derived: true };
}

/** No dates and no duration: left out of scheduling (no bar), like Bryntum's unscheduled tasks. */
const isUnscheduled = (task: Task) =>
  task.startDate === null && task.endDate === null && task.duration === null;

function asSoonAsPossible(
  task: Task,
  projectStart: number | null,
  startBound: number,
  endBound: number,
  context: Context,
  changed: Set<string> | undefined,
): Computed | null {
  if (isUnscheduled(task)) return null;
  const { calendar } = context;
  const { ms, derived } = workingDuration(task, context, changed);
  let earliest = Math.max(projectStart ?? NO_BOUND, startBound);
  if (endBound !== NO_BOUND) earliest = Math.max(earliest, calendar.addWorkingTime(endBound, -ms));
  if (earliest === NO_BOUND) return null; // no project start and no requirements: unscheduled
  // Zero-length tasks (milestones) stay where they are required; others start at working time.
  const start = ms > 0 ? calendar.nextWorkingTime(earliest) : earliest;
  return computed(task, start, calendar.addWorkingTime(start, ms), ms, derived, context);
}

function ownDates(task: Task, context: Context, changed: Set<string> | undefined): Computed | null {
  const { calendar } = context;
  const { ms, derived } = workingDuration(task, context, changed);
  if (task.startDate !== null) {
    return computed(task, task.startDate, calendar.addWorkingTime(task.startDate, ms), ms, derived, context);
  }
  if (task.endDate !== null) {
    return computed(task, calendar.addWorkingTime(task.endDate, -ms), task.endDate, ms, derived, context);
  }
  return null;
}

/** A parent spans its scheduled children; `null` when none are scheduled (it's then scheduled like a task). */
function rollUp(
  children: readonly Id[],
  indexOf: ReadonlyMap<Id, number>,
  { starts, ends, durations, percents }: Record<'starts' | 'ends' | 'durations' | 'percents', Float64Array>,
  task: Task,
  { calendar, fromMs }: Context,
): Computed | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  let weight = 0;
  let weighted = 0;
  let sum = 0;
  for (const child of children) {
    const c = indexOf.get(child) as number;
    sum += percents[c] as number;
    if (Number.isNaN(starts[c])) continue;
    start = Math.min(start, starts[c] as number);
    end = Math.max(end, ends[c] as number);
    weight += durations[c] as number;
    weighted += (durations[c] as number) * (percents[c] as number);
  }
  if (start === Number.POSITIVE_INFINITY) return null;
  const ms = calendar.workingTimeBetween(start, end);
  return {
    start,
    end,
    duration: fromMs(ms, task.durationUnit),
    workingMs: ms,
    percentDone: weight > 0 ? weighted / weight : sum / children.length,
  };
}

function computed(
  task: Task,
  start: number,
  computedEnd: number,
  ms: number,
  derived: boolean,
  context: Context,
): Computed {
  // Keep the task's own end when it amounts to the same working time (e.g. midnight instead of 16:00 the day
  // before): the dates as given stay, and scheduling again changes nothing.
  const own = task.endDate;
  const keepOwn =
    own !== null &&
    own !== computedEnd &&
    task.startDate === start &&
    own >= start &&
    context.calendar.workingTimeBetween(start, own) === ms;
  const end = keepOwn ? own : computedEnd;
  return derived
    ? { start, end, workingMs: ms, duration: context.fromMs(ms, task.durationUnit) }
    : { start, end, workingMs: ms };
}

/** The fields that differ from the task, or `null`. */
function differences(task: Task, dates: Computed): Partial<Task> | null {
  const changes: { -readonly [K in keyof Task]?: Task[K] } = {};
  if (task.startDate !== dates.start) changes.startDate = dates.start;
  if (task.endDate !== dates.end) changes.endDate = dates.end;
  if (dates.duration !== undefined && task.duration !== dates.duration) changes.duration = dates.duration;
  if (dates.percentDone !== undefined && task.percentDone !== dates.percentDone) {
    changes.percentDone = dates.percentDone;
  }
  return Object.keys(changes).length > 0 ? changes : null;
}
