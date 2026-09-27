import {
  VIEW_PRESETS,
  type ColumnInput,
  type GanttController,
  type GanttDataChange,
  type Id,
  type MenuItem,
  type ProjectData,
  type ProjectInput,
  type ProposedChange,
  type TaskTooltip,
  type ViewState,
} from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { type CSSProperties, useMemo, useRef, useState } from 'react';
import { constructionProgram, type WorkPackage } from '../../data/construction';
import { useGanttState, useHistory } from '../useHistory';

const SCALES = [
  { buildings: 1, label: 'One office building (~120 tasks)' },
  { buildings: 10, label: 'Portfolio of 10 buildings (~1 200 tasks)' },
  { buildings: 80, label: 'Portfolio of 80 buildings (~9 400 tasks)' },
] as const;
const OWNERS = [
  'Carpentry Crew',
  'Northern Electric',
  'Pipe Partners',
  'Vent Air',
  'Painters United',
  'Floor Masters',
];
const STORAGE_KEY = 'quartzio-playground-power-user';
const nok = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Oslo',
});

type Packages = ReadonlyMap<Id, WorkPackage>;

const pickProject = (state: ViewState) => state.project;

interface Saved {
  scale: number;
  data: ProjectData;
  packages: [Id, WorkPackage][];
}

function load(buildings: number): { data: ProjectInput; packages: Packages } {
  const { project, packages } = constructionProgram(buildings);
  return { data: project, packages };
}

