import { describe, expect, it, vi } from 'vitest';
import type { ProjectData, ProjectInput } from '../data/types';
import { createGantt, type GanttDataChange, type GanttOptions } from './createGantt';
import type { MenuContext, MenuItem } from './menu';

// Rows: p (c1, c2), a, b, ms. Rows are 36 px.
const input: ProjectInput = {
  settings: { timeZone: 'UTC', startDate: '2026-10-05' },
  tasks: [
    {
      id: 'p',
      name: 'Parent',
      children: [
        { id: 'c1', name: 'C1', duration: 1 },
        { id: 'c2', name: 'C2', duration: 1 },
      ],
    },
    { id: 'a', name: 'A', duration: 2 },
    { id: 'b', name: 'B', duration: 1 },
    { id: 'ms', name: 'Milestone', duration: 0 },
  ],
  dependencies: [{ id: 'ab', from: 'a', to: 'b' }],
};
const make = (extra: GanttOptions = {}) => {
  const g = createGantt({ rowHeight: 36, defaultData: input, locale: 'en-US', ...extra });
  g.setViewport({ width: 800, height: 400 });
  return g;
};
type G = ReturnType<typeof make>;
const menu = (g: G) => g.getState().menu;
const ids = (items: readonly { id: string }[] | undefined) => items?.map((item) => item.id);
const item = (g: G, id: string) => {
  const all = menu(g)?.items.flatMap((entry) => [entry, ...(entry.items ?? [])]);
  return all?.find((entry) => entry.id === id);
};
const order = (g: G, parentId: string | null) => {
  const tasks = g.getState().project.tasks;
  return tasks.order.filter((id) => (tasks.byId.get(id)?.parentId ?? null) === parentId);
};
const task = (g: G, id: string) => g.getState().project.tasks.byId.get(id);
/** Opens the task menu on a task and picks an item. */
const pick = (g: G, id: string, action: string) => {
  g.openMenu({ kind: 'task', id }, { x: 10, y: 10 });
  g.menuAction(action);
};

describe('the task menu', () => {
  it('opens at the point with the built-in items', () => {
    const g = make();
    expect(g.openMenu({ kind: 'task', id: 'a' }, { x: 100, y: 200 })).toBe(true);
    expect(menu(g)).toMatchObject({ kind: 'task', taskId: 'a', x: 100, y: 200, active: null, submenu: null });
    expect(ids(menu(g)?.items)).toEqual(['edit', 'add', 'indent', 'outdent', 'convertToMilestone', 'delete']);
    expect(ids(item(g, 'add')?.items)).toEqual([
      'addTaskAbove',
      'addTaskBelow',
      'addSubtask',
      'addMilestone',
      'addSuccessor',
      'addPredecessor',
    ]);
    expect(item(g, 'indent')?.separator).toBe(true);
    expect(item(g, 'delete')?.separator).toBe(true);
  });

  it('selects the task when it is not selected, and keeps a selection that includes it', () => {
    const g = make();
    g.select(['b']);
    g.openMenu({ kind: 'task', id: 'a' }, { x: 0, y: 0 });
    expect(g.getState().selection).toEqual(['a']);
    g.select(['a', 'b']);
    g.openMenu({ kind: 'task', id: 'b' }, { x: 0, y: 0 });
    expect(g.getState().selection).toEqual(['a', 'b']);
  });

  it('disables what cannot be done', () => {
    const g = make();
    g.openMenu({ kind: 'task', id: 'p' }, { x: 0, y: 0 });
    expect(item(g, 'indent')?.disabled).toBe(true); // first root: no sibling before it
    expect(item(g, 'outdent')?.disabled).toBe(true); // already at the root
    expect(item(g, 'convertToMilestone')?.disabled).toBe(true); // a parent
    g.openMenu({ kind: 'task', id: 'c2' }, { x: 0, y: 0 });
    expect(item(g, 'indent')?.disabled).toBe(false);
    expect(item(g, 'outdent')?.disabled).toBe(false);
    g.openMenu({ kind: 'task', id: 'ms' }, { x: 0, y: 0 });
    expect(item(g, 'convertToMilestone')?.disabled).toBe(true);
  });

  it('refuses unknown tasks, and can be turned off', () => {
    const g = make({ taskMenu: false });
    expect(g.openMenu({ kind: 'task', id: 'a' }, { x: 0, y: 0 })).toBe(false);
    g.setOptions({ taskMenu: true });
    expect(g.openMenu({ kind: 'task', id: 'nope' }, { x: 0, y: 0 })).toBe(false);
    expect(g.openMenu(null as unknown as { kind: 'timeAxis' })).toBe(false);
    expect(menu(g)).toBeNull();
  });

  it('opens with the ContextMenu key or Shift+F10 at the active row', () => {
    const g = make();
    g.rowClick('a'); // row 3
    expect(g.keyDown({ key: 'ContextMenu' })).toBe(true);
    const header = g.getState().header.height;
    expect(menu(g)).toMatchObject({ kind: 'task', taskId: 'a', y: header + 4 * 36 });
    g.closeMenu();
    expect(g.keyDown({ key: 'F10', shift: true })).toBe(true);
    expect(menu(g)?.taskId).toBe('a');
    expect(menu(g)?.active).toBe('edit'); // opened by keyboard: the first item is active
  });

  it('closes on scrolling, when its task goes, and after an action', () => {
    const g = make();
    g.openMenu({ kind: 'task', id: 'b' }, { x: 0, y: 0 });
    g.setViewport({ scrollTop: 5 });
    expect(menu(g)).toBeNull();
    g.openMenu({ kind: 'task', id: 'b' }, { x: 0, y: 0 });
    g.transact((tx) => {
      tx.tasks.remove('b');
    });
    expect(menu(g)).toBeNull();
    pick(g, 'a', 'convertToMilestone');
    expect(menu(g)).toBeNull();
  });
});

