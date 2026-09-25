import type { Id, Table, Task } from './types';

const EMPTY: readonly Id[] = [];

/** Derived hierarchy for a task table. Built in O(n); cached per table so repeated lookups are cheap. */
export interface TreeIndex {
  /** Child ids in sibling order. `null` returns the root tasks. */
  children: (parentId: Id | null) => readonly Id[];
  /** Position of each task in the table's `order`. */
  position: (id: Id) => number;
  /** Ancestors from the direct parent up to the root. */
  ancestors: (id: Id) => Id[];
  /** All descendants, depth-first in sibling order. */
  descendants: (id: Id) => Id[];
  depth: (id: Id) => number;
  isLeaf: (id: Id) => boolean;
  /** Tasks depth-first in sibling order: the order rows appear in when everything is expanded. */
  flatten: () => readonly Id[];
}

/**
 * The hierarchy of a table that is still changing (a transaction draft). Added and removed tasks are updated in
 * place, so adding or removing many tasks doesn't rebuild it each time. No positions: they shift with every
 * change (use `order`).
 */
export interface DraftTreeIndex extends Omit<TreeIndex, 'position' | 'flatten'> {
  /** Like `children`, without copying: only valid until the next insert. */
  childrenView: (parentId: Id | null) => readonly Id[];
  insert: (id: Id, parentId: Id | null, siblingIndex: number) => void;
  /** Removes a task with all its descendants (given, so they aren't walked twice). */
  removeSubtree: (id: Id, descendants: readonly Id[]) => void;
}

const cache = new WeakMap<Table<Task>, TreeIndex>();
// Tables with the same structure (order and parents) as an earlier table, whose index they share once one is
// built. Points at the first table of such a run, never along a chain, so it keeps at most one old table alive.
const sameStructure = new WeakMap<Table<Task>, Table<Task>>();

export function getTreeIndex(tasks: Table<Task>): TreeIndex {
  const cached = cache.get(tasks);
  if (cached) return cached;
  const earlier = sameStructure.get(tasks);
  const index = (earlier && cache.get(earlier)) ?? buildTreeIndex(tasks);
  if (earlier) cache.set(earlier, index);
  cache.set(tasks, index);
  sameStructure.delete(tasks);
  return index;
}

/**
 * Records that `next` has the same order and parents as `previous` (only other fields changed), so it can use
 * the same index instead of building one: field edits are far more common than structural ones.
 */
export function shareTreeIndex(previous: Table<Task>, next: Table<Task>): void {
  if (previous === next) return;
  const index = cache.get(previous);
  if (index) cache.set(next, index);
  else sameStructure.set(next, sameStructure.get(previous) ?? previous);
}

/** Uncached build of a finished table's index. */
export function buildTreeIndex(tasks: Table<Task>): TreeIndex {
  const structure = readStructure(tasks);
  const positions = new Map<Id, number>();
  tasks.order.forEach((id, position) => positions.set(id, position));
  const walk = walker(structure);
  let flattened: Id[] | undefined;
  return {
    ...walk,
    position: (id) => positions.get(id) ?? -1,
    flatten: () => {
      flattened ??= walk.children(null).flatMap((rootId) => [rootId, ...walk.descendants(rootId)]);
      return flattened;
    },
  };
}

export function buildDraftTreeIndex(tasks: Table<Task>): DraftTreeIndex {
  const structure = readStructure(tasks);
  const walk = walker(structure);
  return {
    ...walk,
    // A copy: the lists change with later inserts.
    children: (parentId) => [...walk.children(parentId)],
    childrenView: walk.children,
    insert: (id, parentId, siblingIndex) => {
      structure.parents.set(id, parentId);
      const siblings = structure.childrenByParent.get(parentId);
      if (siblings) siblings.splice(siblingIndex, 0, id);
      else structure.childrenByParent.set(parentId, [id]);
    },
    removeSubtree: (id, descendants) => {
      // Only the root leaves a sibling list; the descendants' lists go with them.
      const siblings = structure.childrenByParent.get(structure.parents.get(id) ?? null);
      const at = siblings?.indexOf(id) ?? -1;
      if (at !== -1) siblings?.splice(at, 1);
      for (const removed of [id, ...descendants]) {
        structure.parents.delete(removed);
        structure.childrenByParent.delete(removed);
      }
    },
  };
}

interface Structure {
  childrenByParent: Map<Id | null, Id[]>;
  // Kept in the index rather than read from the table, so a shared index doesn't hold on to old tables.
  parents: Map<Id, Id | null>;
}

function readStructure(tasks: Table<Task>): Structure {
  const childrenByParent = new Map<Id | null, Id[]>();
  const parents = new Map<Id, Id | null>();
  for (const id of tasks.order) {
    const parentId = tasks.byId.get(id)?.parentId ?? null;
    parents.set(id, parentId);
    const siblings = childrenByParent.get(parentId);
    if (siblings) siblings.push(id);
    else childrenByParent.set(parentId, [id]);
  }
  return { childrenByParent, parents };
}

function walker({ childrenByParent, parents }: Structure): Omit<TreeIndex, 'position' | 'flatten'> {
  const children = (parentId: Id | null): readonly Id[] => childrenByParent.get(parentId) ?? EMPTY;

  const descendants = (id: Id): Id[] => {
    const result: Id[] = [];
    const stack = [...children(id)].reverse();
    while (stack.length > 0) {
      const current = stack.pop() as Id;
      result.push(current);
      const kids = children(current);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as Id);
    }
    return result;
  };

  const ancestors = (id: Id): Id[] => {
    const result: Id[] = [];
    let parentId = parents.get(id) ?? null;
    while (parentId !== null) {
      result.push(parentId);
      parentId = parents.get(parentId) ?? null;
    }
    return result;
  };

  return {
    children,
    ancestors,
    descendants,
    depth: (id) => ancestors(id).length,
    isLeaf: (id) => children(id).length === 0,
  };
}