/** One line per change for the change log: what kinds of records changed, and the first task's name. */
function describe(change: GanttDataChange, names: (id: Id) => string): string {
  const counts = new Map<string, number>();
  let first: string | undefined;
  for (const op of change.patch.operations) {
    const store = 'store' in op ? op.store : 'settings';
    const key = `${store} ${op.type === 'update' ? 'updated' : op.type === 'add' ? 'added' : op.type === 'remove' ? 'removed' : op.type === 'move' ? 'moved' : 'changed'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (first === undefined && 'store' in op && op.store === 'tasks')
      first = names(op.type === 'add' ? op.record.id : op.id);
  }
  return `${[...counts].map(([what, count]) => `${String(count)} ${what}`).join(', ')}${first ? ` (${first}…)` : ''}`;
}

/**
 * A contractor's planning tool: a construction program in the building calendar (Norwegian holidays, the builders'
 * holiday, 7.5-hour days, Europe/Oslo), controlled data kept by the app together with its own work packages (code,
 * responsible, cost), and most of what the library offers wired up.
 */
export function PowerScenario() {
  const [scale, setScale] = useState(1);
  const [{ data, packages }, setModel] = useState(() => load(1));
  const [preset, setPreset] = useState('weekAndMonth');
  const [selection, setSelection] = useState<readonly Id[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [lockCompleted, setLockCompleted] = useState(true);
  const [status, setStatus] = useState('');
  const ref = useRef<GanttController>(null);
  const history = useHistory(ref);
  const project = useGanttState(ref, pickProject, null);
  const nextId = useRef(1);
  // The first change after loading a plan is the scheduling writing its dates back, not an edit.
  const scheduling = useRef(true);

  const packageOf = (id: Id) => packages.get(id);
  const nameOf = (id: Id) => project?.tasks.byId.get(id)?.name ?? String(id);

  // Custom columns read the app's own records; recreated only when those change (value functions compare by
  // identity).
  const columns = useMemo<ColumnInput[]>(
    () => [
      { id: 'code', title: 'Code', width: 70, value: ({ task }) => packages.get(task.id)?.code ?? '' },
      'name',
      'startDate',
      'endDate',
      'duration',
      'percentDone',
      {
        id: 'owner',
        title: 'Responsible',
        width: 150,
        value: ({ task }) => packages.get(task.id)?.owner ?? '',
      },
      {
        id: 'cost',
        title: 'Cost',
        width: 120,
        align: 'end',
        value: ({ task }) => {
          const cost = packages.get(task.id)?.cost;
          return cost ? nok.format(cost) : '';
        },
      },
    ],
    [packages],
  );

  const onChange = (change: GanttDataChange) => {
    // New tasks (from the menu, say) get a work package of their own.
    const added = change.patch.operations.flatMap((op) =>
      op.type === 'add' && op.store === 'tasks' ? [op.record.id] : [],
    );
    setModel((model) => {
      if (added.every((id) => model.packages.has(id))) return { ...model, data: change.data };
      const next = new Map(model.packages);
      for (const id of added) if (!next.has(id)) next.set(id, { code: 'new', owner: 'Unassigned', cost: 0 });
      return { data: change.data, packages: next };
    });
    const line = scheduling.current
      ? `Scheduled on load: ${String(change.patch.operations.length)} computed dates written back`
      : describe(change, nameOf);
    scheduling.current = false;
    setLog((entries) => [line, ...entries].slice(0, 8));
  };

  const setOwner = (ids: readonly Id[], owner: string) => {
    setModel((model) => {
      const next = new Map(model.packages);
      for (const id of ids) {
        const current = next.get(id);
        if (current) next.set(id, { ...current, owner });
      }
      return { ...model, packages: next };
    });
  };

  const setProgress = (ids: readonly Id[], percentDone: number) => {
    ref.current?.transact((tx) => {
      for (const id of ids) if (tx.tasks.get(id)) tx.tasks.update(id, { percentDone });
    });
  };

  const validateChange = (change: ProposedChange) => {
    if (change.kind === 'link') return true;
    if (lockCompleted && change.task.percentDone === 100 && change.kind !== 'progress') {
      return 'Completed work is locked';
    }
    return true;
  };

  const taskMenuItems = (
    items: readonly MenuItem[],
    { selection: selected }: { selection: readonly Id[] },
  ) => [
    ...items,
    {
      id: 'complete',
      label: 'Mark complete',
      separator: true,
      action: () => {
        setProgress(selected, 100);
      },
    },
    {
      id: 'reset',
      label: 'Reset progress',
      action: () => {
        setProgress(selected, 0);
      },
    },
    {
      id: 'owner',
      label: 'Responsible',
      items: OWNERS.map((owner) => ({
        id: `owner:${owner}`,
        label: owner,
        action: () => {
          setOwner(selected, owner);
        },
      })),
    },
  ];

  const renderTaskTooltip = (tooltip: TaskTooltip) => {
    const info = packageOf(tooltip.taskId);
    return (
      <>
        <div className="qz-tooltip__title">
          {info?.code ? `${info.code} ` : ''}
          {tooltip.title}
        </div>
        <dl className="qz-tooltip__fields">
          {tooltip.fields.map((field) => (
            <div key={field.label} style={{ display: 'contents' }}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
          {info?.owner && (
            <>
              <dt>Responsible</dt>
              <dd>{info.owner}</dd>
            </>
          )}
          {info?.cost ? (
            <>
              <dt>Cost</dt>
              <dd>{nok.format(info.cost)}</dd>
            </>
          ) : null}
        </dl>
      </>
    );
  };

  const selected = selection.slice(0, 5).map((id) => project?.tasks.byId.get(id));
  const selectedCost = selection.reduce<number>((sum, id) => sum + (packages.get(id)?.cost ?? 0), 0);

  const save = () => {
    const state = ref.current?.getState();
    if (!state) return;
    try {
      const saved: Saved = { scale, data: data as ProjectData, packages: [...packages] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      setStatus(`Saved ${String(state.project.tasks.byId.size)} tasks in this browser.`);
    } catch {
      setStatus('Could not save (storage full or blocked).');
    }
  };
  const restore = () => {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      if (!text) {
        setStatus('Nothing saved yet.');
        return;
      }
      const saved = JSON.parse(text) as Saved;
      setScale(saved.scale);
      setModel({ data: saved.data, packages: new Map(saved.packages) });
      setStatus('Restored the saved plan.');
    } catch {
      setStatus('Could not restore the saved plan.');
    }
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'construction-plan.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="pg-stack">
      <div className="pg-toolbar pg-form">
        <label>
          Scale
          <select
            value={scale}
            onChange={(event) => {
              const buildings = Number(event.target.value);
              setScale(buildings);
              scheduling.current = true;
              setModel(load(buildings));
              setLog([]);
              setStatus('');
            }}
          >
            {SCALES.map((option) => (
              <option key={option.buildings} value={option.buildings}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Zoom
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
        <button disabled={!history.canUndo} onClick={() => ref.current?.undo()}>
          Undo
        </button>
        <button disabled={!history.canRedo} onClick={() => ref.current?.redo()}>
          Redo
        </button>
        <label>
          <input
            type="checkbox"
            checked={lockCompleted}
            onChange={(event) => {
              setLockCompleted(event.target.checked);
            }}
          />
          Lock completed work
        </label>
        <button onClick={save}>Save</button>
        <button onClick={restore}>Restore</button>
        <button onClick={exportJson}>Export JSON</button>
      </div>
      <div className="pg-power">
        <Gantt
          ref={ref}
          data={data}
          onChange={onChange}
          columns={columns}
          preset={preset}
          onPresetChange={setPreset}
          onSelectionChange={setSelection}
          validateChange={validateChange}
          taskMenuItems={taskMenuItems}
          createTaskId={() => `WP-${String(nextId.current++)}`}
          renderTaskTooltip={renderTaskTooltip}
          locale="en-GB"
          // Many columns: leave the timeline more room than the default 60% for the list.
          style={{ height: 560, '--qz-list-max-width': '45%' } as CSSProperties}
        />
        <aside className="pg-panel" aria-label="Plan details">
          <h3>Selection</h3>
          {selection.length === 0 ? (
            <p className="pg-muted">Click a row, or use the arrow keys. Shift and Ctrl/Cmd select more.</p>
          ) : (
            <>
              <p>
                {selection.length} selected · {nok.format(selectedCost)}
              </p>
              <ul>
                {selected.map(
                  (task) =>
                    task && (
                      <li key={String(task.id)}>
                        <strong>{task.name}</strong>
                        <br />
                        <span className="pg-muted">
                          {task.startDate === null ? 'Unscheduled' : dateTime.format(task.startDate)} ·{' '}
                          {packages.get(task.id)?.owner ? packages.get(task.id)?.owner : 'No one responsible'}
                        </span>
                      </li>
                    ),
                )}
              </ul>
              {selection.length > 5 && <p className="pg-muted">and {selection.length - 5} more</p>}
              <button onClick={() => ref.current?.openTaskEditor(selection[0] as Id)}>Edit first…</button>
            </>
          )}
          <h3>Changes</h3>
          {log.length === 0 ? (
            <p className="pg-muted">Drag, edit or use the menus: each change shows up here.</p>
          ) : (
            <ol className="pg-log">
              {log.map((entry, index) => (
                <li key={index}>{entry}</li>
              ))}
            </ol>
          )}
          {status && <p className="pg-muted">{status}</p>}
        </aside>
      </div>
    </div>
  );
}
