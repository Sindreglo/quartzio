import { describe, expect, it } from 'vitest';
import { QuartzioError } from '../util/errors';
import { createProjectState } from './normalize';
import { createProject } from './project';

const JAN_5 = Date.UTC(2026, 0, 5);

describe('createProjectState', () => {
  it('creates an empty project by default', () => {
    const state = createProjectState();
    expect(state.tasks.order).toEqual([]);
    expect(state.dependencies.order).toEqual([]);
  });

  it('fills in defaults so every field is present', () => {
    const state = createProjectState({ tasks: [{ id: 1 }] });
    expect(state.tasks.byId.get(1)).toEqual({
      id: 1,
      parentId: null,
      name: '',
      startDate: null,
      endDate: null,
      duration: null,
      durationUnit: 'day',
      percentDone: 0,
      manuallyScheduled: false,
      constraintType: null,
      constraintDate: null,
    });
  });

  it('accepts a "start no earlier than" constraint, set together with its date', () => {
    const state = createProjectState({
      settings: { timeZone: 'UTC' },
      tasks: [{ id: 1, constraintType: 'startnoearlierthan', constraintDate: '2026-01-05' }],
    });
    expect(state.tasks.byId.get(1)).toMatchObject({
      constraintType: 'startnoearlierthan',
      constraintDate: JAN_5,
    });
  });

  it('checks constraints in transactions and raw operations too', () => {
    const project = createProject({ tasks: [{ id: 1 }] });
    expect(() =>
      project.transact((tx) => {
        tx.tasks.add({ id: 2, constraintType: 'startnoearlierthan' });
      }),
    ).toThrow(/together/);
    project.transact((tx) => {
      tx.tasks.update(1, { constraintType: 'startnoearlierthan', constraintDate: JAN_5 });
    });
    expect(() =>
      project.transact((tx) => {
        tx.tasks.update(1, { constraintDate: null });
      }),
    ).toThrow(/together/);
    expect(() =>
      project.apply([{ type: 'update', store: 'tasks', id: 1, changes: { constraintType: null } }]),
    ).toThrow(/together/);
  });

  it.each([
    [{ constraintType: 'sometime', constraintDate: JAN_5 }, /constraintType/],
    [{ constraintType: 'muststarton', constraintDate: JAN_5 }, /not supported yet/],
    [{ constraintType: 'startnoearlierthan' }, /together/],
    [{ constraintDate: JAN_5 }, /together/],
  ])('rejects the constraint %j', (fields, message) => {
    expect(() => createProjectState({ tasks: [{ id: 1, ...(fields as object) }] })).toThrow(message);
  });

  it('accepts manuallyScheduled as a boolean only', () => {
    expect(
      createProjectState({ tasks: [{ id: 1, manuallyScheduled: true }] }).tasks.byId.get(1),
    ).toMatchObject({
      manuallyScheduled: true,
    });
    for (const value of ['yes', 1, null]) {
      expect(() => createProjectState({ tasks: [{ id: 1, manuallyScheduled: value as never }] })).toThrow(
        /manuallyScheduled/,
      );
    }
  });

  it('converts Date values to epoch milliseconds', () => {
    const state = createProjectState({ tasks: [{ id: 'a', startDate: new Date(JAN_5), endDate: JAN_5 }] });
    expect(state.tasks.byId.get('a')).toMatchObject({ startDate: JAN_5, endDate: JAN_5 });
  });

  it('flattens nested children depth-first and sets their parentId', () => {
    const state = createProjectState({
      tasks: [
        { id: 'p', children: [{ id: 'c1', children: [{ id: 'g' }] }, { id: 'c2' }] },
        { id: 'q', parentId: null },
      ],
    });
    expect(state.tasks.order).toEqual(['p', 'c1', 'g', 'c2', 'q']);
    expect(state.tasks.byId.get('g')?.parentId).toBe('c1');
    expect(state.tasks.byId.get('c2')?.parentId).toBe('p');
  });

  it('accepts flat tasks with parentId, in any order', () => {
    const state = createProjectState({ tasks: [{ id: 'child', parentId: 'parent' }, { id: 'parent' }] });
    expect(state.tasks.byId.get('child')?.parentId).toBe('parent');
  });

  it('normalizes dependencies with defaults', () => {
    const state = createProjectState({
      tasks: [{ id: 1 }, { id: 2 }],
      dependencies: [{ id: 'd', from: 1, to: 2 }],
    });
    expect(state.dependencies.byId.get('d')).toEqual({
      id: 'd',
      from: 1,
      to: 2,
      type: 'FS',
      lag: 0,
      lagUnit: 'day',
    });
  });

  it.each([
    ['duplicate task ids', { tasks: [{ id: 1 }, { id: 1 }] }, /defined more than once/],
    ['a missing parent', { tasks: [{ id: 1, parentId: 99 }] }, /does not exist/],
    [
      'a parent cycle',
      {
        tasks: [
          { id: 1, parentId: 2 },
          { id: 2, parentId: 1 },
        ],
      },
      /parent cycle/,
    ],
    [
      'conflicting nesting and parentId',
      { tasks: [{ id: 1, children: [{ id: 2, parentId: 3 }] }] },
      /nested/,
    ],
    ['an invalid date', { tasks: [{ id: 1, startDate: new Date(Number.NaN) }] }, /startDate/],
    ['a negative duration', { tasks: [{ id: 1, duration: -1 }] }, /duration/],
    ['percentDone above 100', { tasks: [{ id: 1, percentDone: 120 }] }, /percentDone/],
    ['an empty id', { tasks: [{ id: '' }] }, /id must be/],
    [
      'a dependency to a missing task',
      { tasks: [{ id: 1 }], dependencies: [{ id: 'd', from: 1, to: 2 }] },
      /"to"/,
    ],
    ['a self-dependency', { tasks: [{ id: 1 }], dependencies: [{ id: 'd', from: 1, to: 1 }] }, /itself/],
  ])('rejects %s', (_, input, message) => {
    expect(() => createProjectState(input)).toThrow(QuartzioError);
    expect(() => createProjectState(input)).toThrow(message);
  });

  describe('settings', () => {
    it('fills in defaults', () => {
      expect(createProjectState().settings).toEqual({
        timeZone: 'local',
        calendarId: null,
        hoursPerDay: 8,
        daysPerWeek: 5,
        daysPerMonth: 20,
        weekStartsOn: 1,
        startDate: null,
      });
    });

    it('reads the project start in the project time zone, and accepts null', () => {
      const oslo = createProjectState({ settings: { timeZone: 'Europe/Oslo', startDate: '2026-01-05' } });
      expect(oslo.settings.startDate).toBe(Date.UTC(2026, 0, 4, 23));
      expect(createProjectState({ settings: { startDate: null } }).settings.startDate).toBeNull();
      expect(createProjectState({ settings: { startDate: new Date(JAN_5) } }).settings.startDate).toBe(JAN_5);
    });

    it.each([
      [{ timeZone: 'Mars/Olympus' }, /time zone/],
      [{ hoursPerDay: 0 }, /hoursPerDay/],
      [{ daysPerWeek: 8 }, /daysPerWeek/],
      [{ weekStartsOn: 7 }, /weekStartsOn/],
      [{ calendarId: 'missing' }, /does not exist/],
      [{ startDate: 'soon' }, /startDate/],
      [{ startDate: Number.NaN }, /startDate/],
      [{ startDate: Date.UTC(20_000, 0, 1) }, /startDate/],
    ])('rejects %j', (settings, message) => {
      expect(() => createProjectState({ settings })).toThrow(message);
    });
  });

  describe('date strings', () => {
    it('reads them as wall-clock time in the project time zone', () => {
      const state = createProjectState({
        settings: { timeZone: 'Europe/Oslo' },
        tasks: [{ id: 1, startDate: '2026-10-05', endDate: '2026-10-05T16:00' }],
      });
      expect(state.tasks.byId.get(1)).toMatchObject({
        startDate: Date.UTC(2026, 9, 4, 22),
        endDate: Date.UTC(2026, 9, 5, 14),
      });
    });

    it('rejects strings that are not ISO dates', () => {
      expect(() => createProjectState({ tasks: [{ id: 1, startDate: '05.10.2026' }] })).toThrow(/ISO 8601/);
    });
  });

  describe('calendars', () => {
    it('normalizes a partial week and exceptions', () => {
      const state = createProjectState({
        calendars: [
          {
            id: 'c',
            week: {
              monday: [
                { start: '12:00', end: '16:00' },
                { start: '08:00', end: '11:00' },
              ],
            },
            exceptions: [{ startDate: '2026-12-24', endDate: '2026-12-26', name: 'Christmas' }],
          },
        ],
      });
      const calendar = state.calendars.byId.get('c');
      expect(calendar?.week.monday).toEqual([
        { start: '08:00', end: '11:00' },
        { start: '12:00', end: '16:00' },
      ]);
      expect(calendar?.week.tuesday).toEqual([]);
      expect(calendar?.exceptions).toEqual([
        { startDate: '2026-12-24', endDate: '2026-12-26', name: 'Christmas', intervals: [] },
      ]);
    });

    it('uses office hours when the week is left out', () => {
      const state = createProjectState({ calendars: [{ id: 'c' }] });
      expect(state.calendars.byId.get('c')?.week.friday).toEqual([{ start: '08:00', end: '16:00' }]);
    });

    it.each([
      [{ week: { monday: [{ start: '16:00', end: '08:00' }] } }, /start" before "end/],
      [{ week: { monday: [{ start: '8:00', end: '16:00' }] } }, /HH:mm/],
      [
        {
          week: {
            monday: [
              { start: '08:00', end: '12:00' },
              { start: '11:00', end: '16:00' },
            ],
          },
        },
        /overlap/,
      ],
      [{ week: { funday: [] } }, /not a weekday/],
      [{ exceptions: [{ startDate: '2026-12-26', endDate: '2026-12-24' }] }, /before/],
      [{ exceptions: [{ startDate: '24.12.2026' }] }, /YYYY-MM-DD/],
    ])('rejects invalid calendar %#', (calendar, message) => {
      expect(() => createProjectState({ calendars: [{ id: 'c', ...calendar } as never] })).toThrow(message);
    });
  });

  it('rejects tasks that end before they start', () => {
    expect(() =>
      createProjectState({
        tasks: [{ id: 1, startDate: Date.UTC(2026, 0, 5), endDate: Date.UTC(2026, 0, 4) }],
      }),
    ).toThrow(/before "startDate"/);
  });

  it('rejects non-string names', () => {
    expect(() => createProjectState({ tasks: [{ id: 1, name: 42 as never }] })).toThrow(
      /"name" must be a string/,
    );
  });

  describe('reusing unchanged records', () => {
    const input = {
      settings: { timeZone: 'UTC' },
      calendars: [{ id: 'c' }],
      tasks: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      dependencies: [{ id: 'd', from: 1, to: 2 }],
    };

    it('keeps records and tables from the previous state when nothing changed', () => {
      const first = createProjectState(input);
      const second = createProjectState(input, first);
      expect(second.tasks).toBe(first.tasks);
      expect(second.dependencies).toBe(first.dependencies);
      expect(second.calendars).toBe(first.calendars);
      expect(second.settings).toBe(first.settings);
    });

    it('keeps unchanged records when one record changed', () => {
      const first = createProjectState(input);
      const second = createProjectState(
        {
          ...input,
          tasks: [
            { id: 1, name: 'A' },
            { id: 2, name: 'Changed' },
          ],
        },
        first,
      );
      expect(second.tasks).not.toBe(first.tasks);
      expect(second.tasks.byId.get(1)).toBe(first.tasks.byId.get(1));
      expect(second.tasks.byId.get(2)?.name).toBe('Changed');
      expect(second.dependencies).toBe(first.dependencies);
    });

    it('reuses canonical input records as they are', () => {
      const canonical = createProjectState(input);
      const task = canonical.tasks.byId.get(1);
      const again = createProjectState({
        tasks: [...canonical.tasks.byId.values()],
        settings: canonical.settings,
      });
      expect(again.tasks.byId.get(1)).toBe(task);
    });

    it('does not reuse input records with extra fields', () => {
      const withChildren = { id: 1, name: 'A', children: [] };
      const state = createProjectState({ tasks: [withChildren] });
      expect(state.tasks.byId.get(1)).not.toBe(withChildren);
      expect(state.tasks.byId.get(1)).not.toHaveProperty('children');
    });

    it('notices a changed order even when all records are the same', () => {
      const first = createProjectState(input);
      const second = createProjectState(
        { ...input, tasks: [input.tasks[1], input.tasks[0]] as never },
        first,
      );
      expect(second.tasks).not.toBe(first.tasks);
      expect(second.tasks.order).toEqual([2, 1]);
    });
  });

  describe('review regressions (4a)', () => {
    it('rejects epoch milliseconds that are not whole numbers', () => {
      expect(() => createProjectState({ tasks: [{ id: 1, startDate: JAN_5 + 0.5 }] })).toThrow(
        /whole milliseconds/,
      );
      expect(() => createProjectState({ settings: { startDate: JAN_5 + 0.25 } })).toThrow(
        /whole milliseconds/,
      );
    });

    it('rejects dates outside the years 1000–9999', () => {
      expect(() => createProjectState({ tasks: [{ id: 1, endDate: Date.UTC(20260, 0, 1) }] })).toThrow(
        /1000 and 9999/,
      );
      expect(() =>
        createProjectState({ tasks: [{ id: 1, startDate: new Date(Date.UTC(999, 0, 1)) }] }),
      ).toThrow(/1000 and 9999/);
    });

    it('rejects children that are not an array', () => {
      expect(() => createProjectState({ tasks: [{ id: 1, children: {} as never }] })).toThrow(
        /"children" must be an array/,
      );
    });
  });
});
