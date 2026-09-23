import { toTime } from '../data/normalize';
import { createProject, type Project } from '../data/project';
import { toProjectData } from '../data/serialize';
import type { Transaction } from '../data/transaction';
import type { DateInput, Operation, Patch, ProjectData, ProjectInput, ProjectState } from '../data/types';
import { resolvePreset, type ViewPreset } from '../timeaxis/presets';
import { createTimeAxis, type HeaderCell, type TimeAxis } from '../timeaxis/timeAxis';
import { assertLocale } from '../timeaxis/format';
import { createEmitter } from '../util/emitter';
import { isEqual } from '../util/equal';
import { QuartzioError } from '../util/errors';
import { defaultTimelineRange } from './range';

export interface Viewport {
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface HeaderState {
  /**
   * Cells per header row (top to bottom), only around the visible part of the timeline. The arrays keep
   * their identity while scrolling within the rendered window, so rows can be memoized.
   */
  readonly rows: readonly (readonly HeaderCell[])[];
}

/** Everything a renderer needs to draw the chart. Plain data — no DOM, no framework types. */
export interface ViewState {
  viewport: Viewport;
  project: ProjectState;
  timeAxis: TimeAxis;
  header: HeaderState;
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
  /** A built-in preset id (`'hourAndDay'` … `'manyYears'`, default `'weekAndDay'`) or a custom preset. */
  preset?: string | ViewPreset | undefined;
  /**
   * The timeline range. Defaults to the tasks' dates with a little padding. Strings without an offset are
   * read in the project's time zone. The timeline is always at least as wide as the viewport.
   */
  startDate?: DateInput | undefined;
  endDate?: DateInput | undefined;
  /** Locale for header labels, e.g. `'nb-NO'`. Defaults to the runtime's locale. */
  locale?: string | undefined;
}

// Property signatures (not methods) so the functions can be passed around unbound,
// e.g. `useSyncExternalStore(gantt.subscribe, gantt.getState)`.
export interface GanttController {
  /** Returns the same object until the state changes, so it can back `useSyncExternalStore`. */
  getState: () => ViewState;
  subscribe: (listener: (state: ViewState) => void) => () => void;
  /**
   * Updates options after creation. `data` is only honoured in controlled mode; controlled vs. uncontrolled
   * is decided once, at creation.
   */
  setOptions: (options: GanttOptions) => void;
  setViewport: (viewport: Partial<Viewport>) => void;
  /**
   * Changes project data. Uncontrolled: applied immediately. Controlled: only reported through
   * `onChange`; edits in the same synchronous run build on each other, later edits build on the last
   * `data` passed in. Returns the patch, or `null` if nothing changed.
   */
  transact: (fn: (tx: Transaction) => void) => Patch | null;
  destroy: () => void;
}

const INITIAL_VIEWPORT: Viewport = { width: 0, height: 0, scrollLeft: 0, scrollTop: 0 };
/** Assumed viewport width before it has been measured (and when rendering on the server). */
const UNMEASURED_WIDTH = 1200;

interface TimelineOptions {
  preset: ViewPreset;
  startDate: DateInput | undefined;
  endDate: DateInput | undefined;
  locale: string | undefined;
}

const TIMELINE_KEYS = ['preset', 'startDate', 'endDate', 'locale'] as const;

const pickTimeline = (options: GanttOptions): Partial<GanttOptions> =>
  Object.fromEntries(TIMELINE_KEYS.filter((key) => key in options).map((key) => [key, options[key]]));

/** Validates the timeline options; throws QuartzioError before anything is changed. */
function resolveTimeline(options: GanttOptions | TimelineOptions): TimelineOptions {
  const preset = resolvePreset(options.preset);
  if (options.locale !== undefined) assertLocale(options.locale);
  // `null` from plain JavaScript means "not set", like `undefined`.
  const startDate = options.startDate ?? undefined;
  const endDate = options.endDate ?? undefined;
  // The format doesn't depend on the zone, so check it now; the real value is read in the project's zone.
  const start = toTime(startDate, 'startDate', 'Gantt options', 'UTC');
  const end = toTime(endDate, 'endDate', 'Gantt options', 'UTC');
  if (start !== null && end !== null && end <= start) {
    throw new QuartzioError('Gantt options: "endDate" must be after "startDate".');
  }
  return { preset, startDate, endDate, locale: options.locale };
}

const dateValue = (value: DateInput | undefined): unknown =>
  value instanceof Date ? value.getTime() : value;

/** Equal by value, so re-rendering with a new but equal Date (or an equal custom preset) is no change. */
const sameTimeline = (a: TimelineOptions, b: TimelineOptions): boolean =>
  (a.preset === b.preset || isEqual(a.preset, b.preset)) &&
  Object.is(dateValue(a.startDate), dateValue(b.startDate)) &&
  Object.is(dateValue(a.endDate), dateValue(b.endDate)) &&
  a.locale === b.locale;

/** Parses an already validated date option, falling back when it isn't set. Never throws. */
function parseOr(value: DateInput | undefined, zone: string, fallback: number): number {
  try {
    return toTime(value, 'date', 'Gantt options', zone) ?? fallback;
  } catch {
    return fallback;
  }
}

export function createGantt(options: GanttOptions = {}): GanttController {
  const controlled = 'data' in options;
  const project: Project = createProject((controlled ? options.data : options.defaultData) ?? {});
  const changes = createEmitter<ViewState>();
  let onChange = options.onChange;
  let currentData = options.data;
  // Controlled mode: the last change reported through onChange, relative to the committed state.
  // If exactly its data comes back, the operations are replayed instead of re-normalizing everything.
  let pending: { state: ProjectState; data: ProjectData; operations: Operation[] } | undefined;
  // Edits in the same synchronous run (e.g. two transact() calls in one event handler) build on each
  // other. Later edits build on the last data passed in, so a change the app rejected (by not passing
  // it back) is dropped instead of sneaking into the next one — like a controlled <input>.
  let chaining = false;
  let timeline: TimelineOptions = resolveTimeline(options);
  let destroyed = false;
  // True while setOptions applies several changes, so they produce one state update instead of several.
  let batching = false;

  // --- Derived view state. Each piece is reused while its inputs are unchanged, and deriving never
  // throws: options are validated up front, and oversized ranges are cut short instead of failing. ---

  let rangeCache: { key: unknown[]; range: { start: number; end: number } } | undefined;
  const timelineRange = (projectState: ProjectState): { start: number; end: number } => {
    const key = [projectState.tasks, projectState.settings, timeline];
    if (!rangeCache || key.some((part, i) => part !== rangeCache?.key[i])) {
      const zone = projectState.settings.timeZone;
      const fallback = defaultTimelineRange(projectState, timeline.preset, Date.now());
      const start = parseOr(timeline.startDate, zone, fallback.start);
      const end = parseOr(timeline.endDate, zone, fallback.end);
      rangeCache = { key, range: { start, end: Math.max(start, end) } };
    }
    return rangeCache.range;
  };

  let axisCache: { key: unknown[]; axis: TimeAxis } | undefined;
  const timeAxisFor = (projectState: ProjectState, viewportWidth: number): TimeAxis => {
    const { start, end } = timelineRange(projectState);
    const { timeZone, weekStartsOn } = projectState.settings;
    const { preset, locale } = timeline;
    const minWidth = viewportWidth > 0 ? viewportWidth : UNMEASURED_WIDTH;
    // Keyed on the tick count needed to fill the viewport, so resizing by a few pixels reuses the axis.
    const key = [start, end, preset, locale, timeZone, weekStartsOn, Math.ceil(minWidth / preset.tickWidth)];
    if (axisCache && key.every((part, i) => part === axisCache?.key[i])) return axisCache.axis;

    const axis = createTimeAxis({
      start,
      end,
      preset,
      timeZone,
      weekStartsOn,
      locale,
      minWidth,
      truncate: true,
    });
    // Different inputs can still produce the same axis (e.g. the last task moved by an hour). Keeping the
    // old object lets everything memoized on it stay valid.
    const previous = axisCache?.axis;
    const same =
      previous?.start === axis.start &&
      previous.end === axis.end &&
      previous.tickCount === axis.tickCount &&
      previous.preset === axis.preset &&
      previous.locale === axis.locale &&
      previous.timeZone === axis.timeZone &&
      previous.weekStartsOn === axis.weekStartsOn;
    axisCache = { key, axis: same ? previous : axis };
    return axisCache.axis;
  };

  let headerCache: { axis: TimeAxis; from: number; to: number; header: HeaderState } | undefined;
  const headerFor = (axis: TimeAxis, viewport: Viewport): HeaderState => {
    const width = viewport.width > 0 ? viewport.width : UNMEASURED_WIDTH;
    const visibleFrom = viewport.scrollLeft;
    const visibleTo = viewport.scrollLeft + width;
    if (headerCache?.axis === axis && headerCache.from <= visibleFrom && visibleTo <= headerCache.to) {
      return headerCache.header;
    }
    // Render one extra viewport on each side, so most scrolling reuses the same cells.
    const from = Math.max(0, visibleFrom - width);
    const to = Math.min(axis.totalWidth, visibleTo + width);
    const header = { rows: axis.preset.headers.map((_, row) => axis.headerCells(row, from, to)) };
    // At the timeline's edges the window can't grow, so treat it as open-ended there.
    headerCache = {
      axis,
      from: from === 0 ? Number.NEGATIVE_INFINITY : from,
      to: to === axis.totalWidth ? Number.POSITIVE_INFINITY : to,
      header,
    };
    return header;
  };

  const derive = (viewport: Viewport, projectState: ProjectState): ViewState => {
    const timeAxis = timeAxisFor(projectState, viewport.width);
    return { viewport, project: projectState, timeAxis, header: headerFor(timeAxis, viewport) };
  };

  let state: ViewState = derive(INITIAL_VIEWPORT, project.getState());

  const setState = (next: ViewState): void => {
    state = next;
    changes.emit(state);
  };

  const unsubscribeProject = project.subscribe(({ state: projectState }) => {
    if (!batching) setState(derive(state.viewport, projectState));
  });

  const setData = (data: ProjectInput | undefined): void => {
    if (data === currentData) return;
    if (pending !== undefined && pending.data === data) project.apply(pending.operations);
    else project.load(data ?? {});
    // Only after loading succeeded, so passing the same (fixed) data again is not skipped.
    currentData = data;
    pending = undefined;
  };

  return {
    getState: () => state,
    subscribe: (listener) => changes.subscribe(listener),

    setOptions(next) {
      if (destroyed) return;
      // Validate everything first, so an invalid option changes nothing.
      const hasTimelineKey = TIMELINE_KEYS.some((key) => key in next);
      const nextTimeline = hasTimelineKey
        ? resolveTimeline({ ...timeline, ...pickTimeline(next) })
        : timeline;
      const timelineChanged = !sameTimeline(nextTimeline, timeline);
      const before = project.getState();

      const previousTimeline = timeline;
      timeline = nextTimeline;
      batching = true;
      try {
        if (controlled && 'data' in next) setData(next.data);
      } catch (error) {
        timeline = previousTimeline;
        throw error;
      } finally {
        batching = false;
      }
      if ('onChange' in next) onChange = next.onChange;
      if (timelineChanged || project.getState() !== before)
        setState(derive(state.viewport, project.getState()));
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
      if (controlled) {
        const previous = chaining ? pending : undefined;
        const planned = project.plan(fn, previous?.state);
        if (!planned) return null;
        pending = {
          state: planned.state,
          data: toProjectData(planned.state),
          operations: [...(previous?.operations ?? []), ...planned.patch.operations],
        };
        if (!chaining) {
          chaining = true;
          void Promise.resolve().then(() => {
            chaining = false;
          });
        }
        onChange?.({ patch: planned.patch, data: pending.data });
        return planned.patch;
      }
      const patch = project.transact(fn);
      if (patch) onChange?.({ patch, data: project.toData() });
      return patch;
    },

    destroy() {
      destroyed = true;
      unsubscribeProject();
      changes.clear();
    },
  };
}
