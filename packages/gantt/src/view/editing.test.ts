import { describe, expect, it, vi } from 'vitest';
import type { ProjectData, ProjectInput, Task } from '../data/types';
import type { ProposedChange } from './interaction';
import { toWallTime } from '../util/zone';
import { createGantt, type GanttDataChange, type GanttOptions } from './createGantt';

const day = (d: number, hour = 0) => Date.UTC(2026, 9, d, hour);
const input: ProjectInput = {
  settings: { timeZone: 'UTC', startDate: '2026-10-05' },
  tasks: [
    // Row 0: manual, 6 Oct 08:00 – 8 Oct 16:00 (3 working days).
    {
      id: 'm',
      name: 'Manual',
      manuallyScheduled: true,
      startDate: day(6, 8),
      endDate: day(8, 16),
      percentDone: 50,
    },
    // Row 1: automatic, 5 Oct 08:00–16:00.
    { id: 'a', name: 'Auto', duration: 1 },
    // Rows 2–3: a parent and its child.
    { id: 'p', name: 'Parent', children: [{ id: 'c', name: 'Child', duration: 2 }] },
    // Row 4: a milestone. Row 5: unscheduled. Row 6: manual, whole days (ends at midnight).
    { id: 'ms', name: 'Milestone', manuallyScheduled: true, startDate: day(9), duration: 0 },
    { id: 'idea', name: 'Idea' },
    { id: 'days', name: 'Days', manuallyScheduled: true, startDate: day(12), endDate: day(14) },
  ],
};
const COLUMNS: GanttOptions['columns'] = [
  'name',
  'startDate',
  'endDate',
  'duration',
  'percentDone',
  { id: 'note', title: 'Note', value: () => 'x' },
];
const make = (extra: GanttOptions = {}) => {
  const g = createGantt({ defaultData: input, columns: COLUMNS, locale: 'en-US', ...extra });
  g.setViewport({ width: 800, height: 400 });
  return g;
};
type G = ReturnType<typeof make>;
const task = (g: G, id: string) => g.getState().project.tasks.byId.get(id);
const editing = (g: G) => g.getState().editing;
/** Edits a cell: starts, types, presses Enter. Returns whether it closed (applied or unchanged). */
const edit = (g: G, id: string, column: string, text: string) => {
  if (!g.startEdit(id, column)) throw new Error(`${id}.${column} is not editable`);
  g.editInput(text);
  g.editKeyDown({ key: 'Enter' });
  return editing(g) === null;
};

