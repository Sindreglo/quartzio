import type { PlannedChange } from '../data/project';
import type { Transaction } from '../data/transaction';
import type { TreeIndex } from '../data/tree';
import type { Id, ProjectState } from '../data/types';
import { QuartzioError } from '../util/errors';
import type { ResolvedColumns } from './columns';
import { taskDates } from './dates';
import { editKind, initialText, parseEdit, type CellEdit, type EditKind } from './editing';
import type { ProposedChange } from './interaction';
import type { KeyInput } from './keyboard';
import { rowKey } from './rows';

/** What the editor needs from the view. */
export interface EditorView {
  readonly project: ProjectState;
  readonly tree: TreeIndex;
  readonly rowIds: readonly Id[];
  readonly rowIndex: ReadonlyMap<Id, number>;
  readonly columns: ResolvedColumns;
  readonly dateField: 'date' | 'datetime';
}

export interface EditorContext {
  readonly view: () => EditorView;
  readonly enabled: () => boolean;
  /** Plans a change without applying it (to validate what it would do); throws QuartzioError if refused. */
  readonly plan: (fn: (tx: Transaction) => void) => PlannedChange | null;
  /** Applies (or, controlled, reports) the change; throws QuartzioError if refused. */
  readonly commit: (fn: (tx: Transaction) => void) => void;
  readonly validate: (change: ProposedChange) => boolean | string;
  /** The edit changed: show it. */
  readonly show: () => void;
  /** Editing starts on a row: move the cursor there. */
  readonly focusRow: (id: Id) => void;
}

export interface CellEditor {
  /** The open edit as the view shows it; drops an edit on a stale basis. The same object while unchanged. */
  readonly current: (view: EditorView) => CellEdit | null;
  readonly start: (id: Id, columnId?: string) => boolean;
  readonly input: (text: string) => void;
  readonly keyDown: (key: KeyInput) => boolean;
  readonly commit: () => boolean;
  readonly cancel: () => void;
}

interface Open {
  readonly taskId: Id;
  readonly columnId: string;
  readonly kind: EditKind;
  readonly text: string;
  /** The value's text: while `text` is still this, nothing was typed (and the field follows the value). */
  readonly initial: string;
  readonly error: string | null;
}

/** A cell of the task list, if it can be edited: the field it edits and how. */
function cellOf(view: EditorView, id: Id, columnIndex: number) {
  const task = view.project.tasks.byId.get(id);
  const column = view.columns.state.items[columnIndex];
  const field = view.columns.fields[columnIndex] ?? null;
  if (!task || !column || field === null || !view.rowIndex.has(id)) return null;
  const dates = taskDates(task);
  const kind = editKind(field, task, !view.tree.isLeaf(id), dates, view.dateField);
  return kind ? { task, column, field, dates, kind } : null;
}

const columnIndexOf = (view: EditorView, columnId: string) =>
  view.columns.state.items.findIndex((column) => column.id === columnId);

