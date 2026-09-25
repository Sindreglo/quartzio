import { describe, expect, it, vi } from 'vitest';
import type { ProjectInput } from '../data/types';
import { createGantt } from './createGantt';

// UTC, 'weekAndDay' from Monday 5 October: one day = 32 px, rows 36 px. Snapping is to whole days.
const day = (d: number, hour = 0) => Date.UTC(2026, 9, d, hour);
const input: ProjectInput = {
  settings: { timeZone: 'UTC', startDate: '2026-10-05' },
  tasks: [
    // Row 0: manual, x 32–96.
    { id: 'm', manuallyScheduled: true, startDate: day(6), endDate: day(8) },
    // Row 1: automatic, 5 October 08:00–16:00 (x ≈ 10.7–21.3).
    { id: 'a', duration: 1 },
    // Rows 2–3: an automatic parent and its child.
    { id: 'p', children: [{ id: 'c', duration: 1 }] },
    // Row 4: a milestone at x 128. Row 5: unscheduled.
    { id: 'ms', manuallyScheduled: true, startDate: day(9), duration: 0 },
    { id: 'idea' },
  ],
};
const make = (extra = {}) =>
  createGantt({
    defaultData: input,
    preset: 'weekAndDay',
    startDate: '2026-10-05',
    endDate: '2026-11-02',
    locale: 'en-US',
    ...extra,
  });
const task = (g: ReturnType<typeof make>, id: string) => g.getState().project.tasks.byId.get(id);
const drag = (g: ReturnType<typeof make>, from: [number, number], to: [number, number]) => {
  g.pointerDown({ x: from[0], y: from[1] });
  g.pointerMove({ x: to[0], y: to[1] });
  g.pointerUp({ x: to[0], y: to[1] });
};

describe('hit testing', () => {
  it('finds the bar, its resize handle, milestones and parents', () => {
    const g = make();
    expect(g.hitTest({ x: 50, y: 18 })).toEqual({ taskId: 'm', area: 'bar' });
    expect(g.hitTest({ x: 94, y: 18 })).toEqual({ taskId: 'm', area: 'resize-end' });
    expect(g.hitTest({ x: 130, y: 4 * 36 + 18 })).toEqual({ taskId: 'ms', area: 'bar' }); // no resizing milestones
    expect(g.hitTest({ x: 20, y: 2 * 36 + 18 })).toEqual({ taskId: 'p', area: 'bar' }); // nor summary bars
  });

  it('finds nothing beside bars, on unscheduled rows or outside the rows', () => {
    const g = make();
    expect(g.hitTest({ x: 20, y: 18 })).toBeNull();
    expect(g.hitTest({ x: 20, y: 5 * 36 + 18 })).toBeNull();
    expect(g.hitTest({ x: 50, y: -1 })).toBeNull();
    expect(g.hitTest({ x: 50, y: 6 * 36 + 1 })).toBeNull();
  });
});

