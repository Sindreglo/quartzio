import type { DependencyType, GanttController, Id, Patch, ProjectInput, Transaction } from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useRef, useState } from 'react';

const initial: ProjectInput = {
  settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-05' },
  tasks: [
    {
      id: 'design',
      name: 'Design',
      children: [
        { id: 'research', name: 'Research', duration: 3, percentDone: 100 },
        { id: 'sketch', name: 'Sketches', duration: 2, percentDone: 50 },
        { id: 'review', name: 'Design review', duration: 0 },
      ],
    },
    {
      id: 'build',
      name: 'Build',
      children: [
        { id: 'api', name: 'API', duration: 5 },
        { id: 'ui', name: 'UI', duration: 4 },
        { id: 'docs', name: 'Docs (ends with the UI)', duration: 2 },
      ],
    },
    {
      id: 'vendor',
      name: 'Vendor delivery (manual)',
      duration: 1,
      manuallyScheduled: true,
      startDate: '2026-10-14T12:00',
    },
    { id: 'launch', name: 'Launch', duration: 0 },
    { id: 'someday', name: 'Idea (no dates or duration: unscheduled)' },
  ],
  dependencies: [
    { id: 'd1', from: 'research', to: 'sketch' },
    { id: 'd2', from: 'sketch', to: 'review' },
    { id: 'd3', from: 'design', to: 'build' },
    { id: 'd4', from: 'api', to: 'ui', type: 'SS', lag: 2 },
    { id: 'd5', from: 'ui', to: 'docs', type: 'FF' },
    { id: 'd6', from: 'build', to: 'launch' },
    { id: 'd7', from: 'vendor', to: 'launch', lag: 1 },
  ],
};

// Edge cases: no project start (it's derived from the manual task, which only has an end), a task with only a
// duration, one with nothing at all (unscheduled), a lag far beyond the calendar's range (the requirement is
// skipped), and a dependency on a parent passed through a manually scheduled task in between.
const edgeCases: ProjectInput = {
  settings: { timeZone: 'Europe/Oslo' },
  tasks: [
    {
      id: 'end-only',
      name: 'Manual, only an end (sets the project start)',
      manuallyScheduled: true,
      endDate: '2026-10-09T16:00',
      duration: 3,
    },
    { id: 'duration-only', name: 'Only a duration', duration: 2 },
    { id: 'nothing', name: 'No dates, no duration (unscheduled)' },
    { id: 'far', name: 'Lag of 30 000 days (skipped)', duration: 1 },
    {
      id: 'phase',
      // Its manual child isn't pushed, so the phase spans back to it, while the grandchild is pushed.
      name: 'Phase (depends on "Only a duration", spans its manual child)',
      children: [
        {
          id: 'manual-mid',
          name: 'Manual in between',
          manuallyScheduled: true,
          startDate: '2026-10-05T08:00',
          duration: 1,
          children: [{ id: 'deep', name: 'Still pushed by the phase', duration: 1 }],
        },
      ],
    },
  ],
  dependencies: [
    { id: 'e1', from: 'duration-only', to: 'phase' },
    { id: 'e2', from: 'end-only', to: 'far', lag: 30_000 },
  ],
};

const DATASETS: Record<string, ProjectInput> = { example: initial, edge: edgeCases, empty: {} };

const TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

/**
 * Automatic scheduling: tasks start as soon as possible after the project start and their predecessors (all four
 * dependency types, with lag), parents span their children, and manually scheduled tasks keep their dates. The
 * scheduler writes the dates back into the data, so each edit's patch includes the tasks it moved.
 */
