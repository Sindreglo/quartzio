import { type ProjectInput, type TaskInput, VIEW_PRESETS } from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useMemo, useState } from 'react';

const noop = () => undefined;
const DAY = 86_400_000;

/** A date (YYYY-MM-DD) relative to Monday this week, so the today line is always in view. */
const fromMonday = (days: number): string => {
  const now = new Date();
  const monday = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - ((now.getDay() + 6) % 7) * DAY;
  return new Date(monday + days * DAY).toISOString().slice(0, 10);
};

const aroundToday = (): ProjectInput => ({
  tasks: [
    {
      id: 'plan',
      name: 'Planning',
      children: [
        { id: 'scope', name: 'Define scope', startDate: fromMonday(-7), duration: 3, percentDone: 100 },
        { id: 'budget', name: 'Approve budget', duration: 2, percentDone: 60 },
      ],
    },
    {
      id: 'build',
      name: 'Build',
      children: [
        { id: 'design', name: 'Design', duration: 5, percentDone: 30 },
        { id: 'develop', name: 'Develop', duration: 10 },
        { id: 'test', name: 'Test', duration: 5 },
      ],
    },
    { id: 'launch', name: 'Launch', duration: 0 },
  ],
  // Scheduled from the first task's start: design lands on this week, around the today line.
  dependencies: [
    { id: 'd1', from: 'scope', to: 'budget' },
    { id: 'd2', from: 'budget', to: 'design' },
    { id: 'd3', from: 'design', to: 'develop' },
    { id: 'd4', from: 'develop', to: 'test' },
    { id: 'd5', from: 'test', to: 'launch' },
  ],
});

// The edge cases use a fixed axis (12–26 October 2026), so some bars start before or end after it. They're
// manually scheduled, so they keep the dates given here instead of starting as soon as possible.
const EDGE_AXIS = { startDate: '2026-10-12', endDate: '2026-10-26' };
const manual = (tasks: TaskInput[]): TaskInput[] =>
  tasks.map((task) => ({
    ...task,
    manuallyScheduled: true,
    ...(task.children ? { children: manual([...task.children]) } : {}),
  }));
const edgeCases = (): ProjectInput => ({
  tasks: manual([
    { id: 'before', name: 'Starts before the axis', startDate: '2026-10-01', endDate: '2026-10-14' },
    { id: 'after', name: 'Ends after the axis', startDate: '2026-10-22', endDate: '2026-11-20' },
    { id: 'across', name: 'Covers the whole axis', startDate: '2026-01-01', endDate: '2027-12-31' },
    { id: 'outside', name: 'Entirely outside the axis', startDate: '2026-12-01', endDate: '2026-12-05' },
    {
      id: 'long',
      name: 'A task with a very long name that does not fit in its bar and should be cut off with an ellipsis',
      startDate: '2026-10-13',
      duration: 2,
    },
    { id: 'short', name: 'One hour', startDate: '2026-10-15T09:00', endDate: '2026-10-15T10:00' },
    { id: 'edge-milestone', name: 'Milestone on the axis start', startDate: '2026-10-12' },
    { id: 'undated', name: 'Unscheduled (no bar)' },
    {
      id: 'thin-parent',
      name: 'Parent of two milestones on the same day',
      children: [
        { id: 'm1', name: 'Milestone A', startDate: '2026-10-20' },
        { id: 'm2', name: 'Milestone B', startDate: '2026-10-20' },
      ],
    },
    {
      id: 'undated-parent',
      name: 'Parent of an undated child',
      children: [{ id: 'c', name: 'Undated child' }],
    },
  ]),
});

const DATASETS = { today: aroundToday, edge: edgeCases, empty: (): ProjectInput => ({}) };

/**
 * Task bars (with progress), summary bars for parents, milestones for zero-length tasks, the today line and
 * non-working time from the project calendar (with a holiday on Wednesday next week). The edge-case dataset
 * shows bars beyond the axis, very short and very long tasks, and parents without a real span.
 */
export function BarsDemo() {
  const [dataset, setDataset] = useState<keyof typeof DATASETS>('today');
  const [preset, setPreset] = useState('weekAndDay');
  const [showToday, setShowToday] = useState(true);
  const [showNonWorkingTime, setShowNonWorkingTime] = useState(true);
  const [holiday, setHoliday] = useState(true);

  const data = useMemo<ProjectInput>(
    () => ({
      ...DATASETS[dataset](),
      settings: { timeZone: 'Europe/Oslo', calendarId: 'office' },
      calendars: [
        { id: 'office', exceptions: holiday ? [{ startDate: fromMonday(9), name: 'Company day off' }] : [] },
      ],
    }),
    [dataset, holiday],
  );

  const toggle = (label: string, checked: boolean, set: (value: boolean) => void) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          set(event.target.checked);
        }}
      />
      {label}
    </label>
  );

  return (
    <div className="pg-stack">
      <div className="pg-toolbar pg-form">
        <label>
          Data
          <select
            value={dataset}
            onChange={(event) => {
              setDataset(event.target.value as keyof typeof DATASETS);
            }}
          >
            <option value="today">Around today</option>
            <option value="edge">Edge cases</option>
            <option value="empty">Empty</option>
          </select>
        </label>
        <label>
          Preset
          <select
            value={preset}
            onChange={(event) => {
              setPreset(event.target.value);
            }}
          >
            {VIEW_PRESETS.map((option) => (
              <option key={option.id}>{option.id}</option>
            ))}
          </select>
        </label>
        {toggle('Today line', showToday, setShowToday)}
        {toggle('Non-working time', showNonWorkingTime, setShowNonWorkingTime)}
        {toggle('Holiday next Wednesday', holiday, setHoliday)}
      </div>
      <Gantt
        data={data}
        onChange={noop}
        preset={preset}
        {...(dataset === 'edge' ? EDGE_AXIS : {})}
        showToday={showToday}
        showNonWorkingTime={showNonWorkingTime}
        locale="en-GB"
        style={{ height: 420 }}
      />
    </div>
  );
}