describe('starting an edit', () => {
  it('opens the cell with its value as text', () => {
    const g = make();
    expect(g.startEdit('m', 'name')).toBe(true);
    expect(editing(g)).toMatchObject({
      taskId: 'm',
      rowKey: 's:m',
      columnId: 'name',
      kind: 'text',
      text: 'Manual',
      error: null,
    });
    g.startEdit('m', 'startDate');
    expect(editing(g)).toMatchObject({ kind: 'date', text: '2026-10-06' });
    g.startEdit('m', 'endDate');
    expect(editing(g)?.text).toBe('2026-10-08');
    g.startEdit('days', 'endDate');
    expect(editing(g)?.text).toBe('2026-10-13'); // the midnight end reads as the day before, as in the column
    g.startEdit('m', 'duration');
    expect(editing(g)).toMatchObject({ kind: 'duration', text: '3d' });
    g.startEdit('m', 'percentDone');
    expect(editing(g)).toMatchObject({ kind: 'percent', text: '50' });
  });

  it('uses date and time fields when the time axis shows hours', () => {
    const g = make({ preset: 'hourAndDay' });
    g.startEdit('m', 'startDate');
    expect(editing(g)).toMatchObject({ kind: 'datetime', text: '2026-10-06T08:00' });
    g.startEdit('m', 'endDate');
    expect(editing(g)?.text).toBe('2026-10-08T16:00'); // exact, not as a day
  });

  it('starts on the first editable column with Enter or F2, and moves the cursor there', () => {
    const g = make();
    g.rowClick('a');
    expect(g.keyDown({ key: 'Enter' })).toBe(true);
    expect(editing(g)).toMatchObject({ taskId: 'a', columnId: 'name' });
    g.cancelEdit();
    expect(g.keyDown({ key: 'F2' })).toBe(true);
    expect(editing(g)?.columnId).toBe('name');
    g.cancelEdit();
    g.startEdit('b', 'name'); // unknown: nothing
    g.startEdit('m', 'duration');
    expect(g.getState().activeId).toBe('m');
    expect(g.getState().selection).toEqual(['m']);
  });

  it('keeps a multi-selection that includes the edited row', () => {
    const g = make();
    g.select(['m', 'a']);
    g.startEdit('m', 'name');
    expect(g.getState().selection).toEqual(['m', 'a']);
    expect(g.getState().activeId).toBe('m');
  });

  it('refuses cells that cannot be edited', () => {
    const g = make();
    expect(g.startEdit('p', 'name')).toBe(true);
    for (const [id, column] of [
      ['p', 'startDate'], // parents roll up
      ['p', 'endDate'],
      ['p', 'duration'],
      ['p', 'percentDone'],
      ['ms', 'endDate'], // a milestone has one date
      ['idea', 'endDate'], // no start to end after
      ['m', 'note'], // a value-only column
      ['m', 'nope'],
      ['nope', 'name'],
    ]) {
      expect(g.startEdit(id as string, column as string)).toBe(false);
    }
    expect(editing(g)).toBeNull(); // a refused start closes the open edit
    g.toggle('p');
    expect(g.startEdit('c', 'name')).toBe(false); // hidden
    expect(make().keyDown({ key: 'Enter' })).toBe(false); // no active row
  });

  it('can be turned off, and a column can opt out', () => {
    const g = make({ cellEdit: false });
    expect(g.startEdit('m', 'name')).toBe(false);
    g.rowClick('m');
    expect(g.keyDown({ key: 'Enter' })).toBe(false);
    g.setOptions({ cellEdit: true, columns: [{ id: 'name', field: 'name', editable: false }, 'startDate'] });
    expect(g.startEdit('m', 'name')).toBe(false);
    expect(g.getState().columns.items.map((column) => column.editable)).toEqual([false, true]);
    g.keyDown({ key: 'Enter' });
    expect(editing(g)?.columnId).toBe('startDate');
    expect(() => make({ columns: [{ id: 'x', editable: 'yes' as unknown as boolean }] })).toThrow(/editable/);
    expect(() => make({ cellEdit: 1 as unknown as boolean })).toThrow(/cellEdit/);
  });
});

