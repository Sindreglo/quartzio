import { describe, expect, it, vi } from 'vitest';
import type { ProjectInput } from '../data/types';
import type { BarInteraction } from './interaction';
import { createGantt } from './createGantt';

// UTC, 'weekAndDay' from Monday 5 October: one day = 32 px, rows 36 px. Snapping is to whole days.
const day = (d: number, hour = 0) => Date.UTC(2026, 9, d, hour);
const input: ProjectInput = {
  settings: { timeZone: 'UTC', startDate: '2026-10-05' },
  tasks: [
    // Row 0: manual, x 32–96.
    { id: 'm', manuallyScheduled: true, startDate: day(6), endDate: day(8), percentDone: 50 },
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
/** The current bar interaction (move, resize, create, progress). */
const shown = (g: ReturnType<typeof make>) => g.getState().interaction as BarInteraction | null;
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

  it('finds nothing beside bars, on unscheduled rows (unless creating is on) or outside the rows', () => {
    const g = make();
    expect(g.hitTest({ x: 20, y: 18 })).toBeNull();
    expect(g.hitTest({ x: 20, y: 5 * 36 + 18 })).toEqual({ taskId: 'idea', area: 'create' });
    g.setOptions({ taskDragCreate: false });
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
    expect((preview as BarInteraction | null)?.bar.x).toBe(96);
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
    expect((preview as BarInteraction | null)?.bar.width).toBeCloseTo(3 * 32 + 32 * (16 / 24));
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
    expect(shown(g)?.taskId).toBe('m');
  });

  it('never shows a drag of a task that controlled data just removed', () => {
    const states: (string | number | null)[] = [];
    const g = make({ data: input, defaultData: undefined });
    g.subscribe((state) => states.push((state.interaction as BarInteraction | null)?.taskId ?? null));
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

describe('auto-scrolling', () => {
  it('asks to scroll when the pointer nears or passes an edge of the visible timeline', () => {
    const g = make();
    g.setViewport({ width: 400, height: 150 });
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 150, y: 18 });
    expect(g.getState().interaction?.autoScroll).toEqual({ x: 0, y: 0 });
    g.pointerMove({ x: 390, y: 18 });
    const near = g.getState().interaction?.autoScroll.x ?? 0;
    expect(near).toBeGreaterThan(0);
    g.pointerMove({ x: 900, y: 18 });
    expect(g.getState().interaction?.autoScroll.x).toBeGreaterThan(near);
  });

  it('asks to scroll back when near the start of what is visible', () => {
    const g = make();
    g.setViewport({ width: 400, height: 150, scrollLeft: 300 });
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 305, y: 18 });
    expect(g.getState().interaction?.autoScroll.x).toBeLessThan(0);
  });
});

describe('validation', () => {
  it('marks a change the app refuses as invalid, with its message, and does not drop it', () => {
    const onChange = vi.fn();
    const validateChange = vi.fn((change: { kind: string; start?: number }) =>
      change.kind === 'move' && (change.start ?? 0) >= day(9) ? 'Too late' : true,
    );
    const g = make({ onChange, validateChange });
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 82, y: 18 }); // to 7 Oct: fine
    expect(g.getState().interaction).toMatchObject({ valid: true, message: null });
    g.pointerMove({ x: 146, y: 18 }); // to 9 Oct: refused
    expect(g.getState().interaction).toMatchObject({ valid: false, message: 'Too late' });
    expect(validateChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'move', start: day(9) }));
    g.pointerUp({ x: 146, y: 18 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('treats false as invalid without a message', () => {
    const g = make({ validateChange: () => false });
    g.pointerDown({ x: 94, y: 18 });
    g.pointerMove({ x: 126, y: 18 });
    expect(g.getState().interaction).toMatchObject({ kind: 'resize', valid: false, message: null });
  });

  it('rejects a validateChange that is not a function', () => {
    expect(() => make({ validateChange: 'no' })).toThrow(/validateChange/);
  });
});

