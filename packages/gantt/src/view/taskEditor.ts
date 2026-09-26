import { workingMsPerUnit } from '../calendar/duration';
import type { PlannedChange } from '../data/project';
import type { Transaction } from '../data/transaction';
import type { TreeIndex } from '../data/tree';
import type { DependencyType, Id, ProjectState, Task } from '../data/types';
import type { TimeUnit } from '../util/time';
import { QuartzioError } from '../util/errors';
import { fromWallTime } from '../util/zone';
import { taskDates } from './dates';
import {
  durationText,
  editKind,
  initialText,
  inputValue,
  MAX_WORKING_DAYS,
  parseDuration,
  parseEdit,
  parseInputDate,
  type EditKind,
} from './editing';

export type TaskEditorTab = 'general' | 'predecessors' | 'successors' | 'advanced';
export type TaskEditorField =
  'name' | 'startDate' | 'endDate' | 'duration' | 'percentDone' | 'constraintDate';
export type TaskEditorSide = 'predecessors' | 'successors';
export type TaskEditorConstraint = 'none' | 'startnoearlierthan';

export interface TaskEditorFieldState {
  readonly text: string;
  readonly kind: EditKind;
  readonly error: string | null;
  /** Can't be edited (e.g. a parent's dates, which roll up). */
  readonly disabled: boolean;
}

/** A predecessor or successor in the editor. */
export interface TaskEditorDependency {
  /** Stable key for rendering and actions. */
  readonly key: string;
  /** The dependency it edits, or `null` for a new one. */
  readonly dependencyId: Id | null;
  /** The other task, or `null` until one is chosen. */
  readonly taskId: Id | null;
  readonly type: DependencyType;
  /** Lag as text, e.g. `2d` or `-1d`. */
  readonly lag: string;
  readonly error: string | null;
}

/** The open task editor (see ADR 0012). */
export interface TaskEditorState {
  readonly taskId: Id;
  /** The task as it is now. */
  readonly task: Task;
  readonly tab: TaskEditorTab;
  readonly fields: Readonly<Record<TaskEditorField, TaskEditorFieldState>>;
  readonly manuallyScheduled: boolean;
  readonly constraintType: TaskEditorConstraint;
  readonly predecessors: readonly TaskEditorDependency[];
  readonly successors: readonly TaskEditorDependency[];
  /** Tasks a dependency can link to, in tree order. */
  readonly candidates: readonly { readonly id: Id; readonly name: string; readonly depth: number }[];
  /** Why saving failed as a whole (e.g. a dependency cycle). */
  readonly error: string | null;
}

export type TaskEditorAction =
  | { readonly type: 'input'; readonly field: TaskEditorField; readonly value: string }
  | { readonly type: 'input'; readonly field: 'manuallyScheduled'; readonly value: boolean }
  | { readonly type: 'input'; readonly field: 'constraintType'; readonly value: TaskEditorConstraint }
  | { readonly type: 'tab'; readonly tab: TaskEditorTab }
  | { readonly type: 'addDependency'; readonly side: TaskEditorSide }
  | {
      readonly type: 'updateDependency';
      readonly side: TaskEditorSide;
      readonly key: string;
      readonly changes: {
        readonly taskId?: Id | null | undefined;
        readonly type?: DependencyType | undefined;
        readonly lag?: string | undefined;
      };
    }
  | { readonly type: 'removeDependency'; readonly side: TaskEditorSide; readonly key: string }
  | { readonly type: 'save' }
  | { readonly type: 'close' };

export interface TaskEditorView {
  readonly project: ProjectState;
  readonly tree: TreeIndex;
  readonly dateField: 'date' | 'datetime';
}

export interface TaskEditorContext {
  readonly view: () => TaskEditorView;
  readonly enabled: () => boolean;
  readonly plan: (fn: (tx: Transaction) => void) => PlannedChange | null;
  readonly commit: (fn: (tx: Transaction) => void) => void;
  readonly show: () => void;
}

export interface TaskEditor {
  readonly current: (view: TaskEditorView) => TaskEditorState | null;
  readonly open: (id: Id) => boolean;
  readonly act: (action: TaskEditorAction) => boolean;
}