describe('the keyboard in a menu', () => {
  it('moves over the enabled items, into and out of the submenu, and picks with Enter', () => {
    const g = make();
    g.openMenu({ kind: 'task', id: 'p' }, { x: 0, y: 0 });
    g.menuKeyDown({ key: 'ArrowDown' });
    expect(menu(g)?.active).toBe('edit');
    g.menuKeyDown({ key: 'ArrowDown' });
    expect(menu(g)?.active).toBe('add');
    g.menuKeyDown({ key: 'ArrowDown' }); // indent, outdent and convert are disabled for p
    expect(menu(g)?.active).toBe('delete');
    g.menuKeyDown({ key: 'ArrowDown' }); // wraps
    expect(menu(g)?.active).toBe('edit');
    g.menuKeyDown({ key: 'End' });
    expect(menu(g)?.active).toBe('delete');
    g.menuKeyDown({ key: 'ArrowUp' });
    g.menuKeyDown({ key: 'ArrowRight' });
    expect(menu(g)).toMatchObject({ submenu: 'add', active: 'addTaskAbove' });
    g.menuKeyDown({ key: 'ArrowLeft' });
    expect(menu(g)).toMatchObject({ submenu: null, active: 'add' });
    g.menuKeyDown({ key: 'ArrowRight' });
    g.menuKeyDown({ key: 'ArrowDown' });
    expect(g.menuKeyDown({ key: 'Enter' })).toBe(true);
    expect(menu(g)).toBeNull();
    expect(order(g, null)).toEqual(['p', expect.any(String), 'a', 'b', 'ms']); // a task below p
  });

  it('closes the submenu, then the menu, with Escape; Tab closes it', () => {
    const g = make();
    g.openMenu({ kind: 'task', id: 'a' }, { x: 0, y: 0 });
    g.menuHover('add');
    expect(menu(g)?.submenu).toBe('add');
    g.menuKeyDown({ key: 'Escape' });
    expect(menu(g)?.submenu).toBeNull();
    g.menuKeyDown({ key: 'Escape' });
    expect(menu(g)).toBeNull();
    g.openMenu({ kind: 'task', id: 'a' }, { x: 0, y: 0 });
    g.menuKeyDown({ key: 'Tab' });
    expect(menu(g)).toBeNull();
    expect(g.menuKeyDown({ key: 'ArrowDown' })).toBe(false); // nothing open
  });

  it('ignores disabled and unknown items', () => {
    const g = make();
    g.openMenu({ kind: 'task', id: 'p' }, { x: 0, y: 0 });
    g.menuAction('indent');
    g.menuAction('nope');
    g.menuHover('nope');
    expect(order(g, null)).toEqual(['p', 'a', 'b', 'ms']);
  });
});

