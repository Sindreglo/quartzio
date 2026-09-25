import { describe, expect, it } from 'vitest';
import { createProject } from '../data/project';
import { getTreeIndex } from '../data/tree';
import type { DependencyInput, Id, ProjectInput, ProjectState, TaskInput } from '../data/types';
import { getWorkingCalendar } from '../calendar/project';
import { toWallTime } from '../util/zone';
import { scheduleProject } from './schedule';

// Standard calendar: Monday–Friday 08:00–16:00. Monday 5 October 2026 is the first day in most tests.
const scheduled = (input: ProjectInput) =>
  createProject(
    { ...input, settings: { timeZone: 'UTC', ...input.settings } },
    { propagate: scheduleProject },
  );

type Scheduled = ReturnType<typeof scheduled>;

const wall = (time: number | null, zone = 'UTC') => {
  if (time === null) return null;
  const w = toWallTime(time, zone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
};
const task = (project: Scheduled, id: Id) => project.getState().tasks.byId.get(id);
/** "MM-DD HH:mm → MM-DD HH:mm" */
const span = (project: Scheduled, id: Id, zone = 'UTC') => {
  const t = task(project, id);
  return `${String(wall(t?.startDate ?? null, zone))} → ${String(wall(t?.endDate ?? null, zone))}`;
};
const days = (id: Id, duration: number, extra: Partial<TaskInput> = {}): TaskInput => ({
  id,
  duration,
  ...extra,
});
const link = (from: Id, to: Id, extra: Partial<DependencyInput> = {}): DependencyInput => ({
  id: `${String(from)}-${String(to)}`,
  from,
  to,
  ...extra,
});
const start = { settings: { startDate: '2026-10-05' } };

describe('project start', () => {
  it('is set to the earliest task start when not given, and written back', () => {
    const project = scheduled({
      tasks: [
        { id: 'a', startDate: '2026-10-07', duration: 1 },
        { id: 'b', startDate: '2026-10-09' },
      ],
    });
    expect(wall(project.getState().settings.startDate)).toBe('10-07 00:00');
  });

  it('leaves everything unscheduled when there are no dates at all', () => {
    const project = scheduled({ tasks: [days('a', 2)] });
    expect(project.getState().settings.startDate).toBeNull();
    expect(task(project, 'a')).toMatchObject({ startDate: null, endDate: null, duration: 2 });
  });
});

describe('automatic scheduling (as soon as possible)', () => {
  it('starts tasks at the project start, at the next working time, whatever their own start says', () => {
    const project = scheduled({ ...start, tasks: [days('a', 2, { startDate: '2026-10-08' })] });
    expect(span(project, 'a')).toBe('10-05 08:00 → 10-06 16:00');
  });

  it('places a finish-to-start successor after its predecessor, skipping non-working time', () => {
    const project = scheduled({
      ...start,
      tasks: [days('a', 5), days('b', 1)],
      dependencies: [link('a', 'b')],
    });
    // a ends Friday 16:00, so b starts Monday 08:00.
    expect(span(project, 'a')).toBe('10-05 08:00 → 10-09 16:00');
    expect(span(project, 'b')).toBe('10-12 08:00 → 10-12 16:00');
  });

  it.each([
    ['FS', 0, '10-07 08:00 → 10-07 16:00'],
    ['FS', 1, '10-08 08:00 → 10-08 16:00'],
    ['FS', -1, '10-06 08:00 → 10-06 16:00'], // lead: start a day before a ends
    ['SS', 0, '10-05 08:00 → 10-05 16:00'],
    ['SS', 1, '10-06 08:00 → 10-06 16:00'],
    ['FF', 0, '10-06 08:00 → 10-06 16:00'], // ends when a ends
    ['SF', 1, '10-05 08:00 → 10-05 16:00'], // ends a day after a starts
  ] as const)('handles %s with lag %i', (type, lag, expected) => {
    const project = scheduled({
      ...start,
      tasks: [days('a', 2), days('b', 1)],
      dependencies: [link('a', 'b', { type, lag })],
    });
    expect(span(project, 'b')).toBe(expected);
  });

  it('takes the latest requirement of several predecessors', () => {
    const project = scheduled({
      ...start,
      tasks: [days('a', 1), days('b', 3), days('c', 1)],
      dependencies: [link('a', 'c'), link('b', 'c')],
    });
    expect(span(project, 'c')).toBe('10-08 08:00 → 10-08 16:00');
  });

  it('places zero-length tasks (milestones) where required, without moving them to working time', () => {
    const project = scheduled({
      ...start,
      tasks: [days('a', 1), days('m', 0)],
      dependencies: [link('a', 'm')],
    });
    expect(span(project, 'm')).toBe('10-05 16:00 → 10-05 16:00');
  });

  it('treats a task with only a start as zero-length, and leaves one with no dates or duration unscheduled', () => {
    const project = scheduled({
      ...start,
      tasks: [days('a', 1), { id: 'only-start', startDate: '2026-10-09' }, { id: 'idea' }],
      dependencies: [link('a', 'only-start'), link('a', 'idea')],
    });
    expect(task(project, 'only-start')).toMatchObject({ duration: 0 });
    expect(span(project, 'only-start')).toBe('10-05 16:00 → 10-05 16:00');
    expect(task(project, 'idea')).toMatchObject({ startDate: null, endDate: null, duration: null });
  });

  it('pushes a whole chain when a duration changes, in one patch', () => {
    const project = scheduled({
      ...start,
      tasks: [days('a', 1), days('b', 1), days('c', 1)],
      dependencies: [link('a', 'b'), link('b', 'c')],
    });
    const patch = project.transact((tx) => {
      tx.tasks.update('a', { duration: 3 });
    });
    expect(span(project, 'c')).toBe('10-09 08:00 → 10-09 16:00');
    const updated = new Set(patch?.operations.map((op) => (op.type === 'update' ? op.id : null)));
    expect(updated).toEqual(new Set(['a', 'b', 'c']));
  });

  it('works in a zone with daylight saving time (Oslo, end of October)', () => {
    const project = scheduled({
      settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-22' },
      tasks: [days('a', 2), days('b', 2)],
      dependencies: [link('a', 'b')],
    });
    // Sunday 25 October is 25 hours long; working hours stay 08:00–16:00 local.
    expect(span(project, 'a', 'Europe/Oslo')).toBe('10-22 08:00 → 10-23 16:00');
    expect(span(project, 'b', 'Europe/Oslo')).toBe('10-26 08:00 → 10-27 16:00');
  });

  it('works in a zone where midnight is skipped (Cairo)', () => {
    // 24 April 2026 starts at 01:00 in Cairo.
    const project = scheduled({
      settings: { timeZone: 'Africa/Cairo', startDate: '2026-04-24' },
      tasks: [days('a', 1)],
    });
    expect(span(project, 'a', 'Africa/Cairo')).toBe('04-24 08:00 → 04-24 16:00');
  });
});

describe('start, end and duration', () => {
  it('derives the duration from start and end when it is missing', () => {
    const project = scheduled({
      ...start,
      tasks: [{ id: 'a', startDate: '2026-10-05T08:00', endDate: '2026-10-07T16:00' }],
    });
    expect(task(project, 'a')?.duration).toBe(3);
  });

  it('keeps an end in non-working time that amounts to the same duration', () => {
    const project = scheduled({
      ...start,
      tasks: [days('m', 3, { manuallyScheduled: true, startDate: '2026-10-05', endDate: '2026-10-08' })],
    });
    // 00:00 Monday to 00:00 Thursday is three working days, like Monday 00:00 to Wednesday 16:00.
    expect(span(project, 'm')).toBe('10-05 00:00 → 10-08 00:00');
    expect(scheduleProject(project.getState(), null)).toEqual([]);
  });

  it('lets the duration win over an inconsistent end when loading', () => {
    const project = scheduled({
      ...start,
      tasks: [days('a', 1, { startDate: '2026-10-05', endDate: '2026-10-20' })],
    });
    expect(span(project, 'a')).toBe('10-05 08:00 → 10-05 16:00');
  });

  it('keeps a new end from a transaction and derives the duration', () => {
    const project = scheduled({ ...start, tasks: [days('a', 1)] });
    project.transact((tx) => {
      tx.tasks.update('a', { endDate: '2026-10-07T12:00' });
    });
    expect(span(project, 'a')).toBe('10-05 08:00 → 10-07 12:00');
    expect(task(project, 'a')?.duration).toBe(2.5);
  });

  it('moves the end when the duration or its unit changes', () => {
    const project = scheduled({ ...start, tasks: [days('a', 1)] });
    project.transact((tx) => {
      tx.tasks.update('a', { duration: 4, durationUnit: 'hour' });
    });
    expect(span(project, 'a')).toBe('10-05 08:00 → 10-05 12:00');
  });

  it('ignores a new start on an automatically scheduled task (it goes back to as soon as possible)', () => {
    const project = scheduled({ ...start, tasks: [days('a', 1)] });
    project.transact((tx) => {
      tx.tasks.update('a', { startDate: '2026-10-08' });
    });
    expect(span(project, 'a')).toBe('10-05 08:00 → 10-05 16:00');
  });

  it('reschedules everything when settings change the length of a day', () => {
    const project = scheduled({ ...start, tasks: [days('a', 1)] });
    project.transact((tx) => {
      tx.settings.update({ hoursPerDay: 4 });
    });
    expect(span(project, 'a')).toBe('10-05 08:00 → 10-05 12:00');
  });
});

describe('"start no earlier than" constraints', () => {
  const snet = (date: string) => ({ constraintType: 'startnoearlierthan' as const, constraintDate: date });

  it('hold an automatic task back until the constraint date, at the next working time', () => {
    const project = scheduled({ ...start, tasks: [days('a', 1, snet('2026-10-07'))] });
    expect(span(project, 'a')).toBe('10-07 08:00 → 10-07 16:00');
  });

  it('still let predecessors push the task later', () => {
    const project = scheduled({
      ...start,
      tasks: [days('p', 4), days('a', 1, snet('2026-10-06'))],
      dependencies: [link('p', 'a')],
    });
    expect(span(project, 'a')).toBe('10-09 08:00 → 10-09 16:00');
  });

  it('apply to all descendants of a parent, and are ignored by manually scheduled tasks', () => {
    const project = scheduled({
      ...start,
      tasks: [
        { id: 'g', ...snet('2026-10-08'), children: [days('c', 1), days('d', 2)] },
        days('m', 1, { manuallyScheduled: true, startDate: '2026-10-05T08:00', ...snet('2026-10-12') }),
      ],
    });
    expect(span(project, 'c')).toBe('10-08 08:00 → 10-08 16:00');
    expect(span(project, 'g')).toBe('10-08 08:00 → 10-09 16:00');
    expect(span(project, 'm')).toBe('10-05 08:00 → 10-05 16:00');
  });

  it('move the task when set in a transaction, and let it go back when removed', () => {
    const project = scheduled({ ...start, tasks: [days('a', 1)] });
    project.transact((tx) => {
      tx.tasks.update('a', snet('2026-10-12'));
    });
    expect(span(project, 'a')).toBe('10-12 08:00 → 10-12 16:00');
    project.transact((tx) => {
      tx.tasks.update('a', { constraintType: null, constraintDate: null });
    });
    expect(span(project, 'a')).toBe('10-05 08:00 → 10-05 16:00');
    expect(scheduleProject(project.getState(), null)).toEqual([]);
  });
});

describe('manually scheduled tasks', () => {
  it('keep their own dates, are not pushed by predecessors, and still push successors', () => {
    const project = scheduled({
      ...start,
      tasks: [
        days('a', 3),
        days('m', 1, { manuallyScheduled: true, startDate: '2026-10-06T10:00' }),
        days('b', 1),
      ],
      dependencies: [link('a', 'm'), link('m', 'b')],
    });
    expect(span(project, 'm')).toBe('10-06 10:00 → 10-07 10:00');
    expect(span(project, 'b')).toBe('10-07 10:00 → 10-08 10:00');
  });

  it('move with a new start, keeping their duration', () => {
    const project = scheduled({
      ...start,
      tasks: [days('m', 2, { manuallyScheduled: true, startDate: '2026-10-05T08:00' })],
    });
    project.transact((tx) => {
      tx.tasks.update('m', { startDate: '2026-10-12T08:00' });
    });
    expect(span(project, 'm')).toBe('10-12 08:00 → 10-13 16:00');
  });

  it('derive their start from end and duration', () => {
    const project = scheduled({
      ...start,
      tasks: [days('m', 1, { manuallyScheduled: true, endDate: '2026-10-07T16:00' })],
    });
    expect(span(project, 'm')).toBe('10-07 08:00 → 10-07 16:00');
  });
});

describe('parents', () => {
  it('span their children, with duration and progress weighted by duration', () => {
    const project = scheduled({
      ...start,
      tasks: [{ id: 'p', children: [days('a', 1, { percentDone: 100 }), days('b', 3, { percentDone: 0 })] }],
      dependencies: [link('a', 'b')],
    });
    expect(span(project, 'p')).toBe('10-05 08:00 → 10-08 16:00');
    expect(task(project, 'p')).toMatchObject({ duration: 4, percentDone: 25 });
  });

  it('roll up through several levels', () => {
    const project = scheduled({
      ...start,
      tasks: [{ id: 'g', children: [{ id: 'p', children: [days('a', 2)] }, days('b', 1)] }],
      dependencies: [link('a', 'b')],
    });
    expect(span(project, 'g')).toBe('10-05 08:00 → 10-07 16:00');
  });

  it('pass dependencies on them to all their children', () => {
    const project = scheduled({
      ...start,
      tasks: [days('x', 2), { id: 'p', children: [days('a', 1), days('b', 1)] }],
      dependencies: [link('x', 'p')],
    });
    expect(span(project, 'a')).toBe('10-07 08:00 → 10-07 16:00');
    expect(span(project, 'b')).toBe('10-07 08:00 → 10-07 16:00');
    expect(span(project, 'p')).toBe('10-07 08:00 → 10-07 16:00');
  });

  it('push successors from their rolled-up end', () => {
    const project = scheduled({
      ...start,
      tasks: [{ id: 'p', children: [days('a', 1), days('b', 2)] }, days('y', 1)],
      dependencies: [link('p', 'y')],
    });
    expect(span(project, 'y')).toBe('10-07 08:00 → 10-07 16:00');
  });

  it('keep their own dates when manually scheduled, and do not constrain their children', () => {
    const project = scheduled({
      ...start,
      tasks: [
        days('x', 3),
        {
          id: 'p',
          manuallyScheduled: true,
          startDate: '2026-10-12T08:00',
          duration: 1,
          children: [days('a', 2)],
        },
      ],
      dependencies: [link('x', 'p')],
    });
    expect(span(project, 'p')).toBe('10-12 08:00 → 10-12 16:00');
    expect(span(project, 'a')).toBe('10-05 08:00 → 10-06 16:00');
  });
});

describe('replaying, undoing and redoing', () => {
  it('replays a patch exactly, also with durations that are not whole numbers', () => {
    const project = scheduled({
      settings: { startDate: '2026-10-05', hoursPerDay: 7.3 },
      tasks: [{ id: 'a', startDate: '2026-10-05', endDate: '2026-10-19T10:00', durationUnit: 'month' }],
    });
    const before = project.toData();
    const patch = project.transact((tx) => {
      tx.settings.update({ hoursPerDay: 8 });
    });
    const after = project.toData();
    expect(scheduleProject(project.getState(), patch?.operations ?? [])).toEqual([]);
    const redo = createProject(before, { propagate: scheduleProject });
    redo.apply(patch?.operations ?? []);
    expect(redo.toData()).toEqual(after);
  });

  it('undoes exactly, leaving durations of pushed tasks alone', () => {
    const project = scheduled({
      ...start,
      tasks: [days('a', 1), days('b', 0.123456789)],
      dependencies: [link('a', 'b')],
    });
    const before = project.toData();
    const patch = project.transact((tx) => {
      tx.tasks.update('a', { duration: 2 });
    });
    project.apply(patch?.inverse ?? []);
    expect(project.toData()).toEqual(before);
  });
});

describe('robustness', () => {
  it('derives the project start from a manual task that only has an end, in one go', () => {
    const project = scheduled({
      tasks: [days('m', 2, { manuallyScheduled: true, endDate: '2026-10-09T16:00' }), days('a', 1)],
    });
    expect(wall(project.getState().settings.startDate)).toBe('10-08 08:00');
    expect(span(project, 'a')).toBe('10-08 08:00 → 10-08 16:00');
    expect(scheduleProject(project.getState(), null)).toEqual([]);
  });

  it('never throws for absurd lags (the requirement is skipped)', () => {
    expect(() =>
      scheduled({
        ...start,
        tasks: [days('a', 2), days('b', 1)],
        dependencies: [link('a', 'b', { lag: 30_000 })],
      }),
    ).not.toThrow();
  });

  it('passes requirements on a parent through a manually scheduled task in between', () => {
    const project = scheduled({
      ...start,
      tasks: [
        days('x', 5),
        {
          id: 'g',
          children: [
            {
              id: 'mp',
              manuallyScheduled: true,
              startDate: '2026-10-05T08:00',
              duration: 1,
              children: [days('c', 1)],
            },
            days('s', 1),
          ],
        },
      ],
      dependencies: [link('x', 'g')],
    });
    // x ends Friday: everything below g, also c under the manual mp, starts Monday.
    expect(span(project, 'c')).toBe('10-12 08:00 → 10-12 16:00');
    expect(span(project, 's')).toBe('10-12 08:00 → 10-12 16:00');
    // mp itself keeps its own dates.
    expect(span(project, 'mp')).toBe('10-05 08:00 → 10-05 16:00');
  });

  it('rejects a new end before the start instead of silently undoing it', () => {
    const project = scheduled({ ...start, tasks: [days('a', 2)] });
    expect(() =>
      project.transact((tx) => {
        tx.tasks.update('a', { endDate: '2026-10-01' });
      }),
    ).toThrow(/before "startDate"/);
  });

  it('repairs a new start after the end the same way for transactions and raw operations', () => {
    const input = {
      ...start,
      tasks: [days('m', 1, { manuallyScheduled: true, startDate: '2026-10-05T08:00' })],
    };
    const viaApply = scheduled(input);
    viaApply.apply([
      { type: 'update', store: 'tasks', id: 'm', changes: { startDate: Date.UTC(2026, 9, 12, 8) } },
    ]);
    const viaTransact = scheduled(input);
    viaTransact.transact((tx) => {
      tx.tasks.update('m', { startDate: Date.UTC(2026, 9, 12, 8) });
    });
    expect(span(viaApply, 'm')).toBe('10-12 08:00 → 10-12 16:00');
    expect(viaApply.toData()).toEqual(viaTransact.toData());
  });

  it('never throws for a calendar without working time, and keeps the state valid', () => {
    const load = () =>
      scheduled({
        settings: { startDate: '2026-10-05', calendarId: 'none' },
        calendars: [{ id: 'none', week: {} }],
        tasks: [days('a', 2), days('b', 1)],
        dependencies: [link('a', 'b')],
      });
    expect(load).not.toThrow();
  });

  it('never throws for absurd durations', () => {
    expect(() =>
      scheduled({ ...start, tasks: [days('a', 1_000_000), days('b', 1)], dependencies: [link('a', 'b')] }),
    ).not.toThrow();
  });

  it('adds nothing to a state it already scheduled', () => {
    const project = scheduled({
      ...start,
      tasks: [
        { id: 'p', children: [days('a', 1.5, { percentDone: 30 }), days('b', 2)] },
        days('m', 1, { manuallyScheduled: true, startDate: '2026-10-06T11:00' }),
        { id: 'c', startDate: '2026-10-05T08:00', endDate: '2026-10-09T13:00' },
      ],
      dependencies: [
        link('a', 'b', { lag: -2, lagUnit: 'hour' }),
        link('p', 'm'),
        link('m', 'c', { type: 'FF' }),
      ],
    });
    expect(scheduleProject(project.getState(), null)).toEqual([]);
  });

  it('is idempotent and keeps every requirement, over many random projects', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const types = ['FS', 'SS', 'FF', 'SF'] as const;
    for (let run = 0; run < 60; run++) {
      const count = 3 + Math.floor(random() * 25);
      const tasks: TaskInput[] = [];
      for (let i = 0; i < count; i++) {
        const parent = i > 0 && random() < 0.3 ? `t${String(Math.floor(random() * i))}` : null;
        tasks.push({
          id: `t${String(i)}`,
          parentId: parent,
          duration: Math.floor(random() * 5 * 4) / 4,
          durationUnit: random() < 0.2 ? 'hour' : 'day',
          manuallyScheduled: random() < 0.15,
          startDate:
            random() < 0.5
              ? Date.UTC(2026, 9, 5 + Math.floor(random() * 10), Math.floor(random() * 24))
              : null,
          percentDone: Math.floor(random() * 101),
        });
      }
      // Dependencies only from lower to higher numbers, never within one branch: no cycles.
      const ancestors = (id: string): string[] => {
        const parentId = tasks.find((t) => t.id === id)?.parentId;
        return typeof parentId === 'string' ? [parentId, ...ancestors(parentId)] : [];
      };
      const dependencies: DependencyInput[] = [];
      for (let d = 0; d < count; d++) {
        const a = Math.floor(random() * count);
        const b = Math.floor(random() * count);
        const from = `t${String(Math.min(a, b))}`;
        const to = `t${String(Math.max(a, b))}`;
        if (from === to || ancestors(to).includes(from) || ancestors(from).includes(to)) continue;
        dependencies.push({
          id: `d${String(d)}`,
          from,
          to,
          type: types[Math.floor(random() * 4)] ?? 'FS',
          lag: Math.floor(random() * 5) - 2,
        });
      }
      let project: Scheduled;
      try {
        project = scheduled({ ...start, tasks, dependencies });
      } catch {
        continue; // a cycle through the hierarchy after all; the generator isn't perfect
      }
      const state = project.getState();
      expect(scheduleProject(state, null)).toEqual([]);
      assertRequirements(state);
    }
  });
});

