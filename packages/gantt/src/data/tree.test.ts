import { describe, expect, it } from 'vitest';
import { QuartzioError } from '../util/errors';
import { createProjectState } from './normalize';
import { applyOperations } from './operations';
import { createProject } from './project';
import type { ProjectInput } from './types';
import { getTreeIndex } from './tree';

const state = createProjectState({
  tasks: [
    { id: 'a', children: [{ id: 'a1', children: [{ id: 'a1x' }] }, { id: 'a2' }] },
    { id: 'b' },
    // Listed out of depth-first order on purpose: sibling order is relative order in the list.
    { id: 'b2', parentId: 'b' },
    { id: 'c' },
    { id: 'b1', parentId: 'b' },
  ],
});
const tree = getTreeIndex(state.tasks);

describe('getTreeIndex', () => {
  it('lists children in sibling order', () => {
    expect(tree.children(null)).toEqual(['a', 'b', 'c']);
    expect(tree.children('b')).toEqual(['b2', 'b1']);
    expect(tree.children('a2')).toEqual([]);
  });

  it('walks ancestors and descendants', () => {
    expect(tree.ancestors('a1x')).toEqual(['a1', 'a']);
    expect(tree.descendants('a')).toEqual(['a1', 'a1x', 'a2']);
    expect(tree.depth('a1x')).toBe(2);
    expect(tree.isLeaf('a1x')).toBe(true);
    expect(tree.isLeaf('a')).toBe(false);
  });

  it('flattens the tree depth-first', () => {
    expect(tree.flatten()).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'b2', 'b1', 'c']);
  });

  it('is cached per table', () => {
    expect(getTreeIndex(state.tasks)).toBe(tree);
  });
});

describe('sharing the tree index between states', () => {
  const input: ProjectInput = {
    tasks: [
      { id: 'a', name: 'A', children: [{ id: 'a1' }, { id: 'a2' }] },
      { id: 'b', name: 'B' },
    ],
  };
  const tasksOf = (project: ReturnType<typeof createProject>) => project.getState().tasks;

  it('keeps the index when only fields change', () => {
    const project = createProject(input);
    const before = getTreeIndex(tasksOf(project));
    project.transact((tx) => {
      tx.tasks.update('a1', { name: 'Renamed', percentDone: 50 });
    });
    expect(getTreeIndex(tasksOf(project))).toBe(before);
  });

  it('builds a new, correct index after add, remove, move and a parent change', () => {
    const project = createProject(input);
    const steps: [
      (tx: Parameters<Parameters<typeof project.transact>[0]>[0]) => void,
      (string | number)[],
    ][] = [
      [(tx) => tx.tasks.add({ id: 'a3' }, { parentId: 'a' }), ['a', 'a1', 'a2', 'a3', 'b']],
      [
        (tx) => {
          tx.tasks.remove('a2');
        },
        ['a', 'a1', 'a3', 'b'],
      ],
      [
        (tx) => {
          tx.tasks.move('b', { index: 0 });
        },
        ['b', 'a', 'a1', 'a3'],
      ],
      [
        (tx) => {
          tx.tasks.move('a1', { parentId: 'b' });
        },
        ['b', 'a1', 'a', 'a3'],
      ],
    ];
    for (const [step, expected] of steps) {
      const before = getTreeIndex(tasksOf(project));
      project.transact(step);
      const after = getTreeIndex(tasksOf(project));
      expect(after).not.toBe(before);
      expect(after.flatten()).toEqual(expected);
    }
    expect(getTreeIndex(tasksOf(project)).ancestors('a1')).toEqual(['b']);
  });

  it('builds a new index for a parent change applied as a raw operation', () => {
    const state = createProjectState(input);
    const before = getTreeIndex(state.tasks);
    const next = applyOperations(state, [
      { type: 'update', store: 'tasks', id: 'a2', changes: { parentId: 'b' } },
    ]);
    expect(getTreeIndex(next.state.tasks)).not.toBe(before);
    expect(getTreeIndex(next.state.tasks).children('b')).toEqual(['a2']);
  });

  it('keeps the index across many edits without lookups in between, and stays correct', () => {
    const project = createProject(input);
    const first = getTreeIndex(tasksOf(project));
    for (let i = 0; i < 1000; i++) {
      project.transact((tx) => {
        tx.tasks.update('b', { name: `B${String(i)}` });
      });
    }
    expect(getTreeIndex(tasksOf(project))).toBe(first);
    expect(first.ancestors('a2')).toEqual(['a']);
  });

  it('shares the index before it was ever built', () => {
    const project = createProject(input);
    const original = tasksOf(project);
    project.transact((tx) => {
      tx.tasks.update('a', { name: 'X' });
    });
    project.transact((tx) => {
      tx.tasks.update('a', { name: 'Y' });
    });
    const latest = getTreeIndex(tasksOf(project));
    expect(getTreeIndex(original)).toBe(latest);
    expect(latest.flatten()).toEqual(['a', 'a1', 'a2', 'b']);
  });

  it('keeps the index when controlled data comes back with only field changes', () => {
    const state = createProjectState(input);
    const before = getTreeIndex(state.tasks);
    const renamed = createProjectState(
      {
        tasks: [
          { id: 'a', name: 'A2', children: [{ id: 'a1' }, { id: 'a2' }] },
          { id: 'b', name: 'B' },
        ],
      },
      state,
    );
    expect(renamed.tasks).not.toBe(state.tasks);
    expect(getTreeIndex(renamed.tasks)).toBe(before);
  });

  it('builds a new index when controlled data changes a parent or the order', () => {
    const state = createProjectState(input);
    const before = getTreeIndex(state.tasks);
    // Same order in the flat list, but a2 now belongs to b.
    const reparented = createProjectState(
      {
        tasks: [
          { id: 'a', name: 'A' },
          { id: 'a1', parentId: 'a' },
          { id: 'a2', parentId: 'b' },
          { id: 'b', name: 'B' },
        ],
      },
      state,
    );
    expect(getTreeIndex(reparented.tasks)).not.toBe(before);
    expect(getTreeIndex(reparented.tasks).children('b')).toEqual(['a2']);
    const reordered = createProjectState(
      { tasks: [{ id: 'b', name: 'B' }, ...(input.tasks ?? []).slice(0, 1)] },
      state,
    );
    expect(getTreeIndex(reordered.tasks).children(null)).toEqual(['b', 'a']);
  });
});

