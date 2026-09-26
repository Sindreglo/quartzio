import type { Id } from '../data/types';
import {
  moveTo,
  selectionOf,
  toggleRow,
  visibleRowOf,
  type KeyModifiers,
  type Selection,
  type VisibleRows,
} from './selection';

/** A key press, as `KeyboardEvent.key` plus the modifiers held. */
export interface KeyInput extends KeyModifiers {
  readonly key: string;
  /** `KeyboardEvent.code`: finds shortcuts (Ctrl+Z, Ctrl+A) on layouts without latin letters. */
  readonly code?: string | undefined;
}

export interface KeyContext extends VisibleRows {
  readonly selection: Selection;
  readonly collapsed: ReadonlySet<Id>;
  /** Rows that fit in the viewport, for PageUp and PageDown. */
  readonly pageRows: number;
  readonly multiSelect: boolean;
  readonly deleteKey: boolean;
  readonly undoRedo: boolean;
  readonly cellEdit: boolean;
}

/** What a key press does; carried out by the controller. */
export type KeyCommand =
  | { readonly type: 'select'; readonly selection: Selection }
  | { readonly type: 'expand'; readonly id: Id; readonly expanded: boolean }
  | { readonly type: 'delete'; readonly ids: readonly Id[]; readonly selection: Selection }
  | { readonly type: 'edit'; readonly id: Id }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' };

/** The keyboard of the task grid (see ADR 0010). `null` for keys it leaves alone. */
export function keyCommand(input: KeyInput, context: KeyContext): KeyCommand | null {
  const { key } = input;
  if (typeof key !== 'string' || input.alt === true) return null;
  const mod = input.ctrl === true || input.meta === true;
  const shift = input.shift === true;
  const { selection, rowIds } = context;
  const count = rowIds.length;
  const lower = shortcutLetter(key, input.code);

  if (mod && (lower === 'z' || lower === 'y')) {
    if (!context.undoRedo) return null;
    return lower === 'y' || shift ? { type: 'redo' } : { type: 'undo' };
  }
  if (key === 'Delete' || key === 'Backspace') {
    return context.deleteKey && selection.ids.length > 0 ? deletion(context) : null;
  }
  if (key === 'Escape') {
    return selection.ids.length > 0
      ? { type: 'select', selection: selectionOf(selection, [], selection.active, selection.anchor) }
      : null;
  }
  if (count === 0) return null;
  if (mod && lower === 'a') {
    if (!context.multiSelect) return null;
    // A copy: the selection is handed to the app, and rowIds is the engine's own.
    return {
      type: 'select',
      selection: selectionOf(selection, [...rowIds], selection.active, selection.anchor),
    };
  }

  const current = visibleRowOf(selection.active, context);
  const move = (target: number): KeyCommand => ({
    type: 'select',
    selection: moveTo(
      selection,
      Math.max(0, Math.min(count - 1, target)),
      context,
      { extend: shift, add: mod },
      context.multiSelect,
    ),
  });
  const page = Math.max(1, context.pageRows);
  switch (key) {
    case 'ArrowDown':
      return move(current === undefined ? 0 : current + 1);
    case 'ArrowUp':
      return move(current === undefined ? 0 : current - 1);
    case 'PageDown':
      return move(current === undefined ? 0 : current + page);
    case 'PageUp':
      return move(current === undefined ? 0 : current - page);
    case 'Home':
      return move(0);
    case 'End':
      return move(count - 1);
  }
  if (current === undefined) return null;
  const id = rowIds[current] as Id;
  const isParent = !context.tree.isLeaf(id);
  switch (key) {
    case 'ArrowRight':
      if (!isParent) return null;
      if (context.collapsed.has(id)) return { type: 'expand', id, expanded: true };
      return move(current + 1); // its first child
    case 'ArrowLeft': {
      if (isParent && !context.collapsed.has(id)) return { type: 'expand', id, expanded: false };
      const parent = context.tree.ancestors(id)[0];
      const index = parent === undefined ? undefined : context.rowIndex.get(parent);
      return index === undefined ? null : move(index);
    }
    case ' ':
      return { type: 'select', selection: toggleRow(selection, current, context, context.multiSelect) };
    case 'Enter':
    case 'F2':
      return context.cellEdit && !mod && !shift ? { type: 'edit', id } : null;
  }
  return null;
}

/** The letter of a key for shortcuts; from the physical key when the layout's key isn't a latin letter. */
function shortcutLetter(key: string, code: string | undefined): string {
  const letter = key.length === 1 ? key.toLowerCase() : key;
  if (/^[a-z]$/.test(letter) || typeof code !== 'string' || !/^Key[A-Z]$/.test(code)) return letter;
  return code.slice(3).toLowerCase();
}

/**
 * Deletes the selected rows (a task inside another selected one goes with it). Selected tasks hidden in a
 * collapsed parent are left alone: a key press never deletes what can't be seen. The cursor moves to the row
 * that takes the place of the active one, or the one before when nothing comes after.
 */
function deletion(context: KeyContext): KeyCommand | null {
  const { selection, tree, rowIds, rowIndex } = context;
  const ids = selection.ids.filter(
    (id) => rowIndex.has(id) && !tree.ancestors(id).some((ancestor) => selection.set.has(ancestor)),
  );
  if (ids.length === 0) return null;
  const gone = new Set(ids);
  const stays = (id: Id) => !gone.has(id) && !tree.ancestors(id).some((ancestor) => gone.has(ancestor));
  const from = visibleRowOf(selection.active, context) ?? context.rowIndex.get(ids[0] as Id) ?? 0;
  const after = rowIds.slice(from).find(stays);
  const next = after ?? rowIds.slice(0, from).reverse().find(stays) ?? null;
  return { type: 'delete', ids, selection: selectionOf(selection, [], next, next) };
}