/** Editing cells in the task list (see ADR 0011). */
export function createCellEditor(context: EditorContext): CellEditor {
  let open: Open | null = null;
  let shown: CellEdit | null = null;

  const current = (view: EditorView): CellEdit | null => {
    const cell =
      open && context.enabled() ? cellOf(view, open.taskId, columnIndexOf(view, open.columnId)) : null;
    // Stale: the cell can't be edited now, or needs another kind of field (its text would not fit it).
    if (!open || cell?.kind !== open.kind) {
      open = null;
      shown = null;
      return null;
    }
    if (open.text === open.initial) {
      // Nothing typed: show the value as it is now (changed elsewhere, or the app accepted an earlier edit).
      const value = initialText(cell.field, cell.kind, cell.task, cell.dates, view.project.settings.timeZone);
      if (value !== open.initial) open = { ...open, text: value, initial: value };
    }
    const { taskId, columnId, kind, text, error } = open;
    if (
      shown?.taskId !== taskId ||
      shown.columnId !== columnId ||
      shown.kind !== kind ||
      shown.text !== text ||
      shown.error !== error
    ) {
      shown = { taskId, rowKey: rowKey(taskId), columnId, kind, text, error };
    }
    return shown;
  };

  const start = (id: Id, columnId?: string): boolean => {
    const wasOpen = open !== null;
    open = null;
    const view = context.view();
    let cell = null;
    if (context.enabled()) {
      if (columnId === undefined) {
        for (let index = 0; index < view.columns.state.items.length && !cell; index++)
          cell = cellOf(view, id, index);
      } else if (typeof columnId === 'string') {
        cell = cellOf(view, id, columnIndexOf(view, columnId));
      }
    }
    if (!cell) {
      if (wasOpen) context.show();
      return false;
    }
    const text = initialText(cell.field, cell.kind, cell.task, cell.dates, view.project.settings.timeZone);
    open = { taskId: id, columnId: cell.column.id, kind: cell.kind, text, initial: text, error: null };
    context.focusRow(id);
    context.show();
    return true;
  };

  const refuse = (error: string): false => {
    if (open) open = { ...open, error };
    context.show();
    return false;
  };

  const commit = (): boolean => {
    if (!open) return false;
    const view = context.view();
    const cell = cellOf(view, open.taskId, columnIndexOf(view, open.columnId));
    if (!cell) {
      open = null;
      context.show();
      return false;
    }
    const { text } = open;
    const close = (): true => {
      open = null;
      context.show();
      return true;
    };
    if (text === open.initial) return close();
    const parsed = parseEdit(cell.field, cell.kind, text, cell.task, cell.dates, view.project.settings);
    if ('error' in parsed) return refuse(parsed.error);
    try {
      const planned = context.plan(parsed.change);
      if (!planned) return close();
      const after = planned.state.tasks.byId.get(cell.task.id);
      const proposed = after ? parsed.propose(cell.task, taskDates(after)) : null;
      if (proposed) {
        let verdict: boolean | string;
        try {
          verdict = context.validate(proposed);
        } catch (error) {
          // A validator that throws is a no, with its message.
          verdict = error instanceof Error ? error.message : 'Not allowed.';
        }
        if (verdict !== true) return refuse(typeof verdict === 'string' ? verdict : 'Not allowed.');
      }
      const edited = open;
      open = null;
      try {
        context.commit(parsed.change);
      } catch (error) {
        open = edited;
        throw error;
      }
      context.show();
      return true;
    } catch (error) {
      // The data refusing the change (e.g. an unreasonable duration): shown in the field.
      if (error instanceof QuartzioError) return refuse(error.message);
      throw error;
    }
  };

  /** The next (or previous) editable cell after the open one, across rows. */
  const neighbour = (from: Open, step: 1 | -1): { id: Id; columnId: string } | null => {
    const view = context.view();
    const columns = view.columns.state.items.length;
    let row = view.rowIndex.get(from.taskId);
    let column = columnIndexOf(view, from.columnId);
    if (row === undefined || column < 0) return null;
    for (;;) {
      column += step;
      if (column < 0 || column >= columns) {
        row += step;
        column = step === 1 ? 0 : columns - 1;
      }
      const id = view.rowIds[row];
      if (id === undefined) return null;
      const cell = cellOf(view, id, column);
      if (cell) return { id, columnId: cell.column.id };
    }
  };

  return {
    current,
    start,
    commit,
    input(text) {
      if (!open || typeof text !== 'string') return;
      open = { ...open, text, error: null };
      context.show();
    },
    keyDown(key) {
      if (!open || typeof key !== 'object' || (key as unknown) === null) return false;
      switch (key.key) {
        case 'Escape':
          open = null;
          context.show();
          return true;
        case 'Enter':
          commit();
          return true;
        case 'Tab': {
          const from = open;
          if (commit()) {
            const next = neighbour(from, key.shift === true ? -1 : 1);
            if (next) start(next.id, next.columnId);
          }
          return true; // focus stays in the chart
        }
      }
      return false;
    },
    cancel() {
      if (!open) return;
      open = null;
      context.show();
    },
  };
}
