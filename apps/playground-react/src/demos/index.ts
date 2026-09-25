import type { ComponentType } from 'react';
import { BarsDemo } from './bars';
import { BasicDemo } from './basic';
import { CalendarDemo } from './calendar';
import { DataModelDemo } from './data-model';
import { DependenciesDemo } from './dependencies';
import { DragDemo } from './drag';
import { SchedulingDemo } from './scheduling';
import { TaskListDemo } from './task-list';
import { TimeAxisDemo } from './timeaxis';

export interface Demo {
  /** Used in the URL hash, e.g. #basic */
  id: string;
  title: string;
  description: string;
  Component: ComponentType;
}

// One demo per feature. Register new demos here so they show up in the menu.
export const demos: Demo[] = [
  {
    id: 'basic',
    title: 'Basic',
    description: 'The Gantt component with default options.',
    Component: BasicDemo,
  },
  {
    id: 'data-model',
    title: 'Data model',
    description:
      'Controlled data: edits are transactions that produce patches. Undo/redo applies inverse patches with applyPatch.',
    Component: DataModelDemo,
  },
  {
    id: 'calendar',
    title: 'Time & calendars',
    description:
      'Durations are working time: start + duration skips nights, weekends and holidays, in the chosen time zone. Try a start before a DST change or a holiday.',
    Component: CalendarDemo,
  },
  {
    id: 'timeaxis',
    title: 'Time axis',
    description:
      'Presets from hours to years, header labels in any locale, and days and weeks in the project time zone. Hover to see xToDate.',
    Component: TimeAxisDemo,
  },
  {
    id: 'task-list',
    title: 'Task list',
    description:
      'Rows from the task tree with expand/collapse, configurable columns and virtualized rows. Try 10 000 tasks.',
    Component: TaskListDemo,
  },
  {
    id: 'bars',
    title: 'Bars',
    description:
      'Task bars with progress, summary bars for parents, milestones, the today line and non-working time from the project calendar.',
    Component: BarsDemo,
  },
  {
    id: 'scheduling',
    title: 'Scheduling',
    description:
      'Tasks start as soon as possible after the project start and their predecessors (FS, SS, FF, SF with lag); parents span their children; manually scheduled tasks keep their dates. Dates are written back into the data.',
    Component: SchedulingDemo,
  },
  {
    id: 'dependencies',
    title: 'Dependencies',
    description:
      'Arrows between tasks: out of the predecessor’s side and into the successor’s, for FS, SS, FF and SF, going around when there is no room. Lines are virtualized with the rows.',
    Component: DependenciesDemo,
  },
  {
    id: 'drag',
    title: 'Drag & resize',
    description:
      'Drag bars to move tasks and their end to resize them, snapped to the time resolution. Automatic tasks get “start no earlier than”; manual ones just move. One drop is one change.',
    Component: DragDemo,
  },
];
