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

  describe('settings and calendars', () => {
    it('updates settings and calendars in a transaction and can undo it', () => {
      const project = createProject(input);
      const before = project.toData();
      const patch = project.transact((tx) => {
        tx.calendars.add({ id: 'four-day', week: { monday: [{ start: '08:00', end: '18:00' }] } });
        tx.settings.update({ calendarId: 'four-day', timeZone: 'Europe/Oslo', hoursPerDay: 10 });
      });
      expect(project.getState().settings).toMatchObject({ calendarId: 'four-day', hoursPerDay: 10 });

      project.apply(patch?.inverse ?? []);
      expect(project.toData()).toEqual(before);
    });

    it('parses date strings in the time zone set earlier in the same transaction', () => {
      const project = createProject(input);
      project.transact((tx) => {
        tx.settings.update({ timeZone: 'America/New_York' });
        tx.tasks.update('a', { startDate: '2026-10-05T08:00' });
      });
      expect(project.getState().tasks.byId.get('a')?.startDate).toBe(Date.UTC(2026, 9, 5, 12));
    });

    it('refuses to remove the project calendar or point at a missing one', () => {
      const project = createProject({ calendars: [{ id: 'c' }], settings: { calendarId: 'c' } });
      expect(() =>
        project.transact((tx) => {
          tx.calendars.remove('c');
        }),
      ).toThrow(/project calendar/);
      expect(() =>
        project.transact((tx) => {
          tx.settings.update({ calendarId: 'x' });
        }),
      ).toThrow(/does not exist/);
    });
  });

  describe('validation at the end of a transaction', () => {
    it('allows end before start in between, as long as it is fixed before the transaction ends', () => {
      const project = createProject({
        tasks: [{ id: 1, startDate: Date.UTC(2026, 0, 5), endDate: Date.UTC(2026, 0, 6) }],
      });
      project.transact((tx) => {
        tx.tasks.update(1, { startDate: Date.UTC(2026, 0, 10) });
        tx.tasks.update(1, { endDate: Date.UTC(2026, 0, 11) });
      });
      expect(() =>
        project.transact((tx) => {
          tx.tasks.update(1, { endDate: Date.UTC(2026, 0, 1) });
        }),
      ).toThrow(/before "startDate"/);
    });

    it('rejects structure passed as fields', () => {
      const project = createProject(input);
      const withChildren = { name: 'x', children: [{ id: 'c' }] };
      expect(() =>
        project.transact((tx) => {
          tx.tasks.add(withChildren);
        }),
      ).toThrow(/"children"/);
      expect(() =>
        project.transact((tx) => {
          tx.tasks.update('a', { parentId: 'b' } as never);
        }),
      ).toThrow(/move/);
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

    it('validates records and settings that come in through operations', () => {
      const project = createProject({ calendars: [{ id: 'c' }] });
      const before = project.getState();
      const bad: unknown[] = [
        { type: 'add', store: 'calendars', record: { id: 'x', name: 'No week', exceptions: [] }, index: 0 },
        {
          type: 'update',
          store: 'calendars',
          id: 'c',
          changes: {
            week: { ...before.calendars.byId.get('c')?.week, monday: [{ start: '16:00', end: '08:00' }] },
          },
        },
        { type: 'update', store: 'tasks', id: 'nope', changes: {} },
        { type: 'settings', changes: { toString: 'x' } },
        { type: 'settings', changes: { timeZone: undefined } },
        { type: 'settings', changes: { hoursPerDay: -1 } },
        { type: 'settings', changes: null },
      ];
      for (const operation of bad) {
        expect(() => project.apply([operation as Operation])).toThrow(QuartzioError);
      }
      expect(project.getState()).toBe(before);

      const withTask = createProject({ tasks: [{ id: 1 }] });
      expect(() =>
        withTask.apply([{ type: 'update', store: 'tasks', id: 1, changes: { percentDone: 500 } }]),
      ).toThrow(/percentDone/);
      expect(() =>
        withTask.apply([
          { type: 'update', store: 'tasks', id: 1, changes: { startDate: '2026-01-05' as never } },
        ]),
      ).toThrow(/not a valid, normalized record/);
    });

    it('does not report a change when a calendar is updated with equal content', () => {
      const project = createProject({ calendars: [{ id: 'c' }] });
      const week = project.getState().calendars.byId.get('c')?.week;
      expect(
        project.transact((tx) => {
          tx.calendars.update('c', { week: { ...week } });
        }),
      ).toBeNull();
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
      // Without the dependency a1 → b, which would make a1 depend on its new grandparent (a cycle).
      const project = createProject({ ...input, dependencies: [] });
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

describe('propagate', () => {
  // A stand-in for the scheduler: names are upper case. Idempotent, like the real one must be.
  const upperCase = (state: ProjectState): Operation[] =>
    [...state.tasks.byId.values()]
      .filter((task) => task.name !== task.name.toUpperCase())
      .map((task) => ({
        type: 'update',
        store: 'tasks',
        id: task.id,
        changes: { name: task.name.toUpperCase() },
      }));
  const names = (state: ProjectState) => [...state.tasks.byId.values()].map((task) => task.name);

  it('completes the initial data and every load, and returns what it changed', () => {
    const project = createProject({ tasks: [{ id: 1, name: 'a' }] }, { propagate: upperCase });
    expect(names(project.getState())).toEqual(['A']);
    const patch = project.load({
      tasks: [
        { id: 1, name: 'b' },
        { id: 2, name: 'C' },
      ],
    });
    expect(names(project.getState())).toEqual(['B', 'C']);
    expect(patch?.operations).toEqual([{ type: 'update', store: 'tasks', id: 1, changes: { name: 'B' } }]);
    expect(project.load({ tasks: [{ id: 1, name: 'D' }] })).toBeNull();
  });

  it('adds its operations to the same transaction, and the inverse undoes both', () => {
    const project = createProject({ tasks: [{ id: 1, name: 'A' }] }, { propagate: upperCase });
    const listener = vi.fn();
    project.subscribe(listener);
    const before = project.toData();
    const patch = project.transact((tx) => {
      tx.tasks.add({ id: 2, name: 'b' });
    });
    expect(names(project.getState())).toEqual(['A', 'B']);
    expect(patch?.operations).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(1);
    project.apply(patch?.inverse ?? []);
    expect(project.toData()).toEqual(before);
  });

  it('completes planned changes and raw operations too', () => {
    const project = createProject({ tasks: [{ id: 1, name: 'A' }] }, { propagate: upperCase });
    const planned = project.plan((tx) => {
      tx.tasks.update(1, { name: 'x' });
    });
    expect(planned?.state.tasks.byId.get(1)?.name).toBe('X');
    const patch = project.apply([{ type: 'update', store: 'tasks', id: 1, changes: { name: 'y' } }]);
    expect(names(project.getState())).toEqual(['Y']);
    expect(patch?.operations).toHaveLength(2);
  });

  it('passes what changed, or null for a load', () => {
    const propagate = vi.fn((): Operation[] => []);
    const project = createProject({ tasks: [{ id: 1 }] }, { propagate });
    expect(propagate).toHaveBeenLastCalledWith(expect.anything(), null);
    project.transact((tx) => {
      tx.tasks.update(1, { name: 'n' });
    });
    expect(propagate).toHaveBeenLastCalledWith(expect.anything(), [
      { type: 'update', store: 'tasks', id: 1, changes: { name: 'n' } },
    ]);
  });

  it('changes nothing when it throws', () => {
    const project = createProject(
      { tasks: [{ id: 1 }] },
      {
        propagate: (_, operations) => {
          if (operations) throw new QuartzioError('broken');
          return [];
        },
      },
    );
    const state = project.getState();
    expect(() =>
      project.transact((tx) => {
        tx.tasks.update(1, { name: 'n' });
      }),
    ).toThrow('broken');
    expect(project.getState()).toBe(state);
  });
});
