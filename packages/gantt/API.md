# API reference

The reference for `@quartzio/gantt`. The React component [`@quartzio/gantt-react`](../gantt-react) takes the same
options as props, so this page applies to it too. Every type named here is exported from `@quartzio/gantt`, and
the exported types carry the same documentation in your editor.

- [Concepts](#concepts)
- [Options](#options)
- [Project data](#project-data)
- [Changes](#changes)
- [Transactions](#transactions)
- [The controller](#the-controller)
- [Columns](#columns)
- [Time axis presets](#time-axis-presets)
- [Menus](#menus)
- [Validating changes](#validating-changes)
- [Keyboard](#keyboard)
- [Theming](#theming)
- [Utilities](#utilities)
- [Errors](#errors)

## Concepts

**Data in, changes out.** You give the chart a project (tasks, dependencies, calendars and settings). Every change,
whether made in the chart (dragging, editing, menus, the keyboard) or in code, comes out as a _patch_: a list of
operations and their inverse. The engine never modifies the objects you pass in.

**Controlled or uncontrolled.** Pass `defaultData` and the chart keeps the edited data itself (uncontrolled). Pass
`data` and you own it (controlled): edits are reported through `onChange`, and show up once you pass the new data
back. The mode is fixed when the chart is created.

**Scheduling writes dates back.** Automatically scheduled tasks start as soon as possible: at the project start,
after their predecessors, and no earlier than their constraint. Parents span their children. The computed
`startDate`, `endDate` and `duration` are written into the data as part of the same patch, so the data you get back
always holds the dates the chart shows. Loading data that wasn't scheduled yet is reported as a change with
`source: 'load'`.

**Working time.** A duration is working time in the project calendar (by default Monday–Friday 08:00–16:00):
`duration: 3, durationUnit: 'day'` is three working days, so a task starting on Friday ends on Tuesday. Days, weeks
and months convert to hours with `hoursPerDay`, `daysPerWeek` and `daysPerMonth`.

**Exclusive end dates.** A task covers `startDate <= t < endDate`. A one-day task on 5 October 2026 runs from
`2026-10-05T08:00` to `2026-10-05T16:00` in the standard calendar, and a task with `endDate: '2026-10-08'`
ends at the start of 8 October.

**Time zones.** Times are instants (epoch milliseconds inside the engine). Everything that depends on the wall
clock (working hours, midnight, week numbers, date strings without an offset) uses the project's
`settings.timeZone`: an IANA name like `'Europe/Oslo'`, `'UTC'`, or `'local'` (the default, the host's zone). Set
an explicit zone when the plan belongs to a place, and always when you render on the server.

**Treat data as immutable.** Records that didn't change keep their identity between versions of the data, and the
engine reuses its caches for them. Don't modify task or dependency objects in place and pass the same data again:
create new objects, as `applyPatch` and `change.data` do.

## Options

`createGantt(options)` and `<Gantt {...options} />` take these. All are optional.

### Data

| Option        | Type                                | Description                                                                                                                        |
| ------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `data`        | `ProjectInput \| undefined`         | Controlled data. Having the key makes the chart controlled, even with `undefined` (shown as an empty project, e.g. while loading). |
| `defaultData` | `ProjectInput`                      | Initial data for uncontrolled usage.                                                                                               |
| `onChange`    | `(change: GanttDataChange) => void` | Called with every change: the patch, the data with the change applied, and its source. See [Changes](#changes).                    |

### Time axis

| Option               | Type                         | Default        | Description                                                                                                          |
| -------------------- | ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `preset`             | `string \| ViewPreset`       | `'weekAndDay'` | A built-in preset id or a custom preset. See [Time axis presets](#time-axis-presets).                                |
| `startDate`          | `DateInput`                  | from the tasks | Start of the timeline. Strings without an offset are read in the project's time zone.                                |
| `endDate`            | `DateInput`                  | from the tasks | End of the timeline. The timeline is always at least as wide as the viewport.                                        |
| `locale`             | `string`                     | the runtime's  | BCP 47 locale for header labels, dates and numbers, e.g. `'nb-NO'`.                                                  |
| `showToday`          | `boolean`                    | `true`         | A line at the current time.                                                                                          |
| `showNonWorkingTime` | `boolean`                    | `true`         | Shade non-working time: every interval with ticks under a day, whole days with day ticks, nothing with longer ticks. |
| `onPresetChange`     | `(presetId: string) => void` | –              | Called after every zoom (from the menu or `zoom()`). A zoom lasts until the `preset` option changes.                 |

Without `startDate` and `endDate`, the timeline covers the tasks' dates with some padding, or a few weeks from the
start of the current week when no task has dates.

### Task list

| Option              | Type                              | Default                                        | Description                                                                                                                                             |
| ------------------- | --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `columns`           | `readonly ColumnInput[]`          | `['name', 'startDate', 'endDate', 'duration']` | See [Columns](#columns).                                                                                                                                |
| `rowHeight`         | `number`                          | `44`                                           | Height of a task row in pixels.                                                                                                                         |
| `headerRowHeight`   | `number`                          | `28`                                           | Height of each header row in pixels.                                                                                                                    |
| `listWidth`         | `number \| null`                  | `null`                                         | Width of the task list in pixels, or `null` for automatic: as wide as the columns, up to `--qz-list-max-width` (default 60%).                           |
| `onListWidthChange` | `(width: number \| null) => void` | –                                              | Called after the divider changed the width (`null`: back to automatic, by double-clicking it). Dragging overrides `listWidth` until the option changes. |

### Interaction

Every interaction is on by default. Set an option to `false` to turn it off.

| Option             | What it turns on                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `taskDrag`         | Move tasks by dragging their bars.                                                              |
| `taskResize`       | Change a task's duration by dragging the end of its bar.                                        |
| `taskDragCreate`   | Give an unscheduled task dates by drawing its bar in its row.                                   |
| `progressDrag`     | Change the percentage done by dragging the handle at the progress.                              |
| `dependencyCreate` | Add dependencies by dragging from a handle at either end of a bar to another bar.               |
| `cellEdit`         | Edit cells in the task list (double-click, Enter or F2).                                        |
| `taskEdit`         | Edit tasks in a dialog (the menu's Edit, or double-clicking a bar).                             |
| `taskMenu`         | A context menu on tasks (right-click, the ContextMenu key or Shift+F10).                        |
| `timeAxisMenu`     | A context menu on the time axis header, for zooming.                                            |
| `taskTooltip`      | A tooltip for the task under the pointer.                                                       |
| `undoRedo`         | A history of the last 100 changes, for `undo`/`redo` and Ctrl/Cmd+Z. Turning it off forgets it. |
| `multiSelect`      | Select several tasks (Ctrl/Cmd-click, Shift-click, Shift+arrows, Ctrl/Cmd+A).                   |
| `deleteKey`        | Delete the selected tasks, with their subtasks, with Delete or Backspace.                       |

| Option              | Type                                            | Description                                                               |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `validateChange`    | `(change: ProposedChange) => boolean \| string` | Refuse a drag. See [Validating changes](#validating-changes).             |
| `onSelectionChange` | `(selection: readonly Id[]) => void`            | Called with the selected ids whenever the selection changes.              |
| `taskMenuItems`     | `MenuCustomizer`                                | Change the task menu. See [Menus](#menus).                                |
| `timeAxisMenuItems` | `MenuCustomizer`                                | Change the time axis menu.                                                |
| `createTaskId`      | `() => Id`                                      | Ids for tasks added from the menu. Defaults to unique ids like `task-12`. |

### Functions in options

Options are compared on every update, and unchanged ones are skipped. Columns and presets are compared by value,
but functions in them (`value`, label formats) and `validateChange` are compared by identity. Define those outside
render, or memoize them, so they don't count as a change every time.

## Project data

### Input

`ProjectInput` is what you pass in. Everything is optional.

```ts
const project: ProjectInput = {
  settings: { timeZone: 'Europe/Oslo', startDate: '2026-10-05' },
  tasks: [
    {
      id: 'design',
      name: 'Design',
      children: [
        { id: 'sketch', name: 'Sketches', duration: 3 },
        { id: 'review', name: 'Design review', duration: 0 }, // a milestone
      ],
    },
    { id: 'build', name: 'Build', duration: 2, durationUnit: 'week' },
  ],
  dependencies: [
    { id: 1, from: 'sketch', to: 'review' },
    { id: 2, from: 'review', to: 'build', type: 'FS', lag: 1 },
  ],
};
```

Tasks can be nested with `children`, given as a flat list with `parentId`, or a mix. Ids are strings or numbers
and must be unique per kind.

**`TaskInput`**

| Field               | Type                           | Default    | Description                                                                                      |
| ------------------- | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| `id`                | `Id`                           | (required) |                                                                                                  |
| `name`              | `string`                       | `''`       |                                                                                                  |
| `parentId`          | `Id \| null`                   | `null`     | Ignored for tasks nested in `children`.                                                          |
| `children`          | `TaskInput[]`                  | –          |                                                                                                  |
| `startDate`         | `DateInput \| null`            | `null`     | Computed for automatically scheduled tasks: pin it with `manuallyScheduled` or a constraint.     |
| `endDate`           | `DateInput \| null`            | `null`     | Exclusive.                                                                                       |
| `duration`          | `number \| null`               | `null`     | Working time, in `durationUnit`. `0` makes a milestone.                                          |
| `durationUnit`      | `TimeUnit`                     | `'day'`    |                                                                                                  |
| `percentDone`       | `number`                       | `0`        | 0–100.                                                                                           |
| `manuallyScheduled` | `boolean`                      | `false`    | Keeps its own dates: not moved by predecessors, and for parents not rolled up from the children. |
| `constraintType`    | `'startnoearlierthan' \| null` | `null`     | Set together with `constraintDate`. Dragging an automatically scheduled task sets it.            |
| `constraintDate`    | `DateInput \| null`            | `null`     |                                                                                                  |

An automatically scheduled task is placed from its `duration` (or derives the duration from a start and an end). One
with only a start is zero-length, and one with no dates or duration stays unscheduled (it can be drawn in its row).
Tasks are placed from the project start: set `settings.startDate`, or give at least one task a date. When nothing has
a date, everything stays unscheduled.

**`DependencyInput`**

| Field     | Type                           | Default    | Description                                    |
| --------- | ------------------------------ | ---------- | ---------------------------------------------- |
| `id`      | `Id`                           | (required) |                                                |
| `from`    | `Id`                           | (required) | The predecessor.                               |
| `to`      | `Id`                           | (required) | The successor.                                 |
| `type`    | `'FS' \| 'SS' \| 'FF' \| 'SF'` | `'FS'`     | Finish-to-start, start-to-start, and so on.    |
| `lag`     | `number`                       | `0`        | Working time between the two. May be negative. |
| `lagUnit` | `TimeUnit`                     | `'day'`    |                                                |

Dependencies on a parent apply to all its children. Cycles are rejected.

**`ProjectSettingsInput`**

| Field          | Type                | Default   | Description                                                                                           |
| -------------- | ------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `timeZone`     | `string`            | `'local'` | `'local'`, `'UTC'` or an IANA name.                                                                   |
| `calendarId`   | `Id \| null`        | `null`    | The project calendar. `null` uses the standard calendar, Monday–Friday 08:00–16:00.                   |
| `startDate`    | `DateInput \| null` | `null`    | Automatically scheduled tasks start here at the earliest. Set to the earliest task start when `null`. |
| `hoursPerDay`  | `number`            | `8`       | Working hours in a day, for converting durations.                                                     |
| `daysPerWeek`  | `number`            | `5`       |                                                                                                       |
| `daysPerMonth` | `number`            | `20`      |                                                                                                       |
| `weekStartsOn` | `number`            | `1`       | 0 = Sunday … 6 = Saturday.                                                                            |

**`CalendarInput`**

```ts
const calendars: CalendarInput[] = [
  {
    id: 'site',
    name: 'Building site',
    // Days left out are non-working. Leave out `week` entirely for Monday–Friday 08:00–16:00.
    week: {
      monday: [
        { start: '07:00', end: '11:00' },
        { start: '11:30', end: '15:00' },
      ],
      tuesday: [
        { start: '07:00', end: '11:00' },
        { start: '11:30', end: '15:00' },
      ],
      // …
    },
    exceptions: [
      { startDate: '2026-12-24', endDate: '2026-12-26', name: 'Christmas' }, // non-working
      { startDate: '2026-12-28', name: 'Extra day', intervals: [{ start: '08:00', end: '12:00' }] },
    ],
  },
];
```

Times are `"HH:mm"` wall-clock times in the project's time zone; an interval's `end` is exclusive and may be
`"24:00"`. Exception dates are `"YYYY-MM-DD"`, and the `endDate` is inclusive. Later exceptions win where they
overlap.

**`DateInput`** is a `Date`, epoch milliseconds, or an ISO 8601 string. Strings without an offset
(`'2026-10-05'`, `'2026-10-05T08:00'`) are wall-clock times in the project's time zone.

### Output

`ProjectData` is what comes back (`change.data`): the same project as flat, fully normalized, JSON-serializable
records. Every field is present (`null` means not set), times are epoch milliseconds, and tasks are a flat list with
`parentId`. It is also valid input, so you can store it and load it again as it is.

```ts
interface Task {
  id: Id;
  parentId: Id | null;
  name: string;
  startDate: number | null;
  endDate: number | null;
  duration: number | null;
  durationUnit: TimeUnit;
  percentDone: number;
  manuallyScheduled: boolean;
  constraintType: ConstraintType | null;
  constraintDate: number | null;
}
```

`TimeUnit` is `'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year'`.

## Changes

`onChange` gets a `GanttDataChange`:

| Field    | Type                                   | Description                                                                                                |
| -------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `patch`  | `Patch`                                | `{ operations, inverse }`: what changed, and how to revert it.                                             |
| `data`   | `ProjectData`                          | The project with the change applied.                                                                       |
| `source` | `'load' \| 'edit' \| 'undo' \| 'redo'` | `'load'`: scheduling written back into data that was loaded. `'edit'`: an edit in the chart or `transact`. |

One user action is one change: a drop, a cell edit, a deletion of several tasks. The dates scheduling moved as a
result are in the same patch.

In controlled mode, keep `change.data` and pass it back:

```ts
onChange: (change) => setData(change.data);
```

To send changes to a server, use the patch. Each `Operation` is one of `add`, `remove`, `update` or `move` on
`'tasks'`, `'dependencies'` or `'calendars'`, or a `settings` change; all are plain JSON. `applyPatch(data, patch)`
applies a patch to `ProjectData` without modifying it, e.g. to apply changes from other users.

A `'load'` change is not an edit by the user. Use the source to, for example, not mark the plan as unsaved.

## Transactions

`controller.transact(fn)` changes the project from code. All changes in `fn` are one change: one patch, one undo
step, one `onChange`. If `fn` throws, nothing changes. It returns the patch, or `null` when nothing changed.

```ts
gantt.transact((tx) => {
  const task = tx.tasks.add({ name: 'Inspection', duration: 1 }, { parentId: 'build' });
  tx.dependencies.add({ from: 'build', to: task.id });
  tx.tasks.update('sketch', { percentDone: 100 });
});
```

| Store             | Methods                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `tx.tasks`        | `get(id)`, `children(parentId)`, `add(input, position?)`, `update(id, changes)`, `move(id, position)`, `remove(id)` |
| `tx.dependencies` | `get(id)`, `add(input)`, `update(id, changes)`, `remove(id)`                                                        |
| `tx.calendars`    | `get(id)`, `add(input)`, `update(id, changes)`, `remove(id)`                                                        |
| `tx.settings`     | `get()`, `update(changes)`                                                                                          |

- Reads see the earlier writes in the same transaction.
- `add` generates an id when it's left out. `position` is `{ parentId?, index? }`.
- `remove` on a task also removes its descendants and every dependency connected to them.
- `update` skips fields that equal the current value, so a no-op update adds nothing to the patch.
- A calendar can't be removed while it is the project calendar.
- Invalid changes (unknown ids, an end before the start, a dependency cycle) throw a `QuartzioError`, and nothing
  changes.

In controlled mode, `transact` only reports the change; it shows once you pass the data back. Transactions in the
same synchronous run build on each other.

## The controller

`createGantt(options)` returns a `GanttController`. With React, the `ref` of `<Gantt>` gives you the same object.
Most methods exist for renderers (they forward DOM events); these are the ones an app calls:

| Method                                     | Description                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `transact(fn)`                             | Change the project. See [Transactions](#transactions).                                 |
| `undo()` / `redo()`                        | Undo or redo the last change. Returns whether there was one.                           |
| `select(ids)` / `clearSelection()`         | Set the selection. Unknown ids are skipped.                                            |
| `toggle(id)` / `setExpanded(id, expanded)` | Expand or collapse a parent.                                                           |
| `expandAll()` / `collapseAll()`            |                                                                                        |
| `zoom(target)`                             | `'in'`, `'out'`, or a built-in preset id, keeping the middle of the view.              |
| `openTaskEditor(id)`                       | Open the task editor dialog.                                                           |
| `startEdit(id, columnId?)`                 | Start editing a cell.                                                                  |
| `getState()`                               | The current `ViewState`.                                                               |
| `subscribe(listener)`                      | Called with the new `ViewState` on every change. Returns a function that unsubscribes. |
| `setOptions(options)`                      | Update options. Invalid options throw and change nothing.                              |
| `destroy()`                                |                                                                                        |

### Writing a renderer

`ViewState` holds everything a renderer draws, as plain data in pixels: the time axis and header cells, the rows in
view (virtualized) with their bars, dependency lines, non-working time, the today line, the drag preview, the
tooltip, the open menu and editor, and the scroll position to go to. A renderer:

1. subscribes to the state and draws it,
2. reports its size and scroll position with `setViewport({ width, height, scrollLeft, scrollTop })`,
3. forwards input: `pointerDown`/`pointerMove`/`pointerUp`/`hover`/`doubleClick` with points in timeline
   coordinates, `keyDown` for keys on the chart, `rowClick`, and the methods for cell editing, menus, the task
   editor and the divider (`editKeyDown`, `menuKeyDown`, `taskEditorAction`, `resizeList`, …).

[`@quartzio/gantt-react`](../gantt-react/src) is a complete example.

## Columns

`columns` takes built-in column ids and column definitions, in order:

```ts
const columns: ColumnInput[] = [
  { id: 'code', title: 'Code', width: 70, value: ({ task }) => codes.get(task.id) ?? '' },
  'name',
  'startDate',
  { id: 'days', field: 'duration', title: 'Days', width: 80 },
  { id: 'cost', title: 'Cost', align: 'end', value: ({ task }) => formatCost(task.id) },
];
```

Built-in ids: `'name'`, `'startDate'`, `'endDate'`, `'duration'`, `'percentDone'`. The tree (indentation and
expand/collapse) shows in the name column.

**`ColumnDefinition`**

| Field      | Type                            | Description                                                               |
| ---------- | ------------------------------- | ------------------------------------------------------------------------- |
| `id`       | `string`                        | Unique among the columns.                                                 |
| `title`    | `string`                        | Header text.                                                              |
| `width`    | `number`                        | Pixels.                                                                   |
| `field`    | built-in id                     | A built-in column to base it on: its title, width, value and editing.     |
| `align`    | `'start' \| 'end'`              |                                                                           |
| `value`    | `(cell: CellContext) => string` | The cell text. Must not throw; an error leaves the cell empty.            |
| `editable` | `boolean`                       | Default `true` with a `field`. Columns without a `field` can't be edited. |

`CellContext` has the `task`, `isParent`, its displayed `dates` (`{ start, end }` or `null`), the project
`settings`, the `locale`, and the project `calendar`.

Edited cells take the format of their field: dates in native date fields, durations like `4d`, `2 weeks`, `3h` or
`1,5` (in the task's unit), and a percentage.

## Time axis presets

Built-in presets, from zoomed in to zoomed out (`VIEW_PRESETS`): `'hourAndDay'`, `'dayAndWeek'`, `'weekAndDay'`,
`'weekAndMonth'`, `'monthAndYear'`, `'quarterAndYear'`, `'manyYears'`.

A custom preset:

```ts
const sprints: ViewPreset = {
  id: 'sprints',
  tickUnit: 'day',
  tickIncrement: 1,
  tickWidth: 24,
  headers: [
    { unit: 'week', increment: 2, format: (cell) => `Sprint ${sprintNumber(cell.start)}` },
    { unit: 'day', format: 'weekdayNarrow' },
  ],
  timeResolution: { unit: 'day', increment: 1 },
};
```

- `tickUnit`, `tickIncrement` and `tickWidth`: the smallest column, and its width in pixels.
- `headers`: rows from top to bottom. `format` is a built-in format or a function of a `HeaderCellContext`
  (`start`, `end`, `unit`, `increment`, `timeZone`, `locale`) that must not throw.
- `timeResolution`: what dragging and resizing snap to.

Built-in formats: `'year'`, `'quarter'`, `'quarterYear'`, `'month'`, `'monthShort'`, `'monthYear'`,
`'monthShortYear'`, `'week'` (ISO week number), `'day'`, `'weekdayShort'`, `'weekdayNarrow'`, `'weekdayDay'`,
`'dayMonth'`, `'weekdayDayMonth'`, `'hour'`, `'hourMinute'`. Names of months and weekdays follow the locale.

## Menus

`taskMenuItems` and `timeAxisMenuItems` get the built-in items and a `MenuContext`, and return the items to show:

```ts
const taskMenuItems: MenuCustomizer = (items, { selection }) => [
  ...items.filter((item) => item.id !== 'convertToMilestone'),
  { id: 'complete', label: 'Mark complete', separator: true, action: () => markComplete(selection) },
];
```

**`MenuItem`**: `id`, `label`, and optionally `disabled`, `checked`, `separator` (a line before it), `items` (a
submenu, one level), and `action(context)` for your own items. Built-in items are carried out by the engine.

Built-in task menu items (`TaskMenuItemId`): `'edit'`, an `'add'` submenu with `'addTaskAbove'`,
`'addTaskBelow'`, `'addSubtask'`, `'addMilestone'`, `'addSuccessor'` and `'addPredecessor'`, then `'indent'`,
`'outdent'`, `'convertToMilestone'` and `'delete'`. To change the submenu, map over the items:

```ts
const taskMenuItems: MenuCustomizer = (items) =>
  items.map((item) =>
    item.id === 'add' ? { ...item, items: item.items?.filter((sub) => sub.id !== 'addPredecessor') } : item,
  );
```

`MenuContext` has the `target` (`{ kind: 'task', id }` or `{ kind: 'timeAxis' }`), the `task` (or `null`), the
`selection`, and the current `preset`.

## Validating changes

`validateChange` is called for every change a drag proposes, while dragging and on the drop. Return `true` to allow
it, or `false` or a message to refuse it: the preview shows it as invalid, the message shows in the tooltip, and the
drop changes nothing.

```ts
const validateChange = (change: ProposedChange) => {
  if (change.kind === 'link') return true;
  return change.task.percentDone === 100 ? 'Completed work is locked' : true;
};
```

`ProposedChange` is one of:

- `{ kind: 'move' | 'resize' | 'create', task, start, end }`
- `{ kind: 'progress', task, percentDone }`
- `{ kind: 'link', from, to, type }`

## Keyboard

With the chart focused:

| Key                                      | Action                                                    |
| ---------------------------------------- | --------------------------------------------------------- |
| Up, Down, Page Up, Page Down, Home, End  | Move the cursor and the selection.                        |
| Shift + the keys above                   | Extend the selection.                                     |
| Right / Left                             | Expand / collapse, or go to the first child / the parent. |
| Space                                    | Toggle the row in the selection.                          |
| Ctrl/Cmd+A                               | Select all.                                               |
| Escape                                   | Clear the selection.                                      |
| Enter, F2                                | Edit the row's first editable cell.                       |
| ContextMenu, Shift+F10                   | Open the task menu.                                       |
| Delete, Backspace                        | Delete the selected tasks.                                |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y | Undo, redo.                                               |

While a cell is being edited, Enter saves, Escape cancels, and Tab and Shift+Tab save and move on.

## Theming

Import the stylesheet once: `@quartzio/gantt/styles.css` (or `@quartzio/gantt-react/styles.css`, the same file).
All classes start with `qz-`, and the styles are themed with CSS variables, in two levels:

1. **Design tokens**, declared with zero specificity on `:root`, so you can override them on any element:
   `--qz-bg`, `--qz-raised`, `--qz-sunken`, `--qz-text`, `--qz-text-muted`, `--qz-line`, `--qz-primary`,
   `--qz-accent`, `--qz-font-sans`, `--qz-radius-sm`, and more (see the top of `styles.css`).
2. **Component variables**, which follow the tokens until you set them: `--qz-bar-color`,
   `--qz-bar-progress-color`, `--qz-bar-text-color`, `--qz-bar-radius`, `--qz-summary-color`,
   `--qz-milestone-color`, `--qz-dependency-color`, `--qz-today-color`, `--qz-nonworking-color`,
   `--qz-row-hover-color`, `--qz-row-selected-color`, `--qz-font-family`, `--qz-font-size`,
   `--qz-list-max-width`, `--qz-tooltip-background`.

```css
.my-plan {
  --qz-primary: #0b7a5c;
  --qz-bar-color: #d6efe6;
  --qz-list-max-width: 40%;
}
```

**Dark mode:** add the class `qz-dark` to the chart or any ancestor (for example `<html>`).

**Fonts:** the font stacks start with Outfit and JetBrains Mono. The package loads no fonts; without them, the
system fonts are used.

## Utilities

The engine's building blocks are exported for apps and custom renderers:

| Export                                                                                | Description                                                                                                                                        |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applyPatch(data, patch)`                                                             | `ProjectData` with a patch applied. The input is not modified.                                                                                     |
| `createProject(input?, options?)`                                                     | The data model on its own: `load`, `transact`, `apply`, `plan`, `toData`, `subscribe`. No scheduling unless you pass `propagate: scheduleProject`. |
| `scheduleProject(state, operations)`                                                  | The scheduler: the operations that write computed dates back.                                                                                      |
| `toProjectData(state)`                                                                | A `ProjectState` as `ProjectData`.                                                                                                                 |
| `getTreeIndex(tasks)`                                                                 | Children, ancestors, descendants and depth of tasks.                                                                                               |
| `getWorkingCalendar(state, calendarId?)`                                              | A `WorkingCalendar`: `addWorkingTime`, `workingTimeBetween`, `isWorking`, `workingIntervals`, …                                                    |
| `durationToWorkingMs`, `workingMsToDuration`, `workingMsPerUnit`                      | Convert durations with `hoursPerDay`, `daysPerWeek` and `daysPerMonth`.                                                                            |
| `taskDates(task)`                                                                     | A task's displayed start and end, or `null` when it is unscheduled.                                                                                |
| `parseDateString(value, zone)`                                                        | An ISO 8601 string as epoch milliseconds, read in a time zone. `null` when invalid.                                                                |
| `toWallTime`, `fromWallTime`, `startOfUnit`, `addUnits`, `isoWeek`, `isValidTimeZone` | Time zone–aware date math.                                                                                                                         |
| `createTimeAxis(options)`, `VIEW_PRESETS`, `resolvePreset`                            | The time axis on its own.                                                                                                                          |
| `DEFAULT_SETTINGS`, `STANDARD_CALENDAR`, `DEFAULT_COLUMNS`                            | The defaults.                                                                                                                                      |

## Errors

Invalid input throws a `QuartzioError` with a message that says what is wrong and where, for example
`Task "a": "endDate" is before "startDate".` Validation happens before anything changes, so a rejected option, load or
transaction leaves the chart as it was. Functions you pass in (column values, label formats) never break rendering:
when they throw, the cell or label is left empty.
