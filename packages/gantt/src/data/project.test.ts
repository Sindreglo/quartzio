import { describe, expect, it, vi } from 'vitest';
import { QuartzioError } from '../util/errors';
import { createProject } from './project';
import { toProjectData } from './serialize';
import { getTreeIndex } from './tree';
import type { Transaction } from './transaction';
import type { Operation, ProjectInput, ProjectState } from './types';

const input: ProjectInput = {
  tasks: [
    { id: 'a', name: 'A', children: [{ id: 'a1', name: 'A1' }, { id: 'a2' }] },
    { id: 'b', name: 'B' },
  ],
  dependencies: [{ id: 'd1', from: 'a1', to: 'b' }],
};

const rows = (state: ProjectState): string[] => {
  const tree = getTreeIndex(state.tasks);
  return tree.flatten().map((id) => `${'  '.repeat(tree.depth(id))}${String(id)}`);
};

describe('createProject', () => {
  describe('transact', () => {
    it('adds tasks at a position under a parent', () => {
      const project = createProject(input);
      project.transact((tx) => {
        tx.tasks.add({ id: 'a0' }, { parentId: 'a', index: 0 });
        tx.tasks.add({ id: 'a3' }, { parentId: 'a' });
        tx.tasks.add({ id: 'c' });
        tx.tasks.add({ id: 'b1' }, { parentId: 'b' });
      });
      expect(rows(project.getState())).toEqual(['a', '  a0', '  a1', '  a2', '  a3', 'b', '  b1', 'c']);
    });

    it('normalizes added tasks and generates ids when omitted', () => {
      const project = createProject();
      let created: unknown;
      project.transact((tx) => {
        created = tx.tasks.add({ name: 'New', startDate: new Date(Date.UTC(2026, 0, 5)) });
      });
      expect(created).toMatchObject({ id: 'task-1', name: 'New', startDate: Date.UTC(2026, 0, 5) });
    });

    it('lets reads inside a transaction see earlier writes', () => {
      const project = createProject(input);
      project.transact((tx) => {
        tx.tasks.update('a', { name: 'Renamed' });
        expect(tx.tasks.get('a')?.name).toBe('Renamed');
        tx.tasks.add({ id: 'x' }, { parentId: 'b' });
        expect(tx.tasks.children('b')).toEqual(['x']);
      });
    });

    it('records only fields that actually change', () => {
      const project = createProject(input);
      const patch = project.transact((tx) => {
        tx.tasks.update('a', { name: 'A', percentDone: 50 });
      });
      expect(patch?.operations).toEqual([
        { type: 'update', store: 'tasks', id: 'a', changes: { percentDone: 50 } },
      ]);
      expect(patch?.inverse).toEqual([
        { type: 'update', store: 'tasks', id: 'a', changes: { percentDone: 0 } },
      ]);
    });

    it('returns null and emits nothing when nothing changes', () => {
      const project = createProject(input);
      const listener = vi.fn();
      project.subscribe(listener);
      const before = project.getState();

      expect(
        project.transact((tx) => {
          tx.tasks.update('a', { name: 'A' });
        }),
      ).toBeNull();
      expect(project.getState()).toBe(before);
      expect(listener).not.toHaveBeenCalled();
    });

    it('emits exactly one change per transaction', () => {
      const project = createProject(input);
      const listener = vi.fn();
      project.subscribe(listener);

      const patch = project.transact((tx) => {
        tx.tasks.add({ id: 'x' });
        tx.tasks.add({ id: 'y' });
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ state: project.getState(), patch });
    });

    it('keeps untouched tables identical', () => {
      const project = createProject(input);
      const before = project.getState();
      project.transact((tx) => {
        tx.tasks.update('a', { name: 'Changed' });
      });
      expect(project.getState().dependencies).toBe(before.dependencies);
      expect(project.getState().tasks).not.toBe(before.tasks);
    });

    it('is atomic: nothing changes when the transaction throws', () => {
      const project = createProject(input);
      const before = project.getState();
      expect(() =>
        project.transact((tx) => {
          tx.tasks.add({ id: 'x' });
          tx.tasks.update('missing', { name: 'Nope' });
        }),
      ).toThrow(QuartzioError);
      expect(project.getState()).toBe(before);
    });

    it('rejects nested transactions', () => {
      const project = createProject(input);
      expect(() => project.transact(() => project.transact(() => undefined))).toThrow(
        /while a transaction is running/,
      );
    });
  });

  describe('transaction lifecycle', () => {
    it('cannot be used after it has finished', () => {
      const project = createProject(input);
      let saved: Transaction | undefined;
      project.transact((tx) => {
        saved = tx;
        tx.tasks.update('a', { name: 'Changed' });
      });
      const committed = project.getState();

      expect(() => saved?.tasks.add({ id: 'late' })).toThrow(/already finished/);
      expect(() => saved?.tasks.get('a')).toThrow(/already finished/);
      expect(project.getState()).toBe(committed);
      expect(committed.tasks.byId.has('late')).toBe(false);
    });

    it('rejects async transaction functions without committing anything', () => {
      const project = createProject(input);
      const before = project.getState();

      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-misused-promises -- exactly what we guard against
        project.transact(async (tx) => {
          tx.tasks.update('a', { name: 'Async' });
          await Promise.resolve();
        }),
      ).toThrow(/synchronous/);
      expect(project.getState()).toBe(before);
    });

    it('rejects load() and apply() while a transaction runs', () => {
      const project = createProject(input);
      expect(() =>
        project.transact(() => {
          project.load({});
        }),
      ).toThrow(/while a transaction is running/);
      expect(() =>
        project.transact(() => {
          project.apply([]);
        }),
      ).toThrow(/while a transaction is running/);
    });

    it('validates requested and generated ids', () => {
      expect(() =>
        createProject().transact((tx) => {
          tx.tasks.add({ id: '' });
        }),
      ).toThrow(/id must be/);
      expect(() =>
        createProject().transact((tx) => {
          tx.tasks.add({ id: Number.NaN });
        }),
      ).toThrow(/id must be/);
      const badGenerator = createProject({}, { generateId: () => '' });
      expect(() =>
        badGenerator.transact((tx) => {
          tx.tasks.add({});
        }),
      ).toThrow(/id must be/);
    });
  });

  describe('apply', () => {
    it('rejects operations that would corrupt the tables, without changing anything', () => {
      const project = createProject(input);
      const before = project.getState();
      const bad: unknown[] = [
        { type: 'update', store: 'tasks', id: 'a', changes: { id: 'zzz' } },
        { type: 'explode', store: 'tasks', id: 'a' },
        { type: 'remove', store: 'nope', id: 'a' },
        { type: 'add', store: 'tasks', record: { name: 'no id' }, index: 0 },
        // Removing only the parent would leave its children pointing at nothing.
        { type: 'remove', store: 'tasks', id: 'a' },
        { type: 'add', store: 'dependencies', record: { id: 'd9', from: 'a', to: 'ghost' }, index: 0 },
      ];
      for (const operation of bad) {
        expect(() => project.apply([operation as Operation])).toThrow(QuartzioError);
      }
      expect(project.getState()).toBe(before);
    });

    it('inverts dependency updates and removals', () => {
      const project = createProject(input);
      const before = project.toData();
      const patch = project.transact((tx) => {
        tx.dependencies.update('d1', { type: 'SS', lag: 3 });
        tx.dependencies.remove('d1');
      });
      project.apply(patch?.inverse ?? []);
      expect(project.toData()).toEqual(before);
    });
  });

  describe('moving tasks', () => {
    it('reorders siblings', () => {
      const project = createProject(input);
      project.transact((tx) => {
        tx.tasks.move('a2', { index: 0 });
      });
      expect(rows(project.getState())).toEqual(['a', '  a2', '  a1', 'b']);
    });

    it('moves a task with its subtree to another parent', () => {
      const project = createProject(input);
      project.transact((tx) => {
        tx.tasks.move('a', { parentId: 'b' });
      });
      expect(rows(project.getState())).toEqual(['b', '  a', '    a1', '    a2']);
    });

    it('outdents a task to the root after its old parent', () => {
      const project = createProject(input);
      project.transact((tx) => {
        tx.tasks.move('a1', { parentId: null, index: 1 });
      });
      expect(rows(project.getState())).toEqual(['a', '  a2', 'a1', 'b']);
    });

    it('produces no operations when the position is unchanged', () => {
      const project = createProject(input);
      expect(
        project.transact((tx) => {
          tx.tasks.move('a2', { index: 1 });
        }),
      ).toBeNull();
    });

    it('refuses to move a task into its own subtree', () => {
      const project = createProject(input);
      expect(() =>
        project.transact((tx) => {
          tx.tasks.move('a', { parentId: 'a1' });
        }),
      ).toThrow(/own subtree/);
      expect(() =>
        project.transact((tx) => {
          tx.tasks.move('a', { parentId: 'a' });
        }),
      ).toThrow(/own subtree/);
    });
  });

  describe('removing tasks', () => {
    it('removes descendants and connected dependencies', () => {
      const project = createProject(input);
      project.transact((tx) => {
        tx.tasks.remove('a');
      });
      const data = project.toData();
      expect(data.tasks.map((task) => task.id)).toEqual(['b']);
      expect(data.dependencies).toEqual([]);
    });

    it('can be undone with the inverse operations', () => {
      const project = createProject(input);
      const before = toProjectData(project.getState());
      const patch = project.transact((tx) => {
        tx.tasks.remove('a');
      });
      project.apply(patch?.inverse ?? []);
      expect(project.toData()).toEqual(before);
    });
  });

  describe('dependencies', () => {
    it('adds, updates and removes dependencies', () => {
      const project = createProject(input);
      project.transact((tx) => {
        tx.dependencies.add({ id: 'd2', from: 'a2', to: 'b', type: 'SS', lag: 2 });
        tx.dependencies.update('d1', { lag: 1, lagUnit: 'hour' });
      });
      expect(project.getState().dependencies.byId.get('d2')).toMatchObject({ type: 'SS', lag: 2 });
      expect(project.getState().dependencies.byId.get('d1')).toMatchObject({ lag: 1, lagUnit: 'hour' });

      project.transact((tx) => {
        tx.dependencies.remove('d1');
      });
      expect(project.getState().dependencies.order).toEqual(['d2']);
    });

    it('validates dependency ends', () => {
      const project = createProject(input);
      expect(() => project.transact((tx) => tx.dependencies.add({ from: 'a', to: 'nope' }))).toThrow(/"to"/);
      expect(() =>
        project.transact((tx) => {
          tx.dependencies.update('d1', { to: 'a1' });
        }),
      ).toThrow(/itself/);
    });
  });

  describe('plan', () => {
    it('computes the result without committing it', () => {
      const project = createProject(input);
      const before = project.getState();
      const planned = project.plan((tx) => tx.tasks.add({ id: 'x' }));

      expect(project.getState()).toBe(before);
      expect(planned?.state.tasks.byId.has('x')).toBe(true);

      project.apply(planned?.patch.operations ?? []);
      expect(toProjectData(project.getState())).toEqual(toProjectData(planned?.state ?? before));
    });
  });

  describe('load', () => {
    it('replaces the project and emits a change without a patch', () => {
      const project = createProject(input);
      const listener = vi.fn();
      project.subscribe(listener);

      project.load({ tasks: [{ id: 'only' }] });

      expect(project.getState().tasks.order).toEqual(['only']);
      expect(listener).toHaveBeenCalledWith({ state: project.getState(), patch: null });
    });
  });
});