describe('dragging progress', () => {
  // m is 50 % done: the handle sits at x 64, in the lower part of its row.
  it('finds the progress handle only low on a task bar', () => {
    const g = make();
    expect(g.hitTest({ x: 64, y: 28 })).toEqual({ taskId: 'm', area: 'progress' });
    expect(g.hitTest({ x: 64, y: 10 })).toEqual({ taskId: 'm', area: 'bar' });
    g.setOptions({ progressDrag: false });
    expect(g.hitTest({ x: 64, y: 28 })).toEqual({ taskId: 'm', area: 'bar' });
  });

  it('sets the percentage from where it is dropped, whole and within 0–100', () => {
    const g = make();
    g.pointerDown({ x: 64, y: 28 });
    g.pointerMove({ x: 80, y: 28 });
    expect(g.getState().interaction).toMatchObject({ kind: 'progress', percent: 75, label: '75%' });
    expect(shown(g)?.bar.progress).toBe(0.75);
    g.pointerUp({ x: 80, y: 28 });
    expect(task(g, 'm')?.percentDone).toBe(75);
    drag(g, [80, 28], [500, 28]);
    expect(task(g, 'm')?.percentDone).toBe(100);
    drag(g, [96, 28], [-50, 28]);
    expect(task(g, 'm')?.percentDone).toBe(0);
  });
});

describe('drag-creating', () => {
  it('schedules an unscheduled task where it is drawn, snapped (automatic: "start no earlier than")', () => {
    const g = make();
    g.pointerDown({ x: 70, y: 5 * 36 + 18 });
    g.pointerMove({ x: 130, y: 5 * 36 + 18 }); // 7 Oct 04:30 → 9 Oct 01:30: drawn 7–9 Oct
    // Previewed where it lands: from 08:00, two working days.
    expect(g.getState().interaction).toMatchObject({
      kind: 'create',
      taskId: 'idea',
      start: day(7, 8),
      end: day(8, 16),
    });
    g.pointerUp({ x: 130, y: 5 * 36 + 18 });
    expect(task(g, 'idea')).toMatchObject({
      constraintType: 'startnoearlierthan',
      constraintDate: day(7),
      startDate: day(7, 8),
      duration: 2,
    });
  });

  it('works leftwards too, and keeps at least one step', () => {
    const g = make();
    drag(g, [130, 5 * 36 + 18], [66, 5 * 36 + 18]);
    expect(task(g, 'idea')?.constraintDate).toBe(day(7));
    const h = make();
    drag(h, [70, 5 * 36 + 18], [74, 5 * 36 + 18]); // a few px: one day
    expect(h.getState().project.tasks.byId.get('idea')).toMatchObject({
      constraintDate: day(7),
      duration: 1,
    });
  });
});

