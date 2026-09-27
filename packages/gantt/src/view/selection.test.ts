import { describe, expect, it, vi } from 'vitest';
import type { Id, ProjectData, ProjectInput } from '../data/types';
import { createGantt, type GanttDataChange, type GanttOptions } from './createGantt';

// Rows: p, c1, c2, a, b, 1, "1" (ids 1 and "1" are different tasks). Rows are 36 px.
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
    { id: 1, duration: 1 },
    { id: '1', duration: 1 },
  ],
  dependencies: [{ id: 'ab', from: 'a', to: 'b' }],
};
const make = (extra: GanttOptions = {}) => {
  const onSelectionChange = vi.fn();
  const g = createGantt({ rowHeight: 36, defaultData: input, onSelectionChange, ...extra });
  g.setViewport({ width: 800, height: 400 });
  return { g, onSelectionChange };
};
type G = ReturnType<typeof make>['g'];
const selected = (g: G) => g.getState().selection;
const rowFlags = (g: G) =>
  g.getState().rows.items.map((row) => `${String(row.id)}${row.selected ? '*' : ''}${row.active ? '>' : ''}`);
const rowY = (index: number) => index * 36 + 18;

describe('selection', () => {
  it('starts empty', () => {
    const { g } = make();
    expect(selected(g)).toEqual([]);
    expect(g.getState().activeId).toBeNull();
    expect(rowFlags(g)).toEqual(['p', 'c1', 'c2', 'a', 'b', '1', '1']);
  });

  it('selects a clicked row, and marks it on the rows', () => {
    const { g, onSelectionChange } = make();
    g.rowClick('a');
    expect(selected(g)).toEqual(['a']);
    expect(g.getState().activeId).toBe('a');
    expect(rowFlags(g)).toEqual(['p', 'c1', 'c2', 'a*>', 'b', '1', '1']);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
    g.rowClick('b');
    expect(selected(g)).toEqual(['b']);
  });

  it('toggles with Ctrl or Cmd', () => {
    const { g } = make();
    g.rowClick('a');
    g.rowClick('b', { ctrl: true });
    g.rowClick('c1', { meta: true });
    expect(selected(g)).toEqual(['a', 'b', 'c1']);
    g.rowClick('b', { meta: true });
    expect(selected(g)).toEqual(['a', 'c1']);
    expect(g.getState().activeId).toBe('b'); // the cursor stays where the click was
  });

  it('selects a range with Shift, in row order, from the anchor', () => {
    const { g } = make();
    g.rowClick('b');
    g.rowClick('c1', { shift: true });
    expect(selected(g)).toEqual(['c1', 'c2', 'a', 'b']);
    g.rowClick('1', { shift: true }); // same anchor
    expect(selected(g)).toEqual(['b', 1, '1']);
    expect(g.getState().activeId).toBe('1');
  });

  it('adds a range with Shift and Ctrl', () => {
    const { g } = make();
    g.rowClick('p');
    g.rowClick('a', { ctrl: true });
    g.rowClick(1, { ctrl: true, shift: true });
    expect(selected(g)).toEqual(['p', 'a', 'b', 1]);
  });

  it('selects just the row with Shift when there is no anchor', () => {
    const { g } = make();
    g.rowClick('b', { shift: true });
    expect(selected(g)).toEqual(['b']);
  });

  it('skips rows hidden by a collapsed parent in a range', () => {
    const { g } = make();
    g.toggle('p');
    g.rowClick('p');
    g.rowClick('b', { shift: true });
    expect(selected(g)).toEqual(['p', 'a', 'b']);
  });

  it('keeps hidden tasks selected when their parent collapses', () => {
    const { g } = make();
    g.rowClick('c1');
    g.toggle('p');
    expect(selected(g)).toEqual(['c1']);
    g.toggle('p');
    expect(rowFlags(g)[1]).toBe('c1*'); // the cursor moved to p when it collapsed
  });

  it('selects one at a time without multiSelect', () => {
    const { g } = make({ multiSelect: false });
    g.rowClick('a');
    g.rowClick('b', { ctrl: true });
    expect(selected(g)).toEqual(['b']);
    g.rowClick('b', { ctrl: true });
    expect(selected(g)).toEqual([]);
    g.rowClick('a');
    g.rowClick(1, { shift: true });
    expect(selected(g)).toEqual([1]);
    g.select(['a', 'b']);
    expect(selected(g)).toEqual(['b']);
  });

  it('keeps one when multiSelect is turned off', () => {
    const { g, onSelectionChange } = make();
    g.select(['a', 'b']);
    g.setOptions({ multiSelect: false });
    expect(selected(g)).toEqual(['b']);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['b']);
  });

  it('selects ids from the app, ignoring unknown ids and duplicates', () => {
    const { g, onSelectionChange } = make();
    g.select(['b', 'nope', 'a', 'b', 1]);
    expect(selected(g)).toEqual(['b', 'a', 1]);
    expect(g.getState().activeId).toBe(1);
    onSelectionChange.mockClear();
    const before = g.getState();
    g.select(['b', 'a', 1]);
    expect(g.getState()).toBe(before);
    expect(onSelectionChange).not.toHaveBeenCalled();
    g.clearSelection();
    expect(selected(g)).toEqual([]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('ignores clicks on unknown or hidden rows, and bad input', () => {
    const { g, onSelectionChange } = make();
    g.toggle('p');
    g.rowClick('nope');
    g.rowClick('c1');
    g.rowClick(null as unknown as Id);
    g.select(null as unknown as Id[]);
    g.select([Number.NaN, undefined as unknown as Id]);
    expect(selected(g)).toEqual([]);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('drops deleted tasks from the selection', () => {
    const { g, onSelectionChange } = make();
    g.select(['a', 'c1', 'b']);
    g.transact((tx) => {
      tx.tasks.remove('p');
      tx.tasks.remove('b');
    });
    expect(selected(g)).toEqual(['a']);
    expect(g.getState().activeId).toBeNull();
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
  });

  it('reports a deletion once, after the change is reported and recorded', () => {
    const calls: string[] = [];
    const { g, onSelectionChange } = make({ onChange: () => calls.push('change') });
    onSelectionChange.mockImplementation(() => {
      calls.push(`selection ${String(g.getState().history.canUndo)}`);
    });
    g.select(['a']);
    calls.length = 0;
    g.keyDown({ key: 'Delete' });
    expect(calls).toEqual(['change', 'selection true']);
  });

  it('keeps a change recorded when onSelectionChange throws', () => {
    const { g, onSelectionChange } = make();
    const onChange = vi.fn();
    g.setOptions({ onChange });
    g.select(['a']);
    onSelectionChange.mockImplementation(() => {
      throw new Error('app bug');
    });
    expect(() => g.keyDown({ key: 'Delete' })).toThrow('app bug');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(g.getState().history.canUndo).toBe(true);
  });

  it('accepts missing modifiers', () => {
    const { g } = make();
    g.rowClick('a', null as unknown as undefined);
    expect(selected(g)).toEqual(['a']);
    g.pointerDown({ x: 700, y: rowY(4) }, null as unknown as undefined);
    g.pointerUp({ x: 700, y: rowY(4) });
    expect(selected(g)).toEqual(['b']);
  });

  it('moves the cursor to the parent when collapsing hides it', () => {
    const { g } = make();
    g.rowClick('c2');
    g.toggle('p');
    expect(g.getState().activeId).toBe('p');
    expect(rowFlags(g)[0]).toBe('p>');
    g.toggle('p');
    g.rowClick('c1');
    g.collapseAll();
    expect(g.getState().activeId).toBe('p');
    expect(selected(g)).toEqual(['c1']); // still selected, just hidden
  });

  it('keeps unaffected rows when the selection changes', () => {
    const { g } = make();
    const before = g.getState().rows.items;
    g.rowClick('a');
    const after = g.getState().rows.items;
    expect(after[0]).toBe(before[0]);
    expect(after[3]).not.toBe(before[3]);
  });

  it('is the same array while unchanged', () => {
    const { g } = make();
    g.rowClick('a');
    const ids = selected(g);
    g.setViewport({ scrollLeft: 10 });
    g.transact((tx) => {
      tx.tasks.update('b', { name: 'B' });
    });
    expect(selected(g)).toBe(ids);
  });

  it('rejects a bad option', () => {
    expect(() => createGantt({ multiSelect: 1 as unknown as boolean })).toThrow(/multiSelect/);
    expect(() => createGantt({ onSelectionChange: 1 as unknown as () => void })).toThrow(/onSelectionChange/);
  });

  it('does nothing after destroy', () => {
    const { g, onSelectionChange } = make();
    g.destroy();
    g.rowClick('a');
    g.select(['a']);
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});

describe('selection (controlled)', () => {
  it('drops deleted tasks once the data comes back, and unknown ones in other data', () => {
    let data: ProjectInput | ProjectData = input;
    const onSelectionChange = vi.fn();
    const g = createGantt({
      rowHeight: 36,
      data: input,
      onSelectionChange,
      onChange: (change: GanttDataChange) => {
        data = change.data;
      },
    });
    g.select(['a', 'b']);
    g.transact((tx) => {
      tx.tasks.remove('b');
    });
    expect(selected(g)).toEqual(['a', 'b']);
    g.setOptions({ data });
    expect(selected(g)).toEqual(['a']);
    g.setOptions({ data: { tasks: [{ id: 'x' }] } });
    expect(selected(g)).toEqual([]);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });
});

describe('clicking in the timeline', () => {
  it('selects the row of a click, on a bar or beside it', () => {
    const { g } = make();
    expect(g.pointerDown({ x: 700, y: rowY(3) })).toBe(true); // pressed a row: capture it
    g.pointerUp({ x: 701, y: rowY(3) });
    expect(selected(g)).toEqual(['a']);
    g.pointerDown({ x: 700, y: rowY(4) }, { ctrl: true });
    g.pointerUp({ x: 700, y: rowY(4) });
    expect(selected(g)).toEqual(['a', 'b']);
  });

  it('does not select after a drag', () => {
    const { g } = make();
    const bar = g.getState().rows.items[3]?.bar;
    if (!bar) throw new Error('no bar');
    g.pointerDown({ x: bar.x + 2, y: rowY(3) });
    g.pointerMove({ x: bar.x + 60, y: rowY(3) });
    g.pointerUp({ x: bar.x + 60, y: rowY(3) });
    expect(selected(g)).toEqual([]);
    // Nor after moving away and back, beside the bars.
    g.pointerDown({ x: 700, y: rowY(4) });
    g.pointerMove({ x: 750, y: rowY(4) });
    g.pointerUp({ x: 700, y: rowY(4) });
    expect(selected(g)).toEqual([]);
  });

  it('clears the selection on a click below the rows, and ignores a cancelled press', () => {
    const { g } = make();
    g.rowClick('a');
    g.pointerDown({ x: 10, y: rowY(3) });
    g.cancelInteraction();
    g.pointerUp({ x: 10, y: rowY(3) });
    expect(selected(g)).toEqual(['a']);
    expect(g.pointerDown({ x: 10, y: rowY(20) })).toBe(true);
    g.pointerUp({ x: 10, y: rowY(20) });
    expect(selected(g)).toEqual([]);
  });
});
