import { type Patch, type ProjectInput, VIEW_PRESETS } from '@quartzio/gantt';
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
    { id: 'idea', name: 'Idea (unscheduled: nothing to drag)' },
  ],
  dependencies: [
    { id: 'd1', from: 'design', to: 'develop' },
    { id: 'd2', from: 'develop', to: 'test' },
    { id: 'd3', from: 'test', to: 'launch' },
    { id: 'd4', from: 'vendor', to: 'launch' },
  ],
};

/** What a change did, in words: which fields of which tasks (a drop is one change). */
function describe(patch: Patch | null): string {
  if (!patch) return 'Drag a bar to move it, or its end to resize it. Escape cancels.';
  const changed = patch.operations.flatMap((op) =>
    op.type === 'update' && op.store === 'tasks'
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
        locale="en-GB"
        style={{ height: 360 }}
      />
      <p className="pg-muted">{describe(lastPatch)}</p>
    </div>
  );
}