describe('moving', () => {
  it('moves a manually scheduled task to the snapped start, keeping its duration', () => {
    const g = make();
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 100, y: 18 }); // +50 px: the start lands on 7 Oct 13:30, snapped to 8 Oct
    const preview = g.getState().interaction;
    expect(preview).toMatchObject({ kind: 'move', taskId: 'm', start: day(8) });
    expect(preview?.bar.x).toBe(96);
    expect(preview?.label).toBe('Oct 8, 2026 – Oct 9, 2026');
    // Only a preview: the data is untouched until the drop.
    expect(task(g, 'm')?.startDate).toBe(day(6));
    g.pointerUp({ x: 100, y: 18 });
    expect(g.getState().interaction).toBeNull();
    expect(task(g, 'm')).toMatchObject({ startDate: day(8), duration: 2, constraintType: null });
  });

  it('previews the end the drop will give, over the weekend', () => {
    const g = make();
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 146, y: 18 }); // to Friday 9 Oct: two working days end on Monday 16:00
    const preview = g.getState().interaction;
    expect(preview).toMatchObject({ start: day(9), end: day(12, 16), label: 'Oct 9, 2026 – Oct 12, 2026' });
    expect(preview?.bar.width).toBeCloseTo(3 * 32 + 32 * (16 / 24));
    g.pointerUp({ x: 146, y: 18 });
    expect(task(g, 'm')).toMatchObject({ startDate: day(9), endDate: day(12, 16) });
  });

  it('previews with times at a sub-day resolution', () => {
    const g = createGantt({
      defaultData: {
        settings: { timeZone: 'UTC' },
        tasks: [
          { id: 'h', manuallyScheduled: true, startDate: day(5, 10), duration: 2, durationUnit: 'hour' },
        ],
      },
      preset: 'hourAndDay',
      startDate: '2026-10-05',
      endDate: '2026-10-06',
      locale: 'en-US',
    });
    // 44 px per hour: the bar is at x 440–528. Drag an hour on.
    g.pointerDown({ x: 480, y: 18 });
    g.pointerMove({ x: 524, y: 18 });
    const preview = g.getState().interaction;
    expect(preview).toMatchObject({ start: day(5, 11), end: day(5, 13) });
    expect(preview?.label).toMatch(/11:00.*1:00/);
  });

  it('moves a bar that starts long before the axis by what was dragged, not from where it is clipped', () => {
    const g = make({
      defaultData: {
        settings: { timeZone: 'UTC' },
        tasks: [{ id: 'long', manuallyScheduled: true, startDate: '2026-01-05', endDate: day(10) }],
      },
    });
    drag(g, [50, 18], [82, 18]); // a day on
    expect(task(g, 'long')?.startDate).toBe(Date.UTC(2026, 0, 6));
  });

  it('holds an automatically scheduled task with "start no earlier than"', () => {
    const g = make();
    drag(g, [15, 54], [79, 54]); // +2 days
    expect(task(g, 'a')).toMatchObject({
      constraintType: 'startnoearlierthan',
      constraintDate: day(7),
      startDate: day(7, 8),
      endDate: day(7, 16),
    });
  });

  it('lets predecessors keep an automatic task later than where it was dropped', () => {
    const g = createGantt({
      defaultData: {
        settings: { timeZone: 'UTC', startDate: '2026-10-05' },
        tasks: [
          { id: 'x', duration: 5 },
          { id: 'y', duration: 1, constraintType: 'startnoearlierthan', constraintDate: day(12) },
        ],
        dependencies: [{ id: 'xy', from: 'x', to: 'y' }],
      },
      preset: 'weekAndDay',
      startDate: '2026-10-05',
      endDate: '2026-11-02',
    });
    // y starts Monday 12 Oct (x 234.7); drag it back to Wednesday 7 Oct, before x ends (Friday).
    drag(g, [240, 54], [80, 54]);
    expect(g.getState().project.tasks.byId.get('y')).toMatchObject({
      constraintDate: day(7),
      startDate: day(12, 8), // x still ends Friday 16:00
    });
  });

  it('moves a parent with its children', () => {
    const g = make();
    drag(g, [15, 2 * 36 + 18], [79, 2 * 36 + 18]);
    expect(task(g, 'p')).toMatchObject({ constraintType: 'startnoearlierthan', startDate: day(7, 8) });
    expect(task(g, 'c')?.startDate).toBe(day(7, 8));
  });

  it('moves milestones', () => {
    const g = make();
    drag(g, [128, 4 * 36 + 18], [192, 4 * 36 + 18]);
    expect(task(g, 'ms')).toMatchObject({ startDate: day(11), endDate: day(11) });
  });

  it('snaps to local midnight across a daylight saving change (Oslo)', () => {
    const g = createGantt({
      defaultData: {
        settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-19' },
        tasks: [{ id: 'm', manuallyScheduled: true, startDate: '2026-10-23', duration: 1 }],
      },
      preset: 'weekAndDay',
      startDate: '2026-10-19',
      endDate: '2026-11-16',
    });
    // Friday 23 Oct is 4 days in (x 128); drag 4 days on, over the 25-hour Sunday, to Tuesday 27 Oct.
    drag(g, [140, 18], [268, 18]);
    expect(g.getState().project.tasks.byId.get('m')?.startDate).toBe(Date.UTC(2026, 9, 26, 23)); // 00:00 Oslo
  });
});

describe('resizing', () => {
  it('moves the end to the snapped position and derives the duration', () => {
    const g = make();
    g.pointerDown({ x: 94, y: 18 });
    g.pointerMove({ x: 126, y: 18 });
    expect(g.getState().interaction).toMatchObject({ kind: 'resize', end: day(9) });
    g.pointerUp({ x: 126, y: 18 });
    expect(task(g, 'm')).toMatchObject({ startDate: day(6), endDate: day(9), duration: 3 });
  });

  it('keeps at least one step of the time resolution (a task never becomes a milestone by resizing)', () => {
    const g = make();
    drag(g, [94, 18], [-200, 18]);
    expect(task(g, 'm')).toMatchObject({ startDate: day(6), endDate: day(7), duration: 1 });
  });

  it('resizes an automatic task, keeping its start', () => {
    const g = make();
    drag(g, [20, 54], [52, 54]); // the end (16:00) moves a day on, snapped to midnight
    expect(task(g, 'a')).toMatchObject({
      startDate: day(5, 8),
      endDate: day(7),
      duration: 2,
      constraintType: null,
    });
  });
});

