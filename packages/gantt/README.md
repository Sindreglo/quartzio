# @quartzio/gantt

A headless Gantt chart engine in TypeScript, with no dependencies and no DOM. It holds the project data, schedules
tasks in working time, and computes everything a Gantt chart shows (rows, bars, dependency lines, the time axis)
as plain data in pixels. It also handles dragging, editing, selection, the keyboard and undo. A renderer only draws
the state and forwards input.

For React, use [`@quartzio/gantt-react`](https://www.npmjs.com/package/@quartzio/gantt-react). Use this package
directly to build a renderer for another framework, or to work with project data without a chart.

## Install

```bash
npm install @quartzio/gantt
```

The package is ESM only, and runs anywhere JavaScript does (browsers, Node, workers).

## What it does

- **Project data:** tasks in a tree, dependencies (FS, SS, FF, SF, with lag), calendars and settings. Every change
  is a transaction that produces a patch with its inverse.
- **Scheduling:** tasks start as soon as possible after the project start and their predecessors; parents span their
  children; manually scheduled tasks keep their dates. The computed dates are written back into the data.
- **Working time:** durations in working time, calendars with working hours and exceptions, in any time zone,
  daylight saving time included.
- **View:** a time axis from hours to years, virtualized rows, bars, milestones, dependency lines, non-working time.
- **Interaction:** drag to move, resize, draw, link and set progress, with snapping and validation; cell editing, a
  task editor, context menus, selection, keyboard navigation, undo and redo.

## A chart without a framework

```ts
import { createGantt } from '@quartzio/gantt';

const gantt = createGantt({
  defaultData: {
    settings: { timeZone: 'UTC' },
    tasks: [
      { id: 1, name: 'Design', startDate: '2026-10-05', duration: 3 },
      { id: 2, name: 'Build', duration: 5 },
    ],
    dependencies: [{ id: 1, from: 1, to: 2 }],
  },
  onChange: ({ data }) => save(data),
});

gantt.setViewport({ width: 800, height: 400, scrollLeft: 0, scrollTop: 0 });
gantt.subscribe((state) => draw(state)); // state.rows.items[i].bar, state.header.rows, …
```

## Working with project data

The data model and the scheduler work without a chart, for example on a server:

```ts
import { createProject, scheduleProject } from '@quartzio/gantt';

const project = createProject(input, { propagate: scheduleProject });
project.transact((tx) => {
  tx.tasks.update(1, { duration: 4 }); // successors move in the same patch
});
const data = project.toData(); // plain JSON
```

Changes made elsewhere arrive as patches, and `applyPatch(data, patch)` applies one without modifying `data`.

## Things to know

- **Treat data as immutable.** Pass new objects when something changes, never the same objects modified in place.
  Records that didn't change keep their identity, and the engine reuses its caches for them.
- **End dates are exclusive**, and durations are working time.
- **Set a time zone** (`settings.timeZone`) when the plan belongs to a place. The default is the host's zone.

## Documentation

- [API reference](https://github.com/Sindreglo/quartzio/blob/main/packages/gantt/API.md): options, data model,
  changes, transactions, the controller, columns, presets, menus, theming and utilities.
- [`@quartzio/gantt-react`](https://github.com/Sindreglo/quartzio/tree/main/packages/gantt-react) is a complete
  renderer to learn from.

## License

MIT