interface DraftDependency {
  readonly key: string;
  readonly dependencyId: Id | null;
  readonly taskId: Id | null;
  readonly type: DependencyType;
  readonly lag: string;
  /** As loaded, to tell whether it changed. */
  readonly initial: {
    readonly taskId: Id | null;
    readonly type: DependencyType;
    readonly lag: string;
    /** The exact lag, kept while its text isn't changed (the text is rounded). */
    readonly value: number;
    readonly unit: TimeUnit;
  } | null;
  readonly error: string | null;
}

interface Draft {
  readonly taskId: Id;
  readonly tab: TaskEditorTab;
  readonly texts: Readonly<Record<TaskEditorField, string>>;
  /** The values' texts: a field whose text is still this wasn't typed in (and follows the value). */
  readonly initial: Readonly<Record<TaskEditorField, string>>;
  readonly errors: Readonly<Partial<Record<TaskEditorField, string>>>;
  readonly manual: boolean;
  readonly constraint: TaskEditorConstraint;
  readonly predecessors: readonly DraftDependency[];
  readonly successors: readonly DraftDependency[];
  readonly removed: readonly Id[];
  readonly error: string | null;
}

const FIELDS: readonly TaskEditorField[] = [
  'name',
  'startDate',
  'endDate',
  'duration',
  'percentDone',
  'constraintDate',
];
const TABS = new Set<TaskEditorTab>(['general', 'predecessors', 'successors', 'advanced']);
const TYPES = new Set<DependencyType>(['FS', 'SS', 'FF', 'SF']);
// The fields a save reads first; the end comes last, read against where the rest puts the task.
const SAVE_ORDER = ['name', 'percentDone', 'startDate', 'duration'] as const;

/** The value of each field as text. */
function texts(task: Task, view: TaskEditorView): Record<TaskEditorField, string> {
  const zone = view.project.settings.timeZone;
  const dates = taskDates(task);
  const text = (field: Exclude<TaskEditorField, 'constraintDate'>) =>
    initialText(field, field === 'name' ? 'text' : kindOf(field, view), task, dates, zone);
  return {
    name: text('name'),
    startDate: text('startDate'),
    endDate: text('endDate'),
    duration: text('duration'),
    percentDone: text('percentDone'),
    constraintDate: task.constraintDate === null ? '' : inputValue(task.constraintDate, view.dateField, zone),
  };
}

function kindOf(field: TaskEditorField, view: TaskEditorView): EditKind {
  if (field === 'name') return 'text';
  if (field === 'duration') return 'duration';
  if (field === 'percentDone') return 'percent';
  return view.dateField;
}

/** A lag like `2d` or `-1.5h`, in working time. */
function parseLag(text: string, view: TaskEditorView): { value: number; unit: TimeUnit } | string {
  const match = /^\s*([+-]?)\s*(.*)$/.exec(text) as RegExpExecArray;
  const parsed = parseDuration(match[2] as string, 'day');
  if (typeof parsed === 'string') return 'Enter a lag, like 2d or -1d.';
  const settings = view.project.settings;
  const days = (parsed.value * workingMsPerUnit(parsed.unit, settings)) / workingMsPerUnit('day', settings);
  if (days > MAX_WORKING_DAYS) return `Enter a lag of at most ${String(MAX_WORKING_DAYS)} working days.`;
  return { value: match[1] === '-' ? -parsed.value : parsed.value, unit: parsed.unit };
}