describe('what an edit does', () => {
  it('renames, as one undoable change', () => {
    const g = make();
    expect(edit(g, 'm', 'name', 'New name')).toBe(true);
    expect(task(g, 'm')?.name).toBe('New name');
    g.undo();
    expect(task(g, 'm')?.name).toBe('Manual');
  });

  it('changes nothing when the value is the same', () => {
    const g = make();
    expect(edit(g, 'm', 'duration', '3d')).toBe(true);
    expect(edit(g, 'm', 'name', 'Manual')).toBe(true);
    expect(g.getState().history.canUndo).toBe(false);
  });

  it('moves a manual task to a new start date, keeping its time and duration', () => {
    const g = make();
    edit(g, 'm', 'startDate', '2026-10-13');
    expect(task(g, 'm')).toMatchObject({ startDate: day(13, 8), duration: 3 });
  });

  it('gives an automatic task "start no earlier than" the new date', () => {
    const g = make();
    edit(g, 'a', 'startDate', '2026-10-07');
    expect(task(g, 'a')).toMatchObject({
      constraintType: 'startnoearlierthan',
      constraintDate: day(7),
      startDate: day(7, 8),
    });
  });

  it('gives an unscheduled task a duration along with its start', () => {
    const g = make();
    edit(g, 'idea', 'startDate', '2026-10-07');
    expect(task(g, 'idea')).toMatchObject({ startDate: day(7, 8), endDate: day(7, 16), duration: 1 });
  });

  it('sets the end date: the same time that day, or the next midnight for whole days', () => {
    const g = make();
    edit(g, 'm', 'endDate', '2026-10-09');
    expect(task(g, 'm')).toMatchObject({ endDate: day(9, 16), duration: 4 });
    edit(g, 'days', 'endDate', '2026-10-15');
    expect(task(g, 'days')?.endDate).toBe(day(16));
  });

  it('refuses an end before the start', () => {
    const g = make();
    expect(edit(g, 'm', 'endDate', '2026-10-05')).toBe(false);
    expect(editing(g)?.error).toMatch(/after the start/);
    expect(task(g, 'm')?.endDate).toBe(day(8, 16));
  });

  it('sets exact times with the date and time field', () => {
    const g = make({ preset: 'hourAndDay' });
    edit(g, 'm', 'endDate', '2026-10-08T12:00');
    expect(task(g, 'm')?.endDate).toBe(day(8, 12));
  });

  it('reads durations with units, as MS Project does', () => {
    const g = make();
    const cases: [string, number, string][] = [
      ['5', 5, 'day'],
      ['2w', 2, 'week'],
      ['2 weeks', 2, 'week'],
      ['4h', 4, 'hour'],
      ['1,5d', 1.5, 'day'],
      ['1.5 days', 1.5, 'day'],
      ['30m', 30, 'minute'],
      ['1mo', 1, 'month'],
      [' 3 D ', 3, 'day'],
    ];
    for (const [text, duration, unit] of cases) {
      expect(edit(g, 'a', 'duration', text)).toBe(true);
      expect(task(g, 'a')).toMatchObject({ duration, durationUnit: unit });
    }
    edit(g, 'a', 'duration', '0');
    expect(task(g, 'a')?.duration).toBe(0); // a milestone
  });

  it('refuses durations it cannot read', () => {
    const g = make();
    for (const text of ['', '-1', 'abc', '3x', 'Infinity', '1e400', '2d3']) {
      expect(edit(g, 'a', 'duration', text)).toBe(false);
      expect(editing(g)?.error).toBeTruthy();
      g.cancelEdit();
    }
    expect(task(g, 'a')?.duration).toBe(1);
    expect(g.getState().history.canUndo).toBe(false);
  });

  it('sets the percentage done from 0 to 100', () => {
    const g = make();
    edit(g, 'm', 'percentDone', '75');
    expect(task(g, 'm')?.percentDone).toBe(75);
    edit(g, 'm', 'percentDone', '12.5 %');
    expect(task(g, 'm')?.percentDone).toBe(12.5);
    for (const text of ['101', '-1', 'x', '']) expect(edit(g, 'm', 'percentDone', text)).toBe(false);
  });

  it('refuses dates it cannot read', () => {
    const g = make();
    for (const text of ['', '2026-13-01', '2026-02-30', '12026-01-01', '0999-01-01', 'tomorrow']) {
      expect(edit(g, 'm', 'startDate', text)).toBe(false);
      expect(editing(g)?.error).toBeTruthy();
      g.cancelEdit();
    }
    expect(task(g, 'm')?.startDate).toBe(day(6, 8));
  });

  it('reads dates in the project time zone, across daylight saving time', () => {
    const oslo = make({
      defaultData: {
        settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-19' },
        tasks: [{ id: 'm', manuallyScheduled: true, startDate: '2026-10-20T08:00', duration: 1 }],
      },
    });
    edit(oslo, 'm', 'startDate', '2026-10-26'); // after the clocks went back on the 25th
    expect(task(oslo, 'm')?.startDate).toBe(Date.UTC(2026, 9, 26, 7));
    // Cairo skips midnight when daylight saving time starts (24 April 2026): the date still works.
    const cairo = make({
      defaultData: {
        settings: { timeZone: 'Africa/Cairo', startDate: '2026-04-20' },
        tasks: [{ id: 'a', duration: 1 }],
      },
    });
    expect(edit(cairo, 'a', 'startDate', '2026-04-24')).toBe(true);
    expect(task(cairo, 'a')?.constraintDate).toBe(Date.UTC(2026, 3, 23, 22)); // 01:00 local, right after the gap
  });

  it('reads dates on the southern hemisphere, in the repeated hour and in local time', () => {
    const sydney = make({
      defaultData: {
        settings: { timeZone: 'Australia/Sydney', startDate: '2026-09-28' },
        tasks: [{ id: 'm', manuallyScheduled: true, startDate: '2026-09-30T08:00', duration: 1 }],
      },
    });
    edit(sydney, 'm', 'startDate', '2026-10-05'); // the clocks went forward on the 4th: UTC+11
    expect(task(sydney, 'm')?.startDate).toBe(Date.UTC(2026, 9, 4, 21));
    const oslo = make({
      preset: 'hourAndDay',
      defaultData: {
        settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-24' },
        tasks: [{ id: 'm', manuallyScheduled: true, startDate: '2026-10-24T08:00', duration: 1 }],
      },
    });
    edit(oslo, 'm', 'startDate', '2026-10-25T02:30'); // happens twice: the first time (summer time)
    expect(task(oslo, 'm')?.startDate).toBe(Date.UTC(2026, 9, 25, 0, 30));
    const local = make({
      defaultData: {
        settings: { timeZone: 'local', startDate: '2026-10-05' },
        tasks: [{ id: 'm', manuallyScheduled: true, startDate: '2026-10-06T08:00', duration: 1 }],
      },
    });
    edit(local, 'm', 'startDate', '2026-10-13');
    const start = task(local, 'm')?.startDate as number;
    expect(toWallTime(start, 'local')).toMatchObject({ year: 2026, month: 10, day: 13, hour: 8, minute: 0 });
  });

  it('refuses unreasonably long durations and spans (a typo in a year, say)', () => {
    const g = make();
    for (const text of ['200y', '99999999y', '999999999999999999999d', '6000d']) {
      expect(edit(g, 'a', 'duration', text)).toBe(false);
      expect(editing(g)?.error).toMatch(/at most/);
      g.cancelEdit();
    }
    expect(edit(g, 'm', 'endDate', '2060-01-01')).toBe(false);
    expect(editing(g)?.error).toMatch(/at most/);
    g.cancelEdit();
    expect(edit(g, 'a', 'duration', '10y')).toBe(true); // long, but fine
    expect(task(g, 'a')).toMatchObject({ duration: 10, durationUnit: 'year' });
  });

  it('gives validateChange the task as it is before the edit, as a drag does', () => {
    const validateChange = vi.fn((_change: ProposedChange) => true);
    const last = () => validateChange.mock.lastCall?.[0] as ProposedChange & { task: Task };
    const g = make({ validateChange });
    edit(g, 'm', 'percentDone', '10');
    expect(last()).toMatchObject({ kind: 'progress', percentDone: 10 });
    expect(last().task.percentDone).toBe(50);
    edit(g, 'a', 'startDate', '2026-10-09');
    expect(last()).toMatchObject({ kind: 'move', start: day(9, 8) });
    expect(last().task.startDate).toBe(day(5, 8));
  });

  it('asks validateChange with the change the edit really makes', () => {
    const validateChange = vi.fn(() => 'Not on Fridays');
    const g = make({ validateChange });
    expect(edit(g, 'a', 'startDate', '2026-10-09')).toBe(false);
    expect(validateChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'move', start: day(9, 8), end: day(9, 16) }),
    );
    expect(editing(g)?.error).toBe('Not on Fridays');
    g.cancelEdit();
    edit(g, 'm', 'duration', '4');
    expect(validateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'resize', end: day(9, 16) }),
    );
    edit(g, 'm', 'percentDone', '10');
    expect(validateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'progress', percentDone: 10 }),
    );
    validateChange.mockClear();
    expect(edit(g, 'm', 'name', 'x')).toBe(true);
    expect(validateChange).not.toHaveBeenCalled();
    g.setOptions({
      validateChange: () => {
        throw new Error('validator bug');
      },
    });
    expect(edit(g, 'm', 'percentDone', '20')).toBe(false);
    expect(editing(g)?.error).toBe('validator bug');
  });

  it('only reports the edit in controlled mode', () => {
    let data: ProjectInput | ProjectData = input;
    const onChange = vi.fn((change: GanttDataChange) => {
      data = change.data;
    });
    const g = createGantt({ data: input, onChange, columns: COLUMNS });
    expect(edit(g, 'm', 'name', 'Controlled')).toBe(true);
    expect(task(g, 'm')?.name).toBe('Manual');
    g.setOptions({ data });
    expect(task(g, 'm')?.name).toBe('Controlled');
  });
});