describe('what the task menu does', () => {
  it('adds a task below, selects it and opens its name, as one undoable change', () => {
    const g = make();
    pick(g, 'a', 'addTaskBelow');
    const added = order(g, null)[2] as string;
    expect(order(g, null)).toEqual(['p', 'a', added, 'b', 'ms']);
    expect(task(g, added)).toMatchObject({ name: 'New task', duration: 1 });
    expect(g.getState().selection).toEqual([added]);
    expect(g.getState().editing).toMatchObject({ taskId: added, columnId: 'name' });

    g.cancelEdit();
    g.undo();
    expect(order(g, null)).toEqual(['p', 'a', 'b', 'ms']);
  });

  it('scrolls to a new task out of view', () => {
    const g = make();
    g.setViewport({ height: 100 }); // rows 0-2 show
    pick(g, 'b', 'addTaskBelow'); // row 5
    expect(g.getState().scrollTo).toEqual({ top: 6 * 36 - 100 });
  });

  it('adds above, a subtask, a milestone, a successor and a predecessor', () => {
    const g = make();
    pick(g, 'a', 'addTaskAbove');
    expect(order(g, null)[1]).not.toBe('a');
    pick(g, 'a', 'addSubtask');
    const sub = order(g, 'a')[0] as string;
    expect(task(g, sub)?.parentId).toBe('a');
    pick(g, 'b', 'addMilestone');
    const milestone = order(g, null)[order(g, null).indexOf('b') + 1] as string;
    expect(task(g, milestone)?.duration).toBe(0);
    pick(g, 'b', 'addSuccessor');
    const successor = order(g, null)[order(g, null).indexOf('b') + 1] as string;
    const deps = () => [...g.getState().project.dependencies.byId.values()];
    expect(deps()).toContainEqual(expect.objectContaining({ from: 'b', to: successor, type: 'FS' }));
    pick(g, 'b', 'addPredecessor');
    const predecessor = order(g, null)[order(g, null).indexOf('b') - 1] as string;
    expect(deps()).toContainEqual(expect.objectContaining({ from: predecessor, to: 'b', type: 'FS' }));
  });

  it('uses createTaskId, and changes nothing when the id is taken', () => {
    const g = make({ createTaskId: () => 'mine' });
    pick(g, 'a', 'addTaskBelow');
    expect(task(g, 'mine')?.name).toBe('New task');
    g.cancelEdit();
    pick(g, 'a', 'addTaskBelow'); // 'mine' again
    expect(order(g, null).filter((id) => id === 'mine')).toHaveLength(1);
    expect(() => make({ createTaskId: 'x' as unknown as () => string })).toThrow(/createTaskId/);
  });

  it('selects and opens the new task once the data comes back in controlled mode', () => {
    let data: ProjectInput | ProjectData = input;
    const g = createGantt({
      rowHeight: 36,
      data: input,
      onChange: (change: GanttDataChange) => {
        data = change.data;
      },
    });
    pick(g, 'a', 'addTaskBelow');
    expect(g.getState().editing).toBeNull();
    g.setOptions({ data });
    const added = order(g, null)[2] as string;
    expect(g.getState().selection).toEqual([added]);
    expect(g.getState().editing?.taskId).toBe(added);
  });

  it('indents under the previous sibling and outdents after the parent, for the whole selection', () => {
    const g = make();
    g.select(['a', 'b']);
    pick(g, 'b', 'indent');
    expect(order(g, 'p')).toEqual(['c1', 'c2', 'a', 'b']);
    pick(g, 'c2', 'outdent'); // only c2: it wasn't selected
    expect(order(g, null)).toEqual(['p', 'c2', 'ms']);
    expect(order(g, 'p')).toEqual(['c1', 'a', 'b']);
    g.undo();
    expect(order(g, 'p')).toEqual(['c1', 'c2', 'a', 'b']);
  });

  it('indents under a task it is linked to, dropping the link (a parent and its child cannot be linked)', () => {
    const g = make();
    pick(g, 'b', 'indent'); // a → b, and a is the sibling before b
    expect(task(g, 'b')?.parentId).toBe('a');
    expect(g.getState().project.dependencies.byId.has('ab')).toBe(false);
    g.undo();
    expect(g.getState().project.dependencies.byId.has('ab')).toBe(true);
  });

  it('expands a collapsed parent that gets a new child', () => {
    const g = make();
    g.toggle('p');
    pick(g, 'p', 'addSubtask');
    const sub = order(g, 'p')[2] as string;
    expect(g.getState().rows.items.some((row) => row.id === sub)).toBe(true);
    expect(g.getState().editing?.taskId).toBe(sub);
  });

  it('forgets a new task the app did not take', () => {
    let data: ProjectInput | ProjectData = input;
    const g = createGantt({
      rowHeight: 36,
      data: input,
      onChange: (change: GanttDataChange) => {
        data = change.data;
      },
    });
    pick(g, 'a', 'addTaskBelow');
    const rejected = data;
    g.setOptions({ data: { ...input } }); // other data: the add was rejected
    g.setOptions({ data: rejected }); // it comes later anyway, say from a server
    expect(g.getState().editing).toBeNull();
  });

  it('cancels a press when the menu opens during it (Ctrl-click on macOS)', () => {
    const g = make({ preset: 'weekAndDay', startDate: '2026-10-05', endDate: '2026-11-02' });
    const bar = g.getState().rows.items[3]?.bar;
    const point = { x: (bar?.x ?? 0) + 5, y: 3 * 36 + 18 };
    g.pointerDown(point, { ctrl: true });
    g.openMenu({ kind: 'task', id: 'a' }, { x: 0, y: 0 });
    g.pointerMove({ x: point.x + 50, y: point.y });
    g.pointerUp({ x: point.x + 50, y: point.y });
    expect(g.getState().selection).toEqual(['a']);
    expect(task(g, 'a')?.constraintType ?? null).toBeNull(); // not dragged
  });

  it('converts to a milestone, and deletes the selection', () => {
    const g = make();
    pick(g, 'a', 'convertToMilestone');
    expect(task(g, 'a')?.duration).toBe(0);
    g.select(['a', 'b']);
    pick(g, 'b', 'delete');
    expect(order(g, null)).toEqual(['p', 'ms']);
  });

  it('opens the task editor with Edit', () => {
    const g = make();
    pick(g, 'a', 'edit');
    expect(g.getState().taskEditor?.taskId).toBe('a');
  });

  it('can have items added, removed and replaced', () => {
    const action = vi.fn();
    const g = make({
      taskMenuItems: (items: readonly MenuItem[], context) => [
        ...items.filter((entry) => entry.id !== 'delete'),
        { id: 'mine', label: `Log ${String(context.task?.id)}`, separator: true, action },
      ],
    });
    g.openMenu({ kind: 'task', id: 'a' }, { x: 0, y: 0 });
    expect(ids(menu(g)?.items)?.slice(-2)).toEqual(['convertToMilestone', 'mine']);
    expect(item(g, 'mine')?.label).toBe('Log a');
    g.menuAction('mine');
    expect((action.mock.lastCall?.[0] as MenuContext | undefined)?.task?.id).toBe('a');
    expect(menu(g)).toBeNull();
  });

  it('shows the built-in items when the customizer throws or returns nonsense', () => {
    const g = make({
      taskMenuItems: () => {
        throw new Error('bug');
      },
    });
    g.openMenu({ kind: 'task', id: 'a' }, { x: 0, y: 0 });
    expect(ids(menu(g)?.items)).toContain('edit');
    for (const items of [
      'nope',
      [{ id: 'x', label: 'X', action: 'no' }],
      [
        { id: 'x', label: 'X' },
        { id: 'x', label: 'Again' },
      ],
      [{ id: 'x', label: 'X', items: [{ id: 'y', label: 'Y', items: [{ id: 'z', label: 'Z' }] }] }],
    ]) {
      g.setOptions({ taskMenuItems: () => items as unknown as MenuItem[] });
      g.openMenu({ kind: 'task', id: 'a' }, { x: 0, y: 0 });
      expect(ids(menu(g)?.items)).toContain('edit');
    }
    g.setOptions({ taskMenuItems: () => [] });
    expect(g.openMenu({ kind: 'task', id: 'a' }, { x: 0, y: 0 })).toBe(false); // nothing to show
  });

  it('closes the submenu and clears the highlight on hovering a disabled item', () => {
    const g = make();
    g.openMenu({ kind: 'task', id: 'p' }, { x: 0, y: 0 });
    g.menuHover('add');
    g.menuHover('addSubtask');
    g.menuHover('indent'); // disabled for p
    expect(menu(g)).toMatchObject({ submenu: null, active: null });
  });
});

