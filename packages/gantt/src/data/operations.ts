import { QuartzioError } from '../util/errors';
import { Draft, type DraftTable } from './draft';
import type { Id, Operation, ProjectState, StoreName } from './types';

type AnyRecord = { readonly id: Id } & Record<string, unknown>;

const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max));

/**
 * Applies one operation to the draft and returns its inverse.
 * Only checks what is needed to keep the tables consistent (ids exist / are unique);
 * semantic validation (parents exist, no cycles, ...) is the transaction's job.
 */
export function applyOperation(draft: Draft, op: Operation): Operation {
  const table = draft.write(op.store) as unknown as DraftTable<AnyRecord>;
  const store: StoreName = op.store;

  switch (op.type) {
    case 'add': {
      const record = op.record as unknown as AnyRecord;
      if (table.byId.has(record.id)) {
        throw new QuartzioError(`Cannot add ${store} "${String(record.id)}": the id already exists.`);
      }
      table.order.splice(clamp(op.index, table.order.length), 0, record.id);
      table.byId.set(record.id, record);
      return { type: 'remove', store, id: record.id };
    }
    case 'remove': {
      const record = table.byId.get(op.id);
      if (!record) throw unknownId(store, op.id, 'remove');
      const index = table.order.indexOf(op.id);
      table.order.splice(index, 1);
      table.byId.delete(op.id);
      return { type: 'add', store, record, index } as unknown as Operation;
    }
    case 'update': {
      const record = table.byId.get(op.id);
      if (!record) throw unknownId(store, op.id, 'update');
      const previous: Record<string, unknown> = {};
      for (const key of Object.keys(op.changes)) previous[key] = record[key];
      table.byId.set(op.id, { ...record, ...op.changes });
      return { type: 'update', store, id: op.id, changes: previous };
    }
    case 'move': {
      if (!table.byId.has(op.id)) throw unknownId(store, op.id, 'move');
      const from = table.order.indexOf(op.id);
      table.order.splice(from, 1);
      table.order.splice(clamp(op.index, table.order.length), 0, op.id);
      return { type: 'move', store, id: op.id, index: from };
    }
  }
}

/** Applies operations in order and returns the new state together with the inverse operations. */
export function applyOperations(
  state: ProjectState,
  operations: readonly Operation[],
): { state: ProjectState; inverse: Operation[] } {
  const draft = new Draft(state);
  const inverse = operations.map((op) => applyOperation(draft, op)).reverse();
  return { state: draft.finish(), inverse };
}

function unknownId(store: StoreName, id: Id, action: string): QuartzioError {
  return new QuartzioError(`Cannot ${action} ${store} "${String(id)}": no record with that id.`);
}
