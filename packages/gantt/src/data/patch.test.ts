import { describe, expect, it } from 'vitest';
import { createProject } from './project';
import { applyPatch, toProjectData } from './serialize';
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
  } else if (roll < 0.9) {
    const other = pick();
    if (other !== undefined && other !== target) tx.dependencies.add({ from: target, to: other });
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
    expect(toProjectData(project.getState())).toEqual({
      tasks: [expect.objectContaining({ id: 'root' })],
      dependencies: [],
    });
  });

  it('are JSON-serializable', () => {
    const project = createProject({ tasks: [{ id: 1, startDate: new Date(Date.UTC(2026, 0, 5)) }] });
    const patch = project.transact((tx) => {
      tx.tasks.add({ id: 2, endDate: new Date(Date.UTC(2026, 0, 9)) }, { parentId: 1 });
    });
    expect(JSON.parse(JSON.stringify(patch))).toEqual(patch);
  });
});
