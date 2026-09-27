import { describe, expect, it } from 'vitest';
import type { DependencyInput, DependencyType, ProjectInput, TaskInput } from '../data/types';
import { createGantt } from './createGantt';

// UTC, 'weekAndDay' from Monday 5 October: one day = 32 px, rows 36 px (centers at 18, 54, 90, ...).
// Tasks are manually scheduled, so their dates (and bars) are exactly as given.
const day = (d: number, hour = 0) => Date.UTC(2026, 9, d, hour);
const manual = (id: string, start: number, end: number, extra: Partial<TaskInput> = {}): TaskInput => ({
  id,
  startDate: start,
  endDate: end,
  manuallyScheduled: true,
  ...extra,
});
const gantt = (tasks: TaskInput[], dependencies: DependencyInput[], extra = {}) =>
  createGantt({
    rowHeight: 36,
    defaultData: { settings: { timeZone: 'UTC' }, tasks, dependencies } satisfies ProjectInput,
    preset: 'weekAndDay',
    startDate: '2026-10-05',
    endDate: '2026-11-02',
    ...extra,
  });
const lines = (g: ReturnType<typeof createGantt>) => g.getState().dependencies;
const link = (from: string, to: string, type: DependencyType = 'FS'): DependencyInput => ({
  id: `${from}-${to}`,
  from,
  to,
  type,
});

describe('dependency lines', () => {
  // a: day 0–2 (x 0–64), b: day 3–4 (x 96–128)
  const a = manual('a', day(5), day(7));
  const b = manual('b', day(8), day(9));

  it('routes finish-to-start with one vertical segment when there is room', () => {
    const [line] = lines(gantt([a, b], [link('a', 'b')]));
    // Out of a's end, right 8 px, down to b's row, into b's start.
    expect(line).toMatchObject({ id: 'a-b', from: 'a', to: 'b', type: 'FS', path: 'M64 18 H72 V54 H96' });
  });

  it('goes around when the successor starts before the predecessor ends', () => {
    const early = manual('b', day(6), day(9)); // starts at x 32, before a ends
    const [line] = lines(gantt([a, early], [link('a', 'b')]));
    // Right out of a, down to the row boundary, back left past b's start, down into b.
    expect(line?.path).toBe('M64 18 H72 V36 H24 V54 H32');
  });

  it.each<[DependencyType, string]>([
    ['SS', 'M0 18 H-8 V54 H96'], // out of a's start (left), into b's start
    ['FF', 'M64 18 H136 V54 H128'], // out of a's end, around to b's end from the right
    ['SF', 'M0 18 H-8 V36 H136 V54 H128'], // out of a's start, into b's end: no room, goes around
  ])('routes %s from and to the right sides', (type, path) => {
    expect(lines(gantt([a, b], [link('a', 'b', type)]))[0]?.path).toBe(path);
  });

  it('routes upwards when the successor is above', () => {
    const [line] = lines(gantt([b, a], [link('a', 'b')]));
    // a is in row 1 now (center 54), b in row 0 (center 18); b starts after a ends.
    expect(line?.path).toBe('M64 54 H72 V18 H96');
  });

  it('goes around upwards too, along the boundary below the successor', () => {
    const early = manual('b', day(6), day(9));
    const [line] = lines(gantt([early, a], [link('a', 'b')]));
    expect(line?.path).toBe('M64 54 H72 V36 H24 V18 H32');
  });

  it('starts at the tip of a milestone predecessor', () => {
    const m = manual('m', day(7), day(7));
    const next = manual('n', day(7), day(8));
    // m at x 64 (tip 71); n starts at 64, so the line goes around.
    expect(lines(gantt([m, next], [link('m', 'n')]))[0]?.path).toBe('M71 18 H79 V36 H56 V54 H64');
  });

  it('connects to a summary bar at the ends of its span', () => {
    const g = gantt([{ id: 'p', children: [manual('c', day(5), day(7))] }, b], [link('p', 'b')]);
    // p spans c (x 0–64) in row 0; b is in row 2.
    expect(lines(g)[0]?.path).toBe('M64 18 H72 V90 H96');
  });

  it('connects to the tips of milestone diamonds', () => {
    const m = manual('m', day(8), day(8));
    const [line] = lines(gantt([a, m], [link('a', 'm')]));
    expect(line?.path).toBe('M64 18 H72 V54 H89'); // milestone center x 96, radius 7
  });

  it('leaves out dependencies to unscheduled and collapsed-away tasks, but draws parents', () => {
    const g = gantt(
      [a, { id: 'idea' }, { id: 'p', children: [manual('c', day(12), day(13))] }],
      [link('a', 'idea'), link('a', 'c'), link('a', 'p')],
    );
    expect(lines(g).map((line) => line.id)).toEqual(['a-c', 'a-p']);
    g.toggle('p');
    expect(lines(g).map((line) => line.id)).toEqual(['a-p']);
  });

  it('only includes lines near the rendered rows, including ones passing through', () => {
    // 3000 rows; the window renders the first ~70.
    const tasks = Array.from({ length: 3000 }, (_, i) => manual(`t${String(i)}`, day(5), day(6)));
    const g = gantt(tasks, [link('t0', 't1'), link('t2', 't2999'), link('t2000', 't2001')]);
    g.setViewport({ height: 720 });
    expect(lines(g).map((line) => line.id)).toEqual(['t0-t1', 't2-t2999']);
    g.setViewport({ scrollTop: 1500 * 36 });
    expect(lines(g).map((line) => line.id)).toEqual(['t2-t2999']);
    g.setViewport({ scrollTop: 2000 * 36 });
    expect(lines(g).map((line) => line.id)).toEqual(['t2-t2999', 't2000-t2001']);
  });

  it('keeps the same array while scrolling within the rendered rows, and recomputes after edits', () => {
    const tasks = [a, b, ...Array.from({ length: 200 }, (_, i) => manual(`x${String(i)}`, day(5), day(6)))];
    const g = gantt(tasks, [link('a', 'b')]);
    g.setViewport({ height: 400 });
    const before = lines(g);
    g.setViewport({ scrollLeft: 100 });
    expect(lines(g)).toBe(before);
    g.setViewport({ scrollTop: 36 }); // still within the rendered rows
    expect(lines(g)).toBe(before);
    g.transact((tx) => {
      tx.tasks.update('b', { startDate: day(9) });
    });
    expect(lines(g)[0]?.path).toBe('M64 18 H72 V54 H128');
  });

  it('keeps unchanged line objects when the rendered rows move', () => {
    const tasks = Array.from({ length: 200 }, (_, i) => manual(`t${String(i)}`, day(5), day(6)));
    const g = gantt(tasks, [link('t0', 't199'), link('t150', 't151')]);
    g.setViewport({ height: 400 });
    const [long] = lines(g);
    g.setViewport({ scrollTop: 150 * 36 });
    expect(lines(g)).toHaveLength(2);
    expect(lines(g)[0]).toBe(long);
  });

  it('stays finite for bars far outside the axis', () => {
    const far = manual('far', day(5), Date.UTC(2090, 0, 1));
    const [line] = lines(gantt([far, b], [link('far', 'b')]));
    expect(line?.path).not.toMatch(/NaN|Infinity/);
  });
});