/** Editing a task in a dialog: a draft, saved as one change (see ADR 0012). */
export function createTaskEditor(context: TaskEditorContext): TaskEditor {
  let draft: Draft | null = null;
  let nextKey = 0;
  let shown: { draft: Draft; task: Task; project: ProjectState; state: TaskEditorState } | null = null;
  let candidatesCache: { tasks: unknown; taskId: Id; list: TaskEditorState['candidates'] } | null = null;

  const candidatesFor = (view: TaskEditorView, id: Id): TaskEditorState['candidates'] => {
    if (candidatesCache?.tasks === view.project.tasks && candidatesCache.taskId === id)
      return candidatesCache.list;
    // Not itself, its ancestors or its descendants: links between a parent and its children are refused.
    const excluded = new Set<Id>([id, ...view.tree.ancestors(id), ...view.tree.descendants(id)]);
    const list = view.tree
      .flatten()
      .filter((each) => !excluded.has(each))
      .map((each) => ({
        id: each,
        name: view.project.tasks.byId.get(each)?.name ?? '',
        depth: view.tree.depth(each),
      }));
    candidatesCache = { tasks: view.project.tasks, taskId: id, list };
    return list;
  };

  const dependencyRows = (view: TaskEditorView, id: Id, side: TaskEditorSide): DraftDependency[] => {
    const rows: DraftDependency[] = [];
    for (const dependency of view.project.dependencies.byId.values()) {
      const mine = side === 'predecessors' ? dependency.to === id : dependency.from === id;
      if (!mine) continue;
      const taskId = side === 'predecessors' ? dependency.from : dependency.to;
      const lag = durationText(dependency.lag, dependency.lagUnit);
      rows.push({
        key: `d${String(nextKey++)}`,
        dependencyId: dependency.id,
        taskId,
        type: dependency.type,
        lag,
        initial: { taskId, type: dependency.type, lag, value: dependency.lag, unit: dependency.lagUnit },
        error: null,
      });
    }
    return rows;
  };

  const current = (view: TaskEditorView): TaskEditorState | null => {
    const task = draft && context.enabled() ? view.project.tasks.byId.get(draft.taskId) : undefined;
    if (!draft || !task) {
      draft = null;
      shown = null;
      return null;
    }
    // Fields nobody typed in follow the value (changed elsewhere, or an earlier save the app accepted).
    const now = texts(task, view);
    const { texts: typed, initial: loaded } = draft;
    const followed = FIELDS.filter((field) => typed[field] === loaded[field] && now[field] !== loaded[field]);
    if (followed.length > 0) {
      const next = { ...draft.texts };
      const initial = { ...draft.initial };
      for (const field of followed) next[field] = initial[field] = now[field];
      draft = { ...draft, texts: next, initial };
    }
    if (shown?.draft === draft && shown.task === task && shown.project === view.project) return shown.state;

    const isParent = !view.tree.isLeaf(task.id);
    const dates = taskDates(task);
    const field = (name: TaskEditorField): TaskEditorFieldState => {
      let disabled = false;
      if (name === 'constraintDate') disabled = draft?.constraint === 'none';
      else if (name !== 'name') {
        const builtIn = name === 'percentDone' ? 'percentDone' : name;
        disabled = editKind(builtIn, task, isParent, dates, view.dateField) === null;
      }
      return {
        text: draft?.texts[name] ?? '',
        kind: kindOf(name, view),
        error: draft?.errors[name] ?? null,
        disabled,
      };
    };
    const row = ({ key, dependencyId, taskId, type, lag, error }: DraftDependency): TaskEditorDependency => ({
      key,
      dependencyId,
      taskId,
      type,
      lag,
      error,
    });
    const state: TaskEditorState = {
      taskId: task.id,
      task,
      tab: draft.tab,
      fields: {
        name: field('name'),
        startDate: field('startDate'),
        endDate: field('endDate'),
        duration: field('duration'),
        percentDone: field('percentDone'),
        constraintDate: field('constraintDate'),
      },
      manuallyScheduled: draft.manual,
      constraintType: draft.constraint,
      predecessors: draft.predecessors.map(row),
      successors: draft.successors.map(row),
      candidates: candidatesFor(view, task.id),
      error: draft.error,
    };
    shown = { draft, task, project: view.project, state };
    return state;
  };

  const open = (id: Id): boolean => {
    draft = null;
    const view = context.view();
    const task = context.enabled() ? view.project.tasks.byId.get(id) : undefined;
    if (!task) {
      context.show();
      return false;
    }
    const initial = texts(task, view);
    draft = {
      taskId: id,
      tab: 'general',
      texts: initial,
      initial,
      errors: {},
      manual: task.manuallyScheduled,
      constraint: task.constraintType === 'startnoearlierthan' ? 'startnoearlierthan' : 'none',
      predecessors: dependencyRows(view, id, 'predecessors'),
      successors: dependencyRows(view, id, 'successors'),
      removed: [],
      error: null,
    };
    context.show();
    return true;
  };

  const set = (next: Draft): true => {
    draft = next;
    context.show();
    return true;
  };

  const save = (): boolean => {
    if (!draft) return false;
    const view = context.view();
    const task = view.project.tasks.byId.get(draft.taskId);
    const state = task ? current(view) : null;
    if (!task || !state) return false;
    const settings = view.project.settings;
    const zone = settings.timeZone;
    const errors: Partial<Record<TaskEditorField, string>> = {};
    const changes: ((tx: Transaction) => void)[] = [];
    const id = task.id;

    if (draft.manual !== task.manuallyScheduled) {
      const manual = draft.manual;
      changes.push((tx) => {
        tx.tasks.update(id, { manuallyScheduled: manual });
      });
    }
    // Read against the task as it will be scheduled (a start on a task switched to manual is its start date).
    const asScheduled = { ...task, manuallyScheduled: draft.manual };
    const dates = taskDates(task);
    const typed = (name: TaskEditorField) =>
      !state.fields[name].disabled && (draft as Draft).texts[name] !== (draft as Draft).initial[name];
    // Each decides the end: which one to keep would be a guess.
    if (typed('duration') && typed('endDate')) errors.endDate = 'Change the duration or the end, not both.';
    for (const name of SAVE_ORDER) {
      if (!typed(name)) continue;
      const parsed = parseEdit(
        name,
        state.fields[name].kind,
        draft.texts[name],
        asScheduled,
        dates,
        settings,
      );
      if ('error' in parsed) errors[name] = parsed.error;
      else changes.push(parsed.change);
    }

    const constraintChanged =
      draft.constraint !== (task.constraintType === 'startnoearlierthan' ? 'startnoearlierthan' : 'none');
    if (constraintChanged || draft.texts.constraintDate !== draft.initial.constraintDate) {
      if (typed('startDate') && !draft.manual) {
        // An automatic task's start is its constraint: both changed contradict each other.
        errors.constraintDate = 'Change the start or the constraint, not both.';
      } else if (draft.constraint === 'none') {
        changes.push((tx) => {
          tx.tasks.update(id, { constraintType: null, constraintDate: null });
        });
      } else {
        const wall = parseInputDate(draft.texts.constraintDate, view.dateField);
        if (typeof wall === 'string') errors.constraintDate = wall;
        else {
          const date = fromWallTime(wall, zone);
          changes.push((tx) => {
            tx.tasks.update(id, { constraintType: 'startnoearlierthan', constraintDate: date });
          });
        }
      }
    }

    let failed = Object.keys(errors).length > 0;
    const checkSide = (side: TaskEditorSide): DraftDependency[] => {
      const seen = new Set<Id>();
      return (draft as Draft)[side].map((row) => {
        let error: string | null = null;
        const initial = row.initial;
        const lag =
          row.lag === initial?.lag ? { value: initial.value, unit: initial.unit } : parseLag(row.lag, view);
        if (row.taskId === null || !view.project.tasks.byId.has(row.taskId)) error = 'Choose a task.';
        else if (seen.has(row.taskId)) error = 'This task is linked twice.';
        else if (typeof lag === 'string') error = lag;
        if (row.taskId !== null) seen.add(row.taskId);
        if (error) failed = true;
        else if (
          row.initial?.taskId !== row.taskId ||
          row.initial.type !== row.type ||
          row.initial.lag !== row.lag
        ) {
          const other = row.taskId as Id;
          const { value, unit } = lag as { value: number; unit: TimeUnit };
          const ends = side === 'predecessors' ? { from: other, to: id } : { from: id, to: other };
          const fields = { ...ends, type: row.type, lag: value, lagUnit: unit };
          const dependencyId = row.dependencyId;
          changes.push((tx) => {
            if (dependencyId === null) tx.dependencies.add(fields);
            else tx.dependencies.update(dependencyId, fields);
          });
        }
        return row.error === error ? row : { ...row, error };
      });
    };
    const predecessors = checkSide('predecessors');
    const successors = checkSide('successors');
    for (const dependencyId of draft.removed) {
      changes.unshift((tx) => {
        if (tx.dependencies.get(dependencyId)) tx.dependencies.remove(dependencyId);
      });
    }
    if (failed) return !set({ ...draft, errors, predecessors, successors, error: null });
    const refuse = (message: { field: TaskEditorField; text: string } | string) =>
      !set({
        ...(draft as Draft),
        errors: typeof message === 'string' ? errors : { ...errors, [message.field]: message.text },
        predecessors,
        successors,
        error: typeof message === 'string' ? message : null,
      });

    const fn = (tx: Transaction) => {
      for (const change of changes) change(tx);
    };
    try {
      if (typed('endDate')) {
        // The end is read against where the other changes put the task (a new start moves it).
        const moved = changes.length > 0 ? context.plan(fn)?.state.tasks.byId.get(id) : undefined;
        const base = { ...(moved ?? task), manuallyScheduled: draft.manual };
        const kind = state.fields.endDate.kind;
        const end = parseEdit('endDate', kind, draft.texts.endDate, base, taskDates(base), settings);
        if ('error' in end) return refuse({ field: 'endDate', text: end.error });
        // The duration comes from the start to the end: the new start (an automatic task's is only its constraint
        // until it's scheduled).
        const start = taskDates(base)?.start;
        if (moved && start !== undefined) {
          changes.push((tx) => {
            tx.tasks.update(id, { startDate: start });
          });
        }
        changes.push(end.change);
      }
      if (changes.length > 0 && context.plan(fn)) context.commit(fn);
    } catch (error) {
      if (!(error instanceof QuartzioError)) throw error;
      return refuse(error.message);
    }
    draft = null;
    context.show();
    return true;
  };

  const updateSide = (
    side: TaskEditorSide,
    update: (rows: readonly DraftDependency[]) => DraftDependency[] | null,
  ) => {
    if (!draft) return false;
    const rows = update(draft[side]);
    return rows ? set({ ...draft, [side]: rows, error: null }) : false;
  };

  const act = (action: TaskEditorAction): boolean => {
    if (!draft || typeof action !== 'object' || (action as unknown) === null) return false;
    if ('side' in action && action.side !== 'predecessors' && (action.side as unknown) !== 'successors')
      return false;
    switch (action.type) {
      case 'input': {
        const { field, value } = action;
        if (field === 'manuallyScheduled')
          return typeof value === 'boolean' ? set({ ...draft, manual: value, error: null }) : false;
        if (field === 'constraintType') {
          const constraint: unknown = value;
          if (constraint !== 'none' && constraint !== 'startnoearlierthan') return false;
          const { constraintDate: _cleared, ...rest } = draft.errors;
          return set({ ...draft, constraint: value, errors: rest, error: null });
        }
        if (!FIELDS.includes(field) || typeof value !== 'string') return false;
        const { [field]: _cleared, ...errors } = draft.errors;
        return set({ ...draft, texts: { ...draft.texts, [field]: value }, errors, error: null });
      }
      case 'tab':
        return TABS.has(action.tab) ? set({ ...draft, tab: action.tab }) : false;
      case 'addDependency':
        return updateSide(action.side, (rows) => [
          ...rows,
          {
            key: `n${String(nextKey++)}`,
            dependencyId: null,
            taskId: null,
            type: 'FS',
            lag: '0d',
            initial: null,
            error: null,
          },
        ]);
      case 'updateDependency': {
        const changes: unknown = action.changes;
        if (typeof changes !== 'object' || changes === null) return false;
        const { taskId, type, lag } = changes as Record<string, unknown>;
        return updateSide(action.side, (rows) => {
          if (!rows.some((row) => row.key === action.key)) return null;
          if (type !== undefined && !TYPES.has(type as DependencyType)) return null;
          if (lag !== undefined && typeof lag !== 'string') return null;
          return rows.map((row) =>
            row.key !== action.key
              ? row
              : {
                  ...row,
                  ...(taskId === undefined ? {} : { taskId: taskId as Id | null }),
                  ...(type === undefined ? {} : { type: type as DependencyType }),
                  ...(lag === undefined ? {} : { lag: lag }),
                  error: null,
                },
          );
        });
      }
      case 'removeDependency': {
        const removed = draft[action.side].find((row) => row.key === action.key);
        if (!removed) return false;
        const dependencyId = removed.dependencyId;
        const withRemoved =
          dependencyId === null ? draft : { ...draft, removed: [...draft.removed, dependencyId] };
        draft = withRemoved;
        return updateSide(action.side, (rows) => rows.filter((row) => row.key !== action.key));
      }
      case 'save':
        return save();
      case 'close':
        draft = null;
        context.show();
        return true;
    }
    return false;
  };

  return { current, open, act };
}
