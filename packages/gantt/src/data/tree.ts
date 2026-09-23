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

const cache = new WeakMap<Table<Task>, TreeIndex>();

export function getTreeIndex(tasks: Table<Task>): TreeIndex {
  let index = cache.get(tasks);
  if (!index) {
    index = buildTreeIndex(tasks);
    cache.set(tasks, index);
  }
  return index;
}

/** Uncached build, for tables that are still being mutated (transaction drafts). */
export function buildTreeIndex(tasks: Table<Task>): TreeIndex {
  const childrenByParent = new Map<Id | null, Id[]>();
  const positions = new Map<Id, number>();

  tasks.order.forEach((id, position) => {
    positions.set(id, position);
    const parentId = tasks.byId.get(id)?.parentId ?? null;
    const siblings = childrenByParent.get(parentId);
    if (siblings) siblings.push(id);
    else childrenByParent.set(parentId, [id]);
  });

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
    let parentId = tasks.byId.get(id)?.parentId ?? null;
    while (parentId !== null) {
      result.push(parentId);
      parentId = tasks.byId.get(parentId)?.parentId ?? null;
    }
    return result;
  };

  let flattened: Id[] | undefined;

  return {
    children,
    position: (id) => positions.get(id) ?? -1,
    ancestors,
    descendants,
    depth: (id) => ancestors(id).length,
    isLeaf: (id) => children(id).length === 0,
    flatten: () => {
      flattened ??= children(null).flatMap((rootId) => [rootId, ...descendants(rootId)]);
      return flattened;
    },
  };
}
