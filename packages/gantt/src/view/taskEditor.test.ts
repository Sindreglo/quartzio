import { describe, expect, it, vi } from 'vitest';
import type { ProjectData, ProjectInput } from '../data/types';
import { createGantt, type GanttDataChange, type GanttOptions } from './createGantt';

const day = (d: number, hour = 0) => Date.UTC(2026, 9, d, hour);
const input: ProjectInput = {
  settings: { timeZone: 'UTC', startDate: '2026-10-05' },
  tasks: [
    { id: 'p', name: 'Parent', children: [{ id: 'c', name: 'Child', duration: 1 }] },
    { id: 'a', name: 'A', duration: 2, percentDone: 10 },
    { id: 'b', name: 'B', duration: 1 },
    { id: 'm', name: 'Manual', manuallyScheduled: true, startDate: day(6, 8), endDate: day(8, 16) },
  ],
  dependencies: [{ id: 'ab', from: 'a', to: 'b', lag: 1, lagUnit: 'day' }],
};
const make = (extra: GanttOptions = {}) => {
  const g = createGantt({ defaultData: input, locale: 'en-US', ...extra });
  g.setViewport({ width: 800, height: 400 });
  return g;
};
type G = ReturnType<typeof make>;
const editor = (g: G) => g.getState().taskEditor;
const task = (g: G, id: string) => g.getState().project.tasks.byId.get(id);
const deps = (g: G) => [...g.getState().project.dependencies.byId.values()];
const input$ = (g: G, field: string, value: string | boolean) =>
  g.taskEditorAction({ type: 'input', field: field as 'name', value: value as string });
const save = (g: G) => g.taskEditorAction({ type: 'save' });

describe('opening the task editor', () => {
  it('shows the task: fields as text, its dependencies and the tasks it can link to', () => {
    const g = make();
    expect(g.openTaskEditor('b')).toBe(true);
    const state = editor(g);
    expect(state).toMatchObject({ taskId: 'b', tab: 'general', manuallyScheduled: false, error: null });
    expect(state?.fields.name).toMatchObject({ text: 'B', kind: 'text', error: null, disabled: false });
    expect(state?.fields.duration.text).toBe('1d');
    expect(state?.fields.startDate.kind).toBe('date');
    expect(state?.constraintType).toBe('none');
    expect(state?.predecessors).toEqual([
      expect.objectContaining({ taskId: 'a', type: 'FS', lag: '1d', error: null, dependencyId: 'ab' }),
    ]);
    expect(state?.successors).toEqual([]);
    expect(state?.candidates.map((candidate) => candidate.id)).toEqual(['p', 'c', 'a', 'm']);
    g.openTaskEditor('p');
    expect(editor(g)?.candidates.map((candidate) => candidate.id)).toEqual(['a', 'b', 'm']); // not its child
  });

  it('locks what a parent rolls up', () => {
    const g = make();
    g.openTaskEditor('p');
    const { fields } = editor(g) ?? {};
    expect(fields?.name.disabled).toBe(false);
    expect(
      [fields?.startDate, fields?.endDate, fields?.duration, fields?.percentDone].map((f) => f?.disabled),
    ).toEqual([true, true, true, true]);
  });

  it('opens on a double-click on a bar, and can be turned off', () => {
    const g = make({ preset: 'weekAndDay', startDate: '2026-10-05', endDate: '2026-11-02' });
    const bar = g.getState().rows.items[2]?.bar; // a
    g.doubleClick({ x: (bar?.x ?? 0) + 5, y: 2 * 36 + 18 });
    expect(editor(g)?.taskId).toBe('a');
    g.taskEditorAction({ type: 'close' });
    g.doubleClick({ x: 700, y: 2 * 36 + 18 }); // beside the bar
    expect(editor(g)).toBeNull();
    g.setOptions({ taskEdit: false });
    expect(g.openTaskEditor('a')).toBe(false);
    expect(g.openTaskEditor('nope')).toBe(false);
  });
});

