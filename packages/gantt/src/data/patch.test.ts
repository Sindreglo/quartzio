import { describe, expect, it } from 'vitest';
import { createProject } from './project';
import { applyPatch, toProjectData } from './serialize';
import { getTreeIndex } from './tree';
import type { Transaction } from './transaction';
import type { Id, Patch, ProjectData } from './types';

/** Small deterministic PRNG so failures are reproducible. */
function createRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 2 ** 32;
    return value / 2 ** 32;
  };
}

/** All task ids as the transaction currently sees them (including its own earlier edits). */
function currentIds(tx: Transaction): Id[] {
  const walk = (parentId: Id | null): Id[] => tx.tasks.children(parentId).flatMap((id) => [id, ...walk(id)]);
  return walk(null);
}

function randomEdit(tx: Transaction, random: () => number): void {
  const ids = currentIds(tx);
  const pick = (): Id | undefined => ids[Math.floor(random() * ids.length)];
  const target = pick();
  const roll = random();

  if (roll < 0.35 || target === undefined) {
    const parentId = random() < 0.5 ? null : (pick() ?? null);
    tx.tasks.add(
      { name: `t${String(Math.floor(random() * 1000))}` },
      { parentId, index: Math.floor(random() * 4) },
    );
  } else if (roll < 0.55) {
    tx.tasks.update(target, { name: `renamed ${String(Math.floor(random() * 1000))}`, percentDone: 50 });
  } else if (roll < 0.75) {
    const parentId = random() < 0.4 ? null : (pick() ?? null);
    try {
      tx.tasks.move(target, { parentId, index: Math.floor(random() * 4) });
    } catch {
      // Moving into the own subtree is rejected; that's fine for this test.
    }
  } else if (roll < 0.85) {
    const other = pick();
    if (other !== undefined && other !== target) tx.dependencies.add({ from: target, to: other });
  } else if (roll < 0.9) {
    const calendar = tx.calendars.add({ week: { monday: [{ start: '09:00', end: '15:00' }] } });
    tx.settings.update({
      calendarId: random() < 0.5 ? calendar.id : null,
      timeZone: random() < 0.5 ? 'Europe/Oslo' : 'local',
      hoursPerDay: random() < 0.5 ? 6 : 8,
    });
  } else {
    tx.tasks.remove(target);
  }
}

describe('patches', () => {
  it('invert exactly and replay exactly, over many random transactions', () => {
    const random = createRandom(42);
    const project = createProject({ tasks: [{ id: 'root' }] });
    const history: { before: ProjectData; patch: Patch; after: ProjectData }[] = [];

    for (let i = 0; i < 300; i++) {
      const before = project.toData();
      const patch = project.transact((tx) => {
        const edits = 1 + Math.floor(random() * 3);
        for (let e = 0; e < edits; e++) randomEdit(tx, random);
      });
      if (patch) history.push({ before, patch, after: project.toData() });
    }

    expect(history.length).toBeGreaterThan(200);

    for (const { before, patch, after } of history) {
      // Replaying the operations on the previous data gives the next data...
      expect(applyPatch(before, patch)).toEqual(after);
      // ...and the inverse takes it back.
      expect(applyPatch(after, { operations: patch.inverse, inverse: patch.operations })).toEqual(before);
    }

    // Undo everything, newest first, and end up where we started.
    for (const { patch } of [...history].reverse()) project.apply(patch.inverse);
    const final = toProjectData(project.getState());
    expect(final.tasks.map((task) => task.id)).toEqual(['root']);
    expect(final.dependencies).toEqual([]);
    expect(final.calendars).toEqual([]);
    expect(final.settings.timeZone).toBe('local');
  });

  it('are JSON-serializable', () => {
    const project = createProject({ tasks: [{ id: 1, startDate: new Date(Date.UTC(2026, 0, 5)) }] });
    const patch = project.transact((tx) => {
      tx.tasks.add({ id: 2, endDate: new Date(Date.UTC(2026, 0, 9)) }, { parentId: 1 });
    });
    expect(JSON.parse(JSON.stringify(patch))).toEqual(patch);
  });

  it('place tasks exactly where add and move ask, checked against a simple model', () => {
    const random = createRandom(7);
    const project = createProject();
    // Expected sibling lists per parent (null = root).
    const model = new Map<Id | null, Id[]>([[null, []]]);
    const siblings = (parentId: Id | null): Id[] => {
      let list = model.get(parentId);
      if (!list) model.set(parentId, (list = []));
      return list;
    };
    const parentOf = (id: Id): Id | null =>
      [...model.entries()].find(([, children]) => children.includes(id))?.[0] ?? null;
    const isInSubtree = (id: Id, root: Id): boolean =>
      id === root || siblings(root).some((child) => isInSubtree(id, child));
    const insert = (list: Id[], id: Id, index: number) => {
      list.splice(Math.max(0, Math.min(index, list.length)), 0, id);
    };

    for (let i = 0; i < 1500; i++) {
      const all = [...model.values()].flat();
      const index = Math.floor(random() * 5) - 1; // includes out-of-range indices
      const parentId =
        all.length > 0 && random() < 0.7 ? (all[Math.floor(random() * all.length)] ?? null) : null;

      if (all.length < 3 || random() < 0.4) {
        const id = `n${String(i)}`;
        project.transact((tx) => {
          tx.tasks.add({ id }, { parentId, index });
        });
        insert(siblings(parentId), id, index);
      } else {
        const id = all[Math.floor(random() * all.length)] as Id;
        if (parentId !== null && isInSubtree(parentId, id)) continue;
        project.transact((tx) => {
          tx.tasks.move(id, { parentId, index });
        });
        const old = siblings(parentOf(id));
        old.splice(old.indexOf(id), 1);
        insert(siblings(parentId), id, index);
      }

      const tree = getTreeIndex(project.getState().tasks);
      for (const [parent, children] of model) expect(tree.children(parent)).toEqual(children);
    }
  });

  it('keep untouched records identical when applied with applyPatch', () => {
    const project = createProject({ tasks: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const data = project.toData();
    const patch = project.transact((tx) => {
      tx.tasks.update(2, { name: 'Changed' });
    });
    const next = applyPatch(data, patch as Patch);
    expect(next.tasks[0]).toBe(data.tasks[0]);
    expect(next.tasks[2]).toBe(data.tasks[2]);
    expect(next.tasks[1]).not.toBe(data.tasks[1]);
  });
});
