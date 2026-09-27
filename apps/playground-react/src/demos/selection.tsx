import type { GanttController, Id, ProjectInput } from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useRef, useState } from 'react';
import { generateProject } from '../data/generate';
import { sampleProject } from '../data/sampleProject';
import { useHistory } from './useHistory';

const datasets = {
  sample: (): ProjectInput => ({ ...sampleProject, settings: { timeZone: 'Europe/Oslo' } }),
  big: (): ProjectInput => generateProject(1000, 9),
  long: (): ProjectInput => ({
    settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-05' },
    tasks: [
      {
        id: 'parent',
        name: 'A parent with a very long name that does not fit in the column at all, not even close',
        children: [
          { id: 'child', name: 'Child', duration: 2 },
          { id: 'far', name: 'Far below the visible range', duration: 1 },
        ],
      },
      { id: 'late', name: 'Starts far outside the timeline', startDate: '2030-01-01', duration: 1 },
    ],
  }),
  empty: (): ProjectInput => ({ tasks: [] }),
};
type Dataset = keyof typeof datasets;

/**
 * Selection, keyboard and undo/redo. Click rows (in the list or the timeline), Ctrl/Cmd-click to toggle,
 * Shift-click for a range. With the chart focused: arrows, Home/End, PageUp/PageDown, Left/Right to collapse and
 * expand, Space, Ctrl/Cmd+A, Escape, Delete, Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z.
 */
export function SelectionDemo() {
  const [dataset, setDataset] = useState<Dataset>('sample');
  const [data, setData] = useState<ProjectInput>(datasets.sample);
  const [selection, setSelection] = useState<readonly Id[]>([]);
  const [multiSelect, setMultiSelect] = useState(true);
  const [deleteKey, setDeleteKey] = useState(true);
  const [undoRedo, setUndoRedo] = useState(true);
  const ref = useRef<GanttController>(null);
  const history = useHistory(ref);
  const ids = data.tasks?.map((task) => task.id) ?? [];

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
            <option value="long">Long names, far away</option>
            <option value="empty">Empty</option>
          </select>
        </label>
        {(
          [
            ['Multi-select', multiSelect, setMultiSelect],
            ['Delete key', deleteKey, setDeleteKey],
            ['Undo/redo', undoRedo, setUndoRedo],
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
        <button disabled={!history.canUndo} onClick={() => ref.current?.undo()}>
          Undo
        </button>
        <button disabled={!history.canRedo} onClick={() => ref.current?.redo()}>
          Redo
        </button>
        <button
          disabled={ids.length === 0}
          onClick={() => {
            ref.current?.select(ids.slice(0, 2));
          }}
        >
          Select first two
        </button>
        <button
          onClick={() => {
            ref.current?.clearSelection();
          }}
        >
          Clear selection
        </button>
      </div>
      <Gantt
        ref={ref}
        data={data}
        onChange={({ data: next }) => {
          setData(next);
        }}
        onSelectionChange={setSelection}
        multiSelect={multiSelect}
        deleteKey={deleteKey}
        undoRedo={undoRedo}
        locale="en-GB"
        style={{ height: 420 }}
      />
      <p className="pg-muted">
        {selection.length === 0
          ? 'Nothing selected. Click a row, or focus the chart and press ↓.'
          : `Selected (${String(selection.length)}): ${selection.slice(0, 8).map(String).join(', ')}${selection.length > 8 ? ' …' : ''}`}
      </p>
    </div>
  );
}