export function SchedulingDemo() {
  const gantt = useRef<GanttController>(null);
  // Starts as the (nested, unscheduled) input; from the first onChange on, the flat, scheduled data.
  const [data, setData] = useState<ProjectInput>(initial);
  const [lastPatch, setLastPatch] = useState<Patch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Id>('research');
  const [link, setLink] = useState({ from: 'launch', to: 'research', type: 'FS' as DependencyType, lag: 0 });
  const [dataset, setDataset] = useState('example');

  const tasks = data.tasks ?? [];
  const dependencies = data.dependencies ?? [];
  const nameOf = (id: Id) => tasks.find((task) => task.id === id)?.name ?? String(id);
  const selectedTask = tasks.find((task) => task.id === selected);
  const isParent = tasks.some((task) => task.parentId === selected);
  const projectStart = data.settings?.startDate;
  // YYYY-MM-DD in the project's zone (Oslo) for the date input; the start is always midnight or 08:00 there.
  const startValue =
    typeof projectStart === 'number'
      ? new Date(projectStart + 12 * 3_600_000).toISOString().slice(0, 10)
      : typeof projectStart === 'string'
        ? projectStart.slice(0, 10)
        : '';

  const edit = (fn: (tx: Transaction) => void) => {
    setError(null);
    try {
      gantt.current?.transact(fn);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const moved = lastPatch?.operations.flatMap((op) =>
    op.type === 'update' && op.store === 'tasks' && ('startDate' in op.changes || 'endDate' in op.changes)
      ? [op.id]
      : [],
  );

  return (
    <div className="pg-stack">
      <div className="pg-toolbar pg-form">
        <label>
          Data
          <select
            value={dataset}
            onChange={(event) => {
              setDataset(event.target.value);
              setData(DATASETS[event.target.value] ?? {});
              setLastPatch(null);
              setError(null);
            }}
          >
            <option value="example">Example</option>
            <option value="edge">Edge cases</option>
            <option value="empty">Empty</option>
          </select>
        </label>
        <label>
          Project start
          <input
            type="date"
            value={startValue}
            onChange={(event) => {
              edit((tx) => {
                tx.settings.update({ startDate: event.target.value || null });
              });
            }}
          />
        </label>
        <label>
          Task
          <select
            value={String(selected)}
            onChange={(event) => {
              setSelected(event.target.value);
            }}
          >
            {tasks.map((task) => (
              <option key={String(task.id)} value={String(task.id)}>
                {task.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={isParent}
          title={isParent ? 'A parent spans its children' : undefined}
          onClick={() => {
            edit((tx) => {
              tx.tasks.update(selected, { duration: (selectedTask?.duration ?? 0) + 1 });
            });
          }}
        >
          +1 day
        </button>
        <button
          disabled={isParent || (selectedTask?.duration ?? 0) < 1}
          onClick={() => {
            edit((tx) => {
              tx.tasks.update(selected, { duration: (selectedTask?.duration ?? 1) - 1 });
            });
          }}
        >
          −1 day
        </button>
        <label>
          <input
            type="checkbox"
            checked={selectedTask?.manuallyScheduled === true}
            onChange={(event) => {
              edit((tx) => {
                tx.tasks.update(selected, { manuallyScheduled: event.target.checked });
              });
            }}
          />
          Manually scheduled
        </label>
      </div>

      <div className="pg-toolbar pg-form">
        <span>New dependency</span>
        {(['from', 'to'] as const).map((end) => (
          <select
            key={end}
            aria-label={end}
            value={link[end]}
            onChange={(event) => {
              setLink({ ...link, [end]: event.target.value });
            }}
          >
            {tasks.map((task) => (
              <option key={String(task.id)} value={String(task.id)}>
                {task.name}
              </option>
            ))}
          </select>
        ))}
        <select
          aria-label="type"
          value={link.type}
          onChange={(event) => {
            setLink({ ...link, type: event.target.value as DependencyType });
          }}
        >
          {TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <label>
          Lag (days)
          <input
            type="number"
            value={link.lag}
            onChange={(event) => {
              setLink({ ...link, lag: Number(event.target.value) });
            }}
            style={{ width: 60 }}
          />
        </label>
        <button
          onClick={() => {
            edit((tx) => {
              tx.dependencies.add(link);
            });
          }}
        >
          Add
        </button>
      </div>
      {error && <p className="pg-error">{error}</p>}

      <Gantt
        ref={gantt}
        data={data}
        onChange={({ patch, data: next }) => {
          setData(next);
          setLastPatch(patch);
        }}
        locale="en-GB"
        style={{ height: 380 }}
      />

      <p className="pg-muted">
        Last change: {lastPatch ? `${String(lastPatch.operations.length)} operations` : '—'}
        {moved && moved.length > 0 && ` · dates written back for ${moved.map(nameOf).join(', ')}`}
      </p>

      <div>
        <h3>Dependencies</h3>
        <ul className="pg-list">
          {dependencies.map((dependency) => (
            <li key={String(dependency.id)}>
              {nameOf(dependency.from)} → {nameOf(dependency.to)} ({dependency.type ?? 'FS'}
              {dependency.lag ? `, lag ${String(dependency.lag)} ${dependency.lagUnit ?? 'day'}` : ''}){' '}
              <button
                onClick={() => {
                  edit((tx) => {
                    tx.dependencies.remove(dependency.id);
                  });
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