describe('the tree inside a transaction', () => {
  it('places many added tasks correctly, mixed with explicit positions and moves', () => {
    const project = createProject({ tasks: [{ id: 'p', children: [{ id: 'x' }] }, { id: 'q' }] });
    project.transact((tx) => {
      for (let i = 0; i < 5; i++) tx.tasks.add({ id: `p${String(i)}` }, { parentId: 'p' });
      tx.tasks.add({ id: 'first' }, { parentId: 'p', index: 0 });
      tx.tasks.add({ id: 'mid' }, { parentId: 'p', index: 3 });
      tx.tasks.add({ id: 'deep' }, { parentId: 'p2' });
      tx.tasks.move('q', { parentId: 'p', index: 1 });
      tx.tasks.add({ id: 'root' });
      expect(tx.tasks.children('p')).toEqual(['first', 'q', 'x', 'p0', 'mid', 'p1', 'p2', 'p3', 'p4']);
    });
    const tree = getTreeIndex(project.getState().tasks);
    expect(tree.children('p')).toEqual(['first', 'q', 'x', 'p0', 'mid', 'p1', 'p2', 'p3', 'p4']);
    expect(tree.children('p2')).toEqual(['deep']);
    expect(tree.flatten()).toEqual([
      'p',
      'first',
      'q',
      'x',
      'p0',
      'mid',
      'p1',
      'p2',
      'deep',
      'p3',
      'p4',
      'root',
    ]);
  });

  it('clamps out-of-range positions and rejects ones that are not numbers, keeping tree and order in step', () => {
    const project = createProject({ tasks: [{ id: 'p', children: [{ id: 'a' }, { id: 'b' }] }] });
    for (const index of [Number.NaN, 'x', {}]) {
      expect(() =>
        project.transact((tx) => {
          tx.tasks.add({ id: 'n' }, { parentId: 'p', index: index as number });
        }),
      ).toThrow(QuartzioError);
    }
    project.transact((tx) => {
      tx.tasks.add({ id: 'last' }, { parentId: 'p', index: Number.POSITIVE_INFINITY });
      tx.tasks.add({ id: 'first' }, { parentId: 'p', index: -1 });
      tx.tasks.add({ id: 'second' }, { parentId: 'p', index: 1.7 });
      expect(tx.tasks.children('p')).toEqual(['first', 'second', 'a', 'b', 'last']);
    });
    expect(getTreeIndex(project.getState().tasks).children('p')).toEqual([
      'first',
      'second',
      'a',
      'b',
      'last',
    ]);
  });

  it('stays in step after a failed add inside the transaction, and after add then remove', () => {
    const project = createProject({ tasks: [{ id: 'p', children: [{ id: 'a' }, { id: 'b' }] }] });
    project.transact((tx) => {
      expect(() => tx.tasks.add({ id: 'a' }, { parentId: 'p' })).toThrow(QuartzioError);
      tx.tasks.add({ id: 'm' }, { parentId: 'p', index: 1 });
      tx.tasks.add({ id: 'gone' }, { parentId: 'p', index: 0 });
      tx.tasks.remove('gone');
      tx.tasks.add({ id: 'z' }, { parentId: 'p', index: 2 });
      expect(tx.tasks.children('p')).toEqual(['a', 'm', 'z', 'b']);
    });
    expect(getTreeIndex(project.getState().tasks).flatten()).toEqual(['p', 'a', 'm', 'z', 'b']);
  });

  it('builds a correct index after undoing a structural change', () => {
    const project = createProject({ tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const before = getTreeIndex(project.getState().tasks);
    const patch = project.transact((tx) => {
      tx.tasks.move('c', { index: 0 });
    });
    project.apply((patch as NonNullable<typeof patch>).inverse);
    const undone = getTreeIndex(project.getState().tasks);
    expect(undone.flatten()).toEqual(before.flatten());
    expect(['a', 'b', 'c'].map((id) => undone.position(id))).toEqual([0, 1, 2]);
  });

  it('returns a snapshot from children(), not a list that changes with later adds', () => {
    const project = createProject({ tasks: [{ id: 'p' }] });
    project.transact((tx) => {
      const before = tx.tasks.children(null);
      tx.tasks.add({ id: 'r' });
      expect(before).toEqual(['p']);
    });
  });
});