describe('creating dependencies', () => {
  it('finds link handles just outside both ends of a bar', () => {
    const g = make();
    expect(g.hitTest({ x: 27, y: 18 })).toEqual({ taskId: 'm', area: 'link-start' });
    expect(g.hitTest({ x: 100, y: 18 })).toEqual({ taskId: 'm', area: 'link-end' });
    g.setOptions({ dependencyCreate: false });
    expect(g.hitTest({ x: 100, y: 18 })).toBeNull();
  });

  it('draws a line to the pointer and adds the dependency where it is dropped', () => {
    const g = make();
    g.pointerDown({ x: 100, y: 18 }); // m's end
    g.pointerMove({ x: 128, y: 4 * 36 + 18 }); // onto the milestone
    const preview = g.getState().interaction;
    expect(preview).toMatchObject({ kind: 'link', from: 'm', to: 'ms', type: 'FS', valid: true });
    expect(preview?.kind === 'link' && preview.path).toMatch(/^M96 18 L128 162$/);
    g.pointerUp({ x: 128, y: 4 * 36 + 18 });
    const dependencies = [...g.getState().project.dependencies.byId.values()];
    expect(dependencies).toMatchObject([{ from: 'm', to: 'ms', type: 'FS' }]);
  });

  it('takes the type from the sides: onto the end of a bar, or out of the start', () => {
    const g = make();
    drag(g, [100, 18], [128 + 9, 4 * 36 + 18]); // m end → the milestone's end handle: FF
    drag(g, [5, 36 + 18], [27, 18]); // a start → m start: SS
    const types = [...g.getState().project.dependencies.byId.values()].map(
      (d) => `${String(d.from)}-${String(d.to)} ${d.type}`,
    );
    expect(types).toEqual(['m-ms FF', 'a-m SS']);
  });

  it.each<[string, [number, number], string | null]>([
    ['onto itself', [60, 18], 'Can’t link a task to itself'],
    ['onto nothing', [300, 18], null],
  ])('does nothing when dropped %s', (_, target, message) => {
    const onChange = vi.fn();
    const g = make({ onChange });
    g.pointerDown({ x: 100, y: 18 });
    g.pointerMove({ x: target[0], y: target[1] });
    expect(g.getState().interaction).toMatchObject({ kind: 'link', valid: false, message });
    g.pointerUp({ x: target[0], y: target[1] });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses duplicates and cycles, saying why', () => {
    const g = make();
    drag(g, [100, 18], [15, 36 + 18]); // m → a: a now follows m, on 8 Oct 08:00–16:00 (x ≈ 106.7–117.3)
    g.pointerDown({ x: 100, y: 18 });
    g.pointerMove({ x: 110, y: 36 + 18 });
    expect(g.getState().interaction).toMatchObject({ valid: false, message: 'Already linked' });
    g.cancelInteraction();
    g.pointerDown({ x: 122, y: 36 + 18 }); // a's end
    g.pointerMove({ x: 60, y: 18 }); // back onto m
    expect(g.getState().interaction).toMatchObject({ valid: false, message: 'Would create a cycle' });
  });
});