describe('saving', () => {
  it('saves several fields as one undoable change, and closes', () => {
    const g = make();
    g.openTaskEditor('a');
    input$(g, 'name', 'Renamed');
    input$(g, 'duration', '3d');
    input$(g, 'percentDone', '40');
    expect(save(g)).toBe(true);
    expect(editor(g)).toBeNull();
    expect(task(g, 'a')).toMatchObject({ name: 'Renamed', duration: 3, percentDone: 40 });
    g.undo();
    expect(task(g, 'a')).toMatchObject({ name: 'A', duration: 2, percentDone: 10 });
  });

  it('shows why a field is refused, and saves nothing', () => {
    const g = make();
    g.openTaskEditor('a');
    input$(g, 'name', 'Changed');
    input$(g, 'duration', 'soon');
    expect(save(g)).toBe(false);
    expect(editor(g)?.fields.duration.error).toMatch(/duration/);
    expect(task(g, 'a')?.name).toBe('A');
    input$(g, 'duration', '2d');
    expect(editor(g)?.fields.duration.error).toBeNull(); // typing clears it
  });

  it('switches to manual scheduling with a start date in the same save', () => {
    const g = make();
    g.openTaskEditor('a');
    input$(g, 'manuallyScheduled', true);
    input$(g, 'startDate', '2026-10-14');
    save(g);
    expect(task(g, 'a')).toMatchObject({
      manuallyScheduled: true,
      startDate: day(14, 8),
      constraintType: null,
    });
  });

  it('sets and clears the constraint', () => {
    const g = make();
    g.openTaskEditor('b');
    input$(g, 'constraintType', 'startnoearlierthan');
    input$(g, 'constraintDate', '2026-10-20');
    save(g);
    expect(task(g, 'b')).toMatchObject({ constraintType: 'startnoearlierthan', constraintDate: day(20) });
    g.openTaskEditor('b');
    expect(editor(g)).toMatchObject({ constraintType: 'startnoearlierthan' });
    expect(editor(g)?.fields.constraintDate.text).toBe('2026-10-20');
    input$(g, 'constraintType', 'none');
    save(g);
    expect(task(g, 'b')).toMatchObject({ constraintType: null, constraintDate: null });
  });

  it('needs a date for the constraint', () => {
    const g = make();
    g.openTaskEditor('b');
    input$(g, 'constraintType', 'startnoearlierthan');
    expect(save(g)).toBe(false);
    expect(editor(g)?.fields.constraintDate.error).toBeTruthy();
  });

  it('saves a parent’s name', () => {
    const g = make();
    g.openTaskEditor('p');
    input$(g, 'name', 'Phase');
    expect(save(g)).toBe(true);
    expect(task(g, 'p')?.name).toBe('Phase');
  });

  it('closes without saving on close, and when nothing changed saves nothing', () => {
    const g = make();
    g.openTaskEditor('a');
    input$(g, 'name', 'Discarded');
    g.taskEditorAction({ type: 'close' });
    expect(task(g, 'a')?.name).toBe('A');
    g.openTaskEditor('a');
    expect(save(g)).toBe(true);
    expect(g.getState().history.canUndo).toBe(false);
  });

  it('only reports the save in controlled mode', () => {
    let data: ProjectInput | ProjectData = input;
    const onChange = vi.fn((change: GanttDataChange) => {
      data = change.data;
    });
    const g = createGantt({ data: input, onChange });
    g.openTaskEditor('a');
    input$(g, 'name', 'Controlled');
    save(g);
    expect(editor(g)).toBeNull();
    expect(task(g, 'a')?.name).toBe('A');
    g.setOptions({ data });
    expect(task(g, 'a')?.name).toBe('Controlled');
  });
});

