import { describe, expect, it } from 'vitest';
import type { ProjectInput } from '../data/types';
import { createGantt } from './createGantt';

// UTC, 'weekAndDay' from Monday 5 October: one day = 32 px, rows 36 px (as in the interaction tests).
const day = (d: number, hour = 0) => Date.UTC(2026, 9, d, hour);
const input: ProjectInput = {
  settings: { timeZone: 'UTC', startDate: '2026-10-05' },
  tasks: [
    // Row 0: manual, x 32–96.
    { id: 'm', name: 'Manual', manuallyScheduled: true, startDate: day(6), endDate: day(8), percentDone: 50 },
    // Row 1: automatic, 5 October 08:00–16:00.
    { id: 'a', name: 'Auto', duration: 1 },
    // Rows 2–3: a parent and its child.
    { id: 'p', name: 'Parent', children: [{ id: 'c', name: 'Child', duration: 1 }] },
    // Row 4: a milestone at x 128. Row 5: unscheduled. Row 6: far to the right (x 640–704).
    { id: 'ms', name: 'Milestone', manuallyScheduled: true, startDate: day(9), duration: 0 },
    { id: 'idea', name: 'Idea' },
    { id: 'late', name: 'Late', manuallyScheduled: true, startDate: day(25), endDate: day(27) },
  ],
};
const make = (extra = {}) => {
  const g = createGantt({
    rowHeight: 36,
    defaultData: input,
    preset: 'weekAndDay',
    startDate: '2026-10-05',
    endDate: '2026-11-02',
    locale: 'en-US',
    ...extra,
  });
  g.setViewport({ width: 800, height: 400 });
  return g;
};
const y = (row: number) => row * 36 + 18;
const tip = (g: ReturnType<typeof make>) => g.getState().tooltip;

describe('task tooltip', () => {
  it('shows the task under the pointer with its dates, duration and progress', () => {
    const g = make();
    g.hover({ x: 50, y: y(0) });
    expect(tip(g)).toMatchObject({
      taskId: 'm',
      rowKey: 's:m',
      title: 'Manual',
      fields: [
        { label: 'Start', value: 'Oct 6, 2026' },
        { label: 'End', value: 'Oct 7, 2026' }, // the exclusive end at midnight reads as the day before
        { label: 'Duration', value: '2 days' },
        { label: 'Done', value: '50%' },
      ],
    });
    expect(tip(g)?.task.id).toBe('m');
  });

  it('shows only the date of a milestone, and the rolled-up values of a parent', () => {
    const g = make();
    g.hover({ x: 128, y: y(4) });
    expect(tip(g)?.fields).toEqual([{ label: 'Date', value: 'Oct 9, 2026' }]);
    g.hover({ x: 20, y: y(2) });
    expect(tip(g)?.fields.map((field) => field.label)).toEqual(['Start', 'End', 'Duration', 'Done']);
  });

  it('shows nothing beside bars, on unscheduled rows or outside the rows', () => {
    const g = make();
    for (const point of [
      { x: 200, y: y(0) },
      { x: 20, y: y(5) },
      { x: 50, y: -1 },
      { x: 50, y: y(40) },
      { x: Number.NaN, y: y(0) },
    ]) {
      g.hover(point);
      expect(tip(g)).toBeNull();
    }
    g.hover({ x: 50, y: y(0) });
    g.hover(null);
    expect(tip(g)).toBeNull();
  });

  it('is the same object while over the same bar', () => {
    const g = make();
    g.hover({ x: 40, y: y(0) });
    const first = tip(g);
    const state = g.getState();
    g.hover({ x: 60, y: y(0) + 5 });
    expect(tip(g)).toBe(first);
    expect(g.getState()).toBe(state);
  });

  it('sits above the row, below it without room above, at the start of the visible bar', () => {
    const g = make();
    g.hover({ x: 50, y: y(0) });
    expect(tip(g)).toMatchObject({ x: 32, y: 36, below: true, align: 'start' });
    g.hover({ x: 20, y: y(1) });
    expect(tip(g)).toMatchObject({ y: 2 * 36, below: true }); // 36 px above it: the header would cover it
    g.hover({ x: 128, y: y(4) });
    expect(tip(g)).toMatchObject({ y: 5 * 36, below: true }); // 144 px: not enough for a tall tooltip
    g.hover({ x: 660, y: y(6) });
    expect(tip(g)).toMatchObject({ y: 6 * 36, below: false });
    g.setViewport({ scrollTop: 3 * 36 });
    g.hover({ x: 660, y: y(6) });
    expect(tip(g)).toMatchObject({ below: true }); // now nearer the top of what's visible
    g.setViewport({ scrollLeft: 60 });
    g.hover({ x: 80, y: y(0) });
    expect(tip(g)?.x).toBe(60); // the bar starts out of view
  });

  it('is aligned to the end of the visible bar when there is more room that way, and says how much', () => {
    const g = make();
    g.setViewport({ scrollLeft: 0, width: 690 });
    g.hover({ x: 660, y: y(6) });
    expect(tip(g)).toMatchObject({ taskId: 'late', align: 'end', x: 690, room: 690 });
    g.hover({ x: 50, y: y(0) });
    expect(tip(g)).toMatchObject({ align: 'start', x: 32, room: 690 - 32 });
  });

  it('works with dragging turned off', () => {
    const g = make({ taskDrag: false, taskResize: false, progressDrag: false });
    g.hover({ x: 50, y: y(0) });
    expect(tip(g)?.taskId).toBe('m');
  });

  it('hides on a press, while dragging and when scrolling', () => {
    const g = make();
    g.hover({ x: 50, y: y(0) });
    g.pointerDown({ x: 50, y: y(0) });
    expect(tip(g)).toBeNull();
    g.pointerMove({ x: 100, y: y(0) });
    g.hover({ x: 100, y: y(0) });
    expect(tip(g)).toBeNull(); // dragging
    g.pointerUp({ x: 100, y: y(0) });
    g.hover({ x: 128, y: y(4) });
    g.setViewport({ scrollTop: 10 });
    expect(tip(g)).toBeNull();
  });

  it('follows changes to the task, and goes when it does', () => {
    const g = make();
    g.hover({ x: 50, y: y(0) });
    g.transact((tx) => {
      tx.tasks.update('m', { name: 'Renamed' });
    });
    expect(tip(g)?.title).toBe('Renamed');
    g.transact((tx) => {
      tx.tasks.remove('m');
    });
    expect(tip(g)).toBeNull();
  });

  it('can be turned off', () => {
    const g = make({ taskTooltip: false });
    g.hover({ x: 50, y: y(0) });
    expect(tip(g)).toBeNull();
    g.setOptions({ taskTooltip: true });
    g.hover({ x: 50, y: y(0) });
    expect(tip(g)).not.toBeNull();
    g.setOptions({ taskTooltip: false });
    expect(tip(g)).toBeNull();
    expect(() => createGantt({ taskTooltip: 'yes' as unknown as boolean })).toThrow(/taskTooltip/);
  });

  it('does nothing after destroy', () => {
    const g = make();
    g.destroy();
    g.hover({ x: 50, y: y(0) });
    expect(tip(g)).toBeNull();
  });
});
