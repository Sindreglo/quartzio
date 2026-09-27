import { type Patch, type ProjectInput, type ProposedChange, VIEW_PRESETS } from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useState } from 'react';

const initial: ProjectInput = {
  settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-05' },
  tasks: [
    {
      id: 'build',
      name: 'Build (drag the phase: its tasks follow)',
      children: [
        { id: 'design', name: 'Design (automatic)', duration: 3 },
        { id: 'develop', name: 'Develop (pushed by Design)', duration: 5 },
        { id: 'test', name: 'Test (resize the end)', duration: 2 },
      ],
    },
    {
      id: 'vendor',
      name: 'Vendor (manual: moves freely)',
      manuallyScheduled: true,
      startDate: '2026-10-07T08:00',
      duration: 2,
    },
    { id: 'launch', name: 'Launch (milestone)', duration: 0 },
    { id: 'idea', name: 'Idea (unscheduled: draw its bar)' },
  ],
  dependencies: [
    { id: 'd1', from: 'design', to: 'develop' },
    { id: 'd2', from: 'develop', to: 'test' },
    { id: 'd3', from: 'test', to: 'launch' },
    { id: 'd4', from: 'vendor', to: 'launch' },
  ],
};

const LIMIT = Date.UTC(2026, 9, 30);

/** An example validator: nothing may start after 30 October. */
const noLateStarts = (change: ProposedChange) =>
  (change.kind === 'move' || change.kind === 'create') && change.start >= LIMIT
    ? 'Must start before 30 Oct'
    : true;

/** What a change did, in words: which fields of which tasks (a drop is one change). */
function describe(patch: Patch | null): string {
  if (!patch) {
    return 'Drag a bar to move it, its end to resize it, its progress handle, or from a handle at either end to another bar to link them. Draw a bar in the Idea row. Escape cancels.';
  }
  const changed = patch.operations.flatMap((op) =>
    op.type === 'add' && op.store === 'dependencies'
      ? [`new dependency ${String(op.record.from)} → ${String(op.record.to)} (${op.record.type})`]
      : op.type === 'update' && op.store === 'tasks'
        ? [`${String(op.id)}: ${Object.keys(op.changes).join(', ')}`]
        : [],
  );
  return `Last change: ${changed.join(' · ')}`;
}

/**
 * Dragging and resizing bars. Snaps to the preset's time resolution. Dragging an automatically scheduled task sets
 * "start no earlier than" (predecessors can still push it later); a manually scheduled task just moves. Resizing
 * changes the end and the duration.
 */
export function DragDemo() {
  const [data, setData] = useState<ProjectInput>(initial);
  const [lastPatch, setLastPatch] = useState<Patch | null>(null);
  const [taskDrag, setTaskDrag] = useState(true);
  const [taskResize, setTaskResize] = useState(true);
  const [taskDragCreate, setTaskDragCreate] = useState(true);
  const [progressDrag, setProgressDrag] = useState(true);
  const [dependencyCreate, setDependencyCreate] = useState(true);
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
            {VIEW_PRESETS.map((option) => (
              <option key={option.id}>{option.id}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={taskDrag}
            onChange={(event) => {
              setTaskDrag(event.target.checked);
            }}
          />
          Drag to move
        </label>
        <label>
          <input
            type="checkbox"
            checked={taskResize}
            onChange={(event) => {
              setTaskResize(event.target.checked);
            }}
          />
          Drag the end to resize
        </label>
        {(
          [
            ['Draw bars', taskDragCreate, setTaskDragCreate],
            ['Drag progress', progressDrag, setProgressDrag],
            ['Link by dragging', dependencyCreate, setDependencyCreate],
            ['Refuse starts after 30 Oct', validate, setValidate],
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
        preset={preset}
        taskDrag={taskDrag}
        taskResize={taskResize}
        taskDragCreate={taskDragCreate}
        progressDrag={progressDrag}
        dependencyCreate={dependencyCreate}
        validateChange={validate ? noLateStarts : undefined}
        locale="en-GB"
        style={{ height: 440 }}
      />
      <p className="pg-muted">{describe(lastPatch)}</p>
    </div>
  );
}
