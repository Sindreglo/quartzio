import { describe, expect, it, vi } from 'vitest';
import type { ProjectInput, TaskInput } from '../data/types';
import { QuartzioError } from '../util/errors';
import { createGantt } from './createGantt';

const oslo = (day: number, hour = 0) => Date.UTC(2026, 9, day, hour - 2);

const project: ProjectInput = {
  settings: { timeZone: 'Europe/Oslo' },
  tasks: [
    {
      id: 'plan',
      name: 'Planning',
      children: [
        { id: 'scope', name: 'Scope', startDate: oslo(5, 8), endDate: oslo(7, 16) },
        { id: 'budget', name: 'Budget', startDate: oslo(8, 8), duration: 2 },
      ],
    },
    { id: 'launch', name: 'Launch', startDate: oslo(12, 8) },
    { id: 'idea', name: 'Unscheduled idea' },
  ],
};

const rowIds = (gantt: ReturnType<typeof createGantt>) => gantt.getState().rows.items.map((row) => row.id);

describe('rows', () => {
  it('lists tasks in tree order with depth and position', () => {
    const gantt = createGantt({ defaultData: project, rowHeight: 40 });
    const { rows } = gantt.getState();
    expect(rows.items.map((row) => [row.id, row.depth, row.y, row.hasChildren, row.expanded])).toEqual([
      ['plan', 0, 0, true, true],
      ['scope', 1, 40, false, false],
      ['budget', 1, 80, false, false],
      ['launch', 0, 120, false, false],
      ['idea', 0, 160, false, false],
    ]);
    expect(rows.count).toBe(5);
    expect(rows.totalHeight).toBe(200);
  });

  it('fills in cells in the locale and time zone', () => {
    const gantt = createGantt({ defaultData: project, locale: 'en-US' });
    const byId = new Map(gantt.getState().rows.items.map((row) => [row.id, row.cells]));
    // No own duration: the working time between its dates (3 × 8 hours).
    expect(byId.get('scope')).toEqual(['Scope', 'Oct 5, 2026', 'Oct 7, 2026', '3 days']);
    expect(byId.get('budget')).toEqual(['Budget', 'Oct 8, 2026', 'Oct 9, 2026', '2 days']);
    expect(byId.get('plan')?.slice(1)).toEqual(['Oct 5, 2026', 'Oct 9, 2026', '5 days']);
    expect(byId.get('idea')).toEqual(['Unscheduled idea', '', '', '']);
  });

  it('handles an empty project', () => {
    const { rows } = createGantt().getState();
    expect(rows).toMatchObject({ count: 0, totalHeight: 0, items: [] });
  });

  it('does not overflow the stack for very deep trees', () => {
    let deepest: TaskInput = { id: 'leaf' };
    for (let i = 0; i < 5000; i++) deepest = { id: `n${String(i)}`, children: [deepest] };
    const gantt = createGantt({ defaultData: { tasks: [deepest] } });
    expect(gantt.getState().rows.count).toBe(5001);
  });
});

