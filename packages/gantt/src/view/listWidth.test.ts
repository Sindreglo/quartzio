import { describe, expect, it, vi } from 'vitest';
import type { ProjectInput } from '../data/types';
import { createGantt } from './createGantt';
import { MIN_LIST_WIDTH, MIN_TIMELINE_WIDTH } from './listWidth';

const input: ProjectInput = {
  settings: { timeZone: 'UTC', startDate: '2026-10-05' },
  tasks: [{ id: 'a', name: 'A', duration: 1 }],
};
// Default columns: name 240, start 120, end 120, duration 100 → 580, plus the pane's border.
const COLUMNS_MAX = 581;
const CHART = 1400;
const start = (x: number, width: number, chartWidth = CHART) =>
  ({ type: 'start', x, width, chartWidth }) as const;

const setup = (options: Parameters<typeof createGantt>[0] = {}) => {
  const onListWidthChange = vi.fn();
  const g = createGantt({ defaultData: input, onListWidthChange, ...options });
  return { g, onListWidthChange, width: () => g.getState().list.width };
};

describe('the divider between the task list and the timeline', () => {
  it('is automatic by default, bounded by the columns', () => {
    const { g } = setup();
    expect(g.getState().list).toEqual({
      width: null,
      resizing: false,
      min: MIN_LIST_WIDTH,
      max: COLUMNS_MAX,
    });
  });

  it('takes the listWidth option, and validates it before anything changes', () => {
    const { g, width } = setup({ listWidth: 300 });
    expect(width()).toBe(300);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0, '300', 1e9, true]) {
      expect(() => {
        g.setOptions({ listWidth: bad as number, rowHeight: 20 });
      }).toThrow(/listWidth/);
      expect(g.getState().rows.rowHeight).toBe(44); // nothing else changed either
    }
    g.setOptions({ listWidth: null });
    expect(width()).toBeNull();
    expect(() => createGantt({ listWidth: -1 })).toThrow(/listWidth/);
    expect(() => createGantt({ onListWidthChange: 1 as unknown as () => void })).toThrow(/onListWidthChange/);
  });

  it('follows the pointer while dragged, and reports the width once, when dropped', () => {
    const { g, onListWidthChange, width } = setup();
    expect(g.resizeList(start(500, 300))).toBe(true);
    expect(g.getState().list.resizing).toBe(true);
    g.resizeList({ type: 'move', x: 540 });
    expect(width()).toBe(340);
    g.resizeList({ type: 'move', x: 450.4 });
    expect(width()).toBe(250); // whole pixels
    expect(onListWidthChange).not.toHaveBeenCalled();
    expect(g.resizeList({ type: 'end' })).toBe(true);
    expect(g.getState().list).toMatchObject({ width: 250, resizing: false });
    expect(onListWidthChange).toHaveBeenCalledExactlyOnceWith(250);
  });

  it('stays within its bounds: the minimum, the columns, and room for the timeline', () => {
    const { g, width } = setup();
    g.resizeList(start(500, 300));
    g.resizeList({ type: 'move', x: -10_000 });
    expect(width()).toBe(MIN_LIST_WIDTH);
    g.resizeList({ type: 'move', x: 10_000 });
    expect(width()).toBe(COLUMNS_MAX);
    g.resizeList({ type: 'end' });
    g.resizeList(start(500, 300, 600)); // a narrow chart: the timeline keeps its room
    g.resizeList({ type: 'move', x: 10_000 });
    expect(width()).toBe(600 - MIN_TIMELINE_WIDTH);
    g.resizeList({ type: 'end' });
    g.resizeList(start(500, 300, 100)); // narrower than both minimums: the list's wins
    g.resizeList({ type: 'move', x: 10_000 });
    expect(width()).toBe(MIN_LIST_WIDTH);
  });

  it('leaves an automatic width automatic after a click, and reports nothing', () => {
    const { g, onListWidthChange, width } = setup();
    g.resizeList(start(500, 300));
    g.resizeList({ type: 'move', x: 500 });
    g.resizeList({ type: 'end' });
    expect(width()).toBeNull();
    expect(onListWidthChange).not.toHaveBeenCalled();
  });

  it('goes back to where it was when cancelled (Escape)', () => {
    const { g, onListWidthChange, width } = setup({ listWidth: 320 });
    g.resizeList(start(500, 320));
    g.resizeList({ type: 'move', x: 600 });
    expect(width()).toBe(420);
    expect(g.resizeList({ type: 'cancel' })).toBe(true);
    expect(g.getState().list).toMatchObject({ width: 320, resizing: false });
    expect(onListWidthChange).not.toHaveBeenCalled();
  });

  it('ignores moves, drops and cancels without a drag, and points that are not finite', () => {
    const { g, width } = setup();
    const before = g.getState();
    expect(g.resizeList({ type: 'move', x: 10 })).toBe(false);
    expect(g.resizeList({ type: 'end' })).toBe(false);
    expect(g.resizeList({ type: 'cancel' })).toBe(false);
    expect(g.resizeList(start(Number.NaN, 300))).toBe(false);
    expect(g.resizeList(start(0, 300, 0))).toBe(false);
    expect(g.resizeList(null as never)).toBe(false);
    expect(g.resizeList({ type: 'nonsense' } as never)).toBe(false);
    expect(g.getState()).toBe(before);
    g.resizeList(start(0, 300));
    g.resizeList({ type: 'move', x: Number.POSITIVE_INFINITY });
    expect(width()).toBeNull();
  });

  it('keeps the same state object for moves that change nothing', () => {
    const { g } = setup();
    g.resizeList(start(500, 300));
    g.resizeList({ type: 'move', x: -10_000 });
    const clamped = g.getState();
    g.resizeList({ type: 'move', x: -20_000 });
    expect(g.getState()).toBe(clamped);
  });

  it('moves with the arrow keys (Shift for bigger steps), Home and End, and reports each change', () => {
    const { g, onListWidthChange, width } = setup();
    const key = (k: string, current: number, shift = false) =>
      g.resizeList({ type: 'key', key: k, shift, width: current, chartWidth: CHART });
    expect(key('ArrowRight', 300)).toBe(true);
    expect(width()).toBe(310);
    key('ArrowLeft', 310, true);
    expect(width()).toBe(260);
    key('Home', 260);
    expect(width()).toBe(MIN_LIST_WIDTH);
    key('End', MIN_LIST_WIDTH);
    expect(width()).toBe(COLUMNS_MAX);
    expect(onListWidthChange.mock.calls.map(([w]) => w as number)).toEqual([
      310,
      260,
      MIN_LIST_WIDTH,
      COLUMNS_MAX,
    ]);
    expect(key('End', COLUMNS_MAX)).toBe(true); // already there: used, nothing to report
    expect(onListWidthChange).toHaveBeenCalledTimes(4);
    expect(key('ArrowUp', 300)).toBe(false);
    expect(key('Enter', 300)).toBe(false);
  });

  it('resets to automatic (double-click), once', () => {
    const { g, onListWidthChange, width } = setup({ listWidth: 300 });
    expect(g.resizeList({ type: 'reset' })).toBe(true);
    expect(width()).toBeNull();
    expect(onListWidthChange).toHaveBeenCalledExactlyOnceWith(null);
    expect(g.resizeList({ type: 'reset' })).toBe(false);
    expect(onListWidthChange).toHaveBeenCalledTimes(1);
  });

  it('keeps a dragged width while the option stays the same, and takes a new option value', () => {
    const { g, width } = setup({ listWidth: 300 });
    g.resizeList(start(0, 300));
    g.resizeList({ type: 'move', x: 50 });
    g.resizeList({ type: 'end' });
    g.setOptions({ listWidth: 300 }); // e.g. the same prop on the next render
    expect(width()).toBe(350);
    g.setOptions({ listWidth: 200 });
    expect(width()).toBe(200);
  });

  it('follows the columns for its maximum', () => {
    const { g } = setup();
    g.setOptions({ columns: ['name'] });
    expect(g.getState().list.max).toBe(241);
    g.resizeList(start(0, 200));
    g.resizeList({ type: 'move', x: 500 });
    expect(g.getState().list.width).toBe(241);
  });

  it('does a drag in a controlled chart too, without touching the data', () => {
    const onChange = vi.fn();
    const g = createGantt({ data: input, onChange });
    g.resizeList(start(0, 300));
    g.resizeList({ type: 'move', x: 20 });
    g.resizeList({ type: 'end' });
    expect(g.getState().list.width).toBe(320);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes a menu and the tooltip when a drag starts', () => {
    const { g } = setup();
    g.openMenu({ kind: 'timeAxis' }, { x: 10, y: 10 });
    expect(g.getState().menu).not.toBeNull();
    g.resizeList(start(0, 300));
    expect(g.getState().menu).toBeNull();
  });

  it('does nothing after destroy', () => {
    const { g, onListWidthChange } = setup();
    g.destroy();
    expect(g.resizeList(start(0, 300))).toBe(false);
    expect(g.resizeList({ type: 'reset' })).toBe(false);
    expect(onListWidthChange).not.toHaveBeenCalled();
  });
  it('shows an option below the minimum at the minimum', () => {
    const { width } = setup({ listWidth: 10 });
    expect(width()).toBe(MIN_LIST_WIDTH);
  });

  it('ignores a second start during a drag, so a cancel still goes back to where it began', () => {
    const { g, width } = setup({ listWidth: 300 });
    g.resizeList(start(0, 300));
    g.resizeList({ type: 'move', x: 50 });
    expect(g.resizeList(start(50, 350))).toBe(false);
    g.resizeList({ type: 'cancel' });
    expect(width()).toBe(300);
  });

  it('reports nothing when a drag ends where it began', () => {
    const { g, onListWidthChange } = setup({ listWidth: 300 });
    g.resizeList(start(0, 300));
    g.resizeList({ type: 'move', x: 40 });
    g.resizeList({ type: 'move', x: 0 });
    g.resizeList({ type: 'end' });
    expect(onListWidthChange).not.toHaveBeenCalled();
  });

  it('ends a drag when the option changes during it, and reports nothing for it', () => {
    const { g, onListWidthChange, width } = setup();
    g.resizeList(start(0, 300));
    g.resizeList({ type: 'move', x: 40 });
    g.setOptions({ listWidth: 250 });
    expect(g.getState().list).toMatchObject({ width: 250, resizing: false });
    expect(g.resizeList({ type: 'end' })).toBe(false);
    expect(width()).toBe(250);
    expect(onListWidthChange).not.toHaveBeenCalled();
  });

  it('keeps a dragged width while the option is left out on each render (undefined)', () => {
    const { g, width } = setup();
    g.resizeList(start(0, 300));
    g.resizeList({ type: 'move', x: 40 });
    g.resizeList({ type: 'end' });
    g.setOptions({ listWidth: undefined });
    g.setOptions({ listWidth: undefined, rowHeight: 30 });
    expect(width()).toBe(340);
  });

  it('bounds a drag by columns that shrink during it', () => {
    const { g, width } = setup();
    g.resizeList(start(0, 300));
    g.setOptions({ columns: ['name'] });
    g.resizeList({ type: 'move', x: 400 });
    expect(width()).toBe(241);
  });

  it('keeps an automatic width automatic for a key at a bound', () => {
    const { g, onListWidthChange, width } = setup();
    expect(g.resizeList({ type: 'key', key: 'End', width: COLUMNS_MAX, chartWidth: CHART })).toBe(true);
    expect(width()).toBeNull();
    expect(onListWidthChange).not.toHaveBeenCalled();
  });
});
