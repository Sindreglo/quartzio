import type { DependencyInput, ProjectInput, TaskInput } from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import { useMemo, useState } from 'react';
import { generateProject } from '../data/generate';

// Manually scheduled, so the bars stay exactly where the routes are interesting.
const at = (
  id: string,
  name: string,
  start: string,
  end: string,
  extra: Partial<TaskInput> = {},
): TaskInput => ({
  id,
  name,
  startDate: start,
  endDate: end,
  manuallyScheduled: true,
  ...extra,
});
const link = (
  id: string,
  from: string,
  to: string,
  extra: Partial<DependencyInput> = {},
): DependencyInput => ({
  id,
  from,
  to,
  ...extra,
});

const types = (): ProjectInput => ({
  settings: { timeZone: 'Europe/Oslo' },
  tasks: [
    at('fs1', 'FS: room for one vertical line', '2026-10-05', '2026-10-07'),
    at('fs2', 'FS successor', '2026-10-08', '2026-10-10'),
    at('fs3', 'FS: successor starts earlier (goes around)', '2026-10-05', '2026-10-08'),
    at('fs4', 'FS successor (earlier)', '2026-10-06', '2026-10-09'),
    at('ss1', 'SS predecessor', '2026-10-06', '2026-10-08'),
    at('ss2', 'SS successor', '2026-10-07', '2026-10-09'),
    at('ff1', 'FF predecessor', '2026-10-05', '2026-10-09'),
    at('ff2', 'FF successor', '2026-10-06', '2026-10-08'),
    at('sf1', 'SF predecessor', '2026-10-08', '2026-10-10'),
    at('sf2', 'SF successor (goes around)', '2026-10-05', '2026-10-07'),
    at('m1', 'Milestone', '2026-10-12', '2026-10-12'),
    at('m2', 'Milestone after a milestone', '2026-10-14', '2026-10-14'),
    at('up', 'Successor above (arrow goes up)', '2026-10-15', '2026-10-16'),
    at('last', 'Predecessor below', '2026-10-12', '2026-10-14'),
  ],
  dependencies: [
    link('d1', 'fs1', 'fs2'),
    link('d2', 'fs3', 'fs4'),
    link('d3', 'ss1', 'ss2', { type: 'SS' }),
    link('d4', 'ff1', 'ff2', { type: 'FF' }),
    link('d5', 'sf1', 'sf2', { type: 'SF' }),
    link('d6', 'm1', 'm2'),
    link('d7', 'last', 'up'),
  ],
});

const hierarchy = (): ProjectInput => ({
  settings: { timeZone: 'Europe/Oslo' },
  tasks: [
    at('a', 'Collapse "Phase": the line to its child disappears', '2026-10-05', '2026-10-07'),
    {
      id: 'phase',
      name: 'Phase',
      children: [
        at('child', 'Child with a predecessor', '2026-10-08', '2026-10-10'),
        at('other', 'Other child', '2026-10-05', '2026-10-06'),
      ],
    },
    at('after', 'After the whole phase', '2026-10-12', '2026-10-14'),
    { id: 'idea', name: 'Unscheduled (no line to it)' },
  ],
  dependencies: [link('h1', 'a', 'child'), link('h2', 'phase', 'after'), link('h3', 'a', 'idea')],
});

// A fixed axis (12–26 October), so bars start before or end after it.
const OUTSIDE_AXIS = { startDate: '2026-10-12', endDate: '2026-10-26' };
const outside = (): ProjectInput => ({
  settings: { timeZone: 'Europe/Oslo' },
  tasks: [
    at('before', 'Ends before the axis', '2026-09-28', '2026-10-02'),
    at('into', 'Starts in the axis', '2026-10-13', '2026-10-15'),
    at('long', 'Runs past the end', '2026-10-20', '2026-12-01'),
    at('beyond', 'Starts after the axis', '2026-12-02', '2026-12-04'),
  ],
  dependencies: [link('o1', 'before', 'into'), link('o2', 'into', 'long'), link('o3', 'long', 'beyond')],
});

// 10 000 tasks: chains in every phase, plus long lines from every 50th phase to one far below, which pass
// through the rendered rows while scrolling.
const big = (): ProjectInput => {
  const project = generateProject(1000, 9);
  const long = Array.from({ length: 20 }, (_, i) =>
    link(`long${String(i)}`, `g${String(i * 50)}t8`, `g${String(i * 50 + 45)}t0`, { type: 'SS' }),
  );
  return { ...project, dependencies: [...(project.dependencies ?? []), ...long] };
};

const DATASETS = { types, hierarchy, outside, big };

/**
 * Dependency arrows: orthogonal routes out of the predecessor's side and into the successor's, for all four
 * types, milestones, collapsed parents, bars outside the axis, and 10 000 tasks with lines passing through.
 */
export function DependenciesDemo() {
  const [dataset, setDataset] = useState<keyof typeof DATASETS>('types');
  const [rowHeight, setRowHeight] = useState(44);
  const data = useMemo(() => DATASETS[dataset](), [dataset]);

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
            <option value="types">All four types</option>
            <option value="hierarchy">Parents and collapsing</option>
            <option value="outside">Outside the axis</option>
            <option value="big">10 000 tasks</option>
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
            {[28, 36, 44, 60, 90].map((height) => (
              <option key={height}>{height}</option>
            ))}
          </select>
        </label>
      </div>
      <Gantt
        key={dataset}
        defaultData={data}
        rowHeight={rowHeight}
        locale="en-GB"
        {...(dataset === 'outside' ? OUTSIDE_AXIS : {})}
        style={{ height: 460 }}
      />
    </div>
  );
}