describe('expand and collapse', () => {
  it('hides and shows descendants', () => {
    const gantt = createGantt({ defaultData: project });
    gantt.toggle('plan');
    expect(rowIds(gantt)).toEqual(['plan', 'launch', 'idea']);
    expect(gantt.getState().rows.items[0]?.expanded).toBe(false);
    gantt.toggle('plan');
    expect(rowIds(gantt)).toEqual(['plan', 'scope', 'budget', 'launch', 'idea']);
  });

  it('ignores unknown ids and leaf tasks, and repeated setExpanded calls', () => {
    const gantt = createGantt({ defaultData: project });
    const listener = vi.fn();
    gantt.subscribe(listener);
    gantt.toggle('nope');
    gantt.toggle('scope');
    gantt.setExpanded('plan', true);
    expect(listener).not.toHaveBeenCalled();

    gantt.setExpanded('plan', false);
    gantt.setExpanded('plan', false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('collapses and expands everything', () => {
    const gantt = createGantt({ defaultData: project });
    gantt.collapseAll();
    expect(rowIds(gantt)).toEqual(['plan', 'launch', 'idea']);
    gantt.expandAll();
    expect(gantt.getState().rows.count).toBe(5);
  });

  it('copes with a collapsed task being removed', () => {
    const gantt = createGantt({ defaultData: project });
    gantt.toggle('plan');
    gantt.transact((tx) => {
      tx.tasks.remove('plan');
    });
    expect(rowIds(gantt)).toEqual(['launch', 'idea']);
  });
});

describe('virtualization', () => {
  const many: ProjectInput = {
    tasks: Array.from({ length: 10_000 }, (_, i) => ({ id: i, name: `Task ${String(i)}` })),
  };

  it('only builds rows around the viewport', () => {
    const gantt = createGantt({ defaultData: many, rowHeight: 36 });
    gantt.setViewport({ height: 360, scrollTop: 36 * 5000 });
    const { rows } = gantt.getState();
    expect(rows.count).toBe(10_000);
    expect(rows.items.length).toBeLessThanOrEqual(31); // three viewports of ten rows
    expect(rows.items[0]?.index).toBeLessThanOrEqual(5000);
    expect(rows.items.at(-1)?.index).toBeGreaterThanOrEqual(5010);
  });

  it('reuses the rows while scrolling within the rendered window', () => {
    const gantt = createGantt({ defaultData: many });
    gantt.setViewport({ height: 360, scrollTop: 36 * 5000 });
    const rows = gantt.getState().rows;
    gantt.setViewport({ scrollTop: 36 * 5005 });
    expect(gantt.getState().rows).toBe(rows);
  });

  it('keeps unchanged rows identical when another task changes', () => {
    const gantt = createGantt({ defaultData: project });
    const [plan, scope] = gantt.getState().rows.items;
    gantt.transact((tx) => {
      tx.tasks.update('launch', { name: 'Go live' });
    });
    const next = gantt.getState().rows.items;
    expect(next[0]).toBe(plan);
    expect(next[1]).toBe(scope);
    expect(next[3]?.cells[0]).toBe('Go live');
  });
});

describe('layout options', () => {
  it('rejects invalid heights and columns without changing anything', () => {
    const gantt = createGantt({ defaultData: project });
    const before = gantt.getState();
    for (const options of [
      { rowHeight: 0 },
      { rowHeight: Number.NaN },
      { headerRowHeight: 1000 },
      { columns: ['nope'] as never },
    ]) {
      expect(() => {
        gantt.setOptions(options);
      }).toThrow(QuartzioError);
      expect(gantt.getState()).toBe(before);
    }
  });

  it('applies new columns and heights', () => {
    const gantt = createGantt({ defaultData: project });
    gantt.setOptions({ columns: ['name', 'percentDone'], rowHeight: 24, headerRowHeight: 30 });
    const state = gantt.getState();
    expect(state.columns.items.map((column) => column.id)).toEqual(['name', 'percentDone']);
    expect(state.rows.items[1]?.y).toBe(24);
    expect(state.header.height).toBe(3 * 30);
  });

  describe('review regressions (4a)', () => {
    it('shows the working time a parent spans, not a contradicting own duration', () => {
      const gantt = createGantt({
        defaultData: {
          settings: { timeZone: 'Europe/Oslo' },
          tasks: [
            { id: 'p', duration: 20, children: [{ id: 'c', startDate: oslo(5, 8), endDate: oslo(7, 16) }] },
          ],
        },
        locale: 'en-US',
      });
      expect(gantt.getState().rows.items[0]?.cells[3]).toBe('3 days');
    });

    it('shows an empty duration instead of freezing for a huge span', () => {
      const gantt = createGantt({
        defaultData: {
          settings: { timeZone: 'UTC' },
          tasks: [{ id: 1, startDate: '2026-01-01', endDate: '9026-01-01' }],
        },
      });
      expect(gantt.getState().rows.items[0]?.cells[3]).toBe('');
    });

    it('treats an equal inline columns array as no change', () => {
      const gantt = createGantt({ defaultData: project, columns: ['name', 'duration'] });
      const listener = vi.fn();
      gantt.subscribe(listener);
      gantt.setOptions({ columns: ['name', 'duration'] });
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not emit when collapsing or expanding changes nothing', () => {
      const gantt = createGantt({ defaultData: project });
      const listener = vi.fn();
      gantt.subscribe(listener);
      gantt.expandAll();
      gantt.collapseAll();
      gantt.collapseAll();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('forgets a collapsed parent that lost its children', () => {
      const gantt = createGantt({ defaultData: project });
      gantt.toggle('plan');
      gantt.transact((tx) => {
        tx.tasks.remove('scope');
        tx.tasks.remove('budget');
      });
      gantt.transact((tx) => {
        tx.tasks.add({ id: 'new' }, { parentId: 'plan' });
      });
      expect(rowIds(gantt)).toContain('new');
    });

    it('gives tasks 1 and "1" different keys', () => {
      const gantt = createGantt({ defaultData: { tasks: [{ id: 1 }, { id: '1' }] } });
      const keys = gantt.getState().rows.items.map((row) => row.key);
      expect(new Set(keys).size).toBe(2);
    });

    it('rebuilds the rendered rows when locale, columns or row height change while scrolled', () => {
      const many: ProjectInput = {
        settings: { timeZone: 'UTC' },
        tasks: Array.from({ length: 500 }, (_, i) => ({ id: i, startDate: '2026-10-05' })),
      };
      const gantt = createGantt({ defaultData: many, locale: 'en-US' });
      gantt.setViewport({ height: 360, scrollTop: 36 * 200 });
      gantt.setOptions({ locale: 'nb-NO' });
      expect(gantt.getState().rows.items[0]?.cells[1]).toBe('5. okt. 2026');
      gantt.setOptions({ columns: ['name'] });
      expect(gantt.getState().rows.items[0]?.cells).toHaveLength(1);
      gantt.setOptions({ rowHeight: 20 });
      const first = gantt.getState().rows.items[0];
      expect(first?.y).toBe((first?.index ?? 0) * 20);
    });

    it('keeps the old view options when data in the same call is invalid', () => {
      const gantt = createGantt({ data: project, rowHeight: 36 });
      expect(() => {
        gantt.setOptions({ data: { tasks: [{ id: 1, parentId: 'missing' }] }, rowHeight: 20 });
      }).toThrow(QuartzioError);
      expect(gantt.getState().rows.rowHeight).toBe(36);
      gantt.setViewport({ height: 100 });
      expect(gantt.getState().rows.rowHeight).toBe(36);
    });
  });
});
