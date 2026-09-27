import { describe, expect, it, vi } from 'vitest';
import type { ProjectData, ProjectInput } from '../data/types';
import { createGantt, type GanttDataChange, type GanttOptions } from './createGantt';
import type { KeyInput } from './keyboard';

// Rows: p, c1, c2, a, b, then t0…t29. Rows are 36 px; the viewport shows 11 of them.
const input: ProjectInput = {
  settings: { timeZone: 'UTC', startDate: '2026-10-05' },
  tasks: [
    {
      id: 'p',
      children: [
        { id: 'c1', duration: 1 },
        { id: 'c2', duration: 1 },
      ],
    },
    { id: 'a', duration: 1 },
    { id: 'b', duration: 2 },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `t${String(i)}`, duration: 1 })),
  ],
  dependencies: [{ id: 'ab', from: 'a', to: 'b' }],
};
const make = (extra: GanttOptions = {}) => {
  const g = createGantt({ rowHeight: 36, defaultData: input, ...extra });
  g.setViewport({ width: 800, height: 400 });
  return g;
};
type G = ReturnType<typeof make>;
const press = (g: G, key: string, modifiers: Omit<KeyInput, 'key'> = {}) => g.keyDown({ key, ...modifiers });
const selected = (g: G) => g.getState().selection;
const active = (g: G) => g.getState().activeId;

describe('moving with the keyboard', () => {
  it('starts at the first row, and moves up and down', () => {
    const g = make();
    expect(press(g, 'ArrowDown')).toBe(true);
    expect(selected(g)).toEqual(['p']);
    press(g, 'ArrowDown');
    press(g, 'ArrowDown');
    expect(selected(g)).toEqual(['c2']);
    expect(active(g)).toBe('c2');
    press(g, 'ArrowUp');
    expect(selected(g)).toEqual(['c1']);
  });

  it('stays at the edges (still handled, so the page does not scroll)', () => {
    const g = make();
    press(g, 'Home');
    expect(press(g, 'ArrowUp')).toBe(true);
    expect(active(g)).toBe('p');
    press(g, 'End');
    expect(active(g)).toBe('t29');
    expect(press(g, 'ArrowDown')).toBe(true);
    expect(active(g)).toBe('t29');
  });

  it('pages by the rows that fit', () => {
    const g = make();
    press(g, 'Home');
    press(g, 'PageDown');
    expect(active(g)).toBe('t6'); // row 11
    press(g, 'PageUp');
    expect(active(g)).toBe('p');
  });

  it('extends the selection from the anchor with Shift', () => {
    const g = make();
    g.rowClick('a');
    press(g, 'ArrowDown', { shift: true });
    press(g, 'ArrowDown', { shift: true });
    expect(selected(g)).toEqual(['a', 'b', 't0']);
    press(g, 'ArrowUp', { shift: true });
    expect(selected(g)).toEqual(['a', 'b']);
    press(g, 'Home', { shift: true });
    expect(selected(g)).toEqual(['p', 'c1', 'c2', 'a']);
  });

  it('moves only the cursor with Ctrl or Cmd, and Space toggles', () => {
    const g = make();
    g.rowClick('a');
    press(g, 'ArrowDown', { ctrl: true });
    press(g, 'ArrowDown', { meta: true });
    expect(selected(g)).toEqual(['a']);
    expect(active(g)).toBe('t0');
    press(g, ' ');
    expect(selected(g)).toEqual(['a', 't0']);
    press(g, ' ');
    expect(selected(g)).toEqual(['a']);
  });

  it('expands and collapses with Right and Left, or moves into and out of a parent', () => {
    const g = make();
    press(g, 'Home');
    press(g, 'ArrowLeft');
    expect(g.getState().rows.count).toBe(33); // p collapsed
    press(g, 'ArrowRight');
    expect(g.getState().rows.count).toBe(35);
    press(g, 'ArrowRight');
    expect(active(g)).toBe('c1');
    expect(press(g, 'ArrowRight')).toBe(false); // a leaf
    press(g, 'ArrowLeft');
    expect(active(g)).toBe('p');
    press(g, 'End');
    expect(press(g, 'ArrowLeft')).toBe(false); // a root leaf
  });

  it('moves on from the parent when the active task was hidden by collapsing it', () => {
    const g = make();
    g.rowClick('c2');
    g.toggle('p');
    press(g, 'ArrowDown');
    expect(active(g)).toBe('a');
  });

  it('selects all rows with Ctrl or Cmd + A, and clears with Escape', () => {
    const g = make();
    g.toggle('p');
    expect(press(g, 'a', { meta: true })).toBe(true);
    expect(selected(g)).toHaveLength(33);
    expect(press(g, 'Escape')).toBe(true);
    expect(selected(g)).toEqual([]);
    expect(press(g, 'Escape')).toBe(false); // nothing to clear: let it through
  });

  it('selects one at a time without multiSelect', () => {
    const g = make({ multiSelect: false });
    g.rowClick('a');
    press(g, 'ArrowDown', { shift: true });
    expect(selected(g)).toEqual(['b']);
    expect(press(g, 'A', { ctrl: true })).toBe(false);
  });

  it('leaves other keys alone', () => {
    const g = make();
    g.rowClick('a');
    for (const key of ['x', 'Tab', '', 'F3']) expect(press(g, key)).toBe(false);
    expect(press(g, 'ArrowDown', { alt: true })).toBe(false);
    expect(g.keyDown(null as unknown as KeyInput)).toBe(false);
    expect(g.keyDown({ key: 5 } as unknown as KeyInput)).toBe(false);
    expect(selected(g)).toEqual(['a']);
  });

  it('does nothing on an empty chart or after destroy', () => {
    const empty = createGantt({ rowHeight: 36, defaultData: {} });
    expect(empty.keyDown({ key: 'ArrowDown' })).toBe(false);
    expect(empty.keyDown({ key: 'a', ctrl: true })).toBe(false);
    const g = make();
    g.destroy();
    expect(press(g, 'ArrowDown')).toBe(false);
  });
});

