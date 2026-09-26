import type {
  GanttController,
  MenuItem,
  Patch,
  ProjectInput,
  TaskEditorAction,
  TaskEditorState,
} from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useRef, useState } from 'react';
import { generateProject } from '../data/generate';

const sample: ProjectInput = {
  settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-05' },
  tasks: [
    {
      id: 'build',
      name: 'Build',
      children: [
        { id: 'design', name: 'Design', duration: 3, percentDone: 40 },
        { id: 'develop', name: 'Develop', duration: 5 },
        { id: 'test', name: 'Test', duration: 2 },
      ],
    },
    {
      id: 'vendor',
      name: 'Vendor (manual)',
      manuallyScheduled: true,
      startDate: '2026-10-07T08:00',
      duration: 2,
    },
    { id: 'launch', name: 'Launch', duration: 0 },
    {
      id: 'long',
      name: 'A task with a very long name, to see how the menu and the editor cope with it when it does not fit',
      duration: 1,
    },
  ],
  dependencies: [
    { id: 'd1', from: 'design', to: 'develop' },
    { id: 'd2', from: 'develop', to: 'test', lag: 1, lagUnit: 'day' },
    { id: 'd3', from: 'test', to: 'launch' },
  ],
};
const datasets = {
  sample: () => sample,
  big: () => generateProject(1000, 9),
  empty: (): ProjectInput => ({ settings: { timeZone: 'Europe/Oslo' }, tasks: [] }),
};
type Dataset = keyof typeof datasets;

let counter = 0;

/** A custom editor: only the name, with the built-in actions. */
function simpleEditor(editor: TaskEditorState, act: (action: TaskEditorAction) => boolean) {
  return (
    <form
      style={{ padding: 16, display: 'grid', gap: 8 }}
      onSubmit={(event) => {
        event.preventDefault();
        act({ type: 'save' });
      }}
    >
      <strong>Custom editor</strong>
      <input
        aria-label="Name"
        value={editor.fields.name.text}
        onChange={(event) => act({ type: 'input', field: 'name', value: event.target.value })}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={() => act({ type: 'close' })}>
          Cancel
        </button>
        <button type="submit">Save</button>
      </div>
    </form>
  );
}

function describe(patch: Patch | null): string {
  if (!patch)
    return 'Right-click a row or a bar for the task menu, the time axis header to zoom. Double-click a bar to edit the task.';
  const counts = new Map<string, number>();
  for (const op of patch.operations) {
    const what = `${op.type} ${'store' in op ? op.store : 'settings'}`;
    counts.set(what, (counts.get(what) ?? 0) + 1);
  }
  return `Last change: ${[...counts].map(([what, count]) => `${String(count)}× ${what}`).join(', ')}`;
}

/** Context menus (tasks and the time axis) and the task editor dialog. */
export function MenusDemo() {
  const [dataset, setDataset] = useState<Dataset>('sample');
  const [data, setData] = useState<ProjectInput>(sample);
  const [lastPatch, setLastPatch] = useState<Patch | null>(null);
  const [taskMenu, setTaskMenu] = useState(true);
  const [timeAxisMenu, setTimeAxisMenu] = useState(true);
  const [taskEdit, setTaskEdit] = useState(true);
  const [customItem, setCustomItem] = useState(false);
  const [customIds, setCustomIds] = useState(false);
  const [customEditor, setCustomEditor] = useState(false);
  const [preset, setPreset] = useState('weekAndDay');
  const [log, setLog] = useState('');
  const ref = useRef<GanttController>(null);

  return (
    <div className="pg-stack">
      <div className="pg-toolbar pg-form">
        <label>
          Data
          <select
            value={dataset}
            onChange={(event) => {
              const next = event.target.value as Dataset;
              setDataset(next);
              setData(datasets[next]());
            }}
          >
            <option value="sample">Sample project</option>
            <option value="big">10 000 tasks</option>
            <option value="empty">Empty</option>
          </select>
        </label>
        {(
          [
            ['Task menu', taskMenu, setTaskMenu],
            ['Time axis menu', timeAxisMenu, setTimeAxisMenu],
            ['Task editor', taskEdit, setTaskEdit],
            ['Custom menu item', customItem, setCustomItem],
            ['Own ids (T-n)', customIds, setCustomIds],
            ['Custom editor', customEditor, setCustomEditor],
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
            ref.current?.transact((tx) => {
              tx.tasks.add({ name: 'First task', duration: 1 });
            });
          }}
        >
          Add a task
        </button>
      </div>
      <Gantt
        ref={ref}
        data={data}
        onChange={({ patch, data: next }) => {
          setData(next);
          setLastPatch(patch);
        }}
        preset={preset}
        onPresetChange={(id) => {
          setPreset(id);
        }}
        taskMenu={taskMenu}
        timeAxisMenu={timeAxisMenu}
        taskEdit={taskEdit}
        taskMenuItems={
          customItem
            ? (items: readonly MenuItem[]) => [
                ...items,
                {
                  id: 'log',
                  label: 'Log to the page',
                  separator: true,
                  action: ({ task }) => {
                    setLog(`Logged ${task?.name ?? ''}`);
                  },
                },
              ]
            : undefined
        }
        createTaskId={customIds ? () => `T-${String(++counter)}` : undefined}
        renderTaskEditor={customEditor ? simpleEditor : undefined}
        locale="en-GB"
        style={{ height: 420 }}
      />
      <p className="pg-muted">
        {describe(lastPatch)} · Preset: {preset}
        {log && ` · ${log}`}
      </p>
    </div>
  );
}
