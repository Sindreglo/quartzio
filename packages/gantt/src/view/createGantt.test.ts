import { describe, expect, it, vi } from 'vitest';
import { createGantt } from './createGantt';

describe('createGantt', () => {
  it('starts with an empty viewport', () => {
    const gantt = createGantt();
    expect(gantt.getState().viewport).toEqual({ width: 0, height: 0, scrollLeft: 0, scrollTop: 0 });
  });

  it('merges viewport patches and notifies subscribers with a new state object', () => {
    const gantt = createGantt();
    const before = gantt.getState();
    const listener = vi.fn();
    gantt.subscribe(listener);

    gantt.setViewport({ width: 800, height: 400 });

    const after = gantt.getState();
    expect(after).not.toBe(before);
    expect(after.viewport).toEqual({ width: 800, height: 400, scrollLeft: 0, scrollTop: 0 });
    expect(listener).toHaveBeenCalledWith(after);
  });

  it('keeps the same state object when the viewport does not change', () => {
    const gantt = createGantt();
    gantt.setViewport({ width: 800 });
    const before = gantt.getState();
    const listener = vi.fn();
    gantt.subscribe(listener);

    gantt.setViewport({ width: 800 });

    expect(gantt.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores updates and drops listeners after destroy', () => {
    const gantt = createGantt();
    const listener = vi.fn();
    gantt.subscribe(listener);

    gantt.destroy();
    gantt.setViewport({ width: 800 });

    expect(listener).not.toHaveBeenCalled();
    expect(gantt.getState().viewport.width).toBe(0);
  });
});
