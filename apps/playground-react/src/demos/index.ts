import type { ComponentType } from 'react';
import { BarsDemo } from './bars';
import { DataModelDemo } from './data-model';
import { DependenciesDemo } from './dependencies';
import { DragDemo } from './drag';
import { EditingDemo } from './editing';
import { ListWidthDemo } from './list-width';
import { MenusDemo } from './menus';
import { SchedulingDemo } from './scheduling';
import { SelectionDemo } from './selection';
import { TaskListDemo } from './task-list';
import { TimeAxisDemo } from './timeaxis';
import { Version01Demo } from './version-0-1';

export const SECTIONS = [
  { id: 'scenarios', title: 'Scenarios' },
  { id: 'data', title: 'Data & scheduling' },
  { id: 'view', title: 'View' },
  { id: 'interaction', title: 'Interaction' },
] as const;

export type Section = (typeof SECTIONS)[number];

export interface Demo {
  /** Unique: the anchor on its section's page (`/view#bars`), and `?only=<id>`. */
  id: string;
  section: Section['id'];
  title: string;
  description: string;
  Component: ComponentType;
}

// One demo per feature. Register new demos here so they show up in the menu.
export const demos: Demo[] = [
  {
    id: 'version-0.1',
    section: 'scenarios',
    title: 'Version 0.1 scenarios',
    description:
      'The first release put to the test with realistic plans: an everyday user with a small plan and no options, and a power user running a construction program (up to 9 400 tasks) with most of the library wired up.',
    Component: Version01Demo,
  },
  {
    id: 'data-model',
    section: 'data',
    title: 'Data model',
    description:
      'Controlled data: edits are transactions that produce patches. Undo/redo applies inverse patches with applyPatch.',
    Component: DataModelDemo,
  },
  {
    id: 'scheduling',
    section: 'data',
    title: 'Scheduling',
    description:
      'Tasks start as soon as possible after the project start and their predecessors (FS, SS, FF, SF with lag); parents span their children; manually scheduled tasks keep their dates. Dates are written back into the data.',
    Component: SchedulingDemo,
  },
  {
    id: 'dependencies',
    section: 'data',
    title: 'Dependencies',
    description:
      'Arrows between tasks: out of the predecessor’s side and into the successor’s, for FS, SS, FF and SF, going around when there is no room. Lines are virtualized with the rows.',
    Component: DependenciesDemo,
  },
  {
    id: 'timeaxis',
    section: 'view',
    title: 'Time axis',
    description:
      'Presets from hours to years, header labels in any locale, and days and weeks in the project time zone. Hover to see xToDate.',
    Component: TimeAxisDemo,
  },
  {
    id: 'task-list',
    section: 'view',
    title: 'Task list',
    description:
      'Rows from the task tree with expand/collapse, configurable columns and virtualized rows. Try 10 000 tasks.',
    Component: TaskListDemo,
  },
  {
    id: 'list-width',
    section: 'view',
    title: 'Task list width',
    description:
      'Drag the divider between the task list and the timeline, or Tab to it and use the arrow keys (Shift for bigger steps, Home and End). Double-click it for the automatic width again. The app keeps the width: here it is remembered across reloads.',
    Component: ListWidthDemo,
  },
  {
    id: 'bars',
    section: 'view',
    title: 'Bars',
    description:
      'Task bars with progress, summary bars for parents, milestones, the today line and non-working time from the project calendar.',
    Component: BarsDemo,
  },
  {
    id: 'drag',
    section: 'interaction',
    title: 'Drag & resize',
    description:
      'Drag bars to move and resize them, drag progress, draw bars for unscheduled tasks, and link tasks by dragging between their ends. Snapped to the time resolution, auto-scrolling at the edges, with an optional validator. One drop is one change.',
    Component: DragDemo,
  },
  {
    id: 'selection',
    section: 'interaction',
    title: 'Selection & keyboard',
    description:
      'Click, Ctrl/Cmd-click and Shift-click rows; with the chart focused, move with the arrow keys, expand and collapse with Left/Right, select all with Ctrl/Cmd+A, delete with Delete, and undo with Ctrl/Cmd+Z. Every change (a drop, a deletion) is one undo step.',
    Component: SelectionDemo,
  },
  {
    id: 'editing',
    section: 'interaction',
    title: 'Tooltip & editing',
    description:
      'Hover a bar for its tooltip. Double-click a cell (or press Enter/F2 on a selected row) to edit it: names, dates in native date fields, durations like 4d or 2w, and % done. The engine reads and validates the value; each edit is one undoable change.',
    Component: EditingDemo,
  },
  {
    id: 'menus',
    section: 'interaction',
    title: 'Menus & task editor',
    description:
      'Right-click a row or bar (or press the ContextMenu key / Shift+F10) for the task menu: edit, add tasks around it, indent, outdent, convert to milestone, delete. Right-click the time axis to zoom. Double-click a bar to edit the task in a dialog; Save is one undoable change.',
    Component: MenusDemo,
  },
];