/**
 * Every task has consistent dates, and every automatic successor meets its predecessors' requirements, in
 * working time (an end at 16:00 meets a requirement of 08:00 the next working day).
 */
function assertRequirements(state: ProjectState): void {
  const calendar = getWorkingCalendar(state);
  const tree = getTreeIndex(state.tasks);
  for (const t of state.tasks.byId.values()) {
    if (t.startDate !== null && t.endDate !== null) expect(t.endDate).toBeGreaterThanOrEqual(t.startDate);
  }
  for (const d of state.dependencies.byId.values()) {
    const from = state.tasks.byId.get(d.from);
    const to = state.tasks.byId.get(d.to);
    // Parents span their children, and manually scheduled children aren't pushed: check tasks without children.
    if (!from || !to || to.manuallyScheduled || d.lag < 0 || tree.children(to.id).length > 0) continue;
    if (from.startDate === null || from.endDate === null || to.startDate === null || to.endDate === null)
      continue;
    // Lag is ignored: with non-negative lag, the successor can't come before this.
    const pairs: Record<typeof d.type, [number, number]> = {
      FS: [to.startDate, from.endDate],
      SS: [to.startDate, from.startDate],
      FF: [to.endDate, from.endDate],
      SF: [to.endDate, from.startDate],
    };
    const [actual, required] = pairs[d.type];
    if (actual < required) expect(calendar.workingTimeBetween(actual, required)).toBe(0);
  }
}

