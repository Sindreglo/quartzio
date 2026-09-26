import type { ColumnInput, Patch, ProjectInput, ProposedChange, TaskTooltip } from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useState } from 'react';

const initial: ProjectInput = {
  settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-05' },
  tasks: [
    {
      id: 'build',
      name: 'Build (a parent: only its name can be edited)',
      children: [
        { id: 'design', name: 'Design', duration: 3, percentDone: 40 },
        { id: 'develop', name: 'Develop (pushed by Design)', duration: 5 },
      ],
    },
    {
      id: 'vendor',
      name: 'Vendor (manual: a new start keeps its time of day)',
      manuallyScheduled: true,
      startDate: '2026-10-07T08:00',
      duration: 2,
    },
    { id: 'launch', name: 'Launch (milestone: no end date)', duration: 0 },
    { id: 'idea', name: 'Idea (unscheduled: give it a start or a duration)' },
    {
      id: 'long',
      name: 'A task with a very long name that does not fit in the column, to see how the field and the tooltip cope',
      duration: 1,
    },
    {
      id: 'late',
      name: 'Far away (hover it after scrolling)',
      manuallyScheduled: true,
      startDate: '2027-02-01',
      duration: 3,
    },
  ],
  dependencies: [
    { id: 'd1', from: 'design', to: 'develop' },
    { id: 'd2', from: 'develop', to: 'launch' },
  ],
};

const COLUMNS: ColumnInput[] = [
  'name',
  'startDate',
  'endDate',
  'duration',
  'percentDone',
  { id: 'id', title: 'Id (read-only)', width: 110, value: ({ task }) => String(task.id) },
];

const DAY = 24 * 60 * 60 * 1000;

/** The weekday in the project's time zone. */
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Europe/Oslo' });

/** An example validator: tasks may not start on a weekend. */
const noWeekendStarts = (change: ProposedChange) => {
  if (change.kind !== 'move' && change.kind !== 'create') return true;
  return ['Sat', 'Sun'].includes(weekday.format(change.start)) ? 'Tasks may not start on a weekend' : true;
};

/** A custom tooltip: the name and how many calendar days the task spans. */
function customTooltip(tooltip: TaskTooltip) {
  const { startDate, endDate } = tooltip.task;
  const days = startDate !== null && endDate !== null ? Math.ceil((endDate - startDate) / DAY) : 0;
  return (
    <span>
      <strong>{tooltip.title}</strong> spans {days} calendar day{days === 1 ? '' : 's'}
    </span>
  );
}

function describe(patch: Patch | null): string {
  if (!patch) {
    return 'Double-click a cell, or select a row and press Enter or F2. Enter saves, Escape cancels, Tab moves on. Durations read like 4d, 2w or 3h. Hover a bar for its tooltip.';
  }
  const changed = patch.operations.flatMap((op) =>
    op.type === 'update' && op.store === 'tasks'
      ? [`${String(op.id)}: ${Object.keys(op.changes).join(', ')}`]
      : [],
  );
  return `Last change: ${changed.join(' · ')}`;
}

/** Task tooltips and editing cells in the task list. */
export function EditingDemo() {
  const [data, setData] = useState<ProjectInput>(initial);
  const [lastPatch, setLastPatch] = useState<Patch | null>(null);
  const [taskTooltip, setTaskTooltip] = useState(true);
  const [custom, setCustom] = useState(false);
  const [cellEdit, setCellEdit] = useState(true);
  const [validate, setValidate] = useState(false);
  const [preset, setPreset] = useState('weekAndDay');

  return (
    <div className="pg-stack">
      <div className="pg-toolbar pg-form">
        <label>
          Preset
          <select
            value={preset}
            onChange={(event) => {
              setPreset(event.target.value);
            }}
          >
            <option value="weekAndDay">weekAndDay (date fields)</option>
            <option value="hourAndDay">hourAndDay (date and time fields)</option>
          </select>
        </label>
        {(
          [
            ['Tooltip', taskTooltip, setTaskTooltip],
            ['Custom tooltip', custom, setCustom],
            ['Edit cells', cellEdit, setCellEdit],
            ['Refuse weekend starts', validate, setValidate],
          ] as const
        ).map(([label, checked, set]) => (
          <label key={label}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => {
                set(event.target.checked);
              }}
            />
            {label}
          </label>
        ))}
        <button
          onClick={() => {
            setData(initial);
            setLastPatch(null);
          }}
        >
          Reset
        </button>
      </div>
      <Gantt
        data={data}
        onChange={({ patch, data: next }) => {
          setData(next);
          setLastPatch(patch);
        }}
        columns={COLUMNS}
        preset={preset}
        taskTooltip={taskTooltip}
        renderTaskTooltip={custom ? customTooltip : undefined}
        cellEdit={cellEdit}
        validateChange={validate ? noWeekendStarts : undefined}
        locale="en-GB"
        style={{ height: 400 }}
      />
      <p className="pg-muted">{describe(lastPatch)}</p>
    </div>
  );
}