describe('the time axis menu and zoom', () => {
  it('offers zooming in and out and the presets, with the current one checked', () => {
    const g = make({ preset: 'weekAndDay' });
    expect(g.openMenu({ kind: 'timeAxis' }, { x: 5, y: 5 })).toBe(true);
    expect(ids(menu(g)?.items)?.slice(0, 2)).toEqual(['zoomIn', 'zoomOut']);
    expect(item(g, 'preset:weekAndDay')?.checked).toBe(true);
    expect(item(g, 'preset:hourAndDay')?.checked).toBe(false);
    g.menuAction('zoomIn');
    expect(g.getState().timeAxis.preset.id).toBe('dayAndWeek');
    g.openMenu({ kind: 'timeAxis' }, { x: 5, y: 5 });
    g.menuAction('preset:monthAndYear');
    expect(g.getState().timeAxis.preset.id).toBe('monthAndYear');
  });

  it('zooms one step, and stops at the ends', () => {
    const g = make({ preset: 'hourAndDay' });
    expect(g.zoom('in')).toBe(false);
    g.openMenu({ kind: 'timeAxis' }, { x: 5, y: 5 });
    expect(item(g, 'zoomIn')?.disabled).toBe(true);
    expect(g.zoom('out')).toBe(true);
    expect(g.getState().timeAxis.preset.id).toBe('dayAndWeek');
    expect(g.zoom('manyYears')).toBe(true);
    expect(g.zoom('out')).toBe(false);
    expect(g.zoom('nope')).toBe(false);
  });

  it('keeps the time in the middle of the view where it was', () => {
    const g = make({ preset: 'weekAndDay', startDate: '2026-09-01', endDate: '2026-12-31' });
    g.setViewport({ scrollLeft: 640 });
    const middle = g.getState().timeAxis.xToDate(640 + 400);
    g.zoom('in');
    const scrollTo = g.getState().scrollTo;
    expect(scrollTo?.left).toBeDefined();
    const axis = g.getState().timeAxis;
    expect(Math.abs(axis.xToDate((scrollTo?.left ?? 0) + 400) - middle)).toBeLessThan(
      axis.tickWidth > 0 ? 3600_000 : 0,
    );
  });

  it('keeps the zoom while the preset option stays the same, and reports it', () => {
    const onPresetChange = vi.fn();
    const g = make({ preset: 'weekAndDay', onPresetChange });
    g.zoom('out');
    expect(onPresetChange).toHaveBeenCalledWith('weekAndMonth');
    g.setOptions({ preset: 'weekAndDay' }); // the same prop on the next render
    expect(g.getState().timeAxis.preset.id).toBe('weekAndMonth');
    g.setOptions({ preset: 'hourAndDay' }); // a new value: it wins
    expect(g.getState().timeAxis.preset.id).toBe('hourAndDay');
  });

  it('zooms from a custom preset to the nearest built-in one', () => {
    const custom = {
      id: 'twoDays',
      tickUnit: 'day',
      tickIncrement: 2,
      tickWidth: 40,
      timeResolution: { unit: 'day', increment: 1 },
      headers: [{ unit: 'day', increment: 2, format: 'weekdayDay' }],
    } as const;
    // 20 px a day: between weekAndDay (32) and weekAndMonth (8 a day).
    const g = make({ preset: custom });
    g.zoom('in');
    expect(g.getState().timeAxis.preset.id).toBe('weekAndDay');
    g.setOptions({ preset: { ...custom } }); // equal by value: still zoomed
    expect(g.getState().timeAxis.preset.id).toBe('weekAndDay');
    g.setOptions({ preset: { ...custom, tickWidth: 41 } });
    g.zoom('out');
    expect(g.getState().timeAxis.preset.id).toBe('weekAndMonth');
  });

  it('does nothing after destroy', () => {
    const g = make();
    g.destroy();
    expect(g.openMenu({ kind: 'timeAxis' }, { x: 0, y: 0 })).toBe(false);
    expect(g.zoom('in')).toBe(false);
  });
});