describe('deleting with the keyboard', () => {
  it('deletes the selected tasks with their subtrees and dependencies, as one undoable change', () => {
    const g = make();
    g.select(['p', 'c1', 'a']); // c1 goes with p
    expect(press(g, 'Delete')).toBe(true);
    const { tasks, dependencies } = g.getState().project;
    expect(tasks.byId.has('p') || tasks.byId.has('c2') || tasks.byId.has('a')).toBe(false);
    expect(dependencies.byId.size).toBe(0);
    expect(selected(g)).toEqual([]);
    expect(active(g)).toBe('b'); // the row that took the place of the active one
    g.undo();
    expect(g.getState().project.tasks.byId.size).toBe(35);
    expect(g.getState().project.dependencies.byId.size).toBe(1);
  });

  it('does not delete selected tasks hidden in a collapsed parent', () => {
    const g = make();
    g.select(['c1', 'a']);
    g.toggle('p');
    press(g, 'Delete');
    expect(g.getState().project.tasks.byId.has('c1')).toBe(true);
    expect(g.getState().project.tasks.byId.has('a')).toBe(false);
  });

  it('moves the cursor up when the last rows are deleted', () => {
    const g = make();
    g.select(['t28', 't29']);
    press(g, 'Backspace', { meta: true });
    expect(active(g)).toBe('t27');
  });

  it('does nothing without a selection, or with deleteKey off', () => {
    const g = make({ deleteKey: false });
    press(g, 'Home');
    expect(press(g, 'Delete')).toBe(false);
    g.setOptions({ deleteKey: true });
    g.clearSelection();
    expect(press(g, 'Delete')).toBe(false);
    expect(g.getState().project.tasks.byId.size).toBe(35);
  });

  it('only reports the deletion in controlled mode', () => {
    let data: ProjectInput | ProjectData = input;
    const onChange = vi.fn((change: GanttDataChange) => {
      data = change.data;
    });
    const g = createGantt({ rowHeight: 36, data: input, onChange });
    g.select(['a']);
    press(g, 'Delete');
    expect(g.getState().project.tasks.byId.has('a')).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    g.setOptions({ data });
    expect(g.getState().project.tasks.byId.has('a')).toBe(false);
  });
});

describe('undo shortcuts', () => {
  const edited = (extra: GanttOptions = {}) => {
    const g = make(extra);
    g.transact((tx) => {
      tx.tasks.update('a', { name: 'x' });
    });
    return g;
  };
  const name = (g: G) => g.getState().project.tasks.byId.get('a')?.name;

  it('undoes with Ctrl/Cmd+Z and redoes with Shift+Ctrl/Cmd+Z or Ctrl+Y', () => {
    const g = edited();
    expect(press(g, 'z', { meta: true })).toBe(true);
    expect(name(g)).toBe('');
    expect(press(g, 'Z', { meta: true, shift: true })).toBe(true);
    expect(name(g)).toBe('x');
    press(g, 'z', { ctrl: true });
    expect(press(g, 'y', { ctrl: true })).toBe(true);
    expect(name(g)).toBe('x');
    expect(press(g, 'y', { ctrl: true })).toBe(false); // nothing to redo
  });

  it('knows the shortcuts by their physical key on other keyboard layouts', () => {
    const g = edited();
    expect(press(g, 'я', { ctrl: true, code: 'KeyZ' })).toBe(true);
    expect(name(g)).toBe('');
    expect(press(g, 'ф', { ctrl: true, code: 'KeyA' })).toBe(true);
    expect(selected(g)).toHaveLength(35);
  });

  it('leaves the shortcuts alone with undoRedo off', () => {
    const g = edited({ undoRedo: false });
    expect(press(g, 'z', { ctrl: true })).toBe(false);
    expect(name(g)).toBe('x');
  });
});

describe('revealing a row', () => {
  it('gives the scroll position that shows a row, or null when it shows', () => {
    const g = make();
    expect(g.revealTop('a')).toBeNull();
    expect(g.revealTop('t20')).toBe(25 * 36 + 36 - 400);
    g.setViewport({ scrollTop: 600 });
    expect(g.revealTop('p')).toBe(0);
    expect(g.revealTop('nope')).toBeNull();
    g.toggle('p');
    expect(g.revealTop('c1')).toBeNull(); // hidden
  });
});