describe('review follow-ups', () => {
  const row = (index: number) => index * 36 + 18;

  it('uses a validator set later with setOptions right away, and a swapped one too', () => {
    const g = make();
    g.setOptions({ validateChange: () => 'No' });
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 146, y: 18 });
    expect(g.getState().interaction).toMatchObject({ valid: false, message: 'No' });
    g.setOptions({ validateChange: () => true });
    g.pointerMove({ x: 150, y: 18 });
    expect(g.getState().interaction).toMatchObject({ valid: true });
  });

  it('treats a validator that throws as refusing, and never leaves a drag behind', () => {
    const onChange = vi.fn();
    const g = make({
      onChange,
      validateChange: () => {
        throw new Error('broken');
      },
    });
    g.pointerDown({ x: 50, y: 18 });
    expect(() => {
      g.pointerMove({ x: 146, y: 18 });
    }).not.toThrow();
    expect(g.getState().interaction).toMatchObject({ valid: false, message: 'broken' });
    g.pointerUp({ x: 146, y: 18 });
    expect(g.getState().interaction).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each<[string, [number, number], [number, number]]>([
    ['progress', [64, 28], [80, 28]],
    ['create', [70, row(5)], [130, row(5)]],
    ['link', [100, 18], [128, row(4)]],
  ])('lets the validator refuse %s too', (kind, from, to) => {
    const validateChange = vi.fn(() => false);
    const g = make({ validateChange });
    g.pointerDown({ x: from[0], y: from[1] });
    g.pointerMove({ x: to[0], y: to[1] });
    expect(g.getState().interaction).toMatchObject({ kind, valid: false });
    expect(validateChange).toHaveBeenCalledWith(expect.objectContaining({ kind }));
  });

  it('links out of a milestone and a summary bar, with SF from a start into an end', () => {
    const g = make();
    drag(g, [128 + 12, row(4)], [94, 18]); // milestone end → m's last third: FF
    drag(g, [5, row(2)], [94, 18]); // p (summary) start → m's end: SF
    const types = [...g.getState().project.dependencies.byId.values()].map(
      (d) => `${String(d.from)}-${String(d.to)} ${d.type}`,
    );
    expect(types).toEqual(['ms-m FF', 'p-m SF']);
  });

  it('says why a link between a parent and its child is refused', () => {
    const g = make();
    g.pointerDown({ x: 5, y: row(2) }); // p's start
    g.pointerMove({ x: 15, y: row(3) }); // onto its child c
    expect(g.getState().interaction).toMatchObject({
      valid: false,
      message: 'Can’t link a task to its parent or child',
    });
  });

  it('draws a manual task exactly as drawn, and offers no drawing on parents', () => {
    const g = make({
      defaultData: {
        settings: { timeZone: 'UTC', startDate: '2026-10-05' },
        tasks: [
          { id: 'free', manuallyScheduled: true },
          { id: 'group', children: [{ id: 'kid' }] },
        ],
      },
    });
    drag(g, [70, 18], [130, 18]);
    expect(g.getState().project.tasks.byId.get('free')).toMatchObject({
      startDate: day(7),
      endDate: day(9),
      constraintType: null,
    });
    expect(g.hitTest({ x: 70, y: row(1) })).toBeNull(); // the unscheduled parent
    expect(g.hitTest({ x: 70, y: row(2) })).toEqual({ taskId: 'kid', area: 'create' });
  });

  it('previews where an automatic task will land, and refuses a span without working time', () => {
    const g = make();
    // Sunday 11 → Tuesday 13 Oct: lands on Monday 08:00, one working day.
    g.pointerDown({ x: 6 * 32 + 4, y: row(5) });
    g.pointerMove({ x: 8 * 32, y: row(5) });
    expect(g.getState().interaction).toMatchObject({
      kind: 'create',
      start: day(12, 8),
      end: day(12, 16),
      valid: true,
    });
    g.cancelInteraction();
    // Saturday 10 → Sunday 11 Oct: no working time at all.
    g.pointerDown({ x: 5 * 32 + 4, y: row(5) });
    g.pointerMove({ x: 6 * 32, y: row(5) });
    expect(g.getState().interaction).toMatchObject({
      valid: false,
      message: 'No working time in the drawn span',
    });
  });

  it('auto-scrolls bar gestures only sideways, links both ways, and never past the end', () => {
    const g = make();
    g.setViewport({ width: 400, height: 150 });
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 150, y: 145 });
    expect(g.getState().interaction?.autoScroll).toEqual({ x: 0, y: 0 });
    g.cancelInteraction();
    g.pointerDown({ x: 100, y: 18 });
    g.pointerMove({ x: 150, y: 145 });
    expect(g.getState().interaction?.autoScroll.y).toBeGreaterThan(0);
    g.cancelInteraction();
    const total = g.getState().timeAxis.totalWidth;
    g.setViewport({ scrollLeft: total - 400 });
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: total - 5, y: 18 });
    expect(g.getState().interaction?.autoScroll.x).toBe(0);
  });

  it('asks for no auto-scroll in a viewport too small to have edges', () => {
    const g = make();
    g.setViewport({ width: 50, height: 150 });
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 95, y: 18 });
    expect(g.getState().interaction?.autoScroll).toEqual({ x: 0, y: 0 });
  });

  it('follows the pointer when the chart scrolls under it during a drag', () => {
    const g = make();
    g.setViewport({ width: 400, height: 150 });
    g.pointerDown({ x: 50, y: 18 });
    g.pointerMove({ x: 114, y: 18 }); // to 8 Oct
    expect(g.getState().interaction).toMatchObject({ start: day(8) });
    g.setViewport({ scrollLeft: 64 }); // the pointer is now over 10 Oct
    expect(g.getState().interaction).toMatchObject({ start: day(10) });
  });
});