describe('keys in the editor', () => {
  it('cancels with Escape', () => {
    const g = make();
    g.startEdit('m', 'name');
    g.editInput('Changed');
    expect(g.editKeyDown({ key: 'Escape' })).toBe(true);
    expect(editing(g)).toBeNull();
    expect(task(g, 'm')?.name).toBe('Manual');
  });

  it('moves to the next and previous editable cell with Tab, across rows', () => {
    const g = make();
    g.startEdit('m', 'percentDone');
    g.editInput('60');
    expect(g.editKeyDown({ key: 'Tab' })).toBe(true);
    expect(task(g, 'm')?.percentDone).toBe(60);
    expect(editing(g)).toMatchObject({ taskId: 'a', columnId: 'name' }); // the note column is skipped
    g.editKeyDown({ key: 'Tab', shift: true });
    expect(editing(g)).toMatchObject({ taskId: 'm', columnId: 'percentDone' });
    g.startEdit('p', 'name');
    g.editKeyDown({ key: 'Tab' });
    expect(editing(g)).toMatchObject({ taskId: 'c', columnId: 'name' }); // the parent's other cells are skipped
    expect(g.getState().activeId).toBe('c');
  });

  it('stays on an invalid value, and closes after the last cell', () => {
    const g = make();
    g.startEdit('m', 'duration');
    g.editInput('nonsense');
    expect(g.editKeyDown({ key: 'Tab' })).toBe(true);
    expect(editing(g)).toMatchObject({ columnId: 'duration', text: 'nonsense' });
    expect(editing(g)?.error).toBeTruthy();
    g.editInput('4d');
    expect(editing(g)?.error).toBeNull(); // typing clears the message
    g.startEdit('days', 'percentDone');
    g.editKeyDown({ key: 'Tab' });
    expect(editing(g)).toBeNull();
  });

  it('leaves other keys to the field', () => {
    const g = make();
    g.startEdit('m', 'name');
    for (const key of ['a', 'ArrowLeft', 'Home', 'Backspace', ' '])
      expect(g.editKeyDown({ key })).toBe(false);
    expect(g.editKeyDown(null as unknown as { key: string })).toBe(false);
  });

  it('reports an invalid commit (the renderer then cancels, e.g. on blur)', () => {
    const g = make();
    g.startEdit('m', 'percentDone');
    g.editInput('500');
    expect(g.commitEdit()).toBe(false);
    expect(editing(g)?.error).toBeTruthy();
    g.cancelEdit();
    expect(g.commitEdit()).toBe(false); // nothing open
  });
});

