import { describe, expect, it, vi } from 'vitest';
import type { ProjectData, ProjectInput } from '../data/types';
import { createGantt, type GanttDataChange } from './createGantt';

const input: ProjectInput = {
  settings: { timeZone: 'UTC', startDate: '2026-10-05' },
  tasks: [
    { id: 'a', name: 'A', duration: 1 },
    { id: 'b', name: 'B', duration: 1 },
  ],
  dependencies: [{ id: 'ab', from: 'a', to: 'b' }],
};
const rename = (g: ReturnType<typeof createGantt>, name: string) =>
  g.transact((tx) => {
    tx.tasks.update('a', { name });
  });
const nameOf = (g: ReturnType<typeof createGantt>) => g.getState().project.tasks.byId.get('a')?.name;

describe('undo and redo (uncontrolled)', () => {
  it('has nothing to undo at first, not even the initial scheduling', () => {
    const g = createGantt({ defaultData: input });
    expect(g.getState().history).toEqual({ canUndo: false, canRedo: false });
    expect(g.undo()).toBe(false);
  });

  it('undoes and redoes each change exactly, scheduling included', () => {
    const g = createGantt({ defaultData: input });
    const start = g.getState().project;
    g.transact((tx) => {
      tx.tasks.update('a', { duration: 3 }); // pushes b
    });
    const after = g.getState().project;
    expect(g.getState().history).toEqual({ canUndo: true, canRedo: false });
    expect(g.undo()).toBe(true);
    expect(g.getState().project.tasks.byId.get('b')).toEqual(start.tasks.byId.get('b'));
    expect(g.getState().history).toEqual({ canUndo: false, canRedo: true });
    expect(g.redo()).toBe(true);
    expect(g.getState().project.tasks.byId.get('b')).toEqual(after.tasks.byId.get('b'));
  });

  it('steps back through several changes, and a new change drops what was undone', () => {
    const g = createGantt({ defaultData: input });
    rename(g, 'one');
    rename(g, 'two');
    rename(g, 'three');
    g.undo();
    g.undo();
    expect(nameOf(g)).toBe('one');
    rename(g, 'other');
    expect(g.getState().history.canRedo).toBe(false);
    g.undo();
    expect(nameOf(g)).toBe('one');
  });

  it('reports undo and redo like any change', () => {
    const onChange = vi.fn();
    const g = createGantt({ defaultData: input, onChange });
    rename(g, 'one');
    g.undo();
    const change = onChange.mock.calls.at(-1)?.[0] as GanttDataChange;
    expect(change.data.tasks.find((t) => t.id === 'a')?.name).toBe('A');
  });

  it('keeps the last 100 steps', () => {
    const g = createGantt({ defaultData: input });
    for (let i = 0; i < 105; i++) rename(g, `n${String(i)}`);
    let steps = 0;
    while (g.undo()) steps++;
    expect(steps).toBe(100);
    expect(nameOf(g)).toBe('n4');
  });

  it('can be turned off', () => {
    const g = createGantt({ defaultData: input, undoRedo: false });
    rename(g, 'one');
    expect(g.getState().history.canUndo).toBe(false);
    expect(g.undo()).toBe(false);
    g.setOptions({ undoRedo: true });
    rename(g, 'two');
    expect(g.undo()).toBe(true);
    expect(nameOf(g)).toBe('one');
  });

  it('drops a drag when an undo changes the dragged task', () => {
    const g = createGantt({ defaultData: input });
    g.setViewport({ width: 800, height: 400 });
    g.transact((tx) => {
      tx.tasks.update('a', { name: 'x' });
    });
    const bar = g.getState().rows.items[0]?.bar;
    if (!bar) throw new Error('no bar');
    const y = g.getState().rows.items[0]?.y ?? 0;
    g.pointerDown({ x: bar.x + 5, y: y + 10 });
    g.pointerMove({ x: bar.x + 100, y: y + 10 });
    expect(g.getState().interaction).not.toBeNull();
    g.undo();
    expect(g.getState().interaction).toBeNull();
    expect(nameOf(g)).toBe('A');
  });

  it('rejects a non-boolean option', () => {
    expect(() => createGantt({ undoRedo: 'yes' as unknown as boolean })).toThrow(/undoRedo/);
  });

  it('does nothing after destroy', () => {
    const g = createGantt({ defaultData: input });
    rename(g, 'one');
    g.destroy();
    expect(g.undo()).toBe(false);
  });
});

describe('undo and redo (controlled)', () => {
  const controlled = () => {
    let data: ProjectInput | ProjectData = input;
    const onChange = vi.fn((change: GanttDataChange) => {
      data = change.data;
    });
    const g = createGantt({ data: input, onChange });
    const passBack = () => {
      g.setOptions({ data });
    };
    return { g, onChange, passBack };
  };

  it('counts a change once the app passes the data back', () => {
    const { g, passBack } = controlled();
    rename(g, 'one');
    expect(g.getState().history.canUndo).toBe(false);
    passBack();
    expect(g.getState().history.canUndo).toBe(true);
  });

  it('reports the undo, and shows it once the data comes back', () => {
    const { g, onChange, passBack } = controlled();
    rename(g, 'one');
    passBack();
    expect(g.undo()).toBe(true);
    expect(nameOf(g)).toBe('one'); // controlled: not until the data comes back
    expect((onChange.mock.calls.at(-1)?.[0] as GanttDataChange).data.tasks[0]?.name).toBe('A');
    passBack();
    expect(nameOf(g)).toBe('A');
    expect(g.getState().history).toEqual({ canUndo: false, canRedo: true });
    g.redo();
    passBack();
    expect(nameOf(g)).toBe('one');
  });

  it('refuses to undo while a change in the same run still waits for the app', () => {
    const { g, passBack } = controlled();
    rename(g, 'one');
    passBack();
    rename(g, 'two');
    passBack();
    expect(g.undo()).toBe(true);
    expect(g.undo()).toBe(false); // the first undo isn't in the history yet
    passBack();
    expect(nameOf(g)).toBe('one');
    expect(g.undo()).toBe(true);
    passBack();
    expect(nameOf(g)).toBe('A');
  });

  it('keeps the step when the app rejects the undo', async () => {
    const { g, passBack } = controlled();
    rename(g, 'one');
    passBack();
    g.undo(); // not passed back
    await Promise.resolve();
    expect(g.getState().history).toEqual({ canUndo: true, canRedo: false });
    g.undo();
    passBack();
    expect(nameOf(g)).toBe('A');
  });

  it('does not record the scheduling of loaded data', () => {
    const { g, passBack } = controlled();
    g.setOptions({ data: { ...input, tasks: [...(input.tasks ?? []), { id: 'c', duration: 1 }] } });
    passBack(); // nothing reported: stays the same data
    expect(g.getState().history.canUndo).toBe(false);
  });

  it('forgets the history when the app passes other data', () => {
    const { g, passBack } = controlled();
    rename(g, 'one');
    passBack();
    g.setOptions({ data: { ...input, tasks: [{ id: 'a', name: 'Elsewhere' }, { id: 'b' }] } });
    expect(g.getState().history).toEqual({ canUndo: false, canRedo: false });
  });
});
