import type { Patch } from '../data/types';

/** A change as it goes into the history: an edit, or an undo or redo of an earlier one (its patch). */
export interface HistoryAction {
  readonly type: 'edit' | 'undo' | 'redo';
  readonly patch: Patch;
}

export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface History {
  readonly state: () => HistoryState;
  /** The change an undo would revert, and a redo would redo. */
  readonly undoable: () => Patch | undefined;
  readonly redoable: () => Patch | undefined;
  /** Records changes that took effect (in controlled mode: once the app passed the data back). */
  readonly confirm: (actions: readonly HistoryAction[]) => void;
  readonly clear: () => void;
}

const LIMIT = 100;

/** Undo and redo stacks of patches (see ADR 0010). The state object is the same while nothing changes. */
export function createHistory(): History {
  let undo: Patch[] = [];
  let redo: Patch[] = [];
  let state: HistoryState = { canUndo: false, canRedo: false };
  const update = () => {
    const next = { canUndo: undo.length > 0, canRedo: redo.length > 0 };
    if (next.canUndo !== state.canUndo || next.canRedo !== state.canRedo) state = next;
  };
  return {
    state: () => state,
    undoable: () => undo.at(-1),
    redoable: () => redo.at(-1),
    confirm(actions) {
      for (const { type, patch } of actions) {
        if (type === 'edit') {
          undo.push(patch);
          if (undo.length > LIMIT) undo.shift();
          redo = [];
        } else if (type === 'undo') {
          // Only the step on top can be undone. Anything else means the history no longer matches the data.
          if (undo.at(-1) !== patch) {
            undo = [];
            redo = [];
            continue;
          }
          undo.pop();
          redo.push(patch);
        } else {
          if (redo.at(-1) !== patch) {
            undo = [];
            redo = [];
            continue;
          }
          redo.pop();
          undo.push(patch);
        }
      }
      update();
    },
    clear() {
      undo = [];
      redo = [];
      update();
    },
  };
}