describe('a field that was not typed in', () => {
  it('follows the value when it changes elsewhere, and saves nothing', () => {
    const g = make();
    g.startEdit('m', 'startDate');
    g.transact((tx) => {
      tx.tasks.update('m', { startDate: day(20, 8) });
    });
    expect(editing(g)?.text).toBe('2026-10-20');
    expect(g.commitEdit()).toBe(true);
    expect(task(g, 'm')?.startDate).toBe(day(20, 8));
  });

  it('keeps what was typed when the value changes elsewhere', () => {
    const g = make();
    g.startEdit('m', 'name');
    g.editInput('Mine');
    g.transact((tx) => {
      tx.tasks.update('m', { name: 'Theirs' });
    });
    expect(editing(g)?.text).toBe('Mine');
  });

  it('moves on with Tab in controlled mode without writing old values back', () => {
    let data: ProjectInput | ProjectData = input;
    const g = createGantt({
      data: input,
      columns: COLUMNS,
      onChange: (change: GanttDataChange) => {
        data = change.data;
      },
    });
    g.startEdit('m', 'startDate');
    g.editInput('2026-10-13');
    g.editKeyDown({ key: 'Tab' });
    expect(editing(g)?.columnId).toBe('endDate');
    g.setOptions({ data }); // the app accepts the new start
    expect(editing(g)?.text).toBe('2026-10-15'); // the moved end, not the old one
    g.editKeyDown({ key: 'Tab' }); // nothing typed
    expect(editing(g)?.columnId).toBe('duration');
    g.setOptions({ data });
    expect(task(g, 'm')).toMatchObject({ startDate: day(13, 8), endDate: day(15, 16), duration: 3 });
  });

  it('closes when the kind of field changes (the time axis now shows hours)', () => {
    const g = make();
    g.startEdit('m', 'startDate');
    g.setOptions({ preset: 'hourAndDay' });
    expect(editing(g)).toBeNull();
  });
});