describe('several dates at once', () => {
  it('reads the end against the new start, on automatic and manual tasks', () => {
    const g = make();
    g.openTaskEditor('a'); // 5–6 Oct, 2 days
    input$(g, 'startDate', '2026-10-12');
    input$(g, 'endDate', '2026-10-13');
    expect(save(g)).toBe(true);
    expect(task(g, 'a')).toMatchObject({ startDate: day(12, 8), endDate: day(13, 16), duration: 2 });
    g.openTaskEditor('m'); // 6–8 Oct
    input$(g, 'startDate', '2026-10-01');
    input$(g, 'endDate', '2026-10-02');
    expect(save(g)).toBe(true);
    expect(task(g, 'm')).toMatchObject({ startDate: day(1, 8), endDate: day(2, 16) });
  });

  it('moves with a new start and duration together', () => {
    const g = make();
    g.openTaskEditor('m');
    input$(g, 'startDate', '2026-10-13');
    input$(g, 'duration', '1d');
    save(g);
    expect(task(g, 'm')).toMatchObject({ startDate: day(13, 8), endDate: day(13, 16), duration: 1 });
  });

  it('refuses a new duration and a new end together, and a new start with a new constraint', () => {
    const g = make();
    g.openTaskEditor('a');
    input$(g, 'duration', '5d');
    input$(g, 'endDate', '2026-10-20');
    expect(save(g)).toBe(false);
    expect(editor(g)?.fields.endDate.error).toMatch(/not both/);
    g.taskEditorAction({ type: 'close' });
    g.openTaskEditor('a');
    input$(g, 'startDate', '2026-10-14');
    input$(g, 'constraintType', 'startnoearlierthan');
    input$(g, 'constraintDate', '2026-10-20');
    expect(save(g)).toBe(false);
    expect(editor(g)?.fields.constraintDate.error).toMatch(/not both/);
    expect(task(g, 'a')?.startDate).toBe(day(5, 8));
  });

  it('reads dates in the project time zone', () => {
    const g = make({
      defaultData: {
        settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-19' },
        tasks: [{ id: 'x', duration: 1 }],
      },
    });
    g.openTaskEditor('x');
    input$(g, 'constraintType', 'startnoearlierthan');
    input$(g, 'constraintDate', '2026-10-26'); // after the clocks went back: UTC+1
    save(g);
    expect(task(g, 'x')?.constraintDate).toBe(Date.UTC(2026, 9, 25, 23));
  });
});