describe('fuzzing edits', () => {
  it('stays idempotent, and replays, undoes and redoes exactly, across zones, units and settings', () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const zones = [
      'UTC',
      'Europe/Oslo',
      'Africa/Cairo',
      'Australia/Sydney',
      'America/Santiago',
      'Asia/Kolkata',
    ];
    const units = ['minute', 'hour', 'day', 'week', 'month'] as const;
    const types = ['FS', 'SS', 'FF', 'SF'] as const;
    let edits = 0;

    for (let run = 0; run < 25; run++) {
      const count = 3 + Math.floor(random() * 12);
      const tasks: TaskInput[] = Array.from({ length: count }, (_, i) => {
        const manual = random() < 0.25;
        const roll = random();
        return {
          id: `t${String(i)}`,
          parentId: i > 0 && random() < 0.25 ? `t${String(Math.floor(random() * i))}` : null,
          duration: roll < 0.15 ? null : Math.round(random() * 40) / 8,
          durationUnit: pick(units),
          manuallyScheduled: manual,
          startDate:
            random() < 0.4
              ? Date.UTC(2026, 9, 1 + Math.floor(random() * 20), Math.floor(random() * 24))
              : null,
          endDate: manual && random() < 0.4 ? Date.UTC(2026, 9, 22 + Math.floor(random() * 5), 10) : null,
          percentDone: Math.floor(random() * 101),
          ...(random() < 0.2
            ? {
                constraintType: 'startnoearlierthan' as const,
                constraintDate: Date.UTC(2026, 9, 3 + Math.floor(random() * 20), 9),
              }
            : {}),
        };
      });
      const dependencies: DependencyInput[] = [];
      for (let d = 0; d < count; d++) {
        const a = Math.floor(random() * count);
        const b = Math.floor(random() * count);
        if (a >= b) continue;
        dependencies.push({
          id: `d${String(d)}`,
          from: `t${String(a)}`,
          to: `t${String(b)}`,
          type: pick(types),
          lag: Math.floor(random() * 5) - 2,
          lagUnit: pick(['hour', 'day'] as const),
        });
      }
      let project: Scheduled;
      try {
        project = scheduled({
          settings: {
            timeZone: pick(zones),
            startDate: random() < 0.5 ? null : '2026-10-05',
            hoursPerDay: pick([8, 7.3, 24]),
          },
          tasks,
          dependencies,
        });
      } catch {
        continue; // a cycle through the hierarchy
      }
      expect(scheduleProject(project.getState(), null)).toEqual([]);

      for (let e = 0; e < 8; e++) {
        const before = project.toData();
        const id = pick(before.tasks).id;
        let patch;
        try {
          patch = project.transact((tx) => {
            const roll = random();
            if (roll < 0.3) tx.tasks.update(id, { duration: Math.round(random() * 30) / 4 });
            else if (roll < 0.38) tx.tasks.update(id, { manuallyScheduled: random() < 0.5 });
            else if (roll < 0.45) {
              tx.tasks.update(
                id,
                random() < 0.6
                  ? {
                      constraintType: 'startnoearlierthan',
                      constraintDate: Date.UTC(2026, 9, 1 + Math.floor(random() * 25), 10),
                    }
                  : { constraintType: null, constraintDate: null },
              );
            } else if (roll < 0.6) tx.settings.update({ hoursPerDay: pick([6, 7.5, 8]) });
            else if (roll < 0.7) tx.tasks.remove(id);
            else if (roll < 0.85) {
              const task = tx.tasks.get(id);
              if (task?.startDate != null)
                tx.tasks.update(id, { endDate: task.startDate + Math.floor(random() * 5) * 3_600_000 });
            } else tx.dependencies.add({ from: id, to: pick(before.tasks).id, type: pick(types) });
          });
        } catch {
          continue; // rejected (cycle, self-dependency): nothing changed
        }
        if (!patch) continue;
        edits++;
        const after = project.toData();
        expect(scheduleProject(project.getState(), null)).toEqual([]);
        const redo = createProject(before, { propagate: scheduleProject });
        redo.apply(patch.operations);
        expect(redo.toData()).toEqual(after);
        redo.apply(patch.inverse);
        expect(redo.toData()).toEqual(before);
      }
    }
    expect(edits).toBeGreaterThan(80);
  });
});