describe('the selection while editing', () => {
  it('reports the row an edit moves the cursor to', () => {
    const onSelectionChange = vi.fn();
    const g = make({ onSelectionChange });
    g.startEdit('m', 'percentDone');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['m']);
    g.editKeyDown({ key: 'Tab' });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
    g.rowClick('m');
    g.keyDown({ key: 'Enter' });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['m']);
  });

  it('saves an open edit before a press in the timeline or a key on the chart', () => {
    const g = make();
    g.startEdit('m', 'name');
    g.editInput('Pressed');
    g.pointerDown({ x: 5, y: 5 });
    expect(editing(g)).toBeNull();
    expect(task(g, 'm')?.name).toBe('Pressed');
    g.startEdit('m', 'duration');
    g.editInput('nonsense');
    g.keyDown({ key: 'ArrowDown' }); // the field is gone (e.g. scrolled away): a key on the chart
    expect(editing(g)).toBeNull();
    expect(task(g, 'm')?.duration).toBe(3);
  });
});

describe('an edit on a stale basis', () => {
  it('closes when the task goes, is hidden or becomes a parent, or editing is turned off', () => {
    const g = make();
    g.startEdit('c', 'name');
    g.toggle('p');
    expect(editing(g)).toBeNull();
    g.toggle('p');
    g.startEdit('a', 'duration');
    g.transact((tx) => {
      tx.tasks.add({ id: 'a1', duration: 1 }, { parentId: 'a' });
    });
    expect(editing(g)).toBeNull();
    g.startEdit('m', 'name');
    g.transact((tx) => {
      tx.tasks.remove('m');
    });
    expect(editing(g)).toBeNull();
    g.startEdit('days', 'name');
    g.setOptions({ cellEdit: false });
    expect(editing(g)).toBeNull();
    g.setOptions({ cellEdit: true });
    g.startEdit('days', 'percentDone');
    g.setOptions({ columns: ['name'] });
    expect(editing(g)).toBeNull();
  });

  it('keeps the typed text when the row scrolls out of the rendered window and back', () => {
    const many: ProjectInput = {
      tasks: Array.from({ length: 200 }, (_, i) => ({ id: `t${String(i)}`, name: `T${String(i)}` })),
    };
    const g = make({ defaultData: many });
    g.startEdit('t0', 'name');
    g.editInput('typed');
    g.setViewport({ scrollTop: 5000 });
    expect(editing(g)?.text).toBe('typed');
    g.setViewport({ scrollTop: 0 });
    g.editKeyDown({ key: 'Enter' });
    expect(task(g, 't0')?.name).toBe('typed');
  });

  it('ignores input without an open edit, and does nothing after destroy', () => {
    const g = make();
    g.editInput('x');
    expect(g.editKeyDown({ key: 'Enter' })).toBe(false);
    g.destroy();
    expect(g.startEdit('m', 'name')).toBe(false);
  });
});
