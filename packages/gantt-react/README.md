# @quartzio/gantt-react

[![npm @quartzio/gantt-react](https://img.shields.io/npm/v/@quartzio/gantt-react?label=%40quartzio%2Fgantt-react)](https://www.npmjs.com/package/@quartzio/gantt-react) [![license](https://img.shields.io/npm/l/@quartzio/gantt)](https://github.com/Sindreglo/quartzio/blob/main/LICENSE)

A React Gantt chart: a task list and a timeline with scheduling, dependencies, working-time calendars, drag and
drop, editing and undo. Built on the headless engine [`@quartzio/gantt`](https://www.npmjs.com/package/@quartzio/gantt).

## Install

```bash
npm install @quartzio/gantt-react @quartzio/gantt
```

Requires React 19. The package is ESM only. `@quartzio/gantt` is a peer dependency: keep both packages at the same
version.

## Quick start

```tsx
import type { ProjectInput } from '@quartzio/gantt';
import { Gantt } from '@quartzio/gantt-react';
import '@quartzio/gantt-react/styles.css';

const plan: ProjectInput = {
  settings: { timeZone: 'Europe/Oslo' },
  tasks: [
    {
      id: 'design',
      name: 'Design',
      children: [
        { id: 'sketch', name: 'Sketches', startDate: '2026-10-05', duration: 3 },
        { id: 'review', name: 'Design review', duration: 0 },
      ],
    },
    { id: 'build', name: 'Build', duration: 2, durationUnit: 'week' },
  ],
  dependencies: [
    { id: 1, from: 'sketch', to: 'review' },
    { id: 2, from: 'review', to: 'build' },
  ],
};

export function App() {
  return <Gantt defaultData={plan} style={{ height: 500 }} />;
}
```

The chart needs a height: give it one with `style` or `className`.

Everything works without options: drag bars to move and resize them, draw links between them, double-click a cell
or a bar to edit, right-click for the menu, Ctrl/Cmd+Z to undo. Durations are working time in the project calendar
(Monday–Friday 08:00–16:00 unless you give it another), and tasks are scheduled from their predecessors.

## Keeping the data

With `defaultData` the chart keeps the edited data itself. To own the data (to save it, or change it from elsewhere
in your app), pass `data` and `onChange` instead:

```tsx
import type { GanttDataChange, ProjectInput } from '@quartzio/gantt';

function Plan({ initial }: { initial: ProjectInput }) {
  const [data, setData] = useState(initial);
  const [unsaved, setUnsaved] = useState(false);

  const onChange = (change: GanttDataChange) => {
    setData(change.data);
    // 'load' is the computed dates written back into data that was loaded, not an edit.
    if (change.source !== 'load') setUnsaved(true);
  };

  return <Gantt data={data} onChange={onChange} style={{ height: 500 }} />;
}
```

`change.data` is the whole project as plain JSON, ready to store. `change.patch` holds just what changed, with its
inverse, if you'd rather send changes to a server. Don't modify the data objects in place: pass new ones.

## Changing the plan from code

The `ref` gives you the engine's controller:

```tsx
const gantt = useRef<GanttController>(null);

function addInspection() {
  gantt.current?.transact((tx) => {
    const task = tx.tasks.add({ name: 'Inspection', duration: 1 });
    tx.dependencies.add({ from: 'build', to: task.id });
  });
}

<Gantt ref={gantt} defaultData={plan} />;
```

A transaction is one change: one undo step and one `onChange`. The controller also has `undo`, `redo`, `select`,
`expandAll`, `collapseAll`, `zoom` and more.

## Customizing

```tsx
import type { ColumnInput, MenuCustomizer, ProposedChange } from '@quartzio/gantt';

// Outside the component, so they keep their identity between renders.
const columns: ColumnInput[] = [
  { id: 'code', title: 'Code', width: 70, value: ({ task }) => codes.get(task.id) ?? '' },
  'name',
  'startDate',
  'endDate',
  'percentDone',
];

const lockCompleted = (change: ProposedChange) =>
  change.kind !== 'link' && change.task.percentDone === 100 ? 'Completed work is locked' : true;

const taskMenuItems: MenuCustomizer = (items, { selection }) => [
  ...items,
  { id: 'complete', label: 'Mark complete', separator: true, action: () => markComplete(selection) },
];

<Gantt
  data={data}
  onChange={onChange}
  preset="monthAndYear"
  locale="nb-NO"
  columns={columns}
  validateChange={lockCompleted}
  taskMenuItems={taskMenuItems}
  renderTaskTooltip={(tooltip) => <strong>{tooltip.title}</strong>}
/>;
```

- **Columns:** built-in ones (`'name'`, `'startDate'`, `'endDate'`, `'duration'`, `'percentDone'`) and your own,
  with a `value` function that reads your data.
- **Time axis:** seven built-in zoom levels from hours to years, or your own preset.
- **Interactions:** each can be turned off, e.g. `taskDrag={false}` or `cellEdit={false}`.
- **Menus, tooltip and editor:** add or remove menu items, and replace the content of the tooltip
  (`renderTaskTooltip`) or the task editor dialog (`renderTaskEditor`).

Functions in `columns`, presets and `validateChange` are compared by identity: define them outside the component,
or with `useMemo`/`useCallback` when they read props or state, so the chart doesn't rebuild on every render.

All options are in the [API reference](https://github.com/Sindreglo/quartzio/blob/main/packages/gantt/API.md).

### Props

`<Gantt>` takes every engine option as a prop, plus:

| Prop                | Type                                               | Description                                                                             |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `className`         | `string`                                           | Added to the root element.                                                              |
| `style`             | `CSSProperties`                                    | Style on the root element. Give the chart a height here or in CSS.                      |
| `ref`               | `Ref<GanttController>`                             | The engine's controller.                                                                |
| `renderTaskTooltip` | `(tooltip: TaskTooltip) => ReactNode`              | Replaces the tooltip's content. The engine still places it.                             |
| `renderTaskEditor`  | `(editor: TaskEditorState, dispatch) => ReactNode` | Replaces the task editor dialog's content. `dispatch` does what the built-in form does. |

The types of the render functions are exported as `RenderTaskTooltip` and `RenderTaskEditor`.

## Theming

The look is set with CSS variables, on the chart or any ancestor:

```css
.my-plan {
  --qz-primary: #0b7a5c;
  --qz-bar-color: #d6efe6;
  --qz-list-max-width: 40%;
}
```

Add the class `qz-dark` to the chart or an ancestor for the dark theme. The
[API reference](https://github.com/Sindreglo/quartzio/blob/main/packages/gantt/API.md#theming) lists the variables.

## Server rendering

The component works with server rendering (it is marked `'use client'`). The server doesn't know the browser's
language, time zone or clock, so:

- With an explicit `locale`, a project `settings.timeZone`, and dated tasks (or `startDate` and `endDate`), the
  server renders the whole chart.
- Otherwise the server renders an empty frame, and the chart fills in when the page hydrates.

The today line only shows after hydration. Node and browsers can format some dates slightly differently even with
the same locale (for example the space before AM/PM in hour labels); if hydration reports a text mismatch, leave
out `locale` to render the chart in the browser only.

## Links

- [GitHub repository](https://github.com/Sindreglo/quartzio)
- [API reference](https://github.com/Sindreglo/quartzio/blob/main/packages/gantt/API.md)
- [Release notes](https://github.com/Sindreglo/quartzio/tree/main/release-notes)
- [Report an issue](https://github.com/Sindreglo/quartzio/issues)

## License

MIT