describe('dependencies in the editor', () => {
  it('adds, changes and removes dependencies in the same save', () => {
    const g = make();
    g.openTaskEditor('b');
    g.taskEditorAction({
      type: 'updateDependency',
      side: 'predecessors',
      key: editor(g)?.predecessors[0]?.key ?? '',
      changes: { type: 'SS', lag: '-1d' },
    });
    g.taskEditorAction({ type: 'addDependency', side: 'successors' });
    const key = editor(g)?.successors[0]?.key ?? '';
    g.taskEditorAction({
      type: 'updateDependency',
      side: 'successors',
      key,
      changes: { taskId: 'm', lag: '4h' },
    });
    expect(save(g)).toBe(true);
    expect(deps(g)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'ab', type: 'SS', lag: -1, lagUnit: 'day' }),
        expect.objectContaining({ from: 'b', to: 'm', type: 'FS', lag: 4, lagUnit: 'hour' }),
      ]),
    );
    g.openTaskEditor('b');
    g.taskEditorAction({
      type: 'removeDependency',
      side: 'predecessors',
      key: editor(g)?.predecessors[0]?.key ?? '',
    });
    save(g);
    expect(deps(g).some((dependency) => dependency.id === 'ab')).toBe(false);
  });

  it('refuses a cycle, a missing task, a task twice and a bad lag, saving nothing', () => {
    const g = make();
    g.openTaskEditor('a');
    g.taskEditorAction({ type: 'addDependency', side: 'predecessors' });
    const key = editor(g)?.predecessors[0]?.key ?? '';
    expect(save(g)).toBe(false); // no task chosen
    expect(editor(g)?.predecessors[0]?.error).toMatch(/task/i);
    g.taskEditorAction({ type: 'updateDependency', side: 'predecessors', key, changes: { taskId: 'b' } });
    input$(g, 'name', 'Not saved');
    expect(save(g)).toBe(false); // b already follows a: a cycle
    expect(editor(g)?.error).toMatch(/cycle/i);
    expect(task(g, 'a')?.name).toBe('A');
    g.taskEditorAction({
      type: 'updateDependency',
      side: 'predecessors',
      key,
      changes: { taskId: 'm', lag: 'x' },
    });
    expect(save(g)).toBe(false);
    expect(editor(g)?.predecessors[0]?.error).toMatch(/lag/i);
    g.taskEditorAction({ type: 'addDependency', side: 'predecessors' });
    const second = editor(g)?.predecessors[1]?.key ?? '';
    g.taskEditorAction({ type: 'updateDependency', side: 'predecessors', key, changes: { lag: '0' } });
    g.taskEditorAction({
      type: 'updateDependency',
      side: 'predecessors',
      key: second,
      changes: { taskId: 'm' },
    });
    expect(save(g)).toBe(false);
    expect(editor(g)?.predecessors[1]?.error).toMatch(/twice/i);
  });

  it('keeps an untouched lag exactly, also in units without a short name', () => {
    const g = make({
      defaultData: {
        ...input,
        dependencies: [{ id: 'ab', from: 'a', to: 'b', lag: 1.2345, lagUnit: 'second' }],
      },
    });
    g.openTaskEditor('b');
    const key = editor(g)?.predecessors[0]?.key ?? '';
    expect(editor(g)?.predecessors[0]?.lag).toBe('1.23s');
    g.taskEditorAction({ type: 'updateDependency', side: 'predecessors', key, changes: { type: 'SS' } });
    save(g);
    expect(deps(g)[0]).toMatchObject({ type: 'SS', lag: 1.2345, lagUnit: 'second' });
  });

  it('ignores actions it cannot use', () => {
    const g = make();
    expect(g.taskEditorAction({ type: 'save' })).toBe(false); // nothing open
    g.openTaskEditor('a');
    expect(
      g.taskEditorAction({ type: 'updateDependency', side: 'predecessors', key: 'nope', changes: {} }),
    ).toBe(false);
    expect(g.taskEditorAction(null as unknown as { type: 'save' })).toBe(false);
    expect(g.taskEditorAction({ type: 'addDependency', side: 'nope' as 'predecessors' })).toBe(false);
    expect(g.taskEditorAction({ type: 'removeDependency', side: 'nope' as 'predecessors', key: 'x' })).toBe(
      false,
    );
    expect(g.taskEditorAction({ type: 'tab', tab: 'nope' as 'general' })).toBe(false);
    expect(g.taskEditorAction({ type: 'tab', tab: 'advanced' })).toBe(true);
    expect(editor(g)?.tab).toBe('advanced');
  });
});

describe('an editor on a stale basis', () => {
  it('closes when its task goes, and after destroy nothing opens', () => {
    const g = make();
    g.openTaskEditor('b');
    g.transact((tx) => {
      tx.tasks.remove('b');
    });
    expect(editor(g)).toBeNull();
    g.destroy();
    expect(g.openTaskEditor('a')).toBe(false);
  });

  it('keeps what was typed when the task changes elsewhere', () => {
    const g = make();
    g.openTaskEditor('a');
    input$(g, 'name', 'Mine');
    g.transact((tx) => {
      tx.tasks.update('a', { percentDone: 99 });
    });
    expect(editor(g)?.fields.name.text).toBe('Mine');
    expect(editor(g)?.fields.percentDone.text).toBe('99'); // untouched fields follow
  });
});