describe('the interaction itself', () => {
  it('treats small movements as a click, changing nothing', () => {
    const onChange = vi.fn();
    const g = make({ onChange });
    drag(g, [50, 18], [52, 19]);
    expect(onChange).not.toHaveBeenCalled();
    expect(g.getState().interaction).toBeNull();
  });

  it('changes nothing when cancelled, or when dropped where it started', () => {
    const onChange = vi.fn();
    const g = make({ onChange });
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 150, y: 18 });
    g.cancelInteraction();
    expect(g.getState().interaction).toBeNull();
    g.pointerUp({ x: 150, y: 18 }); // ignored after cancel
    drag(g, [50, 18], [58, 18]); // moves, but snaps back to the same day
    expect(onChange).not.toHaveBeenCalled();
    expect(task(g, 'm')?.startDate).toBe(day(6));
  });

  it('ignores moves and releases without a press, and restarts on a second press', () => {
    const g = make();
    g.pointerMove({ x: 100, y: 18 });
    g.pointerUp({ x: 100, y: 18 });
    expect(g.pointerDown({ x: 20, y: 18 })).toBe(false); // nothing there
    expect(g.pointerDown({ x: 50, y: 18 })).toBe(true);
    expect(g.pointerDown({ x: 94, y: 18 })).toBe(true);
    g.pointerMove({ x: 126, y: 18 });
    expect(g.getState().interaction?.kind).toBe('resize');
  });

  it('can be turned off, separately for moving and resizing', () => {
    const g = make({ taskResize: false });
    expect(g.hitTest({ x: 94, y: 18 })).toEqual({ taskId: 'm', area: 'bar' }); // the whole bar moves
    g.setOptions({ taskDrag: false });
    expect(g.hitTest({ x: 50, y: 18 })).toBeNull();
    expect(g.pointerDown({ x: 50, y: 18 })).toBe(false);
    g.setOptions({ taskResize: true });
    expect(g.hitTest({ x: 94, y: 18 })).toEqual({ taskId: 'm', area: 'resize-end' });
  });

  it('reports the drop in controlled mode, and shows it once the data comes back', () => {
    const onChange = vi.fn();
    const g = make({ data: input, onChange, defaultData: undefined });
    drag(g, [50, 18], [114, 18]);
    expect(g.getState().interaction).toBeNull();
    expect(task(g, 'm')?.startDate).toBe(day(6));
    const { data } = onChange.mock.calls.at(-1)?.[0] as { data: ProjectInput };
    g.setOptions({ data });
    expect(task(g, 'm')?.startDate).toBe(day(8));
  });

  it('reports "start no earlier than" in controlled mode, for automatic tasks', () => {
    const onChange = vi.fn();
    const g = make({ data: input, onChange, defaultData: undefined });
    drag(g, [15, 54], [79, 54]);
    const { data } = onChange.mock.calls.at(-1)?.[0] as {
      data: { tasks: { id: string; constraintDate: number | null }[] };
    };
    expect(data.tasks.find((t) => t.id === 'a')?.constraintDate).toBe(day(7));
  });

  it.each<[string, (g: ReturnType<typeof make>) => void]>([
    [
      'the preset changes',
      (g) => {
        g.setOptions({ preset: 'hourAndDay' });
      },
    ],
    [
      'dragging is turned off',
      (g) => {
        g.setOptions({ taskDrag: false });
      },
    ],
    [
      'the task changes',
      (g) => {
        g.transact((tx) => {
          tx.tasks.update('m', { manuallyScheduled: false });
        });
      },
    ],
    [
      'the task is collapsed away',
      (g) => {
        g.transact((tx) => {
          tx.tasks.move('m', { parentId: 'p' });
        });
        g.toggle('p');
      },
    ],
  ])('drops the drag, changing nothing, when %s during it', (_, change) => {
    const onChange = vi.fn();
    const g = make({ onChange });
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 100, y: 18 });
    change(g);
    onChange.mockClear();
    expect(g.getState().interaction).toBeNull();
    g.pointerMove({ x: 110, y: 18 });
    g.pointerUp({ x: 110, y: 18 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the drag while only scrolling', () => {
    const g = make();
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 100, y: 18 });
    g.setViewport({ scrollLeft: 20 });
    expect(g.getState().interaction?.taskId).toBe('m');
  });

  it('never shows a drag of a task that controlled data just removed', () => {
    const states: (string | number | null)[] = [];
    const g = make({ data: input, defaultData: undefined });
    g.subscribe((state) => states.push(state.interaction?.taskId ?? null));
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 100, y: 18 });
    g.setOptions({ data: { settings: { timeZone: 'UTC', startDate: '2026-10-05' }, tasks: [] } });
    expect(states.at(-1)).toBeNull();
    expect(g.getState().interaction).toBeNull();
  });

  it('ignores points that are not finite, and far-off points, without throwing', () => {
    const g = make();
    expect(g.pointerDown({ x: Number.NaN, y: 18 })).toBe(false);
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 100, y: 18 });
    const preview = g.getState().interaction;
    expect(() => {
      g.pointerMove({ x: Number.POSITIVE_INFINITY, y: 18 });
      g.pointerMove({ x: 1e13, y: 18 });
    }).not.toThrow();
    expect(g.getState().interaction).toBe(preview);
  });

  it('ignores the drag after destroy', () => {
    const g = make();
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 100, y: 18 });
    g.destroy();
    expect(() => {
      g.pointerUp({ x: 100, y: 18 });
    }).not.toThrow();
  });

  it('cancels quietly when the task disappears during the drag', () => {
    const g = make();
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 150, y: 18 });
    g.transact((tx) => {
      tx.tasks.remove('m');
    });
    expect(g.getState().interaction).toBeNull();
    expect(() => {
      g.pointerUp({ x: 150, y: 18 });
    }).not.toThrow();
  });
});
