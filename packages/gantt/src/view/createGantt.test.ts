import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../data/project';
import { applyPatch } from '../data/serialize';
import type { ProjectData, ProjectInput } from '../data/types';
import { QuartzioError } from '../util/errors';
import { createGantt, type GanttDataChange } from './createGantt';

const data: ProjectInput = { tasks: [{ id: 1, name: 'One' }] };

describe('createGantt', () => {
  describe('viewport', () => {
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
  });

  describe('uncontrolled (defaultData)', () => {
    it('applies edits immediately and reports them', () => {
      const onChange = vi.fn<(change: GanttDataChange) => void>();
      const gantt = createGantt({ defaultData: data, onChange });

      const patch = gantt.transact((tx) => {
        tx.tasks.update(1, { name: 'Renamed' });
      });

      expect(gantt.getState().project.tasks.byId.get(1)?.name).toBe('Renamed');
      const change = onChange.mock.calls[0]?.[0];
      expect(change?.patch).toBe(patch);
      expect(change?.data.tasks[0]?.name).toBe('Renamed');
    });

    it('ignores later data options', () => {
      const gantt = createGantt({ defaultData: data });
      gantt.setOptions({ data: { tasks: [] } });
      expect(gantt.getState().project.tasks.order).toEqual([1]);
    });
  });

  describe('controlled (data)', () => {
    it('reports edits without applying them', () => {
      const onChange = vi.fn<(change: GanttDataChange) => void>();
      const gantt = createGantt({ data, onChange });

      gantt.transact((tx) => {
        tx.tasks.update(1, { name: 'Renamed' });
      });

      expect(gantt.getState().project.tasks.byId.get(1)?.name).toBe('One');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]?.[0].data.tasks[0]?.name).toBe('Renamed');
    });

    it('shows the edit once the reported data is passed back', () => {
      const gantt = createGantt({
        data,
        onChange: ({ data: next }) => {
          gantt.setOptions({ data: next });
        },
      });

      gantt.transact((tx) => {
        tx.tasks.update(1, { name: 'Renamed' });
      });

      expect(gantt.getState().project.tasks.byId.get(1)?.name).toBe('Renamed');
    });

    it('accepts data updated with applyPatch', () => {
      let current: ProjectData = createProject(data).toData();
      const gantt = createGantt({
        data: current,
        onChange: ({ patch }) => {
          current = applyPatch(current, patch);
          gantt.setOptions({ data: current });
        },
      });

      gantt.transact((tx) => tx.tasks.add({ id: 2 }));

      expect(current.tasks.map((task) => task.id)).toEqual([1, 2]);
      expect(gantt.getState().project.tasks.order).toEqual([1, 2]);
    });

    it('replays the reported change when exactly that data comes back', () => {
      const withDependency: ProjectInput = {
        tasks: [{ id: 1 }, { id: 2 }],
        dependencies: [{ id: 'd', from: 1, to: 2 }],
      };
      const gantt = createGantt({
        data: withDependency,
        onChange: ({ data: next }) => {
          gantt.setOptions({ data: next });
        },
      });
      const dependencies = gantt.getState().project.dependencies;

      gantt.transact((tx) => {
        tx.tasks.update(1, { name: 'Renamed' });
      });

      // Only the replay path keeps untouched tables; a full reload would rebuild them.
      expect(gantt.getState().project.dependencies).toBe(dependencies);
    });

    it('builds quick successive edits on top of each other before data comes back', () => {
      let current: ProjectData = createProject(data).toData();
      const reported: ProjectData[] = [];
      const gantt = createGantt({
        data: current,
        onChange: ({ patch, data: next }) => {
          reported.push(next);
          current = applyPatch(current, patch);
        },
      });

      gantt.transact((tx) => {
        tx.tasks.update(1, { name: 'A' });
      });
      gantt.transact((tx) => {
        tx.tasks.add({ id: 2 });
      });

      expect(reported[1]?.tasks.map((task) => [task.id, task.name])).toEqual([
        [1, 'A'],
        [2, ''],
      ]);
      expect(current).toEqual(reported[1]);

      gantt.setOptions({ data: reported[1] });
      expect(gantt.getState().project.tasks.order).toEqual([1, 2]);
      expect(gantt.getState().project.tasks.byId.get(1)?.name).toBe('A');
    });

    it('drops a rejected change: later edits build on the last data passed in', async () => {
      const reported: ProjectData[] = [];
      const gantt = createGantt({ data, onChange: ({ data: next }) => reported.push(next) });

      gantt.transact((tx) => {
        tx.tasks.update(1, { name: 'Rejected' });
      });
      await Promise.resolve(); // a later event

      gantt.transact((tx) => {
        tx.tasks.add({ id: 2 });
      });
      expect(reported[1]?.tasks.map((task) => [task.id, task.name])).toEqual([
        [1, 'One'],
        [2, ''],
      ]);
    });

    it('treats a present but undefined data key as controlled and empty (e.g. while loading)', () => {
      const gantt = createGantt({ data: undefined });
      expect(gantt.getState().project.tasks.order).toEqual([]);

      gantt.setOptions({ data });
      expect(gantt.getState().project.tasks.order).toEqual([1]);
    });

    it('keeps rejecting invalid data instead of silently ignoring it the second time', () => {
      const gantt = createGantt({ data });
      const invalid: ProjectInput = { tasks: [{ id: 1, parentId: 'missing' }] };
      expect(() => {
        gantt.setOptions({ data: invalid });
      }).toThrow(/does not exist/);
      expect(() => {
        gantt.setOptions({ data: invalid });
      }).toThrow(/does not exist/);
    });

    it('loads new data passed from outside', () => {
      const gantt = createGantt({ data });
      gantt.setOptions({ data: { tasks: [{ id: 'x' }, { id: 'y' }] } });
      expect(gantt.getState().project.tasks.order).toEqual(['x', 'y']);
    });

    it('does not reload when the same data object is passed again', () => {
      const gantt = createGantt({ data });
      const before = gantt.getState();
      gantt.setOptions({ data });
      expect(gantt.getState()).toBe(before);
    });
  });

  it('ignores updates and drops listeners after destroy', () => {
    const gantt = createGantt({ defaultData: data });
    const listener = vi.fn();
    gantt.subscribe(listener);

    gantt.destroy();
    gantt.setViewport({ width: 800 });
    gantt.transact((tx) => tx.tasks.add({ id: 2 }));

    expect(listener).not.toHaveBeenCalled();
    expect(gantt.getState().project.tasks.order).toEqual([1]);
  });

  describe('time axis', () => {
    const tasks: ProjectInput = {
      settings: { timeZone: 'Europe/Oslo' },
      tasks: [
        { id: 1, startDate: '2026-10-05', endDate: '2026-10-09' },
        { id: 2, startDate: '2026-10-12', endDate: '2026-10-16' },
      ],
    };

    it('covers the tasks with some padding by default', () => {
      const gantt = createGantt({ defaultData: tasks, preset: 'weekAndDay' });
      const { timeAxis } = gantt.getState();
      expect(timeAxis.start).toBe(Date.UTC(2026, 9, 2, 22)); // 3 October, two days before the first task
      expect(timeAxis.end).toBeGreaterThanOrEqual(Date.UTC(2026, 9, 17, 22));
      expect(timeAxis.preset.id).toBe('weekAndDay');
    });

    it('fills the viewport', () => {
      const gantt = createGantt({ defaultData: tasks, startDate: '2026-10-05', endDate: '2026-10-06' });
      gantt.setViewport({ width: 2000 });
      expect(gantt.getState().timeAxis.totalWidth).toBeGreaterThanOrEqual(2000);
    });

    it('uses explicit dates, preset and locale, and reacts to changes', () => {
      const gantt = createGantt({
        defaultData: tasks,
        preset: 'monthAndYear',
        startDate: '2026-01-01',
        endDate: '2027-01-01',
        locale: 'nb-NO',
      });
      expect(gantt.getState().header.rows[1]?.[0]?.label).toBe('jan');

      gantt.setOptions({ locale: 'en-US' });
      expect(gantt.getState().header.rows[1]?.[0]?.label).toBe('Jan');

      gantt.setOptions({ preset: 'quarterAndYear' });
      expect(gantt.getState().header.rows[1]?.[0]?.label).toBe('Q1');
    });

    it('renders header cells around the viewport and reuses them while scrolling nearby', () => {
      const gantt = createGantt({
        defaultData: tasks,
        preset: 'weekAndDay',
        startDate: '2026-01-01',
        endDate: '2027-01-01',
      });
      gantt.setViewport({ width: 320, scrollLeft: 32 * 100 });
      const header = gantt.getState().header;
      const days = header.rows[2] ?? [];
      expect(days.length).toBeLessThan(40); // about three viewports of 10 days, not 365
      expect(days[0]?.x).toBeLessThanOrEqual(32 * 100);

      gantt.setViewport({ scrollLeft: 32 * 105 });
      expect(gantt.getState().header).toBe(header);
    });

    it('keeps the same axis object when an edit does not change the range', () => {
      const gantt = createGantt({ defaultData: tasks, startDate: '2026-10-01', endDate: '2026-11-01' });
      const { timeAxis } = gantt.getState();
      gantt.transact((tx) => {
        tx.tasks.update(1, { name: 'Renamed' });
      });
      expect(gantt.getState().timeAxis).toBe(timeAxis);
    });
  });

  describe('time axis options (review regressions)', () => {
    const tasks: ProjectInput = {
      settings: { timeZone: 'Europe/Oslo' },
      tasks: [{ id: 1, startDate: '2026-10-05', endDate: '2026-10-09' }],
    };

    it('rejects invalid options without changing anything, and keeps working afterwards', () => {
      const gantt = createGantt({ defaultData: tasks });
      const before = gantt.getState();
      for (const options of [
        { startDate: 'garbage' },
        { locale: 'not a locale!' },
        { preset: 'nope' },
        { startDate: '2026-10-10', endDate: '2026-10-01' },
      ]) {
        expect(() => {
          gantt.setOptions(options);
        }).toThrow(QuartzioError);
        expect(gantt.getState()).toBe(before);
      }
      gantt.setViewport({ width: 800 });
      expect(gantt.getState().viewport.width).toBe(800);
    });

    it('does not load new data when another option in the same call is invalid', () => {
      const gantt = createGantt({ data: tasks });
      expect(() => {
        gantt.setOptions({ data: { tasks: [] }, preset: 'nope' });
      }).toThrow(QuartzioError);
      expect(gantt.getState().project.tasks.order).toEqual([1]);
    });

    it('applies data and preset together, with one update', () => {
      const gantt = createGantt({ data: tasks, preset: 'hourAndDay' });
      const listener = vi.fn();
      gantt.subscribe(listener);
      gantt.setOptions({
        data: { tasks: [{ id: 1, startDate: '2000-01-01', endDate: '2050-01-01' }] },
        preset: 'manyYears',
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(gantt.getState().timeAxis.preset.id).toBe('manyYears');
    });

    it('survives a task date with a typo in the year (cuts the axis short instead of failing)', () => {
      const onChange = vi.fn();
      const gantt = createGantt({ defaultData: tasks, preset: 'hourAndDay', onChange });
      gantt.transact((tx) => {
        tx.tasks.update(1, { endDate: '3026-10-09' });
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(gantt.getState().project.tasks.byId.get(1)?.endDate).toBe(Date.UTC(3026, 9, 8, 22));
      expect(gantt.getState().timeAxis.tickCount).toBe(200_000);
    });

    it('treats an equal Date as no change and null as not set', () => {
      const gantt = createGantt({ defaultData: tasks, startDate: new Date(Date.UTC(2026, 9, 1)) });
      const listener = vi.fn();
      gantt.subscribe(listener);
      gantt.setOptions({ startDate: new Date(Date.UTC(2026, 9, 1)) });
      expect(listener).not.toHaveBeenCalled();

      gantt.setOptions({ startDate: null as never });
      expect(gantt.getState().timeAxis.start).toBe(Date.UTC(2026, 9, 2, 22)); // default: 2 days before the task
    });

    it('keeps the axis when resizing slightly or moving the last task within the same tick', () => {
      const gantt = createGantt({ defaultData: tasks });
      gantt.setViewport({ width: 810 }); // 26 ticks of 32 px
      const { timeAxis } = gantt.getState();
      gantt.setViewport({ width: 830 }); // still 26 ticks
      expect(gantt.getState().timeAxis).toBe(timeAxis);
      gantt.transact((tx) => {
        tx.tasks.update(1, { endDate: '2026-10-09T01:00' });
      });
      expect(gantt.getState().timeAxis).toBe(timeAxis);
    });
  });
});

describe('scheduling', () => {
  // b depends on a; both unscheduled in the input (b's start is ignored: tasks start as soon as possible).
  const input: ProjectInput = {
    settings: { timeZone: 'UTC', startDate: '2026-10-05' },
    tasks: [
      { id: 'a', duration: 2 },
      { id: 'b', duration: 1, startDate: '2026-11-01' },
    ],
    dependencies: [{ id: 'ab', from: 'a', to: 'b' }],
  };
  const MON_08 = Date.UTC(2026, 9, 5, 8);
  const WED_08 = Date.UTC(2026, 9, 7, 8);
  const flush = () => Promise.resolve();

  it('shows scheduled dates, and reports what scheduling changed after creation, not during it', async () => {
    const onChange = vi.fn();
    const gantt = createGantt({ defaultData: input, onChange });
    expect(gantt.getState().project.tasks.byId.get('b')?.startDate).toBe(WED_08);
    // Reported once a renderer subscribes (so controllers React creates and throws away never report).
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    gantt.subscribe(() => undefined);
    expect(onChange).not.toHaveBeenCalled();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = onChange.mock.calls[0]?.[0] as GanttDataChange;
    expect(change.data.tasks.find((t) => t.id === 'a')?.startDate).toBe(MON_08);
    expect(applyPatch(createProject(input).toData(), change.patch)).toEqual(change.data);
  });

  it('shows controlled data scheduled, and stops reporting once the scheduled data comes back', async () => {
    const onChange = vi.fn();
    const gantt = createGantt({ data: input, onChange });
    gantt.subscribe(() => undefined);
    expect(gantt.getState().project.tasks.byId.get('b')?.startDate).toBe(WED_08);
    await flush();
    const { data } = onChange.mock.calls[0]?.[0] as GanttDataChange;
    const state = gantt.getState();
    gantt.setOptions({ data });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(gantt.getState().project).toBe(state.project);
    // New unscheduled data is reported right away.
    gantt.setOptions({
      data: {
        ...input,
        tasks: [
          { id: 'a', duration: 3 },
          { id: 'b', duration: 1 },
        ],
      },
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    // A copy of scheduled data (not the same object) needs no change.
    const copy = JSON.parse(
      JSON.stringify((onChange.mock.calls[1]?.[0] as GanttDataChange).data),
    ) as ProjectData;
    gantt.setOptions({ data: copy });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('includes pushed successors in the change an edit reports', () => {
    const onChange = vi.fn();
    const gantt = createGantt({ defaultData: input, onChange });
    gantt.transact((tx) => {
      tx.tasks.update('a', { duration: 3 });
    });
    const change = onChange.mock.calls.at(-1)?.[0] as GanttDataChange;
    expect(change.data.tasks.find((t) => t.id === 'b')?.startDate).toBe(Date.UTC(2026, 9, 8, 8));
  });

  it('skips the initial report when an edit reports first, or after destroy', async () => {
    const onChange = vi.fn();
    const edited = createGantt({ defaultData: input, onChange });
    edited.subscribe(() => undefined);
    edited.transact((tx) => {
      tx.tasks.update('a', { name: 'A' });
    });
    const destroyed = createGantt({ defaultData: input, onChange });
    destroyed.subscribe(() => undefined);
    destroyed.destroy();
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('still reports the initial scheduling when invalid data is rejected before it', async () => {
    const onChange = vi.fn();
    const gantt = createGantt({ data: input, onChange });
    gantt.subscribe(() => undefined);
    expect(() => {
      gantt.setOptions({ data: { tasks: [{ id: 1, duration: -1 }] } });
    }).toThrow(QuartzioError);
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
