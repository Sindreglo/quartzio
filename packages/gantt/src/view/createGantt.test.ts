import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../data/project';
import { applyPatch } from '../data/serialize';
import type { ProjectData, ProjectInput } from '../data/types';
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
});
