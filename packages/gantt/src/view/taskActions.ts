import type { Transaction } from '../data/transaction';
import type { TreeIndex } from '../data/tree';
import type { Dependency, Id, Task } from '../data/types';

export type AddWhere = 'above' | 'below' | 'subtask' | 'milestone' | 'successor' | 'predecessor';

const NEW_TASK_NAME = 'New task';

/**
 * Adds a task next to (or in) `target`: 1 day, or 0 for a milestone; a successor or predecessor is linked with
 * FS. Returns the new task's id. `id` is used when given (it must be new), otherwise the data makes one up.
 */
export function addTask(tx: Transaction, target: Task, where: AddWhere, id: Id | undefined): Id {
  const parentId = target.parentId;
  const index = tx.tasks.children(parentId).indexOf(target.id);
  const before = where === 'above' || where === 'predecessor';
  const fields = {
    ...(id === undefined ? {} : { id }),
    name: NEW_TASK_NAME,
    duration: where === 'milestone' ? 0 : 1,
  };
  const added =
    where === 'subtask'
      ? tx.tasks.add(fields, { parentId: target.id })
      : tx.tasks.add(fields, { parentId, index: before ? index : index + 1 });
  if (where === 'successor') tx.dependencies.add({ from: target.id, to: added.id, type: 'FS' });
  if (where === 'predecessor') tx.dependencies.add({ from: added.id, to: target.id, type: 'FS' });
  return added.id;
}

/**
 * Makes each task the last child of the sibling before it (in tree order; those without one stay). Links between
 * the task (or its subtasks) and its new parent go: a parent and its children can't be linked.
 */
export function indent(
  tx: Transaction,
  ids: readonly Id[],
  tree: TreeIndex,
  dependencies: Iterable<Dependency>,
): Id[] {
  const parents: Id[] = [];
  const links = [...dependencies];
  for (const id of ids) {
    const task = tx.tasks.get(id);
    if (!task) continue;
    const siblings = tx.tasks.children(task.parentId);
    const before = siblings[siblings.indexOf(id) - 1];
    if (before === undefined) continue;
    const subtree = new Set([id, ...tree.descendants(id)]);
    for (const link of links) {
      const between =
        (subtree.has(link.from) && link.to === before) || (link.from === before && subtree.has(link.to));
      if (between && tx.dependencies.get(link.id)) tx.dependencies.remove(link.id);
    }
    tx.tasks.move(id, { parentId: before });
    parents.push(before);
  }
  return parents;
}

/** Moves each task out of its parent, right after it (root tasks stay). */
export function outdent(tx: Transaction, ids: readonly Id[]): void {
  // Last first, so several siblings end up after their parent in their own order.
  for (const id of [...ids].reverse()) {
    const task = tx.tasks.get(id);
    const parent = task?.parentId === null || task === undefined ? undefined : tx.tasks.get(task.parentId);
    if (!parent) continue;
    const index = tx.tasks.children(parent.parentId).indexOf(parent.id);
    tx.tasks.move(id, { parentId: parent.parentId, index: index + 1 });
  }
}
