import type { TreeIndex } from '../data/tree';
import type { Id, Task } from '../data/types';

/** Which keys were held, for clicks and key presses. Ctrl and Cmd (meta) mean the same. */
export interface KeyModifiers {
  readonly shift?: boolean | undefined;
  readonly ctrl?: boolean | undefined;
  readonly meta?: boolean | undefined;
  readonly alt?: boolean | undefined;
}

/** Selected tasks, the keyboard cursor, and where Shift ranges start from (see ADR 0010). */
export interface Selection {
  /** In the order they were selected; a range in row order. */
  readonly ids: readonly Id[];
  readonly set: ReadonlySet<Id>;
  readonly active: Id | null;
  readonly anchor: Id | null;
}

export const NO_SELECTION: Selection = { ids: [], set: new Set(), active: null, anchor: null };

/** The visible rows, to find ranges and neighbours in. */
export interface VisibleRows {
  readonly rowIds: readonly Id[];
  readonly rowIndex: ReadonlyMap<Id, number>;
  readonly tree: TreeIndex;
}

const sameIds = (a: readonly Id[], b: readonly Id[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** A selection, or `previous` when nothing changed (so its arrays keep their identity). */
export function selectionOf(
  previous: Selection,
  ids: readonly Id[],
  active: Id | null,
  anchor: Id | null,
): Selection {
  const same = sameIds(previous.ids, ids);
  if (same && previous.active === active && previous.anchor === anchor) return previous;
  return same
    ? { ...previous, active, anchor }
    : {
        ids: previous.ids.length === 0 && ids.length === 0 ? previous.ids : ids,
        set: new Set(ids),
        active,
        anchor,
      };
}

/** The row showing a task: its own, or its nearest visible ancestor's when collapsed away. */
export function visibleRowOf(id: Id | null, rows: VisibleRows): number | undefined {
  if (id === null) return undefined;
  const own = rows.rowIndex.get(id);
  if (own !== undefined) return own;
  for (const ancestor of rows.tree.ancestors(id)) {
    const index = rows.rowIndex.get(ancestor);
    if (index !== undefined) return index;
  }
  return undefined;
}

/** The rows from the anchor (or its visible ancestor) to `target`, in row order. */
function rangeTo(selection: Selection, target: number, rows: VisibleRows): Id[] {
  const from = visibleRowOf(selection.anchor, rows) ?? target;
  return rows.rowIds.slice(Math.min(from, target), Math.max(from, target) + 1);
}

const union = (a: readonly Id[], b: readonly Id[]) => {
  const seen = new Set(a);
  return [...a, ...b.filter((id) => !seen.has(id))];
};

/**
 * Moves the cursor to a row: selects just it; with `extend` (Shift), the rows from the anchor to it (added to
 * the selection with `add`); with `add` alone (Ctrl/Cmd), leaves the selection as it is.
 */
export function moveTo(
  selection: Selection,
  target: number,
  rows: VisibleRows,
  { extend, add }: { extend: boolean; add: boolean },
  multiSelect: boolean,
): Selection {
  const id = rows.rowIds[target] as Id;
  if (multiSelect && extend) {
    const range = rangeTo(selection, target, rows);
    return selectionOf(selection, add ? union(selection.ids, range) : range, id, selection.anchor ?? id);
  }
  if (multiSelect && add) return selectionOf(selection, selection.ids, id, selection.anchor);
  return selectionOf(selection, [id], id, id);
}

/** Selects or deselects a row (Ctrl/Cmd-click, Space). */
export function toggleRow(
  selection: Selection,
  target: number,
  rows: VisibleRows,
  multiSelect: boolean,
): Selection {
  const id = rows.rowIds[target] as Id;
  const has = selection.set.has(id);
  if (!multiSelect) return selectionOf(selection, has && selection.ids.length === 1 ? [] : [id], id, id);
  return selectionOf(
    selection,
    has ? selection.ids.filter((other) => other !== id) : [...selection.ids, id],
    id,
    id,
  );
}

/** A click on a visible row, as in a file list: select it, toggle with Ctrl/Cmd, a range with Shift. */
export function clickRow(
  selection: Selection,
  id: Id,
  modifiers: KeyModifiers,
  rows: VisibleRows,
  multiSelect: boolean,
): Selection {
  const target = rows.rowIndex.get(id);
  if (target === undefined) return selection;
  const add = modifiers.ctrl === true || modifiers.meta === true;
  const extend = modifiers.shift === true && selection.anchor !== null;
  if (add && !extend) return toggleRow(selection, target, rows, multiSelect);
  return moveTo(selection, target, rows, { extend, add }, multiSelect);
}

/** Selects existing tasks by id (duplicates and unknown ids skipped); the last one becomes the cursor. */
export function selectIds(
  selection: Selection,
  ids: readonly unknown[],
  tasks: ReadonlyMap<Id, Task>,
  multiSelect: boolean,
): Selection {
  const known = [...new Set(ids)].filter((id): id is Id => tasks.has(id as Id));
  const kept = multiSelect ? known : known.slice(-1);
  const last = kept.at(-1);
  return last === undefined
    ? selectionOf(selection, [], selection.active, selection.anchor)
    : selectionOf(selection, kept, last, last);
}

/** Drops tasks that no longer exist (the same selection when none were removed). */
export function pruneSelection(selection: Selection, tasks: ReadonlyMap<Id, Task>): Selection {
  const exists = (id: Id | null) => (id !== null && tasks.has(id) ? id : null);
  if (selection.ids.every((id) => tasks.has(id)) && exists(selection.active) === selection.active) {
    if (exists(selection.anchor) === selection.anchor) return selection;
  }
  return selectionOf(
    selection,
    selection.ids.filter((id) => tasks.has(id)),
    exists(selection.active),
    exists(selection.anchor),
  );
}
