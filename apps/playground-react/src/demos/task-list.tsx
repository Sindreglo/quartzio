import type { ColumnInput, GanttController, ProjectInput } from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useMemo, useRef, useState } from 'react';
import { generateProject } from '../data/generate';
import { sampleProject } from '../data/sampleProject';

const DATASETS = {
  sample: (): ProjectInput => ({ ...sampleProject, settings: { timeZone: 'Europe/Oslo' } }),
  big: (): ProjectInput => generateProject(1000, 9),
  edge: (): ProjectInput => ({
    settings: { timeZone: 'Europe/Oslo' },
    // Manually scheduled, so the dates stay as given (e.g. only an end date).
    tasks: [
      {
        id: 'long',
        name: 'A task with a very long name that does not fit in the column and should be cut off with an ellipsis',
        startDate: '2026-10-05',
        duration: 2,
        manuallyScheduled: true,
      },
      { id: 'end-only', name: 'Only an end date', endDate: '2026-10-09T16:00', manuallyScheduled: true },
      { id: 'unscheduled', name: 'Unscheduled (no dates)' },
      {
        id: 'empty-parent',
        name: 'Parent without dated children',
        children: [{ id: 'child', name: 'Undated child' }],
      },
      { id: 1, name: 'Numeric id 1' },
      { id: '1', name: 'String id "1"' },
    ],
  }),
  empty: (): ProjectInput => ({}),
};

const COLUMN_SETS: Record<string, readonly ColumnInput[]> = {
  default: ['name', 'startDate', 'endDate', 'duration'],
  progress: ['name', 'percentDone', 'duration'],
  custom: [
    { id: 'task', field: 'name', title: 'Task', width: 280 },
    { id: 'id', title: 'ID', width: 90, value: ({ task }) => String(task.id) },
    { id: 'start', field: 'startDate' },
  ],
  none: [],
};

/**
 * The task list: rows from the task tree with expand/collapse, configurable columns, and virtualized
 * rows. Load 10 000 tasks and scroll: only the rows in view are rendered.
 */
export function TaskListDemo() {
  const gantt = useRef<GanttController>(null);
  const [dataset, setDataset] = useState<'sample' | 'big' | 'edge' | 'empty'>('sample');
  const [columnSet, setColumnSet] = useState('default');
  const [rowHeight, setRowHeight] = useState(36);
  const [locale, setLocale] = useState('en-US');

  const data = useMemo<ProjectInput>(() => DATASETS[dataset](), [dataset]);

  return (
    <div className="pg-stack">
      <div className="pg-toolbar pg-form">
        <label>
          Data
          <select
            value={dataset}
            onChange={(event) => {
              setDataset(event.target.value as typeof dataset);
            }}
          >
            <option value="sample">Sample project</option>
            <option value="big">10 000 tasks</option>
            <option value="edge">Edge cases</option>
            <option value="empty">Empty</option>
          </select>
        </label>
        <label>
          Columns
          <select
            value={columnSet}
            onChange={(event) => {
              setColumnSet(event.target.value);
            }}
          >
            {Object.keys(COLUMN_SETS).map((key) => (
              <option key={key}>{key}</option>
            ))}
          </select>
        </label>
        <label>
          Row height
          <select
            value={rowHeight}
            onChange={(event) => {
              setRowHeight(Number(event.target.value));
            }}
          >
            {[28, 36, 48].map((height) => (
              <option key={height}>{height}</option>
            ))}
          </select>
        </label>
        <label>
          Locale
          <select
            value={locale}
            onChange={(event) => {
              setLocale(event.target.value);
            }}
          >
            {['en-US', 'nb-NO', 'de-DE'].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <span className="pg-divider" />
        <button onClick={() => gantt.current?.collapseAll()}>Collapse all</button>
        <button onClick={() => gantt.current?.expandAll()}>Expand all</button>
      </div>

      {/* A key per dataset: switching between uncontrolled datasets needs a fresh chart. */}
      <Gantt
        key={dataset}
        ref={gantt}
        defaultData={data}
        columns={COLUMN_SETS[columnSet]}
        rowHeight={rowHeight}
        locale={locale}
        style={{ height: 480 }}
      />
    </div>
  );
}
