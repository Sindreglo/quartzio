import type { ComponentType } from 'react';
import { BasicDemo } from './basic';
import { CalendarDemo } from './calendar';
import { DataModelDemo } from './data-model';

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
];
